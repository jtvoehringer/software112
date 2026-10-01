// KAN-150 F2 (01.10.2026): DAC-Anträge, Analysen, Prüfnummernanträge, Transportbescheinigungen und Exportaufträge
// werden storniert statt gelöscht (storniert_am). Ein stornierter Eintrag gilt nicht mehr: keine Prüfnummer, keine
// aktuellen Analysewerte, kein gespeichertes Formular. Jede LESENDE Abfrage unter src/ auf diese Tabellen filtert
// deshalb .is('storniert_am', null) – bewusst ungefilterte Leser (Listen, Druck, CSV und Weinbuch zeigen stornierte
// Einträge gekennzeichnet; Detailseiten; Zähl- und Belegungsprüfungen) brauchen `// storno-sichtbar: <Grund>` direkt
// darüber (bis 300 Zeichen) oder in der Kette. Muster wie scripts/tests/kan148-storno-leser.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const MARKER = /storno-sichtbar:\s*\S.{10,}/

function dateien(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) out.push(...dateien(p))
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

/** Kette ab .from(…)/.q(…) bis zum Ende der Anweisung (wie kan148-storno-leser) */
function kette(s, i) {
  const rest = s.slice(i, i + 900)
  const ende = rest.slice(1).search(/;\s*\n|\n\s*\n|\n\s*(?:const |let |var |if |for |return |throw |await |try |\}|\]\)|for\b)|\.from\(|\.q\(/)
  return ende >= 0 ? rest.slice(0, ende + 1) : rest
}

test('jede lesende Abfrage auf die Antragstabellen filtert stornierte Zeilen oder ist begründet', () => {
  const funde = []
  let geprueft = 0
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const re = /\.(?:from|q)\('(dac_antrag|weinanalysen|pruefnummernantraege|transportbescheinigungen|exportauftraege)'\)/g
    let m
    while ((m = re.exec(s))) {
      const k = kette(s, m.index)
      if (/\.(insert|update|delete|upsert)\(/.test(k)) continue   // schreibende Kette
      if (!/\.select\(/.test(k)) continue
      geprueft++
      const vorher = s.slice(Math.max(0, m.index - 300), m.index)
      if (/\.is\('storniert_am', null\)/.test(k) || MARKER.test(vorher) || MARKER.test(k)) continue
      funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length} (${m[1]})`)
    }
  }
  assert.ok(geprueft >= 20, `zu wenige Abfragen gefunden (${geprueft}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'ohne .is(\'storniert_am\', null) bzw. // storno-sichtbar: <Grund>')
})
