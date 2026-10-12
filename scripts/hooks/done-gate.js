#!/usr/bin/env node
/**
 * done-gate.js – Stop-Hook (docs/AGENTIC_DELIVERY.md): „Fertig“ nur mit grünem verify für genau diesen Stand.
 * Sind Dateien unter src/, scripts/, e2e/, supabase/migrations/ oder package.json geändert und passt der Stempel
 * aus dem letzten grünen `npm run verify` nicht (anderer Stand oder keiner), blockt der Hook mit Exit 2 – der Agent
 * arbeitet weiter, statt „fertig“ zu melden. Kein Neulauf von verify hier (dauert Minuten), nur der Vergleich.
 *
 * Ausnahmen: zweiter Stopp im selben Zug (stop_hook_active – sonst Endlosschleife), bewusst unfertige Arbeit mit
 * Datei .claude/done-gate-aus (lokal, nicht eingecheckt).
 * Für Tests: require('./done-gate.js') → { entscheide(eingabe, umgebung) }.
 */
const fs = require('fs')
const path = require('path')
const { fingerabdruck, STEMPEL } = require('./stand')

/** null = darf stoppen, sonst Meldung */
function entscheide(eingabe, umgebung = {}) {
  if (eingabe?.stop_hook_active) return null
  const existiert = umgebung.existiert ?? ((p) => fs.existsSync(p))
  const lies = umgebung.lies ?? ((p) => fs.readFileSync(p, 'utf8'))
  const stand = umgebung.stand ?? (() => fingerabdruck())
  if (existiert(path.join('.claude', 'done-gate-aus'))) return null
  const aktuell = stand()
  if (!aktuell) return null
  const stempel = existiert(STEMPEL) ? lies(STEMPEL).trim() : ''
  if (stempel === aktuell) return null
  return 'Geänderte Dateien ohne grünes `npm run verify` für genau diesen Stand. Bitte `npm run verify` ausführen ' +
    '(schreibt bei Erfolg den Stempel) und erst dann „fertig“ melden. Bewusst unfertig (z. B. Zwischenstand mit dem ' +
    'Menschen besprochen): Datei .claude/done-gate-aus anlegen.'
}

if (require.main === module) {
  // Hooks laufen im Arbeitsordner der Sitzung – Pfade (.claude/, git) beziehen sich auf das Projekt
  if (process.env.CLAUDE_PROJECT_DIR) { try { process.chdir(process.env.CLAUDE_PROJECT_DIR) } catch { /* bleibt */ } }
  let roh = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { roh += d })
  process.stdin.on('end', () => {
    let eingabe = {}
    try { eingabe = JSON.parse(roh || '{}') } catch { /* leer */ }
    let meldung = null
    try { meldung = entscheide(eingabe) } catch { meldung = null }   // kein git o. ä.: nicht blockieren
    if (!meldung) process.exit(0)
    process.stderr.write(meldung + '\n')
    process.exit(2)
  })
}

module.exports = { entscheide }
