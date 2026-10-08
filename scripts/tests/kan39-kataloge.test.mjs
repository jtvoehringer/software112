// KAN-39 Etappe 1 (02.10.2026): Kataloge der BKI-Schnittstelle – lib/katalog/bki.ts muss genau der Migration
// kan39a_kataloge entsprechen (Codes, Bezeichnungen, Rang, BSM-Spalte, Richtung/Einheit, Zuordnungen), und die
// Rangfolge passt zur Qualitätsachse aus lib/wein/qualitaetsrang.ts.
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan39-kataloge.test.mjs
//          (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt (wie bmd.ts)
const kat = await import('../../src/lib/katalog/bki.ts')
// @ts-expect-error TS5097 – siehe oben
const rang = await import('../../src/lib/wein/qualitaetsrang.ts')

const migDir = new URL('../../supabase/migrations/', import.meta.url)
const migName = readdirSync(migDir).find(f => /_kan39a_kataloge\.sql$/.test(f))
const sql = migName ? readFileSync(new URL(migName, migDir), 'utf8').replace(/\r\n/g, '\n') : ''
// KAN-118 (08.10.2026): ZU_PROD kommt mit der Produktion dazu (eigene Migration bzw. Entwurf)
const mig118 = readdirSync(migDir).find(f => /_kan118_produktion\.sql$/.test(f))
const sql118 = readFileSync(mig118 ? new URL(mig118, migDir) : new URL('../entwurf/kan118_produktion.sql', migDir), 'utf8').replace(/\r\n/g, '\n')

/** Zeilen eines INSERT … VALUES-Blocks als Arrays (Text in '…', NULL, true/false, Zahlen) */
function werte(tabelle) {
  const start = sql.indexOf(`INSERT INTO public.${tabelle} (`)
  assert.ok(start >= 0, `INSERT in ${tabelle} fehlt`)
  const block = sql.slice(sql.indexOf('VALUES', start) + 6, sql.indexOf(';\n', start))
  return [...block.matchAll(/^\s*\((.*)\),?$/gm)].map(m =>
    [...m[1].matchAll(/'((?:[^']|'')*)'|(NULL|true|false|-?\d+)/g)].map(t =>
      t[1] !== undefined ? t[1].replace(/''/g, "'") : t[2] === 'NULL' ? null : t[2] === 'true' ? true : t[2] === 'false' ? false : Number(t[2])))
}

