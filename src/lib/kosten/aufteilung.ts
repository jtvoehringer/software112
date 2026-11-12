// ── Ausgabe in die Kostenrechnung übernehmen (KAN-421, 12.11.2026) ───────────────────────────────────────────────────
//
// Beim Erfassen einer Ausgabe der E&A-Rechnung lässt sich der Nettobetrag auf Kostenstellen (und Kostenarten) aufteilen;
// je Zeile entsteht ein Kosteneintrag mit Verweis auf die Buchung (RPC s112_ea_kosten_zuordnen). Die Aufteilung ist
// freiwillig, die Summe darf den Nettobetrag nicht überschreiten – ein Rest bleibt ohne Kostenstelle.
// Dieselbe Prüfung in Formular, Server Action und Datenbank. Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – node:test lädt ohne Bundler, deshalb mit Endung
import { rund2 } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – wie oben
import { fmtNum, zahlAus } from '../format.ts'

export const KOSTEN_FELD = 'kosten_json'
export const KOSTEN_MAX_ZEILEN = 20

export type KostenZeile = { kostenstelle_id: string; kostenart_id: string | null; betrag: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Betrag aus dem Formular („1.234,50“ wie „1234.50“, lib/format); nicht lesbar → NaN */
function zahl(v: unknown): number {
  if (typeof v !== 'number' && typeof v !== 'string') return NaN
  return zahlAus(v) ?? NaN
}

/**
 * Zeilen aus dem Formularfeld (JSON). Leere Zeilen (keine Kostenstelle und kein Betrag) fallen weg;
 * null = nicht lesbar (verändertes Formular).
 */
export function kostenZeilenAus(roh: unknown): KostenZeile[] | null {
  if (roh === null || roh === undefined || roh === '') return []
  if (typeof roh !== 'string') return null
  let daten: unknown
  try { daten = JSON.parse(roh) } catch { return null }
  if (!Array.isArray(daten)) return null
  const zeilen: KostenZeile[] = []
  for (const z of daten) {
    if (!z || typeof z !== 'object' || Array.isArray(z)) return null
    const r = z as Record<string, unknown>
    const ks = typeof r.kostenstelle_id === 'string' ? r.kostenstelle_id.trim() : ''
    const ka = typeof r.kostenart_id === 'string' ? r.kostenart_id.trim() : ''
    const leer = r.betrag === '' || r.betrag === null || r.betrag === undefined
    if (!ks && leer) continue
    if (ks && !UUID.test(ks)) return null
    if (ka && !UUID.test(ka)) return null
    zeilen.push({ kostenstelle_id: ks, kostenart_id: ka || null, betrag: leer ? NaN : rund2(zahl(r.betrag)) })
  }
  return zeilen
}

export function kostenSumme(zeilen: readonly KostenZeile[]): number {
  return rund2(zeilen.reduce((s, z) => s + (Number.isFinite(z.betrag) ? z.betrag : 0), 0))
}

/** Rest des Nettobetrags ohne Kostenstelle (nie negativ angezeigt – ein Überhang ist ein Fehler) */
export function kostenRest(zeilen: readonly KostenZeile[], netto: number): number {
  return rund2((Number.isFinite(netto) ? netto : 0) - kostenSumme(zeilen))
}

const eur = (n: number) => fmtNum(n, { min: 2, max: 2 })

/** Prüfung der Aufteilung; null = in Ordnung (auch: keine Zeile) */
export function kostenAufteilungFehler(zeilen: readonly KostenZeile[] | null, typ: string, netto: number): string | null {
  if (zeilen === null) return 'Die Aufteilung auf Kostenstellen konnte nicht gelesen werden – bitte die Seite neu laden.'
  if (zeilen.length === 0) return null
  if (typ !== 'ausgabe') return 'Nur Ausgaben lassen sich in die Kostenrechnung übernehmen – bitte die Kostenstellen entfernen.'
  if (zeilen.length > KOSTEN_MAX_ZEILEN) return `Höchstens ${KOSTEN_MAX_ZEILEN} Kostenstellen je Buchung.`
  for (const z of zeilen) {
    if (!z.kostenstelle_id) return 'Bitte je Zeile eine Kostenstelle wählen.'
    if (!Number.isFinite(z.betrag) || z.betrag <= 0) return 'Bitte je Kostenstelle einen Betrag über 0 angeben.'
  }
  const summe = kostenSumme(zeilen)
  const grenze = rund2(Number.isFinite(netto) ? netto : 0)
  if (summe > grenze) return `Die Aufteilung auf Kostenstellen (${eur(summe)} €) ist höher als der Nettobetrag (${eur(grenze)} €).`
  return null
}

/** Zeilen für die RPC s112_ea_kosten_zuordnen */
export function kostenRpcZeilen(zeilen: readonly KostenZeile[]): { kostenstelle_id: string; kostenart_id: string | null; betrag: number }[] {
  return zeilen.map(z => ({ kostenstelle_id: z.kostenstelle_id, kostenart_id: z.kostenart_id, betrag: z.betrag }))
}

/** Kosteneintrag aus einer E&A-Buchung: Kennzeichen für die Liste der Kostenrechnung */
export function kostenHerkunft(e: { ea_transaktion_id?: string | null; buchung?: { storniert_am?: string | null; storno_von_id?: string | null } | null }):
  'manuell' | 'buchung' | 'storniert' | 'storno' {
  if (!e.ea_transaktion_id) return 'manuell'
  if (e.buchung?.storno_von_id) return 'storno'
  if (e.buchung?.storniert_am) return 'storniert'
  return 'buchung'
}
