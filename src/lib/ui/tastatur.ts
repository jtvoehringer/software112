// Sweep 116 (10.10.2026): Klickflächen, die kein <button>/<a> sind (Zeilen zum Auf-/Zuklappen, Kalendereinträge,
// Thread-Karten, sortierbare Spaltenköpfe …), auch per Tastatur bedienbar machen: Tab erreicht sie, Enter bzw.
// Leertaste lösen dieselbe Aktion aus wie der Klick. Ohne das waren sie nur mit der Maus bedienbar (WCAG 2.1.1).
// Verwendung: <div onClick={f} {...tastaturBedienbar(f)}> – Zeilen und Spaltenköpfe mit rolle null (behalten ihre
// Tabellen-Rolle). Wächter: scripts/check-a11y.js (KLICK_OHNE_TASTATUR).
import type { KeyboardEvent } from 'react'

export function tastaturBedienbar(aktion: () => void, rolle: 'button' | null = 'button') {
  return {
    ...(rolle ? { role: rolle } : {}),
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // nur das Element selbst – Enter in einem Link oder Knopf darin bleibt dessen Sache
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        aktion()
      }
    },
  }
}
