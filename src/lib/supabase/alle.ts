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

// ── .in()-Listen in Blöcken (05.10.2026) ─────────────────────────────────────────────────────────────────────────
// .in('spalte', liste) landet als Query-String in der URL. Gemessen gegen Staging: 300 UUIDs (≈ 11 KB URL) gehen,
// 400 (≈ 15 KB) scheitern – supabase-js liefert dann nur einen Fehler, den viele Aufrufer verwerfen (z. B. leere
// Aktivitäten in der Kontaktliste mit 1.000 Zeilen). Lange Listen deshalb in Blöcke teilen: höchstens IN_BLOCK
// Werte und IN_ZEICHEN Zeichen je Block (Graph-Nachrichten-IDs sind ~150 Zeichen lang).

export const IN_BLOCK = 100
export const IN_ZEICHEN = 4000

/** Teilt Werte (ohne Duplikate, ohne null/leer) in Blöcke mit höchstens `max` Werten und `zeichen` Zeichen. */
export function bloecke<T>(werte: readonly (T | null | undefined)[], max = IN_BLOCK, zeichen = IN_ZEICHEN): T[][] {
  const out: T[][] = []
  let block: T[] = []
  let laenge = 0
  for (const w of new Set(werte)) {
    if (w === null || w === undefined || w === '') continue
    const l = String(w).length + 1
    if (block.length > 0 && (block.length >= max || laenge + l > zeichen)) { out.push(block); block = []; laenge = 0 }
    block.push(w as T)
    laenge += l
  }
  if (block.length > 0) out.push(block)
  return out
}

/**
 * Führt eine Abfrage je Block aus und hängt die Ergebnisse aneinander – dasselbe { data, error } wie alle():
 *     const { data } = await inBloecken(ids, b => alle(tf(q('aktivitaeten').select(…).in('kontakt_id', b).order('id'))))
 * `abfrage` bekommt je Block die Werte und liefert ein awaitbares { data, error } (direkt oder über alle()).
 * Die Reihenfolge gilt nur innerhalb eines Blocks – wer global sortiert braucht, sortiert danach selbst.
 * Leere Liste: keine Anfrage, { data: [], error: null }. Der erste Fehler bricht ab (keine stille Teilmenge).
 */
export async function inBloecken<T = R, W = string>(
  werte: readonly (W | null | undefined)[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abfrage: (block: W[]) => PromiseLike<{ data: any; error: any }>,
  max = IN_BLOCK,
): Promise<{ data: T[]; error: R | null }> {
  const out: T[] = []
  const alleBloecke = bloecke(werte, max)
  for (let i = 0; i < alleBloecke.length; i += PARALLEL) {
    const ergebnisse = await Promise.all(alleBloecke.slice(i, i + PARALLEL).map(b => abfrage(b)))
    for (const r of ergebnisse) {
      if (r.error) return { data: out, error: r.error }
      out.push(...((r.data ?? []) as T[]))
    }
  }
  return { data: out, error: null }
}

/** Zählt (select mit { count: 'exact', head: true }) je Block und summiert. */
export async function zaehleInBloecken<W = string>(
  werte: readonly (W | null | undefined)[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abfrage: (block: W[]) => PromiseLike<{ count: number | null; error: any }>,
  max = IN_BLOCK,
): Promise<{ count: number; error: R | null }> {
  let summe = 0
  for (const b of bloecke(werte, max)) {
    const r = await abfrage(b)
    if (r.error) return { count: summe, error: r.error }
    summe += r.count ?? 0
  }
  return { count: summe, error: null }
}