describe('KAN-39: Kataloge lib ↔ Migration', () => {
  test('Migration kan39a_kataloge liegt in supabase/migrations', () => assert.ok(migName))
  test('Qualitätsstufen', () => {
    assert.deepEqual(werte('kat_qualitaetsstufe').map(r => r.slice(0, 5)),
      kat.KAT_QUALITAETSSTUFE.map(k => [k.code, k.bezeichnung, k.rang, k.bsmSpalte, k.vorlaeufig]))
  })
  test('Erzeugnisse', () => {
    assert.deepEqual(werte('kat_erzeugnis').map(r => r.slice(0, 3)), kat.KAT_ERZEUGNIS.map(k => [k.code, k.bezeichnung, k.bsmRelevant]))
  })
  test('Buchungsarten: 18 BSM-Werte (17 + ZU_PROD, KAN-118), interne mit Zuordnung', () => {
    const zuProd = [...sql118.matchAll(/INSERT INTO public\.kat_buchungsart \([^)]*\)\s*VALUES \('([A-Z_]+)', '([^']+)', '(\w+)', '(\w+)', (true|false), NULL/g)]
      .map(m => [m[1], m[2], m[3], m[4], m[5] === 'true', null])
    assert.equal(zuProd.length, 1)
    assert.deepEqual([...werte('kat_buchungsart').map(r => r.slice(0, 6)), ...zuProd],
      kat.KAT_BUCHUNGSART.map(k => [k.code, k.bezeichnung, k.richtung, k.einheit, k.bsm, k.bsmCode]))
    assert.equal(kat.KAT_BUCHUNGSART.filter(k => k.bsm).length, 18)
  })
  test('Farbe und Zuordnungen', () => {
    assert.deepEqual(Object.fromEntries(werte('kat_farbe')), kat.KAT_FARBE)
    const m = {}
    for (const [k, i, c] of werte('katalog_mapping')) (m[k] ??= {})[i] = c
    assert.deepEqual(m, kat.KATALOG_MAPPING)
  })
  test('Rosé zählt zu rot, grau zu weiß, unbekannt ohne Farbe', () => {
    assert.equal(kat.meldeFarbe('rose'), 'R')
    assert.equal(kat.meldeFarbe('grau'), 'W')
    assert.equal(kat.meldeFarbe('unbekannt'), null)
    assert.equal(kat.meldeFarbe(null), null)
  })
  test('Rang folgt der Qualitätsachse (qualitaetsrang.ts)', () => {
    const intern = ['wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch', 'trockenbeerenauslese']
    for (let i = 1; i < intern.length; i++) {
      const a = kat.katalogQualitaet(intern[i - 1]), b = kat.katalogQualitaet(intern[i])
      assert.ok(a.rang < b.rang, `${intern[i - 1]} < ${intern[i]}`)
      assert.ok(rang.qualitaetsStufe(intern[i - 1]) < rang.qualitaetsStufe(intern[i]), `qualitaetsrang ${intern[i - 1]} < ${intern[i]}`)
    }
    assert.equal(kat.katalogQualitaet('eiswein').rang, kat.katalogQualitaet('beerenauslese').rang)
    assert.equal(kat.katalogQualitaet('dac').rang, kat.katalogQualitaet('qualitaetswein').rang)
  })
  test('KAN-186: Ableitung Zusatz/Erzeugnis wie der Trigger s112_katalog_ableiten', () => {
    assert.deepEqual(kat.katalogAusQualitaet('reserve'), { zusatzbezeichnung: 'reserve', erzeugnis: null })
    assert.deepEqual(kat.katalogAusQualitaet('grosses_gewachs'), { zusatzbezeichnung: 'grosses_gewachs', erzeugnis: null })
    assert.deepEqual(kat.katalogAusQualitaet('sekt'), { zusatzbezeichnung: null, erzeugnis: 'SEKTGU' })
    assert.deepEqual(kat.katalogAusQualitaet('perlwein'), { zusatzbezeichnung: null, erzeugnis: 'PERLWEIN' })
    assert.deepEqual(kat.katalogAusQualitaet('qualitaetswein', 'most'), { zusatzbezeichnung: null, erzeugnis: 'MOST' })
    assert.deepEqual(kat.katalogAusQualitaet('kabinett'), { zusatzbezeichnung: null, erzeugnis: null })
    const name = readdirSync(migDir).find(f => /_kan186a_erzeugnis_zusatz_land\.sql$/.test(f))
    assert.ok(name, 'Migration kan186a fehlt')
    const m = readFileSync(new URL(name, migDir), 'utf8')
    assert.match(m, /v_q IN \('reserve', 'erste_lage', 'grosses_gewachs'\)/)
    assert.match(m, /WHEN v_q = 'sekt' THEN 'SEKTGU' WHEN v_q = 'perlwein' THEN 'PERLWEIN' WHEN v_art = 'most' THEN 'MOST'/)
    // KAN-186 Etappe 2c: + grosse_reserve (CHECKs per Migration kan186c); dieselbe Liste in lib/wein/qualitaetsrang
    assert.deepEqual([...kat.ZUSATZBEZEICHNUNGEN], ['reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'])
    assert.deepEqual([...rang.ZUSATZ_WERTE], [...kat.ZUSATZBEZEICHNUNGEN])
    assert.deepEqual(kat.katalogAusQualitaet('grosse_reserve'), { zusatzbezeichnung: null, erzeugnis: null }, 'grosse_reserve gab es nie im Qualitätsfeld')
  })
  test('Länder: 249 ISO-Codes, 27 EU-Staaten, Österreich in der EU', () => {
    const l = werte('kat_land')
    assert.equal(l.length, 249)
    assert.equal(l.filter(r => r[2] === true).length, 27)
    assert.deepEqual(l.find(r => r[0] === 'AT'), ['AT', 'Österreich', true])
    assert.ok(!l.some(r => r[0] === 'UK'))
  })
})
