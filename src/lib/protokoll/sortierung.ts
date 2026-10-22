// ── Protokolle am Bildschirm: neueste zuerst oder chronologisch (KAN-350, Entscheidung Jörgen 22.10.2026) ──
//
// Behandlungsprotokoll und Änderungsprotokoll (Bildschirm: Journal) zeigen am Bildschirm als Vorgabe die neuesten
// Einträge zuerst, umschaltbar auf chronologisch – wie die Maßnahmenliste (KAN-324), hier aber mit dem Parameter in
// der URL (?sort=neu|alt), weil die Seiten auf dem Server entstehen. Druck und CSV bleiben chronologisch
// (Pflichtaufzeichnung): die Ladefunktionen liefern weiter aufsteigend, nur die Anzeige dreht die Reihenfolge.
// Isomorph, ohne '@/'-Importe (node:test).

export type ProtokollSortierung = 'neu' | 'alt'

/** Vorgabe am Bildschirm: neueste zuerst */
export const PROTOKOLL_SORT_VORGABE: ProtokollSortierung = 'neu'

export const PROTOKOLL_SORT_LABEL: Readonly<Record<ProtokollSortierung, string>> = {
  neu: 'Neueste zuerst',
  alt: 'Chronologisch',
}

/** Sortierung aus dem URL-Parameter – Unbekanntes (auch mehrfach angegeben) ergibt die Vorgabe */
export function protokollSortAus(wert: unknown): ProtokollSortierung {
  return wert === 'alt' || wert === 'neu' ? wert : PROTOKOLL_SORT_VORGABE
}

/** Die jeweils andere Sortierung (Ziel des Umschalters) */
export function andereSortierung(sort: ProtokollSortierung): ProtokollSortierung {
  return sort === 'neu' ? 'alt' : 'neu'
}

/** Anzeige-Reihenfolge aus einer chronologischen Liste (neue Liste, die Eingabe bleibt unverändert) */
export function inAnzeigeReihenfolge<T>(chronologisch: readonly T[], sort: ProtokollSortierung): T[] {
  return sort === 'neu' ? [...chronologisch].reverse() : [...chronologisch]
}

/** Link mit gesetzter Sortierung, übrige Parameter bleiben (leere weg); die Vorgabe steht nicht in der URL */
export function sortierHref(pfad: string, parameter: Readonly<Record<string, string | number | null | undefined>>, sort: ProtokollSortierung): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(parameter)) {
    if (k === 'sort' || v === null || v === undefined || v === '') continue
    p.set(k, String(v))
  }
  if (sort !== PROTOKOLL_SORT_VORGABE) p.set('sort', sort)
  const q = p.toString()
  return q ? `${pfad}?${q}` : pfad
}
