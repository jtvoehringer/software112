// KAN-473 (16.11.2026, BKI-Sitzung): Bestandsmeldung im Aufbau des BKI-Formulars „Bestandsmeldung“.
// Geprüft wird die Umrechnung der BSM-Summen (je Herkunft und Buchungsart) in die neun Spalten und die Zeilen des
// Formulars: Zuordnung jeder Buchungsart zu höchstens einer Zeile, EU und Drittland als je eine Spalte, ganze Liter,
// Summen aus den gerundeten Zellen, Abstimmzeile als Rest, Beitrag nur über 3.000 Liter verkaufter Menge.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const m = hooksMoeglich ? await laden('lib/behoerden/bsmFormular.ts') : null
const kat = hooksMoeglich ? await laden('lib/katalog/bki.ts') : null

const Z = { von: '2026-08-01', bis: '2027-07-31' }
const leer = () => ({ most_sturm: 0, wein: 0, rebsortenwein: 0, landwein: 0, qualitaetswein: 0, praedikatswein: 0, perl_schaumwein: 0, sonstige: 0, ohne: 0 })
const S = (position, werte, { herkunft = 'AT', teil = 'gesamt' } = {}) => ({ ...Z, herkunft, position, bezeichnung: position, abschnitt: 'x', teil, werte: { ...leer(), ...werte }, summeLiter: 0, summeHl: 0 })
const zeile = (f, key) => f.zeilen.find(z => z.key === key)

// Beispieljahr: 10.000 l Qualitätswein + 2.000 l Landwein Anfang; Ernte 8.000 l QUW; Flaschenverkauf 5.000 l, Fass AT 1.000 l,
// Abwertung 500 l QUW → Landwein; Schwund 100 l; Verschnitt verschiebt 300 l (nicht im Formular)
const BEISPIEL = [
  S('ANFANG', { qualitaetswein: 10000, landwein: 2000 }),
  S('ERNTE', { qualitaetswein: 8000 }),
  S('ZU_ABW', { landwein: 500 }), S('AB_ABW', { qualitaetswein: 500 }),
  S('VK_FL_AT', { qualitaetswein: 4000 }), S('VK_FL_AU', { qualitaetswein: 1000 }), S('VK_FA_AT', { landwein: 1000 }),
  S('SCHWUND', { qualitaetswein: 100 }),
  S('VS_AB', { qualitaetswein: 300 }), S('VS_ZU', { landwein: 300 }),
  S('ENDE', { qualitaetswein: 12100, landwein: 1800 }),
  S('STICHTAG', { qualitaetswein: 12100, landwein: 1800 }),
  S('STICHTAG', { qualitaetswein: 9000, landwein: 800 }, { teil: 'davon weiß' }),
  S('STICHTAG', { qualitaetswein: 3100, landwein: 1000 }, { teil: 'davon rot (inkl. Rosé)' }),
  // „davon“-Zeilen der Buchungsarten dürfen nicht doppelt zählen
  S('ERNTE', { qualitaetswein: 8000 }, { teil: 'davon weiß' }),
]

