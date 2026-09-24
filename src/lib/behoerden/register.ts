import 'server-only'
import type { Behoerdenmeldung } from './typen'
import { MELDUNGEN_ERNTE } from './register/ernte'
import { MELDUNGEN_PFLANZENSCHUTZ } from './register/pflanzenschutz'
import { MELDUNGEN_VERKEHR } from './register/verkehr'
import { MELDUNGEN_KELLERBUCH } from './register/kellerbuch'
import { MELDUNGEN_BUCHHALTUNG } from './register/buchhaltung'
import { MELDUNGEN_FLAECHEN } from './register/flaechen'

// ── Register aller Behördenmeldungen mit CSV (server-only, 24.09.2026) ─────────
//
// Sammelt die Gruppen-Register register/<gruppe>.ts ein. Jede Gruppe prüft per
// `satisfies MeldungenZu<typeof KATALOG_X>`, dass ihr Register genau die ids ihres
// Katalogs enthält; doppelte ids über Gruppen hinweg meldet katalog.ts.
// Ausgabe ausschließlich über src/app/(dashboard)/meldungen/[meldung]/csv/route.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Register = Record<string, Behoerdenmeldung<any, any>>

export const MELDUNGEN = {
  ...MELDUNGEN_ERNTE,
  ...MELDUNGEN_PFLANZENSCHUTZ,
  ...MELDUNGEN_VERKEHR,
  ...MELDUNGEN_KELLERBUCH,
  ...MELDUNGEN_BUCHHALTUNG,
  ...MELDUNGEN_FLAECHEN,
} satisfies Register

/** Meldung zur id (nur eigene Schlüssel – „constructor“ o. Ä. ergibt null) */
export function meldungFinden(id: string): Behoerdenmeldung<unknown, unknown> | null {
  const r: Register = MELDUNGEN
  return Object.prototype.hasOwnProperty.call(r, id) ? r[id] : null
}
