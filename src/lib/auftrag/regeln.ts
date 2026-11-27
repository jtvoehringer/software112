// ── Auftrag mit Bestandsreservierung (KAN-418 Teil 1, 12.11.2026) ────────────────────────────────────────────────────
//
// Ein Auftrag reserviert Flaschen einer Füllung. Der Lagerbestand bleibt, der VERFÜGBARE Bestand sinkt:
//   verfügbar = Bestand − reserviert        (reserviert = offene Mengen aller nicht stornierten, nicht ganz gelieferten Aufträge)
// Ein Verkauf darf nicht in fremde Reservierungen hineinverkaufen (s112_fuellung_verkauf_buchen, HINT reserviert).
// Entscheidungen Jörgen (Ticket, 11./12.11.2026): Reservierung mit Ablaufdatum, Standard 14 Tage; eine abgelaufene
// Reservierung bleibt bestehen, bis jemand verlängert oder storniert.
// KAN-487 (27.11.2026): Ein Auftrag trägt Preise je Position (Momentaufnahme wie am Angebot, vorbelegt und änderbar) und
// die Lieferbedingungen als Pflicht-Freitext – beides steht auf der Auftragsbestätigung. Das löst „Preise entstehen erst
// bei der Lieferung“ ab; bei „Liefern“ sind die Auftragspreise der Vorschlag (änderbar).
// Dieselben Regeln in Formular, Server Action und Datenbank (s112_auftrag_anlegen). Isomorph, ohne '@/'-Importe.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { angebotPositionenAus, angebotPositionenFuerDb, zahlFeld, type AngebotPosition } from './angebot.ts'

export const RESERVIERUNG_TAGE = 14
/** Grenzen der Standardfrist je Betrieb (tenant_einstellungen.auftrag_reservierung_tage, CHECK in der Datenbank) */
export const RESERVIERUNG_TAGE_MIN = 1
export const RESERVIERUNG_TAGE_MAX = 365
export const AUFTRAG_POSITIONEN_MAX = 100
export const AUFTRAG_NOTIZ_MAX = 2000
export const AUFTRAG_STORNO_GRUND_MIN = 10
/** KAN-487: Lieferbedingungen – Freitext, Pflicht (CHECK auftraege_lieferbedingungen_chk) */
export const LIEFERBEDINGUNGEN_MAX = 300

export type AuftragStatus = 'offen' | 'teilgeliefert' | 'geliefert' | 'abgeschlossen' | 'storniert'
export const AUFTRAG_STATUS_LABEL: Record<AuftragStatus, string> = {
  offen: 'Offen', teilgeliefert: 'Teilweise geliefert', geliefert: 'Geliefert', abgeschlossen: 'Abgeschlossen', storniert: 'Storniert',
}
/** Status, in denen ein Auftrag Flaschen reserviert */
export const RESERVIERT_STATUS: readonly AuftragStatus[] = ['offen', 'teilgeliefert']

/** KAN-487: wie am Angebot – Füllung, Flaschen und die Preise als Momentaufnahme */
export type AuftragPosition = AngebotPosition

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG = /^\d{4}-\d{2}-\d{2}$/

/** Positionen aus dem Formularfeld (JSON); ganz leere Zeilen fallen weg, null = nicht lesbar */
export function auftragPositionenAus(roh: unknown): AuftragPosition[] | null {
  return angebotPositionenAus(roh)
}

/** Positionen in der Form, die die Datenbank erwartet (Zahlen als Text mit Dezimalpunkt) */
export function auftragPositionenFuerDb(positionen: readonly AuftragPosition[]): Record<string, string>[] {
  return angebotPositionenFuerDb(positionen)
}

/** Prüfung der Preisfelder einer Position; null = in Ordnung (dieselben Grenzen wie am Angebot und in der Datenbank) */
export function preisFehler(p: { preis_brutto: number; rabatt_pct: number; sonderrabatt_pct: number; ust_satz: number }, nr: string): string | null {
  if (!Number.isFinite(p.preis_brutto) || p.preis_brutto < 0) return `${nr}: Bitte einen Preis je Flasche angeben (höchstens zwei Nachkommastellen).`
  if (!Number.isFinite(p.rabatt_pct) || p.rabatt_pct < 0 || p.rabatt_pct > 100) return `${nr}: Der Rabatt muss zwischen 0 und 100 % liegen.`
  if (!Number.isFinite(p.sonderrabatt_pct) || p.sonderrabatt_pct < 0 || p.sonderrabatt_pct > 100) return `${nr}: Der Sonderrabatt muss zwischen 0 und 100 % liegen.`
  if (!Number.isFinite(p.ust_satz) || p.ust_satz < 0 || p.ust_satz > 100) return `${nr}: Bitte den Steuersatz angeben.`
  return null
}

