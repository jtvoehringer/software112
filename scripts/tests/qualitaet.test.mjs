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
//     Qualitätswein-Niveau, Sekt/Perlwein/Sonstiges nur als sie selbst oder „Sonstiges“),
//     Auswahl von Füllung und Charge (= Serverregel), Zusammenführen bei Verschnitt und Umzug
//     (nie eine Aufstufung), Stufe neuer Pressungs-Chargen und die Kette Lese → Pressung →
//     Charge → Füllung für jede Lese-Stufe.
// (5) Formulare und Server Actions: jede Datei verwendet die Liste ihrer Zieltabelle, keine
//     einzelne hart codierte Stufe außerhalb davon, und die Server Actions prüfen die Stufe vor
//     dem ersten Schreibzugriff (statisch).

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
  leseStufenBeiKmw, fuellungsStufenFuer, chargenStufenBis, chargenStufenAenderungFehler,
  leseKmwFehler, minQualitaet: minQualitaetUmzug,
} = await import('../../src/lib/wein/qualitaet.ts')
const {
  kmwZuQualitaet, QUALITAET_ORDER, QUALITAET_LABEL, PRAEDIKATSWEIN_ORDER, istNiedrigerAls,
  istMindestens, istPraedikatsStufe, minQualitaet, maxQualitaet, MINDEST_KMW, stufeMitKmwMoeglich,
  istAbstufung, istAufstufung, leseStufeFuerPressung, pressungsQualitaet,
  zusammenfuehren, zusammenfuehrungsAbstufung,
} = await import('../../src/lib/weinqualitaet.ts')
const kuerzel = await import('../../src/lib/wein/bki_kuerzel.ts')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATION_KAN73 = 'kan73_qualitaetsstufen_angleichen'
const LETZTE_ALTVERSION = '20260923190744'   // Neuaufbau: migrations/ erst nach dieser Version

const werte = liste => liste.map(o => o.value)
const menge = a => [...new Set(a)].sort()

// ── (1) CHECKs aus den Migrationen ────────────────────────────────────────────

/** Kommentare außerhalb von '…' entfernen: Zeilenkommentare (--) und Blockkommentare
 *  (/* … *\/, auch verschachtelt und über mehrere Zeilen – sonst gälte ein auskommentiertes
 *  „ADD CONSTRAINT … CHECK“ als Definition). Texte in '…' werden zeilenweise erkannt, damit ein
 *  einzelnes Apostroph (z. B. in $$-Funktionskörpern) nicht den Rest der Datei verschiebt. */
