import 'server-only'

// ── Storno von Umzug und Verschnitt (KAN-35, 24.09.2026; KAN-145, 30.09.2026) ──
// Ein Umzug bzw. Verschnitt wird storniert: Rückbuchung der Bestände, danach bleibt die Buchung stehen und
// bekommt das Storno-Kennzeichen (storniert_am/-von/-von_name, storno_grund – Grund Pflicht, Zeitpunkt und
// Benutzer setzt die Datenbank, s112_storno_schutz; der Storno steht im Änderungsprotokoll). Stornierte
// Buchungen zählen in keinem Bestand und keiner Meldung (alle Leser filtern storniert_am). Bis KAN-145 wurde
// die Buchung gelöscht. Storniert werden kann nur, wenn
//   (1) die Ziel-Charge seit der Buchung nicht weiterbewegt wurde: keine später
//       ERFASSTE Mengenbewegung an der Ziel-Charge (Umzug, Schwund, Verschnitt als
//       Quelle oder Ziel, Füllung, Tankverkauf, Zukauf), und
//   (2) die Rückbuchung vollständig möglich ist: die Ziel-Charge hat noch mindestens
//       die zugebuchte Menge (kein stilles Kappen bei 0 wie bisher).
// Sonst bleibt die Buchung stehen, die Korrektur wird als Gegenbuchung erfasst.
// Dieselben Bedingungen gelten für Mengen- und Datumsänderungen an einem Umzug.
//
// „Später“ heißt später erfasst (erstellt_am/created_at), nicht später datiert: nur
// was nach der Buchung ins System kam, kann die zugebuchten Liter schon verwendet
// haben. lib/kellerbuch/folgebuchungen.ts zählt ohne Zeitbezug (würde jede ältere
// Herkunft der Ziel-Charge mitzählen) – deshalb hier datierte Abfragen in derselben
// Zählweise, die Texte kommen aus folgebuchungenText. Fehlt ein Zeitstempel, zählt
// die Bewegung als später (sichere Richtung).
//
// Schwundbuchungen (umzug_typ 'schwund') sind nur stornierbar, wenn nachweislich der
// Bestand gemindert wurde: schwund_buchen (p_bestand_mindern) ändert die Charge in derselben
// Transaktion – das Bestandsprotokoll hat dann eine weinausbau-Änderung von menge_liter mit
// identischem Zeitstempel. Zurückgebucht wird genau diese Minderung (alt − neu, samt
// aktiv/Status), nur solange an der Charge seither nichts erfasst wurde. Die Minderung liest die RPC
// s112_schwund_minderung (KAN-145 B4 – auch für Mitarbeiter mit Schreibmodul). Nachbuchungen
// (ohne Minderung) und Buchungen vor KAN-35 bleiben gesperrt: eine Rückbuchung würde Liter
// erzeugen. Menge und Datum einer Schwundbuchung sind nie änderbar (nur stornieren).
//
// Nicht stornierbar: Umzüge im alten Zeilenformat (ohne getrennte quelle/ziel-Zeilen): die
// Ziel-Charge bzw. die Nettomenge ist nicht eindeutig.
//
// Rückbuchung (Zugänge zuerst, weil die Reaktivierung einer Quelle an der Gebinde-Prüfung
// der Kellergemeinschaft scheitern kann; jede Änderung per Vergleichen und Setzen gegen den
// geplanten Bestand; scheitert eine Änderung oder danach das Löschen der Buchung, werden die
// bereits ausgeführten Änderungen zurückgenommen – ein zweiter Versuch bucht nicht doppelt):
//   * Quelle: menge_liter += Menge; war sie abgeschlossen/inaktiv, wird sie wieder
//     aktiv (Status „Ausbau“) – keine inaktiven Chargen mit Bestand.
//   * Ziel: menge_liter −= Menge; bleiben ≤ 0,01 L, wird die Charge wie in allen
//     übrigen Pfaden abgeschlossen (menge 0, aktiv false) – keine aktiven 0-L-Chargen.
//   * Hat ein Umzug die Qualität einer zusammengeführten Ziel-Charge abgestuft (Vermerk an
//     Zielzeile und Charge), wird sie zurückgesetzt; beim Verschnitt stellt die Action die
//     Snapshot-Werte wieder her. Die Rebsorte des Verschnitt-Ziels hat keinen Snapshot.
// Füllungen zählen nur, solange sie aktiv sind: das Löschen (deactivateFuellung) bucht die
// Liter exakt zurück, die Füllung ist damit fachlich storniert.

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { folgebuchungenText, type Folgebuchung, type FolgebuchungArt } from '@/lib/kellerbuch/folgebuchungen'
import { gebindeFehlerText } from '@/lib/keller/behaelter'
import { fmtNum } from '@/lib/format'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { KORREKTUR_NACH_OBEN_HINWEIS, SCHWUND_STORNO_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { ohneStornierteVerschnitte } from '@/lib/kellerbuch/stornoFilter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Mengen unter dieser Schwelle gelten als 0 (App-Konvention, siehe schwund_buchen) */
const TOLERANZ = 0.01

/** Folgebuchungen, die keine Liter bewegen (für Mengensperren ausnehmen) */
export const OHNE_MENGENWIRKUNG: FolgebuchungArt[] = ['behandlung', 'analyse', 'dac']

/** Folgebuchungen, die einen Gebindewechsel an der Charge NICHT sperren: der Zukauf ist die
 *  Herkunft der Charge (zukauf_posten hängt nicht am Gebinde), Analysen und DAC-Anträge
 *  hängen nicht am Gebinde. Umzüge, Verschnitte, Füllungen, Verkäufe, Schwund und
 *  Kellerbehandlungen (keller_behandlungen.behaelter_id) sperren. */
export const GEBINDEWECHSEL_OHNE: FolgebuchungArt[] = ['zukauf_ziel', 'analyse', 'dac']

export const GEGENBUCHUNG_HINWEIS =
  'Bitte die Korrektur als Gegenbuchung erfassen (Umzug zurück bzw. „Schwund buchen“ auf der Chargen-Seite).'

/** Verschnitte lassen sich nicht per Umzug entmischen */
export const VERSCHNITT_HINWEIS =
  'Ein Verschnitt lässt sich nicht per Umzug entmischen: Ist die Ziel-Charge zu hoch, bitte dort „Schwund buchen“. ' +
  'Eine zu stark geminderte Quell-Charge kann derzeit nicht erhöht werden – bitte den Support kontaktieren und dabei Charge, Menge und Grund angeben.'

const SCHWUND_SPERR_HINWEIS =
  `Schwund bleibt als datierte Buchung im Bewegungsbuch. ${KORREKTUR_NACH_OBEN_HINWEIS}`

export type Sperre = { grund: string; hinweis: string }

export type ChargenRueckbuchung = {
  id: string
  name: string
  vorher: number
  neu: number
  payload: R
  /** Charge wie beim Planen gelesen – Grundlage für Vergleichen-und-Setzen und die Rücknahme */
  zeile: R
}

export type UmzugStornoPlan = {
  zeilen: R[]
  batchId: string | null
  datum: string | null
  /** Schwundbuchung (umzug_typ 'schwund') statt Umzug */
  istSchwund: boolean
  sperre: Sperre | null
  aenderungen: ChargenRueckbuchung[]
}

export type VerschneidungStornoPlan = {
  verschneidung: R
  datum: string | null
  sperre: Sperre | null
  aenderungen: ChargenRueckbuchung[]
}

/** Werte eines Umzugs in der Form des Bearbeiten-Formulars (UmziehenFormClient) */
export type UmzugEingabe = {
  quellen: { weinausbau_id: string; brutto: number }[]
  ziele: { behaelter_id: string; menge_netto: number }[]
  datum: string
  notizen: string
  /** Zeile, an der die Notizen des Umzugs stehen (erste Quell-Zeile) */
  ersteId: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const rund2 = (n: number): number => Math.round(n * 100) / 100

/** „2026-09-24“ → „24.09.2026“ */
export function datumText(d: string | null | undefined): string {
  if (!d) return '–'
  const [j, m, t] = String(d).slice(0, 10).split('-')
  return j && m && t ? `${t}.${m}.${j}` : String(d)
}

function abfrageFehler(tabelle: string, error: unknown): never {
  throw new AktionsFehler(`Buchungen der Charge konnten nicht geprüft werden (${tabelle}): ${dbFehlerText(error)}`)
}

function zeilen(tabelle: string, res: { data?: unknown; error?: unknown }): R[] {
  if (res.error) abfrageFehler(tabelle, res.error)
  return (res.data ?? []) as R[]
}

/**
 * Mengenbewegungen an einer Charge, die nicht vor `seit` erfasst wurden – ohne die
 * zu stornierende Buchung selbst. Zählweise wie folgebuchungenDerCharge.
 */
export async function spaetereMengenbewegungen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  weinausbauId: string,
  seit: string | null,
  ohne: { umzugZeilenIds?: string[]; verschneidungId?: string } = {},
): Promise<Folgebuchung[]> {
  if (!UUID_RE.test(weinausbauId)) throw new AktionsFehler('Buchungen der Charge können nicht geprüft werden: ungültige Chargen-ID')
  const seitMs = seit ? Date.parse(seit) : NaN
  // Ohne Zeitstempel der Buchung zählt jede andere Bewegung (sichere Richtung)
  const spaeter = (t: unknown): boolean => {
    if (Number.isNaN(seitMs) || !t) return true
    const ms = Date.parse(String(t))
    return Number.isNaN(ms) || ms >= seitMs
  }
  const ohneZeilen = new Set(ohne.umzugZeilenIds ?? [])
  const id = weinausbauId

  const [umz, vQuellen, vZiel, fChargen, fDirekt, tank, zukauf] = await Promise.all([
    (supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id, umzug_typ, erstellt_am')
      .or(`von_weinausbau_id.eq.${id},nach_weinausbau_id.eq.${id}`)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null),
    (supabase.from('verschneidung_quellen') as any)   // ohne tenant_id-Spalte, RLS über verschneidungen
      .select('verschneidung_id, verschneidung:verschneidung_id(created_at, storniert_am)')
      .eq('quell_weinausbau_id', id),
    (supabase.from('verschneidungen') as any)
      .select('id, created_at')
      .eq('ziel_weinausbau_id', id)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null),
    // Nur aktive Füllungen: das Löschen einer Füllung bucht ihre Liter exakt zurück
    (supabase.from('fuellung_chargen') as any)
      .select('fuellung_id, created_at, fuellungen!inner(aktiv)')
      .eq('weinausbau_id', id)
      .eq('tenant_id', tenantId)
      .eq('fuellungen.aktiv', true),
    (supabase.from('fuellungen') as any)
      .select('id, erstellt_am')
      .eq('weinausbau_id', id)
      .eq('aktiv', true)
      .eq('tenant_id', tenantId),
    (supabase.from('verkauf_positionen') as any)
      .select('verkaufsposten_id, erstellt_am, verkaufsposten:verkaufsposten_id(storniert)')
      .eq('weinausbau_id', id)
      .eq('typ', 'tank')
      .eq('tenant_id', tenantId),
    (supabase.from('zukauf_posten') as any)
      .select('id, erstellt_am')
      .eq('ziel_weinausbau_id', id)
      .eq('aktiv', true)
      .eq('tenant_id', tenantId),
  ])

  const umzugKeys = new Set<string>()
  let schwund = 0
  for (const z of zeilen('keller_umzuege', umz)) {
    if (ohneZeilen.has(z.id) || !spaeter(z.erstellt_am)) continue
    if (z.umzug_typ === 'schwund') schwund++
    else umzugKeys.add(z.umzug_batch_id ?? z.id)
  }

  const vqIds = new Set<string>()
  for (const q of ohneStornierteVerschnitte(zeilen('verschneidung_quellen', vQuellen))) {   // KAN-145
    if (q.verschneidung_id === ohne.verschneidungId) continue
    if (spaeter((q.verschneidung as R | null)?.created_at)) vqIds.add(q.verschneidung_id)
  }
  const vzIds = new Set<string>()
  for (const v of zeilen('verschneidungen', vZiel)) {
    if (v.id === ohne.verschneidungId) continue
    if (spaeter(v.created_at)) vzIds.add(v.id)
  }

  const fuellungIds = new Set<string>()
  for (const f of zeilen('fuellung_chargen', fChargen)) if (spaeter(f.created_at)) fuellungIds.add(f.fuellung_id)
  for (const f of zeilen('fuellungen', fDirekt)) if (spaeter(f.erstellt_am)) fuellungIds.add(f.id)

  const tankIds = new Set<string>()
  for (const p of zeilen('verkauf_positionen', tank)) {
    if ((p.verkaufsposten as R | null)?.storniert) continue
    if (spaeter(p.erstellt_am)) tankIds.add(p.verkaufsposten_id)
  }

  const zukaufAnzahl = zeilen('zukauf_posten', zukauf).filter(z => spaeter(z.erstellt_am)).length

  const werte: [FolgebuchungArt, number][] = [
    ['umzug', umzugKeys.size],
    ['schwund', schwund],
    ['verschnitt_quelle', vqIds.size],
    ['verschnitt_ziel', vzIds.size],
    ['fuellung', fuellungIds.size],
    ['tankverkauf', tankIds.size],
    ['zukauf_ziel', zukaufAnzahl],
  ]
  return werte.filter(([, n]) => n > 0).map(([art, anzahl]) => ({ art, anzahl }))
}

