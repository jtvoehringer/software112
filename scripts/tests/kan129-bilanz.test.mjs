// KAN-129 Etappe 2: kg-Bilanz je Lese (serverseitig sperren), Zuordnung nach Datum, Stichtag 30.11. der
// Erntemeldung, CSV-Spalte „Lese“ (src/lib/wein/leseBilanz.ts, src/lib/behoerden/erntemeldung.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import { leseFuerDatum, leseOrtSchluessel, neueUeberdeckungen, ueberdeckungText, verfuegbarJeLese } from '../../src/lib/wein/leseBilanz.ts'

register('./ernte.aufloesung.mjs', import.meta.url)
const ernte = await import('../../src/lib/behoerden/erntemeldung.ts')

const z = (wg, gst, kg) => ({ weingarten_id: wg, grundstueck_id: gst, kg })

test('Bilanz: neue Pressung über die Lesemenge der Lese → gesperrt (GST zuerst)', () => {
  const ue = neueUeberdeckungen({
    gelesen: [z('w1', 'g1', 500), z('w1', 'g2', 300)],
    andere: [z('w1', 'g1', 400)],
    vorher: [],
    nachher: [z('w1', 'g1', 200)],
  })
  assert.equal(ue.length, 1)   // Ried: 800 gelesen, 600 verbraucht → frei; GST g1: 500 < 600
  assert.deepEqual([ue[0].art, ue[0].grundstueck_id, ue[0].gelesenKg, ue[0].verbrauchtKg], ['gst', 'g1', 500, 600])
  const text = ueberdeckungText(ue[0], new Map([['g1', { ried: 'Kaiserberg', gstNr: '1234/5' }]]), '2026/2')
  assert.match(text, /Von GST 1234\/5 \(Kaiserberg\) sind in der Lese 2026\/2 nur 500 kg gelesen – verpresst bzw\. als Trauben verkauft wären danach 600 kg/)
})

test('Bilanz: genau gedeckt, Toleranz, Ort ohne Lesemenge und Zukauf sperren nicht', () => {
  const gelesen = [z('w1', 'g1', 500), z('w2', null, null)]
  assert.deepEqual(neueUeberdeckungen({ gelesen, andere: [], vorher: [], nachher: [z('w1', 'g1', 500.005)] }), [])
  assert.deepEqual(neueUeberdeckungen({ gelesen, andere: [], vorher: [], nachher: [z('w2', null, 9999)] }), [], 'Menge NULL = noch keine Lesemenge')
  assert.deepEqual(neueUeberdeckungen({ gelesen, andere: [], vorher: [], nachher: [z('w3', 'g9', 50)] }), [], 'Ort ohne Eintrag')
  assert.deepEqual(neueUeberdeckungen({ gelesen, andere: [], vorher: [], nachher: [z(null, null, 5000)] }), [], 'Zukauf-Zeile')
})

test('Bilanz: bestehende Überdeckung blockiert nur eine Verschlechterung', () => {
  const basis = { gelesen: [z('w1', 'g1', 500)], andere: [z('w1', 'g1', 450)] }
  // Altdaten: bereits 450 + 100 = 550 > 500 – Menge bleibt oder sinkt → erlaubt
  assert.deepEqual(neueUeberdeckungen({ ...basis, vorher: [z('w1', 'g1', 100)], nachher: [z('w1', 'g1', 100)] }), [])
  assert.deepEqual(neueUeberdeckungen({ ...basis, vorher: [z('w1', 'g1', 100)], nachher: [z('w1', 'g1', 80)] }), [])
  // mehr → gesperrt
  assert.equal(neueUeberdeckungen({ ...basis, vorher: [z('w1', 'g1', 100)], nachher: [z('w1', 'g1', 120)] }).length, 2)
  // Umhängen auf einen anderen Ort: dort zählt die volle Menge
  assert.equal(neueUeberdeckungen({ gelesen: [z('w1', 'g1', 500), z('w1', 'g2', 50)], andere: [], vorher: [z('w1', 'g1', 100)], nachher: [z('w1', 'g2', 100)] })[0].grundstueck_id, 'g2')
})

test('Zuordnung nach Datum wie der Trigger a_lese_zuordnen', () => {
  const lesen = [
    { id: 'l1', lfd_nr: 1, beginn: null },
    { id: 'l2', lfd_nr: 2, beginn: '2027-01-10' },
  ]
  assert.equal(leseFuerDatum([lesen[0]], 2026, null)?.id, 'l1', 'eine Lese → diese, auch ohne Datum')
  assert.equal(leseFuerDatum(lesen, 2026, '2026-09-20')?.id, 'l1')
  assert.equal(leseFuerDatum(lesen, 2026, '2027-01-12')?.id, 'l2')
  assert.equal(leseFuerDatum(lesen, 2026, null), null)
  assert.equal(leseFuerDatum([{ id: 'a', lfd_nr: 1, beginn: '2026-09-01' }, { id: 'b', lfd_nr: 2, beginn: '2026-09-01' }], 2026, '2026-09-05')?.id, 'b', 'Gleichstand → höhere Nr.')
  assert.equal(leseFuerDatum([{ id: 'a', lfd_nr: 1, beginn: '2026-09-01' }, { id: 'b', lfd_nr: 2, beginn: '2026-10-01' }], 2026, '2026-08-01'), null)
})