/** Prüfung der Lieferbedingungen (Pflicht, Freitext); null = in Ordnung */
export function lieferbedingungenFehler(text: unknown): string | null {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return 'Bitte die Lieferbedingungen angeben.'
  if (t.length > LIEFERBEDINGUNGEN_MAX) return `Die Lieferbedingungen dürfen höchstens ${LIEFERBEDINGUNGEN_MAX} Zeichen lang sein.`
  return null
}

/** Fehlt dem Auftrag etwas für die Auftragsbestätigung? (Aufträge vor KAN-487: keine Lieferbedingungen, ohne Angebot keine Preise) */
export function auftragUnvollstaendig(a: { lieferbedingungen?: unknown }, positionen: readonly { preis_brutto?: unknown; ust_satz?: unknown }[]): boolean {
  const leer = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  return leer(a.lieferbedingungen) || positionen.some(p => leer(p.preis_brutto) || leer(p.ust_satz))
}

/** Ergänzen ist nur möglich, solange der Auftrag Flaschen reserviert (wie s112_auftrag_ergaenzen) */
export function auftragErgaenzbar(a: { status?: string | null; storniert_am?: string | null }): boolean {
  return !a.storniert_am && (a.status === 'offen' || a.status === 'teilgeliefert')
}

export type ErgaenzPosition = { position_id: string; preis_brutto: number; rabatt_pct: number; sonderrabatt_pct: number; ust_satz: number }

/** Preise je bestehender Position aus dem Formularfeld (JSON); null = nicht lesbar */
export function ergaenzPositionenAus(roh: unknown): ErgaenzPosition[] | null {
  if (typeof roh !== 'string') return null
  let daten: unknown
  try { daten = JSON.parse(roh) } catch { return null }
  if (!Array.isArray(daten)) return null
  const aus: ErgaenzPosition[] = []
  for (const z of daten) {
    if (!z || typeof z !== 'object' || Array.isArray(z)) return null
    const r = z as Record<string, unknown>
    const id = typeof r.position_id === 'string' ? r.position_id.trim() : ''
    if (!UUID.test(id)) return null
    aus.push({
      position_id: id, preis_brutto: zahlFeld(r.preis_brutto, null), rabatt_pct: zahlFeld(r.rabatt_pct, 0),
      sonderrabatt_pct: zahlFeld(r.sonderrabatt_pct, 0), ust_satz: zahlFeld(r.ust_satz, null),
    })
  }
  return aus
}

/** Prüfung beim Ergänzen eines bestehenden Auftrags; null = in Ordnung */
export function ergaenzFehler(lieferbedingungen: unknown, positionen: ErgaenzPosition[] | null): string | null {
  const lb = lieferbedingungenFehler(lieferbedingungen)
  if (lb) return lb
  const unlesbar = 'Die Positionen konnten nicht gelesen werden – bitte die Seite neu laden.'
  if (positionen === null || positionen.length === 0) return unlesbar
  if (new Set(positionen.map(p => p.position_id)).size !== positionen.length) return unlesbar
  for (const [i, p] of positionen.entries()) {
    const f = preisFehler(p, `Position ${i + 1}`)
    if (f) return f
  }
  return null
}

/** Ergänzte Preise in der Form, die die Datenbank erwartet (Zahlen als Text mit Dezimalpunkt) */
export function ergaenzPositionenFuerDb(positionen: readonly ErgaenzPosition[]): Record<string, string>[] {
  const db = angebotPositionenFuerDb(positionen.map(p => ({ ...p, fuellung_id: '', menge: 1 })))
  return positionen.map((p, i) => ({
    position_id: p.position_id, preis_brutto: db[i].preis_brutto, rabatt_pct: db[i].rabatt_pct,
    sonderrabatt_pct: db[i].sonderrabatt_pct, ust_satz: db[i].ust_satz,
  }))
}

