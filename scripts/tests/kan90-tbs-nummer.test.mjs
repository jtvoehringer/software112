// KAN-90 (06.10.2026): Transportscheinnummer (TBS-Nr.) bei Verkauf und Zukauf; Herkunft in der TBS als amtliches Kürzel.
// Die Datenbank-Seite (Ableitung tbs_nummer/tbs_jahr, UNIQUE je Jahr, Zukauf-Spalten, Protokoll, RPC) prüft DB-Test 42.
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
const t = hooksMoeglich ? await laden('lib/handel/tbsNummer.ts') : null
const pf = hooksMoeglich ? await laden('lib/behoerden/tbPflicht.ts') : null

describe('KAN-90 TBS-Nr.: Anzeige, Prüfung, Suche', nurMitHooks, () => {
  test('tbsText: „Nr./Jahr“, ohne Jahr nur die Nummer, ohne Nummer null', () => {
    assert.equal(t.tbsText(' 1234 ', 2026), '1234/2026')
    assert.equal(t.tbsText('12', null), '12')
    assert.equal(t.tbsText('', 2026), null)
    assert.equal(t.tbsText(null, null), null)
  })

  test('Lieferanten-TBS: Jahr vierstellig, nicht ohne Nummer, Nummer höchstens 30 Zeichen', () => {
    assert.equal(t.tbsLieferantFehler('1234', '2026'), null)
    assert.equal(t.tbsLieferantFehler('', ''), null)
    assert.equal(t.tbsLieferantFehler('1234', ''), null)
    assert.match(t.tbsLieferantFehler('1234', '26'), /vierstellig/)
    assert.match(t.tbsLieferantFehler('1234', '1999'), /vierstellig/)
    assert.match(t.tbsLieferantFehler('', '2026'), /fehlt die Transportschein-Nr/)
    assert.match(t.tbsLieferantFehler('x'.repeat(31), '2026'), /höchstens 30/)
    assert.deepEqual(t.tbsLieferantSpalten(' 55 ', '2026'), { tbs_nummer_lieferant: '55', tbs_jahr_lieferant: 2026 })
    assert.deepEqual(t.tbsLieferantSpalten('', '2026'), { tbs_nummer_lieferant: null, tbs_jahr_lieferant: null })
  })

  test('Suche: Nummer genau (nicht 12 in 123), mit Jahr nur dieses Jahr, „TBS“-Präfix erlaubt', () => {
    assert.equal(t.tbsTrifft('1234', '1234', 2026), true)
    assert.equal(t.tbsTrifft('1234/2026', '1234', 2026), true)
    assert.equal(t.tbsTrifft('TBS 1234/2026', '1234', 2026), true)
    assert.equal(t.tbsTrifft('1234/2025', '1234', 2026), false)
    assert.equal(t.tbsTrifft('12', '1234', 2026), false)
    assert.equal(t.tbsTrifft('1234', null, null), false)
    assert.deepEqual(t.tbsSuche('7/2026'), { nummer: '7', jahr: 2026 })
    assert.equal(t.tbsSuche('Weingut Huber'), null)
  })

  test('Listensuche: TBS-Nr. oder Teiltext der übrigen Felder', () => {
    const tbs = { nummer: '55', jahr: 2026 }
    assert.equal(t.listeTrifft('55/2026', tbs, ['RE-1']), true)
    assert.equal(t.listeTrifft('huber', tbs, ['Weingut Huber']), true)
    assert.equal(t.listeTrifft('meier', tbs, ['Weingut Huber']), false)
    assert.equal(t.listeTrifft('', tbs, []), true)
  })

  test('Weinbuch der Ziel-Charge: „Zukauf lt. TBS 1234/2026“ statt „nicht erfasst“', () => {
    assert.equal(t.zukaufTbsVermerk('1234', 2026), 'Zukauf lt. TBS 1234/2026')
    assert.equal(t.zukaufTbsVermerk(null, null), 'Transportschein-Nr. nicht erfasst')
    const wb = quelle('src/lib/wein/weinbuch.ts')
    assert.match(wb, /zukaufTbsVermerk\(z\.tbs_nummer_lieferant, z\.tbs_jahr_lieferant\)/)
    assert.match(wb, /const zkSelect = '[^']*tbs_nummer_lieferant, tbs_jahr_lieferant/)
  })

  test('Duplikat-Meldung nennt Nummer und Jahr', () => {
    assert.match(t.tbsDuplikatText('7', '2026'), /7\/2026 ist in diesem Jahr bereits vergeben/)
  })
})