/**
 * Prüft und berechnet die Rückbuchung: `zugang` je Charge (Quellen bekommen Liter zurück),
 * `abgang` je Charge (Ziele geben Liter ab). Schreibt nichts.
 */
async function planeRueckbuchung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  zugang: Map<string, number>,
  abgang: Map<string, number>,
  seit: string | null,
  ohne: { umzugZeilenIds?: string[]; verschneidungId?: string },
  hinweis: string = GEGENBUCHUNG_HINWEIS,
): Promise<{ sperre: Sperre | null; aenderungen: ChargenRueckbuchung[]; chargen: Map<string, R> }> {
  const ids = [...new Set([...zugang.keys(), ...abgang.keys()])]
  const chargen = new Map<string, R>()
  if (ids.length === 0) return { sperre: null, aenderungen: [], chargen }

  const { data, error } = await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter, aktiv, status, qualitaetsstufe, herkunft_code, notizen')
    .in('id', ids)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Chargen konnten nicht geladen werden'))
  for (const c of (data ?? []) as R[]) chargen.set(c.id as string, c)
  if (ids.some(i => !chargen.has(i))) {
    return { sperre: { grund: 'eine beteiligte Charge nicht (mehr) gefunden wurde', hinweis }, aenderungen: [], chargen }
  }

  // (1) Ziel-Chargen seit der Buchung weiterbewegt?
  for (const zielId of abgang.keys()) {
    const f = await spaetereMengenbewegungen(supabase, tenantId, zielId, seit, ohne)
    if (f.length > 0) {
      return {
        sperre: {
          grund: `die Ziel-Charge „${chargen.get(zielId)!.name}“ seither weiterbewegt wurde (${folgebuchungenText(f)})`,
          hinweis,
        },
        aenderungen: [],
        chargen,
      }
    }
  }

  // (2) Rückbuchung vollständig möglich? Kein Kappen bei 0.
  const aenderungen: ChargenRueckbuchung[] = []
  for (const id of ids) {
    const c = chargen.get(id)!
    const vorher = num(c.menge_liter)
    const ab = abgang.get(id) ?? 0
    const neuRoh = vorher + (zugang.get(id) ?? 0) - ab
    if (neuRoh < -TOLERANZ) {
      return {
        sperre: {
          grund: `die Ziel-Charge „${c.name}“ nur noch ${fmtNum(vorher, 2)} L Bestand hat, zurückzubuchen wären ${fmtNum(ab, 2)} L`,
          hinweis,
        },
        aenderungen: [],
        chargen,
      }
    }
    const neu = rund2(neuRoh)
    let payload: R
    if (neu <= TOLERANZ) {
      payload = { menge_liter: 0, aktiv: false, status: 'abgeschlossen' }
    } else {
      payload = { menge_liter: neu }
      if (!c.aktiv || c.status === 'abgeschlossen') {
        payload.aktiv = true
        if (c.status === 'abgeschlossen') payload.status = 'ausbau'
      }
    }
    aenderungen.push({ id, name: c.name, vorher, neu: neu <= TOLERANZ ? 0 : neu, payload, zeile: c })
  }
  // Zugänge zuerst: scheitert eine Reaktivierung an der Gebinde-Prüfung, ist noch nichts gebucht
  aenderungen.sort((a, b) => (b.neu - b.vorher) - (a.neu - a.vorher))
  return { sperre: null, aenderungen, chargen }
}

