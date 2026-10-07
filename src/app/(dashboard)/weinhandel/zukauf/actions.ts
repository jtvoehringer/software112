'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { zielNachAbschluss } from '@/lib/navigation/zurueck'
import { AktionsFehler, dbFehlerText, fehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal, fmtNum } from '@/lib/format'
import { qualitaetFehler, qualitaetsAngabeAusFormular, qualitaetsAngabeFehler } from '@/lib/wein/qualitaet'
import { qualitaetsSpalten, type QualitaetsAngabe } from '@/lib/wein/qualitaetsrang'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { mitPnNotiz } from '@/lib/kellerbuch/pruefnummer'
import { mostgewichtAusFormular, mostgewichtAusGespeichert, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
import { istTraubenArt, zukaufWareFehler, istFlaschenArt, flaschenZukaufFehler } from '@/lib/zukauf/ware'
import { weinartKonflikt, weinartBekannt, weinartAusFarbe, WEINART_LABEL } from '@/lib/keller/weinart'
import { waehleZielCharge, merkmaleText } from '@/lib/kellerbuch/umzugZiel'
import { verschnittVorbereiten } from '@/lib/kellerbuch/verschnittBuchen'
import { planeVerschneidungStorno, storniereVerschneidung } from '@/lib/kellerbuch/storno'
import type { Folgebuchung } from '@/lib/kellerbuch/folgebuchungen'
import { ohneStornierteVerschnitte } from '@/lib/kellerbuch/stornoFilter'
import { zukaufLieferantFehler, ZUKAUF_MERKMALE } from '@/lib/handel/partnerPflicht'
import { ladePartner } from '@/lib/handel/partnerLaden'
import { bkiFarbe } from '@/lib/wein/bki_kuerzel'
import { tbsLieferantFehler, tbsLieferantSpalten } from '@/lib/handel/tbsNummer'
import {
  folgebuchungenDerZielcharge, zielchargeText, zukaufVerweise, traubenGebundenText, loeschSperreText,
} from './sperren'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── KAN-35 (24.09.2026): Zukauf = Beleg und Zugang ─────────────────────────────
// zukauf_posten.menge ist die Belegmenge (Transportbescheinigung/Eingangsrechnung) und
// – bei Wein/Most mit Gebinde – der Zugang der Zielcharge (View v_behaelter_fuellstand,
// Bewegungsbuch der Charge). Deshalb:
//  - Menge, Einheit, Gebinde und Art nur ändern, solange an der Zielcharge keine
//    Folgebuchungen hängen (lib/kellerbuch/folgebuchungen.ts, siehe sperren.ts);
//  - Trauben: Menge nie unter die bereits verpressten bzw. verkauften kg, Art nicht mehr wechseln;
//  - Löschen (Soft-Delete) nur ohne Folgebuchungen und ohne Pressung/Traubenverkauf;
//  - keine stillen Mengenkorrekturen (kein Math.max(0, …)) – vorher prüfen und ablehnen.

// Mengenvergleich (Formular: Schrittweite 0,001)
const TOLERANZ = 0.0005
const runde = (v: number) => Math.round(v * 10000) / 10000

/** Aktiver Mandant + Schreibrecht Warenwirtschaft. RLS prüft zusätzlich – hier für eine
 *  klare Meldung statt eines still weggefilterten Updates. KAN-193: darfKellerbuch für den Verschnitt beim Zukauf
 *  und dessen Storno (die RPC bzw. RLS prüfen das Kellerbuch selbst – hier für eine klare Meldung vorab). */
async function schreibKontext(): Promise<{ tenantId: string; darfKellerbuch: boolean }> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: vor den Rechten – sonst meldet ein veralteter Tab die Rechte des neuen Betriebs
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'warenwirtschaft')) {
    throw new AktionsFehler('Keine Berechtigung: Zukäufe erfassen, ändern und löschen dürfen nur Betriebs-Manager und Mitarbeiter mit Freigabe für die Warenwirtschaft.')
  }
  return { tenantId: membership.tenantId, darfKellerbuch: canWrite(membership, 'kellerbuch') }
}

async function createZukaufCharge(
  supabase: any,
  tenantId: string,
  behaelterId: string,
  rebsorte: string | null,
  jahrgang: number | null,
  menge: number,
  einstandspreisProLiter: number | null,
  weinart: string | null,
  qualitaet: QualitaetsAngabe,
  herkunftCode: string | null,
  mostgewicht: Mostgewicht | null,
  landIso: string,
): Promise<string> {
  const name = rebsorte || 'Zukauf'
  const { data: neu, error } = await (supabase.from('weinausbau') as any)
    .insert({
      tenant_id:   tenantId,
      name,
      rebsorte:    rebsorte ?? null,
      behaelter_id: behaelterId,
      jahrgang,
      menge_liter:  menge,
      einstandspreis_pro_liter: einstandspreisProLiter ?? null,
      anfangsbestand_liter: null,
      status:      'ausbau',
      aktiv:       true,
      weinart:     weinart ?? 'unbekannt',
      // KAN-186: Stufe, Zusatzbezeichnung, Erzeugnis und Ursprungsland des Zukaufs an die Charge (nie ein Altwert)
      ...qualitaetsSpalten(qualitaet),
      land_iso: landIso,
      // KAN-80 Nachtrag (02.10.2026): Herkunfts-Code (BKI) des Zukaufs an die Charge – fehlte bisher; damit gelten
      // für Verschnitt, Umzug und Füllung dieselben Abstufungsregeln wie für eigene Chargen
      herkunft_code: herkunftCode ?? null,
      // KAN-130 Etappe 3 (01.10.2026): Mostgewicht des Zukaufs als Momentaufnahme – Messwert samt
      // Einheit (°Oe bleibt °Oe), nie nur °KMW. Die Stufe bleibt die Angabe des Zukaufs (Rechenregel 6).
      ...mostgewichtSpalten(mostgewicht, 'kmw'),
    })
    .select('id')
    .single()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Charge für den Zukauf konnte nicht angelegt werden'))
  return (neu as AR).id
}

/** Charge des Zukaufs ändern – Fehler und „keine Zeile geändert“ (RLS, z. B. ohne
 *  Schreibfreigabe Kellerbuch) werden gemeldet, nie still übergangen. */
async function chargeAendern(supabase: any, weinausbauId: string, tenantId: string, werte: AR): Promise<void> {
  const { data, error } = await (supabase.from('weinausbau') as any)
    .update(werte)
    .eq('id', weinausbauId)
    .eq('tenant_id', tenantId)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (weinausbau)'))
  if (!(data as AR[] | null)?.length) {
    throw new AktionsFehler('Die Charge des Zukaufs konnte nicht geändert werden – fehlt die Schreibfreigabe für das Kellerbuch?')
  }
}

