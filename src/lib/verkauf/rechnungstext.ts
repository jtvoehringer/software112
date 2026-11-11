// ── Text auf Rechnung (KAN-416 Punkt 1, 11.11.2026) ──────────────────────────────────────────────────────────────────
//
// Am Lieferschein (verkaufsposten) gibt es zwei Texte: die „Interne Notiz“ (notizen – nie gedruckt, jederzeit änderbar,
// außer der Verkauf ist storniert) und den „Text auf Rechnung“ (rechnungstext – wird auf der Rechnung unter den
// Positionen gedruckt, bei Sammelrechnungen je Lieferschein). Der Text auf Rechnung ist änderbar, bis der Lieferschein an
// einer Rechnung hängt; danach ist er unveränderlich (Rechnung = Beleg; Trigger a_rechnungstext_schutz). Wird die
// Rechnung storniert und der Lieferschein wieder frei, lässt sich der Text wieder ändern.
// Isomorph, ohne '@/'-Importe (node:test) – gemeinsam für Formulare, Server Action und die PDF-Route.

/** Höchstlänge wie der CHECK verkaufsposten_rechnungstext_chk */
export const RECHNUNGSTEXT_MAX = 1000
/** Höchstlänge der internen Notiz im Formular (die Spalte selbst ist unbegrenzt) */
export const NOTIZ_MAX = 2000

/** Eingabe säubern: Zeilenenden vereinheitlichen, Ränder weg; leer → null */
export function textOderNull(wert: unknown): string | null {
  const t = wert == null ? '' : String(wert).replace(/\r\n?/g, '\n').trim()
  return t === '' ? null : t
}

/** Prüfung des Texts auf Rechnung; null = in Ordnung */
export function rechnungstextFehler(wert: unknown): string | null {
  const t = textOderNull(wert)
  if (t !== null && t.length > RECHNUNGSTEXT_MAX) return `Der Text auf der Rechnung darf höchstens 1.000 Zeichen haben (derzeit ${t.length}).`
  return null
}

/** Prüfung der internen Notiz; null = in Ordnung */
export function notizFehler(wert: unknown): string | null {
  const t = textOderNull(wert)
  if (t !== null && t.length > NOTIZ_MAX) return 'Die interne Notiz darf höchstens 2.000 Zeichen haben.'
  return null
}

/** Darf der Text auf Rechnung geändert werden? Nicht mehr, sobald eine Rechnung dazu erstellt ist; nie bei Storno. */
export function rechnungstextAenderbar(posten: { rechnung_id?: string | null; berechnet?: boolean; storniert?: boolean | null }): boolean {
  if (posten.storniert) return false
  return !(posten.rechnung_id || posten.berechnet)
}

type LieferscheinText = { lieferscheinnummer?: string | null; rechnungstext?: string | null }

/**
 * Texte für die Rechnung: bei einem Lieferschein nur der Text; bei einer Sammelrechnung je Lieferschein mit seiner
 * Nummer davor („Lieferschein LS-2026-0007: …“). Lieferscheine ohne Text fallen weg.
 */
export function rechnungstexteFuerBeleg(lieferscheine: readonly LieferscheinText[]): string[] {
  const mit = lieferscheine.map(l => ({ nr: (l.lieferscheinnummer ?? '').trim(), text: textOderNull(l.rechnungstext) })).filter(l => l.text !== null)
  if (lieferscheine.length <= 1) return mit.map(l => l.text as string)
  return mit.map(l => (l.nr ? `Lieferschein ${l.nr}: ${l.text}` : (l.text as string)))
}
