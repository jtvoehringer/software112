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
// (2) kmwZuQualitaet liefert nur Lese-Stufen; Grenzwerte laut Weingesetz; Lese-Auswahl je °KMW.
// (3) übrige Listen: QUALITAET_ORDER/QUALITAET_LABEL/PRAEDIKATSWEIN_ORDER, BKI-Kürzel,
//     Serverprüfung qualitaetFehler(), keine lokalen Qualitätslisten und kein „tafelwein“ in src.
// (4) Abstufungsregeln (Eiswein/Strohwein als eigene Zweige auf BA-Niveau, DAC & Co. auf
//     Qualitätswein-Niveau), Auswahl von Füllung und Charge, Stufe neuer Pressungs-Chargen und
//     die Kette Lese → Pressung → Charge → Füllung für jede Lese-Stufe.
// (5) Formulare und Server Actions: jede Datei verwendet die Liste ihrer Zieltabelle (statisch).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const {
  QUALITAET_OPTS, LESE_QUALITAETEN, FUELLUNG_QUALITAETEN,
  istLeseQualitaet, istChargenQualitaet, istFuellungQualitaet,
  qualitaetFehler, mitGespeichertemWert, qualitaetLabel,
  leseStufenBeiKmw, fuellungsStufenFuer, chargenStufenBis,
  minQualitaet: minQualitaetUmzug,
} = await import('../../src/lib/wein/qualitaet.ts')
const {
  kmwZuQualitaet, QUALITAET_ORDER, QUALITAET_LABEL, PRAEDIKATSWEIN_ORDER, istNiedrigerAls,
  istMindestens, minQualitaet, maxQualitaet, MINDEST_KMW, stufeMitKmwMoeglich,
  istAbstufung, istAufstufung, leseStufeFuerPressung, pressungsQualitaet,
} = await import('../../src/lib/weinqualitaet.ts')
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
    assert.match(dac, /Bei der Lese sind nur diese Stufen vorgesehen: Wein \(ohne Herkunft\), Landwein, Qualitätswein/)
    assert.match(dac, /bei der Charge bzw\. Füllung vergeben/)
    const stroh = qualitaetFehler('lese', 'strohwein')
    assert.match(stroh, /„Strohwein \/ Schilfwein“ ist bei der Lese nicht zulässig/)
    // Strohwein/Ausbruch haben ein Mindestmostgewicht – die Meldung nennt sie ausdrücklich als offen
    assert.match(stroh, /Strohwein und Ausbruch derzeit nicht \(Entscheidung offen\)/)
    assert.doesNotMatch(stroh, /Mostgewichts-Stufen/)
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

  test('MINDEST_KMW passt zu kmwZuQualitaet (jede ableitbare Stufe beginnt genau an ihrer Grenze)', () => {
    for (const v of PRAEDIKATSWEIN_ORDER) assert.equal(typeof MINDEST_KMW[v], 'number', v)
    for (const v of ['landwein', 'qualitaetswein', 'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'trockenbeerenauslese']) {
      assert.equal(kmwZuQualitaet(MINDEST_KMW[v]), v, `${v} ab ${MINDEST_KMW[v]} °KMW`)
      assert.notEqual(kmwZuQualitaet(MINDEST_KMW[v] - 0.1), v, `${v} unter ${MINDEST_KMW[v]} °KMW`)
    }
    assert.equal(MINDEST_KMW.eiswein, 25)
    assert.equal(MINDEST_KMW.strohwein, 25)
    assert.equal(MINDEST_KMW.ausbruch, 27)
  })

  test('Lese-Auswahl je °KMW (leseStufenBeiKmw): nur Stufen, die das Mostgewicht trägt – Eiswein ab 25', () => {
    const lese = new Set(werte(LESE_QUALITAETEN))
    assert.deepEqual(werte(leseStufenBeiKmw(null)), werte(LESE_QUALITAETEN))
    assert.deepEqual(werte(leseStufenBeiKmw(Number.NaN)), werte(LESE_QUALITAETEN))
    for (let i = 0; i <= 400; i++) {
      const kmw = i / 10
      const optionen = werte(leseStufenBeiKmw(kmw))
      for (const v of optionen) assert.ok(lese.has(v), `${kmw} °KMW: ${v}`)
      assert.ok(optionen.includes(kmwZuQualitaet(kmw)), `${kmw} °KMW: Vorbelegung ${kmwZuQualitaet(kmw)} fehlt`)
      for (const v of optionen) assert.ok(v === 'eiswein' || istMindestens(kmwZuQualitaet(kmw), v), `${kmw} °KMW: ${v} über der Ableitung`)
      assert.equal(optionen.includes('eiswein'), kmw >= 25, `${kmw} °KMW: Eiswein`)
    }
    assert.ok(!stufeMitKmwMoeglich('kabinett', 16.9) && stufeMitKmwMoeglich('kabinett', 17))
    assert.ok(!stufeMitKmwMoeglich('eiswein', 24.9) && stufeMitKmwMoeglich('eiswein', 25))
    assert.ok(stufeMitKmwMoeglich('trockenbeerenauslese', null), 'ohne KMW keine Prüfung')
    assert.ok(stufeMitKmwMoeglich('dac', 10), 'außerhalb der Skala keine Prüfung')
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
    assert.deepEqual(werte(fuellungsStufenFuer('wein')), ['wein', 'sonstiges'])
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

// ── (4) Abstufungsregeln, Pressung und Kette ─────────────────────────────────

describe('(4) Abstufungsregeln (lib/weinqualitaet.ts)', () => {
  test('Eiswein und Strohwein: eigene Zweige auf BA-Niveau – nicht vergleichbar mit Ausbruch/TBA und einander', () => {
    assert.ok(istNiedrigerAls('beerenauslese', 'eiswein') && istNiedrigerAls('auslese', 'strohwein'))
    for (const [a, b] of [['ausbruch', 'eiswein'], ['trockenbeerenauslese', 'eiswein'], ['eiswein', 'strohwein'], ['ausbruch', 'strohwein']]) {
      assert.ok(!istNiedrigerAls(a, b) && !istNiedrigerAls(b, a), `${a} / ${b}`)
    }
    assert.ok(istMindestens('eiswein', 'beerenauslese') && !istMindestens('eiswein', 'ausbruch'))
    assert.ok(!istMindestens('trockenbeerenauslese', 'eiswein'))
    assert.ok(!istMindestens('dac', 'wein') && !istMindestens('wein', 'dac'), 'DAC liegt nicht auf der Skala')
  })

  test('minQualitaet (Verschnitt): höchste gemeinsame Stufe, Zweige über die Hauptskala', () => {
    assert.equal(minQualitaet(['eiswein', 'trockenbeerenauslese']), 'beerenauslese')
    assert.equal(minQualitaet(['eiswein', 'ausbruch']), 'beerenauslese')
    assert.equal(minQualitaet(['eiswein', 'strohwein']), 'beerenauslese')
    assert.equal(minQualitaet(['eiswein', 'eiswein']), 'eiswein')
    assert.equal(minQualitaet(['eiswein', 'auslese']), 'auslese')
    assert.equal(minQualitaet(['trockenbeerenauslese', 'ausbruch']), 'ausbruch')
    assert.equal(minQualitaet(['kabinett', 'dac', null, 'sonstiges']), 'kabinett', 'DAC & Co. wie bisher ignoriert')
    assert.equal(minQualitaet(['dac', 'reserve']), null)
    assert.equal(minQualitaet([]), null)
    // Verschnitt meldet die Abstufung gegen die höchste Stufe (kellerbuch/actions.ts)
    assert.ok(istNiedrigerAls(minQualitaet(['eiswein', 'trockenbeerenauslese']), maxQualitaet(['eiswein', 'trockenbeerenauslese'])))
    // Umziehen (lib/wein/qualitaet.ts): auf der Skala gleiche Regel, sonst Rang wie bisher
    assert.equal(minQualitaetUmzug('eiswein', 'trockenbeerenauslese'), 'beerenauslese')
    assert.equal(minQualitaetUmzug('strohwein', 'eiswein'), 'beerenauslese')
    assert.equal(minQualitaetUmzug('dac', 'qualitaetswein'), 'qualitaetswein')
    assert.equal(minQualitaetUmzug(null, 'kabinett'), 'kabinett')
  })

  test('Füllung: Auswahl je Charge nur Abstufungen, nie eine vom Server gesperrte Aufstufung', () => {
    const alleWerte = werte(QUALITAET_OPTS)
    for (const charge of [...alleWerte, null, 'altwert']) {
      const optionen = werte(fuellungsStufenFuer(charge))
      for (const v of optionen) {
        assert.ok(istFuellungQualitaet(v), `${charge} → ${v}: nicht in FUELLUNG_QUALITAETEN`)
        assert.ok(!istAufstufung(charge, v), `${charge} → ${v}: angeboten, aber vom Server gesperrt`)
      }
      if (charge && alleWerte.includes(charge)) assert.ok(optionen.includes(charge), `${charge}: eigene Stufe fehlt`)
      assert.ok(optionen.includes('sonstiges'), `${charge}: Sonstiges fehlt`)
    }
    assert.deepEqual(werte(fuellungsStufenFuer(null)), alleWerte)
    const eis = werte(fuellungsStufenFuer('eiswein'))
    assert.ok(eis.includes('beerenauslese') && eis.includes('eiswein'))
    for (const nicht of ['ausbruch', 'trockenbeerenauslese', 'strohwein']) assert.ok(!eis.includes(nicht), `Eiswein → ${nicht}`)
    assert.deepEqual(werte(fuellungsStufenFuer('dac')), ['wein', 'landwein', 'qualitaetswein', 'dac', 'sonstiges'])
    assert.deepEqual(werte(fuellungsStufenFuer('sekt')), ['sekt', 'sonstiges'])
    assert.ok(werte(fuellungsStufenFuer('trockenbeerenauslese')).includes('ausbruch'))
  })

  test('Füllung: Serverregel istAufstufung / Vermerk istAbstufung', () => {
    for (const [von, nach] of [
      ['eiswein', 'ausbruch'], ['eiswein', 'trockenbeerenauslese'], ['strohwein', 'eiswein'], ['eiswein', 'strohwein'],
      ['wein', 'dac'], ['wein', 'reserve'], ['landwein', 'sekt'], ['landwein', 'erste_lage'],
      ['dac', 'kabinett'], ['dac', 'eiswein'], ['reserve', 'auslese'], ['qualitaetswein', 'kabinett'], ['wein', 'landwein'],
    ]) assert.ok(istAufstufung(von, nach), `${von} → ${nach} muss gesperrt sein`)
    for (const [von, nach] of [
      ['trockenbeerenauslese', 'ausbruch'], ['eiswein', 'beerenauslese'], ['eiswein', 'wein'],
      ['qualitaetswein', 'reserve'], ['qualitaetswein', 'sekt'], ['qualitaetswein', 'dac'],   // Bestand Musterhof: QW → Reserve/Sekt
      ['dac', 'qualitaetswein'], ['dac', 'reserve'], ['kabinett', 'dac'], ['wein', 'perlwein'], ['wein', 'sonstiges'],
      ['sekt', 'kabinett'], ['sonstiges', 'kabinett'], [null, 'eiswein'], ['kabinett', 'kabinett'],
    ]) assert.ok(!istAufstufung(von, nach), `${von} → ${nach} darf nicht gesperrt sein`)
    assert.ok(istAbstufung('dac', 'qualitaetswein') && istAbstufung('eiswein', 'beerenauslese'))
    assert.ok(!istAbstufung('qualitaetswein', 'reserve') && !istAbstufung('kabinett', 'kabinett'))
  })

  test('Charge: Auswahl chargenStufenBis ⊆ QUALITAET_OPTS, Eiswein/Strohwein nicht nach Ausbruch/TBA bzw. einander', () => {
    assert.deepEqual(werte(chargenStufenBis(null)), werte(QUALITAET_OPTS))
    for (const basis of werte(QUALITAET_OPTS)) {
      const optionen = werte(chargenStufenBis(basis))
      assert.ok(optionen.includes(basis), basis)
      for (const v of optionen) assert.ok(istChargenQualitaet(v), `${basis} → ${v}`)
      // außerhalb der Zweige unverändert: alles mit höchstens gleichem Rang
      if (basis !== 'eiswein' && basis !== 'strohwein') {
        const rang = QUALITAET_OPTS.find(o => o.value === basis).rang
        assert.deepEqual(optionen, werte(QUALITAET_OPTS.filter(o => o.rang <= rang)), basis)
      }
    }
    for (const zweig of ['eiswein', 'strohwein']) {
      const optionen = werte(chargenStufenBis(zweig))
      for (const nicht of ['ausbruch', 'trockenbeerenauslese', zweig === 'eiswein' ? 'strohwein' : 'eiswein']) {
        assert.ok(!optionen.includes(nicht), `${zweig} → ${nicht}`)
      }
      assert.ok(optionen.includes('beerenauslese') && optionen.includes('grosses_gewachs'), zweig)
    }
  })
})

describe('(4) Stufe neuer Pressungs-Chargen (pressungsQualitaet, leseStufeFuerPressung)', () => {
  test('Lese-Stufe gedeckelt durch den Ø-KMW – nie Aufstufung', () => {
    assert.equal(pressungsQualitaet(['wein'], null), 'wein', 'Lese „Wein“ ohne KMW (vorher Qualitätswein)')
    assert.equal(pressungsQualitaet(['wein'], 16), 'wein', 'Lese auf „Wein“ abgestuft bei 16 °KMW')
    assert.equal(pressungsQualitaet(['eiswein'], 26), 'eiswein', 'Eiswein bei 26 °KMW (vorher BA)')
    assert.equal(pressungsQualitaet(['eiswein'], 30.5), 'eiswein')
    assert.equal(pressungsQualitaet(['eiswein'], null), 'eiswein')
    assert.equal(pressungsQualitaet(['eiswein'], 22), 'auslese', 'Eiswein ohne BA-Niveau → Ableitung')
    assert.equal(pressungsQualitaet(['eiswein', null], 26), 'beerenauslese', 'Zukauf (unbekannt) + Eiswein')
    assert.equal(pressungsQualitaet(['eiswein', 'trockenbeerenauslese'], 31), 'beerenauslese')
    assert.equal(pressungsQualitaet(['eiswein', 'eiswein'], 25), 'eiswein')
    assert.equal(pressungsQualitaet(['qualitaetswein'], 18), 'qualitaetswein', 'abgestufte Lese bleibt abgestuft')
    assert.equal(pressungsQualitaet(['kabinett', 'qualitaetswein'], 18), 'qualitaetswein')
    assert.equal(pressungsQualitaet(['trockenbeerenauslese'], 20), 'spaetlese')
    // ohne Lese-Stufe wie bisher: Ableitung, sonst Qualitätswein
    assert.equal(pressungsQualitaet([null], 18), 'kabinett')
    assert.equal(pressungsQualitaet([], 12), 'wein')
    assert.equal(pressungsQualitaet([], null), 'qualitaetswein')
    assert.equal(pressungsQualitaet([null, undefined], null), 'qualitaetswein')
    assert.equal(pressungsQualitaet(['dac'], 18), 'kabinett', 'Altwert außerhalb der Skala zählt als unbekannt')
  })

  test('Ergebnis ist immer eine Chargen-Stufe', () => {
    const stufen = [...werte(LESE_QUALITAETEN), null]
    for (const a of stufen) for (const b of stufen) for (const kmw of [null, 0, 12, 14, 15, 17, 19, 21, 25, 27, 30, 35]) {
      assert.ok(istChargenQualitaet(pressungsQualitaet([a, b], kmw)), `${a}, ${b}, ${kmw}`)
    }
  })

  test('Lese-Stufe je Pressungszeile: letzte Lese bis zum Pressungsdatum, gleicher Tag → niedrigste', () => {
    const lese = [
      { weingartenId: 'W1', grundstueckId: 'G1', datum: '2026-09-20', stufe: 'qualitaetswein' },
      { weingartenId: 'W1', grundstueckId: 'G1', datum: '2026-12-10', stufe: 'eiswein' },
      { weingartenId: 'W1', grundstueckId: 'G2', datum: '2026-09-22', stufe: 'wein' },
      { weingartenId: 'W2', grundstueckId: null, datum: '2026-09-25', stufe: 'kabinett' },
      { weingartenId: 'W2', grundstueckId: null, datum: '2026-09-25', stufe: 'spaetlese' },
      { weingartenId: 'W3', grundstueckId: null, datum: null, stufe: 'auslese' },
    ]
    const zeile = (weingartenId, grundstueckId = null) => ({ weingartenId, grundstueckId })
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G1'), '2026-09-21'), 'qualitaetswein', 'Hauptlese')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G1'), '2026-12-11'), 'eiswein', 'Eiswein nach der Hauptlese')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G2'), '2026-12-11'), 'wein')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1'), '2026-09-23'), 'wein', 'ohne GST: alle Lesen des Weingartens')
    assert.equal(leseStufeFuerPressung(lese, zeile('W2'), '2026-09-26'), 'kabinett', 'zwei Lesen am selben Tag')
    assert.equal(leseStufeFuerPressung(lese, zeile('W3'), '2026-09-26'), 'auslese', 'ohne Lesedatum')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G1'), '2026-09-19'), null, 'Lese erst nach der Pressung')
    assert.equal(leseStufeFuerPressung(lese, zeile('W9'), '2026-12-31'), null)
    assert.equal(leseStufeFuerPressung(lese, zeile(null), '2026-12-31'), null, 'Zukauf')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G1'), null), 'eiswein', 'ohne Pressungsdatum: letzte Lese')
  })

  test('Akzeptanz: Kette Lese → Pressung → Charge → Füllung für jede Lese-Stufe (gegen die CHECKs)', () => {
    const cLese = new Set(checkListe('ernte_parzellen_qualitaetsstufe_check'))
    const cCharge = new Set(checkListe('weinausbau_qualitaetsstufe_check'))
    const cFuellung = new Set(checkListe('fuellungen_qualitaet_check'))
    for (const o of LESE_QUALITAETEN) {
      const kmw = MINDEST_KMW[o.value]
      assert.ok(cLese.has(o.value), `Lese „${o.value}“`)
      assert.ok(werte(leseStufenBeiKmw(kmw)).includes(o.value), `Lese „${o.value}“ bei ${kmw} °KMW nicht wählbar`)
      const lese = [{ weingartenId: 'W', grundstueckId: null, datum: '2026-09-20', stufe: o.value }]
      const charge = pressungsQualitaet([leseStufeFuerPressung(lese, { weingartenId: 'W', grundstueckId: null }, '2026-09-21')], kmw)
      assert.equal(charge, o.value, `Pressung: Lese „${o.value}“ bei ${kmw} °KMW → Charge „${charge}“`)
      assert.ok(cCharge.has(charge), `Charge „${charge}“`)
      assert.ok(werte(fuellungsStufenFuer(charge)).includes(o.value), `Füllung „${o.value}“ nicht angeboten`)
      assert.ok(cFuellung.has(o.value), `Füllung „${o.value}“`)
    }
    // ausdrücklich laut Ticket: Parzelle „Wein“ → Pressung → Charge „Wein“ → Füllung „Wein“, auch ohne KMW
    assert.equal(pressungsQualitaet(['wein'], null), 'wein')
  })
})

