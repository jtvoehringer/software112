// Sweep 119 (10.10.2026): Schutz vor dem Verlust ungespeicherter Eingaben in langen Formularen.
// Bisher waren alle Eingaben weg, wenn man in einem Formular (Maßnahme, Verkauf, Zukauf, Kontakt … bis 27 Felder)
// versehentlich einen Menüpunkt anklickte, die Seite neu lud oder den Tab schloss – ohne Rückfrage.
// Formulare mit dem Attribut data-ungespeichert gelten nach der ersten Eingabe als geändert (data-geaendert), nach dem
// Absenden wieder als sauber. Solange eines geändert ist, fragt der Browser beim Neuladen/Schließen nach, und ein Klick
// auf einen Link außerhalb des Formulars fragt mit MELDUNG nach. Links im Formular selbst („Abbrechen“) fragen nicht.
// Eingebunden über UngespeichertSchutz im Root-Layout; Wächter scripts/check-formulare.js (ab 8 Feldern Pflicht).

export const SCHUTZ_ATTR = 'data-ungespeichert'
/** KAN-330 (UAT 11.10.2026): Link im Formular, der es verlässt (z. B. „Abstufen“ im Charge-Formular) – fragt wie ein Link
 *  außerhalb nach; ohne das Attribut gilt ein Link im Formular als „Abbrechen“ (keine Rückfrage) */
export const VERLAESST_ATTR = 'data-verlaesst-formular'
export const GEAENDERT_ATTR = 'data-geaendert'
// KAN-359: Rückfrage im eigenen Dialog – Titel und Erklärung getrennt
export const MELDUNG_TITEL = 'Seite verlassen?'
export const MELDUNG = 'Ungespeicherte Eingaben gehen verloren.'

/** Das geschützte Formular, zu dem ein Element gehört (oder null) */
export function schutzFormular(ziel: EventTarget | null): HTMLFormElement | null {
  const el = ziel as Element | null
  if (!el || typeof el.closest !== 'function') return null
  return el.closest(`form[${SCHUTZ_ATTR}]`) as HTMLFormElement | null
}

/** Formulare, die beim Klick auf diesen Link als „verlassen“ gelten: alle – außer dem eigenen, wenn der Link darin ein
 *  „Abbrechen“ ist (ohne VERLAESST_ATTR). Ergebnis als Argument „ausser“ für offeneAenderungen. */
export function ausserFuerLink(a: Pick<Element, 'hasAttribute'> & Node): Node | null {
  return a.hasAttribute(VERLAESST_ATTR) ? null : a
}

/** Geänderte, noch nicht abgesendete Formulare im Dokument, die das Element nicht enthalten */
export function offeneAenderungen(doc: Pick<Document, 'querySelectorAll'>, ausser: Node | null = null): HTMLFormElement[] {
  return [...doc.querySelectorAll(`form[${SCHUTZ_ATTR}][${GEAENDERT_ATTR}]`)]
    .filter(f => !ausser || !f.contains(ausser)) as HTMLFormElement[]
}

type Klick = Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>
type Verweis = { target: string; href: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean }

/** Verlässt dieser Link-Klick die aktuelle Seite im selben Tab? (neuer Tab, Download, Anker, mailto … nicht) */
export function verlaesstSeite(e: Klick, a: Verweis, aktuell: string): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if (a.target && a.target !== '_self') return false
  if (a.hasAttribute('download')) return false
  const href = a.getAttribute('href')
  if (!href || href.startsWith('#')) return false
  let ziel: URL, jetzt: URL
  try { ziel = new URL(a.href); jetzt = new URL(aktuell) } catch { return false }
  if (ziel.protocol !== 'http:' && ziel.protocol !== 'https:') return false
  return !(ziel.origin === jetzt.origin && ziel.pathname === jetzt.pathname && ziel.search === jetzt.search)
}
