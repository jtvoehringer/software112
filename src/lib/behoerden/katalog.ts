// ── Katalog aller Behördenmeldungen (isomorph, 24.09.2026) ──────────────────────
//
// id, Titel, Behörde, Zugriff und Druckpfad je Meldung – ohne Ladefunktionen, daher auch
// in Client-Komponenten nutzbar (Übersicht „Meldungen & Fristen“, Tab „Behörden“ in
// /reports, Befehlspalette). Gespeist aus je einer Datei katalog/<gruppe>.ts, damit die
// Gruppen parallel eintragen können. Die CSV selbst liefert ausschließlich die zentrale
// Route /meldungen/<id>/csv (Register: register.ts, server-only).

import type { KatalogEintrag, MeldungsGruppe } from './typen'
import { KATALOG_ERNTE } from './katalog/ernte'
import { KATALOG_PFLANZENSCHUTZ } from './katalog/pflanzenschutz'
import { KATALOG_VERKEHR } from './katalog/verkehr'
import { KATALOG_KELLERBUCH } from './katalog/kellerbuch'
import { KATALOG_BUCHHALTUNG } from './katalog/buchhaltung'
import { KATALOG_FLAECHEN } from './katalog/flaechen'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'

export type { KatalogEintrag, MeldungsGruppe, Zugriff } from './typen'

const GRUPPEN_KATALOGE: Record<string, KatalogEintrag>[] = [
  KATALOG_ERNTE, KATALOG_PFLANZENSCHUTZ, KATALOG_VERKEHR, KATALOG_KELLERBUCH, KATALOG_BUCHHALTUNG, KATALOG_FLAECHEN,
]

// Doppelte ids über Gruppen hinweg würden sich beim Zusammenführen still überschreiben –
// deshalb laut abbrechen (Fehler zeigt sich beim ersten Laden der Route/Übersicht).
;(function eindeutig() {
  const gesehen = new Map<string, MeldungsGruppe>()
  for (const k of GRUPPEN_KATALOGE) {
    for (const e of Object.values(k)) {
      const vorher = gesehen.get(e.id)
      if (vorher) throw new AktionsFehler(`Behördenmeldung „${e.id}“ ist doppelt registriert (${vorher} und ${e.gruppe})`)
      gesehen.set(e.id, e.gruppe)
    }
  }
})()

export const KATALOG = {
  ...KATALOG_ERNTE,
  ...KATALOG_PFLANZENSCHUTZ,
  ...KATALOG_VERKEHR,
  ...KATALOG_KELLERBUCH,
  ...KATALOG_BUCHHALTUNG,
  ...KATALOG_FLAECHEN,
}

/** Gültige Meldungs-ids (Tippfehler in csvPfad('…') fallen beim Übersetzen auf) */
export type MeldungsId = keyof typeof KATALOG & string

export const KATALOG_LISTE: readonly KatalogEintrag[] = GRUPPEN_KATALOGE.flatMap(k => Object.values(k))

export const GRUPPEN_LABEL: Record<MeldungsGruppe, string> = {
  ernte: 'Ernte & Lese',
  pflanzenschutz: 'Pflanzenschutz & Düngung',
  verkehr: 'Weinverkehr & Export',
  kellerbuch: 'Kellerbuch',
  buchhaltung: 'Buchhaltung & Steuer',
  flaechen: 'Flächen & Kataster',
}

export function katalogEintrag(id: string): KatalogEintrag | null {
  return KATALOG_LISTE.find(e => e.id === id) ?? null
}

/**
 * Link auf die CSV einer Meldung. Parameter 1:1 wie die searchParams der Druckseite;
 * null/undefined/'' entfallen.
 *   <CsvExportKnopf href={csvPfad('erntemeldung', { jahrgang: 2026 })} />
 */
export function csvPfad(id: MeldungsId, parameter?: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(parameter ?? {})) {
    if (v === null || v === undefined || v === '') continue
    sp.set(k, String(v))
  }
  const q = sp.toString()
  return `/meldungen/${encodeURIComponent(id)}/csv${q ? `?${q}` : ''}`
}
