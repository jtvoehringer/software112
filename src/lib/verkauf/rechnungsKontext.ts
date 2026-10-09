// KAN-105 Teil B (08.10.2026): Zahlungen und E&A-Einnahmen gehören zur Rechnung. Bei einer Rechnung über mehrere
// Lieferscheine (Sammelrechnung, KAN-104) zählen alle Lieferscheine der Rechnung (Positionen, Gesamtbetrag) und alle
// Zahlungen der Rechnung (zahlungen.rechnung_id) – egal, an welchem Lieferschein die Zahlung erfasst wurde. E&A-Einnahmen
// hängen am Anker-Lieferschein (kleinste ID, stabil), bestehende werden über alle Lieferscheine der Rechnung erkannt.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type RechnungsKontext = {
  /** Rechnung des Lieferscheins (null = nicht berechnet bzw. 1:1 ohne Rechnung) */
  rechnungId: string | null
  rechnungsnummer: string | null
  /** alle Lieferscheine der Rechnung (ohne Rechnung: nur dieser) */
  lieferscheinIds: string[]
  /** Anker für E&A-Einnahmen: kleinste ID der Lieferscheine */
  anker: string
  positionen: R[]
}

/** Anker-Lieferschein einer Rechnung (kleinste ID – unabhängig davon, an welchem Lieferschein gezahlt wurde) */
export function ankerLieferschein(ids: readonly string[]): string {
  return [...ids].sort()[0]
}

/**
 * Lieferschein + ggf. alle weiteren Lieferscheine seiner Rechnung mit Positionen.
 * `positionenFelder`: Spalten von verkauf_positionen, die der Aufrufer braucht.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeRechnungsKontext(supabase: any, tenantId: string, verkaufspostenId: string, positionenFelder: string): Promise<RechnungsKontext | null> {
  const { data: lsRaw, error: lsErr } = await supabase.from('verkaufsposten')
    .select(`id, rechnung_id, rechnungsnummer, positionen:verkauf_positionen(${positionenFelder})`)
    .eq('id', verkaufspostenId).eq('tenant_id', tenantId).maybeSingle()
  // KAN-254: sonst „kein Lieferschein“ bzw. zu wenige Positionen – die Rechnungssumme (Zahlungen, E&A) wäre zu klein
  if (lsErr) throw new Error(`Lieferschein konnte nicht geladen werden: ${lsErr.message}`)
  const ls = lsRaw as R | null
  if (!ls) return null
  if (!ls.rechnung_id) {
    return { rechnungId: null, rechnungsnummer: ls.rechnungsnummer ?? null, lieferscheinIds: [String(ls.id)], anker: String(ls.id), positionen: (ls.positionen ?? []) as R[] }
  }
  // alle Lieferscheine der Rechnung (eine Rechnung hat wenige Lieferscheine – Sammelrechnung eines Kunden)
  // alle-ausnahme: Lieferscheine einer einzelnen Rechnung (Elternzeile), fachlich wenige
  const { data: alleRaw, error: alleErr } = await supabase.from('verkaufsposten')
    .select(`id, positionen:verkauf_positionen(${positionenFelder})`)
    .eq('tenant_id', tenantId).eq('rechnung_id', ls.rechnung_id).order('id')
  if (alleErr) throw new Error(`Lieferscheine der Rechnung konnten nicht geladen werden: ${alleErr.message}`)
  const alle = (alleRaw ?? []) as R[]
  const ids = alle.map(l => String(l.id))
  return {
    rechnungId: String(ls.rechnung_id), rechnungsnummer: ls.rechnungsnummer ?? null,
    lieferscheinIds: ids.length ? ids : [String(ls.id)], anker: ankerLieferschein(ids.length ? ids : [String(ls.id)]),
    positionen: alle.flatMap(l => (l.positionen ?? []) as R[]),
  }
}
