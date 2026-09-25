// KAN-73 (25.09.2026): Qualitätsstufen – Auswahllisten der App gegen die CHECKs der Datenbank
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/qualitaet.test.mjs
//          (Node ≥ 22.6, ohne Datenbank; läuft auch über npm run test:csv)
//
// (1) Jede angebotene Option ist in der CHECK-Liste ihrer Zieltabelle enthalten. Die CHECKs
//     werden aus den Migrationsdateien gelesen – in der Reihenfolge des Neuaufbaus (CLAUDE.md):
//     supabase/migrations_legacy in Nummernfolge, danach supabase/migrations nach Version (nur
//     Versionen nach 20260923190744; die älteren dort sind dieselben Statements wie in
//     migrations_legacy). Je Constraint zählt die letzte BENANNTE Definition
//     („ADD CONSTRAINT <name> CHECK (… IN (…))“ bzw. „= ANY (ARRAY[…])“); ein späteres
//     „DROP CONSTRAINT <name>“ ohne neue Definition entfernt sie. Inline-CHECKs ohne Namen
//     (CREATE TABLE … check (…)) werden nicht gewertet – ihre Auto-Namen stehen nicht im SQL.
// (2) kmwZuQualitaet liefert nur Lese-Stufen; Grenzwerte laut Weingesetz.
// (3) übrige Listen: QUALITAET_ORDER/QUALITAET_LABEL/PRAEDIKATSWEIN_ORDER, BKI-Kürzel,
//     Serverprüfung qualitaetFehler(), keine lokalen Qualitätslisten und kein „tafelwein“ in src.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const {
  QUALITAET_OPTS, LESE_QUALITAETEN, FUELLUNG_QUALITAETEN,
  istLeseQualitaet, istChargenQualitaet, istFuellungQualitaet,
  qualitaetFehler, mitGespeichertemWert, qualitaetLabel,
} = await import('../../src/lib/wein/qualitaet.ts')
const { kmwZuQualitaet, QUALITAET_ORDER, QUALITAET_LABEL, PRAEDIKATSWEIN_ORDER, istNiedrigerAls } =
  await import('../../src/lib/weinqualitaet.ts')
const kuerzel = await import('../../src/lib/wein/bki_kuerzel.ts')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATION_KAN73 = 'kan73_qualitaetsstufen_angleichen'
const LETZTE_ALTVERSION = '20260923190744'   // Neuaufbau: migrations/ erst nach dieser Version

const werte = liste => liste.map(o => o.value)
const menge = a => [...new Set(a)].sort()

// ── (1) CHECKs aus den Migrationen ────────────────────────────────────────────

/** Zeilenkommentare (--) außerhalb von '…' entfernen – zeilenweise, damit ein einzelnes
 *  Apostroph (z. B. in $$-Funktionskörpern) nicht den Rest der Datei verschiebt */
function ohneZeilenkommentare(sql) {
  return sql.split(/\r?\n/).map(zeile => {
    let inText = false
    for (let i = 0; i < zeile.length; i++) {
      const c = zeile[i]
      if (c === "'") inText = !inText
      else if (!inText && c === '-' && zeile[i + 1] === '-') return zeile.slice(0, i)
    }
    return zeile
  }).join('\n')
}

/** Position der schließenden Klammer zur öffnenden bei `start` (Texte in '…' übersprungen) */
function klammerEnde(s, start) {
  let tiefe = 0, inText = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inText) { if (c === "'") inText = false; continue }
    if (c === "'") inText = true
    else if (c === '(') tiefe++
    else if (c === ')' && --tiefe === 0) return i
  }
  return -1
}

