// Maßnahmenliste nach Datum gruppieren (KAN-324, UAT 11.10.2026)
//
// Rückmeldung 30.09.2026: chronologisch (älteste oben). UAT 11.10.2026: neueste oben. Entscheidung Jörgen: neueste oben
// als Vorgabe, umschaltbar; die Wahl bleibt im Browser gespeichert. Ohne '@/'-Importe, damit node:test sie prüfen kann.

export type Richtung = 'neueste' | 'aelteste'

export const RICHTUNG_VORGABE: Richtung = 'neueste'
export const RICHTUNG_SPEICHER = 's112.massnahmen.sortierung'

/** Gespeicherten Wert lesen – Unbekanntes ergibt die Vorgabe */
export function richtungAus(wert: string | null | undefined): Richtung {
  return wert === 'aelteste' || wert === 'neueste' ? wert : RICHTUNG_VORGABE
}

/** Einträge je Datum (JJJJ-MM-TT) gruppieren, Tage in der gewünschten Richtung; innerhalb eines Tages bleibt die Reihenfolge */
export function nachDatumGruppiert<T extends { datum: string }>(eintraege: T[], richtung: Richtung): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const e of eintraege) {
    const arr = map.get(e.datum) ?? []
    arr.push(e)
    map.set(e.datum, arr)
  }
  const tage = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  return richtung === 'neueste' ? tage.reverse() : tage
}