/** Vergleichen und Setzen: nur ändern, wenn menge_liter noch dem erwarteten Wert entspricht */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mitMengenPruefung(q: any, erwartet: unknown): any {
  if (erwartet == null) return q.is('menge_liter', null)
  const n = num(erwartet)
  return q.gte('menge_liter', n - 0.001).lte('menge_liter', n + 0.001)
}

/**
 * Bereits ausgeführte Rückbuchungen zurücknehmen (umgekehrte Reihenfolge, je Charge die
 * geänderten Felder auf den beim Planen gelesenen Stand – nur, wenn die Charge noch auf dem
 * gebuchten Stand ist). Liefert die Fehlschläge als Text (leer = alles zurückgenommen).
 */
export async function rueckbuchungZuruecknehmen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  angewandt: ChargenRueckbuchung[],
): Promise<string[]> {
  const fehler: string[] = []
  for (const a of [...angewandt].reverse()) {
    const zurueck: R = {}
    for (const k of Object.keys(a.payload)) zurueck[k] = a.zeile[k] ?? null
    const { data, error } = await mitMengenPruefung(
      (supabase.from('weinausbau') as any).update(zurueck).eq('id', a.id).eq('tenant_id', tenantId),
      a.payload.menge_liter ?? a.zeile.menge_liter,
    ).select('id')
    if (error) fehler.push(`„${a.name}“: ${dbFehlerText(error).replace(/[.\s]+$/, '')}`)
    else if (!(data as R[] | null)?.length) fehler.push(`„${a.name}“: inzwischen geändert`)
  }
  return fehler
}

