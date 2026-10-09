'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { revalidatePath } from 'next/cache'
import { qualitaetText } from '@/lib/weinqualitaet'
import {
  istAufwertungQualitaet, istAbstufungQualitaet, normalisiereQualitaet, fuellungsQualitaetsSpalten, type QualitaetsAngabe,
} from '@/lib/wein/qualitaetsrang'
import { qualitaetFehler, qualitaetsAngabeAusFormular, qualitaetsAngabeFehler } from '@/lib/wein/qualitaet'
import { herkunftZulaessig, istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { getCurrentMembership, canWrite, type Membership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { dezimal, zahlAus, fmtNum } from '@/lib/format'
import { folgebuchungenDerFuellung, folgebuchungenFuellungText, heuteOrtsdatum, datumDe } from './fuellungen/folgebuchungen'
import { BEWEGUNGSARTEN, istBewegungsart } from './fuellungen/bewegungsarten'
import { spaetereMengenbewegungen } from '@/lib/kellerbuch/storno'
import { folgebuchungenText } from '@/lib/kellerbuch/folgebuchungen'
import { KORREKTUR_NACH_OBEN_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { ladePruefnummerDaten, pruefnummerBeiChargenzuordnung, pruefnummerFuerFuellung } from '@/lib/kellerbuch/pruefnummerLaden'
import { ersatzPruefnummer, fuellungDatumText, fuellungDatumVerletzung, pnTag, pruefnummerAusAntrag } from '@/lib/kellerbuch/pruefnummer'
import { freezeSperreAus, sperrMeldung } from '@/lib/freeze/sperre'
import { merkmaleAusCharge } from '@/lib/wein/fuellungMerkmale'
import { wienHeute } from '@/lib/csv'
import { istLagenrein, istSektStufe, sektStufeFehler, tirageAusFormular, type SektStufe } from '@/lib/wein/sekt'
import { resolveBlendKompositionFuellung } from '@/lib/wein/blendKomposition'
import { eroeffnungsStichtagFehler, IMPORT_QUELLE_EROEFFNUNG } from '@/lib/kellerbuch/eroeffnungsStichtag'
import { eroeffnungsVermerk, flaschenFormularWerte, pruefeFlaschenZeilen, type DateiBefund, type FlaschenEingabe } from '@/lib/import/eroeffnungsbestand'
import { fuellungNameFehler } from '@/lib/handel/partnerPflicht'
import { etikettierenFehler, unetikettiertFehler } from '@/lib/handel/etikettierung'
import { losnummerFehler } from '@/lib/handel/losnummer'
import { rund } from '@/lib/zahl/runden'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── KAN-35 (24.09.2026): Datenintegrität Füllung/Schwund ──────────────────────
// - Liter-Schwund nur noch als datierte Zeile über rpc('schwund_buchen'), nie mehr
//   durch direktes Überschreiben von weinausbau.menge_liter.
// - Flaschenbestand außerhalb von Verkauf/Storno nur noch über
//   rpc('fuellung_bestand_buchen') (datierte Zeile in fuellung_bewegungen).
// - Keine stillen Mengenänderungen: Überabfüllung wird abgelehnt statt auf 0 gekappt,
//   Charge-Updates prüfen Fehler UND „0 Zeilen“ (RLS-gefiltert bzw. zwischenzeitlich
//   geändert).
// - Sperren statt Überschreiben: Anzahl/Füllmenge einer Füllung mit Verkäufen oder
//   Bestandsbuchungen sind fest; Löschen ist dann ebenfalls gesperrt.

/** Rundungstoleranz: weinausbau/keller_umzuege speichern numeric(10,2) */
const RUNDUNG = 0.005
const r2 = (x: number) => rund(x, 2)
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

async function getMembership(): Promise<Membership> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership
}

// Schreibrechte wie die RLS-Modulprüfung (Migration 218): fuellungen, fuellung_chargen und
// keller_umzuege verlangen Kellerbuch ODER Warenwirtschaft, weinausbau Kellerbuch ODER Rieden.
// Vorab prüfen: ein per RLS gefiltertes UPDATE ändert still 0 Zeilen (früher: Füllung
// angelegt, Charge aber nicht gemindert).
function pruefeFuellungsRecht(m: Membership) {
  if (!(canWrite(m, 'kellerbuch') || canWrite(m, 'warenwirtschaft'))) {
    throw new AktionsFehler('Keine Berechtigung für Füllungen – dafür ist das Modul Kellerbuch oder Warenwirtschaft nötig.')
  }
}
function pruefeChargenRecht(m: Membership) {
  if (!(canWrite(m, 'kellerbuch') || canWrite(m, 'rieden'))) {
    throw new AktionsFehler('Keine Berechtigung, den Bestand der Kellerbuch-Charge zu ändern – dafür ist das Modul Kellerbuch (oder Rieden) nötig.')
  }
}

/** Qualitätsbezeichnung einer Füllung aus dem Formular (KAN-73): Pflichtfeld (fuellungen.qualitaet
 *  ist NOT NULL) und nur Werte des CHECK fuellungen (FUELLUNG_QUALITAETEN) – verständliche Meldung
 *  statt 23502/23514, vor jedem Schreibzugriff. */
function fuellungQualitaetAusFormular(formData: FormData): QualitaetsAngabe {
  // KAN-186: samt Zusatzbezeichnung und Erzeugnis; ein Altwert (reserve, sekt …) wird normalisiert
  const angabe = qualitaetsAngabeAusFormular(formData, 'qualitaet')
  if (!angabe.stufe) throw new AktionsFehler('Bitte eine Qualitätsbezeichnung für die Füllung wählen.')
  const fehler = qualitaetFehler('fuellung', angabe.stufe)
  if (fehler) throw new AktionsFehler(fehler)
  const angabeFehler = qualitaetsAngabeFehler(angabe)
  if (angabeFehler) throw new AktionsFehler(angabeFehler)
  return angabe
}

/** Notiz der Abschluss-Schwundzeile einer Füllung (deactivateFuellung erkennt sie am Anfang) */
const ABFUELL_SCHWUND_NOTIZ = 'Schwund bei Abfüllung'

/**
 * Wurde die Füllmenge dieser Füllung von der Charge abgebucht? Nur dann gibt es die
 * Verknüpfung fuellung_chargen (createFuellung). Eine nachträglich zugeordnete Charge
 * (Datenimport, frühere Füllungen ohne Charge) wurde nie gemindert. Liefert die
 * abgebuchten Liter oder null.
 */
async function abgebuchteLiter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  fuellungId: string,
  weinausbauId: string,
): Promise<number | null> {
  const { data, error } = await (supabase.from('fuellung_chargen') as any)
    .select('anteil_liter')
    .eq('fuellung_id', fuellungId)
    .eq('weinausbau_id', weinausbauId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Chargen-Verknüpfung konnte nicht geladen werden'))
  return data ? r2(Number((data as AR).anteil_liter ?? 0) || 0) : null
}

type ChargeErgebnis = { ok: true } | { ok: false; code: string; meldung: string }

/**
 * Charge ändern – nur, wenn menge_liter noch dem gelesenen Wert entspricht (kein Lost
 * Update gegenüber parallelen Verkäufen/Umzügen). Liefert Fehler statt zu werfen, damit
 * der Aufrufer den Zusammenhang (Abfüllen, Löschen, Zurücksetzen) in die Meldung schreibt.
 */
async function chargeAktualisieren(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  chargeId: string,
  mengeVorher: unknown,
  werte: AR,
): Promise<ChargeErgebnis> {
  let q = (supabase.from('weinausbau') as any).update(werte).eq('id', chargeId).eq('tenant_id', tenantId)
  q = mengeVorher == null ? q.is('menge_liter', null) : q.eq('menge_liter', mengeVorher)
  const { data, error } = await q.select('id')
  if (error) return { ok: false, code: String((error as AR).code ?? ''), meldung: dbFehlerText(error, 'Speichern fehlgeschlagen (weinausbau)') }
  if (!data || (data as AR[]).length === 0) {
    return { ok: false, code: 'KONFLIKT', meldung: 'Der Bestand der Charge wurde zwischenzeitlich geändert – bitte die Seite neu laden und erneut versuchen.' }
  }
  return { ok: true }
}

// Neue Füllung anlegen

/** KAN-80: Meldung für eine abgelehnte Aufwertung der Füllung gegenüber der Charge */
function aufwertungText(charge: QualitaetsAngabe, neu: QualitaetsAngabe): string {
  return `Die Füllung kann nicht als „${qualitaetText(neu)}“ gefüllt werden, die Charge ist „${qualitaetText(charge)}“ – nur gleich oder niedriger (Abstufen) ist zulässig.`
}

/** KAN-186: Vermerk, wenn die Füllung unter der Charge liegt (Stufe, Zusatzbezeichnung oder Erzeugnis) */
function abstufungsVermerk(charge: QualitaetsAngabe, neu: QualitaetsAngabe): string {
  return istAbstufungQualitaet(charge, neu) ? `Qualität manuell abgestuft von ${qualitaetText(charge)} auf ${qualitaetText(neu)}. ` : ''
}

export async function createFuellung(formData: FormData): Promise<{ id: string; hinweis?: string }> {
  return fuellungAnlegen(formData, null)
}

/** KAN-42: Füllung als Flaschen-Eröffnungsbestand – ohne Charge, Datum = Stichtag, Kennzeichen import_quelle */
type FlaschenEroeffnung = { weinart: string | null; landIso: string; importiertAm: string }

// Kernlogik des Füllungsformulars (createFuellung) – seit KAN-42 auch für den Import „Eröffnungsbestand Flaschen“
// (importiereEroeffnungFlaschen); nicht exportiert, damit `eroeffnung` nie aus dem Browser kommt.
async function fuellungAnlegen(formData: FormData, eroeffnung: FlaschenEroeffnung | null): Promise<{ id: string; hinweis?: string }> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  // KAN-208: Produktname Pflicht (vor jedem Schreibzugriff)
  { const nf = fuellungNameFehler(formData.get('name')); if (nf) throw new AktionsFehler(nf) }

  const weinausbauId    = (formData.get('weinausbau_id') as string) || null
  if (eroeffnung && weinausbauId) throw new AktionsFehler('Ein Flaschen-Eröffnungsbestand hat keine Kellerbuch-Charge.')
  // KAN-84 (Jörgen, 25.09.2026): eine Füllung aus eigener Produktion braucht immer eine Charge – ohne Charge nur der
  // Flaschen-Eröffnungsbestand (Import) und später zugekaufte Flaschenware
  if (!eroeffnung && !weinausbauId) {
    throw new AktionsFehler('Bitte die Kellerbuch-Charge wählen – eine Füllung aus eigener Produktion braucht immer eine Charge. Flaschen ohne Charge (Eröffnungsbestand) bitte über den Import „Eröffnungsbestand Flaschen“ erfassen.')
  }
  const anzahl          = parseInt(dezimal(formData.get('anzahl_flaschen') as string))
  // KAN-41 Paket 3d: unetikettiert abgefüllte Flaschen (leer = alle etikettiert)
  const unetikettiertText = String(formData.get('anzahl_unetikettiert') ?? '').trim()
  const unetikettiert = unetikettiertText ? Number(dezimal(unetikettiertText)) : null
  const flGroesseML     = parseInt(dezimal(formData.get('flaschengroesse_ml') as string)) || 750
  const mengeFormular   = parseFloat(dezimal(formData.get('menge_liter_gefuellt') as string)) || null
  // Falls kein Literfeld ausgefüllt: aus Flaschenzahl berechnen. Auf 2 Stellen gerundet wie
  // fuellungen.menge_liter_gefuellt (numeric(10,2)) – Abbuchung von der Charge, gespeicherte
  // Füllmenge und fuellung_chargen.anteil_liter sind so identisch.
  let mengeGefuellt     = r2(mengeFormular ?? (anzahl * flGroesseML / 1000))
  // KAN-232: Rückkehr aus der Lohnversektung – menge_liter_gefuellt = Grundwein-Anteil (nicht der Flascheninhalt);
  // letzte Lieferung = der ganze Rest der Charge (unten, nach dem Laden der Charge)
  const lohnversektungId = (formData.get('lohnversektung_id') as string | null)?.trim() || null
  const letzteLieferung = formData.get('letzte_lieferung') === 'true'
  if (lohnversektungId && eroeffnung) throw new AktionsFehler('Ein Flaschen-Eröffnungsbestand kann keine Rückkehr aus der Lohnversektung sein.')
  const datum           = ((formData.get('datum') as string) || '').slice(0, 10)

  if (!Number.isInteger(anzahl) || anzahl <= 0) {
    throw new AktionsFehler('Bitte die Anzahl der gefüllten Flaschen angeben (ganze Zahl größer als 0).')
  }
  if (!(mengeGefuellt > 0)) throw new AktionsFehler('Die abgefüllte Menge muss größer als 0 L sein.')
  const unetikettiertFehlerText = unetikettiertFehler(unetikettiert == null || Number.isNaN(unetikettiert) ? (unetikettiertText ? Number.NaN : null) : unetikettiert, anzahl)
  if (unetikettiertFehlerText) throw new AktionsFehler(unetikettiertFehlerText)
  if (!DATUM_RE.test(datum)) throw new AktionsFehler('Bitte ein gültiges Abfülldatum angeben.')

  const qualitaetInput     = fuellungQualitaetAusFormular(formData)
  // KAN-190: Sekt g.U. – Tirage (Beginn der Zweitgärung) und Gärmethode, vor jedem Schreibzugriff geprüft
  const tirage = tirageAusFormular(formData.get('gaermethode'), formData.get('tirage_datum'), qualitaetInput.erzeugnis ?? null, datum, wienHeute())
  if ('fehler' in tirage) throw new AktionsFehler(tirage.fehler)
  const herkunftCodeInput  = (formData.get('herkunft_code') as string) || null
  let notizenZusatz = ''
  let charge: AR | null = null
  // KAN-84: Jahrgang und Rebsorte kommen aus der Charge (Formular bzw. Assistent nur ohne Wert an der Charge)
  let jahrgang: number | null = parseInt(dezimal(formData.get('jahrgang') as string)) || null
  let rebsorte: string | null = ((formData.get('rebsorte') as string | null) ?? '').trim() || null
  const vorabHinweise: string[] = []

  // KAN-232: Lohnversektung prüfen (offen, eigener Betrieb, dieselbe Charge) – die DB prüft dasselbe im Trigger
  if (lohnversektungId) {
    const { data: lv, error: lvErr } = await (supabase.from('lohnversektungen') as AR)
      .select('id, weinausbau_id, storniert_am, abgeschlossen_am').eq('id', lohnversektungId).eq('tenant_id', tenantId).maybeSingle()
    if (lvErr) throw new AktionsFehler(dbFehlerText(lvErr, 'Lohnversektung konnte nicht geladen werden'))
    const l = lv as AR | null
    if (!l) throw new AktionsFehler('Die Lohnversektung wurde nicht gefunden.')
    if (l.storniert_am || l.abgeschlossen_am) throw new AktionsFehler('Diese Lohnversektung ist storniert bzw. abgeschlossen – keine weitere Rückkehr möglich.')
    if (l.weinausbau_id !== weinausbauId) throw new AktionsFehler('Die Rückkehr muss aus der versandten Grundwein-Charge gebucht werden.')
  }

  // Bestandsprüfung VOR jedem Schreibzugriff: nicht mehr füllen als die Charge hat
  // + Downgrade-only-Prüfung: 'Qualitätswein' und 'Herkunft-Code (BKI)' dürfen beim Füllen nur
  // abgestuft, NIEMALS aufgestuft werden gegenüber der verknüpften Kellerbuch-Charge (hart blockiert).
  if (weinausbauId) {
    pruefeChargenRecht(membership)
    const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
      .select('name, menge_liter, status, aktiv, jahrgang, rebsorte, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
    if (!wa) throw new AktionsFehler('Die gewählte Kellerbuch-Charge wurde nicht gefunden.')
    charge = wa as AR
    const ab = merkmaleAusCharge({ jahrgang, rebsorte }, { jahrgang: charge.jahrgang ?? null, rebsorte: charge.rebsorte ?? null })
    jahrgang = ab.jahrgang
    rebsorte = ab.rebsorte
    if (ab.hinweis) vorabHinweise.push(ab.hinweis)

    // KAN-35: keine Toleranz mehr – bisher wurde bis zu einer Flasche mehr angenommen und die
    // Charge danach still auf 0 gekappt (die Füllung trug dann mehr Liter, als abgebucht wurden).
    const verfuegbar = Number(charge.menge_liter ?? 0) || 0
    // KAN-232: letzte Lieferung aus der Lohnversektung bucht den ganzen Rest des Grundweins ab
    if (lohnversektungId && letzteLieferung) mengeGefuellt = r2(verfuegbar)
    if (!(mengeGefuellt > 0)) throw new AktionsFehler('Der Grundwein-Anteil muss größer als 0 L sein.')
    if (mengeGefuellt > verfuegbar + RUNDUNG) {
      throw new AktionsFehler(
        `Abfüllmenge (${fmtNum(mengeGefuellt, 2)} L) übersteigt den Bestand der Charge „${charge.name}“ (${fmtNum(verfuegbar, 2)} L). ` +
        `Bitte Flaschenzahl bzw. Füllmenge prüfen. Ist tatsächlich mehr Wein vorhanden: ${KORREKTUR_NACH_OBEN_HINWEIS}`
      )
    }

    const chargeQualitaet = normalisiereQualitaet(charge)   // KAN-186: Altwerte normalisiert
    const chargeHerkunft  = charge.herkunft_code as string | null ?? null

    // KAN-80: eine Rangfolge (KAN-74) – Landwein → DAC ist eine Aufwertung; KAN-186: ebenso eine neue bzw. höhere
    // Zusatzbezeichnung (Charge Qualitätswein → Füllung Reserve)
    if (istAufwertungQualitaet(chargeQualitaet, qualitaetInput)) {
      throw new AktionsFehler(aufwertungText(chargeQualitaet, qualitaetInput))
    }
    // KAN-111: nur die Herkunft der Charge oder eine breitere Stufe – auch kein Wechsel in einen anderen Ast und
    // bei eigenen Weinbaugebieten nur dieses oder „Wein aus Österreich“ (bisher dort keine Prüfung)
    if (!herkunftZulaessig(chargeHerkunft, herkunftCodeInput)) {
      throw new AktionsFehler(
        `Herkunft-Code (BKI) ${HERKUNFT_LABEL[herkunftCodeInput as string] ?? herkunftCodeInput} ist für die Charge (${HERKUNFT_LABEL[chargeHerkunft as string] ?? chargeHerkunft}) nicht zulässig. Nur die Herkunft der Charge oder eine Abstufung ist möglich.`
      )
    }
    notizenZusatz += abstufungsVermerk(chargeQualitaet, qualitaetInput)
    if (herkunftCodeInput && chargeHerkunft && herkunftCodeInput !== chargeHerkunft && herkunftIstNiedrigerAls(herkunftCodeInput, chargeHerkunft)) {
      notizenZusatz += `Herkunft-Code (BKI) manuell abgestuft von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput}. `
    }
  }

  // KAN-72: Prüfnummer und DAC-Antrag VOR jedem Schreibzugriff klären – nie ungeprüft aus dem
  // Formular: mit DAC-Antrag kommt die Nummer aus dem Antrag der gewählten Charge (fremder oder
  // nicht passender Antrag → Fehler), ohne Antrag nur eine geprüfte freie Eingabe
  const { pruefnummer, dacAntragId } = await pruefnummerFuerFuellung(supabase, tenantId, {
    dacAntragId: String(formData.get('dac_antrag_id') ?? '').trim() || null,
    pruefnummer: String(formData.get('pruefnummer') ?? '').trim() || null,
  }, { weinausbauId, chargeName: (charge?.name as string | undefined) ?? null, abfuelldatum: datum })

  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz.trim()].filter(Boolean).join('\n') : notizenInput

  // KAN-92: eigene Los-/Chargennummer nur mit gültigem Format und je Betrieb eindeutig (die DB sichert per UNIQUE ab)
  let chargennummer = String(formData.get('chargennummer') ?? '').trim() || null
  const losFehler = losnummerFehler(chargennummer)
  if (losFehler) throw new AktionsFehler(losFehler)
  if (chargennummer) {
    const { count, error: dupErr } = await (supabase.from('fuellungen') as AR)
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('chargennummer', chargennummer)
    if (dupErr) throw new AktionsFehler(dbFehlerText(dupErr, 'Los-/Chargennummer konnte nicht geprüft werden'))
    if ((count ?? 0) > 0) throw new AktionsFehler(`Die Los-/Chargennummer „${chargennummer}“ gibt es in diesem Betrieb schon – bitte eine andere wählen oder leer lassen.`)
  }
  if (!chargennummer) {
    const { data: nr, error: nrErr } = await (supabase.rpc as any)('get_next_chargennummer', { p_tenant_id: tenantId })
    if (nrErr) throw new AktionsFehler(dbFehlerText(nrErr, 'Chargennummer konnte nicht vergeben werden'))
    chargennummer = (nr as string) ?? null
  }

  // 1. Charge mindern – VOR dem Anlegen der Füllung: scheitert es (paralleler Verkauf/Umzug,
  //    Gebinde-Prüfung), bleibt nichts halb gebucht zurück.
  //    Abschluss (Rest ≤ 0,01 L oder angehakt): Rest ≥ 0,01 L bucht schwund_buchen unten als
  //    datierte Schwundzeile aus und schließt ab; ein Rest < 0,01 L wird direkt abgeschlossen.
  let schwundLiter = 0
  let chargeVorher: AR | null = null
  let mengeNachher: number | null = null
  if (weinausbauId && charge) {
    const verfuegbar   = Number(charge.menge_liter ?? 0) || 0
    const differenz    = r2(verfuegbar - mengeGefuellt)   // ≥ −0,005 L laut Prüfung oben
    const rest         = differenz > 0 ? differenz : 0
    // KAN-232: bei der Rückkehr aus der Lohnversektung nie Rest als Schwund ausbuchen (Differenz = Dosage/Verluste im Journal)
    const abschliessen = !lohnversektungId && formData.get('abschliessen') === 'true'
    const wirdAbgeschlossen = rest <= 0.01 || abschliessen
    schwundLiter = wirdAbgeschlossen && rest >= 0.01 ? rest : 0

    const werte: AR = !wirdAbgeschlossen
      ? { menge_liter: rest, status: 'abfuellung', aktiv: true }
      : schwundLiter > 0
        ? { menge_liter: rest }                                   // Abschluss übernimmt schwund_buchen
        : { menge_liter: 0, status: 'abgeschlossen', aktiv: false }
    const r = await chargeAktualisieren(supabase, tenantId, weinausbauId, charge.menge_liter, werte)
    if (!r.ok) throw new AktionsFehler(`Abfüllen fehlgeschlagen – die Charge „${charge.name}“ konnte nicht gemindert werden: ${r.meldung}`)
    chargeVorher = { menge_liter: charge.menge_liter ?? null, status: charge.status, aktiv: charge.aktiv }
    mengeNachher = werte.menge_liter as number
  }

  // 2. Füllung anlegen
  const payload: AR = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    name:                 String(formData.get('name')).trim(),
    jahrgang,             // KAN-84: aus der Charge
    rebsorte,
    ...fuellungsQualitaetsSpalten(qualitaetInput),   // KAN-73/KAN-186: geprüft (fuellungQualitaetAusFormular)
    ...tirage.spalten,   // KAN-190: Tirage und Gärmethode (nur Sekt g.U.)
    herkunft_code:        herkunftCodeInput,
    anbaugebiet:          (formData.get('anbaugebiet') as string) || null,
    bezeichnung:          (formData.get('bezeichnung') as string) || null,
    datum,
    flaschengroesse_ml:   flGroesseML,
    anzahl_flaschen:      anzahl,
    bestand_flaschen:     anzahl,
    // KAN-41 Paket 3d: davon unetikettiert abgefüllt (bestand_unetikettiert setzt der Trigger a_etikett_bestand)
    anzahl_unetikettiert: unetikettiert ?? 0,
    menge_liter_gefuellt: mengeGefuellt,
    pruefnummer,          // KAN-72: aus dem geprüften Antrag bzw. geprüfte freie Eingabe
    dac_antrag_id:        dacAntragId,
    lohnversektung_id:    lohnversektungId,   // KAN-232: Journal LNSKT/LNSKT_ZU statt FUELLUNG
    chargennummer,
    vk_preis_brutto:      parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    einstandspreis:       parseFloat(dezimal(formData.get('einstandspreis') as string)) || null,
    zolltarifnummer:      (formData.get('zolltarifnummer') as string) || null,
    notizen:              notizen,
    // KAN-42: Flaschen-Eröffnungsbestand – Weinart/Land der Zeile und Kennzeichen für Berichte (Zugang am Stichtag)
    ...(eroeffnung ? {
      weinart:       eroeffnung.weinart ?? 'unbekannt',
      land_iso:      eroeffnung.landIso,
      import_quelle: IMPORT_QUELLE_EROEFFNUNG,
      importiert_am: eroeffnung.importiertAm,
    } : {}),
  }

  const { error, data: fuellungData } = await (supabase.from('fuellungen') as any)
    .insert(payload).select('id').single()
  if (error || !(fuellungData as AR | null)?.id) {
    const meldung = dbFehlerText(error, 'Speichern fehlgeschlagen (fuellungen)')
    // Abbuchung zurücknehmen – die Füllung gibt es nicht
    if (weinausbauId && chargeVorher) {
      const r = await chargeAktualisieren(supabase, tenantId, weinausbauId, mengeNachher, chargeVorher)
      if (!r.ok) {
        throw new AktionsFehler(
          `${meldung} – Achtung: Die Charge „${charge?.name ?? ''}“ wurde bereits um ${fmtNum(mengeGefuellt, 2)} L gemindert und konnte nicht zurückgesetzt werden (${r.meldung}). Bitte den Bestand der Charge prüfen.`
        )
      }
    }
    throw new AktionsFehler(meldung)
  }
  const fuellungId = (fuellungData as AR).id as string

  // Ab hier existiert die Füllung: weitere Fehler als Hinweis zurückgeben statt zu werfen –
  // sonst legt ein erneutes Absenden die Füllung ein zweites Mal an.
  const hinweise: string[] = [...vorabHinweise]

  // 3. fuellung_chargen: Charge-Verknüpfung (Rückverfolgung, Rückbuchung beim Löschen)
  if (weinausbauId) {
    const { error: e } = await (supabase.from('fuellung_chargen') as any).insert({
      tenant_id:     tenantId,
      fuellung_id:   fuellungId,
      weinausbau_id: weinausbauId,
      anteil_liter:  mengeGefuellt,
    })
    if (e) hinweise.push(`Die Verknüpfung der Füllung mit der Charge konnte nicht gespeichert werden (${dbFehlerText(e)}). Bitte melden – Rückverfolgung und Löschen dieser Füllung sind davon betroffen.`)
  }

  // 4. Rest als datierte Schwundzeile ausbuchen und Charge abschließen (atomar in der RPC)
  if (weinausbauId && schwundLiter > 0) {
    const { error: e } = await (supabase.rpc as any)('schwund_buchen', {
      p_tenant_id:      tenantId,
      p_weinausbau_id:  weinausbauId,
      p_liter:          schwundLiter,
      p_datum:          datum,
      // Beginnt mit ABFUELL_SCHWUND_NOTIZ – daran (und am Zeitpunkt) erkennt deactivateFuellung die Zeile
      p_notiz:          `${ABFUELL_SCHWUND_NOTIZ} (Füllung „${String(payload.name ?? '').trim() || 'ohne Name'}“)`,
      p_abschliessen:   true,
    })
    if (e) {
      hinweise.push(
        `Die Füllung ist angelegt, die Restmenge von ${fmtNum(schwundLiter, 2)} L konnte aber nicht als Schwund ausgebucht werden (${dbFehlerText(e)}). ` +
        'Die Charge ist noch offen – bitte in der Füllungsbearbeitung „Als Schwund ausbuchen“ verwenden.'
      )
    }
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  return hinweise.length ? { id: fuellungId, hinweis: hinweise.join(' ') } : { id: fuellungId }
}

// Füllung bearbeiten
//
// KAN-101 (04.10.2026): Nach dem Speichern sind nur Produktname, Preise, KN-Code und Notizen änderbar – die Datenbank
// sperrt alles andere (Freeze-Trigger a_freeze auf fuellungen, 42501). Tippfehler bei Anzahl, Flaschengröße oder
// Abfülldatum: Füllung stornieren (bucht die Liter zurück) und neu anlegen (Entscheidung Jörgen, 04.10.2026). Die Charge
// einer Füllung ohne Charge (Import/Altbestand) lässt sich einmal nachtragen (RPC s112_fuellung_nachtragen) – mit den
// Prüfungen aus KAN-72; die Prüfnummer über pruefnummerNachtragen.

export async function updateFuellung(id: string, formData: FormData): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  // KAN-208: Produktname Pflicht
  { const nf = fuellungNameFehler(formData.get('name')); if (nf) throw new AktionsFehler(nf) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: altRaw, error: altErr } = await (supabase.from('fuellungen') as any)
    .select('weinausbau_id, datum, pruefnummer, dac_antrag_id, storniert_am')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (altErr) throw new AktionsFehler(dbFehlerText(altErr, 'Füllung konnte nicht geladen werden'))
  if (!altRaw) throw new AktionsFehler('Füllung nicht gefunden.')
  const alt = altRaw as AR
  if (alt.storniert_am) throw new AktionsFehler('Die Füllung ist storniert und kann nicht mehr geändert werden.')

  // Charge: nur einmal nachtragbar (leer → Wert); eine eingetragene Charge bleibt
  const neueCharge = ((formData.get('weinausbau_id') as string | null) ?? '').trim() || null
  if (neueCharge && alt.weinausbau_id && neueCharge !== alt.weinausbau_id) {
    throw new AktionsFehler('Die Charge der Füllung ist bereits eingetragen und lässt sich nicht mehr ändern. Falsche Charge? Füllung stornieren und neu anlegen – oder die Betriebsleitung korrigiert mit Grund.')
  }
  if (neueCharge && !alt.weinausbau_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
      .select('name').eq('id', neueCharge).eq('tenant_id', tenantId).maybeSingle()
    if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
    if (!wa) throw new AktionsFehler('Die gewählte Kellerbuch-Charge wurde nicht gefunden.')
    // KAN-72: Prüfnummer bzw. DAC-Antrag der Füllung müssen zur Charge und zum Abfülldatum passen
    await pruefnummerBeiChargenzuordnung(supabase, tenantId,
      { pruefnummer: (alt.pruefnummer as string | null) ?? null, dacAntragId: (alt.dac_antrag_id as string | null) ?? null },
      { weinausbauId: neueCharge, chargeName: ((wa as AR).name as string | undefined) ?? null, datum: pnTag(alt.datum) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: nErr } = await (supabase.rpc as any)('s112_fuellung_nachtragen', {
      p_tenant_id: tenantId, p_fuellung_id: id, p_weinausbau_id: neueCharge, p_dac_antrag_id: null,
    })
    if (nErr) throw new AktionsFehler(dbFehlerText(nErr, 'Charge konnte nicht nachgetragen werden'))
  }

  // Nur die Spalten der Positivliste (Freeze-Trigger) – Merkmale, Datum, Mengen und Los bleiben unangetastet
  const payload: AR = {
    name:            ((formData.get('name') as string | null) ?? '').trim(),
    vk_preis_brutto: parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    einstandspreis:  parseFloat(dezimal(formData.get('einstandspreis') as string)) || null,
    zolltarifnummer: (formData.get('zolltarifnummer') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktualisiert_am: new Date().toISOString(),
  }
  if (!payload.name) throw new AktionsFehler('Bitte einen Produktnamen angeben.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updData, error } = await (supabase.from('fuellungen') as any)
    .update(payload).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) {
    const sperre = freezeSperreAus(error)
    throw new AktionsFehler(sperre ? sperrMeldung(sperre, x => FUELLUNG_FELD_LABEL[x] ?? x) : dbFehlerText(error, 'Speichern fehlgeschlagen (fuellungen)'))
  }
  if (!updData || (updData as AR[]).length === 0) throw new AktionsFehler('Füllung nicht gefunden – bitte die Seite neu laden.')
  revalidatePath('/weinhandel')
  revalidatePath(`/weinhandel/fuellungen/${id}/edit`)
}

const FUELLUNG_FELD_LABEL: Record<string, string> = {
  name: 'Produktname', vk_preis_brutto: 'VK-Preis', einstandspreis: 'Einstandspreis', mwst_pct: 'MwSt.',
  zolltarifnummer: 'KN-Code', notizen: 'Notizen', aktiv: 'aktiv', aktualisiert_am: 'Änderungszeit',
  storniert_am: 'Storno', storniert_von: 'Storno', storniert_von_name: 'Storno', storno_grund: 'Storno-Grund',
}

/**
 * KAN-101: DAC-Antrag bzw. Prüfnummer einer Füllung einmal nachtragen – nur aus einem Antrag der Charge der Füllung.
 * Zugeteilt: die Nummer muss am Abfülldatum für die Flaschen gelten (ersatzPruefnummer, KAN-72); eingereicht bzw. in
 * Prüfung: Verknüpfung ohne Nummer, wenn zwischen Abfüllung und Einreichung nichts zugebucht wurde. Die Datenbank
 * (s112_fuellung_nachtragen) lehnt einen zweiten Nachtrag ab.
 */
export async function pruefnummerNachtragen(fuellungId: string, dacAntragId: string): Promise<{ pruefnummer: string | null }> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fRaw, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('weinausbau_id, datum, pruefnummer, dac_antrag_id')
    .eq('id', fuellungId).eq('tenant_id', tenantId).is('storniert_am', null).maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!fRaw) throw new AktionsFehler('Füllung nicht gefunden oder storniert.')
  const f = fRaw as AR
  const chargeId = (f.weinausbau_id as string | null) ?? null
  if (!chargeId) throw new AktionsFehler('Bitte zuerst die Kellerbuch-Charge der Füllung nachtragen.')
  if (f.pruefnummer) throw new AktionsFehler(`Die Prüfnummer der Füllung ist bereits eingetragen (${f.pruefnummer}).`)

  const daten = (await ladePruefnummerDaten(supabase, tenantId, [chargeId])).get(chargeId) ?? null
  const antrag = daten?.antraege.find(a => a.id === dacAntragId) ?? null
  if (!daten || !antrag) throw new AktionsFehler('Der gewählte DAC-Antrag gehört nicht zur Charge der Füllung – bitte die Seite neu laden.')
  const datum = pnTag(f.datum)
  if (pruefnummerAusAntrag(antrag, chargeId)) {
    const e = ersatzPruefnummer(antrag, { datum, chargeId }, daten.zugaenge)
    if (!e.pruefnummer) throw new AktionsFehler(e.hinweis ?? 'Die Prüfnummer des DAC-Antrags gilt für diese Füllung nicht.')
  } else if (datum) {
    const v = fuellungDatumVerletzung(antrag, daten.zugaenge, datum)
    if (v) throw new AktionsFehler(`${fuellungDatumText(v, datum, antrag)} – die Füllung kann nicht mit diesem Antrag verknüpft werden.`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_fuellung_nachtragen', {
    p_tenant_id: tenantId, p_fuellung_id: fuellungId, p_weinausbau_id: null, p_dac_antrag_id: dacAntragId,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Nachtrag fehlgeschlagen'))
  // einzelabfrage-ohne-fehler: Nachtrag ist schon gespeichert, nur die Anzeige – die Seite lädt sie ohnehin neu
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu } = await (supabase.from('fuellungen') as any)
    .select('pruefnummer').eq('id', fuellungId).eq('tenant_id', tenantId).maybeSingle()
  revalidatePath('/weinhandel')
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/edit`)
  return { pruefnummer: ((neu as AR | null)?.pruefnummer as string | null) ?? null }
}

// Flaschenbestand korrigieren (KAN-35): datierte Bestandsbuchung statt Überschreiben

// ETIKETTIEREN (KAN-41 Paket 3d, 06.10.2026) – unetikettierte Flaschen etikettieren bzw. die Etikettierung stornieren
export async function fuellungEtikettieren(fuellungId: string, formData: FormData): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fRaw, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('id, datum, bestand_unetikettiert, storniert_am').eq('id', fuellungId).eq('tenant_id', tenantId).maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!fRaw) throw new AktionsFehler('Füllung nicht gefunden.')
  const f = fRaw as AR
  if (f.storniert_am) throw new AktionsFehler('Die Füllung ist storniert.')
  const menge = Number(dezimal(String(formData.get('menge_stk') ?? '')))
  const datum = String(formData.get('datum') ?? '').slice(0, 10) || wienHeute()
  const fehler = etikettierenFehler({ menge: Number.isFinite(menge) ? menge : null, bestandUnetikettiert: Number(f.bestand_unetikettiert) || 0,
    datum, heute: wienHeute(), abfuelldatum: f.datum ? String(f.datum).slice(0, 10) : null })
  if (fehler) throw new AktionsFehler(fehler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_fuellung_etikettieren', {
    p_tenant_id: tenantId, p_fuellung_id: fuellungId, p_datum: datum, p_menge_stk: menge,
    p_notizen: String(formData.get('notizen') ?? '').trim() || null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Etikettierung konnte nicht gebucht werden'))
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/edit`)
  revalidatePath('/weinhandel')
}

