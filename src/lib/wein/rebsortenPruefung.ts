// ── Prüfseite „Rebsorten ohne Kürzel“ (KAN-89, 05.10.2026) ───────────────────────────────────────────────
//
// Freitext-Rebsorten ohne amtliches BKI-Kürzel (Kürzelliste Stand 01.10.2024, lib/wein/bki_kuerzel.ts) landen in
// Meldungen leer bzw. mit Warnung (Weinbestandsmeldung, Weinbuch, Transportbescheinigung …). Die Seite zeigt sie je
// Tabelle; Rieden, Grundstücke und Chargen lassen sich gesammelt korrigieren (alle Zeilen mit demselben Wert).
// Ohne '@/'-Importe außer bki_kuerzel (node:test).

import { bkiRebsorteKuerzel, REBSORTE_KUERZEL } from './bki_kuerzel'

export type RebsortenTabelle = 'weingarten' | 'grundstuecke' | 'weinausbau' | 'fuellungen' | 'zukauf_posten' | 'dac_antrag'

export const REBSORTEN_TABELLEN: readonly {
  tabelle: RebsortenTabelle
  label: string
  /** Sammelkorrektur auf der Seite (Schreibrecht im Modul) – sonst nur Anzeige, Korrektur am Datensatz */
  korrigierbar: boolean
  modul: 'rieden' | 'kellerbuch' | 'warenwirtschaft'
  /** Tabelle kennt Storno – stornierte Zeilen zählen nicht */
  storno: boolean
}[] = [
  { tabelle: 'weingarten', label: 'Rieden', korrigierbar: true, modul: 'rieden', storno: false },
  { tabelle: 'grundstuecke', label: 'Grundstücke', korrigierbar: true, modul: 'rieden', storno: false },
  { tabelle: 'weinausbau', label: 'Chargen (Kellerbuch)', korrigierbar: true, modul: 'kellerbuch', storno: true },
  { tabelle: 'fuellungen', label: 'Füllungen', korrigierbar: false, modul: 'kellerbuch', storno: true },
  { tabelle: 'zukauf_posten', label: 'Zukäufe', korrigierbar: false, modul: 'warenwirtschaft', storno: true },
  { tabelle: 'dac_antrag', label: 'DAC-/Prüfnummernanträge', korrigierbar: false, modul: 'kellerbuch', storno: true },
]

export function rebsortenTabelle(t: unknown) {
  return REBSORTEN_TABELLEN.find(x => x.tabelle === t) ?? null
}

export type OhneKuerzel = { wert: string; anzahl: number; vorschlag: string | null }

/**
 * Werte ohne amtliches Kürzel mit Anzahl, absteigend nach Anzahl. Vorschlag: „Sortenverschnitt“ ohne Farbe → keiner
 * (Farbe hängt an der Charge), „Gemischer Satz“ und ähnliche Tippfehler → die nächste amtliche Schreibweise.
 */
export function ohneKuerzel(werte: readonly (string | null | undefined)[]): OhneKuerzel[] {
  const n = new Map<string, number>()
  for (const w of werte) {
    const t = (w ?? '').trim()
    if (!t || bkiRebsorteKuerzel(t)) continue
    n.set(t, (n.get(t) ?? 0) + 1)
  }
  return [...n].map(([wert, anzahl]) => ({ wert, anzahl, vorschlag: vorschlag(wert) }))
    .sort((a, b) => b.anzahl - a.anzahl || a.wert.localeCompare(b.wert, 'de'))
}

/** Levenshtein-Abstand (kurze Zeichenketten) */
function abstand(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}

/** Nächste amtliche Schreibweise bei höchstens 2 Tippfehlern (z. B. „Gemischer Satz“ → „Gemischter Satz“), sonst null */
export function vorschlag(wert: string): string | null {
  const w = wert.trim().toLocaleLowerCase('de')
  if (/^sortenverschnitt$/.test(w)) return null
  let best: { name: string; d: number } | null = null
  for (const name of Object.keys(REBSORTE_KUERZEL)) {
    const d = abstand(w, name.toLocaleLowerCase('de'))
    if (d <= 2 && (!best || d < best.d)) best = { name, d }
  }
  return best?.name ?? null
}

/** Ziel einer Sammelkorrektur: amtlicher Name (Schlüssel der Kürzelliste) oder leer (= keine Rebsorte) */
export function korrekturZielFehler(neu: string): string | null {
  const t = neu.trim()
  if (t === '') return null
  return Object.prototype.hasOwnProperty.call(REBSORTE_KUERZEL, t)
    ? null : `„${t}“ ist keine Sorte der BKI-Kürzelliste – bitte aus der Liste wählen.`
}