describe('KAN-473: Spalten und Zuordnung', nurMitHooks, () => {
  test('neun Spalten wie am Formular', () => {
    assert.deepEqual(m.BSM_FORMULAR_SPALTEN.map(s => s.label), ['Wein und Sturm', 'Wein mit Sorte und Jahrgang', 'Landwein', 'Qualitätswein', 'Prädikatswein',
      'Perlwein und Schaumwein', 'Erzeugnisse aus anderen EU-Staaten u. EU-Verschnitt', 'Wein aus Drittländern', 'Sonstige Erzeugnisse'])
  })
  test('Österreich nach Qualität, EU und Drittland je eine Spalte, ohne Zuordnung unter „Sonstige“', () => {
    assert.equal(m.formularSpalte('AT', 'most_sturm'), 'wein_sturm')
    assert.equal(m.formularSpalte('AT', 'wein'), 'wein_sturm')
    assert.equal(m.formularSpalte('AT', 'rebsortenwein'), 'sorte')
    assert.equal(m.formularSpalte('AT', 'perl_schaumwein'), 'perl_schaum')
    assert.equal(m.formularSpalte('AT', 'ohne'), 'sonstige')
    for (const s of ['wein', 'qualitaetswein', 'praedikatswein', 'sonstige']) {
      assert.equal(m.formularSpalte('EU', s), 'eu')
      assert.equal(m.formularSpalte('DRITT', s), 'drittland')
    }
  })
  test('jede Buchungsart höchstens in einer Formularzeile; Verkauf, Zukauf, Abwertung und Schwund sind zugeordnet', () => {
    const alle = Object.values(m.BSM_FORMULAR_ZUORDNUNG).flat()
    assert.equal(new Set(alle).size, alle.length)
    const bekannt = new Set(kat.KAT_BUCHUNGSART.map(b => b.code))
    for (const c of alle) assert.ok(bekannt.has(c), `${c} ist keine Buchungsart des Katalogs`)
    for (const c of ['ERNTE', 'ZK_FASS', 'ZK_FLA', 'ZU_ABW', 'AB_ABW', 'VK_FA_AT', 'VK_FA_AU', 'VK_FL_AT', 'VK_FL_AU', 'SCHWUND']) assert.ok(alle.includes(c), c)
    // ohne Formularzeile (Abstimmzeile): Verschnitt, Behandlung, Verarbeitung
    for (const c of ['VS_ZU', 'VS_AB', 'ZU_BEH', 'AB_VERAR']) assert.ok(!alle.includes(c), c)
  })
  test('Zeilen in der Reihenfolge des Formulars', () => {
    assert.deepEqual(m.BSM_FORMULAR_ZEILEN.map(z => z.bezeichnung), ['Bestand lt. letzter Meldung', 'Ernte und Fasszukauf', 'Flaschenzukauf', 'abgewerteter Wein', 'Summe Zugang',
      'Fassverkauf in Österreich', 'Fassverkauf ins Ausland', 'Flaschenverkauf', 'abgewerteter Wein', 'Eigenverbrauch u. Schwund', 'Summe Abgang',
      'Sonstige Veränderungen (nicht im Formular)', 'Summe neuer Bestand', 'davon weiß', 'davon rot/rosé'])
  })
})

describe('KAN-473: Beispieljahr', nurMitHooks, () => {
  const f = m ? m.bsmFormular(BEISPIEL, Z) : null
  test('Zellen je Zeile und Spalte', () => {
    assert.deepEqual([zeile(f, 'bestand_alt').werte.qualitaetswein, zeile(f, 'bestand_alt').werte.landwein], [10000, 2000])
    assert.equal(zeile(f, 'ernte_fass').werte.qualitaetswein, 8000, '„davon“-Zeilen zählen nicht doppelt')
    assert.equal(zeile(f, 'abw_zu').werte.landwein, 500)
    assert.equal(zeile(f, 'abw_ab').werte.qualitaetswein, 500)
    assert.equal(zeile(f, 'flaschenverkauf').werte.qualitaetswein, 5000, 'Österreich und Ausland zusammen')
    assert.equal(zeile(f, 'fass_at').werte.landwein, 1000)
    assert.equal(zeile(f, 'schwund').werte.qualitaetswein, 100)
    assert.deepEqual([zeile(f, 'summe_zugang').summe, zeile(f, 'summe_abgang').summe], [8500, 6600])
  })
  test('je Spalte: alter Bestand + Zugang − Abgang + sonstige Veränderungen = neuer Bestand', () => {
    for (const s of m.BSM_FORMULAR_SPALTEN.map(s => s.key)) {
      const w = k => zeile(f, k).werte[s]
      assert.equal(w('bestand_alt') + w('summe_zugang') - w('summe_abgang') + w('sonstige_veraenderung'), w('bestand_neu'), s)
    }
    // der Verschnitt (300 l von Qualitätswein nach Landwein) steht nur in der Abstimmzeile
    assert.deepEqual([zeile(f, 'sonstige_veraenderung').werte.qualitaetswein, zeile(f, 'sonstige_veraenderung').werte.landwein], [-300, 300])
    assert.equal(zeile(f, 'sonstige_veraenderung').summe, 0)
  })
  test('neuer Bestand = Bestand zum Stichtag; davon weiß + davon rot/rosé = Summe', () => {
    assert.equal(zeile(f, 'bestand_neu').summe, 13900)
    assert.equal(zeile(f, 'davon_weiss').summe + zeile(f, 'davon_rot').summe, 13900)
    assert.ok(!f.warnungen.some(w => /keine Farbe/.test(w)))
    assert.ok(f.warnungen.some(w => /Sonstige Veränderungen/.test(w)))
  })
  test('Beitrag: verkaufte Menge (Fass + Flasche) 6.000 l beitragspflichtig (ohne €, KAN-483); bis 3.000 l kein Beitrag', () => {
    assert.deepEqual(f.beitrag, { pflichtig: true, mengeLiter: 6000 })
    assert.equal(m.bsmFormular([S('VK_FL_AT', { qualitaetswein: 3000 })], Z).beitrag.pflichtig, false)
  })
})

