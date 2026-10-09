// KAN-48 AP11 (09.10.2026): BKI-Blätter „Betriebsdaten“ und „GebindeVerzeichnis“, eine Regel für Straße/Hausnummer,
// Material-Vorbelegung und eindeutige Gebindebezeichnung.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { strasseHausnummer } from '../../src/lib/adresse/strasse.ts'
import { materialAusTyp, materialFelder, gebindeNameDoppelt } from '../../src/lib/keller/gebindeMaterial.ts'
import { rechtsformAus, istRechtsform } from '../../src/lib/betrieb/rechtsform.ts'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()
const bki = hooksMoeglich ? await laden('lib/behoerden/bki-stammdaten.ts') : null
const T = 't1'

describe('Straße und Hausnummer – eine Regel für alle Formulare und Exporte', () => {
  test('Hausnummer am Ende, auch mit Buchstabe, Bereich und Stiege/Tür; Komma davor', () => {
    assert.deepEqual(strasseHausnummer('Jubiläumsstr. 43'), { strasse: 'Jubiläumsstr.', hausnr: '43' })
    assert.deepEqual(strasseHausnummer('Kellergasse 12a'), { strasse: 'Kellergasse', hausnr: '12a' })
    assert.deepEqual(strasseHausnummer('Hauptstraße 12 / 3'), { strasse: 'Hauptstraße', hausnr: '12/3' })
    assert.deepEqual(strasseHausnummer('Ried 7-9'), { strasse: 'Ried', hausnr: '7-9' })
    assert.deepEqual(strasseHausnummer('Untere Hauptstraße, 5'), { strasse: 'Untere Hauptstraße', hausnr: '5' })
    assert.deepEqual(strasseHausnummer('  Am   Anger 3  '), { strasse: 'Am Anger', hausnr: '3' })
  })
  test('ohne Hausnummer bleibt alles Straße (vorher: „Am Berg“ → Hausnummer „Berg“)', () => {
    assert.deepEqual(strasseHausnummer('Am Berg'), { strasse: 'Am Berg', hausnr: '' })
    assert.deepEqual(strasseHausnummer('Kellergasse'), { strasse: 'Kellergasse', hausnr: '' })
    assert.deepEqual(strasseHausnummer(null), { strasse: '', hausnr: '' })
    assert.deepEqual(strasseHausnummer('  '), { strasse: '', hausnr: '' })
  })
})

describe('Rechtsform und Material', () => {
  test('Rechtsform: nur die Werte des CHECK, leer = nicht gesetzt', () => {
    assert.deepEqual(rechtsformAus('natuerliche_person'), { ok: true, wert: 'natuerliche_person' })
    assert.deepEqual(rechtsformAus(''), { ok: true, wert: null })
    assert.deepEqual(rechtsformAus('GmbH'), { ok: false })
    assert.equal(istRechtsform('toString'), false)   // kein Treffer über den Prototyp
  })
  test('Material: Angabe vor Vorbelegung aus dem Typ; Langbezeichnung leer = null', () => {
    assert.equal(materialAusTyp('barrique'), 'Holz')
    assert.equal(materialAusTyp('bottich'), null)
    assert.deepEqual(materialFelder('', '  ', 'stahltank'), { material: 'Edelstahl', bezeichnung_lang: null })
    assert.deepEqual(materialFelder(' Glas ', 'Glasballon 54 l', 'stahltank'), { material: 'Glas', bezeichnung_lang: 'Glasballon 54 l' })
  })
  test('doppelte Bezeichnung: verständliche Meldung nur für den eigenen Index', () => {
    assert.match(gebindeNameDoppelt({ code: '23505', message: 'duplicate key value violates unique constraint "behaelter_name_je_betrieb"' }, ' T1 '), /Bezeichnung „T1“ gibt es in diesem Betrieb schon/)
    assert.equal(gebindeNameDoppelt({ code: '23505', message: 'anderer Index' }, 'T1'), null)
    assert.equal(gebindeNameDoppelt(null, 'T1'), null)
  })
})

