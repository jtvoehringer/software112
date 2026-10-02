// Drucken-Knopf für eigenständige HTML-Druckansichten (KAN-141, 01.10.2026).
//
// Die Druckansichten laufen seit KAN-138 unter DOKUMENT_CSP (Sandbox ohne Script). Für den Knopf gibt
// druckCsp(DOKUMENT_CSP) genau EIN Skript frei – per SHA-256-Hash, ohne 'unsafe-inline' und ohne 'unsafe-hashes',
// weiterhin ohne allow-same-origin (eigene, undurchsichtige Origin ohne Zugriff auf Cookies/Storage der App).
// Eingeschleustes HTML kann also weiterhin kein Skript und keinen Inline-Handler (onclick=…) ausführen.
// Der Knopf hängt per addEventListener am Element, nicht als Inline-Handler; im Ausdruck ist er ausgeblendet.
//
// Nur serverseitig (node:crypto), ohne '@/'-Importe, damit scripts/tests/kan141-druckknopf.test.mjs die Datei laden kann.
import { createHash } from 'node:crypto'

/** Das einzige freigegebene Skript – jede Änderung ändert den Hash automatisch mit */
export const DRUCK_SKRIPT =
  "document.getElementById('s112-drucken').addEventListener('click',function(){window.print()})"

const DRUCK_SKRIPT_HASH = `'sha256-${createHash('sha256').update(DRUCK_SKRIPT, 'utf8').digest('base64')}'`

/** Dokument-CSP (DOKUMENT_CSP aus ./html) plus allow-scripts in der Sandbox, Skripte nur mit dem Hash von DRUCK_SKRIPT.
 *  Als Funktion, damit diese Datei ohne Import auskommt (node:test lädt sie direkt). */
export function druckCsp(basis: string): string {
  if (!/^sandbox /.test(basis) || !basis.includes("default-src 'none';") || /allow-scripts|script-src/.test(basis))
    throw new Error('druckCsp: unerwartete Basis-CSP')
  return basis
    .replace(/^sandbox /, 'sandbox allow-scripts ')
    .replace("default-src 'none';", `default-src 'none'; script-src ${DRUCK_SKRIPT_HASH};`)
}

/** CSS für die Druckleiste – gehört in den <style>-Block der Druckansicht */
export const DRUCKLEISTE_CSS =
  '.s112-druckleiste{display:flex;justify-content:flex-end;margin-bottom:6mm}' +
  '.s112-druckleiste button{font:inherit;font-size:10pt;padding:2mm 5mm;border:1px solid #1f3a5f;border-radius:3px;background:#1f3a5f;color:#fff;cursor:pointer}' +
  '.s112-druckleiste button:hover{background:#2c4f7c}' +
  '@media print{.s112-druckleiste{display:none}}'

/** Druckleiste mit Knopf und dem freigegebenen Skript – direkt nach <body> einsetzen */
export function druckleiste(): string {
  return `<div class="s112-druckleiste"><button type="button" id="s112-drucken">Drucken</button></div><script>${DRUCK_SKRIPT}</script>`
}
