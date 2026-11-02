// ── Weinart-Auswahl mit Farbpunkt (KAN-397 Nebenbefund, 02.11.2026) ───────────────────────────────────────────
// Der CD-Durchgang (09.09.2026) hatte die Punkte auf Grautöne gesetzt – Weißwein, Rotwein und Rosé sahen gleich aus.
// Die Punkte zeigen wieder die Weinfarbe (wie vorher). Gemeinsam für Zukauf anlegen und bearbeiten.

export type Weinart = 'weiss' | 'rot' | 'rose'

export const WEINART_AUSWAHL: readonly (readonly [Weinart, string, string])[] = [
  ['weiss', 'Weißwein', 'bg-yellow-300'],
  ['rot',   'Rotwein',  'bg-red-700'],
  ['rose',  'Rosé',     'bg-pink-300'],
]