// Schließt die Zielcharge eines Zukaufs ab (0 L, abgeschlossen, inaktiv).
// KAN-35: NUR aufrufen, nachdem folgebuchungenDerZielcharge() keine Folgebuchungen gemeldet
// hat – dann war dieser Zukauf der einzige Zugang und nichts ist abgegangen, 0 L ist also
// exakt. Bis 24.09.2026 prüfte die Funktion selbst und blieb bei Bewegungen still stehen,
// der Zukauf wurde trotzdem gelöscht bzw. abgekoppelt und der Zugang verschwand rückwirkend
// (Sandbox: Charge „Weisser Riesling“ auf −10.100 L). Jetzt sperren die Aufrufer vorher.
async function bereinigCharge(supabase: any, weinausbauId: string, tenantId: string): Promise<void> {
  await chargeAendern(supabase, weinausbauId, tenantId, { menge_liter: 0, status: 'abgeschlossen', aktiv: false })
}

/** Nach einem Fehler: Rückbau versuchen (PostgREST kennt keine Transaktion über mehrere
 *  Aufrufe) und den ursprünglichen Fehler weiterwerfen. Scheitert auch der Rückbau, steht
 *  das in der Meldung. */
async function mitRueckbau(fehler: unknown, rueckbau: (() => Promise<void>) | null): Promise<never> {
  if (rueckbau) {
    try {
      await rueckbau()
    } catch (e) {
      throw new AktionsFehler(
        `${fehlerText(fehler, 'Speichern fehlgeschlagen')} – zusätzlich konnte die Charge nicht zurückgesetzt werden (${fehlerText(e, 'unbekannter Fehler')}). Bitte die Charge im Kellerbuch prüfen.`,
      )
    }
  }
  throw fehler
}

function parseZukaufFormData(formData: FormData) {
  const datum = (formData.get('datum') as string) || new Date().toISOString().split('T')[0]
  // Jahrgang ist optional im Formular, wird aber u.a. für den Pressungs-Vorschlag
  // und den Traubenverkauf-Dropdown bei Trauben-Zukäufen benötigt (exakter Match
  // gegen weinjahrgaenge.jahrgang) – bleibt das Feld leer, auf das Kalenderjahr
  // des Liefer-/Kaufdatums zurückfallen, statt NULL zu speichern und den Posten
  // dadurch unsichtbar für diese Zuordnung zu machen.
  // KAN-80 Nachtrag (02.10.2026): der Jahrgang ist jetzt Pflicht (zukaufWareFehler) – der Rückfall bleibt nur
  // als Sicherheitsnetz, geprüft wird die Eingabe selbst (jahrgangEingabe)
  const jahrgangEingabe = parseInt(dezimal(formData.get('jahrgang') as string))
  const jahrgang = !isNaN(jahrgangEingabe) ? jahrgangEingabe : (parseInt(datum.slice(0, 4)) || null)
  const art = (formData.get('art') as string) || 'wein'
  // KAN-73: die Stufe geht bei Wein/Most in die Zielcharge (weinausbau) – nur Werte des
  // CHECK weinausbau (QUALITAET_OPTS), sonst verständliche Meldung statt 23514.
  // KAN-80 Nachtrag (02.10.2026): auch Trauben haben eine Stufe – dort die Liste der Lese (LESE_QUALITAETEN).
  // KAN-186: ein Altwert (reserve, sekt …) wird normalisiert; Zusatzbezeichnung und Erzeugnis nur bei Wein/Most
  const angabe = qualitaetsAngabeAusFormular(formData)
  const qualitaetsstufe = angabe.stufe
  const qualitaetUnzulaessig = qualitaetFehler('charge', qualitaetsstufe)
  if (qualitaetUnzulaessig && !istTraubenArt(art)) throw new AktionsFehler(qualitaetUnzulaessig)
  const traubenQualitaetUnzulaessig = qualitaetFehler('lese', qualitaetsstufe)
  if (traubenQualitaetUnzulaessig && istTraubenArt(art)) throw new AktionsFehler(traubenQualitaetUnzulaessig)
  const qualitaet: QualitaetsAngabe = istTraubenArt(art) ? { stufe: qualitaetsstufe, zusatz: null, erzeugnis: null } : angabe
  const angabeUnzulaessig = qualitaetsAngabeFehler(qualitaet)
  if (angabeUnzulaessig) throw new AktionsFehler(angabeUnzulaessig)
  // KAN-186: Ursprungsland (kat_land, Standard Österreich) – der Fremdschlüssel prüft, ob es das Land gibt
  const landIso = String(formData.get('land_iso') ?? '').trim().toUpperCase() || 'AT'
  if (!/^[A-Z]{2}$/.test(landIso)) throw new AktionsFehler('Bitte das Ursprungsland aus der Auswahl wählen.')
  // KAN-130 Etappe 3 (01.10.2026): Mostgewicht aus Messwert und Einheit der Eingabe
  // (mostgewicht_wert/_einheit; übergangsweise das alte Feld kmw als °KMW), serverseitig gerechnet.
  // uebermittelt = false (Feld nicht im Formular, z. B. Art Wein): gespeicherte Werte bleiben.
  const mg = mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'kmw' })
  if (!mg.ok) throw new AktionsFehler(mg.fehler)
  // KAN-90: Transportschein-Nr. des Lieferanten (Nummer und Jahr)
  const tbsFehler = tbsLieferantFehler(formData.get('tbs_nummer_lieferant'), formData.get('tbs_jahr_lieferant'))
  if (tbsFehler) throw new AktionsFehler(tbsFehler)
  return {
    datum,
    lieferungUhrzeit:    (formData.get('lieferung_uhrzeit')        as string)?.trim() || null,
    art,
    lieferantKontaktId:  (formData.get('lieferant_kontakt_id')     as string) || null,
    lieferantFirmaId:    (formData.get('lieferant_firma_id')       as string) || null,
    // Nur beim Neuanlegen relevant – siehe createZukauf; updateZukauf lässt das Feld
    // bewusst unangetastet (Lieferant-Zuordnung ist nach dem Anlegen nicht mehr änderbar).
    zhKontaktId:         (formData.get('zh_kontakt_id')            as string) || null,
    eingangsrechnungsnummer: (formData.get('eingangsrechnungsnummer') as string)?.trim() || null,
    tbs: tbsLieferantSpalten(formData.get('tbs_nummer_lieferant'), formData.get('tbs_jahr_lieferant')),
    zugmaschine:         (formData.get('transport_zugmaschine')    as string)?.trim() || null,
    anhaenger1:          (formData.get('transport_anhaenger1')     as string)?.trim() || null,
    anhaenger2:          (formData.get('transport_anhaenger2')     as string)?.trim() || null,
    weinart:             (formData.get('weinart')                  as string) || 'unbekannt',
    rebsorte:            (formData.get('rebsorte')                 as string)?.trim() || null,
    qualitaetsstufe,
    qualitaet,
    landIso,
    jahrgang,
    jahrgangEingabe:     isNaN(jahrgangEingabe) ? null : jahrgangEingabe,
    // KAN-80 Nachtrag: Herkunfts-Code (BKI) bzw. eigenes Weinbaugebiet – Prüfung in pruefeWare
    herkunft:          (formData.get('herkunft')                 as string)?.trim() || null,
    anreicherung:        formData.get('anreicherung') === 'true',
    mostgewicht:         mg.wert,
    mostgewichtUebermittelt: mg.uebermittelt,
    alkohol:             parseFloat(dezimal(formData.get('alkohol_pct')    as string)) || null,
    pruefnummer:         (formData.get('staatliche_pruefnummer')   as string)?.trim() || null,
    menge:               parseFloat(dezimal(formData.get('menge')          as string)) || 0,
    // KAN-41 Paket 2b: Flaschen immer in Stück
    einheit:             istFlaschenArt(art) ? 'Stk' : ((formData.get('einheit') as string) || 'kg'),
    preisGesamt:         parseFloat(dezimal(formData.get('preis_gesamt')   as string)) || null,
    einstandspreisLiter: parseFloat(dezimal(formData.get('einstandspreis_pro_liter') as string)) || null,
    notizen:             (formData.get('notizen')                  as string)?.trim() || null,
    zielBehaelterId:     (formData.get('ziel_behaelter_id')        as string) || null,
    // KAN-41 Paket 2b: Weinlager-Artikel eines Flaschenzukaufs (nur beim Anlegen)
    fuellungName:        (formData.get('fuellung_name')            as string)?.trim() || null,
    flaschengroesseMl:   parseInt(String(formData.get('flaschengroesse_ml') ?? '')) || null,
    vkPreisBrutto:       parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    mwstPct:             parseFloat(dezimal(formData.get('mwst_pct') as string)) || null,
  }
}

