// KAN-276 (10.10.2026): Behandlungskennzahlen je Charge (Anreicherung kg/hl, Süßung g/lt, Konzentrierung %,
// Entsäuerung/Säuerung g/lt, Alkoholkorrektur %vol) aus Kellerbehandlungen und Stoffkonto – in Lagerstand,
// Lagerbewegungen, RV zum Eingang und RV zum Ausgang. Annahmen B1–B4 im Kopf von src/lib/kellerbuch/behandlungskennzahlen.ts.
// Punkt 3 des Tickets (Chargennummer, Jahrgangsprüfung beim Zusammenführen) deckt KAN-192/KAN-112 ab – hier mitgeprüft.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const kz = hooksMoeglich ? await laden('lib/kellerbuch/behandlungskennzahlen.ts') : null
const lager = hooksMoeglich ? await laden('lib/behoerden/lagerstand.ts') : null
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const b = (x) => ({ id: 'b', weinausbauId: 'A', datum: '2025-10-01', typName: null, menge: null, einheit: null, volumenLiter: 1000, stoffArt: null, stoffEinheit: null, stoffMenge: null, ...x })

describe('Zuordnung und Wert je Behandlung (B1, B2)', nurMitHooks, () => {
  test('Zuordnung über die Art des Stoffs, sonst über den Namen des Behandlungstyps', () => {
    const a = x => kz.kennzahlArt(b(x))
    assert.equal(a({ typName: 'Zuckerung', stoffArt: 'zucker' }), 'anreicherung')
    assert.equal(a({ typName: 'Anreicherung', stoffArt: 'rtk_fluessig' }), 'anreicherung')
    assert.equal(a({ typName: 'Süßung mit Süßreserve', stoffArt: 'rtk_fluessig' }), 'suessung')
    assert.equal(a({ typName: 'Dosage', stoffArt: 'zucker' }), 'suessung')
    assert.equal(a({ typName: 'Säurekorrektur', stoffArt: 'entsaeuerungsmittel' }), 'entsaeuerung')
    assert.equal(a({ typName: 'Säurekorrektur', stoffArt: 'saeuerungsmittel' }), 'saeuerung')
    assert.equal(a({ typName: 'Säurekorrektur' }), null)
    assert.ok(kz.kennzahlUnklar(b({ typName: 'Säurekorrektur' })))
    assert.equal(a({ typName: 'Entsäuerung (Kalk)' }), 'entsaeuerung')
    assert.equal(a({ typName: 'Weinsäure-Säuerung' }), 'saeuerung')
    assert.equal(a({ typName: 'Umkehrosmose' }), 'konzentrierung')
    assert.equal(a({ typName: 'Teilentalkoholisierung' }), 'alkoholkorrektur')
    for (const n of ['Hefegabe', 'Schwefelung', 'Filtration', 'Schönung (Bentonit)']) assert.equal(a({ typName: n }), null, n)
  })

  test('Masse je Volumen; Zucker-Äquivalent (RTK/KTM 65 %, in Litern 1,32 kg/l); schon je Volumen erfasst; % und %vol', () => {
    const w = x => { const y = b(x); return kz.kennzahlWert(y, kz.kennzahlArt(y)) }
    assert.equal(w({ typName: 'Zuckerung', stoffArt: 'zucker', stoffEinheit: 'kg', stoffMenge: 20 }), 2)              // 20 kg auf 10 hl
    // 10 l RTK flüssig = 13,2 kg Konzentrat = 8,58 kg Zucker auf 10 hl
    assert.equal(Math.round(w({ typName: 'Anreicherung', stoffArt: 'rtk_fluessig', stoffEinheit: 'l', stoffMenge: 10 }) * 1000), 858)   // runden-ok: Testvergleich
    assert.equal(Math.round(w({ typName: 'Anreicherung', stoffArt: 'ktm', stoffEinheit: 'kg', stoffMenge: 20 }) * 1000), 1300)   // runden-ok: Testvergleich
    assert.equal(w({ typName: 'Anreicherung', stoffArt: 'rtk_pulver', stoffEinheit: 'kg', stoffMenge: 20 }), 2)
    assert.equal(Math.round(w({ typName: 'Süßreserve', stoffArt: 'rtk_fluessig', stoffEinheit: 'l', stoffMenge: 10 }) * 1000), 8580)   // runden-ok: Testvergleich (g/l)
    assert.equal(w({ typName: 'Süßung', stoffArt: 'zucker', stoffEinheit: 'kg', stoffMenge: 5 }), 5)                 // 5 kg auf 1000 l = 5 g/l
    assert.equal(w({ typName: 'Entsäuerung', stoffArt: 'entsaeuerungsmittel', stoffEinheit: 'g', stoffMenge: 800, volumenLiter: 400 }), 2)
    assert.equal(w({ typName: 'Säuerung', menge: 1.5, einheit: 'g/l' }), 1.5)
    assert.equal(w({ typName: 'Anreicherung', menge: 2.4, einheit: 'kg/hl' }), 2.4)
    assert.equal(w({ typName: 'Umkehrosmose', menge: 8, einheit: '%' }), 8)
    assert.equal(w({ typName: 'Entalkoholisierung', menge: -1.5, einheit: '% vol' }), -1.5)
    assert.equal(w({ typName: 'Umkehrosmose', menge: 80, einheit: 'l' }), null)
    assert.equal(w({ typName: 'Zuckerung', stoffArt: 'zucker', stoffEinheit: 'kg', stoffMenge: 20, volumenLiter: null }), null)
  })
})

