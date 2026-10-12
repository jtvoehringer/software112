#!/usr/bin/env node
/**
 * guard.js – PreToolUse-Hook (docs/AGENTIC_DELIVERY.md, Guard Rails). Liest den Tool-Aufruf als JSON von stdin und
 * blockt (Exit 2, Begründung auf stderr) nach der Blockliste scripts/hooks/regeln.json:
 *  - Befehle: Force-Push, reset --hard, clean -f, supabase db push/reset, .env lesen, rm -rf außerhalb von Temp-Ordnern,
 *    Produktions-Supabase per CLI außer als Probelauf (Datei endet mit ROLLBACK, kein COMMIT)
 *  - Dateien: .env* (außer *.example), eingespielte Migrationen ändern, migrations_legacy/
 *  - Inhalte: Schlüssel und Tokens (Anthropic, JWT, Stripe live, GitHub, private Schlüssel)
 * Das Modell entscheidet über das Wie; was nie passieren darf, steht hier und nicht nur im Prompt.
 *
 * Für Tests: require('./guard.js') → { pruefe(eingabe, umgebung) } ohne Seiteneffekte.
 */
const fs = require('fs')
const path = require('path')

const REGELN = JSON.parse(fs.readFileSync(path.join(__dirname, 'regeln.json'), 'utf8'))
const re = (m) => new RegExp(m, 'i')

/** Ergebnis: null = erlaubt, sonst { id, grund } */
function pruefe(eingabe, umgebung = {}) {
  const werkzeug = eingabe?.tool_name ?? ''
  const e = eingabe?.tool_input ?? {}
  const existiert = umgebung.existiert ?? ((p) => fs.existsSync(p))
  const lies = umgebung.lies ?? ((p) => fs.readFileSync(p, 'utf8'))

  if (werkzeug === 'Bash' || werkzeug === 'PowerShell') {
    const befehl = String(e.command ?? '')
    for (const r of REGELN.befehl) if (re(r.muster).test(befehl)) return { id: r.id, grund: r.grund }
    const l = REGELN.loeschen
    if (re(l.muster).test(befehl) && !re(l.erlaubt_wenn).test(befehl)) return { id: l.id, grund: l.grund }
    const p = REGELN.produktion
    if (befehl.includes(p.muster) && re(p.befehl).test(befehl) && !probelauf(befehl, existiert, lies)) return { id: p.id, grund: p.grund }
    return null
  }

  if (['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(werkzeug)) {
    const datei = String(e.file_path ?? e.notebook_path ?? '')
    for (const r of REGELN.datei) {
      if (!re(r.muster).test(datei)) continue
      if (r.werkzeuge.includes(werkzeug)) return { id: r.id, grund: r.grund }
      if (werkzeug === 'Write' && r.werkzeuge.includes('Write-bestehend') && existiert(datei)) return { id: r.id, grund: r.grund }
    }
    const inhalt = [e.content, e.new_string, ...(Array.isArray(e.edits) ? e.edits.map(x => x?.new_string) : []), e.new_source]
      .filter(x => typeof x === 'string').join('\n')
    for (const r of REGELN.inhalt) if (re(r.muster).test(inhalt)) return { id: r.id, grund: r.grund }
  }
  return null
}

/** Produktion per CLI: nur `… -f <datei>`, deren Inhalt mit ROLLBACK endet und kein COMMIT enthält */
function probelauf(befehl, existiert, lies) {
  const m = /\s-f\s+("[^"]+"|'[^']+'|\S+)/.exec(befehl)
  if (!m) return false
  const datei = m[1].replace(/^["']|["']$/g, '')
  if (!existiert(datei)) return false
  const sql = lies(datei)
  return /\bROLLBACK\s*;\s*$/i.test(sql.trim()) && !/\bCOMMIT\b/i.test(sql)
}

if (require.main === module) {
  let roh = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { roh += d })
  process.stdin.on('end', () => {
    let eingabe
    try { eingabe = JSON.parse(roh || '{}') } catch { process.exit(0) }   // unlesbar: nicht blockieren, der Rest des Harness greift
    const treffer = pruefe(eingabe)
    if (!treffer) process.exit(0)
    process.stderr.write(`Blockiert durch den Guard-Hook (${treffer.id}, Regeln ${REGELN.version}): ${treffer.grund}\n`)
    process.exit(2)
  })
}

module.exports = { pruefe, REGELN }