type ZukaufFormular = ReturnType<typeof parseZukaufFormData>

/** KAN-208: geänderte Merkmale des Belegs gegenüber dem gespeicherten Stand (dieselben Felder wie der Trigger a_freeze) */
function geaenderteMerkmale(a: AR, f: ZukaufFormular): string[] {
  const q = zukaufQualitaetsSpalten(f) as AR
  const gleich = (x: unknown, y: unknown) => String(x ?? '') === String(y ?? '')
  const zahl = (x: unknown, y: unknown) => (x == null || y == null) ? (x == null) === (y == null) : Math.abs(Number(x) - Number(y)) < 0.005
  const geaendert: string[] = []
  if (!gleich(String(a.datum ?? '').slice(0, 10), f.datum)) geaendert.push('Datum')
  if (!gleich(a.weinart ?? 'unbekannt', f.weinart ?? 'unbekannt')) geaendert.push('Weinart')
  if (!gleich(a.rebsorte, f.rebsorte)) geaendert.push('Rebsorte')
  if (!gleich(a.jahrgang, f.jahrgang)) geaendert.push('Jahrgang')
  if (!gleich(a.qualitaetsstufe, q.qualitaetsstufe) || !gleich(a.zusatzbezeichnung, q.zusatzbezeichnung) || !gleich(a.erzeugnis, q.erzeugnis)) geaendert.push('Qualität')
  if (!gleich(a.herkunft, f.herkunft)) geaendert.push('Herkunft')
  if (!gleich(a.land_iso ?? 'AT', f.landIso ?? 'AT')) geaendert.push('Land')
  if (f.mostgewichtUebermittelt && !zahl(a.kmw, f.mostgewicht?.kmw ?? null)) geaendert.push('Mostgewicht')
  if (!zahl(a.alkohol_pct, f.alkohol)) geaendert.push('Alkohol')
  if (!!a.anreicherung !== !!f.anreicherung) geaendert.push('Anreicherung')
  return geaendert
}

/** KAN-186: Qualitätsspalten des Belegs (zukauf_posten) – nie ein Altwert; Traubenmost ohne gewähltes Erzeugnis = MOST */
function zukaufQualitaetsSpalten(f: ZukaufFormular): AR {
  const s = qualitaetsSpalten(f.qualitaet)
  return { ...s, erzeugnis: s.erzeugnis ?? (f.art === 'most' ? 'MOST' : null), land_iso: f.landIso }
}

/** Stammdaten, die die Zielcharge vom Zukauf übernimmt (ohne Menge und Gebinde).
 *  KAN-130 Etappe 3 (01.10.2026): auch das Mostgewicht samt Einheit – nur, wenn das Formular es
 *  übermittelt hat (sonst bliebe ein Formular ohne Feld nicht folgenlos). Aufgerufen wird das nur
 *  ohne Folgebuchungen an der Zielcharge (siehe updateZukauf) – nach Umzug, Verschnitt oder
 *  Zusammenführung bleibt das Mostgewicht der Charge unangetastet. */
function chargeStammdaten(f: ZukaufFormular): AR {
  return {
    rebsorte:                 f.rebsorte ?? null,
    jahrgang:                 f.jahrgang,
    einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
    weinart:                  f.weinart ?? 'unbekannt',
    ...qualitaetsSpalten(f.qualitaet),   // KAN-186: samt Zusatzbezeichnung und Erzeugnis
    land_iso:                 f.landIso,
    herkunft_code:            f.herkunft ?? null,   // KAN-80 Nachtrag (02.10.2026): Herkunfts-Code an die Charge
    ...(f.mostgewichtUebermittelt ? mostgewichtSpalten(f.mostgewicht, 'kmw') : {}),
  }
}