export async function etikettierungStornieren(etikettierungId: string, fuellungId: string, grund: string): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_etikettierung_stornieren', {
    p_tenant_id: tenantId, p_id: etikettierungId, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Etikettierung konnte nicht storniert werden'))
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/edit`)
  revalidatePath('/weinhandel')
}

export async function bestandKorrigieren(fuellungId: string, formData: FormData): Promise<{ bestand: number }> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)

  const art = String(formData.get('art') ?? '')
  if (!istBewegungsart(art)) throw new AktionsFehler('Bitte eine Buchungsart wählen.')
  const artDef = BEWEGUNGSARTEN.find(a => a.value === art)!

  const datum = String(formData.get('datum') ?? '').slice(0, 10)
  if (!DATUM_RE.test(datum)) throw new AktionsFehler('Bitte ein gültiges Buchungsdatum angeben.')
  if (datum > heuteOrtsdatum()) throw new AktionsFehler('Das Buchungsdatum darf nicht in der Zukunft liegen.')

  const grund = String(formData.get('grund') ?? '').trim() || null
  if (artDef.grundPflicht && !grund) throw new AktionsFehler(`Bitte bei „${artDef.label}“ einen Grund angeben.`)

  const { data: f, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('datum')
    .eq('id', fuellungId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!f) throw new AktionsFehler('Füllung nicht gefunden.')
  const abfuelldatum = (f as AR).datum ? String((f as AR).datum).slice(0, 10) : null
  if (abfuelldatum && datum < abfuelldatum) {
    throw new AktionsFehler(`Das Buchungsdatum liegt vor dem Abfülldatum (${datumDe(abfuelldatum)}).`)
  }

  // Aufruf mit Parameternamen über den Benutzer-Client (erstellt_von/Protokoll)
  const params: AR = {
    p_tenant_id:   tenantId,
    p_fuellung_id: fuellungId,
    p_art:         art,
    p_datum:       datum,
    p_grund:       grund,
  }
  if (art === 'inventur') {
    const ist = zahlAus(formData.get('ist_bestand'))
    if (ist === null || !Number.isInteger(ist) || ist < 0) {
      throw new AktionsFehler('Bitte den gezählten Ist-Bestand in ganzen Flaschen angeben (0 oder mehr).')
    }
    params.p_ist_bestand = ist
  } else {
    const menge = zahlAus(formData.get('menge'))
    if (menge === null || !Number.isInteger(menge) || menge === 0) {
      throw new AktionsFehler('Bitte die Menge in ganzen Flaschen angeben (ungleich 0).')
    }
    // Abgänge (Bruch, Eigenverbrauch, Schwund) werden als Stückzahl eingegeben → negativ buchen
    params.p_menge_stk = artDef.abgang ? -Math.abs(menge) : menge
  }

  const { data, error } = await (supabase.rpc as any)('fuellung_bestand_buchen', params)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Bestandskorrektur fehlgeschlagen'))

  revalidatePath('/weinhandel')
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/edit`)
  return { bestand: Number(data) }
}

