// KAN-81 (04.10.2026): Abstufen bei Lese und Pressung – Qualitätsstufe und Herkunft bis zur Obergrenze wählbar.
// Entscheidungen Jörgen: die abgestufte Stufe geht so in die Erntemeldung; die Sammelerfassung hat gemeinsame Felder
// „Abstufen auf“ (jede Zeile höchstens bis zu ihrer Obergrenze). Die Pressung übernimmt höchstens die niedrigste Stufe
// der verpressten Lese-Einträge.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const la = hooksMoeglich ? await laden('lib/wein/leseAbstufung.ts') : null

describe('KAN-81 Stufe an der Lese', nurMitHooks, () => {
  test('Obergrenze aus den °KMW, ohne Mostgewicht Qualitätswein, Eiswein-Lese = Eiswein', () => {
    assert.equal(la.leseObergrenze(null, 19.4), 'spaetlese')
    assert.equal(la.leseObergrenze('hauptlese', null), 'qualitaetswein')
    assert.equal(la.leseObergrenze('eiswein', 26), 'eiswein')
  })
  test('Auswahl: nur Stufen bis zur Obergrenze, Obergrenze zuerst, bis hinunter zu „Wein“', () => {
    const o = la.leseStufenOptionen('spaetlese').map(x => x.value)
    assert.equal(o[0], 'spaetlese')
    assert.ok(o.includes('wein') && o.includes('landwein') && o.includes('kabinett'))
    assert.ok(!o.includes('auslese') && !o.includes('eiswein'))
  })
  test('Server: jede niedrigere Stufe zulässig, höhere abgelehnt', () => {
    assert.equal(la.leseStufeFehler('wein', 'spaetlese'), null)
    assert.equal(la.leseStufeFehler('spaetlese', 'spaetlese'), null)
    assert.equal(la.leseStufeFehler(null, 'kabinett'), null)
    assert.match(la.leseStufeFehler('auslese', 'kabinett'), /liegt über „Kabinett“ .* nur Abstufen ist möglich/)
  })
  test('Sammelerfassung: „Abstufen auf“ höchstens bis zur Obergrenze der Zeile', () => {
    assert.equal(la.leseStufeGedeckelt('spaetlese', 'kabinett'), 'kabinett')
    assert.equal(la.leseStufeGedeckelt('qualitaetswein', 'kabinett'), 'qualitaetswein')   // Zeile darunter: bleibt
    assert.equal(la.leseStufeGedeckelt('auslese', null), 'auslese')
    assert.equal(la.leseStufeGedeckelt('eiswein', 'landwein'), 'landwein')
  })
  test('Hinweis „abgestuft von …“', () => {
    assert.equal(la.abgestuftVon('kabinett', 'spaetlese', 'stufe'), 'abgestuft von Spätlese')
    assert.equal(la.abgestuftVon('spaetlese', 'spaetlese', 'stufe'), null)
    assert.equal(la.abgestuftVon('wlnoe', 'kremstal_riedenwein', 'herkunft'), 'abgestuft von Kremstal DAC – Riedenwein')
  })
})

describe('KAN-81 Herkunft an der Lese', nurMitHooks, () => {
  test('wählbar: Obergrenze und breitere Stufen im selben Ast', () => {
    const o = la.leseHerkunftOptionen('kremstal_riedenwein').map(x => x.value)
    assert.deepEqual(o, ['kremstal_riedenwein', 'kremstal_ortswein', 'kremstal_gebietswein', 'wlnoe', 'weinland', 'wein'])
    assert.deepEqual(la.leseHerkunftOptionen(null), [])
  })
  test('Server: breiter erlaubt, anderer Ast bzw. ohne Code abgelehnt', () => {
    assert.equal(la.leseHerkunftFehler('wlnoe', 'kremstal_riedenwein'), null)
    assert.equal(la.leseHerkunftFehler(null, 'kremstal_riedenwein'), null)
    assert.match(la.leseHerkunftFehler('kamptal_gebietswein', 'kremstal_riedenwein', 'GST 123'), /für GST 123 nicht zulässig – höchstens „Kremstal DAC – Riedenwein“/)
    assert.match(la.leseHerkunftFehler('wlnoe', 'wein'), /nicht zulässig/)   // Aufstufen
    assert.match(la.leseHerkunftFehler('wlnoe', null), /kein Herkunfts-Code hinterlegt/)
  })
  test('Sammelerfassung: nur gemeinsam zulässige Herkünfte', () => {
    const o = la.gemeinsameHerkunftOptionen(['kremstal_riedenwein', 'kamptal_gebietswein']).map(x => x.value)
    assert.deepEqual(o, ['wlnoe', 'weinland', 'wein'])
    assert.deepEqual(la.gemeinsameHerkunftOptionen(['kremstal_riedenwein', null]), [])
  })
})

