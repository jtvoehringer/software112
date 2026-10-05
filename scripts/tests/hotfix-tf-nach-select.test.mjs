// Hotfix 05.10.2026: Das Dashboard (Übersicht, Fristen, Hinweise) brach in jedem Betrieb mit „a.eq is not a function“
// ab – im Fristen-Eintrag „Aufzeichnung Pflanzenschutz & Düngung“ (KAN-87) stand ctx.tf(ctx.q('behandlungen'))
// VOR dem .select(). Der Supabase-Abfrage-Builder kennt .eq erst nach .select(), tf() hängt aber .eq('tenant_id', …) an.
// Regressionstest: jedes tf(…) bzw. ctx.tf(…) unter src/ umschließt eine Abfrage, die schon .select( enthält.
//
// Aufruf:  npm run -s test:csv

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

/** Inhalt der Klammer ab Index i (i zeigt auf „(“) */
function klammer(s, i) {
  let tiefe = 0
  for (let j = i; j < s.length && j < i + 3000; j++) {
    if (s[j] === '(') tiefe++
    else if (s[j] === ')') { tiefe--; if (tiefe === 0) return s.slice(i + 1, j) }
  }
  return s.slice(i + 1, i + 3000)
}

test('tf(…) umschließt immer eine Abfrage mit .select() – Betriebsfilter nie vor dem select', () => {
  const funde = []
  let geprueft = 0
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const re = /\b(?:ctx\.)?tf\(/g
    let m
    while ((m = re.exec(s))) {
      const innen = klammer(s, m.index + m[0].length - 1)
      if (!/\.from\(|\bq\(/.test(innen)) continue   // keine Abfrage (z. B. Definition oder anderer Aufruf)
      geprueft++
      if (!/\.select\(/.test(innen)) funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.ok(geprueft >= 30, `zu wenige tf-Aufrufe gefunden (${geprueft}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'tf(…) ohne .select() in der umschlossenen Abfrage')
})
