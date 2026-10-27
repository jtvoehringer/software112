// ── Leere Gebinde – eine Regel für Abstufen, Umzug und Zukauf (KAN-358, 27.10.2026) ──────────────────────────────────
//
// Befund UAT: „Teilabstufung der Charge nicht möglich“ – die Option „Teilmenge“ war ausgegraut, obwohl leere Gebinde da
// waren. Ursache: Abstufen (Seite und chargeAbstufen) zählte jede Charge mit aktiv = true als Belegung, auch eine mit
// Status „abgeschlossen“; Umziehen (Seite und Server) zählte abgeschlossene Chargen nicht mit, und die Ziel-Gebinde-
// Auswahl des Zukaufs (/api/zukauf-stammdaten) wieder anders (nur aktiv). Ein Gebinde galt so je nach Vorgang als
// leer oder belegt.
//
// Regel (übernommen vom Umzug, der die Ziel-Charge bestimmt – waehleZielCharge): Eine Charge belegt ihr Gebinde, solange
// sie aktiv, nicht storniert und nicht abgeschlossen ist. Abgeschlossene, inaktive und stornierte Chargen belegen kein
// Gebinde. Die Menge zählt bewusst nicht: Eine aktive Charge mit 0 L wäre beim Umzug die Ziel-Charge (Zusammenführung),
// das Gebinde ist für eine neue Charge also nicht leer.
//
// Dieselbe Regel gilt in der Datenbank-Abfrage (`nurBelegendeChargen`) und für geladene Zeilen (`belegtGebinde`,
// `leereGebinde`) – die Stellen dürfen nicht auseinanderlaufen. Isomorph und importfrei
// (node:test: scripts/tests/kan358-leere-gebinde.test.mjs).

/** Spalten, die `belegtGebinde` braucht – beim Laden der Chargen mit auswählen */
export const BELEGUNG_SPALTEN = 'behaelter_id, aktiv, status, storniert_am'

/** Seite zum Anlegen eines Gebindes (Hinweis „Gebinde anlegen“, wenn keines leer ist) */
export const GEBINDE_ANLEGEN_PFAD = '/kellerbuch/behaelter/neu'

export type ChargeBelegung = {
  behaelter_id?: string | null
  aktiv?: boolean | null
  status?: string | null
  storniert_am?: string | null
}

/** Belegt diese Charge ihr Gebinde? (aktiv, nicht storniert, nicht abgeschlossen, mit Gebinde) */
export function belegtGebinde(c: ChargeBelegung | null | undefined): boolean {
  if (!c?.behaelter_id) return false
  if (c.aktiv === false) return false
  if (c.storniert_am) return false
  if (c.status === 'abgeschlossen') return false
  return true
}

/** Nur die Chargen, die ihr Gebinde belegen */
export function belegendeChargen<T extends ChargeBelegung>(chargen: Iterable<T | null | undefined>): T[] {
  const out: T[] = []
  for (const c of chargen) if (c && belegtGebinde(c)) out.push(c)
  return out
}

/** Ids der belegten Gebinde */
export function belegteGebinde(chargen: Iterable<ChargeBelegung | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const c of chargen) if (c && belegtGebinde(c)) out.add(c.behaelter_id as string)
  return out
}

/** Ist das Gebinde `gebindeId` leer (keine der Chargen belegt es)? */
export function gebindeLeer(gebindeId: string, chargen: Iterable<ChargeBelegung | null | undefined>): boolean {
  for (const c of chargen) if (c && belegtGebinde(c) && c.behaelter_id === gebindeId) return false
  return true
}

/**
 * Leere Gebinde aus `gebinde` – ohne die von `chargen` belegten, ohne gesperrte (fremd belegt, Kellergemeinschaft) und
 * ohne `ausser` (z. B. das Gebinde der Charge selbst).
 */
export function leereGebinde<T extends { id: string; gesperrt?: boolean | null }>(
  gebinde: readonly T[], chargen: Iterable<ChargeBelegung | null | undefined>, opts: { ausser?: string | null } = {},
): T[] {
  const belegt = belegteGebinde(chargen)
  return gebinde.filter(g => !belegt.has(g.id) && !g.gesperrt && g.id !== opts.ausser)
}

/** Abfrage-Baustein (Supabase/PostgREST): nur Chargen, die ihr Gebinde belegen – dieselbe Regel wie `belegtGebinde` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function nurBelegendeChargen<Q extends { eq: (...a: any[]) => any; neq: (...a: any[]) => any; is: (...a: any[]) => any }>(query: Q): Q {
  return query.eq('aktiv', true).is('storniert_am', null).neq('status', 'abgeschlossen') as Q
}
