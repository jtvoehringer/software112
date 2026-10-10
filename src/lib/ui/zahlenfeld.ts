// Sweep 117 (10.10.2026): Mausrad über einem fokussierten Zahlenfeld (<input type="number">) ändert in Chromium-
// Browsern (Chrome, Edge) den Wert statt die Seite zu scrollen – wer nach der Eingabe von Menge oder Preis weiter-
// scrollt, verändert den Betrag unbemerkt (gemessen mit Edge: 5× Mausrad macht aus 12,50 → 12,45). Das Feld verliert
// beim Mausrad den Fokus: der Wert bleibt, die Seite scrollt wie erwartet. Eingebunden über ZahlenfeldMausrad im
// Root-Layout – gilt damit für alle Zahlenfelder der App.

/** Beim Mausrad: ist das fokussierte Element ein Zahlenfeld unter dem Mauszeiger, Fokus weg. true = abgefangen. */
export function zahlenfeldMausrad(e: { target: unknown }, aktiv: Element | null): boolean {
  const feld = aktiv as HTMLInputElement | null
  if (feld?.tagName === 'INPUT' && feld.type === 'number' && e.target === feld) {
    feld.blur()
    return true
  }
  return false
}