describe('KAN-90 Herkunft in der TBS als amtliches Kürzel (R16)', nurMitHooks, () => {
  const daten = herkunft => ({
    laufende_nr: '1', jahr: '2026', datum_tag: '06', datum_monat: '10', datum_jahr: '2026', zugmaschine: 'W-1',
    v_name: 'A', v_betriebsnummer: '1', e_name: 'B', e_betriebsnummer: '2',
    positionen: [{ menge_liter: '100', art: 'Weiß', traubensorte: 'GV', qualitaetsstufe: 'Qualitätswein', jahrgang: '2026', herkunft, kmw: '18' }],
  })
  test('Ausstellen nur mit amtlichem Herkunftskürzel – nicht mit Betriebsort oder internem Freitext', () => {
    assert.deepEqual(pf.tbPflichtFehler(daten('WLNO')), [])
    assert.deepEqual(pf.tbPflichtFehler(daten('wlnoe')), [])   // interner Code ist abbildbar
    assert.deepEqual(pf.tbPflichtFehler(daten('Poysdorf')), ['Position 1: Herkunft als amtliches Kürzel (statt „Poysdorf“)'])
    assert.deepEqual(pf.tbPflichtFehler(daten('')), ['Position 1: Herkunft'])
  })

  test('Vorbelegung: kein Betriebsort als Ersatz mehr', () => {
    const s = quelle('src/lib/behoerden/transportbescheinigung.ts')
    assert.doesNotMatch(s, /herkunft:\s+[^\n]*cfg\.betrieb_ort/)
    assert.match(s, /herkunftTrauben\(nr, tv, hinweise\)/)
    assert.match(s, /grundstueck:grundstueck_id\(rebsorte, trauben_herkunft_code\)/)
  })
})

describe('KAN-90 Oberfläche und Server', () => {
  test('Verkauf: Liste mit TBS-Nr. und Suche, Detail mit TBS-Nr. am Transportschein-Knopf', () => {
    const liste = quelle('src/app/(dashboard)/weinhandel/verkauf/page.tsx')
    assert.match(liste, /<ListenSuche q=\{q\} pfad="\/weinhandel\/verkauf"/)
    assert.match(liste, /\.ilike\('tbs_nummer', tbsQ\.nummer\)/)
    assert.match(liste, /TBS \{tbsJePosten\.get\(/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx'), /Transportschein\{tbsNr \?/)
  })

  test('TBS speichern: Duplikat verständlich, laufende Nummern aus den Spalten (auch Entwürfe)', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/actions.ts')
    assert.match(a, /e\?\.code === '23505'/)
    assert.match(a, /\.eq\('tbs_jahr', Number\(jahr\)\)/)
    assert.doesNotMatch(a, /\.eq\('status', 'ausgestellt'\)\.is\('storniert_am', null\)\.order/)
  })

  test('Zukauf: Felder im Formular, Prüfung in der Action, Liste mit Suche', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
    assert.match(a, /tbsLieferantFehler\(formData\.get\('tbs_nummer_lieferant'\), formData\.get\('tbs_jahr_lieferant'\)\)/)
    assert.equal(a.split('...f.tbs,').length - 1, 2)   // Anlegen (RPC) und Bearbeiten
    for (const rel of ['zukauf/neu/page.tsx', 'zukauf/[id]/edit/ZukaufEditForm.tsx']) {
      assert.match(quelle(`src/app/(dashboard)/weinhandel/${rel}`), /fd\.set\('tbs_nummer_lieferant'/, rel)
    }
    assert.match(quelle('src/app/(dashboard)/weinhandel/zukauf/page.tsx'), /listeTrifft\(q, \{ nummer: p\.tbs_nummer_lieferant/)
  })

  test('Migration: Spalten, Ableitungs-Trigger, UNIQUE je Jahr, RPC nimmt die Lieferanten-TBS', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan90_tbs_nummer.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan90_tbs_nummer.sql')
    assert.match(m, /CREATE TRIGGER b_tbs_spalten BEFORE INSERT OR UPDATE ON public\.transportbescheinigungen/)
    assert.match(m, /CREATE UNIQUE INDEX transportbescheinigungen_tbs_nummer_uq ON public\.transportbescheinigungen \(tenant_id, tbs_jahr, tbs_nummer\)\s+WHERE storniert_am IS NULL AND tbs_nummer IS NOT NULL/)
    assert.match(m, /'eingangsrechnungsnummer', 'tbs_nummer_lieferant', 'tbs_jahr_lieferant',/)
  })
})