describe('KAN-473: Rundung, Herkunft, Farbe', nurMitHooks, () => {
  test('erst summieren, dann auf ganze Liter; Summe = Summe der gerundeten Zellen', () => {
    const f = m.bsmFormular([S('ANFANG', { wein: 0.4, most_sturm: 0.4, landwein: 10.5 }), S('STICHTAG', { wein: 0.4, most_sturm: 0.4, landwein: 10.5 })], Z)
    assert.deepEqual([zeile(f, 'bestand_alt').werte.wein_sturm, zeile(f, 'bestand_alt').werte.landwein, zeile(f, 'bestand_alt').summe], [1, 11, 12])
  })
  test('EU-Wein und Drittlandwein in ihrer Spalte, unabhängig von der Qualität', () => {
    const f = m.bsmFormular([S('ZK_FASS', { qualitaetswein: 700, wein: 300 }, { herkunft: 'EU' }), S('ZK_FLA', { wein: 50 }, { herkunft: 'DRITT' }), S('STICHTAG', { qualitaetswein: 700, wein: 300 }, { herkunft: 'EU' }), S('STICHTAG', { wein: 50 }, { herkunft: 'DRITT' })], Z)
    assert.equal(zeile(f, 'ernte_fass').werte.eu, 1000)
    assert.equal(zeile(f, 'flaschenzukauf').werte.drittland, 50)
    assert.deepEqual([zeile(f, 'bestand_neu').werte.eu, zeile(f, 'bestand_neu').werte.drittland, zeile(f, 'bestand_neu').werte.qualitaetswein], [1000, 50, 0])
  })
  test('Bestand ohne Farbe → Hinweis; leere BSM → lauter Nullen, kein Beitrag', () => {
    const f = m.bsmFormular([S('STICHTAG', { landwein: 100 }), S('ANFANG', { landwein: 100 })], Z)
    assert.match(f.warnungen.join(' '), /100 l des neuen Bestands haben keine Farbe/)
    const l = m.bsmFormular([], Z)
    assert.equal(l.zeilen.length, 15)
    assert.ok(l.zeilen.every(z => z.summe === 0))
    assert.deepEqual(l.warnungen, [])
    assert.equal(l.beitrag.pflichtig, false)
  })
})

describe('KAN-473: CSV und Verdrahtung', nurMitHooks, () => {
  test('CSV: Zeitraum, Abschnitt, Zeile, neun Spalten in Litern, Summe – ganze Liter', () => {
    assert.deepEqual(m.SPALTEN_BSM_FORMULAR.map(s => s.kopf), ['Zeitraum von', 'Zeitraum bis', 'Abschnitt', 'Zeile', ...m.BSM_FORMULAR_SPALTEN.map(s => `${s.label} (l)`), 'Summe (l)'])
    assert.ok(m.SPALTEN_BSM_FORMULAR.slice(4).every(s => s.typ === 'ganzzahl'))
    const z = zeile(m.bsmFormular(BEISPIEL, Z), 'flaschenverkauf')
    assert.deepEqual(m.SPALTEN_BSM_FORMULAR.map(s => s.wert(z)), ['2026-08-01', '2027-07-31', 'Abgang', 'Flaschenverkauf', 0, 0, 0, 5000, 0, 0, 0, 0, 0, 5000])
  })
  test('Register und Druckseite nutzen dieselbe Umrechnung; das Kontrolljournal bleibt', () => {
    const r = quelle('src/lib/behoerden/register/ernte.ts')
    assert.match(r, /const formular = bsmFormular\(daten\.summen, \{ von: p\.von, bis: p\.bis \}\)/)
    assert.match(r, /spalten: SPALTEN_BSM_FORMULAR,/)
    assert.match(r, /spalten: SPALTEN_BSM_JOURNAL,/)
    const p = quelle('src/app/(dashboard)/reports/(pflicht)/bestandsmeldung-bsm/page.tsx')
    assert.match(p, /const formular = bsmFormular\(daten\.summen, zeitraum\)/)
    assert.match(p, /<BsmFormularTabelle formular=\{formular\} konzentrate=\{konzentrate\}/)
    assert.match(p, /csvPfad\('bsm-kontrolljournal'/)
  })
})
