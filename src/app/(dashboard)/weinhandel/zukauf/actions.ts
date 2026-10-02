'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AktionsFehler, dbFehlerText, fehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal, fmtNum } from '@/lib/format'
import { qualitaetFehler } from '@/lib/wein/qualitaet'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { mitPnNotiz } from '@/lib/kellerbuch/pruefnummer'
import { mostgewichtAusFormular, mostgewichtAusGespeichert, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
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
 *  klare Meldung statt eines still weggefilterten Updates. */
async function schreibKontext(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: vor den Rechten – sonst meldet ein veralteter Tab die Rechte des neuen Betriebs
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'warenwirtschaft')) {
    throw new AktionsFehler('Keine Berechtigung: Zukäufe erfassen, ändern und löschen dürfen nur Betriebs-Manager und Mitarbeiter mit Freigabe für die Warenwirtschaft.')
  }
  return membership.tenantId
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
  qualitaetsstufe: string | null,
  mostgewicht: Mostgewicht | null,
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
      qualitaetsstufe: qualitaetsstufe ?? null,
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
  const jahrgangEingabe = parseInt(dezimal(formData.get('jahrgang') as string))
  const jahrgang = !isNaN(jahrgangEingabe) ? jahrgangEingabe : (parseInt(datum.slice(0, 4)) || null)
  // KAN-73: die Stufe geht bei Wein/Most in die Zielcharge (weinausbau) – nur Werte des
  // CHECK weinausbau (QUALITAET_OPTS), sonst verständliche Meldung statt 23514
  const qualitaetsstufe = (formData.get('qualitaetsstufe') as string)?.trim() || null
  const qualitaetUnzulaessig = qualitaetFehler('charge', qualitaetsstufe)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  // KAN-130 Etappe 3 (01.10.2026): Mostgewicht aus Messwert und Einheit der Eingabe
  // (mostgewicht_wert/_einheit; übergangsweise das alte Feld kmw als °KMW), serverseitig gerechnet.
  // uebermittelt = false (Feld nicht im Formular, z. B. Art Wein): gespeicherte Werte bleiben.
  const mg = mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'kmw' })
  if (!mg.ok) throw new AktionsFehler(mg.fehler)
  return {
    datum,
    lieferungUhrzeit:    (formData.get('lieferung_uhrzeit')        as string)?.trim() || null,
    art:                 (formData.get('art')                      as string) || 'wein',
    lieferantKontaktId:  (formData.get('lieferant_kontakt_id')     as string) || null,
    lieferantFirmaId:    (formData.get('lieferant_firma_id')       as string) || null,
    // Nur beim Neuanlegen relevant – siehe createZukauf; updateZukauf lässt das Feld
    // bewusst unangetastet (Lieferant-Zuordnung ist nach dem Anlegen nicht mehr änderbar).
    zhKontaktId:         (formData.get('zh_kontakt_id')            as string) || null,
    eingangsrechnungsnummer: (formData.get('eingangsrechnungsnummer') as string)?.trim() || null,
    zugmaschine:         (formData.get('transport_zugmaschine')    as string)?.trim() || null,
    anhaenger1:          (formData.get('transport_anhaenger1')     as string)?.trim() || null,
    anhaenger2:          (formData.get('transport_anhaenger2')     as string)?.trim() || null,
    weinart:             (formData.get('weinart')                  as string) || 'unbekannt',
    rebsorte:            (formData.get('rebsorte')                 as string)?.trim() || null,
    qualitaetsstufe,
    jahrgang,
    herkunft:            (formData.get('herkunft')                 as string)?.trim() || null,
    anreicherung:        formData.get('anreicherung') === 'true',
    mostgewicht:         mg.wert,
    mostgewichtUebermittelt: mg.uebermittelt,
    alkohol:             parseFloat(dezimal(formData.get('alkohol_pct')    as string)) || null,
    pruefnummer:         (formData.get('staatliche_pruefnummer')   as string)?.trim() || null,
    menge:               parseFloat(dezimal(formData.get('menge')          as string)) || 0,
    einheit:             (formData.get('einheit')                  as string) || 'kg',
    preisGesamt:         parseFloat(dezimal(formData.get('preis_gesamt')   as string)) || null,
    einstandspreisLiter: parseFloat(dezimal(formData.get('einstandspreis_pro_liter') as string)) || null,
    notizen:             (formData.get('notizen')                  as string)?.trim() || null,
    zielBehaelterId:     (formData.get('ziel_behaelter_id')        as string) || null,
  }
}