function mitRuecknahmeText(meldung: string, rueckFehler: string[]): string {
  const m = meldung.replace(/[.\s]+$/, '')
  return rueckFehler.length
    ? `${m}. Achtung: Bereits zurückgebuchte Chargen konnten nicht zurückgesetzt werden (${rueckFehler.join(' · ')}) – bitte die Bestände prüfen und Support kontaktieren.`
    : `${m}. Es wurde nichts geändert.`
}

/**
 * Rückbuchung ausführen – alles oder nichts: jede Änderung per Vergleichen und Setzen gegen
 * den geplanten Bestand; scheitert eine, werden die bereits ausgeführten zurückgenommen und
 * der Fehler geworfen. Liefert die ausgeführten Änderungen (für eine spätere Rücknahme, z. B.
 * wenn danach das Löschen der Buchung scheitert).
 */
export async function fuehreRueckbuchungAus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  aenderungen: ChargenRueckbuchung[],
): Promise<ChargenRueckbuchung[]> {
  const angewandt: ChargenRueckbuchung[] = []
  for (const a of aenderungen) {
    const { data, error } = await mitMengenPruefung(
      (supabase.from('weinausbau') as any).update(a.payload).eq('id', a.id).eq('tenant_id', tenantId),
      a.zeile.menge_liter,
    ).select('id')
    let meldung: string | null = null
    if (error) meldung = gebindeFehlerText(dbFehlerText(error, `Rückbuchung auf die Charge „${a.name}“ fehlgeschlagen`))
    else if (!data || (data as R[]).length === 0) {
      meldung = `Rückbuchung auf die Charge „${a.name}“ fehlgeschlagen: Der Bestand der Charge wurde inzwischen geändert (oder es fehlt die Berechtigung) – bitte Seite neu laden und erneut versuchen`
    }
    if (meldung) {
      const rueckFehler = await rueckbuchungZuruecknehmen(supabase, tenantId, angewandt)
      throw new AktionsFehler(mitRuecknahmeText(meldung, rueckFehler))
    }
    angewandt.push(a)
  }
  return angewandt
}

/**
 * Buchung nach der Rückbuchung als storniert kennzeichnen (KAN-145) – Grund Pflicht, Zeitpunkt und Benutzer setzt
 * die Datenbank. Nur Zeilen, die noch nicht storniert sind (gleichzeitiger zweiter Storno: 0 Zeilen). Scheitert
 * das Kennzeichnen, wird die Rückbuchung zurückgenommen – die Buchung bleibt dann samt Beständen unverändert.
 */