describe('Kumuliert je Charge bis zum Datum (B3, B4)', nurMitHooks, () => {
  const roh = {
    behandlungen: [
      { id: 'k1', weinausbau_id: 'A', datum: '2025-09-20', typ: { name: 'Zuckerung' }, menge: 20, einheit: 'kg', volumen_liter_ist: 1000, storniert_am: null },
      { id: 'k2', weinausbau_id: 'A', datum: '2025-11-05', typ: { name: 'Entsäuerung' }, menge: 500, einheit: 'g', volumen_liter_ist: 1000, storniert_am: null },
      { id: 'k3', weinausbau_id: 'A', datum: '2026-03-01', typ: { name: 'Zuckerung' }, menge: 10, einheit: 'kg', volumen_liter_ist: 1000, storniert_am: null },
      { id: 'k4', weinausbau_id: 'A', datum: '2025-12-01', typ: { name: 'Zuckerung' }, menge: 99, einheit: 'kg', volumen_liter_ist: 1000, storniert_am: '2025-12-02' },
      { id: 'k5', weinausbau_id: 'B', datum: '2025-10-01', typ_name_snapshot: 'Süßung', menge: 6, einheit: 'kg', volumen_liter_ist: null, storniert_am: null },
    ],
    stoff: [
      // Verwendung zu k1 – Stoffmenge geht vor der Behandlungsmenge (gleich)
      { id: 's1', art: 'verwendung', menge: -20, datum: '2025-09-20', weinausbau_id: 'A', keller_behandlung_id: 'k1', storno_von_id: null, kellermittel: { art: 'zucker', einheit: 'kg' } },
      // direkt im Stoffkonto gebucht (ohne Behandlung), dann storniert
      { id: 's2', art: 'verwendung', menge: -50, datum: '2025-10-10', weinausbau_id: 'A', keller_behandlung_id: null, zweck: 'Zuckerung', storno_von_id: null, kellermittel: { art: 'zucker', einheit: 'kg' } },
      { id: 's3', art: 'storno', menge: 50, datum: '2025-10-11', weinausbau_id: 'A', keller_behandlung_id: null, storno_von_id: 's2', kellermittel: { art: 'zucker', einheit: 'kg' } },
      // direkt gebucht, gilt: Säuerung 300 g auf heute 1500 l
      { id: 's4', art: 'verwendung', menge: -300, datum: '2026-01-15', weinausbau_id: 'A', keller_behandlung_id: null, zweck: 'Säuerung', storno_von_id: null, kellermittel: { art: 'saeuerungsmittel', einheit: 'g' } },
    ],
  }
  const liste = () => kz.kennzahlBehandlungen(roh.behandlungen, roh.stoff, new Map([['A', 1500], ['B', 2000]]))

  test('Summe bis zum Datum, stornierte Behandlung und stornierte Stoffbuchung zählen nicht', () => {
    const { liste: l } = liste()
    assert.deepEqual(kz.kennzahlenBis(l, 'A', '2025-12-31'), { anreicherung: 2, suessung: null, konzentrierung: null, entsaeuerung: 0.5, saeuerung: null, alkoholkorrektur: null })
    assert.deepEqual(kz.kennzahlenBis(l, 'A', null), { anreicherung: 3, suessung: null, konzentrierung: null, entsaeuerung: 0.5, saeuerung: 0.2, alkoholkorrektur: null })
    assert.equal(kz.kennzahlenBis(l, 'A', '2025-09-19').anreicherung, null)
    assert.equal(kz.kennzahlenBis(l, null, null).anreicherung, null)
  })

  test('ohne Ist-Volumen auf die heutige Menge bezogen, mit Hinweis', () => {
    const { liste: l, mitSchaetzvolumen } = liste()
    assert.equal(kz.kennzahlenBis(l, 'B', null).suessung, 3)   // 6 kg auf 2000 l
    assert.equal(mitSchaetzvolumen, 2)                          // k5 und die direkte Säuerung s4
    const h = kz.kennzahlHinweise([...l, b({ id: 'x', typName: 'Säurekorrektur', menge: 1, einheit: 'kg' })], mitSchaetzvolumen)
    assert.ok(h.some(x => /Säurekorrektur/.test(x)) && h.some(x => /ohne Ist-Volumen/.test(x)))
    const idx = kz.kennzahlenIndex(l)
    assert.deepEqual(idx('A', '2025-12-31'), kz.kennzahlenBis(l, 'A', '2025-12-31'))
  })
})

