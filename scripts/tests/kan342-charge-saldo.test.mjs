// Tests KAN-342 (22.10.2026) – Kontroll-Saldo der Chargenseite aus dem zentralen Bewegungsbuch
//
// Befund UAT: Die Chargenseite meldete „Bestand und Bewegungsbuch stimmen nicht überein“ (gebucht 400 L, Saldo 500 L),
// obwohl der Bestand stimmte. Ursache: Die Seite rechnete den Saldo selbst und kannte Verarbeitung (KAN-115),
// Volumenzugang einer Kellerbehandlung (KAN-41), Produktion (KAN-118) und Lohnversektung (KAN-232) nicht.
// Jetzt: ladeBewegungenCharge() (src/lib/behoerden/bewegungsbuch.ts) – dieselbe Ereignislogik wie das Bewegungsbuch,
// gefiltert auf die Charge; bestandsAbweichungDerCharge() vergleicht mit dem gebuchten Bestand.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const T = 'tenant-1'
const ANDERER = 'tenant-2'
const G = uuid(101)
const C = uuid(1)        // Charge unter Test
const X = uuid(2)        // andere Charge im selben Gebinde

const bb = hooksMoeglich ? await laden('lib/behoerden/bewegungsbuch.ts') : null

const charge = (id, teil) => ({
  id, tenant_id: T, name: id === C ? 'Grüner Veltliner 2025' : 'Andere', behaelter_id: G, jahrgang: 2025, menge_liter: 0, aktiv: true,
  ist_eroeffnungsbestand: false, anfangsbestand_liter: null, created_at: '2026-09-01T08:00:00Z', transaktions_nr: null,
  storniert_am: null, storno_grund: null, storniert_von_name: null, ...teil,
})
const pressung = (id, weinausbau_id, menge_liter, tenant_id = T) => ({
  id, weinausbau_id, behaelter_id: G, menge_liter, notizen: null, storniert_am: null, storno_grund: null, storniert_von_name: null,
  pressung: { id: `p-${id}`, datum: '2026-09-20', notizen: null, tenant_id, storniert_am: null },
})

function leer() {
  return {
    weinausbau: [], pressung_behaelter: [], keller_umzuege: [], keller_behandlungen: [], fuellungen: [], verkauf_positionen: [],
    zukauf_posten: [], verschneidung_quellen: [], verschneidungen: [], keller_verarbeitungen: [], keller_zugangskorrekturen: [],
    produktion_eingaenge: [], produktionen: [],
  }
}

async function saldoVon(t, gebucht) {
  const d = datenbank(t)
  const bewegungen = await bb.ladeBewegungenCharge(d, T, C)
  return { bewegungen, abweichung: bb.bestandsAbweichungDerCharge(bewegungen, gebucht) }
}

