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
//
// Performance (17.9.2026): die Blöcke werden nicht mehr nacheinander, sondern in
// Bündeln zu fünf parallel geholt - bei 8.300 Kontakten neun Round-Trips → zwei.
// Dafür wird der Query-Builder je Block kopiert (Konstruktor-Kopie + eigene URL,
// weil .range() die URL des Builders verändert).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const SEITENGROESSE = 1000
const PARALLEL = 5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kopie(query: any): any {
  try {
    const c = new query.constructor(query)
    if (query.url) c.url = new URL(query.url.toString())
    return c
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function alle<T = R>(query: any, schritt = SEITENGROESSE): Promise<{ data: T[]; error: R | null }> {
  const out: T[] = []
  // Block 0 - zeigt, ob überhaupt weitere Blöcke nötig sind
  const erste = kopie(query) ?? query
  const { data, error } = await erste.range(0, schritt - 1)
  if (error) return { data: out, error }
  const block0 = (data ?? []) as T[]
  out.push(...block0)
  if (block0.length < schritt) return { data: out, error: null }

  // Weitere Blöcke parallel in Bündeln, bis ein Block kürzer als schritt ist
  let von = schritt
  for (;;) {
    const kopien = Array.from({ length: PARALLEL }, () => kopie(query))
    if (kopien.some(k => !k)) {
      // Builder nicht kopierbar (fremder Client): sequenziell wie bisher
      for (;;) {
        const r = await query.range(von, von + schritt - 1)
        if (r.error) return { data: out, error: r.error }
        const b = (r.data ?? []) as T[]
        out.push(...b)
        if (b.length < schritt) return { data: out, error: null }
        von += schritt
      }
    }
    const ergebnisse = await Promise.all(kopien.map((k, i) => k.range(von + i * schritt, von + (i + 1) * schritt - 1)))
    let fertig = false
    for (const r of ergebnisse) {
      if (r.error) return { data: out, error: r.error }
      const b = (r.data ?? []) as T[]
      out.push(...b)
      if (b.length < schritt) { fertig = true; break }
    }
    if (fertig) return { data: out, error: null }
    von += PARALLEL * schritt
  }
}
