/**
 * stand.js – Fingerabdruck des Arbeitsstands für das Stopp-Gate (docs/AGENTIC_DELIVERY.md).
 * Erfasst nur, was das verify-Gate prüft: geänderte und neue Dateien unter src/, scripts/, e2e/, supabase/migrations/
 * und package.json (Diff gegen HEAD samt Inhalt neuer Dateien). Unversionierte Dateien im Repo-Wurzelordner
 * (Nachweise, PDFs …) zählen nicht. Leerer Stand = nichts zu prüfen.
 *
 * verify-stempel.js schreibt den Fingerabdruck nach grünem `npm run verify` nach .claude/verify-stempel;
 * done-gate.js vergleicht beim Stopp.
 */
const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const PFADE = ['src', 'scripts', 'e2e', 'supabase/migrations', 'package.json']
const STEMPEL = path.join('.claude', 'verify-stempel')

function git(args, cwd) {
  // stderr verwerfen: Zeilenende-Warnungen von git gehören nicht in die Meldung des Hooks
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Fingerabdruck des Arbeitsstands oder '' (nichts geändert) */
function fingerabdruck(cwd = process.cwd()) {
  const diff = git(['diff', 'HEAD', '--', ...PFADE], cwd)
  const neu = git(['ls-files', '--others', '--exclude-standard', '--', ...PFADE], cwd).split('\n').filter(Boolean).sort()
  if (!diff && neu.length === 0) return ''
  const h = crypto.createHash('sha256').update(diff)
  for (const f of neu) {
    h.update('\0' + f + '\0')
    try { h.update(fs.readFileSync(path.join(cwd, f))) } catch { /* inzwischen gelöscht */ }
  }
  return h.digest('hex')
}

module.exports = { fingerabdruck, STEMPEL, PFADE }
