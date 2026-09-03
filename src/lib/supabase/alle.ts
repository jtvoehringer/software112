// PostgREST (Supabase) liefert pro Anfrage höchstens 1.000 Zeilen (Projekt-
// einstellung "Max rows"). Rückmeldung 3.9.2026: nach dem Dynamics-Import
// (4.600 Firmen, 8.300 Kontakte bei Gebeshuber) zeigten Kontakte-/Firmenliste,
// Kundenauswahl im Verkauf, Exporte usw. exakt 1.000 Datensätze - ohne Fehler,
// die Kappung ist unsichtbar.
//
// alle() holt eine Abfrage seitenweise (1.000er-Blöcke über .range()) komplett
// und liefert dasselbe { data, error }-Ergebnis wie ein direktes await, damit
// die Aufrufstellen minimal bleiben:
//     const { data } = await alle(supabase.from('kontakte').select(...).order('nachname'))
//
// Voraussetzung für stabile Seiten: eine .order()-Angabe an der Abfrage (sonst
// kann Postgres zwischen den Blöcken die Reihenfolge wechseln).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const SEITENGROESSE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function alle<T = R>(query: any, schritt = SEITENGROESSE): Promise<{ data: T[]; error: R | null }> {
  const out: T[] = []
  for (let von = 0; ; von += schritt) {
    const { data, error } = await query.range(von, von + schritt - 1)
    if (error) return { data: out, error }
    const block = (data ?? []) as T[]
    out.push(...block)
    if (block.length < schritt) break
  }
  return { data: out, error: null }
}
