// ── Auftrag mit Bestandsreservierung (KAN-418 Teil 1, 12.11.2026) ────────────────────────────────────────────────────
//
// Ein Auftrag reserviert Flaschen einer Füllung. Der Lagerbestand bleibt, der VERFÜGBARE Bestand sinkt:
//   verfügbar = Bestand − reserviert        (reserviert = offene Mengen aller nicht stornierten, nicht ganz gelieferten Aufträge)
// Ein Verkauf darf nicht in fremde Reservierungen hineinverkaufen (s112_fuellung_verkauf_buchen, HINT reserviert).
// Entscheidungen Jörgen (Ticket, 11./12.11.2026): Reservierung mit Ablaufdatum, Standard 14 Tage; eine abgelaufene
// Reservierung bleibt bestehen, bis jemand verlängert oder storniert; Preise entstehen erst bei der Lieferung.
// Dieselben Regeln in Formular, Server Action und Datenbank (s112_auftrag_anlegen). Isomorph, ohne '@/'-Importe.

export const RESERVIERUNG_TAGE = 14
export const AUFTRAG_POSITIONEN_MAX = 100
export const AUFTRAG_NOTIZ_MAX = 2000
export const AUFTRAG_STORNO_GRUND_MIN = 10

export type AuftragStatus = 'offen' | 'teilgeliefert' | 'geliefert' | 'abgeschlossen' | 'storniert'
export const AUFTRAG_STATUS_LABEL: Record<AuftragStatus, string> = {
  offen: 'Offen', teilgeliefert: 'Teilweise geliefert', geliefert: 'Geliefert', abgeschlossen: 'Abgeschlossen', storniert: 'Storniert',
}
/** Status, in denen ein Auftrag Flaschen reserviert */
export const RESERVIERT_STATUS: readonly AuftragStatus[] = ['offen', 'teilgeliefert']

export type AuftragPosition = { fuellung_id: string; menge: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG = /^\d{4}-\d{2}-\d{2}$/

/** Positionen aus dem Formularfeld (JSON); leere Zeilen fallen weg, null = nicht lesbar */
export function auftragPositionenAus(roh: unknown): AuftragPosition[] | null {
  if (typeof roh !== 'string') return null
  let daten: unknown
  try { daten = JSON.parse(roh) } catch { return null }
  if (!Array.isArray(daten)) return null
  const aus: AuftragPosition[] = []
  for (const z of daten) {
    if (!z || typeof z !== 'object' || Array.isArray(z)) return null
    const r = z as Record<string, unknown>
    const f = typeof r.fuellung_id === 'string' ? r.fuellung_id.trim() : ''
    const leer = r.menge === '' || r.menge === null || r.menge === undefined
    if (!f && leer) continue
    if (f && !UUID.test(f)) return null
    const m = typeof r.menge === 'number' ? r.menge : typeof r.menge === 'string' && /^\d{1,7}$/.test(r.menge.trim()) ? Number(r.menge.trim()) : NaN
    aus.push({ fuellung_id: f, menge: m })
  }
  return aus
}

/** Datum + Tage als JJJJ-MM-TT (rein auf Kalendertagen, UTC-Mitternacht) */
export function tagPlus(tag: string, tage: number): string {
  const d = new Date(`${tag}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)   // datum-ok: Rechnen auf reinen Daten über UTC-Mitternacht
}

/** Vorgeschlagenes Ende der Reservierung */
export function reserviertBisVorschlag(datum: string): string {
  return tagPlus(datum, RESERVIERUNG_TAGE)
}

export type AuftragKopf = { kunde: string; datum: string; reserviert_bis: string; notizen?: string | null }

/** Prüfung des Auftrags; null = in Ordnung. `verfuegbar` je Füllung (Bestand − reserviert), wenn bekannt. */
export function auftragFehler(kopf: AuftragKopf, positionen: AuftragPosition[] | null, heute: string,
  verfuegbar?: ReadonlyMap<string, { name: string; verfuegbar: number }>): string | null {
  if (!kopf.kunde) return 'Bitte einen Kunden wählen.'
  if (!TAG.test(kopf.datum)) return 'Bitte ein Auftragsdatum angeben.'
  if (kopf.datum > heute) return 'Das Auftragsdatum darf nicht in der Zukunft liegen.'
  if (!TAG.test(kopf.reserviert_bis)) return 'Bitte angeben, bis wann die Flaschen reserviert bleiben.'
  if (kopf.reserviert_bis < heute) return 'Die Reservierung muss mindestens bis heute gelten.'
  if ((kopf.notizen ?? '').length > AUFTRAG_NOTIZ_MAX) return `Die Notiz darf höchstens ${AUFTRAG_NOTIZ_MAX} Zeichen lang sein.`
  if (positionen === null) return 'Die Positionen konnten nicht gelesen werden – bitte die Seite neu laden.'
  if (positionen.length === 0) return 'Bitte mindestens eine Position angeben.'
  if (positionen.length > AUFTRAG_POSITIONEN_MAX) return `Höchstens ${AUFTRAG_POSITIONEN_MAX} Positionen je Auftrag.`
  const summe = new Map<string, number>()
  for (const p of positionen) {
    if (!p.fuellung_id) return 'Bitte je Position eine Füllung wählen.'
    if (!Number.isInteger(p.menge) || p.menge < 1) return 'Bitte je Position eine Menge ab 1 Flasche angeben.'
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
