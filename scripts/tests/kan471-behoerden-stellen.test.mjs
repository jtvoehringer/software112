// KAN-471 (16.11.2026, BKI-Sitzung): Behördenmeldungen nach der Stelle gliedern, die das Dokument verlangt
// (BKI, Bundesamt für Weinbau, AMA, Bio-Kontrollstelle …) statt nach Themengruppen.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'
import { KLAPP_SPEICHER, STELLEN, STELLE_JE_MELDUNG, nachStelle, offeneStellenAus, stelleKurz, stelleVon, stelleZaehler } from '../../src/lib/behoerden/stellen.ts'

hooksRegistrieren()
// der Katalog importiert seine Gruppen ohne Endung – nur über die Hooks des Testgerüsts ladbar
const KATALOG_LISTE = hooksMoeglich ? (await laden('lib/behoerden/katalog.ts')).KATALOG_LISTE : []

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-471: Zuordnung Meldung → Stelle', nurMitHooks, () => {
  test('jede Meldung des Katalogs hat genau eine bekannte Stelle, keine Zuordnung ohne Meldung', () => {
    const stellen = new Set(STELLEN.map(s => s.id))
    for (const e of KATALOG_LISTE) assert.ok(stellen.has(stelleVon(e.id)), `${e.id} ohne Stelle`)
    assert.deepEqual(Object.keys(STELLE_JE_MELDUNG).sort(), KATALOG_LISTE.map(e => e.id).sort())
    assert.equal(stelleVon('gibt-es-nicht'), null)
  })
  test('Stellen und Reihenfolge wie freigegeben', () => {
    assert.deepEqual(STELLEN.map(s => s.label), ['Bundeskellereiinspektion (BKI)', 'Bundesamt für Weinbau', 'AMA', 'Bio-Kontrollstelle',
      'Pflanzenschutz (Landwirtschaftskammer / Landesbehörde)', 'Finanzamt', 'Zoll', 'SVS'])
  })
  test('Zuordnung laut freigegebenem Plan (Stichproben je Stelle)', () => {
    const je = s => Object.entries(STELLE_JE_MELDUNG).filter(([, v]) => v === s).map(([k]) => k).sort()
    assert.deepEqual(je('bundesamt'), ['dac-antraege', 'pruefnummernantrag'])
    assert.deepEqual(je('ama'), ['flaechenverzeichnis', 'naehrstoffbilanz', 'naehrstoffbilanz-weingarten'])
    assert.deepEqual(je('bio'), ['cu-bilanz', 'cu-bilanz-behandlungen', 'rueckverfolgung-weingarten'])
    assert.deepEqual(je('pflanzenschutz'), ['psm-aufzeichnung', 'psm-mittelverbrauch', 'psm-uebermittlung'])
    assert.deepEqual(je('finanzamt'), ['anlagenverzeichnis', 'belegverzeichnis', 'ea-journal', 'kassabuch', 'rechnungsausgangsjournal', 'uva', 'zusammenfassende-meldung'])
    assert.deepEqual(je('zoll'), ['emcs-datenblatt', 'exportauftraege', 'exportauftrag'])
    assert.deepEqual(je('svs'), ['svs-einheitswerte'])
    for (const id of ['erntemeldung', 'lesedaten', 'bestandsmeldung', 'bsm', 'bki-traubenverkauf', 'transportbescheinigungen', 'weinbuch', 'gebindeverzeichnis', 'bki-lagerstand', 'aenderungsprotokoll']) {
      assert.equal(stelleVon(id), 'bki', id)
    }
    // alle Kellerbuch-Dokumente gehen an die BKI
    for (const e of KATALOG_LISTE.filter(e => e.gruppe === 'kellerbuch')) assert.equal(stelleVon(e.id), 'bki', e.id)
  })
})