/** KAN-80 Nachtrag (02.10.2026, Entscheidungen Jörgen): alle Felder im Bereich Ware sind Pflicht, die Herkunft ist
 *  ein Herkunfts-Code (BKI) aus dem Katalog oder ein eigenes Weinbaugebiet des Betriebs (dieselbe Auswahl wie am GST),
 *  die Prüfnummer bleibt optional (Entscheidung Jörgen 02.10.2026). Vor dem ersten Schreibzugriff aufrufen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pruefeWare(supabase: any, tenantId: string, f: ZukaufFormular): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eigene, error } = await (supabase.from('weinbaugebiete_custom') as any)
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Eigene Weinbaugebiete konnten nicht geladen werden'))
  const fehler = zukaufWareFehler({
    art:             f.art,
    weinart:         f.weinart,
    rebsorte:        f.rebsorte,
    jahrgang:        f.jahrgangEingabe,
    qualitaetsstufe: f.qualitaetsstufe,
    herkunft:        f.herkunft,
    mostgewicht:     f.mostgewicht != null,
    alkohol:         f.alkohol,
  }, ((eigene ?? []) as AR[]).map(e => String(e.name ?? '')))
  if (fehler) throw new AktionsFehler(fehler)
  // KAN-208: Lieferant Pflicht – bei Wein, Most und Trauben aus Österreich mit Betriebsnummer
  const partner = await ladePartner(supabase, tenantId, f.lieferantKontaktId, f.lieferantFirmaId)
  const lf = zukaufLieferantFehler({ art: f.art, lieferant: partner.vorhanden, betriebNr: partner.betriebNr, landIso: f.landIso, lieferantName: partner.name })
  if (lf) throw new AktionsFehler(lf)
}

/** KAN-193: Rot-/Weißwein-Sperre vor dem Buchen – der Zukauf darf mit keiner Charge im Gebinde unverträglich sein
 *  (wie beim Umziehen; Chargen bzw. Zukauf ohne Weinart über die Rebsortenfarbe). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pruefeWeinartImGebinde(supabase: any, f: ZukaufFormular, imGebinde: AR[]): Promise<void> {
  if (imGebinde.length === 0) return
  const sorten = [...new Set([f.rebsorte, ...imGebinde.map(c => c.rebsorte)].filter(Boolean))] as string[]
  const farbe = new Map<string, string>()
  if (sorten.length) {
    // tenant-isolation-ignore: rebsorten ist eine globale Stammtabelle ohne tenant_id
    const { data: rs } = await (supabase.from('rebsorten') as any).select('name_de, farbe').in('name_de', sorten)
    for (const r of (rs ?? []) as AR[]) farbe.set(r.name_de, r.farbe)
  }
  const artVon = (weinart: string | null | undefined, rebsorte: string | null | undefined): string =>
    weinartBekannt(weinart) ? weinart : weinartAusFarbe(farbe.get(rebsorte ?? '') ?? bkiFarbe(rebsorte) ?? undefined)
  const zukaufArt = artVon(f.weinart, f.rebsorte)
  for (const c of imGebinde) {
    const art = artVon(c.weinart, c.rebsorte)
    if (weinartKonflikt(zukaufArt, art)) {
      throw new AktionsFehler(`${WEINART_LABEL[zukaufArt] ?? zukaufArt} und ${WEINART_LABEL[art] ?? art} dürfen laut Weingesetz nicht vermischt werden: Der Zukauf kann nicht in dieses Gebinde, dort liegt „${c.name ?? 'eine Charge'}“.`)
    }
  }
}

/** KAN-193: Spalten der Zukauf-Charge – p_charge der RPC und virtuelle Quelle des Verschnitts (Mostgewicht des Zukaufs
 *  als Momentaufnahme, KAN-130 Etappe 3: leer = beide NULL) */
function zukaufChargeSpalten(f: ZukaufFormular, behaelterId: string): AR {
  return {
    name:         f.rebsorte || 'Zukauf',
    behaelter_id: behaelterId,
    menge_liter:  f.menge,
    ...chargeStammdaten(f),
    ...mostgewichtSpalten(f.mostgewicht, 'kmw'),
  }
}

/** KAN-193: Ergebnis, wenn der Zukauf sofort als Verschnitt in die Charge im Gebinde gebucht wurde */
export type ZukaufVerschnitt = {
  verschneidungId: string | null
  zielChargeId: string | null
  zielName: string | null
  /** abweichende Merkmale (Rebsorte, Jahrgang, Herkunft, Qualität) */
  unterschiede: string[]
  qualitaetAbgestuft: { von: string; nach: string } | null
  herkunftAbgestuft: { von: string; nach: string } | null
  sortenHinweise: string[]
  /** Rot/Weiß verschnitten – auf Wein (aus Österreich) abgestuft */
  rotWeiss: boolean
}

