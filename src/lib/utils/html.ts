// HTML-Escaping für serverseitig per String zusammengebaute Seiten und E-Mails (KAN-138).
//
// Isomorph und ohne '@/'-Importe, damit scripts/tests/html.test.mjs die Datei direkt laden kann.
// Jede Interpolation aus DB- oder Benutzerdaten in HTML-Text oder -Attributwerte (in
// Anführungszeichen) läuft über escHtml – auch Zahlen und Datumswerte, das schadet nie.

const HTML_ENTITAETEN: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/** Wert für HTML-Text oder einen Attributwert in Anführungszeichen: null/undefined → '',
 *  Sonderzeichen als Entitäten, Steuerzeichen (außer Tab/Zeilenumbruch) entfernt. */
export function escHtml(wert: unknown): string {
  return String(wert ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[&<>"']/g, c => HTML_ENTITAETEN[c])
}

/** Wie escHtml, Zeilenumbrüche danach als <br> – für mehrzeilige Freitexte (Notizen). */
export function escHtmlMehrzeilig(wert: unknown): string {
  return escHtml(wert).replace(/\r\n|\r|\n/g, '<br>')
}

/** Dateiname für Content-Disposition: nur [A-Za-z0-9._-], alles andere wird „_“ –
 *  verhindert Header-Fehler (Zeilenumbruch, Anführungszeichen) und seltsame Namen. */
export function sichererDateiname(name: unknown, ersatz = 'dokument'): string {
  const s = String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120)
  return s || ersatz
}

/** CSP für eigenständige HTML-Dokumente (Druckansichten) auf der App-Origin: kein Script,
 *  eigene Sandbox-Origin (kein Zugriff auf Cookies/Storage der App), nur Inline-CSS und
 *  Bilder aus data:/https:. Drucken geht über den Browser (Strg P), dafür ist kein Script nötig. */
export const DOKUMENT_CSP =
  "sandbox allow-modals allow-popups; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