describe('In den BKI-Blättern', nurMitHooks, () => {
  const j = (x = {}) => ({
    id: 'j1', beleg_nr: 1, pos: 1, datum: '2025-10-01', buchungsart_code: 'ERNTE', bestand: 'offen', weinausbau_id: 'A', fuellung_id: null,
    behaelter_id: null, menge_liter: 1000, menge_stk: 0, partner_name: null, partner_land: null, quelle_tabelle: 'pressung_behaelter',
    storno_von_id: null, charge_name: 'GV A', fuellung_name: null, flaschengroesse_ml: null, erzeugnis: null, qualitaetsstufe: 'qualitaetswein',
    zusatzbezeichnung: null, weinart: 'weiss', herkunft_code: null, land_iso: 'AT', rebsorte: 'Grüner Veltliner', jahrgang: 2025, hinweis: null, ...x,
  })
  const stamm = (kennzahl) => ({ chargen: new Map([['A', { id: 'A', kmw: 18 }]]), fuellungen: new Map([['F', { id: 'F', weinausbau_id: 'A', flaschengroesse_ml: 750, anzahl_unetikettiert: 0 }]]), behaelter: new Map(), etikettierungen: [], kennzahl })
  const liste = [b({ id: 'z', datum: '2025-10-05', typName: 'Zuckerung', stoffArt: 'zucker', stoffEinheit: 'kg', stoffMenge: 25 })]

  test('Lagerstand und Lagerbewegungen: Spalten gefüllt (Flasche über die Charge der Füllung), ohne Behandlung leer', () => {
    const idx = kz.kennzahlenIndex(liste)
    const journal = [j(), j({ id: 'j2', beleg_nr: 2, datum: '2025-10-03', bestand: 'flasche', weinausbau_id: null, fuellung_id: 'F', menge_liter: 7.5, menge_stk: 10, buchungsart_code: 'ZK_FLA' })]
    const ls = lager.berechneLagerstand(journal, stamm(idx), '2025-12-31')
    const spalte = lager.SPALTEN_LAGERSTAND.find(s => s.kopf === 'Anreicherung kg/hl')
    assert.deepEqual(ls.zeilen.map(z => spalte.wert(z)), [2.5, 2.5])
    const lb = lager.berechneLagerbewegungen(journal, stamm(idx), { von: null, bis: null })
    const sb = lager.SPALTEN_LAGERBEWEGUNGEN.find(s => s.kopf === 'Anreicherung kg/hl')
    assert.deepEqual(lb.zeilen.map(z => sb.wert(z)), [null, null])   // beide Buchungen vor der Zuckerung am 05.10.
    const ohne = lager.berechneLagerstand(journal, stamm(undefined), '2025-12-31')
    assert.ok(ohne.zeilen.every(z => spalte.wert(z) === null))
  })

  test('Spalten an derselben Stelle; RV-Blätter nutzen dieselben Spalten statt fester Leerwerte', () => {
    const koepfe = lager.kennzahlSpalten().map(s => s.kopf)
    assert.deepEqual(koepfe, ['Anreicherung kg/hl', 'Süßung g/lt', 'Konzentrierung %', 'Entsäuerung g/lt', 'Säuerung g/lt', 'Alkoholkorrektur %vol'])
    for (const sp of [lager.SPALTEN_LAGERSTAND, lager.SPALTEN_LAGERBEWEGUNGEN]) {
      const i = sp.findIndex(s => s.kopf === 'Anteil FremdJG')
      assert.deepEqual(sp.slice(i + 1, i + 7).map(s => s.kopf), koepfe)
    }
    const rv = quelle('src/lib/behoerden/bki-rv.ts')
    assert.equal((rv.match(/\.\.\.kennzahlSpalten<Rv(Eingang|Ausgang)Zeile>\(\)/g) ?? []).length, 2)
    assert.doesNotMatch(rv, /kopf: 'Anreicherung kg\/hl'/)
    assert.match(rv, /ladeBehandlungskennzahlen\(supabase, tenantId, p\.bis\)/)
  })
})

describe('Punkt 3: schon abgedeckt (KAN-192, KAN-112)', nurMitHooks, () => {
  test('Chargennummer je Charge (Migration kan192a) und anderer Jahrgang beim Zusammenführen = Verschnitt', async () => {
    assert.match(quelle('supabase/migrations/20261003120945_kan192a_abschluss_chargennummer.sql'), /ALTER TABLE public\.weinausbau ADD COLUMN chargennummer text;/)
    const { waehleZielCharge } = await laden('lib/kellerbuch/umzugZiel.ts')
    const gv = (jahrgang) => ({ id: `c${jahrgang}`, rebsorte: 'Grüner Veltliner', jahrgang, herkunft_code: null, qualitaetsstufe: 'qualitaetswein' })
    const r = waehleZielCharge([gv(2024)], [gv(2025)])
    assert.ok(r.istVerschnitt && r.unterschiede.includes('Jahrgang'))
    assert.equal(waehleZielCharge([gv(2025)], [gv(2025)]).istVerschnitt, false)
  })
})
