// KAN-187 (02.10.2026): Länderkatalog – lib/katalog/laender.ts muss genau der Tabelle kat_land aus der Migration
// kan39a_kataloge entsprechen; normalisiereLand() erkennt Codes und gängige Namen; die BMD-Steuerlogik nutzt den
// Katalog (EU-Einordnung unverändert).
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan187-laender.test.mjs
//          (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt (wie bmd.ts)
const L = await import('../../src/lib/katalog/laender.ts')
// @ts-expect-error TS5097 – siehe oben
const bmd = await import('../../src/lib/buchhaltung/bmd.ts')

const migDir = new URL('../../supabase/migrations/', import.meta.url)
const migName = readdirSync(migDir).find(f => /_kan39a_kataloge\.sql$/.test(f))
const sql = migName ? readFileSync(new URL(migName, migDir), 'utf8').replace(/\r\n/g, '\n') : ''

function migrationsLaender() {
  const start = sql.indexOf('INSERT INTO public.kat_land (')
  assert.ok(start >= 0, 'INSERT in kat_land fehlt')
  const block = sql.slice(sql.indexOf('VALUES', start) + 6, sql.indexOf(';\n', start))
  return [...block.matchAll(/^\s*\('([A-Z]{2})', '((?:[^']|'')*)', (true|false)\),?$/gm)]
    .map(m => ({ iso2: m[1], name: m[2].replace(/''/g, "'"), eu: m[3] === 'true' }))
}

describe('KAN-187: Länderkatalog lib ↔ Migration', () => {
  test('Spiegel entspricht kat_land (249 Länder, gleiche Reihenfolge)', () => {
    const m = migrationsLaender()
    assert.equal(m.length, 249)
    assert.deepEqual(L.KAT_LAND.map(l => ({ ...l })), m)
  })
  test('27 EU-Staaten, Österreich dabei, Schweiz und Vereinigtes Königreich nicht', () => {
    assert.equal(L.KAT_LAND.filter(l => l.eu).length, 27)
    assert.equal(L.istEuLand('AT'), true)
    assert.equal(L.istEuLand('de'), true)
    assert.equal(L.istEuLand('CH'), false)
    assert.equal(L.istEuLand('GB'), false)
    assert.equal(L.istEuLand('XX'), false)
    assert.equal(L.istEuLand(null), false)
  })
  test('istLand und landName', () => {
    assert.equal(L.istLand('AT'), true)
    assert.equal(L.istLand('at'), false)
    assert.equal(L.istLand('UK'), false)
    assert.equal(L.landName('AT'), 'Österreich')
    assert.equal(L.landName('XX'), null)
    assert.equal(L.landAnzeige('XX'), 'XX')
    assert.equal(L.landAnzeige('CH'), 'Schweiz')
  })
  test('normalisiereLand: Codes, Sonderfälle, deutsche und englische Namen', () => {
    const faelle = {
      'AT': 'AT', ' at ': 'AT', 'UK': 'GB', 'uk': 'GB', 'EL': 'GR',
      'Österreich': 'AT', 'Oesterreich': 'AT', 'österreich': 'AT', 'Austria': 'AT', 'AUT': 'AT',
      'Deutschland': 'DE', 'Germany': 'DE', 'Schweiz': 'CH', 'Switzerland': 'CH',
      'Italien': 'IT', 'Italy': 'IT', 'USA': 'US', 'Vereinigte Staaten': 'US', 'United Kingdom': 'GB',
      'Großbritannien': 'GB', 'Grossbritannien': 'GB', 'Tschechische Republik': 'CZ', 'Czech Republic': 'CZ',
      'Südkorea': 'KR', 'Suedkorea': 'KR', 'South Korea': 'KR', 'Hongkong': 'HK', 'Türkei': 'TR',
      'Côte d’Ivoire': 'CI', 'Ålandinseln': 'AX', 'Niederlande': 'NL', 'Holland': 'NL',
    }
    for (const [ein, aus] of Object.entries(faelle)) assert.equal(L.normalisiereLand(ein), aus, ein)
    for (const ein of ['', '   ', null, undefined, 'XX', 'Atlantis', 'A', 'Kosovo'])
      assert.equal(L.normalisiereLand(ein), null, String(ein))
  })
  test('Jeder Katalogname wird auf seinen eigenen Code abgebildet', () => {
    for (const l of L.KAT_LAND) assert.equal(L.normalisiereLand(l.name), l.iso2, l.name)
  })
  test('landOptionen: häufige oben, Trenner, Rest alphabetisch; Altwert als „ungültig“', () => {
    const o = L.landOptionen('AT')
    assert.deepEqual(o.slice(0, 3).map(x => x.wert), ['AT', 'DE', 'CH'])
    assert.equal(o[0].label, 'Österreich (AT)')
    const t = o.findIndex(x => x.trenner)
    assert.equal(t, L.LAENDER_HAEUFIG.length)
    const rest = o.slice(t + 1).map(x => x.label)
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, 'de')))
    assert.equal(o.filter(x => !x.trenner).length, 249)
    const alt = L.landOptionen('XY')
    assert.deepEqual(alt[0], { wert: 'XY', label: 'XY (ungültig)', ungueltig: true })
    assert.equal(alt.filter(x => !x.trenner).length, 250)
  })
  test('BMD-Steuerfall nutzt den Katalog (Einordnung wie bisher)', () => {
    assert.equal(bmd.steuerfall(13, 'DE'), 'inland')
    assert.equal(bmd.steuerfall(0, null), 'steuerfrei')
    assert.equal(bmd.steuerfall(0, 'at'), 'steuerfrei')
    assert.equal(bmd.steuerfall(0, 'DE'), 'ig')
    assert.equal(bmd.steuerfall(0, 'hr'), 'ig')
    assert.equal(bmd.steuerfall(0, 'CH'), 'export')
    assert.equal(bmd.steuerfall(0, 'GB'), 'export')
    assert.equal(bmd.steuerfall(0, 'EL'), 'export')   // wie bisher: nur ISO-Codes zählen
  })
})
