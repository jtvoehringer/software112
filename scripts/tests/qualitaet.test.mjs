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
//     („ADD CONSTRAINT <name> CHECK (… IN (…))“ bzw. „= ANY (ARRAY[…])“, auch ohne ADD in
//     CREATE TABLE wie bei pg_dump); ein späteres „DROP CONSTRAINT <name>“, DROP TABLE oder
//     CREATE TABLE der Tabelle ohne neue Definition entfernt sie. Inline-CHECKs ohne Namen
//     (CREATE TABLE … check (…)) werden nicht gewertet – ihre Auto-Namen stehen nicht im SQL.
//     Kommentare (-- und /* … */) zählen nicht; verneinte Listen (NOT IN, NOT (… = ANY …)) sind
//     keine Positivliste und lassen den Test laut scheitern.
// (2) kmwZuQualitaet liefert nur Lese-Stufen; Grenzwerte laut Weingesetz; keine gültige Zahl
//     (NaN, ±Infinity, null, undefined, leerer Text) zählt wie „kein KMW“.
// (3) übrige Listen: QUALITAET_ORDER/QUALITAET_LABEL/PRAEDIKATSWEIN_ORDER, BKI-Kürzel,
//     Serverprüfung qualitaetFehler(), keine lokalen Qualitätslisten und kein „tafelwein“ in src.
// (4) Formulare und Server Actions (statisch): jede Datei mit einer Auswahl der Qualitätsstufe
//     (<select name/aria-label „qualit…“, Tool-enum) steht in FORMULARE; jede Formular-Datei
//     verwendet die Liste ihrer Zieltabelle (Kommentare und der Import selbst zählen nicht als
//     Verwendung); keine andere Datei bezieht oder reicht eine Liste weiter (auch Re-Exporte und
//     relative Importe aus einem Nachbarmodul); keine Auswahlliste aus den Gesamtlisten von
//     lib/weinqualitaet (Formular-Dateien importieren sie gar nicht), kein hart codiertes
//     Stufen-Literal außerhalb der Liste, und die Server Actions prüfen die Listenzugehörigkeit und
//     brechen ab (if (…) throw/return), bevor irgendein Schreibzugriff erreicht wird – je Zweig
//     (umschließender Block).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const QUALITAET_MODUL = await import('../../src/lib/wein/qualitaet.ts')
const {
  QUALITAET_OPTS, LESE_QUALITAETEN, FUELLUNG_QUALITAETEN,
  istLeseQualitaet, istChargenQualitaet, istFuellungQualitaet,
  qualitaetFehler, mitGespeichertemWert, qualitaetLabel,
} = QUALITAET_MODUL
const WEINQUALITAET_MODUL = await import('../../src/lib/weinqualitaet.ts')
const { kmwZuQualitaet, QUALITAET_ORDER, QUALITAET_LABEL, PRAEDIKATSWEIN_ORDER, istNiedrigerAls } =
  WEINQUALITAET_MODUL
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

/** Tabellenname ohne Anführungszeichen, klein geschrieben; Schema nur „public“ (sonst null) */
function tabellenName(roh) {
  const teile = roh.replace(/"/g, '').split('.').map(t => t.trim().toLowerCase())
  if (teile.length > 1 && teile[0] !== 'public') return null
  return teile.at(-1) || null
}

/** Letzter Stand je benanntem CHECK über SQL-Texte in Neuaufbau-Reihenfolge ([{ datei, sql }]).
 *  `ziele`: { <constraint>: <tabelle> }. Ergebnis je Constraint: { werte, datei, ausdruck } bzw.
 *  null (gelöscht/nie benannt). Definitionen: „ADD CONSTRAINT <name> CHECK (…)“ und die Form
 *  ohne ADD in CREATE TABLE („CONSTRAINT <name> CHECK (…)“, so schreibt sie pg_dump).
 *  Zurückgesetzt wird durch DROP CONSTRAINT <name>, DROP TABLE <tabelle> und CREATE TABLE
 *  <tabelle> (danach zählen nur benannte Definitionen im neuen Rumpf – ein Inline-CHECK ohne
 *  Namen lässt den Test also laut scheitern). CREATE TABLE IF NOT EXISTS einer schon angelegten
 *  Tabelle ändert nichts, auch nicht ihr Rumpf. */
function benannteChecksAus(texte, ziele) {
  const namen = Object.keys(ziele)
  const tabellen = new Set(Object.values(ziele))
  const stand = new Map(namen.map(n => [n, null]))
  const angelegt = new Set()
  const zuruecksetzen = tabelle => { for (const n of namen) if (ziele[n] === tabelle) stand.set(n, null) }
  for (const { datei, sql: roh } of texte) {
    const sql = ohneKommentare(roh)
    const ereignisse = []
    for (const m of sql.matchAll(/(?:\bADD\s+)?\bCONSTRAINT\s+"?(\w+)"?\s+CHECK\s*\(/gi)) {
      if (!stand.has(m[1])) continue
      const auf = m.index + m[0].length - 1
      const zu = klammerEnde(sql, auf)
      assert.ok(zu > auf, `${datei}: CHECK ${m[1]} ohne schließende Klammer`)
      const ausdruck = sql.slice(auf + 1, zu)
      ereignisse.push({ pos: m.index, art: 'check', name: m[1], wert: { werte: checkWerte(ausdruck), datei, ausdruck } })
    }
    for (const m of sql.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) {
      if (stand.has(m[1])) ereignisse.push({ pos: m.index, art: 'check', name: m[1], wert: null })
    }
    const anlegen = /\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\s*\.\s*)?"?\w+"?)\s*\(/gi
    for (const m of sql.matchAll(anlegen)) {
      const tabelle = tabellenName(m[2])
      if (!tabellen.has(tabelle)) continue
      const zu = klammerEnde(sql, m.index + m[0].length - 1)
      assert.ok(zu > 0, `${datei}: CREATE TABLE ${tabelle} ohne schließende Klammer`)
      ereignisse.push({ pos: m.index, art: 'anlegen', tabelle, nurWennNeu: Boolean(m[1]), rumpfEnde: zu })
    }
    for (const m of sql.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]*)/gi)) {
      for (const teil of m[1].replace(/\b(?:CASCADE|RESTRICT)\b/gi, '').split(',')) {
        const tabelle = tabellenName(teil)
        if (tabellen.has(tabelle)) ereignisse.push({ pos: m.index, art: 'loeschen', tabelle })
      }
    }
    let ohneWirkungBis = -1   // Rumpf eines CREATE TABLE IF NOT EXISTS, das nichts anlegt
    for (const e of ereignisse.sort((a, b) => a.pos - b.pos)) {
      if (e.art === 'check') {
        if (e.pos > ohneWirkungBis) stand.set(e.name, e.wert)
      } else if (e.art === 'loeschen') {
        zuruecksetzen(e.tabelle)
        angelegt.delete(e.tabelle)
      } else if (e.nurWennNeu && angelegt.has(e.tabelle)) {
        ohneWirkungBis = Math.max(ohneWirkungBis, e.rumpfEnde)
      } else {
        zuruecksetzen(e.tabelle)
        angelegt.add(e.tabelle)
      }
    }
  }
  return stand
}