describe('KAN-471: Gliederung der Übersicht', () => {
  const e = (id, pflicht = false) => ({ id, pflicht })
  test('Reihenfolge der Stellen, Pflichtmeldungen zuerst, sonst Reihenfolge der Eingabe; leere Stellen entfallen', () => {
    const g = nachStelle([e('uva'), e('weinbuch'), e('cu-bilanz', true), e('erntemeldung', true), e('kassabuch', true), e('lesedaten', true), e('gebindeverzeichnis')])
    assert.deepEqual(g.map(x => x.label), ['Bundeskellereiinspektion (BKI)', 'Bio-Kontrollstelle', 'Finanzamt'])
    assert.deepEqual(g[0].eintraege.map(x => x.id), ['erntemeldung', 'lesedaten', 'weinbuch', 'gebindeverzeichnis'])
    assert.deepEqual(g[2].eintraege.map(x => x.id), ['kassabuch', 'uva'])
  })
  test('jeder Eintrag steht genau einmal da – auch einer ohne Zuordnung (unter „Weitere“)', nurMitHooks, () => {
    const alle = KATALOG_LISTE.map(k => e(k.id, k.pflicht === true))
    const g = nachStelle([...alle, e('unbekannt')])
    assert.equal(g.reduce((s, x) => s + x.eintraege.length, 0), alle.length + 1)
    assert.deepEqual(g.at(-1), { gruppe: 'weitere', label: 'Weitere', eintraege: [e('unbekannt')] })
    assert.deepEqual(nachStelle([]), [])
  })
  test('Übersicht nutzt die Gliederung; beide Stellen der Oberfläche zeigen dieselbe Komponente', () => {
    const u = quelle('src/lib/behoerden/uebersicht.ts')
    assert.match(u, /return nachStelle\(erlaubt\.map\(e => \(\{/)
    assert.doesNotMatch(u, /GRUPPEN_LABEL/)
    assert.match(quelle('src/app/(dashboard)/dashboard/fristen/page.tsx'), /<BehoerdenUebersicht /)
    assert.match(quelle('src/app/(dashboard)/reports/ReportsClient.tsx'), /<BehoerdenUebersicht /)
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /gegliedert nach der Stelle, die das Dokument verlangt: Bundeskellereiinspektion \(BKI\)/)
  })
})

describe('KAN-471 Nebenbefund (19.11.2026): Stellen eingeklappt, Sprungleiste, Merken', () => {
  test('Sprungleiste: Kurzname je Stelle, sonst „Weitere“', () => {
    assert.deepEqual(STELLEN.map(s => s.kurz), ['BKI', 'Bundesamt', 'AMA', 'Bio', 'Pflanzenschutz', 'Finanzamt', 'Zoll', 'SVS'])
    assert.equal(stelleKurz('ama'), 'AMA')
    assert.equal(stelleKurz('weitere'), 'Weitere')
  })
  test('Zähler unter der Überschrift: Anzahl Dokumente, Pflicht nur wenn vorhanden', () => {
    assert.equal(stelleZaehler([{ pflicht: true }, { pflicht: false }, { pflicht: true }]), '3 Dokumente · 2 Pflicht')
    assert.equal(stelleZaehler([{ pflicht: false }]), '1 Dokument')
  })
  test('Gemerkte Stellen: nur vorhandene, kaputter oder fremder Wert = alle zu', () => {
    const da = ['bki', 'ama', 'bio']
    assert.deepEqual(offeneStellenAus(JSON.stringify(['ama', 'bio', 'zoll']), da), ['ama', 'bio'])
    assert.deepEqual(offeneStellenAus(null, da), [])
    assert.deepEqual(offeneStellenAus('{kaputt', da), [])
    assert.deepEqual(offeneStellenAus('"ama"', da), [])
    assert.deepEqual(offeneStellenAus(JSON.stringify({ ama: true }), da), [])
    assert.equal(KLAPP_SPEICHER, 's112.behoerden.offen')
  })
  test('Übersicht: jede Stelle eine Klappleiste ohne open (Ausgangszustand alle zu), Sprungleiste und Merken verdrahtet', () => {
    const u = quelle('src/components/behoerden/BehoerdenUebersicht.tsx')
    assert.ok(u.includes('<details key={g.gruppe} data-stelle={g.gruppe}'))
    const leiste = u.slice(u.indexOf('<details key={g.gruppe}'), u.indexOf('>', u.indexOf('<details key={g.gruppe}')))
    assert.ok(!/\bopen\b/.test(leiste), 'keine Stelle von Haus aus offen')
    assert.ok(u.includes('{stelleZaehler(g.eintraege)}'))
    assert.ok(u.includes('<BehoerdenKlappen stellen={gruppen.map(g => ({ gruppe: g.gruppe, kurz: stelleKurz(g.gruppe) }))}>'))
    const k = quelle('src/components/behoerden/BehoerdenKlappen.tsx')
    assert.ok(k.startsWith("'use client'"))
    assert.ok(k.includes('Alle aufklappen') && k.includes('Alle zuklappen'))
    // localStorage nur in try – privates Fenster bzw. gesperrter Speicher darf die Seite nicht brechen
    const zugriffe = k.split('\n').filter(z => z.includes('localStorage.') && !z.trim().startsWith('//'))
    assert.equal(zugriffe.length, 2)
    for (const z of zugriffe) assert.ok(z.includes('try {'), z)
    // beide Orte nutzen dieselbe Übersicht
    assert.ok(quelle('src/app/(dashboard)/reports/ReportsClient.tsx').includes('<BehoerdenUebersicht gruppen={behoerden} />'))
    assert.ok(quelle('src/app/(dashboard)/dashboard/fristen/page.tsx').includes('<BehoerdenUebersicht gruppen={behoerden} />'))
  })
})