async function kennzeichneNachRueckbuchung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  tabelle: 'keller_umzuege' | 'verschneidungen',
  ids: string[],
  grund: string,
  angewandt: ChargenRueckbuchung[],
): Promise<void> {
  const { data, error } = await (supabase.from(tabelle) as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .in('id', ids)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
    .select('id')
  const anzahl = ((data ?? []) as R[]).length
  if (!error && anzahl === ids.length) return
  if (!error && anzahl > 0) {
    // Teilweise gekennzeichnet (nur bei gleichzeitiger Änderung denkbar) – nicht mehr automatisch lösbar
    throw new AktionsFehler('Die Buchung wurde nur teilweise storniert (gleichzeitige Änderung?) – die Bestände wurden bereits zurückgebucht. Bitte Support kontaktieren.')
  }
  const meldung = error
    ? dbFehlerText(error, `Stornieren fehlgeschlagen (${tabelle})`)
    : 'Die Buchung konnte nicht storniert werden – sie ist bereits storniert oder es fehlt die Berechtigung'
  const rueckFehler = await rueckbuchungZuruecknehmen(supabase, tenantId, angewandt)
  throw new AktionsFehler(mitRuecknahmeText(meldung, rueckFehler))
}

/** Verschnitt stornieren: Rückbuchung (inkl. Snapshot-Werte am Ziel) und Storno-Kennzeichen, alles oder nichts */
export async function storniereVerschneidung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  plan: VerschneidungStornoPlan,
  grund: string,
): Promise<void> {
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)
  if (plan.sperre) throw new AktionsFehler(verschneidungSperrMeldung(plan))
  const angewandt = await fuehreRueckbuchungAus(supabase, tenantId, plan.aenderungen)
  await kennzeichneNachRueckbuchung(supabase, tenantId, 'verschneidungen', [plan.verschneidung.id as string], grund, angewandt)
}

/** Deutsche Meldung, wenn ein Verschnitt nicht storniert werden kann */
export function verschneidungSperrMeldung(plan: VerschneidungStornoPlan): string {
  if (!plan.sperre) return ''
  return `Die Verschneidung vom ${datumText(plan.datum)} ist nicht mehr stornierbar, weil ${plan.sperre.grund}. ${plan.sperre.hinweis}`
}

// ── Umzug ─────────────────────────────────────────────────────────────────────

const UMZUG_SPALTEN =
  'id, datum, erstellt_am, zeilen_typ, umzug_typ, umzug_batch_id, von_weinausbau_id, nach_weinausbau_id, von_behaelter_id, nach_behaelter_id, brutto_liter, menge_liter, schwund_liter, notizen, qualitaet_vorher, qualitaet_nachher, herkunft_code_vorher, herkunft_code_nachher'