// ── (5) Formulare und Server Actions ─────────────────────────────────────────

describe('(5) Formulare und Server Actions verwenden die Liste ihrer Zieltabelle', () => {
  // Name aus lib/wein/qualitaet.ts → Zieltabelle
  const LISTEN_ZIEL = {
    LESE_QUALITAETEN: 'lese', leseStufenBeiKmw: 'lese',
    FUELLUNG_QUALITAETEN: 'fuellung', fuellungsStufenFuer: 'fuellung',
    QUALITAET_OPTS: 'charge', chargenStufenBis: 'charge',
  }
  // Datei → erwartete Zieltabelle (neue Formulare hier eintragen – der Test verlangt es)
  const FORMULARE = {
    'src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx':             'lese',
    'src/app/(dashboard)/erntemeldung/[id]/TraubenverkaufSection.tsx':         'lese',
    'src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx':  'lese',
    'src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx':                     'lese',
    'src/lib/assistent/tools/ernte.ts':                                        'lese',
    'src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx':    'fuellung',
    'src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx':            'fuellung',
    'src/lib/assistent/tools/abfuellen.ts':                                    'fuellung',
    'src/components/kellerbuch/WeinausbauForm.tsx':                            'charge',
    'src/app/(dashboard)/kellerbuch/actions.ts':                               'charge',
    'src/app/(dashboard)/kellerbuch/eroeffnungsbestand/[id]/edit/page.tsx':    'charge',
    'src/app/(dashboard)/kellerbuch/gebinde/page.tsx':                         'charge',
    'src/app/(dashboard)/admin/import/ImportClient.tsx':                       'charge',
    'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx':                      'charge',
    'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx':      'charge',
  }
  // Serverprüfung vor dem Schreiben: [Datei, Aufruf, Mindestanzahl]
  const SERVERPRUEFUNGEN = [
    ['src/app/(dashboard)/erntemeldung/actions.ts', "qualitaetFehler('lese'", 3],   // Lese einzeln, mehrfach, Traubenverkauf
    ['src/app/(dashboard)/erntemeldung/actions.ts', "qualitaetFehler('charge'", 1], // Pressung (Stufe per Direktaufruf)
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'stufeMitKmwMoeglich(', 1],     // Lese: Stufe passt zum KMW
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'pressungsQualitaet(', 1],      // Pressung: Lese-Stufe + KMW
    ['src/app/(dashboard)/weinhandel/actions.ts', "qualitaetFehler('fuellung'", 1],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'istAufstufung(', 2],             // Füllung anlegen und ändern
    ['src/app/(dashboard)/kellerbuch/actions.ts', "qualitaetFehler('charge'", 1],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'chargenStufenBis(', 1],          // Charge ändern: keine Aufstufung
    ['src/app/(dashboard)/kellerbuch/gebinde-actions.ts', "qualitaetFehler('charge'", 2],
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', "qualitaetFehler('charge'", 1],
    ['src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts', "qualitaetFehler('lese'", 1],
    ['src/app/(dashboard)/weinhandel/verkauf/actions.ts', "qualitaetFehler('lese'", 1],
    ['src/lib/assistent/tools/ernte.ts', "qualitaetFehler('lese'", 1],
    ['src/lib/assistent/tools/abfuellen.ts', "qualitaetFehler('fuellung'", 1],
  ]

  /** Aus lib/wein/qualitaet importierte Namen einer Datei */
  function importierteNamen(text) {
    const namen = new Set()
    for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]*lib\/wein\/qualitaet['"]/g)) {
      for (const teil of m[1].split(',')) {
        const name = teil.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
        if (name) namen.add(name)
      }
    }
    return namen
  }

  test('jede Datei importiert genau die Liste ihrer Zieltabelle und verwendet sie', () => {
    const fehler = []
    for (const [datei, ziel] of Object.entries(FORMULARE)) {
      const p = path.join(ROOT, ...datei.split('/'))
      if (!existsSync(p)) { fehler.push(`${datei}: Datei fehlt – Zuordnung in FORMULARE anpassen`); continue }
      const text = readFileSync(p, 'utf8')
      const listen = [...importierteNamen(text)].filter(n => n in LISTEN_ZIEL)
      const ziele = menge(listen.map(n => LISTEN_ZIEL[n]))
      if (JSON.stringify(ziele) !== JSON.stringify([ziel])) {
        fehler.push(`${datei}: erwartet Liste für „${ziel}“, importiert ${listen.join(', ') || 'keine'}`)
      }
      for (const n of listen) {
        if ((text.match(new RegExp(`\\b${n}\\b`, 'g')) ?? []).length < 2) fehler.push(`${datei}: ${n} importiert, aber nicht verwendet`)
      }
    }
    assert.deepEqual(fehler, [])
  })

  test('keine weitere Datei in src verwendet eine Qualitätsliste ohne Eintrag in FORMULARE', () => {
    const bekannt = new Set(Object.keys(FORMULARE))
    const funde = []
    ;(function durchsuche(dir) {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) { durchsuche(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        if (rel === 'src/lib/wein/qualitaet.ts' || bekannt.has(rel)) continue
        const listen = [...importierteNamen(readFileSync(p, 'utf8'))].filter(n => n in LISTEN_ZIEL)
        if (listen.length > 0) funde.push(`${rel}: ${listen.join(', ')} – Zieltabelle in FORMULARE eintragen`)
      }
    })(path.join(ROOT, 'src'))
    assert.deepEqual(funde, [])
  })

  test('Server Actions prüfen die Stufe vor dem Schreiben', () => {
    const fehler = []
    for (const [datei, aufruf, mindestens] of SERVERPRUEFUNGEN) {
      const text = readFileSync(path.join(ROOT, ...datei.split('/')), 'utf8')
      const anzahl = text.split(aufruf).length - 1
      if (anzahl < mindestens) fehler.push(`${datei}: ${aufruf} ${anzahl}× statt mindestens ${mindestens}×`)
    }
    assert.deepEqual(fehler, [])
  })
})
