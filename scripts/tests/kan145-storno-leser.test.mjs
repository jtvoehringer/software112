// KAN-145 B2 (30.09.2026): Stornierte Umzüge und Verschnitte bleiben stehen (storniert_am) und dürfen in keinem
// Bestand und keiner Meldung zählen. Jede LESENDE Abfrage auf keller_umzuege bzw. verschneidungen unter src/ filtert
// deshalb .is('storniert_am', null); Verschnitt-Quellen (verschneidung_quellen) laufen über ohneStornierteVerschnitte.
// Bewusst ungefilterte Leser (z. B. eine spätere Storno-Ansicht) brauchen direkt darüber
// `// storno-sichtbar: <Grund>`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

function dateien(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) out.push(...dateien(p))
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

test('jede lesende Abfrage auf keller_umzuege/verschneidungen filtert stornierte Buchungen', () => {
  const funde = []
  let geprueft = 0
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const re = /\(supabase\.from\('(keller_umzuege|verschneidungen)'\) as any\)\s*\n\s*\.select\(/g
    let m
    while ((m = re.exec(s))) {
      geprueft++
      const danach = s.slice(m.index, m.index + 900)
      const vorher = s.slice(Math.max(0, m.index - 300), m.index)
      if (/\.is\('storniert_am', null\)/.test(danach) || /storno-sichtbar:\s*\S.{10,}/.test(vorher)) continue
      funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length} (${m[1]})`)
    }
  }
  assert.ok(geprueft >= 30, `zu wenige Abfragen gefunden (${geprueft}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'ohne .is(\'storniert_am\', null) bzw. // storno-sichtbar: <Grund>')
})

test('Verschnitt-Quellen: jede lesende Abfrage bettet die Verschneidung mit storniert_am ein und filtert im Code', () => {
  const funde = []
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const re = /\(supabase\.from\('verschneidung_quellen'\) as any\)[^\n]*\n\s*\.select\(/g
    let m
    while ((m = re.exec(s))) {
      const danach = s.slice(m.index, m.index + 400)
      if (/verschneidung:verschneidung_id\([^)]*storniert_am/.test(danach) && s.includes('ohneStornierteVerschnitte(')) continue
      funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(funde, [])
})

test('storno.ts löscht nicht mehr, sondern kennzeichnet (Grund Pflicht)', () => {
  const s = readFileSync(path.join(SRC, 'lib/kellerbuch/storno.ts'), 'utf8')
  assert.doesNotMatch(s, /\.delete\(\)/)
  assert.match(s, /\.update\(\{ storniert_am: new Date\(\)\.toISOString\(\), storno_grund: grund\.trim\(\) \}\)/)
  assert.match(s, /\.is\('storniert_am', null\)\s*\n\s*\.select\('id'\)/)
})