/** Alle Zeilen der Umzugsbuchung (ganzer Batch) zu einer Zeile – null, wenn nicht gefunden */
export async function ladeUmzugZeilen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  umzugId: string,
): Promise<R[] | null> {
  // storno-sichtbar: lädt die Zeile auch storniert, um „bereits storniert“ zu melden
  const { data: rec, error } = await (supabase.from('keller_umzuege') as any)
    .select('id, umzug_batch_id, storniert_am')
    .eq('id', umzugId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Umzug konnte nicht geladen werden'))
  if (!rec) return null
  if ((rec as R).storniert_am) throw new AktionsFehler('Diese Buchung ist bereits storniert.')
  const batchId = (rec as R).umzug_batch_id as string | null
  let q = (supabase.from('keller_umzuege') as any).select(UMZUG_SPALTEN).eq('tenant_id', tenantId).is('storniert_am', null)
  q = batchId ? q.eq('umzug_batch_id', batchId) : q.eq('id', umzugId)
  const { data, error: e } = await q.order('erstellt_am', { ascending: true }).order('id', { ascending: true })
  if (e) throw new AktionsFehler(dbFehlerText(e, 'Umzug konnte nicht geladen werden'))
  const alle = (data ?? []) as R[]
  return alle.length > 0 ? alle : null
}

/** Prüft, ob der Umzug storniert (bzw. in Menge/Datum geändert) werden darf, und berechnet die Rückbuchung */
export async function planeUmzugStorno(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  zeilenDerBuchung: R[],
): Promise<UmzugStornoPlan> {
  const batchId = (zeilenDerBuchung[0]?.umzug_batch_id as string | null) ?? null
  const datum = ((zeilenDerBuchung.find(z => z.zeilen_typ === 'quelle') ?? zeilenDerBuchung[0])?.datum as string | null) ?? null
  const istSchwund = zeilenDerBuchung.some(z => z.umzug_typ === 'schwund')
  const basis: UmzugStornoPlan = { zeilen: zeilenDerBuchung, batchId, datum, istSchwund, sperre: null, aenderungen: [] }

  if (istSchwund) return planeSchwundStorno(supabase, tenantId, basis)
  const neuesFormat = zeilenDerBuchung.some(z => z.zeilen_typ === 'quelle' || z.zeilen_typ === 'ziel')
  if (!neuesFormat) {
    return {
      ...basis,
      sperre: {
        grund: 'es eine ältere Umzugsbuchung ohne getrennte Quell- und Zielzeilen ist und die Rückbuchung nicht eindeutig bestimmt werden kann',
        hinweis: GEGENBUCHUNG_HINWEIS,
      },
    }
  }

  const zugang = new Map<string, number>()
  const abgang = new Map<string, number>()
  for (const z of zeilenDerBuchung) {
    if (z.zeilen_typ === 'quelle' && z.von_weinausbau_id) {
      const brutto = num(z.brutto_liter) || num(z.menge_liter)
      if (brutto > 0) zugang.set(z.von_weinausbau_id, (zugang.get(z.von_weinausbau_id) ?? 0) + brutto)
    } else if (z.zeilen_typ === 'ziel') {
      const netto = num(z.menge_liter)
      if (netto <= 0) continue
      if (!z.nach_weinausbau_id) {
        return { ...basis, sperre: { grund: 'die Ziel-Charge in der Buchung fehlt', hinweis: GEGENBUCHUNG_HINWEIS } }
      }
      abgang.set(z.nach_weinausbau_id, (abgang.get(z.nach_weinausbau_id) ?? 0) + netto)
    }
  }

  // Erfassungszeitpunkt = früheste Zeile der Buchung; fehlt einer, zählt jede andere Bewegung
  const zeiten = zeilenDerBuchung.map(z => Date.parse(String(z.erstellt_am ?? '')))
  const seit = zeiten.every(t => !Number.isNaN(t)) ? new Date(Math.min(...zeiten)).toISOString() : null
  const { sperre, aenderungen, chargen } = await planeRueckbuchung(supabase, tenantId, zugang, abgang, seit, {
    umzugZeilenIds: zeilenDerBuchung.map(z => z.id as string),
  })
  if (!sperre) nimmAbstufungZurueck(zeilenDerBuchung, aenderungen, chargen)
  return { ...basis, sperre, aenderungen }
}

/**
 * Schwundbuchung stornieren? Nur, wenn sie nachweislich den Bestand gemindert hat
 * (Bestandsprotokoll: weinausbau-Änderung von menge_liter mit identischem Zeitstempel –
 * schwund_buchen ändert Zeile und Charge in einer Transaktion) und an der Charge seither
 * nichts erfasst wurde. Zurückgebucht wird genau die protokollierte Minderung samt
 * aktiv/Status. Das Protokoll lesen nur Betriebs-Manager (RLS) – für alle anderen bleibt
 * die Buchung gesperrt.
 */
async function planeSchwundStorno(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  basis: UmzugStornoPlan,
): Promise<UmzugStornoPlan> {
  const gesperrt = (grund: string): UmzugStornoPlan => ({ ...basis, sperre: { grund, hinweis: SCHWUND_SPERR_HINWEIS } })
  const z = basis.zeilen[0]
  const chargeId = z?.von_weinausbau_id as string | null
  if (basis.zeilen.length !== 1 || !chargeId || !UUID_RE.test(chargeId) || !z.erstellt_am) {
    return gesperrt('sie keiner Charge eindeutig zugeordnet ist')
  }

  // KAN-145 B4: protokollierte Minderung über die RPC (Rolle, Betrieb, Schreibmodul) statt direkt aus dem Protokoll
  const { data: prot, error: protErr } = await (supabase.rpc as any)('s112_schwund_minderung', { p_tenant_id: tenantId, p_umzug_id: z.id })
  if (protErr) return gesperrt(`das Bestandsprotokoll nicht gelesen werden konnte (${dbFehlerText(protErr).replace(/[.\s]+$/, '')})`)
  const protZeilen = (Array.isArray(prot) ? prot : []) as R[]
  if (protZeilen.length !== 1) {
    return gesperrt('nicht nachvollziehbar ist, dass sie den Bestand der Charge gemindert hat (Nachbuchung ins Bewegungsbuch oder Buchung vor dem 24.09.2026)')
  }
  const alt = (protZeilen[0].alt ?? {}) as R
  const neu = (protZeilen[0].neu ?? {}) as R
  const minderung = rund2(num(alt.menge_liter) - num(neu.menge_liter))
  if (!(minderung >= 0.01)) return gesperrt('sie den Bestand der Charge laut Protokoll nicht gemindert hat')

  const spaeter = await spaetereMengenbewegungen(supabase, tenantId, chargeId, String(z.erstellt_am), { umzugZeilenIds: [z.id as string] })
  if (spaeter.length > 0) return gesperrt(`an der Charge seither weitergebucht wurde (${folgebuchungenText(spaeter)})`)

  const { data: cRaw, error: cErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter, aktiv, status, qualitaetsstufe, herkunft_code, notizen')
    .eq('id', chargeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (cErr) throw new AktionsFehler(dbFehlerText(cErr, 'Charge konnte nicht geladen werden'))
  const c = cRaw as R | null
  if (!c) return gesperrt('die Charge nicht (mehr) gefunden wurde')
  const bestand = num(c.menge_liter)
  if (Math.abs(bestand - num(neu.menge_liter)) > 0.005) {
    return gesperrt(`sich der Bestand der Charge seither geändert hat (${fmtNum(bestand, 2)} L statt ${fmtNum(num(neu.menge_liter), 2)} L)`)
  }

  const nachher = rund2(bestand + minderung)
  const payload: R = { menge_liter: nachher }
  if ('aktiv' in alt) payload.aktiv = alt.aktiv
  if ('status' in alt) payload.status = alt.status
  // Mit Bestand nie inaktiv/abgeschlossen (Gebinde-Trigger prüft dann das Gebinde)
  if (nachher > TOLERANZ && (payload.aktiv ?? c.aktiv) === false) payload.aktiv = true
  if (nachher > TOLERANZ && (payload.status ?? c.status) === 'abgeschlossen') payload.status = 'ausbau'
  return { ...basis, aenderungen: [{ id: chargeId, name: c.name, vorher: bestand, neu: nachher, payload, zeile: c }] }
}

/** Menge, Gebinde und Datum nur änderbar, wenn stornierbar – Schwundbuchungen nie (nur Notizen, sonst stornieren) */
export function nurNotizenAenderbar(plan: UmzugStornoPlan): boolean {
  return plan.istSchwund || !!plan.sperre
}

/** Qualitätscode zu einer Bezeichnung aus QUALITAET_LABEL (umziehen() schreibt Label ?? Code) */
function qualitaetsCode(text: string): string | null {
  const t = text.trim()
  if (QUALITAET_LABEL[t]) return t
  return Object.entries(QUALITAET_LABEL).find(([, label]) => label === t)?.[0] ?? null
}

/**
 * Qualitätsabstufung einer zusammengeführten Ziel-Charge beim Storno zurücknehmen.
 * umziehen() vermerkt sie an der Zielzeile („Abstufung von X auf Y“) und in den Notizen der
 * Charge („Abstufung von X auf Y (Zusammenführung per Umziehen)“). Zurückgesetzt wird nur,
 * wenn beide Vermerke passen und die Charge noch auf Y steht (Storno setzt ohnehin voraus,
 * dass seither nichts mehr gebucht wurde) – sonst bleibt die Qualität unverändert.
 */
function nimmAbstufungZurueck(zeilenDerBuchung: R[], aenderungen: ChargenRueckbuchung[], chargen: Map<string, R>): void {
  for (const z of zeilenDerBuchung) {
    if (z.zeilen_typ !== 'ziel' || !z.nach_weinausbau_id) continue
    // KAN-94 (01.10.2026): Herkunft-Abstufung der Zusammenführung zurücknehmen – Momentaufnahme
    // herkunft_code_vorher/_nachher an der Ziel-Zeile, nur wenn die Charge noch auf „nachher“ steht
    if (z.herkunft_code_nachher && z.herkunft_code_vorher !== z.herkunft_code_nachher) {
      const a = aenderungen.find(x => x.id === z.nach_weinausbau_id)
      const c = chargen.get(z.nach_weinausbau_id)
      if (a && c && a.neu > TOLERANZ && c.herkunft_code === z.herkunft_code_nachher) a.payload.herkunft_code = z.herkunft_code_vorher ?? null
    }
    // KAN-145: Momentaufnahme der Ziel-Charge an der Ziel-Zeile (ab 30.09.2026) – zurück, wenn sie noch auf „nachher“ steht
    if (z.qualitaet_vorher && z.qualitaet_nachher && z.qualitaet_vorher !== z.qualitaet_nachher) {
      const a = aenderungen.find(x => x.id === z.nach_weinausbau_id)
      const c = chargen.get(z.nach_weinausbau_id)
      if (a && c && a.neu > TOLERANZ && c.qualitaetsstufe === z.qualitaet_nachher) a.payload.qualitaetsstufe = z.qualitaet_vorher
      continue
    }
    const m = /^Abstufung von (.+) auf (.+)$/.exec(String(z.notizen ?? '').trim())
    if (!m) continue
    const a = aenderungen.find(x => x.id === z.nach_weinausbau_id)
    const c = chargen.get(z.nach_weinausbau_id)
    if (!a || !c || a.neu <= TOLERANZ) continue
    const vonCode = qualitaetsCode(m[1])
    const nachCode = qualitaetsCode(m[2])
    const vermerk = `Abstufung von ${m[1]} auf ${m[2]} (Zusammenführung per Umziehen)`
    if (vonCode && nachCode && c.qualitaetsstufe === nachCode && String(c.notizen ?? '').includes(vermerk)) {
      a.payload.qualitaetsstufe = vonCode
    }
  }
}

/**
 * Umzug (bzw. Schwundbuchung) stornieren: Rückbuchung ausführen, dann die Zeilen der Buchung als storniert
 * kennzeichnen (KAN-145). Alles oder nichts – scheitert das Kennzeichnen, wird die Rückbuchung zurückgenommen.
 */
export async function storniereUmzug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  plan: UmzugStornoPlan,
  grund: string,
): Promise<void> {
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)
  if (plan.sperre) throw new AktionsFehler(umzugSperrMeldung(plan, 'stornieren'))
  const angewandt = await fuehreRueckbuchungAus(supabase, tenantId, plan.aenderungen)
  await kennzeichneNachRueckbuchung(supabase, tenantId, 'keller_umzuege', plan.zeilen.map(z => z.id as string), grund, angewandt)
}

/** Deutsche Meldung, wenn ein Umzug (bzw. eine Schwundbuchung) gesperrt ist */
export function umzugSperrMeldung(plan: UmzugStornoPlan, vorgang: 'stornieren' | 'aendern' | 'datum'): string {
  const sperre = plan.sperre
  const d = datumText(plan.datum)
  if (plan.istSchwund) {
    // Menge und Datum einer Schwundbuchung sind nie änderbar – nur stornieren und neu erfassen
    if (vorgang === 'aendern') return `Menge und Datum der Schwundbuchung vom ${d} können nicht geändert werden – die Notizen lassen sich weiterhin ändern. ${SCHWUND_STORNO_HINWEIS}`
    if (vorgang === 'datum') return `Das Datum der Schwundbuchung vom ${d} kann nicht geändert werden – die Notizen lassen sich weiterhin ändern. ${SCHWUND_STORNO_HINWEIS}`
    return sperre ? `Die Schwundbuchung vom ${d} kann nicht storniert werden, weil ${sperre.grund}. ${sperre.hinweis}` : ''
  }
  if (!sperre) return ''
  if (vorgang === 'stornieren') return `Der Umzug vom ${d} ist nicht mehr stornierbar, weil ${sperre.grund}. ${sperre.hinweis}`
  if (vorgang === 'aendern') return `Menge, Gebinde und Datum des Umzugs vom ${d} können nicht mehr geändert werden, weil ${sperre.grund}. Die Notizen lassen sich weiterhin ändern. ${sperre.hinweis}`
  return `Das Datum des Umzugs vom ${d} kann nicht mehr geändert werden, weil ${sperre.grund}. Die Notizen lassen sich weiterhin ändern.`
}

/** Umzug in der Form des Bearbeiten-Formulars (Quellen brutto, Ziele netto) */
export function umzugAlsEingabe(zeilenDerBuchung: R[]): UmzugEingabe {
  const neuesFormat = zeilenDerBuchung.some(z => z.zeilen_typ === 'quelle' || z.zeilen_typ === 'ziel')
  if (neuesFormat) {
    const quelle = zeilenDerBuchung.filter(z => z.zeilen_typ === 'quelle')
    const ziel = zeilenDerBuchung.filter(z => z.zeilen_typ === 'ziel')
    return {
      quellen: quelle.map(z => ({ weinausbau_id: z.von_weinausbau_id ?? '', brutto: num(z.brutto_liter) })),
      ziele: ziel.map(z => ({ behaelter_id: z.nach_behaelter_id ?? '', menge_netto: num(z.menge_liter) })),
      datum: quelle[0]?.datum ?? zeilenDerBuchung[0]?.datum ?? '',
      notizen: quelle[0]?.notizen ?? '',
      ersteId: quelle[0]?.id ?? zeilenDerBuchung[0]?.id,
    }
  }
  // Altes Format: alle Zeilen teilen dieselbe Quelle, jede Zeile hat ein Ziel
  const haupt = zeilenDerBuchung.find(z => z.brutto_liter != null) ?? zeilenDerBuchung[0]
  const brutto = num(haupt?.brutto_liter)
    || zeilenDerBuchung.reduce((s, z) => s + num(z.menge_liter) + num(z.schwund_liter), 0)
  return {
    quellen: [{ weinausbau_id: haupt?.von_weinausbau_id ?? '', brutto }],
    ziele: zeilenDerBuchung.map(z => ({ behaelter_id: z.nach_behaelter_id ?? '', menge_netto: num(z.menge_liter) })),
    datum: zeilenDerBuchung[0]?.datum ?? '',
    notizen: haupt?.notizen ?? '',
    ersteId: zeilenDerBuchung[0]?.id,
  }
}

// ── Verschnitt ────────────────────────────────────────────────────────────────

/** Prüft, ob der Verschnitt storniert werden darf, und berechnet die Rückbuchung */
export async function planeVerschneidungStorno(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  verschneidungId: string,
): Promise<VerschneidungStornoPlan> {
  // storno-sichtbar: lädt den Verschnitt auch storniert, um „bereits storniert“ zu melden
  const { data, error } = await (supabase.from('verschneidungen') as any)
    .select('id, datum, created_at, storniert_am, ziel_weinausbau_id, ziel_qualitaet_vorher, ziel_herkunft_code_vorher, ziel_rebsorte_vorher, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter)')
    .eq('id', verschneidungId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Verschneidung konnte nicht geladen werden'))
  if (!data) throw new AktionsFehler('Verschneidung nicht gefunden')
  const v = data as R
  if (v.storniert_am) throw new AktionsFehler('Diese Verschneidung ist bereits storniert.')
  const basis: VerschneidungStornoPlan = { verschneidung: v, datum: v.datum ?? null, sperre: null, aenderungen: [] }

  const zugang = new Map<string, number>()
  let summe = 0
  for (const q of (v.quellen ?? []) as R[]) {
    const menge = num(q.menge_liter)
    if (!q.quell_weinausbau_id || menge <= 0) continue
    zugang.set(q.quell_weinausbau_id, (zugang.get(q.quell_weinausbau_id) ?? 0) + menge)
    summe += menge
  }
  const abgang = new Map<string, number>()
  if (summe > 0) {
    if (!v.ziel_weinausbau_id) return { ...basis, sperre: { grund: 'die Ziel-Charge fehlt', hinweis: VERSCHNITT_HINWEIS } }
    abgang.set(v.ziel_weinausbau_id, summe)
  }

  const { sperre, aenderungen } = await planeRueckbuchung(supabase, tenantId, zugang, abgang, v.created_at ?? null, {
    verschneidungId: v.id,
  }, VERSCHNITT_HINWEIS)

  // Qualitätsstufe und Herkunft-Code der Ziel-Charge aus dem Snapshot wiederherstellen –
  // in derselben Änderung wie die Mengen-Rückbuchung (wird bei einem Fehler mit zurückgenommen)
  if (!sperre) {
    const ziel = aenderungen.find(a => a.id === v.ziel_weinausbau_id)
    if (ziel) {
      if (v.ziel_qualitaet_vorher) ziel.payload.qualitaetsstufe = v.ziel_qualitaet_vorher
      if (v.ziel_herkunft_code_vorher) ziel.payload.herkunft_code = v.ziel_herkunft_code_vorher
      // KAN-145: Rebsorte (Momentaufnahme ab 30.09.2026; ältere Verschnitte haben keine – dann unverändert)
      if (v.ziel_rebsorte_vorher) ziel.payload.rebsorte = v.ziel_rebsorte_vorher
    }
  }
  return { ...basis, sperre, aenderungen }
}
