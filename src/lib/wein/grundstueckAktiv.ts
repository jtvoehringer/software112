// Deaktivierte Grundstücke (KAN-150 F1, Frage 1): grundstuecke.aktiv = false mit deaktiviert_am = erster Tag, an dem das
// Grundstück nicht mehr bewirtschaftet wird. Isomorph, ohne '@/'-Importe (node:test).
//
// Regel: Auswahllisten (Maßnahme, Lese, Zukauf …) zeigen nur aktive Grundstücke. Meldungen und Auswertungen für einen
// Zeitraum zählen ein deaktiviertes Grundstück noch, wenn es zu Beginn des Zeitraums bewirtschaftet war – frühere
// Zeiträume bleiben so unverändert.

export type GstAktivFelder = { aktiv?: boolean | null; deaktiviert_am?: string | null }

/** Wurde das Grundstück am Tag (JJJJ-MM-TT) bewirtschaftet? */
export function gstAktivAm(g: GstAktivFelder, tag: string): boolean {
  if (g.aktiv !== false) return true
  const ab = g.deaktiviert_am ? String(g.deaktiviert_am).slice(0, 10) : null
  return !!ab && tag.slice(0, 10) < ab
}

/** Heute aktiv (Auswahllisten, laufende Übersichten) */
export function gstAktiv(g: GstAktivFelder): boolean {
  return g.aktiv !== false
}

/** Zählt das Grundstück für ein Jahr (Stichtag 1.1.)? – Cu-Bilanz, Erntemeldung, SVS, Zukauf-Höchstmenge */
export function gstImJahr(g: GstAktivFelder, jahr: number): boolean {
  return gstAktivAm(g, `${jahr}-01-01`)
}