function benannteChecks(ziele) {
  return benannteChecksAus(
    migrationsdateien().map(datei => ({ datei: path.basename(datei), sql: readFileSync(datei, 'utf8') })),
    ziele,
  )
}

describe('CHECK-Parser (Hilfsfunktionen dieses Tests)', () => {
  const lies = (...sql) => benannteChecksAus(sql.map((s, i) => ({ datei: `t${i}.sql`, sql: s })), { c: 't' }).get('c')

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

  test('CREATE TABLE: pg_dump-Form ohne ADD zählt, DROP/CREATE TABLE setzen zurück', () => {
    const pgDump = "CREATE TABLE public.t (\n    q text,\n    CONSTRAINT c CHECK ((q = ANY (ARRAY['neu'::text])))\n);"
    assert.deepEqual(lies(pgDump).werte, ['neu'])
    assert.deepEqual(lies("CREATE TABLE t (q text CONSTRAINT c CHECK (q IN ('a')))").werte, ['a'], 'Spalten-Constraint mit Namen')
    // Neuanlage nach DROP TABLE (z. B. Baseline aus supabase db dump): die neue Liste gilt, nicht die alte
    assert.deepEqual(lies("ALTER TABLE t ADD CONSTRAINT c CHECK (q IN ('alt'));", `DROP TABLE t; ${pgDump}`).werte, ['neu'])
    assert.deepEqual(lies("ALTER TABLE t ADD CONSTRAINT c CHECK (q IN ('alt'));\nDROP TABLE t;\nCREATE TABLE t (q text, CONSTRAINT c CHECK (q IN ('neu'))) ;").werte, ['neu'], 'in einer Datei')
    // DROP TABLE ohne Neuanlage bzw. Neuanlage nur mit Inline-CHECK ohne Namen → keine Liste (Test scheitert laut)
    assert.equal(lies("ADD CONSTRAINT c CHECK (q IN ('a'))", 'DROP TABLE IF EXISTS public.x, "t" CASCADE;'), null)
    assert.equal(lies("ADD CONSTRAINT c CHECK (q IN ('a'))", "CREATE TABLE t (q text CHECK (q IN ('b')))"), null)
    // andere Tabellen bzw. Schemata setzen nichts zurück
    assert.deepEqual(lies("ADD CONSTRAINT c CHECK (q IN ('a'))", 'DROP TABLE t2; CREATE TABLE t_neu (q text); CREATE TABLE archiv.t (q text);').werte, ['a'])
    // CREATE TABLE IF NOT EXISTS: legt nur an, wenn die Tabelle fehlt – sonst zählt ihr Rumpf nicht
    const wennNeu = "CREATE TABLE IF NOT EXISTS t (q text, CONSTRAINT c CHECK (q IN ('x')));"
    assert.deepEqual(lies('CREATE TABLE t (q text);', "ALTER TABLE t ADD CONSTRAINT c CHECK (q IN ('a'));", wennNeu).werte, ['a'])
    assert.deepEqual(lies(wennNeu).werte, ['x'])
    assert.deepEqual(lies('CREATE TABLE t (q text);', 'DROP TABLE t;', wennNeu).werte, ['x'])
  })
})