describe('Blatt „Betriebsdaten“', nurMitHooks, () => {
  const basis = { betrieb_name: 'Weingut Johannes Gebeshuber', betrieb_strasse: 'Jubiläumsstr. 43', betrieb_plz: '2352', betrieb_ort: 'Gumpoldskirchen', betrieb_betriebsnummer: '4489781' }

  test('Firma bzw. ohne Rechtsform: Firmenname in „Nachname/Firmenname“, Betriebsstätte = Name, Straße getrennt, Bio', () => {
    const { zeile, warnungen } = bki.betriebsdatenZeile(basis, 'biodynamisch')
    assert.deepEqual(zeile, { betriebsnummer: '4489781', vorname: null, nachname: 'Weingut Johannes Gebeshuber', betriebsstaette: 'Weingut Johannes Gebeshuber', plz: '2352', ort: 'Gumpoldskirchen', strasse: 'Jubiläumsstr.', hausnummer: '43', bio: true })
    assert.ok(warnungen.some(w => /Rechtsform nicht gesetzt/.test(w)))
    assert.equal(bki.betriebsdatenZeile({ ...basis, betrieb_rechtsform: 'kapitalgesellschaft' }, 'konventionell').warnungen.length, 0)
  })

  test('natürliche Person: Vor- und Nachname; fehlen sie, gibt es einen Hinweis', () => {
    const { zeile } = bki.betriebsdatenZeile({ ...basis, betrieb_rechtsform: 'natuerliche_person', betrieb_vorname: 'Johannes', betrieb_nachname: 'Gebeshuber', betrieb_betriebsstaette: 'Hofkeller' }, 'bio_eu')
    assert.deepEqual([zeile.vorname, zeile.nachname, zeile.betriebsstaette, zeile.bio], ['Johannes', 'Gebeshuber', 'Hofkeller', true])
    assert.ok(bki.betriebsdatenZeile({ ...basis, betrieb_rechtsform: 'natuerliche_person' }, null).warnungen.some(w => /Vor- und Nachname fehlen/.test(w)))
  })

  test('Bio nur bei bio_eu und biodynamisch; Hinweise bei fehlender Hausnummer und Betriebsnummer', () => {
    for (const s of ['konventionell', 'kip', 'nachhaltig', null]) assert.equal(bki.bioBetrieb(s), false, String(s))
    const { warnungen } = bki.betriebsdatenZeile({ ...basis, betrieb_strasse: 'Am Berg', betrieb_betriebsnummer: '' }, null)
    assert.ok(warnungen.some(w => /Keine Hausnummer in „Am Berg“/.test(w)))
    assert.ok(warnungen.some(w => /Betriebsnummer fehlt/.test(w)))
  })

  test('Laden: eine Zeile je Betrieb, ohne Einstellungen ein Hinweis', async () => {
    const d = datenbank({ tenant_einstellungen: [{ tenant_id: T, ...basis, betrieb_rechtsform: 'kapitalgesellschaft' }], tenants: [{ id: T, bio_status: 'konventionell' }] })
    const r = await bki.ladeBetriebsdaten(d, T)
    assert.equal(r.zeilen.length, 1)
    assert.equal(r.zeilen[0].bio, false)
    const leer = await bki.ladeBetriebsdaten(datenbank({ tenant_einstellungen: [], tenants: [{ id: T, bio_status: null }] }), T)
    assert.deepEqual(leer, { zeilen: [], warnungen: ['Für den Betrieb sind noch keine Betriebsdaten erfasst.'] })
  })
})

describe('Blatt „GebindeVerzeichnis“', nurMitHooks, () => {
  const rpcZeilen = [
    { id: 'g1', tenant_id: T, name: 'T1', typ: 'stahltank', volumen_liter: 5000.1234, standort: 'Keller', aktiv: true, material: 'Edelstahl', bezeichnung_lang: null, fremd: false, eigentuemer_name: 'Weingut A' },
    { id: 'g2', tenant_id: 'p', name: 'B7', typ: 'barrique', volumen_liter: 225, standort: null, aktiv: true, material: null, bezeichnung_lang: 'Barrique Eiche', fremd: true, eigentuemer_name: 'Spaetrot' },
    { id: 'g3', tenant_id: T, name: 'Alt', typ: null, volumen_liter: null, standort: null, aktiv: false, material: null, bezeichnung_lang: null, fremd: false, eigentuemer_name: 'Weingut A' },
  ]
  test('Bezeichnung lang ohne Angabe = Gebindetyp, Nenninhalt mit 3 Stellen, Partner-Gebinde mit Eigentümer, Hinweise', async () => {
    const d = datenbank({}, { rpc: () => ({ data: rpcZeilen, error: null }) })
    const r = await bki.ladeBkiGebindeverzeichnis(d, T)
    assert.deepEqual(r.zeilen.map(z => [z.bezeichnung, z.bezeichnungLang, z.material, z.nenninhalt, z.eigentuemer]), [
      ['T1', 'Stahltank', 'Edelstahl', 5000.123, null],
      ['B7', 'Barrique Eiche', null, 225, 'Spaetrot'],
      ['Alt', null, null, null, null],
    ])
    assert.ok(r.warnungen.some(w => /2 Gebinde ohne Material/.test(w)))
    assert.ok(r.warnungen.some(w => /1 Gebinde ohne Nenninhalt/.test(w)))
    const nurAktiv = await bki.ladeBkiGebindeverzeichnis(d, T, { nurAktiv: true })
    assert.equal(nurAktiv.zeilen.length, 2)
  })
})