// KAN-83: bestaetigung = Rückfrage „Prüfnummer gilt nicht mehr“ – nichts gebucht; mit pn_bestaetigt=1 erneut senden
// KAN-193 (03.10.2026, Folge von KAN-112): Zukauf-Charge und Beleg bucht EINE RPC (s112_zukauf_buchen) – kein manueller
// Rückbau mehr. Liegt im Gebinde Wein mit anderen Merkmalen (Rebsorte, Jahrgang, Herkunft, Qualität – dieselbe Regel wie
// beim Umziehen, waehleZielCharge), verschneidet dieselbe RPC die ganze Zukauf-Charge sofort in die Anker-Charge
// (keine zweite aktive Charge, keine Weiterleitung ins Verschneiden-Formular) – Ergebnis `verschnitt` für den Hinweis.
// Gleiche Merkmale bzw. leeres Gebinde: wie bisher eine eigene Zukauf-Charge im Gebinde (Weiterleitung zur Liste).
// Rot/Weiß (Entscheidung Jörgen 03.10.2026): als Verschnitt in die Anker-Charge nach Rückfrage mit Abstufung auf Wein
// (aus Österreich), rotweiss_bestaetigt=1; gegen jede andere Charge im Gebinde weiterhin abgelehnt.
export async function createZukauf(formData: FormData): Promise<{ bestaetigung?: string; verschnitt?: ZukaufVerschnitt } | void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId, darfKellerbuch } = await schreibKontext()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new AktionsFehler('Menge muss größer als 0 sein')
  await pruefeWare(supabase, tenantId, f)
  // KAN-41 Paket 2b: Flaschenzukauf → eigener Weinlager-Artikel (Füllung ohne Charge), angelegt von der RPC
  const flaschen = istFlaschenArt(f.art)
  if (flaschen) {
    const q = zukaufQualitaetsSpalten(f) as AR
    const ff = flaschenZukaufFehler({
      name: f.fuellungName, flaschengroesseMl: f.flaschengroesseMl, menge: f.menge, einheit: f.einheit,
      qualitaetsstufe: q.qualitaetsstufe ?? null, zusatzbezeichnung: q.zusatzbezeichnung ?? null, erzeugnis: q.erzeugnis ?? null,
      pruefnummer: f.pruefnummer,
    })
    if (ff) throw new AktionsFehler(ff)
  }

  const mitCharge = (f.art === 'wein' || f.art === 'most') && !!f.zielBehaelterId
  let imGebinde: AR[] = []
  // Rückfragen (Prüfnummer, Rot/Weiß) gesammelt in EINER bestaetigung – vorher wird nichts gebucht
  const fragen: string[] = []
  let pnNotiz: string | null = null
  if (mitCharge) {
    const { data, error: gErr } = await (supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, rebsorte, jahrgang, weinart, herkunft_code, qualitaetsstufe, zusatzbezeichnung, erzeugnis')
      .eq('behaelter_id', f.zielBehaelterId)
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
    if (gErr) throw new AktionsFehler(dbFehlerText(gErr, 'Chargen im Ziel-Gebinde konnten nicht geladen werden'))
    imGebinde = (data ?? []) as AR[]
    // KAN-83 (01.10.2026): Wein/Most in ein Gebinde, in dem eine Charge mit geltender Prüfnummer
    // liegt – der Tankbestand dieser Charge verliert die Nummer. Eingereichter Antrag: Ablehnung;
    // sonst erst nachfragen, nach der Bestätigung buchen und am Zukauf vermerken. VOR der ersten Buchung.
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'zukauf',
      imGebinde.map(c => ({ chargeId: String(c.id), name: (c.name as string | null) ?? null, zugangLiter: f.menge })), f.datum)
    if (pn && formData.get('pn_bestaetigt') !== '1') fragen.push(pn.frage)
    if (pn) pnNotiz = pn.notiz
  }

  // KAN-193: Zukauf-Charge (p_charge) und – bei abweichendem Wein im Gebinde – der Verschnitt in die Anker-Charge
  const charge = mitCharge ? zukaufChargeSpalten(f, f.zielBehaelterId as string) : null
  let verschnitt: { kopf: AR; hinweis: Omit<ZukaufVerschnitt, 'verschneidungId'> } | null = null
  if (charge) {
    const wahl = waehleZielCharge(imGebinde, [charge])
    const anker = wahl.istVerschnitt ? wahl.vorhanden : null
    // Rot/Weiß VOR jeder Buchung: gegen die Anker-Charge entscheidet der Verschnitt-Service (Rückfrage, Abstufung),
    // gegen jede andere Charge im Gebinde bleibt es eine Ablehnung
    await pruefeWeinartImGebinde(supabase, f, imGebinde.filter(c => c.id !== anker?.id))
    if (anker) {
      const abweichend = merkmaleText(wahl.unterschiede)
      if (!darfKellerbuch) {
        throw new AktionsFehler(`Im Gebinde liegt bereits „${anker.name ?? 'eine Charge'}“ (abweichend: ${abweichend}) – der Zukauf würde dorthin verschnitten, dafür fehlt die Schreibfreigabe für das Kellerbuch.`)
      }
      const v = await verschnittVorbereiten(supabase, tenantId, {
        datum: f.datum,
        ziel: { weinausbauId: anker.id as string },
        quellen: [],
        virtuelleQuelle: { charge, menge: f.menge },
        notizen: [`Zukauf als Verschnitt gebucht (abweichend: ${abweichend})`, pnNotiz].filter(Boolean).join('\n'),
        pnBestaetigt: true,   // die Prüfnummer-Rückfrage stellt oben der Zukauf (Art 'zukauf')
        rotWeissBestaetigt: formData.get('rotweiss_bestaetigt') === '1',
      })
      if ('bestaetigung' in v) {
        fragen.push(v.bestaetigung)
      } else {
        // Datum setzt die RPC aus dem Zukauf – nicht im Kopf
        const kopf: AR = { ...v.buchung.kopf }
        delete kopf.datum
        verschnitt = {
          kopf,
          hinweis: {
            zielChargeId: v.buchung.zielId, zielName: v.buchung.zielName, unterschiede: wahl.unterschiede,
            qualitaetAbgestuft: v.buchung.qualitaetAbgestuft, herkunftAbgestuft: v.buchung.herkunftAbgestuft,
            sortenHinweise: v.buchung.sortenHinweise, rotWeiss: v.buchung.rotWeiss,
          },
        }
      }
    }
  }
  if (fragen.length > 0) return { bestaetigung: fragen.join('\n') }
  if (pnNotiz) f.notizen = mitPnNotiz(f.notizen, pnNotiz)

  const { data: ergebnis, error } = await (supabase.rpc as any)('s112_zukauf_buchen', {
    p_tenant_id: tenantId,
    p_zukauf: {
      datum:                    f.datum,
      lieferung_uhrzeit:        f.lieferungUhrzeit,
      art:                      f.art,
      lieferant_kontakt_id:     f.lieferantKontaktId || null,
      lieferant_firma_id:       f.lieferantFirmaId   || null,
      zh_kontakt_id:            f.lieferantFirmaId ? (f.zhKontaktId || null) : null,
      eingangsrechnungsnummer: f.eingangsrechnungsnummer,
      ...f.tbs,
      transport_zugmaschine:    f.zugmaschine,
      transport_anhaenger1:     f.anhaenger1,
      transport_anhaenger2:     f.anhaenger2,
      weinart:                  f.weinart,
      rebsorte:                 f.rebsorte,
      ...zukaufQualitaetsSpalten(f),
      jahrgang:                 f.jahrgang,
      herkunft:                 f.herkunft,
      anreicherung:             f.anreicherung,
      // KAN-130 Etappe 3: °KMW, °Oe und gemessene Einheit (leer = beide NULL)
      ...mostgewichtSpalten(f.mostgewicht, 'kmw'),
      alkohol_pct:              f.alkohol,
      staatliche_pruefnummer:   f.pruefnummer,
      menge:                    f.menge,
      einheit:                  f.einheit,
      preis_gesamt:             f.preisGesamt ?? null,
      einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
      notizen:                  f.notizen,
    },
    p_charge: charge,
    p_verschnitt: verschnitt?.kopf ?? null,
    p_fuellung: flaschen
      ? { name: f.fuellungName, flaschengroesse_ml: f.flaschengroesseMl, vk_preis_brutto: f.vkPreisBrutto, mwst_pct: f.mwstPct }
      : null,
  })
  if (error) {
    // 40001: Bestand der Ziel-Charge seit der Berechnung geändert – Meldung der RPC („bitte erneut buchen“) unverändert
    const e = error as AR
    throw new AktionsFehler(e?.code === '40001' && e?.message ? String(e.message) : dbFehlerText(error, 'Zukauf konnte nicht gebucht werden'))
  }

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  // Rückmeldung Jörgen 07.10.2026: auch nach dem Flaschenzukauf zurück zur Zukaufsübersicht (nicht mehr zur Füllung)

  if (verschnitt) {
    const vs = (((ergebnis ?? {}) as AR).verschnitt ?? {}) as AR
    if (verschnitt.hinweis.zielChargeId) revalidatePath(`/kellerbuch/weinausbau/${verschnitt.hinweis.zielChargeId}`)
    return { verschnitt: { ...verschnitt.hinweis, verschneidungId: (vs.verschneidung_id as string | undefined) ?? null } }
  }
  // KAN-224: zurück, woher man kam (Standard Zukaufsübersicht), mit Bestätigung
  redirect(zielNachAbschluss(formData.get('zurueck'), '/weinhandel/zukauf', 'zukauf'))
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await schreibKontext()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new AktionsFehler('Menge muss größer als 0 sein')
  await pruefeWare(supabase, tenantId, f)

  const { data: alt, error: altErr } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id, menge, einheit, art, kmw, oechsle, mostgewicht_einheit, datum, weinart, rebsorte, jahrgang, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft, land_iso, alkohol_pct, anreicherung')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .maybeSingle()
  if (altErr) throw new AktionsFehler(dbFehlerText(altErr, 'Zukauf konnte nicht gelesen werden'))
  if (!alt) throw new AktionsFehler('Zukauf nicht gefunden – er wurde inzwischen gelöscht.')
  const a = alt as AR
  // KAN-130 Etappe 3: Mostgewicht einer neu angelegten Zielcharge – das übermittelte, sonst das
  // gespeicherte des Zukaufs (Messwert und Einheit wie gespeichert, nichts neu gerechnet)
  const mostgewichtCharge: Mostgewicht | null = f.mostgewichtUebermittelt
    ? f.mostgewicht
    : mostgewichtAusGespeichert({ kmw: a.kmw, oechsle: a.oechsle, einheit: a.mostgewicht_einheit })
  const altWeinausbauId: string | null = a.ziel_weinausbau_id ?? null
  const alteMenge        = Number(a.menge) || 0
  const mengeGeaendert   = Math.abs(f.menge - alteMenge) > TOLERANZ
  const einheitGeaendert = a.einheit != null && f.einheit !== a.einheit
  const artGeaendert     = f.art !== a.art
  const istWeinMost      = f.art === 'wein' || f.art === 'most'

  // KAN-41 Paket 2b: Flaschenzukauf – Art, Anzahl und Merkmale sind ab dem Speichern fest (wie der Weinlager-Artikel,
  // Trigger a_freeze); Korrektur: Zukauf stornieren (solange nichts verkauft ist) und neu erfassen
  let merkmaleFest = false
  if (istFlaschenArt(a.art) || istFlaschenArt(f.art)) {
    if (artGeaendert) {
      throw new AktionsFehler(istFlaschenArt(a.art)
        ? 'Die Art eines Flaschenzukaufs lässt sich nicht ändern – bitte den Zukauf stornieren und neu erfassen.'
        : 'Zugekaufte Flaschen bitte als neuen Zukauf erfassen – die Art eines bestehenden Zukaufs lässt sich nicht auf Flaschen ändern.')
    }
    const geaendert = [...(mengeGeaendert ? ['Anzahl'] : []), ...(einheitGeaendert ? ['Einheit'] : []), ...geaenderteMerkmale(a, f)]
    if (geaendert.length > 0) {
      throw new AktionsFehler(`Ändern von ${geaendert.join(', ')} ist nicht möglich: Der Flaschenzukauf ist bereits als Weinlager-Artikel gebucht. Korrektur: Zukauf stornieren (solange nichts verkauft ist) und neu erfassen – Beleg, Lieferant, Preis und Notizen bleiben änderbar.`)
    }
    merkmaleFest = true
  }

  // ── Trauben: Belegmenge nicht unter die verpressten/verkauften kg, Art nicht mehr wechseln ──
  // zukauf_posten.menge gilt dabei – wie in Erntemeldung und Traubenverkauf – als kg.
  if (mengeGeaendert || artGeaendert) {
    const v = await zukaufVerweise(supabase, id, tenantId)
    const gebunden = traubenGebundenText(v)
    if (gebunden && artGeaendert) {
      throw new AktionsFehler(`Ändern der Art ist nicht möglich: Aus diesem Zukauf sind bereits ${gebunden}. Bitte zuerst die Pressung in der Erntemeldung bzw. den Traubenverkauf ändern.`)
    }
    const gebundenKg = v.verpresstKg + v.verkauftKg
    if (gebunden && f.menge < alteMenge - TOLERANZ && f.menge < gebundenKg - TOLERANZ) {
      throw new AktionsFehler(`Die Zukaufsmenge kann nicht auf ${fmtNum(f.menge)} kg gesenkt werden: Aus diesem Zukauf sind bereits ${gebunden}, zusammen ${fmtNum(gebundenKg)} kg. Bitte zuerst die Pressung in der Erntemeldung bzw. den Traubenverkauf ändern.`)
    }
  }

  // ── Zielcharge ────────────────────────────────────────────────────────────────
  let zielWeinausbauId: string | null = altWeinausbauId
  // Rückbau der Chargen-Änderung, falls danach das Speichern des Zukaufs scheitert
  let rueckbau: (() => Promise<void>) | null = null
  // KAN-208: nach einer Folgebuchung an der Zielcharge sind die Merkmale des Belegs fest (wie der Trigger a_freeze)

  if (altWeinausbauId) {
    const chargeId = altWeinausbauId
    const folge = await folgebuchungenDerZielcharge(supabase, chargeId)
    const { data: charge, error: chErr } = await (supabase.from('weinausbau') as any)
      .select('behaelter_id, menge_liter, aktiv, status, rebsorte, jahrgang, einstandspreis_pro_liter, weinart, herkunft_code, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, kmw, oechsle, mostgewicht_einheit')
      .eq('id', chargeId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (chErr) throw new AktionsFehler(dbFehlerText(chErr, 'Charge des Zukaufs konnte nicht gelesen werden'))
    if (!charge) throw new AktionsFehler('Die Charge dieses Zukaufs wurde nicht gefunden.')
    const c = charge as AR
    const gebindeUnveraendert = (f.zielBehaelterId || null) === (c.behaelter_id ?? null)
    // Stand vor dem Speichern – für den Rückbau, falls danach der Zukauf nicht gespeichert werden kann
    const vorherStammdaten: AR = {
      rebsorte: c.rebsorte, jahrgang: c.jahrgang, einstandspreis_pro_liter: c.einstandspreis_pro_liter,
      weinart: c.weinart, qualitaetsstufe: c.qualitaetsstufe, herkunft_code: c.herkunft_code,
      zusatzbezeichnung: c.zusatzbezeichnung ?? null, erzeugnis: c.erzeugnis ?? null, land_iso: c.land_iso ?? 'AT',   // KAN-186
      // KAN-130 Etappe 3: Mostgewicht samt Einheit – beide Werte wie gespeichert zurück
      kmw: c.kmw, oechsle: c.oechsle, mostgewicht_einheit: c.mostgewicht_einheit,
    }
    const vorherBestand: AR = { menge_liter: c.menge_liter, status: c.status, aktiv: c.aktiv }

    if (folge.length > 0) {
      // Folgebuchungen: Beleg (Menge, Einheit), Gebinde und Art bleiben gesperrt. Die Stammdaten
      // der Charge (Rebsorte, Jahrgang, Weinart, Qualitätsstufe) werden NICHT mehr mitgezogen –
      // ein Verschnitt oder eine Zusammenführung kann sie inzwischen geändert (abgestuft) haben,
      // ein Überschreiben würde das still aufheben. Die Charge pflegt man im Kellerbuch.
      const text = zielchargeText(folge)
      // KAN-193: beim Buchen als Verschnitt in die Charge im Gebinde verschnitten – Änderungen nur über Storno und Neuerfassung
      const alsVerschnitt = folge.some(x => x.art === 'verschnitt_quelle')
      const sperre = (t: string) => new AktionsFehler(alsVerschnitt
        ? `${t} Wurde der Zukauf als Verschnitt gebucht: Änderungen an Menge, Einheit, Gebinde oder Art bitte über „Stornieren“ (der Verschnitt wird mit storniert) und eine neue Buchung.`
        : t)
      if (!istWeinMost) {
        throw sperre(`Ändern der Art ist nicht möglich: ${text}. Der Zukauf bleibt der Zugang dieser Charge.`)
      }
      if (!gebindeUnveraendert) {
        throw sperre(`${f.zielBehaelterId ? 'Ändern' : 'Entfernen'} des Gebindes ist nicht möglich: ${text}. Den Wein bitte im Kellerbuch über „Umziehen“ in ein anderes Gebinde bringen.`)
      }
      if (mengeGeaendert) {
        const hinweis = f.menge > alteMenge
          ? 'eine Mehrmenge bitte als eigenen Zukauf über die Differenz erfassen'
          : 'eine Mindermenge bitte in der Charge über „Schwund buchen“ erfassen'
        throw sperre(`Ändern der Zukaufsmenge ist nicht möglich: ${text}. Die Belegmenge bleibt als Zugang der Charge erhalten – ${hinweis}.`)
      }
      if (einheitGeaendert) {
        throw sperre(`Ändern der Einheit ist nicht möglich: ${text}. Die Belegmenge bleibt als Zugang der Charge erhalten.`)
      }
      // KAN-208: Merkmale (Datum, Weinart, Sorte, Jahrgang, Qualität, Herkunft, Land, Mostgewicht, Alkohol, Anreicherung) fest
      const geaendert = geaenderteMerkmale(a, f)
      if (geaendert.length > 0) {
        throw sperre(`Ändern von ${geaendert.join(', ')} ist nicht möglich: ${text}. Die Merkmale des Zukaufs gehören zum Zugang der Charge – Korrekturen über „Stornieren“ und eine neue Buchung bzw. durch die Betriebsleitung.`)
      }
      merkmaleFest = true
      // nur der Beleg wird gespeichert (unten) – die Charge bleibt unverändert
    } else if (istWeinMost && c.aktiv === false) {
      // Charge nicht mehr aktiv, aber ohne Folgebuchungen (z. B. vor KAN-35 im Chargenformular
      // auf 0 L gesetzt, weil die Ware retourniert wurde): KEINE neue Charge mit der vollen
      // Belegmenge anlegen – das wären Liter ohne Wein. Nur der Beleg wird gespeichert.
      if (mengeGeaendert || einheitGeaendert || !gebindeUnveraendert) {
        throw new AktionsFehler(
          `${mengeGeaendert || einheitGeaendert ? 'Ändern der Zukaufsmenge' : 'Ändern des Gebindes'} ist nicht möglich: Die Charge dieses Zukaufs ist nicht mehr aktiv ` +
          `(Bestand ${fmtNum(Number(c.menge_liter) || 0)} L). Bitte zuerst Charge und Bestand im Kellerbuch prüfen – ` +
          'die übrigen Angaben des Zukaufs (z. B. Rechnungsnummer, Notizen) lassen sich ohne diese Änderung speichern.'
        )
      }
      // nur der Beleg wird gespeichert (unten) – die Charge bleibt unverändert
    } else if (istWeinMost && gebindeUnveraendert) {
      // Keine Folgebuchungen, Gebinde unverändert: Charge bleibt, Belegänderung per Delta
      const bisher = Number(c.menge_liter) || 0
      const neu = runde(bisher + (f.menge - alteMenge))
      if (neu < 0) {
        throw new AktionsFehler(`Die Zukaufsmenge kann nicht auf ${fmtNum(f.menge)} ${f.einheit} gesenkt werden: Die Charge enthält nur noch ${fmtNum(bisher)} L, die Differenz von ${fmtNum(runde(alteMenge - f.menge))} L ist größer als dieser Bestand. Bitte den Bestand der Charge prüfen.`)
      }
      await chargeAendern(supabase, chargeId, tenantId, { ...chargeStammdaten(f), menge_liter: neu })
      rueckbau = () => chargeAendern(supabase, chargeId, tenantId, { ...vorherStammdaten, menge_liter: vorherBestand.menge_liter })
    } else {
      // Keine Folgebuchungen, aktive Charge, aber Gebinde gewechselt/entfernt oder Art jetzt
      // Trauben: bisherige Charge schließen (dieser Zukauf war ihr einziger Zugang, es ist nichts
      // abgegangen) und bei Wein/Most mit Gebinde eine neue Charge mit der vollen Belegmenge anlegen.
      const alteChargeZurueck = () => chargeAendern(supabase, chargeId, tenantId, vorherBestand)
      await bereinigCharge(supabase, chargeId, tenantId)
      zielWeinausbauId = null
      rueckbau = alteChargeZurueck
      if (istWeinMost && f.zielBehaelterId) {
        let neueId = ''
        try {
          neueId = await createZukaufCharge(
            supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaet, f.herkunft,
            mostgewichtCharge, f.landIso,
          )
        } catch (e) {
          await mitRueckbau(e, alteChargeZurueck)
        }
        zielWeinausbauId = neueId
        rueckbau = async () => {
          await bereinigCharge(supabase, neueId, tenantId)
          await alteChargeZurueck()
        }
      }
    }
  } else if (istWeinMost && f.zielBehaelterId) {
    // Nachträglich einem Gebinde zugeordnet: neue Charge mit der vollen Belegmenge
    // (Tankverkäufe direkt aus dem Zukauf gibt es nicht mehr – es ist nichts abzuziehen)
    const neueId = await createZukaufCharge(
      supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaet, f.herkunft,
      mostgewichtCharge, f.landIso,
    )
    zielWeinausbauId = neueId
    rueckbau = () => bereinigCharge(supabase, neueId, tenantId)
  }

  try {
    const zukaufPatch: AR = {
      datum:                    f.datum,
      lieferung_uhrzeit:        f.lieferungUhrzeit,
      art:                      f.art,
      lieferant_kontakt_id:     f.lieferantKontaktId || null,
      lieferant_firma_id:       f.lieferantFirmaId   || null,
      eingangsrechnungsnummer: f.eingangsrechnungsnummer,
      ...f.tbs,
      transport_zugmaschine:    f.zugmaschine,
      transport_anhaenger1:     f.anhaenger1,
      transport_anhaenger2:     f.anhaenger2,
      weinart:                  f.weinart,
      rebsorte:                 f.rebsorte,
      ...zukaufQualitaetsSpalten(f),
      jahrgang:                 f.jahrgang,
      herkunft:                 f.herkunft,
      anreicherung:             f.anreicherung,
      // KAN-130 Etappe 3: nur, wenn das Formular ein Mostgewicht mitschickt (leer = beide NULL)
      ...(f.mostgewichtUebermittelt ? mostgewichtSpalten(f.mostgewicht, 'kmw') : {}),
      alkohol_pct:              f.alkohol,
      staatliche_pruefnummer:   f.pruefnummer,
      menge:                    f.menge,
      einheit:                  f.einheit,
      preis_gesamt:             f.preisGesamt ?? null,
      einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
      notizen:                  f.notizen,
      ziel_weinausbau_id:       zielWeinausbauId,
    }
    // KAN-208: feste Merkmale nicht schreiben (der Trigger a_freeze lässt sie nicht durch; geprüft ist oben)
    if (merkmaleFest) for (const k of ZUKAUF_MERKMALE) delete zukaufPatch[k]
    const { data: upd, error } = await (supabase.from('zukauf_posten') as any).update(zukaufPatch).eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (zukauf_posten)'))
    if (!(upd as AR[] | null)?.length) throw new AktionsFehler('Der Zukauf konnte nicht gespeichert werden – Berechtigung prüfen.')
  } catch (e) {
    await mitRueckbau(e, rueckbau)
  }

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  // KAN-224: zurück, woher man kam (Standard Zukaufsübersicht), mit Bestätigung
  redirect(zielNachAbschluss(formData.get('zurueck'), '/weinhandel/zukauf', 'gespeichert'))
}

