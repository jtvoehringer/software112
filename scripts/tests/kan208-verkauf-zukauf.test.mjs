// KAN-208 (05.10.2026): Verkauf, Füllung, Zukauf – Kunde/Lieferant mit Betriebsnummer, Prüfnummer vor dem Flaschenverkauf,
// Zukauf-Merkmale nach Folgebuchung fest. Entscheidungen Jörgen (05.10.2026): Kunde nur bei Tank/Trauben Pflicht,
// Flaschenverkauf ab Qualitätswein ohne zugeteilte Prüfnummer wird abgelehnt. Matrix KAN-85; DB-Test 36.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const r = hooksMoeglich ? await laden('lib/handel/partnerPflicht.ts') : null

describe('KAN-208 Regeln', nurMitHooks, () => {
  test('Kunde: nur bei Tank/Trauben Pflicht, dann mit Betriebsnummer; Flasche ohne Kunde erlaubt', () => {
    assert.equal(r.verkaufKundeFehler({ typen: ['flasche', 'sonstiges'], kunde: false, betriebNr: null }), null)
    assert.match(r.verkaufKundeFehler({ typen: ['flasche', 'tank'], kunde: false, betriebNr: null }), /Kunde Pflicht/)
    assert.match(r.verkaufKundeFehler({ typen: ['trauben'], kunde: true, betriebNr: ' ', kundeName: 'Weingut X' }), /„Weingut X“ eine Betriebsnummer/)
    assert.equal(r.verkaufKundeFehler({ typen: ['tank'], kunde: true, betriebNr: '1234567' }), null)
  })
  test('Prüfnummer: ab Qualitätswein, Zusatz oder Sekt; zugeteilt, erloschen, aufgebraucht oder freie Nummer genügen', () => {
    assert.equal(r.fuellungBrauchtPruefnummer({ qualitaet: 'landwein' }), false)
    assert.equal(r.fuellungBrauchtPruefnummer({ qualitaet: 'wein', erzeugnis: 'perlwein' }), false)
    assert.equal(r.fuellungBrauchtPruefnummer({ qualitaet: 'qualitaetswein' }), true)
    assert.equal(r.fuellungBrauchtPruefnummer({ qualitaet: 'spaetlese' }), true)
    assert.equal(r.fuellungBrauchtPruefnummer({ qualitaet: 'dac' }), true)
    assert.equal(r.fuellungBrauchtPruefnummer({ qualitaet: null, erzeugnis: 'sekt' }), true)
    const basis = { name: 'GV Kremstal', qualitaet: 'qualitaetswein' }
    assert.match(r.flaschePruefnummerFehler({ ...basis, pruefnummer: null }), /„GV Kremstal“ hat noch keine zugeteilte staatliche Prüfnummer/)
    assert.match(r.flaschePruefnummerFehler({ ...basis, pruefnummer: 'N 1/26', antragStatus: 'eingereicht' }), /keine zugeteilte/)
    assert.match(r.flaschePruefnummerFehler({ ...basis, pruefnummer: 'N 1/26', antragStatus: 'entzogen' }), /keine zugeteilte/)
    for (const s of ['genehmigt', 'erloschen', 'aufgebraucht', null]) {
      assert.equal(r.flaschePruefnummerFehler({ ...basis, pruefnummer: 'N 1/26', antragStatus: s }), null, String(s))
    }
    assert.equal(r.flaschePruefnummerFehler({ name: 'Landwein', qualitaet: 'landwein', pruefnummer: null }), null)
  })
  test('Zukauf: Lieferant Pflicht, Betriebsnummer bei Wein/Most/Trauben aus Österreich', () => {
    assert.match(r.zukaufLieferantFehler({ art: 'wein', lieferant: false, betriebNr: null, landIso: 'AT' }), /Lieferanten angeben/)
    assert.match(r.zukaufLieferantFehler({ art: 'trauben', lieferant: true, betriebNr: '', landIso: 'AT', lieferantName: 'Hof Y' }), /„Hof Y“ braucht eine Betriebsnummer/)
    assert.equal(r.zukaufLieferantFehler({ art: 'wein', lieferant: true, betriebNr: null, landIso: 'IT' }), null)
    assert.equal(r.zukaufLieferantFehler({ art: 'flasche', lieferant: true, betriebNr: null, landIso: 'AT' }), null)
    assert.equal(r.zukaufLieferantFehler({ art: 'most', lieferant: true, betriebNr: '7654321', landIso: 'AT' }), null)
    // KAN-41: Maische wie Trauben
    assert.match(r.zukaufLieferantFehler({ art: 'maische', lieferant: true, betriebNr: ' ', landIso: 'AT', lieferantName: 'Hof Z' }), /„Hof Z“ braucht eine Betriebsnummer \(Wein, Most, Trauben und Maische aus Österreich\)/)
    assert.equal(r.zukaufLieferantFehler({ art: 'maische', lieferant: true, betriebNr: '1234567', landIso: 'AT' }), null)
  })
  test('Füllung: Produktname nicht leer', () => {
    assert.match(r.fuellungNameFehler('  '), /Produktnamen/)
    assert.equal(r.fuellungNameFehler('Grüner Veltliner'), null)
  })
})

describe('KAN-208 Verdrahtung', () => {
  test('Verkauf, Traubenverkauf, Zukauf und Füllung prüfen vor dem Schreiben', () => {
    const v = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(v, /if \(!datum\) throw new AktionsFehler\('Bitte das Verkaufsdatum angeben\.'\)/)
    assert.match(v, /verkaufKundeFehler\(\{ typen, kunde: partner\.vorhanden/)
    assert.match(v, /dac:dac_antrag_id\(status\)/)
    assert.match(v, /const pn = flaschePruefnummerFehler\(/)
    assert.ok(v.indexOf('verkaufKundeFehler({ typen') < v.indexOf('bestandBuchenAllesOderNichts(supabase'), 'Kundenprüfung vor der Abbuchung')
    assert.match(quelle('src/app/(dashboard)/erntemeldung/actions.ts'), /verkaufKundeFehler\(\{ typen: \['trauben'\]/)
    const z = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
    assert.match(z, /const lf = zukaufLieferantFehler\(/)
    assert.match(z, /if \(merkmaleFest\) for \(const k of ZUKAUF_MERKMALE\) delete zukaufPatch\[k\]/)
    assert.equal((quelle('src/app/(dashboard)/weinhandel/actions.ts').match(/const nf = fuellungNameFehler\(formData\.get\('name'\)\)/g) ?? []).length, 2)
  })
  test('Trigger auf zukauf_posten: Positivliste ohne Merkmale; Demo-Sekt mit Prüfnummer', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan208_zukauf_freeze.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan208_zukauf_freeze.sql')
    const liste = m.match(/'(lieferant_kontakt_id,[^']+)'/)[1].split(',')
    const regeln = quelle('src/lib/handel/partnerPflicht.ts')
    const merkmale = [...regeln.match(/ZUKAUF_MERKMALE = \[([\s\S]+?)\] as const/)[1].matchAll(/'([^']+)'/g)].map(x => x[1])
    for (const k of merkmale) assert.ok(!liste.includes(k), `${k} darf nicht in der Positivliste stehen`)
    assert.match(m, /AND z\.id <> p_zukauf\)/)
    assert.match(m, /'N ' \|\| \(10933 \+ y1 % 100\)/)
  })
})