describe('KAN-81 Obergrenze der Pressung aus der Lese', nurMitHooks, () => {
  const e = (wg, gst, datum, stufe) => ({ weingarten_id: wg, grundstueck_id: gst, ernte_datum: datum, qualitaetsstufe: stufe })
  const eintraege = [
    e('w1', 'g1', '2026-09-20', 'kabinett'),
    e('w1', 'g1', '2026-10-10', 'spaetlese'),
    e('w2', 'g2', '2026-09-22', 'landwein'),   // an der Lese abgestuft
  ]
  test('gleicher Ort und Lesetag: dessen Stufe; ohne Lesetag die niedrigste des Orts', () => {
    assert.equal(la.leseStufeFuerZeile(eintraege, { weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-10-10' }), 'spaetlese')
    assert.equal(la.leseStufeFuerZeile(eintraege, { weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: null }), 'kabinett')
    assert.equal(la.leseStufeFuerZeile(eintraege, { weingarten_id: 'w9', grundstueck_id: null }), null)
  })
  test('Pressung aus einer abgestuften Lese: niedrigste Stufe der Zeilen', () => {
    assert.equal(la.pressungLeseGrenze(eintraege, [
      { weingarten_id: 'w1', grundstueck_id: 'g1', ernte_datum: '2026-10-10' },
      { weingarten_id: 'w2', grundstueck_id: 'g2', ernte_datum: '2026-09-22' },
    ]), 'landwein')
    assert.equal(la.pressungLeseGrenze(eintraege, []), null)
  })
})

describe('KAN-81 Verdrahtung', () => {
  const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  test('Einzel-Lese: Stufe und Herkunft serverseitig geprüft (unveränderter Altwert ohne Prüfung)', () => {
    const f = a.slice(a.indexOf('export async function upsertErnteParzelle'), a.indexOf('// ── Lesemenge gegen Verpresstes'))
    assert.match(f, /const f = leseStufeFehler\(qualitaetsstufe, leseObergrenze\(lese\?\.art, kmw\)\)/)
    assert.match(f, /if \(qualitaetsstufe && !\(alt && qualitaetsstufe === \(\(alt\.qualitaetsstufe as string \| null\) \?\? null\)\)\)/)
    assert.match(f, /leseHerkunftFehler\(herkunftWahl, leseHerkunftObergrenze\(gstHerkunft, gstRebsorte\)\.code\)/)
  })
  test('Sammelerfassung: gemeinsame Felder, Assistenten-Feld qualitaetsstufe bleibt unbeachtet', () => {
    assert.match(a, /const perQualitaet = leseStufeGedeckelt\(leseStufe\(leseWirksam\?\.art, perMg \? kmwZuQualitaet\(perMg\.kmw\) : qualitaet\), abstufenAuf\)/)
    assert.match(a, /formData\.get\('abstufen_auf'\)/)
    assert.match(a, /leseHerkunftFehler\(herkunftAbstufenAuf, passend\.code, `GST /)
  })
  test('Pressung: Lese-Stufen begrenzen Prüfung und neue Charge', () => {
    assert.match(a, /const leseGrenze = pressungLeseGrenze\(\(leseStufenRows \?\? \[\]\) as LeseStufenEintrag\[\], weingaerten\.filter\(w => !w\.zukauf_posten_id\)\)/)
    assert.match(a, /qualitaetsstufe: qualitaetsstufeInput \?\? pressungGrenze \}/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx'), /const leseGrenze = pressungLeseGrenze\(/)
  })
  test('Formulare: Auswahl bis zur Obergrenze', () => {
    const c = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    assert.match(c, /mitGespeichertemWert\(leseStufenOptionen\(derivedQualitaetEdit\), parzelle\?\.qualitaetsstufe\)/)
    assert.match(c, /name="herkunft_code"/)
    assert.match(c, /name="abstufen_auf"/)
    assert.match(c, /name="herkunft_abstufen_auf"/)
  })
})