type ZukaufFormular = ReturnType<typeof parseZukaufFormData>

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
    qualitaetsstufe:          f.qualitaetsstufe ?? null,
    ...(f.mostgewichtUebermittelt ? mostgewichtSpalten(f.mostgewicht, 'kmw') : {}),
  }
}

// KAN-83: bestaetigung = Rückfrage „Prüfnummer gilt nicht mehr“ – nichts gebucht; mit pn_bestaetigt=1 erneut senden
export async function createZukauf(formData: FormData): Promise<{ bestaetigung?: string } | void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await schreibKontext()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new AktionsFehler('Menge muss größer als 0 sein')

  // KAN-83 (01.10.2026): Wein/Most in ein Gebinde, in dem eine Charge mit geltender Prüfnummer
  // liegt – der Tankbestand dieser Charge verliert die Nummer. Eingereichter Antrag: Ablehnung;
  // sonst erst nachfragen, nach der Bestätigung buchen und am Zukauf vermerken. VOR der ersten Buchung.
  if ((f.art === 'wein' || f.art === 'most') && f.zielBehaelterId) {
    const { data: imGebinde, error: gErr } = await (supabase.from('weinausbau') as any)
      .select('id, name')
      .eq('behaelter_id', f.zielBehaelterId)
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
    if (gErr) throw new AktionsFehler(dbFehlerText(gErr, 'Chargen im Ziel-Gebinde konnten nicht geladen werden'))
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'zukauf',
      ((imGebinde ?? []) as AR[]).map(c => ({ chargeId: String(c.id), name: (c.name as string | null) ?? null, zugangLiter: f.menge })), f.datum)
    if (pn && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pn.frage }
    if (pn) f.notizen = mitPnNotiz(f.notizen, pn.notiz)
  }

  let zielWeinausbauId: string | null = null
  if ((f.art === 'wein' || f.art === 'most') && f.zielBehaelterId) {
    zielWeinausbauId = await createZukaufCharge(
      supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
      f.mostgewicht,
    )
  }
  // Scheitert der Beleg, die eben angelegte Charge wieder schließen (sonst Bestand ohne Zugang)
  const neueCharge = zielWeinausbauId
  const rueckbau = neueCharge ? () => bereinigCharge(supabase, neueCharge, tenantId) : null

  const { error } = await (supabase.from('zukauf_posten') as any)
    .insert({
      tenant_id:                tenantId,
      datum:                    f.datum,
      lieferung_uhrzeit:        f.lieferungUhrzeit,
      art:                      f.art,
      lieferant_kontakt_id:     f.lieferantKontaktId || null,
      lieferant_firma_id:       f.lieferantFirmaId   || null,
      zh_kontakt_id:            f.lieferantFirmaId ? (f.zhKontaktId || null) : null,
      eingangsrechnungsnummer: f.eingangsrechnungsnummer,
      transport_zugmaschine:    f.zugmaschine,
      transport_anhaenger1:     f.anhaenger1,
      transport_anhaenger2:     f.anhaenger2,
      weinart:                  f.weinart,
      rebsorte:                 f.rebsorte,
      qualitaetsstufe:          f.qualitaetsstufe,
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
      ziel_weinausbau_id:       zielWeinausbauId,
    })

  if (error) await mitRueckbau(new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (zukauf_posten)')), rueckbau)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')

  if (zielWeinausbauId && f.zielBehaelterId && f.rebsorte) {
    // Prüfung 1: Andere Rebsorte im Gebinde → Verschneidung (Sortenverschnitt)
    const { data: andereRebsorte } = await (supabase.from('weinausbau') as any)
      .select('id')
      .eq('behaelter_id', f.zielBehaelterId)
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .neq('id', zielWeinausbauId)
      .neq('rebsorte', f.rebsorte)
      .limit(1)
    if ((andereRebsorte as any[])?.length > 0) {
      const existierendeId = (andereRebsorte as any[])[0].id
      redirect(`/kellerbuch/weinausbau/${existierendeId}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${f.menge}`)
    }

    // Prüfung 2: Gleiche Rebsorte, andere Qualitätsstufe → Verschneidung (ggf. Abstufung)
    if (f.qualitaetsstufe) {
      const { data: gleicheRebsorte } = await (supabase.from('weinausbau') as any)
        .select('id, qualitaetsstufe')
        .eq('behaelter_id', f.zielBehaelterId)
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .neq('id', zielWeinausbauId)
        .eq('rebsorte', f.rebsorte)
        .not('qualitaetsstufe', 'is', null)
        .limit(10)
      const treffer = ((gleicheRebsorte as any[]) ?? []).find(
        (c: any) => c.qualitaetsstufe !== f.qualitaetsstufe
      )
      if (treffer) {
        redirect(`/kellerbuch/weinausbau/${treffer.id}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${f.menge}`)
      }
    }
  }

  redirect('/weinhandel/zukauf')
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await schreibKontext()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new AktionsFehler('Menge muss größer als 0 sein')

  const { data: alt, error: altErr } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id, menge, einheit, art, kmw, oechsle, mostgewicht_einheit')
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

  if (altWeinausbauId) {
    const chargeId = altWeinausbauId
    const folge = await folgebuchungenDerZielcharge(supabase, chargeId)
    const { data: charge, error: chErr } = await (supabase.from('weinausbau') as any)
      .select('behaelter_id, menge_liter, aktiv, status, rebsorte, jahrgang, einstandspreis_pro_liter, weinart, qualitaetsstufe, kmw, oechsle, mostgewicht_einheit')
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
      weinart: c.weinart, qualitaetsstufe: c.qualitaetsstufe,
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
      if (!istWeinMost) {
        throw new AktionsFehler(`Ändern der Art ist nicht möglich: ${text}. Der Zukauf bleibt der Zugang dieser Charge.`)
      }
      if (!gebindeUnveraendert) {
        throw new AktionsFehler(`${f.zielBehaelterId ? 'Ändern' : 'Entfernen'} des Gebindes ist nicht möglich: ${text}. Den Wein bitte im Kellerbuch über „Umziehen“ in ein anderes Gebinde bringen.`)
      }
      if (mengeGeaendert) {
        const hinweis = f.menge > alteMenge
          ? 'eine Mehrmenge bitte als eigenen Zukauf über die Differenz erfassen'
          : 'eine Mindermenge bitte in der Charge über „Schwund buchen“ erfassen'
        throw new AktionsFehler(`Ändern der Zukaufsmenge ist nicht möglich: ${text}. Die Belegmenge bleibt als Zugang der Charge erhalten – ${hinweis}.`)
      }
      if (einheitGeaendert) {
        throw new AktionsFehler(`Ändern der Einheit ist nicht möglich: ${text}. Die Belegmenge bleibt als Zugang der Charge erhalten.`)
      }
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
            supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
            mostgewichtCharge,
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
      supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
      mostgewichtCharge,
    )
    zielWeinausbauId = neueId
    rueckbau = () => bereinigCharge(supabase, neueId, tenantId)
  }

  try {
    const { data: upd, error } = await (supabase.from('zukauf_posten') as any).update({
      datum:                    f.datum,
      lieferung_uhrzeit:        f.lieferungUhrzeit,
      art:                      f.art,
      lieferant_kontakt_id:     f.lieferantKontaktId || null,
      lieferant_firma_id:       f.lieferantFirmaId   || null,
      eingangsrechnungsnummer: f.eingangsrechnungsnummer,
      transport_zugmaschine:    f.zugmaschine,
      transport_anhaenger1:     f.anhaenger1,
      transport_anhaenger2:     f.anhaenger2,
      weinart:                  f.weinart,
      rebsorte:                 f.rebsorte,
      qualitaetsstufe:          f.qualitaetsstufe,
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
    }).eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (zukauf_posten)'))
    if (!(upd as AR[] | null)?.length) throw new AktionsFehler('Der Zukauf konnte nicht gespeichert werden – Berechtigung prüfen.')
  } catch (e) {
    await mitRueckbau(e, rueckbau)
  }

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel/zukauf')
}

// Stornieren (KAN-145 B3, 30.09.2026): aktiv = false wie bisher (alle Leser filtern aktiv) und zusätzlich das
// Storno-Kennzeichen mit Grund – der Zukauf bleibt als Beleg stehen. KAN-35: nur ohne Folgebuchungen an der Zielcharge und ohne
// Pressung/Traubenverkauf/Tankverkauf aus dem Zukauf – sonst verschwände ein Zugang
// rückwirkend, obwohl davon schon etwas abgegangen ist. Die Zielcharge wird vorher auf
// 0 L/abgeschlossen gesetzt (einziger Zugang war dieser Zukauf); scheitert danach das
// Deaktivieren, ist ein erneuter Versuch gefahrlos (Charge bleibt 0 L, keine Folgebuchungen).
export async function deleteZukauf(id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await schreibKontext()
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)

  const { data: zukauf, error: zErr } = await (supabase.from('zukauf_posten') as any)
    .select('id, ziel_weinausbau_id')
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
    const folge = await folgebuchungenDerZielcharge(supabase, weinausbauId)
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
