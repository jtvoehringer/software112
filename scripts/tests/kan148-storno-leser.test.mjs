// KAN-148 C1b (30.09.2026): Stornierte Lesedaten (ernte_parzellen) und Traubenverkäufe (traubenverkauf) bleiben
// stehen (storniert_am) und dürfen in keiner Menge, keiner Verfügbarkeit und keiner Meldung zählen. Jede LESENDE
// Abfrage unter src/ – direkt (.from('…')) oder eingebettet (ernte_parzellen(…), traubenverkauf:traubenverkauf(…)) –
// filtert deshalb .is('storniert_am', null) bzw. holt storniert_am in der Einbettung mit und filtert im Code.
// Bewusst ungefilterte Leser (Listen, Druck und CSV zeigen stornierte Zeilen gekennzeichnet; Belegungsprüfungen
// zählen sie mit) brauchen `// storno-sichtbar: <Grund>` direkt darüber (bis 300 Zeichen) oder in der Kette.

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

/** Kette ab .from(…) bis zum Ende der Anweisung: Leerzeile, nächste Anweisung (const/let/if/return/…, schließende
 *  Klammer) oder nächstes .from( – höchstens 900 Zeichen. Das Projekt schreibt ohne Semikolon. */
function kette(s, i) {
  const rest = s.slice(i, i + 900)
  const ende = rest.slice(1).search(/;\s*\n|\n\s*\n|\n\s*(?:const |let |var |if |for |return |throw |await |try |\}|\]\)|for\b)|\.from\(/)
  return ende >= 0 ? rest.slice(0, ende + 1) : rest
}

test('jede lesende Abfrage auf ernte_parzellen/traubenverkauf filtert stornierte Zeilen oder ist begründet', () => {
  const funde = []
  let geprueft = 0
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const re = /\.from\('(ernte_parzellen|traubenverkauf|pressungen|pressung_behaelter|pressung_weingaerten)'\)/g   // Pressung seit C1c
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
  assert.ok(geprueft >= 25, `zu wenige Abfragen gefunden (${geprueft}) – Muster prüfen`)
  assert.deepEqual(funde, [], 'ohne .is(\'storniert_am\', null) bzw. // storno-sichtbar: <Grund>')
})

test('Einbettungen von ernte_parzellen/traubenverkauf holen storniert_am mit oder sind begründet', () => {
  const funde = []
  for (const f of dateien(SRC)) {
    const s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    // PostgREST-Einbettung in einem select-String: name(…) oder alias:name(…) bzw. alias:fk_spalte(…)
    // (auch über die FK-Spalte: alias:traubenverkauf_id(…), pressung:pressung_id(…); Pressung seit C1c)
    const re = /[\s,'`(](?:\w+:)?(ernte_parzellen|traubenverkauf|pressungen|pressung_behaelter|pressung_weingaerten|pressung(?=_id))(?:_id)?(?:!\w+)?\(/g
    let m
    while ((m = re.exec(s))) {
      const zeile = s.slice(s.lastIndexOf('\n', m.index) + 1, s.indexOf('\n', m.index))
      // Code statt select-Liste (Aufrufe, Deklarationen, Kommentare)
      if (/\.from\(|function |=>|^\s*\/\/|^\s*\*|import |\b(ernte_parzellen|traubenverkauf|pressung)\w*\((?!\s*[a-z_*])/.test(zeile)) continue
      // Klammerinhalt der Einbettung
      let tiefe = 0, j = m.index + m[0].length - 1, innen = ''
      for (; j < s.length && j < m.index + 800; j++) {
        if (s[j] === '(') tiefe++
        else if (s[j] === ')') { tiefe--; if (tiefe === 0) break }
        innen += s[j]
      }
      const vorher = s.slice(Math.max(0, m.index - 400), m.index)
      if (/\bstorniert_am\b/.test(innen) || MARKER.test(vorher)) continue
      funde.push(`${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length} (${m[1]})`)
    }
  }
  assert.deepEqual(funde, [], 'Einbettung ohne storniert_am bzw. // storno-sichtbar: <Grund>')
})

test('Lesedaten und Traubenverkäufe werden storniert, nicht gelöscht (KAN-148 C1b)', () => {
  const lies = p => readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n')
  const ernte = lies('app/(dashboard)/erntemeldung/actions.ts')
  const handel = lies('app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
  const bestand = lies('lib/verkauf/bestand.ts')
  for (const [name, s] of [['erntemeldung/actions.ts', ernte], ['weinhandel/traubenverkauf/actions.ts', handel], ['lib/verkauf/bestand.ts', bestand]]) {
    assert.ok(!/from\('(ernte_parzellen|traubenverkauf)'\)[^;]*?\.delete\(/s.test(s.replace(/\.from\('(?!ernte_parzellen|traubenverkauf)/g, '§')),
      `${name}: .delete() auf ernte_parzellen/traubenverkauf`)
  }
  assert.match(ernte, /export async function stornoErnteParzelle\(id: string, jahrgangId: string, grund: string\)/)
  assert.match(ernte, /export async function stornoTraubenverkauf\(id: string, jahrgangId: string, grund: string\)/)
  assert.match(handel, /export async function stornoTraubenverkauf\(id: string, grund: string\)/)
  assert.match(bestand, /storniert_am: new Date\(\)\.toISOString\(\), storno_grund:/)
})

test('Pressung wird über die RPC storniert, nicht gelöscht (KAN-148 C1c)', () => {
  const s = readFileSync(path.join(SRC, 'app/(dashboard)/erntemeldung/actions.ts'), 'utf8').replace(/\r\n/g, '\n')
  const i = s.indexOf('export async function stornoPressung(id: string, jahrgangId: string, grund: string)')
  assert.ok(i > 0, 'stornoPressung fehlt')
  const rumpf = s.slice(i, s.indexOf('\n}\n', i))
  assert.match(rumpf, /rpc as any\)\('s112_pressung_stornieren', \{ p_tenant_id: tenantId, p_pressung_id: id, p_grund: grund\.trim\(\) \}\)/)
  assert.ok(!/\.delete\(/.test(rumpf), 'kein .delete() mehr')
  assert.ok(!/canAdmin/.test(rumpf), 'Mitarbeiter dürfen stornieren (KAN-166)')
  assert.ok(!s.includes('export async function deletePressung('), 'deletePressung entfernt')
})

test('Pressung bearbeiten und anlegen ohne Löschen (KAN-148 C1c-2)', () => {
  const s = readFileSync(path.join(SRC, 'app/(dashboard)/erntemeldung/actions.ts'), 'utf8').replace(/\r\n/g, '\n')
  const i = s.indexOf('async function mostzeileMitChargeAnlegen(')
  const j = s.indexOf('// Pressung stornieren (KAN-148 C1c')
  assert.ok(i > 0 && j > i, 'Pressungscode nicht gefunden')
  const code = s.slice(i, j)
  assert.ok(!/\.delete\(/.test(code), 'kein .delete() beim Anlegen/Bearbeiten einer Pressung')
  assert.match(code, /'s112_mostzeile_anlegen'/)
  assert.match(code, /'s112_pressung_anlegen'/)
  assert.match(code, /'s112_pressung_zeilen_stornieren'[\s\S]{0,400}p_grund: GRUND_BEARBEITET/)
  assert.ok(!/canAdmin\(membership\.role\)\) \{\n\s*throw new AktionsFehler\(`Das Entfernen des Behälters/.test(code), 'Entfernen eines Behälters ohne Admin-Schranke (KAN-166)')
})