// Restmenge einer Weinausbau-Charge als Schwund ausbuchen + Charge abschließen

export async function schwundAusbuchen(fuellungId: string): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  pruefeChargenRecht(membership)

  const { data: f, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('name, datum, weinausbau_id')
    .eq('id', fuellungId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  const weinausbauId = (f as AR | null)?.weinausbau_id as string | null
  if (!f || !weinausbauId) throw new AktionsFehler('Keine Charge verknüpft')
  // Nur, wenn diese Füllung tatsächlich von der Charge abgefüllt hat – eine nachträglich
  // zugeordnete Charge wurde nie gemindert, ihr Bestand ist kein Rest dieser Abfüllung
  if (await abgebuchteLiter(supabase, tenantId, fuellungId, weinausbauId) == null) {
    throw new AktionsFehler('Die Charge wurde dieser Füllung nachträglich zugeordnet – von ihr wurde beim Abfüllen nichts abgebucht, ihr Bestand ist also kein Rest dieser Abfüllung. Echten Schwund bitte auf der Chargen-Seite über „Schwund buchen“ erfassen.')
  }

  const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
    .select('name, menge_liter, status')
    .eq('id', weinausbauId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
  if (!wa) throw new AktionsFehler('Die verknüpfte Charge wurde nicht gefunden.')
  const charge = wa as AR
  if (charge.status === 'abgeschlossen') {
    throw new AktionsFehler(`Die Charge „${charge.name}“ ist bereits abgeschlossen – es gibt nichts mehr auszubuchen.`)
  }

  const rest = r2(Number(charge.menge_liter ?? 0) || 0)
  if (rest >= 0.01) {
    // Datierte Schwundzeile (Abfülldatum dieser Füllung) + Charge abschließen, atomar
    const datum = (f as AR).datum ? String((f as AR).datum).slice(0, 10) : heuteOrtsdatum()
    const { error } = await (supabase.rpc as any)('schwund_buchen', {
      p_tenant_id:      tenantId,
      p_weinausbau_id:  weinausbauId,
      p_liter:          rest,
      p_datum:          DATUM_RE.test(datum) ? datum : heuteOrtsdatum(),
      p_notiz:          `Schwund-Ausbuchung Restmenge (Füllung „${(f as AR).name ?? ''}“)`,
      p_abschliessen:   true,
    })
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Schwund konnte nicht gebucht werden'))
  } else {
    // Kein messbarer Rest (< 0,01 L): nur abschließen
    const r = await chargeAktualisieren(supabase, tenantId, weinausbauId, charge.menge_liter,
      { menge_liter: 0, status: 'abgeschlossen', aktiv: false })
    if (!r.ok) throw new AktionsFehler(`Die Charge „${charge.name}“ konnte nicht abgeschlossen werden: ${r.meldung}`)
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}

// Füllung deaktivieren („löschen“ im Weinhandel)
//
// KAN-35: nur ohne Verkäufe und Bestandsbuchungen. Zurückgebucht wird genau, was die
// Abfüllung von der Charge genommen hat: die Füllmenge (fuellung_chargen.anteil_liter) und –
// hat die Abfüllung die Charge mit „Abschließen“ beendet – die Abschluss-Schwundzeile derselben
// Füllung (Notiz beginnt mit ABFUELL_SCHWUND_NOTIZ, Datum der Füllung, direkt nach ihr erfasst).
// Seit KAN-145 (B3, 30.09.2026) wird die Füllung mit Grund storniert (aktiv = false + Storno-Kennzeichen) und die
// Abschluss-Schwundzeile ebenfalls storniert statt gelöscht; die Charge wird wieder aktiv. Wurde an der Charge seither
// weitergebucht, bleibt die Füllung stehen. Scheitert ein Schritt, werden die vorherigen soweit möglich
// zurückgenommen – ein Storno selbst lässt sich nicht zurücknehmen (s112_storno_schutz), deshalb kommt die Füllung
// vor der Schwundzeile (deren Recht ist mit pruefeChargenRecht vorab geprüft).

/** Abschluss-Schwund muss so kurz nach der Füllung erfasst sein (gleicher Vorgang createFuellung) */
const ABSCHLUSS_SCHWUND_FENSTER_MS = 10 * 60 * 1000

export async function deactivateFuellung(id: string, grund: string): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)

  const { data: fRaw, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('name, aktiv, datum, erstellt_am, bestand_flaschen, weinausbau_id, menge_liter_gefuellt, zukauf_posten_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!fRaw) throw new AktionsFehler('Füllung nicht gefunden.')
  const f = fRaw as AR
  if (!f.aktiv) {
    // schon entfernt (z. B. Doppelklick) – nichts doppelt zurückbuchen
    revalidatePath('/weinhandel')
    return
  }

  // KAN-41 Paket 2b: Handelsware aus einem Flaschenzukauf nur über den Zukauf stornieren (Trigger a_flaschenzukauf_schutz)
  if (f.zukauf_posten_id) {
    throw new AktionsFehler(`„${f.name}“ stammt aus einem Flaschenzukauf – bitte den Zukauf stornieren (Weinhandel › Zukauf); der Weinlager-Artikel wird dabei mitstorniert.`)
  }

  // KAN-35: Sperre bei Folgebuchungen – Verkäufe/Bestandsbuchungen bleiben sonst ohne Füllung
  const fb = await folgebuchungenDerFuellung(supabase, tenantId, id)
  if (fb.verkaeufe > 0 || fb.bewegungen > 0) {
    throw new AktionsFehler(
      `Die Füllung „${f.name}“ kann nicht gelöscht werden: Es gibt bereits ${folgebuchungenFuellungText(fb)}. ` +
      'Die Füllung bleibt als Historie erhalten. Ausverkaufte Füllungen lassen sich in der Lagerliste ausblenden; ' +
      'Abweichungen im Flaschenbestand bitte in der Füllungsbearbeitung über „Bestand korrigieren“ buchen.'
    )
  }

  // Zurückgebucht wird genau, was createFuellung von der Charge abgebucht hat
  // (fuellung_chargen.anteil_liter). Nachträglich zugeordnete Chargen wurden nie gemindert.
  type Rueck = { chargeId: string; liter: number; schwund: AR | null; schwundLiter: number; charge: AR; mengeNachher: number }
  let rueck: Rueck | null = null
  if (f.weinausbau_id) {
    const abgebucht = await abgebuchteLiter(supabase, tenantId, id, f.weinausbau_id as string)
    const liter = abgebucht ?? 0
    if (liter > 0) {
      pruefeChargenRecht(membership)
      const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
        .select('name, menge_liter, status, aktiv')
        .eq('id', f.weinausbau_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
      if (!wa) throw new AktionsFehler('Die verknüpfte Charge wurde nicht gefunden – die Liter können nicht zurückgebucht werden.')
      const charge = wa as AR

      // Abschluss-Schwund dieser Abfüllung (createFuellung → schwund_buchen, früher direkt)
      const { data: swRaw, error: swErr } = await (supabase.from('keller_umzuege') as any)
        .select('id, datum, erstellt_am, brutto_liter, schwund_liter, notizen')
        .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
        .eq('tenant_id', tenantId)
        .eq('von_weinausbau_id', f.weinausbau_id)
        .eq('umzug_typ', 'schwund')
        .gte('erstellt_am', f.erstellt_am)
        .ilike('notizen', `${ABFUELL_SCHWUND_NOTIZ}%`)
      if (swErr) throw new AktionsFehler(dbFehlerText(swErr, 'Schwundbuchungen der Charge konnten nicht geprüft werden'))
      const fuellungMs = Date.parse(String(f.erstellt_am ?? ''))
      const kandidaten = ((swRaw ?? []) as AR[]).filter(z => {
        const ms = Date.parse(String(z.erstellt_am ?? ''))
        return String(z.datum ?? '').slice(0, 10) === String(f.datum ?? '').slice(0, 10)
          && Number.isFinite(ms) && Number.isFinite(fuellungMs) && ms - fuellungMs <= ABSCHLUSS_SCHWUND_FENSTER_MS
      })
      if (kandidaten.length > 1) {
        throw new AktionsFehler(`Die Füllung „${f.name}“ kann nicht automatisch gelöscht werden: Zur Abfüllung gibt es mehrere Abschluss-Schwundbuchungen an der Charge „${charge.name}“. Bitte Support kontaktieren.`)
      }
      const schwund = kandidaten[0] ?? null
      const schwundLiter = schwund ? r2(Number(schwund.brutto_liter ?? 0) || Number(schwund.schwund_liter ?? 0) || 0) : 0
      if (schwund) {
        // Nur, wenn an der Charge seit dem Abschluss nichts mehr gebucht wurde
        const spaeter = await spaetereMengenbewegungen(supabase, tenantId, f.weinausbau_id as string, String(schwund.erstellt_am), {
          umzugZeilenIds: [schwund.id as string],
        })
        if (spaeter.length > 0) {
          throw new AktionsFehler(
            `Die Füllung „${f.name}“ kann nicht gelöscht werden: Beim Abfüllen wurde die Charge „${charge.name}“ mit ${fmtNum(schwundLiter, 2)} L Schwund abgeschlossen, ` +
            `seither wurde an der Charge weitergebucht (${folgebuchungenText(spaeter)}). Die Füllung bleibt als Historie erhalten – Korrekturen bitte als eigene, datierte Buchung erfassen.`
          )
        }
      }
      rueck = {
        chargeId: f.weinausbau_id as string, liter, schwund, schwundLiter, charge,
        mengeNachher: r2((Number(charge.menge_liter ?? 0) || 0) + liter + schwundLiter),
      }
    }
  }

  /** Rückbuchung auf die Charge zurücknehmen; liefert einen Warnhinweis, wenn das scheitert */
  const chargeZuruecksetzen = async (): Promise<string> => {
    if (!rueck) return ''
    const r = await chargeAktualisieren(supabase, tenantId, rueck.chargeId, rueck.mengeNachher, {
      menge_liter: rueck.charge.menge_liter ?? null, status: rueck.charge.status, aktiv: rueck.charge.aktiv,
    })
    return r.ok ? '' : ` – Achtung: ${fmtNum(rueck.liter + rueck.schwundLiter, 2)} L wurden bereits auf die Charge „${rueck.charge.name}“ zurückgebucht und konnten nicht zurückgenommen werden (${r.meldung}). Bitte den Bestand der Charge prüfen.`
  }

  // 1. Liter (und Abschluss-Schwund) auf die Charge zurückbuchen und den Status konsistent
  //    machen (Menge > 0 → aktiv, nicht abgeschlossen). Zuerst, weil hier die Gebinde-Prüfung greifen kann.
  if (rueck) {
    const werte: AR = { menge_liter: rueck.mengeNachher, aktiv: true }
    if (rueck.charge.status === 'abgeschlossen') werte.status = 'abfuellung'
    const r = await chargeAktualisieren(supabase, tenantId, rueck.chargeId, rueck.charge.menge_liter, werte)
    if (!r.ok) {
      // weinausbau_gebinde_pruefen (P0001): Gebinde inzwischen durch einen anderen Betrieb belegt
      const grund = r.code === 'P0001'
        ? `${r.meldung.replace(/[.\s]+$/, '')}. Bitte die Charge zuerst einem freien Gebinde zuordnen oder das Gebinde freimachen.`
        : r.meldung
      throw new AktionsFehler(
        `Die Füllung „${f.name}“ kann nicht gelöscht werden, weil die ${fmtNum(rueck.liter + rueck.schwundLiter, 2)} L nicht auf die Charge „${rueck.charge.name}“ zurückgebucht werden konnten: ${grund}`
      )
    }
  }

  // 2. Füllung stornieren (aktiv = false + Kennzeichen) – nur, wenn seit der Prüfung kein Verkauf den Bestand geändert hat
  const { data: dData, error } = await (supabase.from('fuellungen') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString(), storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .is('storniert_am', null)
    .eq('bestand_flaschen', f.bestand_flaschen)
    .select('id')
  if (error || !dData || (dData as AR[]).length === 0) {
    const meldung = error
      ? dbFehlerText(error, 'Stornieren fehlgeschlagen (fuellungen)')
      : 'Die Füllung wurde zwischenzeitlich geändert (z. B. durch einen Verkauf) – bitte die Seite neu laden.'
    throw new AktionsFehler(`${meldung}${await chargeZuruecksetzen()}`)
  }

  // 3. Abschluss-Schwundzeile stornieren (KAN-145) – ihre Liter sind oben zurückgebucht
  if (rueck?.schwund) {
    const { data: sUpd, error: sErr } = await (supabase.from('keller_umzuege') as any)
      .update({ storniert_am: new Date().toISOString(), storno_grund: `Storno der Füllung „${f.name}“: ${grund.trim()}` })
      .eq('id', rueck.schwund.id)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null)
      .select('id')
    if (sErr || !(sUpd as AR[] | null)?.length) {
      const meldung = sErr
        ? dbFehlerText(sErr, 'Die Abschluss-Schwundbuchung konnte nicht storniert werden')
        : 'Die Abschluss-Schwundbuchung konnte nicht storniert werden – vermutlich fehlt die Berechtigung.'
      // Die Füllung ist bereits storniert (nicht rücknehmbar) – Charge zurücksetzen, Support informieren
      throw new AktionsFehler(`${meldung.replace(/[.\s]+$/, '')}. Achtung: Die Füllung ist bereits storniert – bitte Support kontaktieren${await chargeZuruecksetzen()}`)
    }
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  if (f.weinausbau_id) revalidatePath(`/kellerbuch/weinausbau/${f.weinausbau_id}`)
}

// ── KAN-42: CSV-Import „Eröffnungsbestand Flaschen“ (Datenimport) ───────────────────────────────────────
// Je gültiger Zeile eine Füllung ohne Charge über fuellungAnlegen – dieselbe Logik wie das Füllungsformular
// (Qualität, geprüfte Prüfnummer, Chargennummer), Datum = Stichtag, Kennzeichen import_quelle 'eroeffnungsbestand'.
// Bestand zum Stichtag (KAN-43) zählt die Füllung ab dem Stichtag (Abfülltag); das Bewegungsbuch führt sie als
// Eröffnungsbestand ohne Tankabgang. Rechte wie der Datenimport (Super-Admin/Betriebs-Manager).

type ImportZeilen = { kopf: string[]; zeilen: Record<string, string>[]; zeilenOffset?: number }
const IMPORT_MAX_ZEILEN = 500

async function eroeffnungImportKontext() {
  const membership = await getMembership()   // KAN-30 Seitenbetrieb + KAN-5 Schreibsperre
  if (membership.role !== 'system_admin' && membership.role !== 'tenant_admin') {
    throw new AktionsFehler('Der Datenimport ist Super-Admins und Betriebs-Managern vorbehalten.')
  }
  pruefeFuellungsRecht(membership)
  return { supabase: await createSupabaseServerClient(), tenantId: membership.tenantId }
}

function importStichtag(stichtag: unknown): string {
  const s = typeof stichtag === 'string' ? stichtag.trim() : ''
  const f = eroeffnungsStichtagFehler(s, wienHeute())
  if (f) throw new AktionsFehler(f)
  return s
}

function importDaten(d: ImportZeilen): ImportZeilen {
  if (!d || !Array.isArray(d.kopf) || !Array.isArray(d.zeilen)) throw new AktionsFehler('Ungültige Importdaten – bitte die Datei erneut wählen.')
  if (d.zeilen.length > IMPORT_MAX_ZEILEN) throw new AktionsFehler(`Höchstens ${IMPORT_MAX_ZEILEN} Zeilen je Aufruf.`)
  return {
    kopf: d.kopf.map(h => String(h ?? '')),
    zeilen: d.zeilen.map(z => Object.fromEntries(Object.entries(z ?? {}).map(([k, v]) => [String(k), String(v ?? '')]))),
    zeilenOffset: Number.isInteger(d.zeilenOffset) && (d.zeilenOffset ?? 0) > 0 ? d.zeilenOffset : 0,
  }
}

/** Prüfung je Zeile + freie Prüfnummer wie beim Abfüllen (pruefnummerFuerFuellung, nur lesend) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pruefeFlaschenImport(supabase: any, tenantId: string, stichtag: string, d: ImportZeilen): Promise<DateiBefund<FlaschenEingabe>> {
  const befund = pruefeFlaschenZeilen(d.kopf, d.zeilen, { zeilenOffset: d.zeilenOffset })
  // schon importiert? (gleicher Wein, Jahrgang und Flaschengröße als Eröffnungsbestand zum selben Stichtag)
  const { data: vorhanden, error: vErr } = await alle(supabase.from('fuellungen')
    .select('name, jahrgang, flaschengroesse_ml')
    .eq('tenant_id', tenantId)
    .eq('import_quelle', IMPORT_QUELLE_EROEFFNUNG)
    .eq('datum', stichtag)
    .eq('aktiv', true).order('id'))
  if (vErr) throw new AktionsFehler(dbFehlerText(vErr, 'Vorhandene Eröffnungsbestände konnten nicht geladen werden'))
  const schluessel = (name: unknown, jahrgang: unknown, ml: unknown) => `${String(name ?? '').trim().toLocaleLowerCase('de')}|${jahrgang ?? ''}|${ml ?? ''}`
  const schonDa = new Set(((vorhanden ?? []) as AR[]).map(f => schluessel(f.name, f.jahrgang, f.flaschengroesse_ml)))
  for (const z of befund.zeilen) {
    if (z.eingabe && schonDa.has(schluessel(z.eingabe.name, z.eingabe.jahrgang, z.eingabe.ml))) {
      z.fehler.push('Bereits als Eröffnungsbestand zum Stichtag vorhanden (gleicher Name, Jahrgang und Flaschengröße) – nicht doppelt importieren.')
      z.eingabe = null
    }
  }
  for (const z of befund.zeilen) {
    if (!z.eingabe?.pruefnummer) continue
    try {
      await pruefnummerFuerFuellung(supabase, tenantId, { dacAntragId: null, pruefnummer: z.eingabe.pruefnummer },
        { weinausbauId: null, chargeName: null, abfuelldatum: stichtag })
    } catch (e) {
      z.fehler.push(e instanceof AktionsFehler ? e.message : `Prüfnummer konnte nicht geprüft werden: ${String((e as Error)?.message ?? e)}`)
      z.eingabe = null
    }
  }
  return befund
}

/** Vorschau: jede Zeile geprüft, nichts gespeichert */
export async function pruefeEroeffnungFlaschen(stichtag: string, daten: ImportZeilen): Promise<DateiBefund<FlaschenEingabe>> {
  const { supabase, tenantId } = await eroeffnungImportKontext()
  return pruefeFlaschenImport(supabase, tenantId, importStichtag(stichtag), importDaten(daten))
}

/** Import: prüft erneut und legt je gültiger Zeile eine Füllung ohne Charge an */
export async function importiereEroeffnungFlaschen(
  stichtag: string,
  daten: ImportZeilen,
  herkunft: string,
): Promise<{ importiert: number; fehler: { zeile: number; titel: string; meldungen: string[] }[] }> {
  const { supabase, tenantId } = await eroeffnungImportKontext()
  const tag = importStichtag(stichtag)
  const befund = await pruefeFlaschenImport(supabase, tenantId, tag, importDaten(daten))
  if (befund.dateiFehler.length > 0) throw new AktionsFehler(befund.dateiFehler.join(' '))
  const heute = wienHeute()
  const vermerk = eroeffnungsVermerk(tag, String(herkunft ?? '').slice(0, 120), heute)
  const importiertAm = new Date().toISOString()
  const ergebnis = { importiert: 0, fehler: [] as { zeile: number; titel: string; meldungen: string[] }[] }
  for (const z of befund.zeilen) {
    if (!z.eingabe) { ergebnis.fehler.push({ zeile: z.zeile, titel: z.titel, meldungen: z.fehler }); continue }
    const fd = new FormData()
    for (const [k, v] of Object.entries(flaschenFormularWerte(z.eingabe, tag, vermerk))) fd.set(k, v)
    try {
      const r = await fuellungAnlegen(fd, { weinart: z.eingabe.weinart, landIso: z.eingabe.land, importiertAm })
      ergebnis.importiert++
      if (r.hinweis) ergebnis.fehler.push({ zeile: z.zeile, titel: z.titel, meldungen: [`Angelegt, aber: ${r.hinweis}`] })
    } catch (e) {
      ergebnis.fehler.push({ zeile: z.zeile, titel: z.titel, meldungen: [e instanceof AktionsFehler ? e.message : String((e as Error)?.message ?? e)] })
    }
  }
  return ergebnis
}

// SEKT-STUFE (KAN-190, 07.10.2026) – Sekt Austria / Reserve / Große Reserve vergeben bzw. degorgieren. Hefelagerung ab der
// Tirage, Flaschengärung, Lagenreinheit (aus der Zusammensetzung der Füllung: 100 % eine Ried), nur Abstufen – dieselben
// Regeln prüft die RPC s112_sekt_stufe_setzen (schreibt die gesperrten Spalten über s112.freeze_frei).
export async function sektStufeSetzen(fuellungId: string, formData: FormData): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  const { data: fRaw, error: fErr } = await (supabase.from('fuellungen') as unknown as AR)
    .select('id, erzeugnis, tirage_datum, gaermethode, sekt_stufe, degorgiert_am, storniert_am').eq('id', fuellungId).eq('tenant_id', tenantId).maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!fRaw) throw new AktionsFehler('Füllung nicht gefunden.')
  const f = fRaw as AR
  if (f.storniert_am) throw new AktionsFehler('Die Füllung ist storniert.')
  if (f.erzeugnis !== 'SEKTGU' || !f.tirage_datum) throw new AktionsFehler('Sekt-Stufen gibt es nur für Sekt g.U. mit erfasster Tirage.')
  const stufeRoh = String(formData.get('sekt_stufe') ?? '').trim()
  if (stufeRoh && !istSektStufe(stufeRoh)) throw new AktionsFehler('Unbekannte Sekt-Stufe.')
  const stufe = stufeRoh ? (stufeRoh as SektStufe) : null
  const degorgiert = String(formData.get('degorgiert_am') ?? '').slice(0, 10) || null
  if (!stufe && !degorgiert) throw new AktionsFehler('Bitte eine Sekt-Stufe wählen oder das Datum des Degorgierens angeben.')
  // Große Reserve: lagenrein aus der Zusammensetzung (Herkunft je Ried bis in die Lese)
  let lagenrein = false
  if ((stufe ?? f.sekt_stufe) === 'grosse_reserve') {
    const anteile = await resolveBlendKompositionFuellung(supabase, fuellungId, tenantId)
    lagenrein = istLagenrein(anteile.map(a => ({ ried: a.ried ?? null, liter: a.liter })))
  }
  const fehler = sektStufeFehler({
    stufe, alt: istSektStufe(f.sekt_stufe) ? f.sekt_stufe : null, tirage: String(f.tirage_datum).slice(0, 10), gaermethode: f.gaermethode ?? null,
    stichtag: degorgiert ?? (f.degorgiert_am ? String(f.degorgiert_am).slice(0, 10) : wienHeute()), lagenrein,
  })
  if (fehler) throw new AktionsFehler(fehler)
  const { error } = await (supabase.rpc as unknown as (fn: string, args: AR) => Promise<{ error: AR | null }>)('s112_sekt_stufe_setzen', {
    p_tenant_id: tenantId, p_fuellung_id: fuellungId, p_stufe: stufe, p_degorgiert_am: degorgiert, p_lagenrein: lagenrein,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Sekt-Stufe konnte nicht gespeichert werden'))
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/edit`)
  revalidatePath('/weinhandel')
}
