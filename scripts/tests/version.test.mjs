// Version und Stand (13.10.2026): eine Quelle für Login-Seite und Fußzeile – vorher fest eingetragen und auseinander-
// gelaufen (Login „v2.1.0 · Juni 2026“, Fußzeile „v2.3.0 · August 2026“, letzte Release Note 2.3.0 vom September).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = (p) => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

test('Version: Nummer x.y.z, Stand „Monat JJJJ“, Anzeige daraus zusammengesetzt', () => {
  const v = quelle('src/lib/version.ts')
  assert.match(v, /export const APP_VERSION_NR = '\d+\.\d+\.\d+'/)
  assert.match(v, /export const APP_STAND = '(Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember) \d{4}'/)
  assert.match(v, /export const APP_VERSION = `v\$\{APP_VERSION_NR\} · \$\{APP_STAND\}`/)
})

test('Login und Fußzeile zeigen die Version aus src/lib/version.ts', () => {
  for (const f of ['src/app/(auth)/login/page.tsx', 'src/components/layout/AppShell.tsx']) {
    const s = quelle(f)
    assert.match(s, /import \{ APP_VERSION \} from '@\/lib\/version'/, f)
    assert.match(s, /\{APP_VERSION\}/, f)
  }
})

test('keine fest eingetragene Versionsanzeige „vX.Y.Z · Monat“ mehr in src', () => {
  const funde = []
  const lauf = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n)
      if (statSync(p).isDirectory()) { lauf(p); continue }
      if (!/\.(tsx?|mjs|js)$/.test(n) || p.endsWith(path.join('lib', 'version.ts'))) continue
      if (/v\d+\.\d+\.\d+ · [A-ZÄÖÜ][a-zäöü]+ \d{4}/.test(readFileSync(p, 'utf8'))) funde.push(path.relative(WURZEL, p))
    }
  }
  lauf(path.join(WURZEL, 'src'))
  assert.deepEqual(funde, [])
})
