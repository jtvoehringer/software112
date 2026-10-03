// ── Ziel-Charge eines Umzugs im Ziel-Gebinde (KAN-94/KAN-83, 01.10.2026; KAN-112, 03.10.2026) ──────
//
// Reine Funktion (node:test-fähig: scripts/tests/kan94-83-umzug.test.mjs, kan112-verschnitt.test.mjs; einziger Import
// ist der importfreie Qualitätskern). Dieselbe Regel bestimmt in umziehen() die Zusammenführung bzw. den Verschnitt,
// vorab die Charge, deren Prüfnummer durch den Umzug erlöschen würde (KAN-83), und in gebinde-actions.ts
// (Umzug bearbeiten) die Sperre – die Stellen dürfen nicht auseinanderlaufen.
//
// KAN-112 (Entscheidungen Jörgen 03.10.2026): Die Zwischencharge entfällt. Weicht der Wein im Ziel-Gebinde in
// Rebsorte, Jahrgang, Herkunft oder Qualität (Stufe, Zusatzbezeichnung, Erzeugnis – normalisiert) von den Quellen ab,
// oder weichen mehrere Quellen untereinander ab, ist der Umzug ein Verschnitt (`istVerschnitt`).

import { gleicheQualitaet, normalisiereQualitaet } from '../wein/qualitaetsrang'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Merkmale, deren Abweichung einen Umzug zum Verschnitt macht (Texte für Hinweise) */
export type Merkmal = 'Rebsorte' | 'Jahrgang' | 'Herkunft' | 'Qualität'

const textOderNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const jahrOderNull = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** KAN-112: Abweichende Merkmale zweier Chargen (leer = gleicher Wein); fehlende Angaben zählen als eigener Wert */
export function merkmalsUnterschiede(a: R | null | undefined, b: R | null | undefined): Merkmal[] {
  const out: Merkmal[] = []
  if (textOderNull(a?.rebsorte) !== textOderNull(b?.rebsorte)) out.push('Rebsorte')
  if (jahrOderNull(a?.jahrgang) !== jahrOderNull(b?.jahrgang)) out.push('Jahrgang')
  if (textOderNull(a?.herkunft_code) !== textOderNull(b?.herkunft_code)) out.push('Herkunft')
  if (!gleicheQualitaet(normalisiereQualitaet(a), normalisiereQualitaet(b))) out.push('Qualität')
  return out
}

/** KAN-112: Abweichungen der Quellen untereinander (gegen die erste Quelle) */
export function quellenUnterschiede(quellen: readonly (R | null | undefined)[]): Merkmal[] {
  const out = new Set<Merkmal>()
  for (let i = 1; i < quellen.length; i++) for (const m of merkmalsUnterschiede(quellen[0], quellen[i])) out.add(m)
  return [...out]
}

/**
 * Ziel-Charge im Ziel-Gebinde (`vorhandenListe` = aktive Chargen dort, ohne die Quellen selbst) für die Quellen des
 * Umzugs (eine Zeile je Quell-Charge):
 *  • Liegt dort eine Charge mit denselben Merkmalen wie die (untereinander gleichen) Quellen, wird in DIESE
 *    zusammengeführt – auch wenn daneben andere Chargen liegen.
 *  • Sonst ist die mengenmäßig größte Charge die Anker-Charge, und der Umzug ist ein Verschnitt in sie.
 *  • Leeres Gebinde: keine Ziel-Charge; ein Verschnitt (in eine neue Charge) nur, wenn die Quellen abweichen.
 * `unterschiede` nennt die abweichenden Merkmale (Quellen untereinander und gegen die Anker-Charge).
 */
export function waehleZielCharge(
  vorhandenListe: readonly R[], quellen: readonly (R | null | undefined)[],
): { vorhanden: R | null; istVerschnitt: boolean; unterschiede: Merkmal[] } {
  const untereinander = quellenUnterschiede(quellen)
  const erste = quellen[0] ?? null
  if (untereinander.length === 0 && erste) {
    const gleich = vorhandenListe.find(v => merkmalsUnterschiede(v, erste).length === 0)
    if (gleich) return { vorhanden: gleich, istVerschnitt: false, unterschiede: [] }
  }
  const vorhanden = vorhandenListe.length > 0
    ? [...vorhandenListe].sort((a, b) => (parseFloat(b.menge_liter) || 0) - (parseFloat(a.menge_liter) || 0))[0]
    : null
  const unterschiede = new Set<Merkmal>(untereinander)
  if (vorhanden) for (const m of merkmalsUnterschiede(vorhanden, erste)) unterschiede.add(m)
  return { vorhanden, istVerschnitt: unterschiede.size > 0, unterschiede: [...unterschiede] }
}

/** „Rebsorte und Jahrgang“ – Aufzählung der Merkmale für Hinweise */
export function merkmaleText(m: readonly Merkmal[]): string {
  if (m.length <= 1) return m[0] ?? ''
  return `${m.slice(0, -1).join(', ')} und ${m[m.length - 1]}`
}
