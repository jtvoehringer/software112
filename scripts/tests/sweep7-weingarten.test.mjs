// Sweep 7 (07.10.2026) – KAN-202 Wetterwarnungen über alle Ried-Punkte (ungünstigster Wert), KAN-147 Lese-Auswertung,
// KAN-172 Druck auch im Querformat.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ── KAN-202 ─────────────────────────────────────────────────────────────────────────────────────────────────
const HEUTE = new Date('2026-04-20T06:00:00Z')   // April: Frost- und Feuchte-Regeln aktiv
const stunden = (vonH, bisH, werte) => {
  const out = []
  for (let h = vonH; h < bisH; h++) out.push({ zeit: new Date(HEUTE.getTime() + h * 3600000).toISOString(), rr: 0, t2m: 10, rh2m: 60, wind_ms: 2, boe_ms: 4, ...werte(h) })
  return out
}
const punkt = (key, riedIds, rueck, prog) => ({ punkt: { key, lat: 48, lon: 16, riedIds }, rueckblick: rueck, prognose: prog, stand: HEUTE.toISOString(), prognoseStand: HEUTE.toISOString() })
const ried = (id, name, punktKey) => ({ id, name, ried: name, punktKey, letzteBehandlung: null, ernteFruehestens: null })
const EINST = { abwaschMm: 25, intervallTage: 14 }

describe('KAN-202: Wetter über alle Punkte', nurMitHooks, () => {
  const r = () => laden('lib/wetter/regeln.ts')
  test('Frost nur am kleineren Punkt: Warnung erscheint und nennt dessen Ried', async () => {
    const { werteWetterAus } = await r()
    const A = punkt('a', ['1', '2'], stunden(-72, 0, () => ({})), stunden(1, 48, () => ({ t2m: 6 })))
    const B = punkt('b', ['3'], stunden(-72, 0, () => ({})), stunden(1, 48, h => ({ t2m: h === 10 ? -1.5 : 4 })))
    const aus = werteWetterAus({ rieden: [ried('1', 'Ried A1', 'a'), ried('2', 'Ried A2', 'a'), ried('3', 'Ried B', 'b')], wetter: [A, B], heute: HEUTE, einst: EINST })
    const frost = aus.empfehlungen.find(e => e.key === 'wetter:frost')
    assert.ok(frost, 'Frostwarnung fehlt')
    assert.equal(frost.titel, 'Frostgefahr: -1.5 °C in den nächsten 48 h – Ried B')
    assert.equal(aus.prognose.tmin, -1.5)
  })
  test('ein Punkt: Texte wie bisher (ohne Riedliste, ohne Spanne)', async () => {
    const { werteWetterAus } = await r()
    const A = punkt('a', ['1'], stunden(-72, 0, () => ({ rr: 0.5 })), stunden(1, 48, () => ({ t2m: -1, boe_ms: 20 })))
    const aus = werteWetterAus({ rieden: [ried('1', 'Ried A', 'a')], wetter: [A], heute: HEUTE, einst: EINST })
    assert.equal(aus.empfehlungen.find(e => e.key === 'wetter:frost').titel, 'Frostgefahr: -1 °C in den nächsten 48 h')
    assert.equal(aus.empfehlungen.find(e => e.key === 'wetter:sturm').titel, 'Sturmböen bis 72 km/h')
    assert.equal(aus.regenSpanne, undefined)
  })
  test('Regen: ungünstigster Wert und Spanne; Sturm nur an einem Punkt', async () => {
    const { werteWetterAus } = await r()
    const A = punkt('a', ['1'], stunden(-72, 0, () => ({ rr: 0 })), stunden(1, 48, () => ({})))
    const B = punkt('b', ['2'], stunden(-72, 0, h => ({ rr: h >= -10 ? 1.8 : 0 })), stunden(1, 48, h => ({ boe_ms: h === 5 ? 18 : 4 })))
    const aus = werteWetterAus({ rieden: [ried('1', 'Ried A', 'a'), ried('2', 'Ried B', 'b')], wetter: [A, B], heute: HEUTE, einst: EINST })
    assert.equal(aus.regen72h, 18)
    assert.deepEqual(aus.regenSpanne.regen72h, [0, 18])
    assert.equal(aus.empfehlungen.find(e => e.key === 'wetter:sturm').titel, 'Sturmböen bis 65 km/h – Ried B')
  })
  test('Spritzfenster nur, wenn es an allen Punkten passt', async () => {
    const { schlechtesteStunden, spritzfensterAus } = await r()
    const ruhig = stunden(1, 30, () => ({}))
    const windig = stunden(1, 30, () => ({ wind_ms: 8 }))
    assert.ok(spritzfensterAus(schlechtesteStunden([ruhig]), HEUTE).length > 0)
    assert.equal(spritzfensterAus(schlechtesteStunden([ruhig, windig]), HEUTE).length, 0)
    const zusammen = schlechtesteStunden([ruhig, windig])
    assert.equal(zusammen[0].wind_ms, 8)
  })
  test('Anzeige: Spanne beim Regen im Morgenbericht', () => {
    assert.match(quelle('src/app/(dashboard)/dashboard/morgenbericht/MorgenberichtKarte.tsx'), /w\.regenSpanne\?\.regen24h \?/)
  })
})

// ── KAN-147 ─────────────────────────────────────────────────────────────────────────────────────────────────
const z = (x) => ({ weingartenId: 'W1', ried: 'Kellerberg', rebsorte: 'Grüner Veltliner', datum: '2026-09-20', mengeKg: 1000, mengeHl: 7, kmw: 18, qualitaetsstufe: 'qualitaetswein', ...x })