test('Stichtag 30.11.: Lesegut danach nicht in der Erntemeldung, Hinweis je Rebsorte', () => {
  const zeile = (datum, kg, rebsorte = 'Grüner Veltliner') => ({ datum, mengeKg: kg, rebsorte, weingartenId: 'w1', grundstueckId: 'g1', grundstueckFlaecheHa: 1, weingartenFlaecheHa: null, mengeHl: null, qualitaetsstufe: 'eiswein' })
  const { bis, danach } = ernte.teileNachStichtag([zeile('2026-11-30', 100), zeile('2027-01-12', 800), zeile(null, 5)], 2026)
  assert.deepEqual(bis.map(x => x.mengeKg), [100, 5])
  assert.deepEqual(danach.map(x => x.mengeKg), [800])
  assert.match(ernte.stichtagHinweis(danach, 2026), /Nach dem Stichtag 30\.11\.2026 gelesen und in der Erntemeldung nicht enthalten \(gesondert auszuweisen\): Grüner Veltliner 800 kg\./)
  assert.equal(ernte.stichtagHinweis([], 2026), null)
})

test('Lesedaten-CSV: Spalte „Lese“ nach „Notizen“, danach nur die Storno-Spalten (KAN-148)', () => {
  const k = ernte.SPALTEN_LESEDATEN.map(s => s.kopf)
  assert.deepEqual(k.slice(-4), ['Notizen', 'Lese', 'Storniert am', 'Storno-Grund'])
})

const lies = p => fs.readFileSync(p, 'utf8')

test('Verdrahtung: Deckung in Pressung und beiden Traubenverkauf-Wegen, Stichtag in der AMA-Meldung', () => {
  const a = lies('src/app/(dashboard)/erntemeldung/actions.ts')
  assert.ok(a.includes('const deckung = await leseDeckungFehler('), 'upsertPressung')
  assert.ok(a.includes("if (!lesePressung) throw new AktionsFehler(LESE_WAEHLEN_MELDUNG)"))
  assert.ok(/traubenverkaufLese\([\s\S]{0,300}if \(lese\.fehler\) throw new AktionsFehler\(lese\.fehler\)[\s\S]{0,400}get_next_liefernummer/.test(a), 'createTraubenverkauf prüft vor der Liefernummer')
  assert.ok(a.includes("teileNachStichtag((await ladeLesedaten(supabase, jahrgangId)).zeilen"), 'createOrUpdateAMAMeldung')
  assert.ok(a.includes(".eq('lese_id', leseId).eq('weingarten_id', alt.weingarten_id)"), 'pruefeLesemengeGedeckt je Lese')
  const t = lies('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
  assert.ok(t.includes('const lese = await traubenverkaufLese(') && t.includes('lese_id:         lese.leseId,'), 'upsertTraubenverkauf')
})

test('Etappe 3: verfügbare kg je Lese und Ort – getrennt je Lese, Verpresstes und Verkauftes ab, Bearbeiten ohne eigene Menge', () => {
  const lz = (lese_id, wg, gst, kg) => ({ lese_id, weingarten_id: wg, grundstueck_id: gst, kg })
  const v = verfuegbarJeLese(
    [lz('l1', 'w1', 'g1', 1000), lz('l2', 'w1', 'g1', 300), lz('l1', 'w2', null, null)],
    [lz('l1', 'w1', 'g1', 400), { ...lz('l1', 'w1', 'g1', 100), verkauf_id: 'tv1' }, lz('l2', 'w1', 'g1', 500), lz(null, 'w1', 'g1', 50)],
  )
  assert.equal(v.gst.get(leseOrtSchluessel('l1', 'g1')), 500)
  assert.equal(v.ried.get(leseOrtSchluessel('l1', 'w1')), 500)
  assert.equal(v.gst.get(leseOrtSchluessel('l2', 'g1')), 0, 'nie negativ; Hauptlese-kg zählen nicht für die Eiswein-Lese')
  assert.equal(v.ried.has(leseOrtSchluessel('l1', 'w2')), false, 'Ort ohne Lesemenge erscheint nicht')
  const bearbeiten = verfuegbarJeLese([lz('l1', 'w1', 'g1', 1000)], [{ ...lz('l1', 'w1', 'g1', 100), verkauf_id: 'tv1' }], 'tv1')
  assert.equal(bearbeiten.gst.get(leseOrtSchluessel('l1', 'g1')), 1000)
})

test('Etappe 3: Weinhandel-Wege mit Lese (Traubenverkauf-Seite, Verkauf mit Trauben-Position, Stammdaten)', () => {
  const v = lies('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  assert.ok(v.includes('erg = await traubenverkaufLese(') && v.includes('lese_id:         leseJePosition[i],'))
  assert.ok(v.indexOf('await pruefePositionen(supabase, membership, positionen, datum)') < v.indexOf("get_next_liefernummer"), 'Prüfung vor Liefernummer')
  const r = lies('src/app/api/verkauf-stammdaten/route.ts')
  assert.ok(r.includes('const verfuegbar = verfuegbarJeLese(') && r.includes('pressung:pressung_id!inner(tenant_id, lese_id, storniert_am)'))
  const c = lies('src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx')
  assert.ok(c.includes("fd.set('lese_id', leseId)") && c.includes('const verfuegbar = verfuegbarJeLese('))
  const p = lies('src/app/(dashboard)/weinhandel/traubenverkauf/page.tsx')
  assert.ok(p.includes(".order('ernte_datum', { ascending: false, nullsFirst: false })"), 'N3: nach Lesedatum statt UUID')
})
