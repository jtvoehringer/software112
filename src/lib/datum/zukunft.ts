// KAN-318 (10.10.2026, Entscheidung Jörgen: Variante C): Ereignis-Daten (Kellerbuch, Lese, Füllung, Verkauf/Zukauf,
// Lager, E&A, Zeiterfassung) dürfen in der Zukunft liegen – die App zeigt aber einen Hinweis, damit ein Tippfehler im
// Jahr (2062 statt 2026) auffällt. Kein Sperren, kein Blockieren beim Speichern (wie bei den Maßnahmen, KAN-87).

export const ZUKUNFT_HINWEIS = 'Datum liegt in der Zukunft – bitte prüfen.'

/** true, wenn ein Kalendertag (JJJJ-MM-TT) nach heute (Wiener Datum) liegt; leer/ungültig = false */
export function liegtInZukunft(wert: unknown, heute: string): boolean {
  return typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wert) && wert > heute
}