describe('KAN-342: Bewegungen der Charge aus dem Bewegungsbuch', nurMitHooks, () => {
  test('Verarbeitung (Traubensaft) – 500 L gepresst, 100 L verarbeitet, gebucht 400 L → keine Abweichung', async () => {
    const t = leer()
    t.weinausbau.push(charge(C, { menge_liter: 400 }), charge(X, { menge_liter: 900 }))
    t.pressung_behaelter.push(pressung(uuid(11), C, 500), pressung(uuid(12), X, 900))
    t.keller_verarbeitungen.push(
      { id: uuid(21), tenant_id: T, weinausbau_id: C, datum: '2026-10-05', erstellt_am: '2026-10-05T09:00:00Z', menge_liter: 100, zweck: 'traubensaft', notizen: null, storniert_am: null, storno_grund: null, storniert_von_name: null },
      // stornierte Verarbeitung zählt nicht (Buchung und Gegenbuchung heben sich auf, die Seite zeigt beide nicht)
      { id: uuid(22), tenant_id: T, weinausbau_id: C, datum: '2026-10-06', erstellt_am: '2026-10-06T09:00:00Z', menge_liter: 50, zweck: 'traubensaft', notizen: null, storniert_am: '2026-10-07T09:00:00Z', storno_grund: 'Tippfehler', storniert_von_name: 'Paul' },
    )
    const { bewegungen, abweichung } = await saldoVon(t, 400)
    assert.deepEqual(bewegungen.map(b => [b.art, b.menge, b.saldo]), [['pressung', 500, 500], ['verarbeitung', -100, 400]])
    assert.equal(abweichung, null)   // vorher: „Saldo laut Bewegungsbuch 500 L“
  })

  test('Volumenzugang einer Kellerbehandlung (Süßreserve) und Produktion – gebucht wie Saldo → keine Abweichung', async () => {
    const t = leer()
    t.weinausbau.push(charge(C, { menge_liter: 470 }))
    t.pressung_behaelter.push(pressung(uuid(11), C, 500))
    t.keller_behandlungen.push({ id: uuid(31), tenant_id: T, weinausbau_id: C, datum: '2026-10-02', menge: 20, einheit: 'l', notizen: null, typ_name_snapshot: 'Süßreserve', zugang_liter: 20, storniert_am: null, storno_grund: null, storniert_von_name: null })
    t.produktion_eingaenge.push({ id: uuid(41), tenant_id: T, art: 'wein', weinausbau_id: C, menge: 50, produktion: { id: uuid(40), datum: '2026-10-10', art: 'spritzer', erzeugnis: null, notizen: null, storniert_am: null, storno_grund: null, storniert_von_name: null, ziel: { name: 'Spritzer' } } })
    const { bewegungen, abweichung } = await saldoVon(t, 470)
    assert.deepEqual(bewegungen.map(b => [b.art, b.menge]), [['pressung', 500], ['behandlung', 20], ['produktion_aus', -50]])
    assert.equal(bewegungen.at(-1).saldo, 470)
    assert.equal(abweichung, null)
  })

  test('Lohnversektung (Rückkehr als Sekt) mindert den Saldo wie die Abfüllung', async () => {
    const t = leer()
    t.weinausbau.push(charge(C, { menge_liter: 0, aktiv: false }))
    t.pressung_behaelter.push(pressung(uuid(11), C, 300))
    t.fuellungen.push({ id: uuid(51), tenant_id: T, weinausbau_id: C, datum: '2026-10-15', name: 'Sekt 2025', aktiv: true, anzahl_flaschen: 400, flaschengroesse_ml: 750, menge_liter_gefuellt: 300, pruefnummer: null, chargennummer: null, lohnversektung_id: uuid(50), storniert_am: null, storno_grund: null, storniert_von_name: null })
    const { bewegungen, abweichung } = await saldoVon(t, 0)
    assert.deepEqual(bewegungen.map(b => [b.art, b.saldo]), [['pressung', 300], ['lohnversektung', 0]])
    assert.equal(abweichung, null)
  })

  test('echte Abweichung bleibt sichtbar; fremde Pressung im selben Gebinde zählt nicht', async () => {
    const t = leer()
    t.weinausbau.push(charge(C, { menge_liter: 400 }))
    t.pressung_behaelter.push(pressung(uuid(11), C, 500), pressung(uuid(13), C, 999, ANDERER))
    const { abweichung } = await saldoVon(t, 400)
    assert.deepEqual(abweichung, { saldo: 500, differenz: 100 })
  })

  test('Eröffnungsbestand als Anfangsbestand; Charge ohne Bewegungen → kein Hinweis', async () => {
    const t = leer()
    t.weinausbau.push(charge(C, { menge_liter: 800, ist_eroeffnungsbestand: true, anfangsbestand_liter: 800 }))
    const r = await saldoVon(t, 800)
    assert.deepEqual(r.bewegungen.map(b => [b.art, b.saldo]), [['anfangsbestand', 800]])
    assert.equal(r.abweichung, null)
    assert.equal(bb.bestandsAbweichungDerCharge([], 250), null)
  })
})

describe('KAN-342: Verdrahtung der Chargenseite', () => {
  const seite = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
  test('Saldo und Liste aus dem Bewegungsbuch, keine eigene Saldo-Rechnung mehr', () => {
    assert.match(seite, /await ladeBewegungenCharge\(supabase, tenantId, weinausbau\.id\)/)
    assert.match(seite, /bestandsAbweichungDerCharge\(bewegungenMitSaldo, aktuell\)/)
    assert.doesNotMatch(seite, /saldo \+= bew\.menge/)
    assert.doesNotMatch(seite, /from\('zukauf_posten'\)/)
  })
  test('Hinweis neutral mit Link zum Bewegungsbuch der Charge – keine pauschale Schwund-Aufforderung', () => {
    assert.match(seite, /Bitte die Buchungen der Charge prüfen\./)
    assert.match(seite, /href="#bewegungsbuch"/)
    assert.match(seite, /<section id="bewegungsbuch"/)
    assert.doesNotMatch(seite, /fehlt z\. B\. eine Schwundbuchung/)
  })
})