/** Datum + Tage als JJJJ-MM-TT (rein auf Kalendertagen, UTC-Mitternacht) */
export function tagPlus(tag: string, tage: number): string {
  const d = new Date(`${tag}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)   // datum-ok: Rechnen auf reinen Daten über UTC-Mitternacht
}

/** Standardfrist des Betriebs in Tagen (KAN-418 Teil 5); alles außerhalb 1–365 bzw. keine ganze Zahl → 14 */
export function reservierungTage(wert: unknown): number {
  const n = typeof wert === 'number' ? wert : typeof wert === 'string' && /^\d{1,3}$/.test(wert.trim()) ? Number(wert.trim()) : NaN
  return Number.isInteger(n) && n >= RESERVIERUNG_TAGE_MIN && n <= RESERVIERUNG_TAGE_MAX ? n : RESERVIERUNG_TAGE
}

/** Vorgeschlagenes Ende der Reservierung (Frist des Betriebs, sonst 14 Tage) */
export function reserviertBisVorschlag(datum: string, tage: unknown = RESERVIERUNG_TAGE): string {
  return tagPlus(datum, reservierungTage(tage))
}

/** Tage zwischen zwei Kalendertagen (bis − von), rein auf Daten über UTC-Mitternacht */
export function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86400000)
}

export type AbgelaufeneReservierung = { id: string; nummer: string; kunde: string; reserviertBis: string; tage: number; offen: number }

/** Dashboard-Hinweis: Text für n abgelaufene Reservierungen */
export function abgelaufenText(n: number): string {
  return n === 1 ? '1 Reservierung abgelaufen' : `${n} Reservierungen abgelaufen`
}

export type AuftragKopf = { kunde: string; datum: string; reserviert_bis: string; lieferbedingungen: string; notizen?: string | null }

/** Prüfung des Auftrags; null = in Ordnung. `verfuegbar` je Füllung (Bestand − reserviert), wenn bekannt. */
export function auftragFehler(kopf: AuftragKopf, positionen: AuftragPosition[] | null, heute: string,
  verfuegbar?: ReadonlyMap<string, { name: string; verfuegbar: number }>): string | null {
  if (!kopf.kunde) return 'Bitte einen Kunden wählen.'
  if (!TAG.test(kopf.datum)) return 'Bitte ein Auftragsdatum angeben.'
  if (kopf.datum > heute) return 'Das Auftragsdatum darf nicht in der Zukunft liegen.'
  if (!TAG.test(kopf.reserviert_bis)) return 'Bitte angeben, bis wann die Flaschen reserviert bleiben.'
  if (kopf.reserviert_bis < heute) return 'Die Reservierung muss mindestens bis heute gelten.'
  const lb = lieferbedingungenFehler(kopf.lieferbedingungen)   // KAN-487
  if (lb) return lb
  if ((kopf.notizen ?? '').length > AUFTRAG_NOTIZ_MAX) return `Die Notiz darf höchstens ${AUFTRAG_NOTIZ_MAX} Zeichen lang sein.`
  if (positionen === null) return 'Die Positionen konnten nicht gelesen werden – bitte die Seite neu laden.'
  if (positionen.length === 0) return 'Bitte mindestens eine Position angeben.'
  if (positionen.length > AUFTRAG_POSITIONEN_MAX) return `Höchstens ${AUFTRAG_POSITIONEN_MAX} Positionen je Auftrag.`
  const summe = new Map<string, number>()
  for (const [i, p] of positionen.entries()) {
    if (!p.fuellung_id) return 'Bitte je Position eine Füllung wählen.'
    if (!Number.isInteger(p.menge) || p.menge < 1) return 'Bitte je Position eine Menge ab 1 Flasche angeben.'
    const pf = preisFehler(p, `Position ${i + 1}`)   // KAN-487
    if (pf) return pf
    summe.set(p.fuellung_id, (summe.get(p.fuellung_id) ?? 0) + p.menge)
  }
  if (verfuegbar) {
    for (const [id, menge] of summe) {
      const v = verfuegbar.get(id)
      if (!v) return 'Eine der Füllungen gibt es nicht mehr – bitte die Seite neu laden.'
      if (menge > v.verfuegbar) return `„${v.name}“: nur noch ${Math.max(v.verfuegbar, 0)} Flaschen verfügbar, ${menge} angefragt.`
    }
  }
  return null
}

/** Offene (noch reservierte) Flaschen je Füllung aus den Positionen reservierender Aufträge */
export function reserviertJeFuellung(positionen: readonly { fuellung_id: string; menge: number; geliefert?: number | null }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of positionen) {
    const offen = Math.max(0, (Number(p.menge) || 0) - (Number(p.geliefert) || 0))
    if (offen > 0) m.set(p.fuellung_id, (m.get(p.fuellung_id) ?? 0) + offen)
  }
  return m
}

export function verfuegbar(bestand: number | null | undefined, reserviert: number | null | undefined): number {
  return (Number(bestand) || 0) - (Number(reserviert) || 0)
}

/** Reservierung abgelaufen? (bleibt bestehen – nur Hinweis) */
export function reservierungAbgelaufen(a: { status: string; reserviert_bis?: string | null }, heute: string): boolean {
  return (RESERVIERT_STATUS as readonly string[]).includes(a.status) && !!a.reserviert_bis && a.reserviert_bis < heute
}

/** Prüfung einer geänderten Frist; null = in Ordnung */
export function fristFehler(bis: string, heute: string): string | null {
  if (!TAG.test(bis)) return 'Bitte ein Datum angeben.'
  if (bis < heute) return 'Die Reservierung muss mindestens bis heute gelten.'
  return null
}

export function stornoGrundFehlerAuftrag(grund: unknown): string | null {
  const t = typeof grund === 'string' ? grund.trim() : ''
  return t.length < AUFTRAG_STORNO_GRUND_MIN ? `Bitte einen Grund für den Storno angeben (mindestens ${AUFTRAG_STORNO_GRUND_MIN} Zeichen).` : null
}