function ohneKommentare(sql) {
  let blockTiefe = 0
  return sql.split(/\r?\n/).map(zeile => {
    let aus = ''
    let inText = false
    for (let i = 0; i < zeile.length; i++) {
      const c = zeile[i]
      const zwei = zeile.slice(i, i + 2)
      if (blockTiefe > 0) {
        if (zwei === '/*') { blockTiefe++; i++ } else if (zwei === '*/') { blockTiefe--; i++ }
        continue
      }
      if (inText) { if (c === "'") inText = false; aus += c; continue }
      if (c === "'") { inText = true; aus += c; continue }
      if (zwei === '--') break
      if (zwei === '/*') { blockTiefe = 1; i++; aus += ' '; continue }
      aus += c
    }
    return aus
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

/** Werteliste eines CHECK-Ausdrucks: „x IN ('a', …)“, „x = ANY (ARRAY['a'::text, …])“ oder die
 *  pg_dump-Form für varchar „x = ANY ((ARRAY['a'::character varying, …])::text[])“. null bei
 *  unlesbarem oder verneintem Ausdruck (NOT IN, NOT (… = ANY …)) – der Test schlägt dann laut fehl. */
function checkWerte(ausdruck) {
  const m = /\bIN\s*\(|=\s*ANY\s*\(\s*\(?\s*ARRAY\s*\[/i.exec(ausdruck)
  if (!m) return null
  if (/\bNOT\b/i.test(ausdruck.slice(0, m.index).replace(/\bIS\s+NOT\s+NULL\b/gi, ''))) return null
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

/** Letzter Stand je benanntem CHECK über SQL-Texte in Neuaufbau-Reihenfolge ([{ datei, sql }]):
 *  { werte, datei, ausdruck } bzw. null (gelöscht/nie benannt) */
function benannteChecksAus(texte, namen) {
  const stand = new Map(namen.map(n => [n, null]))
  for (const { datei, sql: roh } of texte) {
    const sql = ohneKommentare(roh)
    const ereignisse = []
    for (const m of sql.matchAll(/\bADD\s+CONSTRAINT\s+"?(\w+)"?\s+CHECK\s*\(/gi)) {
      if (!stand.has(m[1])) continue
      const auf = m.index + m[0].length - 1
      const zu = klammerEnde(sql, auf)
      assert.ok(zu > auf, `${datei}: CHECK ${m[1]} ohne schließende Klammer`)
      const ausdruck = sql.slice(auf + 1, zu)
      ereignisse.push({ pos: m.index, name: m[1], wert: { werte: checkWerte(ausdruck), datei, ausdruck } })
    }
    for (const m of sql.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) {
      if (stand.has(m[1])) ereignisse.push({ pos: m.index, name: m[1], wert: null })
    }
    for (const e of ereignisse.sort((a, b) => a.pos - b.pos)) stand.set(e.name, e.wert)
  }
  return stand
}

function benannteChecks(namen) {
  return benannteChecksAus(
    migrationsdateien().map(datei => ({ datei: path.basename(datei), sql: readFileSync(datei, 'utf8') })),
    namen,
  )
}

describe('CHECK-Parser (Hilfsfunktionen dieses Tests)', () => {
  const lies = (...sql) => benannteChecksAus(sql.map((s, i) => ({ datei: `t${i}.sql`, sql: s })), ['c']).get('c')

  test('Formen: IN, = ANY (ARRAY[…]), pg_dump-Form für varchar, Casts, mehrzeilig, IS NULL OR', () => {
    assert.deepEqual(lies("ALTER TABLE t ADD CONSTRAINT c CHECK (q IN ('a', 'b'));").werte, ['a', 'b'])
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK ((q = ANY (ARRAY['a'::text, 'b'::text])))").werte, ['a', 'b'])
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK (((q)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[])))").werte, ['a', 'b'])
    assert.deepEqual(lies("ADD CONSTRAINT \"c\" CHECK (q IS NULL OR q IN (\n  'a', -- Kommentar mit ' Apostroph\n  'b'\n))").werte, ['a', 'b'])
  })

  test('Kommentare: auskommentierte Definitionen zählen nicht, auch nicht in Blockkommentaren', () => {
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK (q IN ('a'));\n-- ADD CONSTRAINT c CHECK (q IN ('x'));").werte, ['a'])
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK (q IN ('a'));\n/* alt:\n ADD CONSTRAINT c CHECK (q IN ('x'));\n*/").werte, ['a'])
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK (q IN ('a' /* it's */, 'b'))").werte, ['a', 'b'], 'Apostroph im Blockkommentar')
    assert.deepEqual(lies("/* /* verschachtelt */ ADD CONSTRAINT c CHECK (q IN ('x')) */ ADD CONSTRAINT c CHECK (q IN ('a'))").werte, ['a'])
  })

  test('Verneinung und DROP: NOT IN ist keine Werteliste, DROP ohne neue Definition entfernt', () => {
    assert.equal(lies("ADD CONSTRAINT c CHECK (q NOT IN ('dac'))").werte, null)
    assert.equal(lies("ADD CONSTRAINT c CHECK (NOT (q = ANY (ARRAY['dac'])))").werte, null)
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK (q IS NOT NULL AND q IN ('a'))").werte, ['a'], 'IS NOT NULL ist keine Verneinung der Liste')
    assert.equal(lies("ADD CONSTRAINT c CHECK (q IN ('a'))", 'ALTER TABLE t DROP CONSTRAINT IF EXISTS c;'), null)
    assert.deepEqual(lies('ALTER TABLE t DROP CONSTRAINT c;', "ADD CONSTRAINT c CHECK (q IN ('b'))").werte, ['b'])
  })
})

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

  test('leseKmwFehler: Serverprüfung von Lese und Traubenverkauf (dieselbe Regel wie die Auswahl)', () => {
    assert.equal(leseKmwFehler(null, 10), null)
    assert.equal(leseKmwFehler('', 10), null)
    assert.equal(leseKmwFehler('kabinett', null), null, 'ohne KMW keine Prüfung')
    assert.equal(leseKmwFehler('kabinett', Number.NaN), null)
    assert.match(leseKmwFehler('trockenbeerenauslese', 15),
      /^Die Qualitätsstufe „Trockenbeerenauslese \(TBA\)“ setzt mindestens 30 °KMW voraus – erfasst sind 15 °KMW\. Bitte eine niedrigere Stufe/)
    assert.match(leseKmwFehler('eiswein', 24.95), /mindestens 25 °KMW .* erfasst sind 24,95 °KMW/)
    for (let i = 0; i <= 400; i++) {
      const kmw = i / 10
      for (const o of LESE_QUALITAETEN) {
        assert.equal(leseKmwFehler(o.value, kmw) == null, werte(leseStufenBeiKmw(kmw)).includes(o.value), `${o.value} bei ${kmw} °KMW`)
      }
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
    // Füllungsformular (keine Aufstufung): Charge „Wein“ → Wein, Perlwein und Sonstiges
    assert.deepEqual(werte(fuellungsStufenFuer('wein')), ['wein', 'perlwein', 'sonstiges'])
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
    assert.equal(minQualitaet([]), null)
    assert.equal(minQualitaet([null, '']), null)
    // Runde 3: DAC & Co. neben Prädikats-Stufen über das Niveau (vorher ignoriert: DAC + Kabinett
    // ergab „Kabinett“, DAC + Eiswein „Eiswein“), Sekt/Perlwein/Sonstiges zählen mit
    assert.equal(minQualitaet(['kabinett', 'dac', null]), 'qualitaetswein')
    assert.equal(minQualitaet(['dac', 'eiswein']), 'qualitaetswein')
    assert.equal(minQualitaet(['reserve', 'trockenbeerenauslese']), 'qualitaetswein')
    assert.equal(minQualitaet(['dac', 'reserve', 'kabinett']), 'qualitaetswein')
    assert.equal(minQualitaet(['dac', 'landwein']), 'landwein')
    assert.equal(minQualitaet(['kabinett', 'sonstiges']), 'sonstiges')
    assert.equal(minQualitaet(['sonstiges', 'eiswein']), 'sonstiges')
    assert.equal(minQualitaet(['sekt', 'kabinett']), 'sekt')
    assert.equal(minQualitaet(['sekt', 'wein']), 'sonstiges')
    assert.equal(minQualitaet(['perlwein', 'wein']), 'perlwein')
    // DAC & Co. unter sich (DAC + DAC, DAC + Reserve): Regel offen (eigenes Ticket) – wie bisher null
    assert.equal(minQualitaet(['dac', 'reserve']), null)
    assert.equal(minQualitaet(['dac', 'dac']), null)
    assert.equal(minQualitaet(['dac', null]), null)
    // Verschnitt meldet die Abstufung gegen die höchste Stufe, die ihre Bezeichnung verliert
    assert.deepEqual(zusammenfuehrungsAbstufung(['eiswein', 'trockenbeerenauslese'], 'beerenauslese'), { von: 'eiswein', nach: 'beerenauslese' })
    assert.deepEqual(zusammenfuehrungsAbstufung(['kabinett', 'auslese'], 'kabinett'), { von: 'auslese', nach: 'kabinett' })
    assert.deepEqual(zusammenfuehrungsAbstufung(['dac', 'qualitaetswein'], 'qualitaetswein'), { von: 'dac', nach: 'qualitaetswein' })
    assert.deepEqual(zusammenfuehrungsAbstufung(['dac', 'kabinett'], 'qualitaetswein'), { von: 'kabinett', nach: 'qualitaetswein' })
    assert.deepEqual(zusammenfuehrungsAbstufung(['sonstiges', 'eiswein', null], 'sonstiges'), { von: 'eiswein', nach: 'sonstiges' })
    assert.equal(zusammenfuehrungsAbstufung(['kabinett', 'kabinett', null], 'kabinett'), null)
    assert.equal(zusammenfuehrungsAbstufung(['dac', 'reserve'], null), null)
    assert.ok(istNiedrigerAls(minQualitaet(['eiswein', 'trockenbeerenauslese']), maxQualitaet(['eiswein', 'trockenbeerenauslese'])))
    // Umziehen (lib/wein/qualitaet.ts): dieselbe Regel; DAC & Co. unter sich wie bisher nach Rang
    assert.equal(minQualitaetUmzug('eiswein', 'trockenbeerenauslese'), 'beerenauslese')
    assert.equal(minQualitaetUmzug('strohwein', 'eiswein'), 'beerenauslese')
    assert.equal(minQualitaetUmzug('dac', 'qualitaetswein'), 'qualitaetswein')
    assert.equal(minQualitaetUmzug(null, 'kabinett'), 'kabinett')
    assert.equal(minQualitaetUmzug('kabinett', 'dac'), 'qualitaetswein', 'vorher „Kabinett“ (Rang-Gleichstand)')
    assert.equal(minQualitaetUmzug('erste_lage', 'auslese'), 'qualitaetswein', 'vorher „Auslese“')
    assert.equal(minQualitaetUmzug('sekt', 'kabinett'), 'sekt')
    assert.equal(minQualitaetUmzug('perlwein', 'wein'), 'perlwein', 'vorher „Wein“')
    assert.equal(minQualitaetUmzug('sonstiges', 'eiswein'), 'sonstiges')
    assert.equal(minQualitaetUmzug('dac', 'reserve'), 'dac', 'DAC & Co. unter sich: Rang wie bisher (Regel offen)')
    assert.equal(minQualitaetUmzug('grosses_gewachs', 'erste_lage'), 'erste_lage')
  })

  test('Zusammenführen (Verschnitt, Umzug): nie eine Stufe, die eine Beteiligte nicht abfüllen dürfte', () => {
    const alle = werte(QUALITAET_OPTS)
    const dacUndCo = ['dac', 'reserve', 'erste_lage', 'grosses_gewachs']
    const reicht = (x, m) => !istAufstufung(x, m)   // x darf als m abgefüllt werden
    for (const a of alle) {
      for (const b of alle) {
        const m = zusammenfuehren(a, b)
        assert.ok(istChargenQualitaet(m), `${a} + ${b} → ${m}: keine Chargen-Stufe`)
        assert.equal(zusammenfuehren(b, a), m, `${a} + ${b}: nicht symmetrisch`)
        assert.ok(reicht(a, m) && reicht(b, m), `${a} + ${b} → ${m}: Aufstufung`)
        // höchste gemeinsame Stufe: was beide abfüllen dürften, darf auch das Ergebnis
        for (const v of alle) {
          if (reicht(a, v) && reicht(b, v)) assert.ok(reicht(m, v), `${a} + ${b} → ${m}: ${v} ginge aus beiden, aber nicht mehr aus ${m}`)
        }
        for (const c of alle) {
          assert.equal(zusammenfuehren(zusammenfuehren(a, b), c), zusammenfuehren(a, zusammenfuehren(b, c)), `${a} + ${b} + ${c}: Reihenfolge ändert das Ergebnis`)
        }
        // Verschnitt und Umzug: dieselbe Regel (außer DAC & Co. unter sich – Regel offen)
        for (const [name, erg] of [['Verschnitt', minQualitaet([a, b])], ['Umzug', minQualitaetUmzug(a, b)]]) {
          if (dacUndCo.includes(a) && dacUndCo.includes(b)) {
            if (erg != null) assert.ok(reicht(a, erg) && reicht(b, erg), `${name} ${a} + ${b} → ${erg}: Aufstufung`)
            continue
          }
          assert.equal(erg, m, `${name} ${a} + ${b}`)
        }
      }
      // leer zählt nicht
      assert.equal(minQualitaetUmzug(a, null), a)
      if (!dacUndCo.includes(a)) assert.equal(minQualitaet([a, null]), a)
    }
  })

  test('Abstufungsregel ist transitiv: Charge ändern und danach abfüllen ergibt nie mehr als direkt', () => {
    // leer ausgenommen: eine festgelegte Stufe lässt sich nicht entfernen (chargenStufenAenderungFehler)
    const alle = [...werte(QUALITAET_OPTS), 'altwert']
    for (const a of alle) for (const b of alle) {
      if (istAufstufung(a, b)) continue
      for (const c of alle) assert.ok(!istAufstufung(b, c) ? !istAufstufung(a, c) : true, `${a} → ${b} → ${c}`)
    }
    for (const basis of werte(QUALITAET_OPTS)) {
      const direkt = new Set(werte(fuellungsStufenFuer(basis)))
      for (const v of werte(chargenStufenBis(basis))) {
        for (const f of werte(fuellungsStufenFuer(v))) assert.ok(direkt.has(f), `Charge ${basis} → ${v}, Füllung ${f}: direkt nicht erlaubt`)
      }
    }
  })

  test('Füllung: Auswahl je Charge = genau die Stufen, die der Server zulässt (istAufstufung)', () => {
    const alleWerte = werte(QUALITAET_OPTS)
    for (const charge of [...alleWerte, null, 'altwert']) {
      const optionen = werte(fuellungsStufenFuer(charge))
      for (const v of optionen) {
        assert.ok(istFuellungQualitaet(v), `${charge} → ${v}: nicht in FUELLUNG_QUALITAETEN`)
        assert.ok(!istAufstufung(charge, v), `${charge} → ${v}: angeboten, aber vom Server gesperrt`)
      }
      if (charge && alleWerte.includes(charge)) assert.ok(optionen.includes(charge), `${charge}: eigene Stufe fehlt`)
      assert.ok(optionen.includes('sonstiges'), `${charge}: Sonstiges fehlt`)
      // vollständig und gleich der Serverregel – für JEDE Charge, auch ohne Skala-Niveau (Sekt,
      // Perlwein, Sonstiges, Altwerte; Runde 3: dort ließ der Server vorher alles durch). Sonst
      // ließe sich z. B. eine Pressungs-Charge nie als DAC abfüllen bzw. über den Assistenten mehr
      // abfüllen als im Formular.
      assert.deepEqual(optionen, alleWerte.filter(v => !istAufstufung(charge, v)), `${charge}: Formular ≠ Server`)
    }
    // Chargen ohne Niveau: Server = Formular = nur die eigene Stufe und „Sonstiges“
    for (const charge of ['sekt', 'perlwein', 'sonstiges', 'altwert']) {
      for (const v of alleWerte) {
        assert.equal(istAufstufung(charge, v), v !== charge && v !== 'sonstiges', `${charge} → ${v}`)
      }
    }
    assert.deepEqual(werte(fuellungsStufenFuer(null)), alleWerte)
    const eis = werte(fuellungsStufenFuer('eiswein'))
    assert.ok(eis.includes('beerenauslese') && eis.includes('eiswein'))
    for (const nicht of ['ausbruch', 'trockenbeerenauslese', 'strohwein']) assert.ok(!eis.includes(nicht), `Eiswein → ${nicht}`)
    assert.deepEqual(werte(fuellungsStufenFuer('dac')),
      ['wein', 'landwein', 'qualitaetswein', 'dac', 'reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein', 'sonstiges'])
    assert.deepEqual(werte(fuellungsStufenFuer('sekt')), ['sekt', 'sonstiges'])
    assert.deepEqual(werte(fuellungsStufenFuer('perlwein')), ['perlwein', 'sonstiges'])
    assert.ok(werte(fuellungsStufenFuer('trockenbeerenauslese')).includes('ausbruch'))
    // Pressungs-Chargen (Stufe dort gesperrt): ab Qualitätswein DAC & Co. und Sekt bei der Füllung
    for (const charge of ['qualitaetswein', 'kabinett', 'beerenauslese', 'eiswein']) {
      const o = werte(fuellungsStufenFuer(charge))
      for (const v of ['dac', 'reserve', 'erste_lage', 'grosses_gewachs', 'sekt']) assert.ok(o.includes(v), `${charge} → ${v}`)
    }
    for (const charge of ['wein', 'landwein']) {
      const o = werte(fuellungsStufenFuer(charge))
      for (const v of ['dac', 'reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'qualitaetswein']) assert.ok(!o.includes(v), `${charge} → ${v}`)
    }
  })

  test('Füllung: Serverregel istAufstufung / Vermerk istAbstufung', () => {
    for (const [von, nach] of [
      ['eiswein', 'ausbruch'], ['eiswein', 'trockenbeerenauslese'], ['strohwein', 'eiswein'], ['eiswein', 'strohwein'],
      ['wein', 'dac'], ['wein', 'reserve'], ['landwein', 'sekt'], ['landwein', 'erste_lage'],
      ['dac', 'kabinett'], ['dac', 'eiswein'], ['reserve', 'auslese'], ['qualitaetswein', 'kabinett'], ['wein', 'landwein'],
      // Runde 3: Chargen ohne Niveau – vorher frei (Charge „Wein“ → „Sonstiges“, dann Füllung „Eiswein“)
      ['sonstiges', 'eiswein'], ['sonstiges', 'dac'], ['sonstiges', 'wein'], ['sekt', 'kabinett'], ['sekt', 'qualitaetswein'],
      ['perlwein', 'trockenbeerenauslese'], ['perlwein', 'wein'], ['sekt', 'perlwein'],
    ]) assert.ok(istAufstufung(von, nach), `${von} → ${nach} muss gesperrt sein`)
    for (const [von, nach] of [
      ['trockenbeerenauslese', 'ausbruch'], ['eiswein', 'beerenauslese'], ['eiswein', 'wein'],
      ['qualitaetswein', 'reserve'], ['qualitaetswein', 'sekt'], ['qualitaetswein', 'dac'],   // Bestand Musterhof: QW → Reserve/Sekt
      ['dac', 'qualitaetswein'], ['dac', 'reserve'], ['kabinett', 'dac'], ['wein', 'perlwein'], ['wein', 'sonstiges'],
      ['sekt', 'sonstiges'], ['perlwein', 'sonstiges'], ['sekt', 'sekt'], ['dac', 'dac'], ['reserve', 'reserve'],   // Bestand Gebeshuber: DAC → DAC, Reserve → Reserve
      [null, 'eiswein'], ['kabinett', 'kabinett'],
    ]) assert.ok(!istAufstufung(von, nach), `${von} → ${nach} darf nicht gesperrt sein`)
    assert.ok(istAbstufung('dac', 'qualitaetswein') && istAbstufung('eiswein', 'beerenauslese'))
    assert.ok(!istAbstufung('qualitaetswein', 'reserve') && !istAbstufung('kabinett', 'kabinett'))
  })

  test('Charge: chargenStufenBis bietet nie eine Stufe an, die istAufstufung sperrt (dieselbe Regel wie die Füllung)', () => {
    assert.deepEqual(werte(chargenStufenBis(null)), werte(QUALITAET_OPTS))
    const rangVon = v => QUALITAET_OPTS.find(o => o.value === v).rang
    for (const basis of werte(QUALITAET_OPTS)) {
      const optionen = werte(chargenStufenBis(basis))
      assert.ok(optionen.includes(basis), basis)
      for (const v of optionen) {
        assert.ok(istChargenQualitaet(v), `${basis} → ${v}`)
        assert.ok(!istAufstufung(basis, v), `${basis} → ${v}: angeboten, aber bei der Füllung als Aufstufung gesperrt`)
        assert.ok(rangVon(v) <= rangVon(basis), `${basis} → ${v}: höherer Rang`)
      }
      // Prädikats-Skala außerhalb der Zweige unverändert: alles mit höchstens gleichem Rang
      if (istPraedikatsStufe(basis) && basis !== 'eiswein' && basis !== 'strohwein') {
        assert.deepEqual(optionen, werte(QUALITAET_OPTS.filter(o => o.rang <= rangVon(basis))), basis)
      }
    }
    for (const zweig of ['eiswein', 'strohwein']) {
      const optionen = werte(chargenStufenBis(zweig))
      for (const nicht of ['ausbruch', 'trockenbeerenauslese', zweig === 'eiswein' ? 'strohwein' : 'eiswein']) {
        assert.ok(!optionen.includes(nicht), `${zweig} → ${nicht}`)
      }
      assert.ok(optionen.includes('beerenauslese') && optionen.includes('grosses_gewachs'), zweig)
    }
    // DAC & Co. (Qualitätswein-Niveau): kein Prädikat – vorher DAC → Kabinett, dann Füllung „Kabinett“
    assert.deepEqual(werte(chargenStufenBis('dac')), ['wein', 'landwein', 'qualitaetswein', 'dac', 'sekt', 'perlwein', 'sonstiges'])
    for (const [basis, nicht] of [
      ['dac', ['kabinett']], ['reserve', ['kabinett', 'spaetlese']], ['erste_lage', ['kabinett', 'spaetlese', 'auslese']],
      ['grosses_gewachs', ['kabinett', 'spaetlese', 'auslese', 'beerenauslese']],
    ]) {
      const optionen = werte(chargenStufenBis(basis))
      for (const v of nicht) assert.ok(!optionen.includes(v), `${basis} → ${v}`)
      assert.ok(optionen.includes('qualitaetswein') && optionen.includes('dac'), basis)
    }
    assert.ok(werte(chargenStufenBis('kabinett')).includes('dac'), 'Kabinett → DAC bleibt erlaubt')
    // ohne Skala-Niveau (Runde 3): nur noch „Sonstiges“ – dieselbe Regel wie die Füllung
    assert.deepEqual(werte(chargenStufenBis('sekt')), ['sekt', 'sonstiges'])
    assert.deepEqual(werte(chargenStufenBis('perlwein')), ['perlwein', 'sonstiges'])
    assert.deepEqual(werte(chargenStufenBis('sonstiges')), ['sonstiges'])
    // … aber jede Charge mit Niveau darf auf „Sonstiges“ (und ab Qualitätswein auf Sekt)
    assert.ok(werte(chargenStufenBis('wein')).includes('sonstiges') && werte(chargenStufenBis('qualitaetswein')).includes('sekt'))
  })

  test('Charge bearbeiten (updateWeinausbau): chargenStufenAenderungFehler – nur Abstufen, nie Entfernen', () => {
    for (const basis of werte(QUALITAET_OPTS)) {
      for (const v of werte(QUALITAET_OPTS)) {
        const erlaubt = werte(chargenStufenBis(basis)).includes(v)
        assert.equal(chargenStufenAenderungFehler(basis, v) == null, erlaubt, `${basis} → ${v}`)
      }
      // eine festgelegte Stufe lässt sich nicht entfernen (sonst danach jede Stufe frei)
      for (const leer of [null, undefined, '']) {
        assert.match(chargenStufenAenderungFehler(basis, leer), /nur abstufen, nicht entfernen/, `${basis} → leer`)
      }
    }
    assert.match(chargenStufenAenderungFehler('wein', null), /^Die Qualitätsstufe „Wein \(ohne Herkunft\)“ ist festgelegt/)
    assert.match(chargenStufenAenderungFehler('dac', 'kabinett'), /nicht von „DAC“ auf „Kabinett“ geändert werden/)
    assert.equal(chargenStufenAenderungFehler('dac', 'qualitaetswein'), null)
    // erste Stufe einer Charge ohne Stufe: frei; unverändert: immer erlaubt
    for (const v of werte(QUALITAET_OPTS)) assert.equal(chargenStufenAenderungFehler(null, v), null, `leer → ${v}`)
    assert.equal(chargenStufenAenderungFehler(null, null), null)
    assert.equal(chargenStufenAenderungFehler('', null), null)
    assert.equal(chargenStufenAenderungFehler('eiswein', 'eiswein'), null)
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
    assert.equal(leseStufeFuerPressung(lese, zeile('W1'), '2026-09-23'), 'wein', 'ohne GST (keine Lese ohne GST): je GST die letzte Lese, davon die niedrigste')
    assert.equal(leseStufeFuerPressung(lese, zeile('W2'), '2026-09-26'), 'kabinett', 'zwei Lesen am selben Tag')
    assert.equal(leseStufeFuerPressung(lese, zeile('W3'), '2026-09-26'), 'auslese', 'ohne Lesedatum')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G1'), '2026-09-19'), null, 'Lese erst nach der Pressung')
    assert.equal(leseStufeFuerPressung(lese, zeile('W9'), '2026-12-31'), null)
    assert.equal(leseStufeFuerPressung(lese, zeile(null), '2026-12-31'), null, 'Zukauf')
    assert.equal(leseStufeFuerPressung(lese, zeile('W1', 'G1'), null), 'eiswein', 'ohne Pressungsdatum: letzte Lese')
    // Zeile ohne GST, nur Lesen mit GST: je GST die letzte Lese, davon die niedrigste – die
    // Eiswein-Lese auf G1 hebt die Trauben von G2 („Wein“) nicht an
    assert.equal(leseStufeFuerPressung(lese, zeile('W1'), '2026-12-11'), 'wein', 'ohne GST: späte Lese eines GST zählt nicht für alle')
  })

  test('Lese-Stufe je Pressungszeile ohne GST: zuerst die Lesen ohne GST (keine Aufstufung über einen anderen GST)', () => {
    const lese = [
      { weingartenId: 'W1', grundstueckId: null, datum: '2026-09-20', stufe: 'qualitaetswein' },   // Lese A
      { weingartenId: 'W1', grundstueckId: 'G2', datum: '2026-09-25', stufe: 'spaetlese' },        // Lese B
    ]
    const ohneGst = { weingartenId: 'W1', grundstueckId: null }
    assert.equal(leseStufeFuerPressung(lese, ohneGst, '2026-09-26'), 'qualitaetswein', 'Trauben aus Lese A, nicht Spätlese aus B')
    assert.equal(pressungsQualitaet([leseStufeFuerPressung(lese, ohneGst, '2026-09-26')], 20), 'qualitaetswein')
    assert.equal(leseStufeFuerPressung(lese, { weingartenId: 'W1', grundstueckId: 'G2' }, '2026-09-26'), 'spaetlese', 'Zeile mit GST unverändert')
    // Eiswein ohne GST nach der Hauptlese ohne GST: weiter die letzte Lese
    const eis = [...lese, { weingartenId: 'W1', grundstueckId: null, datum: '2026-12-10', stufe: 'eiswein' }]
    assert.equal(leseStufeFuerPressung(eis, ohneGst, '2026-12-11'), 'eiswein')
    assert.equal(leseStufeFuerPressung(eis, ohneGst, '2026-09-26'), 'qualitaetswein')
    // mehrere GST ohne Lese ohne GST: je GST die letzte, davon die niedrigste
    const jeGst = [
      { weingartenId: 'W2', grundstueckId: 'G1', datum: '2026-09-20', stufe: 'kabinett' },
      { weingartenId: 'W2', grundstueckId: 'G1', datum: '2026-12-10', stufe: 'eiswein' },
      { weingartenId: 'W2', grundstueckId: 'G2', datum: '2026-12-10', stufe: 'eiswein' },
    ]
    assert.equal(leseStufeFuerPressung(jeGst, { weingartenId: 'W2', grundstueckId: null }, '2026-12-11'), 'eiswein', 'beide GST Eiswein')
    assert.equal(leseStufeFuerPressung(jeGst, { weingartenId: 'W2', grundstueckId: null }, '2026-09-21'), 'kabinett', 'nur G1 bis dahin gelesen')
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
      // Charge und Füllung bieten nur Stufen an, die ihre CHECKs speichern können
      for (const v of werte(chargenStufenBis(charge))) assert.ok(cCharge.has(v), `Charge „${charge}“ → „${v}“`)
      for (const v of werte(fuellungsStufenFuer(charge))) assert.ok(cFuellung.has(v), `Füllung aus „${charge}“ → „${v}“`)
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
    QUALITAET_OPTS: 'charge', chargenStufenBis: 'charge', chargenStufenAenderungFehler: 'charge',
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
    'src/app/(dashboard)/kellerbuch/gebinde-actions.ts':                       'charge',
    'src/app/(dashboard)/kellerbuch/gebinde/page.tsx':                         'charge',
    'src/app/(dashboard)/admin/import/ImportClient.tsx':                       'charge',
    'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx':                      'charge',
    'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx':      'charge',
  }
  // Serverprüfung vor dem Schreiben: [Datei, Funktion, Aufruf, weitere Schreibaufrufe (optional)].
  // Der Aufruf muss im Rumpf der Funktion (ohne Kommentare) vor dem ersten Schreibzugriff stehen
  // (.insert/.update/.upsert/.delete, rpc – z. B. Nummernkreise – bzw. die genannten Actions).
  // Hilfsfunktionen ohne Schreibzugriff (…AusFormular, parse…) stehen mit ihrem Aufrufer hier.
  const SERVERPRUEFUNGEN = [
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'upsertErnteParzelle', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'upsertErnteParzelle', 'leseKmwFehler('],          // Stufe passt zum KMW
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'createMultipleErnteParzellen', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'createTraubenverkauf', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'createTraubenverkauf', 'leseKmwFehler('],
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'upsertPressung', "if (fd.get('qualitaetsstufe'))"], // keine Stufe von außen
    ['src/app/(dashboard)/weinhandel/actions.ts', 'fuellungQualitaetAusFormular', "qualitaetFehler('fuellung'"],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'createFuellung', 'fuellungQualitaetAusFormular('],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'createFuellung', 'istAufstufung('],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'updateFuellung', 'fuellungQualitaetAusFormular('],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'updateFuellung', 'istAufstufung('],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'chargenQualitaetAusFormular', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'createWeinausbau', 'chargenQualitaetAusFormular('],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'updateWeinausbau', 'chargenQualitaetAusFormular('],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'updateWeinausbau', 'chargenStufenAenderungFehler('], // nur abstufen, nicht leeren
    ['src/app/(dashboard)/kellerbuch/gebinde-actions.ts', 'insertEroeffnungsbestand', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/kellerbuch/gebinde-actions.ts', 'eroeffnungsbestandSpeichern', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/kellerbuch/gebinde-actions.ts', 'eroeffnungsbestandSpeichern', 'chargenStufenAenderungFehler('], // mit Folgebuchungen
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'parseZukaufFormData', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'createZukauf', 'parseZukaufFormData('],
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'updateZukauf', 'parseZukaufFormData('],
    ['src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts', 'upsertTraubenverkauf', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts', 'upsertTraubenverkauf', 'leseKmwFehler('],
    ['src/app/(dashboard)/weinhandel/verkauf/actions.ts', 'pruefePositionen', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/weinhandel/verkauf/actions.ts', 'pruefePositionen', 'leseKmwFehler('],
    ['src/app/(dashboard)/weinhandel/verkauf/actions.ts', 'createVerkauf', 'pruefePositionen('],
    ['src/lib/assistent/tools/ernte.ts', 'fuehreErnteErfassenAus', "qualitaetFehler('lese'", /\b(?:createJahrgang|createMultipleErnteParzellen|upsertErnteParzelle)\s*\(/],
    ['src/lib/assistent/tools/abfuellen.ts', 'fuehreAbfuellenAus', "qualitaetFehler('fuellung'", /\bcreateFuellung\s*\(/],
  ]

  /** JS/TS-Kommentare entfernen (// und /* *\/), Texte in '…', "…" und `…` bleiben – damit ein
   *  auskommentierter Aufruf nicht als Prüfung zählt */
  function ohneJsKommentare(text) {
    let aus = ''
    let offen = null   // offenes Anführungszeichen eines Texts
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (offen) {
        aus += c
        if (c === '\\') { aus += text[i + 1] ?? ''; i++ } else if (c === offen) offen = null
        continue
      }
      const zwei = text.slice(i, i + 2)
      if (zwei === '//') { const ende = text.indexOf('\n', i); i = (ende < 0 ? text.length : ende) - 1; continue }
      if (zwei === '/*') { const ende = text.indexOf('*/', i + 2); i = (ende < 0 ? text.length : ende + 2) - 1; aus += ' '; continue }
      if (c === "'" || c === '"' || c === '`') offen = c
      aus += c
    }
    return aus
  }

  /** Rumpf einer Funktion auf oberster Ebene (bis zur ersten „}“ am Zeilenanfang) oder null */
  function funktionsRumpf(text, name) {
    const m = new RegExp(`\\bfunction\\s+${name}\\s*[(<]`).exec(text)
    if (!m) return null
    const ende = text.indexOf('\n}', m.index)
    return text.slice(m.index, ende < 0 ? undefined : ende + 2)
  }

  test('ohneJsKommentare / funktionsRumpf (Hilfsfunktionen dieses Tests)', () => {
    assert.equal(ohneJsKommentare("a() // qualitaetFehler('lese', x)\nb()"), 'a() \nb()')
    assert.equal(ohneJsKommentare("a(/* qualitaetFehler('lese') */)"), 'a( )')
    assert.equal(ohneJsKommentare("x = 'https://a' // c"), "x = 'https://a' ")
    assert.equal(ohneJsKommentare('x = `it\'s // kein Kommentar`'), 'x = `it\'s // kein Kommentar`')
    const text = 'export async function f(a: string): Promise<{ id: string }> {\n  g()\n  if (a) {\n    h()\n  }\n}\nfunction k() {}\n'
    assert.equal(funktionsRumpf(text, 'f'), 'function f(a: string): Promise<{ id: string }> {\n  g()\n  if (a) {\n    h()\n  }\n}')
    assert.equal(funktionsRumpf(text, 'fehlt'), null)
  })

  /** Aus `modul` (z. B. lib/wein/qualitaet) importierte Namen einer Datei – benannte Importe
   *  und über einen Namespace-Import (import * as Q …) verwendete Namen (Q.LESE_QUALITAETEN) */
  function importierteNamen(text, modul = 'lib/wein/qualitaet') {
    const namen = new Set()
    const aus = `from\\s*['"][^'"]*${modul.replace(/\//g, '\\/')}['"]`
    for (const m of text.matchAll(new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*${aus}`, 'g'))) {
      for (const teil of m[1].split(',')) {
        const name = teil.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
        if (name) namen.add(name)
      }
    }
    for (const m of text.matchAll(new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s*${aus}`, 'g'))) {
      for (const n of text.matchAll(new RegExp(`\\b${m[1]}\\.(\\w+)`, 'g'))) namen.add(n[1])
    }
    return namen
  }

  test('importierteNamen erkennt benannte, umbenannte, Typ- und Namespace-Importe', () => {
    assert.deepEqual([...importierteNamen("import { A, type B, C as D } from '@/lib/wein/qualitaet'")], ['A', 'B', 'C'])
    assert.deepEqual([...importierteNamen("import * as Q from '../lib/wein/qualitaet'\nQ.LESE_QUALITAETEN.map(x => x)")], ['LESE_QUALITAETEN'])
    assert.deepEqual([...importierteNamen("import { A } from '@/lib/weinqualitaet'")], [])
    assert.deepEqual([...importierteNamen("import * as W from '@/lib/weinqualitaet'\nW.QUALITAET_ORDER", 'lib/weinqualitaet')], ['QUALITAET_ORDER'])
  })

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

  /** Methodenkette ab Position `pos` (….filter(…).map(…)) als [{ name, argument }] */
  function methodenKette(text, pos) {
    const kette = []
    let i = pos
    for (;;) {
      const m = /^\s*\??\.\s*(\w+)\s*\(/.exec(text.slice(i, i + 200))
      if (!m) return kette
      const auf = i + m[0].length - 1
      const zu = klammerEnde(text, auf)
      if (zu < 0) return kette
      kette.push({ name: m[1], argument: text.slice(auf + 1, zu) })
      i = zu + 1
    }
  }

  /** <option>-Listen aus den Gesamtlisten von lib/weinqualitaet (QUALITAET_ORDER,
   *  PRAEDIKATSWEIN_ORDER, Object.entries/keys/values(QUALITAET_LABEL)) – Zeilennummern */
  function optionenAusGesamtlisten(text) {
    const namen = importierteNamen(text, 'lib/weinqualitaet')
    const muster = []
    for (const n of ['QUALITAET_ORDER', 'PRAEDIKATSWEIN_ORDER']) {
      if (namen.has(n)) muster.push(new RegExp(`\\b(?:\\w+\\.)?${n}\\b`, 'g'))
    }
    if (namen.has('QUALITAET_LABEL')) muster.push(/\bObject\.(?:entries|keys|values)\(\s*(?:\w+\.)?QUALITAET_LABEL\s*\)/g)
    const zeilen = []
    for (const re of muster) {
      for (const m of text.matchAll(re)) {
        const kette = methodenKette(text, m.index + m[0].length)
        if (kette.some(k => k.name === 'map' && /<option\b/.test(k.argument))) {
          zeilen.push(text.slice(0, m.index).split('\n').length)
        }
      }
    }
    return zeilen.sort((a, b) => a - b)
  }

  test('optionenAusGesamtlisten erkennt Auswahllisten aus lib/weinqualitaet, aber keine Vergleiche', () => {
    const imp = "import { QUALITAET_LABEL, QUALITAET_ORDER } from '@/lib/weinqualitaet'\n"
    assert.deepEqual(optionenAusGesamtlisten(`${imp}{Object.entries(QUALITAET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}`), [2])
    assert.deepEqual(optionenAusGesamtlisten(`${imp}{QUALITAET_ORDER\n  .filter(q => erlaubt(q))\n  .map(q => (\n    <option key={q}>{QUALITAET_LABEL[q]}</option>\n  ))}`), [2])
    assert.deepEqual(optionenAusGesamtlisten(`${imp}const i = QUALITAET_ORDER.indexOf(x as typeof QUALITAET_ORDER[number])`), [])
    assert.deepEqual(optionenAusGesamtlisten("import * as W from '@/lib/weinqualitaet'\n{W.PRAEDIKATSWEIN_ORDER.map(q => <option key={q}>{q}</option>)}"), [2])
    // eigene lokale Konstante gleichen Namens (z. B. Jahrgangs-Bewertung) zählt nicht
    assert.deepEqual(optionenAusGesamtlisten('const QUALITAET_LABEL = { gut: "Gut" }\n{Object.entries(QUALITAET_LABEL).map(([v]) => <option key={v} />)}'), [])
  })

  test('keine Auswahlliste aus den Gesamtlisten von lib/weinqualitaet (enthalten DAC & Co.)', () => {
    // Eine <option>-Liste aus QUALITAET_ORDER/QUALITAET_LABEL böte z. B. bei der Lese wieder DAC
    // an – genau der Fehler aus KAN-73. Auswahllisten kommen aus lib/wein/qualitaet (FORMULARE).
    // Ausnahmen mit Grund: { 'src/…/Datei.tsx': 'Grund' } (bisher keine nötig)
    const AUSNAHMEN = {}
    const funde = []
    ;(function durchsuche(dir) {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) { durchsuche(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        if (rel in AUSNAHMEN) continue
        const zeilen = optionenAusGesamtlisten(readFileSync(p, 'utf8'))
        if (zeilen.length > 0) funde.push(`${rel}:${zeilen.join(',')} – Auswahlliste aus lib/wein/qualitaet verwenden`)
      }
    })(path.join(ROOT, 'src'))
    assert.deepEqual(funde, [])
  })

  test('Pressung: keine Stufe von außen (upsertPressung lehnt sie ab, chargenVorgabenErmitteln nimmt keine)', () => {
    const text = readFileSync(path.join(ROOT, 'src', 'app', '(dashboard)', 'erntemeldung', 'actions.ts'), 'utf8')
    const start = text.indexOf('export async function upsertPressung(')
    assert.ok(start >= 0, 'upsertPressung nicht gefunden')
    const ende = text.indexOf('\nexport ', start + 1)
    const rumpf = text.slice(start, ende < 0 ? undefined : ende)
    const ablehnung = rumpf.indexOf("if (fd.get('qualitaetsstufe'))")
    assert.ok(ablehnung >= 0, 'upsertPressung lehnt eine mitgeschickte Stufe nicht ab')
    assert.ok(ablehnung < rumpf.search(/\.(insert|update|upsert|delete)\(/), 'Ablehnung erst nach dem ersten Schreiben')
    assert.doesNotMatch(text, /kopf\.qualitaetsstufe/, 'chargenVorgabenErmitteln übernimmt wieder eine Stufe von außen')
  })

  test('Server Actions prüfen die Stufe vor dem ersten Schreibzugriff', () => {
    const fehler = []
    for (const [datei, funktion, aufruf, weitere] of SERVERPRUEFUNGEN) {
      const text = ohneJsKommentare(readFileSync(path.join(ROOT, ...datei.split('/')), 'utf8'))
      const rumpf = funktionsRumpf(text, funktion)
      if (!rumpf) { fehler.push(`${datei}: Funktion ${funktion} nicht gefunden`); continue }
      const pos = rumpf.indexOf(aufruf)
      if (pos < 0) { fehler.push(`${datei} › ${funktion}: ${aufruf} fehlt`); continue }
      const schreiben = [/\.(?:insert|update|upsert|delete)\s*\(/, /\brpc\b/, ...(weitere ? [weitere] : [])]
        .map(re => rumpf.search(re)).filter(p => p >= 0)
      const erstesSchreiben = schreiben.length > 0 ? Math.min(...schreiben) : Infinity
      if (pos > erstesSchreiben) fehler.push(`${datei} › ${funktion}: ${aufruf} erst nach dem ersten Schreibzugriff`)
    }
    assert.deepEqual(fehler, [])
  })

  test('keine einzelne hart codierte Qualitätsstufe außerhalb der Liste der Zieltabelle', () => {
    // Teil (3) findet erst Listen mit mehreren Prädikats-Codes – ein einzelnes
    // <option value="dac"> in einem Lese-Formular brächte den 23514-Fehler unbemerkt zurück
    const ZIEL_LISTE = { lese: LESE_QUALITAETEN, fuellung: FUELLUNG_QUALITAETEN, charge: QUALITAET_OPTS }
    const stufen = new Set(werte(QUALITAET_OPTS))
    const literale = text => [...ohneJsKommentare(text).matchAll(/\bvalue\s*(?:=\s*\{?\s*|:\s*)["'`]([a-z_]+)["'`]/g)].map(m => m[1])
    assert.deepEqual(literale('<option value="">–</option><option value="dac">DAC</option>'), ['dac'])
    assert.deepEqual(literale("{ value: 'handlese', label: 'Handlese' }, <option value={'sekt'} />"), ['handlese', 'sekt'])
    assert.deepEqual(literale('// <option value="dac">'), [])
    const funde = []
    for (const [datei, ziel] of Object.entries(FORMULARE)) {
      const erlaubt = new Set(werte(ZIEL_LISTE[ziel]))
      for (const v of literale(readFileSync(path.join(ROOT, ...datei.split('/')), 'utf8'))) {
        if (stufen.has(v) && !erlaubt.has(v)) funde.push(`${datei}: value „${v}“ ist keine Stufe für „${ziel}“`)
      }
    }
    assert.deepEqual(funde, [])
  })
})