describe('KAN-147: Lese-Auswertung', nurMitHooks, () => {
  const a = () => laden('lib/wein/leseAuswertung.ts')
  test('Ertrag je Ried mit kg/ha und Abstand zum Höchstertrag (nur Stufen ab Landwein)', async () => {
    const { ertragJeRied } = await a()
    const zeilen = [z({}), z({ mengeKg: 500, qualitaetsstufe: 'wein' }), z({ weingartenId: 'W2', ried: 'Altenberg', mengeKg: 9000 })]
    const e = ertragJeRied(zeilen, [{ id: 'W1', name: 'Kellerberg', flaecheHa: 0.5 }, { id: 'W2', name: 'Altenberg', flaecheHa: 0.8 }], 10000, s => s !== 'wein')
    assert.deepEqual(e.map(x => x.ried), ['Altenberg', 'Kellerberg'])
    const k = e.find(x => x.ried === 'Kellerberg')
    assert.equal(k.kg, 1500)
    assert.equal(k.kgHa, 3000)
    assert.equal(k.kgHaHoechstertrag, 2000)
    assert.equal(k.abstandKgHa, 8000)
    assert.equal(e.find(x => x.ried === 'Altenberg').abstandKgHa, -1250)   // überschritten
  })
  test('Mostgewicht je Sorte und Ried: kg-gewichtet über °KMW, Min/Max, Stufen', async () => {
    const { mostgewichtJeSorte } = await a()
    const m = mostgewichtJeSorte([z({ mengeKg: 500, kmw: 14 }), z({ mengeKg: 500, kmw: 22, qualitaetsstufe: 'kabinett' }), z({ rebsorte: 'Riesling', kmw: null })])
    const gv = m.find(x => x.rebsorte === 'Grüner Veltliner')
    assert.equal(gv.kmw, 18)
    assert.equal(gv.oechsle, 88.8)   // nie das °Oe-Mittel (89,2)
    assert.deepEqual([gv.kmwMin, gv.kmwMax], [14, 22])
    assert.deepEqual(gv.stufen, { qualitaetswein: 500, kabinett: 500 })
    assert.equal(m.find(x => x.rebsorte === 'Riesling').kmw, null)
  })
  test('Lesefortschritt: gelesene/offene Rieden, Tagesmengen kumuliert', async () => {
    const { lesefortschritt } = await a()
    const f = lesefortschritt([z({ datum: '2026-09-22', mengeKg: 300 }), z({ datum: '2026-09-20' })],
      [{ id: 'W1', name: 'Kellerberg', flaecheHa: 0.5 }, { id: 'W3', name: 'Zwerchbreiten', flaecheHa: 1.5 }])
    assert.deepEqual([f.riedenGelesen, f.riedenGesamt, f.flaecheGelesenHa, f.flaecheGesamtHa], [1, 2, 0.5, 2])
    assert.deepEqual(f.offen, ['Zwerchbreiten'])
    assert.deepEqual(f.tage, [{ datum: '2026-09-20', kg: 1000, kumuliert: 1000 }, { datum: '2026-09-22', kg: 300, kumuliert: 1300 }])
  })
  test('Vorjahresvergleich je Sorte und kg/ha', async () => {
    const { vorjahresvergleich, kgJeHa } = await a()
    const v = vorjahresvergleich([{ jahrgang: 2026, zeilen: [z({})] }, { jahrgang: 2025, zeilen: [z({ mengeKg: 800, kmw: 17 }), z({ rebsorte: 'Riesling' })] }])
    assert.deepEqual(v.find(x => x.rebsorte === 'Grüner Veltliner').jahre, { 2026: { kg: 1000, kmw: 18 }, 2025: { kg: 800, kmw: 17 } })
    assert.equal(v.find(x => x.rebsorte === 'Riesling').jahre[2026], undefined)
    assert.equal(kgJeHa([z({})], 0.5), 2000)
    assert.equal(kgJeHa([z({})], 0), null)
  })
  test('Seite: dieselbe Ladefunktion ohne Stornierte, Link von der Lese-Seite, CSV über csvText', () => {
    const p = quelle('src/app/(dashboard)/erntemeldung/[id]/auswertung/page.tsx')
    assert.match(p, /ladeLesedaten\(supabase, id\)/)
    assert.doesNotMatch(p, /mitStornierten/)
    assert.match(p, /\.eq\('id', id\)\)\.maybeSingle\(\)/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx'), /href=\{`\/erntemeldung\/\$\{id\}\/auswertung`\}/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/auswertung/LeseAuswertungCsv.tsx'), /csvText\(ertrag, SPALTEN_ERTRAG\)/)
  })
})

// ── KAN-172 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('KAN-172: Druck im Querformat', nurMitHooks, () => {
  test('globale Druckvorgabe ohne festes Format, Knopf gibt Hoch/Quer vor', async () => {
    const css = quelle('src/app/globals.css')
    const page = css.slice(css.indexOf('@page {'), css.indexOf('}', css.indexOf('@page {')))
    assert.doesNotMatch(page, /size:/)
    const { druckStil } = await laden('lib/druck.ts')
    assert.equal(druckStil('quer'), '@media print { @page { size: A4 landscape; } }')
    assert.equal(druckStil('hoch'), '@media print { @page { size: A4 portrait; } }')
    for (const f of ['src/app/(dashboard)/reports/PrintButton.tsx', 'src/app/(dashboard)/kellerbuch/_behoerden/DruckKnopf.tsx',
      'src/app/(dashboard)/kellerbuch/weinausbau/[id]/buch/PrintButton.tsx', 'src/app/(dashboard)/kellerbuch/rueckverfolgung/PrintButton.tsx']) {
      assert.match(quelle(f), /<DruckFormatKnopf/, f)
    }
  })
})