const CHECKS = benannteChecks({
  ernte_parzellen_qualitaetsstufe_check: 'ernte_parzellen',
  weinausbau_qualitaetsstufe_check: 'weinausbau',
  fuellungen_qualitaet_check: 'fuellungen',
})

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
  test('Lese: genau Wein bis Trockenbeerenauslese und Eiswein, aufsteigend nach Rang, Labels aus QUALITAET_OPTS', () => {
    assert.deepEqual(werte(LESE_QUALITAETEN), [
      'wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese',
      // KAN-74: Eiswein steht auf der Stufe der Beerenauslese, also vor der TBA
      'auslese', 'beerenauslese', 'eiswein', 'trockenbeerenauslese',
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
    // neutral: DAC & Co. gehören nicht zur Lese – kein Versprechen, sie würden bei jeder Charge
    // bzw. Füllung „vergeben“ (bei Chargen aus einer Pressung bietet die Füllung sie nicht an)
    assert.match(dac, /DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein und Sonstiges gehören nicht zur Lese \(nur Charge bzw\. Füllung\)\.$/)
    assert.doesNotMatch(dac, /vergeben/)
    const stroh = qualitaetFehler('lese', 'strohwein')
    assert.match(stroh, /„Strohwein \/ Schilfwein“ ist bei der Lese nicht zulässig/)
    // Eiswein steht in der Liste – die Meldung spricht deshalb nicht von „Mostgewichts-Stufen“
    // und nennt Strohwein/Ausbruch ausdrücklich als offen
    assert.match(stroh, /Strohwein und Ausbruch derzeit nicht \(Entscheidung offen\)/)
    for (const meldung of [dac, stroh]) assert.doesNotMatch(meldung, /Mostgewichts-Stufen/)
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

  test('keine gültige Zahl (NaN, ±Infinity, null, undefined, leer) zählt wie „kein KMW“ → Qualitätswein, nicht „Wein“', () => {
    // Rückfall wie bei den Aufrufern ohne KMW-Wert (Lese, Pressung/Charge) – ein neuer Aufrufer
    // ohne eigene Prüfung stufte sonst eine fehlende oder ungültige Eingabe still auf „Wein“ ab
    // (Number(null) und Number('') ergeben 0; null kommt z. B. als DB-Wert aus einer untypisierten Zeile)
    for (const kmw of [NaN, Number('abc'), Number('9,5'), Infinity, -Infinity, undefined, null, '', '   ']) {
      assert.equal(kmwZuQualitaet(kmw), 'qualitaetswein', JSON.stringify(kmw) ?? String(kmw))
    }
    // ein numerischer Text aus der DB zählt wie bisher als Zahl – auch 0 (wie der Server über zahlAus('0'))
    assert.equal(kmwZuQualitaet('17'), 'kabinett')
    assert.equal(kmwZuQualitaet('13.9'), 'wein')
    assert.equal(kmwZuQualitaet('0'), 'wein')
    assert.equal(kmwZuQualitaet(0), 'wein')
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
      path.join('src', 'lib', 'wein', 'qualitaetsrang.ts'),   // KAN-74: die eine Rangfolge
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

// ── (4) Formulare und Server Actions ─────────────────────────────────────────

describe('(4) Formulare und Server Actions verwenden die Liste ihrer Zieltabelle', () => {
  // Liste aus lib/wein/qualitaet.ts → Zieltabelle
  const LISTEN_ZIEL = {
    LESE_QUALITAETEN: 'lese',
    FUELLUNG_QUALITAETEN: 'fuellung',
    QUALITAET_OPTS: 'charge',
  }
  const ZIEL_LISTE = { lese: LESE_QUALITAETEN, fuellung: FUELLUNG_QUALITAETEN, charge: QUALITAET_OPTS }
  /** Ziele eines FORMULARE-Eintrags als sortiertes Array (ein Ziel oder mehrere) */
  const zieleVon = ziel => [ziel].flat().slice().sort()
  const listenName = ziel => zieleVon(ziel).map(z => Object.keys(LISTEN_ZIEL).find(l => LISTEN_ZIEL[l] === z)).join(' bzw. ')
  // Datei → erwartete Zieltabelle (neue Formulare hier eintragen – der Test verlangt es).
  // Trauben-Qualität (Traubenverkauf, Verkaufsposition Trauben) = Liste der Lese.
  // Mehrere Ziele (Array) nur, wenn ein Formular je nach Art in verschiedene Tabellen schreibt: der Zukauf
  // (KAN-80 Nachtrag, 02.10.2026) – Wein/Most → Zielcharge (charge), Trauben → Stufe der Lese (lese).
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
    'src/app/(dashboard)/kellerbuch/eroeffnungsbestand/[id]/edit/page.tsx':    'charge',
    'src/app/(dashboard)/kellerbuch/gebinde/page.tsx':                         'charge',
    'src/app/(dashboard)/admin/import/ImportClient.tsx':                       'charge',
    'src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx':                      ['charge', 'lese'],
    'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx':      ['charge', 'lese'],
    'src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx':               'charge',   // Abstufen bei der Pressung (KAN-81/KAN-126)
  }
  // Serverprüfung vor dem Schreiben: [Datei, Funktion, Aufruf, weitere Schreibaufrufe (optional),
  // Optionen (optional)]. Der Aufruf muss im Rumpf der Funktion (ohne Kommentare) vor dem ersten
  // Schreibzugriff stehen (.insert/.update/.upsert/.delete, rpc – z. B. Nummernkreise – bzw. die
  // genannten Actions). Bei qualitaetFehler(…) muss das Ergebnis außerdem zum Abbruch führen:
  // `const x = qualitaetFehler(…)` und `if (x) throw|return` (bzw. `if (x && …)`). Geprüft wird
  // JEDER Schreibzugriff: Vor ihm muss ein Abbruch (bzw. bei einer Hilfsfunktion deren Aufruf) in
  // einem umschließenden Block stehen – ein Abbruch im if-Zweig deckt den else-Zweig nicht.
  // Mindestens ein solcher Abbruch muss immer im Rumpf stehen, auch ohne eigenen Schreibzugriff;
  // Optionen: { abbrueche: n, grund } – mindestens n (> 1, mit Begründung). Hilfsfunktionen
  // ohne Schreibzugriff (…AusFormular, parse…, pruefePositionen) stehen mit ihrem Aufrufer hier;
  // dort genügt der Aufruf (die Hilfsfunktion wirft).
  const SERVERPRUEFUNGEN = [
    // ernte_parzellen
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'upsertErnteParzelle', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'createMultipleErnteParzellen', "qualitaetFehler('lese'"],
    ['src/lib/assistent/tools/ernte.ts', 'fuehreErnteErfassenAus', "qualitaetFehler('lese'", /\b(?:createJahrgang|createMultipleErnteParzellen|upsertErnteParzelle)\s*\(/],
    // weinausbau
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'upsertPressung', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'chargenQualitaetAusFormular', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'createWeinausbau', 'chargenQualitaetAusFormular('],
    ['src/app/(dashboard)/kellerbuch/actions.ts', 'updateWeinausbau', 'chargenQualitaetAusFormular('],
    ['src/app/(dashboard)/kellerbuch/gebinde-actions.ts', 'insertEroeffnungsbestand', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/kellerbuch/gebinde-actions.ts', 'eroeffnungsbestandSpeichern', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'parseZukaufFormData', "qualitaetFehler('charge'"],
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'parseZukaufFormData', "qualitaetFehler('lese'"],   // KAN-80 Nachtrag: Trauben
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'createZukauf', 'parseZukaufFormData('],
    ['src/app/(dashboard)/weinhandel/zukauf/actions.ts', 'updateZukauf', 'parseZukaufFormData('],
    // fuellungen
    ['src/app/(dashboard)/weinhandel/actions.ts', 'fuellungQualitaetAusFormular', "qualitaetFehler('fuellung'"],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'createFuellung', 'fuellungQualitaetAusFormular('],
    ['src/app/(dashboard)/weinhandel/actions.ts', 'updateFuellung', 'fuellungQualitaetAusFormular('],
    ['src/lib/assistent/tools/abfuellen.ts', 'fuehreAbfuellenAus', "qualitaetFehler('fuellung'", /\bcreateFuellung\s*\(/],
    // Trauben-Qualität (traubenverkauf, ohne CHECK)
    ['src/app/(dashboard)/erntemeldung/actions.ts', 'createTraubenverkauf', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts', 'upsertTraubenverkauf', "qualitaetFehler('lese'", null,
      { abbrueche: 2, grund: 'Abbruch je Zweig: Bearbeiten (unverändert gespeicherter Altwert bleibt erlaubt, erst nach dem Laden prüfbar) und Neuanlage (vor der Liefernummer)' }],
    ['src/app/(dashboard)/weinhandel/verkauf/actions.ts', 'pruefePositionen', "qualitaetFehler('lese'"],
    ['src/app/(dashboard)/weinhandel/verkauf/actions.ts', 'createVerkauf', 'pruefePositionen('],
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

  /** Alle Namen eines Moduls – für export * [as N] from, dynamisches import(…) und einen
   *  Namespace, der als Ganzes verwendet wird */
  const MODUL_EXPORTE = {
    'lib/wein/qualitaet': Object.keys(QUALITAET_MODUL),
    'lib/weinqualitaet': Object.keys(WEINQUALITAET_MODUL),
  }
  // Gesamtlisten aus lib/weinqualitaet (alle 18 Stufen, also auch DAC & Co.)
  const GESAMTLISTEN = ['QUALITAET_ORDER', 'PRAEDIKATSWEIN_ORDER', 'QUALITAET_LABEL']

  /** Statische Import- und Re-Export-Anweisungen: import X, { A, type B, C as D } from '…',
   *  import * as N from '…', export { A as B } from '…', export * [as N] from '…' */
  const IMPORT_ANWEISUNG = /\b(import|export)\s*(?:type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?)|[\w$]+)\s*from\s*(['"])([^'"]+)\3/g

  /** Verweist der Modulpfad `spec` auf `modul` (z. B. lib/wein/qualitaet)? „@/…“ steht für src/…,
   *  relative Pfade werden gegen `datei` (Pfad ab Repo-Wurzel) aufgelöst – ohne `datei` zählt nur
   *  die Endung (…/lib/wein/qualitaet). Dateiendung und /index spielen keine Rolle. */
  function istModul(spec, modul, datei) {
    let p = spec.replace(/\.(?:tsx?|m?js)$/, '').replace(/\/index$/, '')
    if (p.startsWith('@/')) p = 'src/' + p.slice(2)
    else if (p.startsWith('.') && datei) p = path.posix.join(path.posix.dirname(datei), p)
    return p === modul || p.endsWith('/' + modul)
  }

  /** Was eine Datei aus `modul` bezieht: [{ name, lokal, art }] – art „import“ (lokal = Name in der
   *  Datei, auch bei „as“), „namespace“ (import * as N: die als N.NAME verwendeten Namen, bei
   *  anderer Verwendung von N – Object.values(N), f(N) … – alle), „reexport“ (export { … } from,
   *  export * [as N] from; lokal null) und „dynamisch“ (import('…') bzw. require('…'): alle Namen).
   *  Kommentare zählen nicht. */
  function importe(text, modul = 'lib/wein/qualitaet', datei = null) {
    const code = ohneJsKommentare(text)
    const alle = MODUL_EXPORTE[modul] ?? []
    const aus = []
    for (const m of code.matchAll(IMPORT_ANWEISUNG)) {
      const [, anweisung, klausel, , spec] = m
      if (!istModul(spec, modul, datei)) continue
      const reexport = anweisung === 'export'
      const benannt = /\{([^}]*)\}/.exec(klausel)
      if (benannt) {
        for (const teil of benannt[1].split(',')) {
          const [name, alias] = teil.trim().replace(/^type\s+/, '').split(/\s+as\s+/).map(s => s.trim())
          if (name) aus.push({ name, lokal: reexport ? null : (alias || name), art: reexport ? 'reexport' : 'import' })
        }
      }
      const stern = /\*(?:\s*as\s+([\w$]+))?/.exec(klausel)
      if (stern && reexport) {
        for (const name of alle) aus.push({ name, lokal: null, art: 'reexport' })
      } else if (stern) {
        const ns = stern[1]
        const rest = code.slice(0, m.index) + ' ' + code.slice(m.index + m[0].length)
        const einzeln = new Set([...rest.matchAll(new RegExp(`(?<![\\w$.])${ns}\\s*\\.\\s*([\\w$]+)`, 'g'))].map(n => n[1]))
        const ganz = new RegExp(`(?<![\\w$.])${ns}(?![\\w$]|\\s*\\.\\s*[\\w$])`).test(rest)
        for (const name of ganz ? alle : einzeln) aus.push({ name, lokal: ganz ? ns : `${ns}.${name}`, art: 'namespace' })
      }
    }
    for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      if (istModul(m[2], modul, datei)) for (const name of alle) aus.push({ name, lokal: null, art: 'dynamisch' })
    }
    return aus
  }

  /** Aus `modul` bezogene Namen einer Datei (siehe importe) */
  const importierteNamen = (text, modul, datei) => new Set(importe(text, modul, datei).map(i => i.name))

  /** Wird der Name `lokal` im Code verwendet? Kommentare und die Import-Anweisungen selbst zählen nicht. */
  const wirdVerwendet = (text, lokal) =>
    new RegExp(`(?<![\\w$])${lokal.replace(/\$/g, '\\$')}(?![\\w$])`).test(ohneJsKommentare(text).replace(IMPORT_ANWEISUNG, ' '))

  test('importe/importierteNamen: benannte, umbenannte, Typ-, Namespace-, relative, Re-Export- und dynamische Importe', () => {
    assert.deepEqual([...importierteNamen("import { A, type B, C as D } from '@/lib/wein/qualitaet'")], ['A', 'B', 'C'])
    assert.deepEqual(importe("import { C as D } from '@/lib/wein/qualitaet'"), [{ name: 'C', lokal: 'D', art: 'import' }])
    assert.deepEqual([...importierteNamen("import type { T } from '@/lib/wein/qualitaet.ts'")], ['T'])
    assert.deepEqual([...importierteNamen("import * as Q from '../lib/wein/qualitaet'\nQ.LESE_QUALITAETEN.map(x => x)")], ['LESE_QUALITAETEN'])
    assert.deepEqual([...importierteNamen("import { A } from '@/lib/weinqualitaet'")], [])
    assert.deepEqual([...importierteNamen("import * as W from '@/lib/weinqualitaet'\nW.QUALITAET_ORDER", 'lib/weinqualitaet')], ['QUALITAET_ORDER'])
    // auskommentierter Import zählt nicht
    assert.deepEqual([...importierteNamen("// import { QUALITAET_OPTS } from '@/lib/wein/qualitaet'\n/* import { A } from '@/lib/wein/qualitaet' */")], [])
    // Namespace als Ganzes → alle Namen des Moduls
    assert.ok(importierteNamen("import * as Q from '@/lib/wein/qualitaet'\nObject.values(Q)").has('QUALITAET_OPTS'))
    // Re-Exporte (Zwischenmodul)
    assert.deepEqual(importe("export { QUALITAET_OPTS as ALLE_STUFEN } from '@/lib/wein/qualitaet'"), [{ name: 'QUALITAET_OPTS', lokal: null, art: 'reexport' }])
    assert.ok(importierteNamen("export * from '@/lib/wein/qualitaet'").has('LESE_QUALITAETEN'))
    assert.ok(importierteNamen("export * as S from '@/lib/wein/qualitaet'").has('FUELLUNG_QUALITAETEN'))
    assert.ok(importierteNamen("export * from '@/lib/weinqualitaet'", 'lib/weinqualitaet').has('QUALITAET_ORDER'))
    // relativer Import aus einem Nachbarmodul – nur mit Dateipfad auflösbar
    const nachbar = "import { QUALITAET_OPTS } from './qualitaet'\nexport const ALLE_STUFEN = QUALITAET_OPTS"
    assert.deepEqual([...importierteNamen(nachbar, 'lib/wein/qualitaet', 'src/lib/wein/stufen.ts')], ['QUALITAET_OPTS'])
    assert.deepEqual([...importierteNamen("import { X } from '../wein/qualitaet'", 'lib/wein/qualitaet', 'src/lib/andere/a.ts')], ['X'])
    assert.deepEqual([...importierteNamen("import { X } from './qualitaet'", 'lib/wein/qualitaet', 'src/app/x/Form.tsx')], [])
    // dynamischer Import → alle Namen
    assert.ok(importierteNamen("const { QUALITAET_OPTS } = await import('@/lib/wein/qualitaet')").has('LESE_QUALITAETEN'))
  })

  test('wirdVerwendet: Kommentar und Import-Anweisung zählen nicht, Alias zählt', () => {
    const imp = "import { LESE_QUALITAETEN, QUALITAET_OPTS as ALLE } from '@/lib/wein/qualitaet'\n"
    assert.ok(!wirdVerwendet(`${imp}// LESE_QUALITAETEN statt QUALITAET_OPTS\nALLE.map(o => o)`, 'LESE_QUALITAETEN'))
    assert.ok(wirdVerwendet(`${imp}ALLE.map(o => o)`, 'ALLE'))
    assert.ok(wirdVerwendet(`${imp}const s = [...LESE_QUALITAETEN]`, 'LESE_QUALITAETEN'))
    assert.ok(!wirdVerwendet(`${imp}LESE_QUALITAETEN_ALT.map(o => o)`, 'LESE_QUALITAETEN'))
  })

  test('jede Formular-Datei importiert genau die Liste ihrer Zieltabelle und verwendet sie', () => {
    const fehler = []
    for (const [datei, ziel] of Object.entries(FORMULARE)) {
      const p = path.join(ROOT, ...datei.split('/'))
      if (!existsSync(p)) { fehler.push(`${datei}: Datei fehlt – Zuordnung in FORMULARE anpassen`); continue }
      const text = readFileSync(p, 'utf8')
      const listen = importe(text, 'lib/wein/qualitaet', datei).filter(i => i.name in LISTEN_ZIEL)
      const namen = menge(listen.map(i => i.name))
      const ziele = menge(namen.map(n => LISTEN_ZIEL[n]))
      if (JSON.stringify(ziele) !== JSON.stringify(zieleVon(ziel))) {
        fehler.push(`${datei}: erwartet Liste für „${ziel}“, importiert ${namen.join(', ') || 'keine'}`)
      }
      if (listen.some(i => i.art === 'dynamisch')) fehler.push(`${datei}: lädt lib/wein/qualitaet dynamisch – Liste statisch importieren`)
      for (const i of listen) {
        if (i.art === 'reexport') fehler.push(`${datei}: reicht ${i.name} weiter (Re-Export) – Formular-Dateien geben keine Qualitätsliste weiter`)
        else if (i.art === 'import' && !wirdVerwendet(text, i.lokal)) fehler.push(`${datei}: ${i.name} importiert, aber nicht verwendet`)
      }
    }
    assert.deepEqual(fehler, [])
  })

  test('keine weitere Datei in src bezieht oder reicht eine Qualitätsliste weiter', () => {
    // Zählt auch Re-Exporte (export { QUALITAET_OPTS as X } from …, export * from …) und relative
    // Importe aus einem Nachbarmodul (from './qualitaet') – sonst böte ein Zwischenmodul die Lese
    // wieder mit DAC & Co. an, ohne dass ein Formular-Test anschlägt. Die Gesamtlisten aus
    // lib/weinqualitaet reicht ebenfalls niemand weiter.
    const bekannt = new Set(Object.keys(FORMULARE))
    const funde = []
    ;(function durchsuche(dir) {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) { durchsuche(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        const text = readFileSync(p, 'utf8')
        if (rel !== 'src/lib/wein/qualitaet.ts' && !bekannt.has(rel)) {
          const listen = importe(text, 'lib/wein/qualitaet', rel).filter(i => i.name in LISTEN_ZIEL)
          const weiter = menge(listen.filter(i => i.art === 'reexport').map(i => i.name))
          const bezogen = menge(listen.filter(i => i.art !== 'reexport').map(i => i.name))
          if (weiter.length > 0) funde.push(`${rel}: reicht ${weiter.join(', ')} weiter (Re-Export) – Formulare importieren ihre Liste direkt aus lib/wein/qualitaet`)
          if (bezogen.length > 0) funde.push(`${rel}: ${bezogen.join(', ')} – als Formular in FORMULARE eintragen (Zieltabelle), nicht über ein Zwischenmodul weitergeben`)
        }
        if (rel !== 'src/lib/weinqualitaet.ts') {
          const weiter = menge(importe(text, 'lib/weinqualitaet', rel).filter(i => i.art === 'reexport' && GESAMTLISTEN.includes(i.name)).map(i => i.name))
          if (weiter.length > 0) funde.push(`${rel}: reicht ${weiter.join(', ')} aus lib/weinqualitaet weiter (Re-Export) – Gesamtlisten nicht weitergeben`)
        }
      }
    })(path.join(ROOT, 'src'))
    assert.deepEqual(funde, [])
  })

  /** <select>-Elemente einer Datei: Attribute bis zum „>“ außerhalb von {…} (Pfeilfunktionen in
   *  onChange zählen nicht als Ende) und Zeilennummer */
  function selectElemente(text) {
    const aus = []
    for (const m of text.matchAll(/<select\b/g)) {
      let i = m.index + m[0].length
      for (let tiefe = 0; i < text.length; i++) {
        const c = text[i]
        if (c === '{') tiefe++
        else if (c === '}') tiefe--
        else if (c === '>' && tiefe === 0) break
      }
      aus.push({ zeile: text.slice(0, m.index).split('\n').length, attribute: text.slice(m.index + m[0].length, i) })
    }
    return aus
  }

  /** Stellen, an denen eine Datei eine Qualitätsstufe zur Auswahl anbietet: <select> mit name, id,
   *  aria-label, value oder defaultValue „qualit…“ (Qualitätsstufe, qualitaet, qualitaetsstufe …)
   *  sowie Tool-Parameter „qualitaet…: { … enum … }“ (Assistent). Zeilennummern. */
  function qualitaetsAuswahlen(text) {
    const code = ohneJsKommentare(text)
    const zeilen = selectElemente(code)
      .filter(s => /\b(?:name|id|aria-label|aria-labelledby|value|defaultValue)\s*=\s*(?:"[^"]*|'[^']*|\{[^}]*)qualit/i.test(s.attribute))
      .map(s => s.zeile)
    for (const m of code.matchAll(/\bqualitaet\w*\s*:\s*\{/g)) {
      const auf = m.index + m[0].length - 1
      let tiefe = 0, offen = null, ende = code.length
      for (let i = auf; i < code.length; i++) {
        const c = code[i]
        if (offen) { if (c === '\\') i++; else if (c === offen) offen = null; continue }
        if (c === "'" || c === '"' || c === '`') offen = c
        else if (c === '{') tiefe++
        else if (c === '}' && --tiefe === 0) { ende = i; break }
      }
      if (/\benum\s*:/.test(code.slice(auf, ende))) zeilen.push(code.slice(0, m.index).split('\n').length)
    }
    return zeilen.sort((a, b) => a - b)
  }

  test('qualitaetsAuswahlen erkennt Qualitäts-Selects und Tool-enums, aber keine anderen Selects', () => {
    assert.deepEqual(qualitaetsAuswahlen('<select aria-label="Qualitätsstufe" name="qualitaetsstufe">\n{(["kabinett", "dac"] as const).map(q => <option key={q}>{q}</option>)}</select>'), [1])
    assert.deepEqual(qualitaetsAuswahlen('x\n<select\n  value={pos.trauben_qualitaetsstufe}\n  onChange={e => up({ a: e.target.value })}\n>'), [2])
    assert.deepEqual(qualitaetsAuswahlen('<select aria-label="Ried" onChange={e => { const q = qualitaet }} value={ried}>'), [])
    assert.deepEqual(qualitaetsAuswahlen("x\n  qualitaetsstufe: {\n    type: 'string',\n    description: `a ${'}'}`,\n    enum: LESE_WERTE,\n  },"), [2])
    assert.deepEqual(qualitaetsAuswahlen("qualitaet_abgestuft: { type: 'boolean' }, n: { enum: ['a'] }"), [])
    assert.deepEqual(qualitaetsAuswahlen('// <select name="qualitaetsstufe">'), [])
  })

  test('jede Datei mit einer Auswahl der Qualitätsstufe steht in FORMULARE', () => {
    // Die Listen- und Literal-Prüfungen oben laufen nur über FORMULARE. Eine neue Formular-Datei
    // mit eigener Auswahl (z. B. <select name="qualitaetsstufe"> mit hart codierten Optionen und
    // ohne Import einer zentralen Liste) fiele sonst durch. Ausnahmen je Datei mit Grund – nur für
    // Auswahlen, die keine Qualitätsstufe sind:
    const AUSNAHMEN = {
      'src/app/(dashboard)/erntemeldung/JahrgaengeClient.tsx': 'qualitaet_gesamt = Jahrgangsbewertung (sehr gut, gut …), keine Qualitätsstufe',
    }
    const funde = []
    ;(function durchsuche(dir) {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) { durchsuche(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        const zeilen = qualitaetsAuswahlen(readFileSync(p, 'utf8'))
        if (rel in AUSNAHMEN) {
          if (zeilen.length === 0) funde.push(`${rel}: Ausnahme wird nicht mehr gebraucht – aus AUSNAHMEN entfernen`)
          continue
        }
        if (rel in FORMULARE) {
          // Gegenprobe: die Erkennung findet jedes bekannte Formular – sonst ist sie zu eng
          if (zeilen.length === 0) funde.push(`${rel}: steht in FORMULARE, aber keine Auswahl der Qualitätsstufe erkannt – qualitaetsAuswahlen anpassen`)
          continue
        }
        if (zeilen.length > 0) funde.push(`${rel}:${zeilen.join(',')} – Auswahl der Qualitätsstufe: Datei mit Zieltabelle in FORMULARE eintragen`)
      }
    })(path.join(ROOT, 'src'))
    for (const [datei, grund] of Object.entries(AUSNAHMEN)) {
      if (String(grund).trim().length < 15) funde.push(`${datei}: Ausnahme ohne ausreichenden Grund`)
      if (datei in FORMULARE) funde.push(`${datei}: Ausnahme für eine Datei in FORMULARE`)
      if (!existsSync(path.join(ROOT, ...datei.split('/')))) funde.push(`${datei}: Ausnahme für eine fehlende Datei – entfernen`)
    }
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
  function optionenAusGesamtlisten(text, datei = null) {
    const namen = importierteNamen(text, 'lib/weinqualitaet', datei)
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
        const zeilen = optionenAusGesamtlisten(readFileSync(p, 'utf8'), rel)
        if (zeilen.length > 0) funde.push(`${rel}:${zeilen.join(',')} – Auswahlliste aus lib/wein/qualitaet verwenden`)
      }
    })(path.join(ROOT, 'src'))
    assert.deepEqual(funde, [])
  })

  test('Formular-Dateien importieren keine Gesamtlisten aus lib/weinqualitaet', () => {
    // optionenAusGesamtlisten erkennt nur die direkte Form (QUALITAET_ORDER….map(<option …>)).
    // Über eine Zwischenvariable (const s = [...QUALITAET_ORDER]; s.map(q => <option …>)) böte
    // z. B. die Lese wieder DAC, Reserve, Sekt … an. In den Formular-Dateien sind die Gesamtlisten
    // deshalb ganz tabu: QUALITAET_ORDER und PRAEDIKATSWEIN_ORDER immer, QUALITAET_LABEL (Schlüssel
    // = alle 18 Stufen) bei der Lese. Für die übrigen Ziele deckt QUALITAET_LABEL genau deren Liste ab.
    // Ausnahmen je Datei und Name mit Grund: { 'src/…/Datei.tsx': { NAME: 'Grund' } } (bisher keine)
    const AUSNAHMEN = {}
    const verboten = ziel => ['QUALITAET_ORDER', 'PRAEDIKATSWEIN_ORDER', ...(zieleVon(ziel).includes('lese') ? ['QUALITAET_LABEL'] : [])]
    const funde = []
    for (const [datei, ziel] of Object.entries(FORMULARE)) {
      const namen = importierteNamen(readFileSync(path.join(ROOT, ...datei.split('/')), 'utf8'), 'lib/weinqualitaet', datei)
      const ausnahmen = AUSNAHMEN[datei] ?? {}
      for (const n of verboten(ziel)) {
        if (namen.has(n) && !(n in ausnahmen)) funde.push(`${datei}: importiert ${n} aus lib/weinqualitaet – Liste ${listenName(ziel)} aus lib/wein/qualitaet verwenden`)
      }
      for (const [n, grund] of Object.entries(ausnahmen)) {
        if (!namen.has(n)) funde.push(`${datei}: Ausnahme ${n} wird nicht mehr gebraucht – aus AUSNAHMEN entfernen`)
        if (String(grund).trim().length < 15) funde.push(`${datei}: Ausnahme ${n} ohne ausreichenden Grund`)
      }
    }
    for (const datei of Object.keys(AUSNAHMEN)) {
      if (!(datei in FORMULARE)) funde.push(`${datei}: Ausnahme für eine Datei ohne Eintrag in FORMULARE`)
    }
    assert.deepEqual(funde, [])
  })

  /** Text-Literale ('…', "…", `…`), die nur aus Kleinbuchstaben und _ bestehen – Kandidaten für
   *  Stufen-Codes (Kommentare zählen nicht) */
  const stufenLiterale = text => [...ohneJsKommentare(text).matchAll(/(['"`])([a-z_]+)\1/g)].map(m => m[2])

  test('stufenLiterale erkennt Optionen, eigene kurze Listen und Vergleiche, aber keine Kommentare', () => {
    assert.deepEqual(stufenLiterale('<option value="">–</option><option value="dac">DAC</option>'), ['dac'])
    assert.deepEqual(stufenLiterale("{ value: 'handlese', label: 'Handlese' }, <option value={'sekt'} />"), ['handlese', 'sekt'])
    assert.deepEqual(
      stufenLiterale('{(["qualitaetswein", "kabinett", "dac"] as const).map(q => <option key={q} value={q}>{qualitaetLabel(q)}</option>)}'),
      ['qualitaetswein', 'kabinett', 'dac'],
    )
    assert.deepEqual(stufenLiterale("if (typ === `sonstiges`) x = ['flasche', 'tank']"), ['sonstiges', 'flasche', 'tank'])
    assert.deepEqual(stufenLiterale('// <option value="dac">\n/* ["dac"] */'), [])
  })

  test('kein hart codiertes Stufen-Literal außerhalb der Liste der Zieltabelle', () => {
    // Teil (3) findet erst Listen mit mehreren Prädikats-Codes – ein einzelnes
    // <option value="dac"> oder eine kurze eigene Liste wie ["qualitaetswein", "kabinett", "dac"]
    // .map(q => <option …>) in einem Lese-Formular brächte den 23514-Fehler unbemerkt zurück.
    // Geprüft wird deshalb JEDES Text-Literal einer Formular-Datei, das ein Stufen-Code ist.
    // Ausnahmen je Datei und Wert mit Grund – nur für denselben Code in anderer Bedeutung:
    const AUSNAHMEN = {
      'src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx': {
        sonstiges: 'Positionstyp „Sonstiges“ (flasche/tank/sonstiges/trauben), keine Qualitätsstufe',
      },
    }
    const stufen = new Set(werte(QUALITAET_OPTS))
    const funde = []
    for (const [datei, ziel] of Object.entries(FORMULARE)) {
      const erlaubt = new Set(zieleVon(ziel).flatMap(z => werte(ZIEL_LISTE[z])))
      const ausnahmen = AUSNAHMEN[datei] ?? {}
      const literale = stufenLiterale(readFileSync(path.join(ROOT, ...datei.split('/')), 'utf8'))
      for (const v of new Set(literale)) {
        if (stufen.has(v) && !erlaubt.has(v) && !(v in ausnahmen)) {
          funde.push(`${datei}: „${v}“ ist keine Stufe für „${zieleVon(ziel).join('/')}“ – Liste ${listenName(ziel)} verwenden`)
        }
      }
      for (const [v, grund] of Object.entries(ausnahmen)) {
        if (!literale.includes(v)) funde.push(`${datei}: Ausnahme „${v}“ wird nicht mehr gebraucht – aus AUSNAHMEN entfernen`)
        if (String(grund).trim().length < 15) funde.push(`${datei}: Ausnahme „${v}“ ohne ausreichenden Grund`)
      }
    }
    for (const datei of Object.keys(AUSNAHMEN)) {
      if (!(datei in FORMULARE)) funde.push(`${datei}: Ausnahme für eine Datei ohne Eintrag in FORMULARE`)
    }
    assert.deepEqual(funde, [])
  })

  /** Positionen im Rumpf, an denen `variable` zum Abbruch führt: `if (variable)` bzw.
   *  `if (variable && …)`, direkt gefolgt von throw oder return (auch als erste Anweisung in { … }).
   *  `else if (variable) …` zählt nicht – es greift nur im else-Zweig, nicht im ganzen Block. */
  function abbruchStellen(rumpf, variable) {
    const stellen = []
    for (const m of rumpf.matchAll(/\bif\s*\(/g)) {
      if (/\belse\s*$/.test(rumpf.slice(0, m.index))) continue
      const auf = m.index + m[0].length - 1
      const zu = klammerEnde(rumpf, auf)
      if (zu < 0) continue
      if (!new RegExp(`^\\s*${variable}\\s*(?:&&|$)`).test(rumpf.slice(auf + 1, zu))) continue
      if (/^\s*\{?\s*(?:throw|return)\b/.test(rumpf.slice(zu + 1))) stellen.push(m.index)
    }
    return stellen
  }

  /** Ist die „{“ bei `i` ein Anweisungsblock (Funktionsrumpf, if/else, try, bloßer Block) und kein
   *  Objekt-Literal bzw. Destrukturierungsmuster? Entscheidet das Zeichen bzw. Wort davor. */
  function istBlock(text, i) {
    let j = i - 1
    while (j >= 0 && /\s/.test(text[j])) j--
    if (j < 0 || ')>;{}'.includes(text[j])) return true      // ) { · => { · Promise<…> { · ; { · } {
    if (!/\w/.test(text[j])) return false                    // = { · ( { · , { · : { · [ { · ? { …
    let k = j
    while (k > 0 && /\w/.test(text[k - 1])) k--
    // Wort davor: else/try/finally/do bzw. Anweisungsende ohne Semikolon (ASI) → Block;
    // return/await/case/const … { → Objekt-Literal bzw. Muster
    return !/^(?:return|yield|await|typeof|case|in|of|throw|void|delete|new|const|let|var)$/.test(text.slice(k, j + 1))
  }

  /** Offene Anweisungsblöcke an Position `pos` (Positionen der öffnenden „{“, außen zuerst);
   *  Objekt-Literale zählen nicht (ein Aufruf darin gehört zur umgebenden Anweisung), Texte in
   *  '…', "…" und `…` ebenso nicht */
  function offeneBloecke(text, pos) {
    const stapel = []
    let offen = null
    for (let i = 0; i < pos; i++) {
      const c = text[i]
      if (offen) { if (c === '\\') i++; else if (c === offen) offen = null; continue }
      if (c === "'" || c === '"' || c === '`') offen = c
      else if (c === '{') stapel.push({ i, block: istBlock(text, i) })
      else if (c === '}') stapel.pop()
    }
    return stapel.filter(b => b.block).map(b => b.i)
  }

  /** Greift ein Abbruch an `abbruch` für die Stelle `stelle`? Ja, wenn er davor steht und der Block,
   *  in dem er steht, die Stelle umschließt (sonst liegt die Stelle in einem anderen Zweig). */
  function abbruchGiltFuer(text, abbruch, stelle) {
    if (abbruch >= stelle) return false
    const a = offeneBloecke(text, abbruch)
    const s = offeneBloecke(text, stelle)
    return a.every((b, i) => s[i] === b)
  }

  /** Alle Schreibzugriffe im Rumpf: [{ pos, text }] */
  function schreibStellen(rumpf, weitere) {
    const stellen = []
    for (const re of [/\.(?:insert|update|upsert|delete)\s*\(/g, /\brpc\b/g, ...(weitere ? [new RegExp(weitere.source, 'g')] : [])]) {
      for (const m of rumpf.matchAll(re)) stellen.push({ pos: m.index, text: rumpf.slice(m.index, m.index + 60).split('\n')[0].trim() })
    }
    return stellen.sort((a, b) => a.pos - b.pos)
  }

  test('abbruchGiltFuer: Abbruch im if-Zweig deckt den else-Zweig nicht', () => {
    const rumpf = [
      'function f() {',
      '  const x = q()',
      '  if (neu) {',
      '    if (x) throw new E(x)',
      '    a.update(1)',
      '    if (b) { a.update(2) }',
      '  } else {',
      "    const s = `{ ${'}'}`",
      '    a.insert(3)',
      '    if (x) throw new E(x)',
      '    a.insert(4)',
      '  }',
      '  a.delete(5)',
      '}',
    ].join('\n')
    const [imIf, imElse] = abbruchStellen(rumpf, 'x')
    const stelle = t => rumpf.indexOf(t)
    assert.ok(abbruchGiltFuer(rumpf, imIf, stelle('update(1)')))
    assert.ok(abbruchGiltFuer(rumpf, imIf, stelle('update(2)')), 'verschachtelter Block im selben Zweig')
    assert.ok(!abbruchGiltFuer(rumpf, imIf, stelle('insert(3)')), 'else-Zweig')
    assert.ok(!abbruchGiltFuer(rumpf, imElse, stelle('insert(3)')), 'Abbruch erst danach')
    assert.ok(abbruchGiltFuer(rumpf, imElse, stelle('insert(4)')))
    assert.ok(!abbruchGiltFuer(rumpf, imIf, stelle('delete(5)')) && !abbruchGiltFuer(rumpf, imElse, stelle('delete(5)')), 'nach beiden Zweigen')
    assert.deepEqual(schreibStellen(rumpf).map(s => s.text), ['.update(1)', '.update(2) }', '.insert(3)', '.insert(4)', '.delete(5)'])
    assert.equal(abbruchStellen('if (a) g()\nelse if (x) throw new E(x)', 'x').length, 0, 'else if gilt nicht für den ganzen Block')
    // Aufruf einer abbrechenden Hilfsfunktion in einem Objekt-Literal gilt für die umgebende
    // Anweisungsebene, in einer Callback-Funktion nicht
    const obj = [
      'async function g(): Promise<{ id: string }> {',
      '  const p: R = {',
      '    q: hilf(f),',
      '    r: { s: 1 },',
      '  }',
      '  const { data } = await a.insert(p)',
      '  const y = arr.map(v => { return hilf(v) })',
      '  { const { error: e } = await b.update(2) }',
      '}',
    ].join('\n')
    assert.ok(abbruchGiltFuer(obj, obj.indexOf('hilf(f)'), obj.indexOf('.insert(')))
    assert.ok(abbruchGiltFuer(obj, obj.indexOf('hilf(f)'), obj.indexOf('.update(')), 'bloßer Block danach')
    assert.ok(!abbruchGiltFuer(obj, obj.indexOf('hilf(v)'), obj.indexOf('.update(')), 'Aufruf in einer Callback-Funktion')
  })

  test('abbruchStellen erkennt if (x) throw/return, aber kein bloßes Berechnen des Ergebnisses', () => {
    assert.equal(abbruchStellen('const f = q()\nif (f) throw new E(f)', 'f').length, 1)
    assert.equal(abbruchStellen('if (f && a !== ((b as X).c ?? null)) {\n  throw new E(f)\n}', 'f').length, 1)
    assert.equal(abbruchStellen('if (f) {\n  return { erfolg: false }\n}', 'f').length, 1)
    assert.equal(abbruchStellen('if (f) return f', 'f').length, 1)
    assert.equal(abbruchStellen('const f = q()\nvoid f', 'f').length, 0)
    assert.equal(abbruchStellen('if (!f) throw new E()', 'f').length, 0)
    assert.equal(abbruchStellen('if (f) console.log(f)', 'f').length, 0)
    assert.equal(abbruchStellen('if (a || f) throw new E()', 'f').length, 0)
    assert.equal(abbruchStellen('if (fehlerX) throw new E()', 'f').length, 0)
  })

  test('Server Actions prüfen die Listenzugehörigkeit vor dem ersten Schreibzugriff und brechen ab', () => {
    const fehler = []
    const alsRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const [datei, funktion, aufruf, weitere, optionen] of SERVERPRUEFUNGEN) {
      const text = ohneJsKommentare(readFileSync(path.join(ROOT, ...datei.split('/')), 'utf8'))
      const rumpf = funktionsRumpf(text, funktion)
      if (!rumpf) { fehler.push(`${datei}: Funktion ${funktion} nicht gefunden`); continue }
      const pos = rumpf.indexOf(aufruf)
      if (pos < 0) { fehler.push(`${datei} › ${funktion}: ${aufruf} fehlt`); continue }
      const schreiben = schreibStellen(rumpf, weitere)
      if (schreiben.length > 0 && pos > schreiben[0].pos) fehler.push(`${datei} › ${funktion}: ${aufruf} erst nach dem ersten Schreibzugriff`)
      let abbrueche
      let beschreibung
      if (aufruf.startsWith('qualitaetFehler(')) {
        // Das Ergebnis muss auch zum Abbruch führen – sonst erreichte ein unzulässiger Wert wieder die DB
        const zuweisung = new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*${alsRegex(aufruf)}`).exec(rumpf)
        if (!zuweisung || zuweisung.index + zuweisung[0].length - aufruf.length !== pos) {
          fehler.push(`${datei} › ${funktion}: Ergebnis von ${aufruf}…) nicht in einer Variablen – Abbruch nicht prüfbar`)
          continue
        }
        abbrueche = abbruchStellen(rumpf, zuweisung[1]).filter(p => p > pos)
        beschreibung = `if (${zuweisung[1]}) throw/return`
        // Mindestens ein Abbruch immer – auch ohne eigenen Schreibzugriff: Bei den Hilfsfunktionen
        // (…AusFormular, parse…, pruefePositionen) liefe die Prüfung je Schreibzugriff sonst ins
        // Leere, und ihre Aufrufer zählen den bloßen Aufruf als Abbruch
        const mindestens = optionen?.abbrueche ?? 1
        if (abbrueche.length < mindestens) {
          fehler.push(`${datei} › ${funktion}: ${abbrueche.length} statt ${mindestens} Abbrüche mit ${zuweisung[1]}${mindestens > 1 ? ` (${optionen.grund})` : ''}`)
        }
      } else {
        // Hilfsfunktion, die selbst abbricht (eigener Eintrag): ihr Aufruf ist der Abbruch
        abbrueche = [...rumpf.matchAll(new RegExp(alsRegex(aufruf), 'g'))].map(m => m.index)
        beschreibung = aufruf + '…)'
      }
      // Jeder Schreibzugriff braucht einen Abbruch davor in einem umschließenden Block (je Zweig)
      for (const s of schreiben) {
        if (!abbrueche.some(a => abbruchGiltFuer(rumpf, a, s.pos))) {
          fehler.push(`${datei} › ${funktion}: vor „${s.text}“ fehlt ${beschreibung} im selben oder einem umschließenden Block`)
        }
      }
    }
    assert.deepEqual(fehler, [])
  })
})