/** KAN-193: Verschnitt, mit dem dieser Zukauf beim Buchen in die Charge im Gebinde verschnitten wurde – nur, wenn er die
 *  EINZIGE Folgebuchung der Zukauf-Charge ist: ein nicht stornierter Verschnitt mit der Zukauf-Charge als Quelle, am
 *  Zukaufsdatum, über die ganze Zukaufsmenge. Sonst null (dann gilt die Sperre wie bisher). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verschnittDesZukaufs(supabase: any, tenantId: string, chargeId: string, zukauf: AR, folge: Folgebuchung[]): Promise<string | null> {
  if (folge.length !== 1 || folge[0].art !== 'verschnitt_quelle' || folge[0].anzahl !== 1) return null
  const { data, error } = await (supabase.from('verschneidung_quellen') as any)   // ohne tenant_id-Spalte, RLS über verschneidungen
    .select('verschneidung_id, menge_liter, verschneidung:verschneidung_id(id, datum, tenant_id, storniert_am)')
    .eq('quell_weinausbau_id', chargeId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Verschnitt des Zukaufs konnte nicht geladen werden'))
  const aktiv = ohneStornierteVerschnitte((data ?? []) as AR[]).filter(q => (q.verschneidung as AR | null)?.tenant_id === tenantId)
  if (aktiv.length !== 1) return null
  const q = aktiv[0]
  const v = q.verschneidung as AR
  const ganzeMenge = Math.abs((Number(q.menge_liter) || 0) - (Number(zukauf.menge) || 0)) <= 0.01
  return ganzeMenge && v.datum === zukauf.datum ? String(v.id) : null
}

// Stornieren (KAN-145 B3, 30.09.2026): aktiv = false wie bisher (alle Leser filtern aktiv) und zusätzlich das
// Storno-Kennzeichen mit Grund – der Zukauf bleibt als Beleg stehen. KAN-35: nur ohne Folgebuchungen an der Zielcharge und ohne
// Pressung/Traubenverkauf/Tankverkauf aus dem Zukauf – sonst verschwände ein Zugang
// rückwirkend, obwohl davon schon etwas abgegangen ist. Die Zielcharge wird vorher auf
// 0 L/abgeschlossen gesetzt (einziger Zugang war dieser Zukauf); scheitert danach das
// Deaktivieren, ist ein erneuter Versuch gefahrlos (Charge bleibt 0 L, keine Folgebuchungen).
// KAN-193: Wurde der Zukauf beim Buchen als Verschnitt in die Charge im Gebinde gebucht und ist das die einzige
// Folgebuchung, wird zuerst dieser Verschnitt mit demselben Grund storniert (Rückbuchung wie im Kellerbuch – gesperrt,
// wenn die Ziel-Charge seither bewegt wurde), danach der Zukauf wie bisher.
export async function deleteZukauf(id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const { tenantId, darfKellerbuch } = await schreibKontext()
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)

  const { data: zukauf, error: zErr } = await (supabase.from('zukauf_posten') as any)
    .select('id, ziel_weinausbau_id, datum, menge')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .maybeSingle()
  if (zErr) throw new AktionsFehler(dbFehlerText(zErr, 'Zukauf konnte nicht gelesen werden'))
  if (!zukauf) throw new AktionsFehler('Zukauf nicht gefunden – er wurde bereits gelöscht.')
  const weinausbauId: string | null = (zukauf as AR).ziel_weinausbau_id ?? null

  const sperre = loeschSperreText(await zukaufVerweise(supabase, id, tenantId))
  if (sperre) throw new AktionsFehler(sperre)

  if (weinausbauId) {
    let folge = await folgebuchungenDerZielcharge(supabase, weinausbauId)
    const verschneidungId = await verschnittDesZukaufs(supabase, tenantId, weinausbauId, zukauf as AR, folge)
    if (verschneidungId) {
      if (!darfKellerbuch) {
        throw new AktionsFehler('Stornieren nicht möglich: Der Zukauf wurde als Verschnitt gebucht – für das Stornieren des Verschnitts fehlt die Schreibfreigabe für das Kellerbuch.')
      }
      const plan = await planeVerschneidungStorno(supabase, tenantId, verschneidungId)
      await storniereVerschneidung(supabase, tenantId, plan, grund)
      const zielId = plan.verschneidung.ziel_weinausbau_id as string | null
      if (zielId) revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
      folge = await folgebuchungenDerZielcharge(supabase, weinausbauId)
    }
    if (folge.length > 0) {
      throw new AktionsFehler(`Löschen des Zukaufs ist nicht möglich: ${zielchargeText(folge)}. Der Zukauf ist der Zugang dieser Charge und bleibt als Beleg erhalten – Korrekturen bitte in der Charge als eigene, datierte Buchung erfassen (z. B. „Schwund buchen“).`)
    }
    await bereinigCharge(supabase, weinausbauId, tenantId)
  }

  const { data: upd, error } = await (supabase.from('zukauf_posten') as any)
    .update({ aktiv: false, storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Stornieren fehlgeschlagen (zukauf_posten)'))
  if (!(upd as AR[] | null)?.length) throw new AktionsFehler('Der Zukauf konnte nicht storniert werden – bereits storniert oder Berechtigung prüfen.')

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}