/** Werteliste eines CHECK-Ausdrucks: „x IN ('a', …)“ oder „x = ANY (ARRAY['a'::text, …])“ */
function checkWerte(ausdruck) {
  const m = /\bIN\s*\(|=\s*ANY\s*\(\s*ARRAY\s*\[/i.exec(ausdruck)
  if (!m) return null
  const rest = ausdruck.slice(m.index + m[0].length)
  const ende = /\bIN\s*\($/i.test(m[0]) ? klammerEnde('(' + rest, 0) - 1 : rest.indexOf(']')
  if (ende < 0) return null
  return [...rest.slice(0, ende).matchAll(/'([^']*)'/g)].map(x => x[1])
}

function migrationsdateien() {
  const legacyDir = path.join(ROOT, 'supabase', 'migrations_legacy')
  const neuDir = path.join(ROOT, 'supabase', 'migrations')
  const nummer = f => parseInt(f, 10)
  const legacy = readdirSync(legacyDir).filter(f => f.endsWith('.sql'))
    .sort((a, b) => nummer(a) - nummer(b) || a.localeCompare(b))
    .map(f => path.join(legacyDir, f))
  const neu = readdirSync(neuDir).filter(f => /^\d{14}_.*\.sql$/.test(f) && f.slice(0, 14) > LETZTE_ALTVERSION)
    .sort()
    .map(f => path.join(neuDir, f))
  return [...legacy, ...neu]
}

/** Letzter Stand je benanntem CHECK: { werte, datei, ausdruck } bzw. null (gelöscht/nie benannt) */
function benannteChecks(namen) {
  const stand = new Map(namen.map(n => [n, null]))
  for (const datei of migrationsdateien()) {
    const sql = ohneZeilenkommentare(readFileSync(datei, 'utf8'))
    const ereignisse = []
    for (const m of sql.matchAll(/\bADD\s+CONSTRAINT\s+"?(\w+)"?\s+CHECK\s*\(/gi)) {
      if (!stand.has(m[1])) continue
      const auf = m.index + m[0].length - 1
      const zu = klammerEnde(sql, auf)
      assert.ok(zu > auf, `${path.basename(datei)}: CHECK ${m[1]} ohne schließende Klammer`)
      const ausdruck = sql.slice(auf + 1, zu)
      ereignisse.push({ pos: m.index, name: m[1], wert: { werte: checkWerte(ausdruck), datei: path.basename(datei), ausdruck } })
    }
    for (const m of sql.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) {
      if (stand.has(m[1])) ereignisse.push({ pos: m.index, name: m[1], wert: null })
    }
    for (const e of ereignisse.sort((a, b) => a.pos - b.pos)) stand.set(e.name, e.wert)
  }
  return stand
}

const CHECKS = benannteChecks([
  'ernte_parzellen_qualitaetsstufe_check',
  'weinausbau_qualitaetsstufe_check',
  'fuellungen_qualitaet_check',
])

function checkListe(name) {
  const c = CHECKS.get(name)
  assert.ok(c, `Keine benannte Definition von ${name} gefunden – Migration ${MIGRATION_KAN73} fehlt in supabase/migrations?`)
  assert.ok(c.werte, `${name} (${c.datei}): Werteliste nicht lesbar – „${c.ausdruck}“`)
  // NULL-Semantik wie bisher: der CHECK darf NULL nicht zusätzlich ausschließen
  assert.doesNotMatch(c.ausdruck, /IS\s+NOT\s+NULL/i, `${name}: CHECK schließt NULL aus`)
  return c.werte
}

describe('(1) Auswahllisten ⊆ CHECK der Zieltabelle', () => {
  test('Lese: LESE_QUALITAETEN = CHECK ernte_parzellen (als Menge)', () => {
    assert.deepEqual(menge(werte(LESE_QUALITAETEN)), menge(checkListe('ernte_parzellen_qualitaetsstufe_check')))
  })

  test('Charge: QUALITAET_OPTS ⊆ CHECK weinausbau', () => {
    const check = new Set(checkListe('weinausbau_qualitaetsstufe_check'))
    for (const v of werte(QUALITAET_OPTS)) assert.ok(check.has(v), `weinausbau lässt „${v}“ nicht zu`)
  })

  test('Füllung: FUELLUNG_QUALITAETEN ⊆ CHECK fuellungen', () => {
    const check = new Set(checkListe('fuellungen_qualitaet_check'))
    for (const v of werte(FUELLUNG_QUALITAETEN)) assert.ok(check.has(v), `fuellungen lässt „${v}“ nicht zu`)
  })

  test('Kette Lese → Charge → Füllung: jede Lese-Stufe ist auch Chargen- und Füllungs-Stufe', () => {
    const charge = new Set(checkListe('weinausbau_qualitaetsstufe_check'))
    const fuellung = new Set(checkListe('fuellungen_qualitaet_check'))
    for (const v of werte(LESE_QUALITAETEN)) {
      assert.ok(charge.has(v), `Charge kann „${v}“ nicht speichern`)
      assert.ok(fuellung.has(v), `Füllung kann „${v}“ nicht speichern`)
    }
    assert.ok(checkListe('ernte_parzellen_qualitaetsstufe_check').includes('wein'))
    assert.ok(!checkListe('ernte_parzellen_qualitaetsstufe_check').includes('tafelwein'))
  })
})

describe('Listen in lib/wein/qualitaet.ts', () => {
  test('Lese: genau die Mostgewichts-Stufen, aufsteigend nach Rang, Labels aus QUALITAET_OPTS', () => {
    assert.deepEqual(werte(LESE_QUALITAETEN), [
      'wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese',
      'auslese', 'beerenauslese', 'trockenbeerenauslese', 'eiswein',
    ])
    for (let i = 1; i < LESE_QUALITAETEN.length; i++) {
      assert.ok(LESE_QUALITAETEN[i - 1].rang <= LESE_QUALITAETEN[i].rang, 'Rangfolge')
    }
    for (const o of LESE_QUALITAETEN) assert.deepEqual(o, QUALITAET_OPTS.find(q => q.value === o.value))
    for (const nicht of ['dac', 'reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein', 'sonstiges', 'strohwein', 'ausbruch']) {
      assert.ok(!istLeseQualitaet(nicht), nicht)
    }
  })

  test('Füllung = alle 18 Stufen der Charge (inkl. Wein und Ausbruch)', () => {
    assert.equal(FUELLUNG_QUALITAETEN.length, 18)
    assert.deepEqual(werte(FUELLUNG_QUALITAETEN), werte(QUALITAET_OPTS))
    assert.ok(istFuellungQualitaet('wein') && istFuellungQualitaet('ausbruch'))
    assert.equal(new Set(werte(QUALITAET_OPTS)).size, QUALITAET_OPTS.length, 'Werte eindeutig')
  })

  test('Prüf-Helfer', () => {
    for (const v of werte(QUALITAET_OPTS)) {
      assert.ok(istChargenQualitaet(v), v)
      assert.ok(istFuellungQualitaet(v), v)
    }
    for (const v of ['tafelwein', '', null, undefined, 'Wein', ' wein', 42]) {
      assert.ok(!istLeseQualitaet(v) && !istChargenQualitaet(v) && !istFuellungQualitaet(v), String(v))
    }
  })

  test('qualitaetFehler: leer → null, zulässig → null, sonst verständliche Meldung', () => {
    for (const ziel of ['lese', 'charge', 'fuellung']) {
      assert.equal(qualitaetFehler(ziel, null), null)
      assert.equal(qualitaetFehler(ziel, undefined), null)
      assert.equal(qualitaetFehler(ziel, ''), null)
      assert.match(qualitaetFehler(ziel, 'tafelwein'), /„tafelwein“ ist .* unbekannt/)
    }
    for (const o of LESE_QUALITAETEN) assert.equal(qualitaetFehler('lese', o.value), null, o.value)
    for (const o of QUALITAET_OPTS) {
      assert.equal(qualitaetFehler('charge', o.value), null, o.value)
      assert.equal(qualitaetFehler('fuellung', o.value), null, o.value)
    }
    const dac = qualitaetFehler('lese', 'dac')
    assert.match(dac, /^Die Qualitätsstufe „DAC“ ist bei der Lese nicht zulässig\./)
    assert.match(dac, /Wein \(ohne Herkunft\), Landwein, Qualitätswein/)
    assert.match(dac, /erst bei der Charge bzw\. Füllung vergeben/)
    assert.match(qualitaetFehler('lese', 'strohwein'), /„Strohwein \/ Schilfwein“ ist bei der Lese nicht zulässig/)
  })

  test('mitGespeichertemWert: gespeicherter Wert außerhalb der Liste bleibt sichtbar', () => {
    assert.equal(mitGespeichertemWert(LESE_QUALITAETEN, 'kabinett'), LESE_QUALITAETEN)
    assert.equal(mitGespeichertemWert(LESE_QUALITAETEN, null), LESE_QUALITAETEN)
    assert.equal(mitGespeichertemWert(LESE_QUALITAETEN, ''), LESE_QUALITAETEN)
    const mitDac = mitGespeichertemWert(LESE_QUALITAETEN, 'dac')
    assert.equal(mitDac.length, LESE_QUALITAETEN.length + 1)
    assert.deepEqual(mitDac[0], { value: 'dac', label: 'DAC (bisheriger Wert)', rang: 99 })
    assert.equal(mitGespeichertemWert(QUALITAET_OPTS, 'altwert')[0].label, 'altwert (bisheriger Wert)')
  })
})

// ── (2) kmwZuQualitaet ───────────────────────────────────────────────────────

describe('(2) kmwZuQualitaet (lib/weinqualitaet.ts)', () => {
  test('KMW 0–40 (Schritt 0,1): nur Werte aus LESE_QUALITAETEN, monoton steigend', () => {
    const rang = new Map(LESE_QUALITAETEN.map((o, i) => [o.value, i]))
    let vorher = -1
    for (let i = 0; i <= 400; i++) {
      const q = kmwZuQualitaet(i / 10)
      assert.ok(istLeseQualitaet(q), `${i / 10} °KMW → ${q}`)
      assert.ok(rang.get(q) >= vorher, `${i / 10} °KMW: Stufe sinkt`)
      vorher = rang.get(q)
    }
  })

  test('Grenzwerte laut Weingesetz (Landwein erst ab 14 °KMW)', () => {
    const soll = [
      [0, 'wein'], [10.6, 'wein'], [13.9, 'wein'], [14, 'landwein'], [14.9, 'landwein'],
      [15, 'qualitaetswein'], [16.9, 'qualitaetswein'], [17, 'kabinett'], [18.9, 'kabinett'],
      [19, 'spaetlese'], [20.9, 'spaetlese'], [21, 'auslese'], [24.9, 'auslese'],
      [25, 'beerenauslese'], [29.9, 'beerenauslese'], [30, 'trockenbeerenauslese'], [40, 'trockenbeerenauslese'],
    ]
    for (const [kmw, q] of soll) assert.equal(kmwZuQualitaet(kmw), q, `${kmw} °KMW`)
  })

  test('Eiswein, Strohwein und Ausbruch werden nie abgeleitet', () => {
    for (let i = 0; i <= 400; i++) {
      assert.ok(!['eiswein', 'strohwein', 'ausbruch'].includes(kmwZuQualitaet(i / 10)))
    }
  })
})

// ── (3) übrige Listen ─────────────────────────────────────────────────────────

describe('(3) übrige Qualitätslisten', () => {
  test('lib/weinqualitaet.ts: QUALITAET_ORDER + „sonstiges“ und QUALITAET_LABEL = QUALITAET_OPTS', () => {
    assert.deepEqual(menge([...QUALITAET_ORDER, 'sonstiges']), menge(werte(QUALITAET_OPTS)))
    assert.deepEqual(menge(Object.keys(QUALITAET_LABEL)), menge(werte(QUALITAET_OPTS)))
    assert.equal(QUALITAET_LABEL.wein, 'Wein')
  })

  test('Prädikatswein-Skala enthält Wein (unterste Stufe) und Ausbruch – Abstufung funktioniert', () => {
    for (const v of PRAEDIKATSWEIN_ORDER) assert.ok(istChargenQualitaet(v), v)
    assert.equal(PRAEDIKATSWEIN_ORDER[0], 'wein')
    assert.ok(istNiedrigerAls('wein', 'landwein'))
    assert.ok(istNiedrigerAls('landwein', 'qualitaetswein'))
    assert.ok(!istNiedrigerAls('landwein', 'wein'))
    assert.ok(istNiedrigerAls('beerenauslese', 'ausbruch') && istNiedrigerAls('ausbruch', 'trockenbeerenauslese'))
    // Füllungsformular (nur Abstufung): Charge „Wein“ → nur Wein und Sonstiges
    const erlaubt = FUELLUNG_QUALITAETEN.filter(q => q.value === 'wein' || q.value === 'sonstiges' || istNiedrigerAls(q.value, 'wein'))
    assert.deepEqual(werte(erlaubt), ['wein', 'sonstiges'])
  })

  test('BKI-Kürzel: jede Lese-Stufe hat ein amtliches Kürzel, „wein“ → WEI', () => {
    for (const o of LESE_QUALITAETEN) {
      const r = kuerzel.qualitaetBki(o.value)
      assert.ok(r.kuerzel, `${o.value} ohne BKI-Kürzel`)
      assert.equal(r.hinweis, null, o.value)
    }
    assert.equal(kuerzel.getQualitaetBki('wein'), 'WEI')
  })

  test('src: keine lokalen Qualitätslisten mehr und kein „tafelwein“', () => {
    const erlaubt = new Set([
      path.join('src', 'lib', 'wein', 'qualitaet.ts'),
      path.join('src', 'lib', 'weinqualitaet.ts'),
      path.join('src', 'lib', 'wein', 'bki_kuerzel.ts'),
    ])
    const funde = []
    ;(function durchsuche(dir) {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') durchsuche(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        const rel = path.relative(ROOT, p)
        const text = readFileSync(p, 'utf8')
        if (/tafelwein/i.test(text)) funde.push(`${rel}: „tafelwein“`)
        if (erlaubt.has(rel)) continue
        // eine Liste mit mehreren Prädikatsstufen als Codes (Option, Array, Label-Map)
        const codes = ['spaetlese', 'beerenauslese', 'trockenbeerenauslese']
          .filter(c => new RegExp(`['"]${c}['"]|\\b${c}\\s*:`).test(text))
        if (codes.length >= 2) funde.push(`${rel}: eigene Qualitätsliste (${codes.join(', ')}) – zentrale Liste aus lib/wein/qualitaet.ts verwenden`)
      }
    })(path.join(ROOT, 'src'))
    assert.deepEqual(funde, [])
  })

  test('qualitaetLabel: Listen-Labels, unbekannt unverändert, leer als Strich', () => {
    assert.equal(qualitaetLabel('wein'), 'Wein (ohne Herkunft)')
    assert.equal(qualitaetLabel('ausbruch'), 'Ausbruch')
    assert.equal(qualitaetLabel('xyz'), 'xyz')
    assert.equal(qualitaetLabel(null), '–')
  })
})
