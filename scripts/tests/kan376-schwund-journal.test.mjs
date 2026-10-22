// Tests KAN-376 (22.10.2026) – Bestandskorrekturen im Bewegungsbuch, Schwund ohne „Nachbuchung“, Journal ohne „0 L“
//
// Befund Musterhof, Charge UAT-GV2026: Bewegungsjournal 110 L, Ist 160 L. Ablauf: direkte Mengenänderung der Charge ohne
// Bewegung → der nächtliche Abgleich bucht INV_MIN (quelle_tabelle 'weinausbau_bestand') → das Behälter-Bewegungsbuch
// zeigte diese Korrektur nicht (Saldo 210 statt 160) → der Benutzer glich mit „Schwund (Nachbuchung)“ aus
// (manuellSchwundBuchen, p_bestand_mindern = false) → der Journal-Trigger zog die Menge ein zweites Mal ab.
// Entscheidung Jörgen 22.10.2026 (keine Migration): Bewegungsbuch zeigt die Korrektur, Schwund mindert immer den Bestand,
// Journal (Übersicht → Journal) ohne „0 L“, mit Schwundmenge und Links über den Elterndatensatz.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const T = 'tenant-1'
const ANDERER = 'tenant-2'
const G = uuid(101)      // Gebinde unter Test
const G2 = uuid(102)     // anderes Gebinde
const C = uuid(1)        // Charge UAT-GV2026 in G
const X = uuid(2)        // Charge in G2

const bb = hooksMoeglich ? await laden('lib/behoerden/bewegungsbuch.ts') : null
const j = () => laden('lib/journal/journal.ts')

const charge = (id, teil) => ({
  id, tenant_id: T, name: id === C ? 'UAT-GV2026' : 'Andere', behaelter_id: G, jahrgang: 2026, menge_liter: 0, aktiv: true,
  ist_eroeffnungsbestand: false, anfangsbestand_liter: null, created_at: '2026-09-01T08:00:00Z', transaktions_nr: null,
  storniert_am: null, storno_grund: null, storniert_von_name: null, ...teil,
})
const pressung = (id, weinausbau_id, menge_liter, behaelter_id = G) => ({
  id, weinausbau_id, behaelter_id, menge_liter, notizen: null, storniert_am: null, storno_grund: null, storniert_von_name: null,
  pressung: { id: `p-${id}`, datum: '2026-10-01', notizen: null, tenant_id: T, storniert_am: null },
})
const journal = (id, teil) => ({
  id, tenant_id: T, beleg_nr: 7, pos: 1, datum: '2026-10-10', buchungsart_code: 'INV_MIN', bestand: 'offen', weinausbau_id: C,
  menge_liter: -50, storno_von_id: null, charge_name: 'UAT-GV2026', quelle_tabelle: 'weinausbau_bestand',
  hinweis: 'Bestandskorrektur ohne Bewegung (Abgleich Ist ↔ Journal)', ...teil,
})
const gebinde = { id: G, tenant_id: T, name: 'Tank 7', aktiv: true, fremd: false, eigen_liter: 160, fremd_liter: 0, eigentuemer_name: 'Musterhof' }

function befund() {
  return {
    weinausbau: [charge(C, { menge_liter: 160 }), charge(X, { behaelter_id: G2, menge_liter: 300 })],
    pressung_behaelter: [pressung(uuid(11), C, 210), pressung(uuid(12), X, 300, G2)],
    kellerbuch_buchungen: [
      journal(uuid(21)),
      // andere Journalzeilen (Pressung, andere Charge, Flaschen, anderer Betrieb) gehören nicht dazu
      journal(uuid(22), { quelle_tabelle: 'pressung_behaelter', buchungsart_code: 'ERNTE', menge_liter: 210 }),
      journal(uuid(23), { weinausbau_id: X, menge_liter: -20 }),
      journal(uuid(24), { bestand: 'flasche', menge_liter: -5 }),
      journal(uuid(25), { tenant_id: ANDERER, menge_liter: -99 }),
    ],
  }
}
const db = t => datenbank(t, { rpc: name => (name === 'lade_behaelter' ? { data: [gebinde], error: null } : { data: null, error: { message: name } }) })

describe('KAN-376: Bestandskorrektur aus dem Abgleich im Behälter-Bewegungsbuch', nurMitHooks, () => {
  test('Befund nachgebaut: Saldo = Ist (160 L), keine Differenz, eigene Zeile „Bestandskorrektur (Inventur −)“', async () => {
    const b = await bb.ladeBewegungsbuch(db(befund()), T, { behaelterId: G, von: null, bis: null })
    assert.deepEqual(b.bewegungen.map(x => [x.art, x.menge, x.saldo]), [['pressung', 210, 210], ['bestandskorrektur', -50, 160]])
    const k = b.bewegungen[1]
    assert.equal(k.beschreibung, 'Bestandskorrektur (Inventur −)')
    assert.equal(k.datum, '2026-10-10')
    assert.equal(k.charge, 'UAT-GV2026')
    assert.equal(k.beleg, 'Journal 7')
    assert.equal(b.finalSaldo, 160)            // vorher 210
    assert.equal(b.gebuchterBestand, 160)
    assert.equal(b.nichtVerbuchterSchwund, 0)  // vorher 50 – Anlass für die doppelte „Nachbuchung“
    assert.equal(b.literByCharge[C], 160)
  })

  test('Behördenmeldung Bewegungsbuch (CSV/Druck): dieselbe Zeile mit Art „Bestandskorrektur“ als Abgang', async () => {
    const b = await bb.ladeBewegungsbuch(db(befund()), T, { behaelterId: G, von: '2026-10-05', bis: null })
    const z = bb.bewegungsbuchZeilen(b)
    assert.deepEqual(z.map(r => [r.art, r.zugang, r.abgang, r.saldo]), [['Übertrag', null, null, 210], ['Bestandskorrektur', null, 50, 160]])
    assert.equal(bb.BEWEGUNGSART_LABEL.bestandskorrektur, 'Bestandskorrektur')
    assert.equal(z[1].hinweis, 'Bestandskorrektur ohne Bewegung (Abgleich Ist ↔ Journal)')
  })

  test('Inventur + und storniert: Korrektur bleibt am Tag stehen, Gegenbuchung am Storno-Tag, Saldo wieder ohne Korrektur', async () => {
    const t = befund()
    t.weinausbau[0].menge_liter = 210
    t.kellerbuch_buchungen.push(journal(uuid(26), { datum: '2026-10-12', menge_liter: 50, storno_von_id: uuid(21), beleg_nr: 9, hinweis: 'Storno' }))
    const b = await bb.ladeBewegungsbuch(db(t), T, { behaelterId: G, von: null, bis: null })
    assert.deepEqual(b.bewegungen.map(x => [x.art, x.datum, x.menge, x.saldo]),
      [['pressung', '2026-10-01', 210, 210], ['bestandskorrektur', '2026-10-10', -50, 160], ['bestandskorrektur', '2026-10-12', 50, 210]])
    assert.equal(bb.stornoText(b.bewegungen[1]), 'storniert am 12.10.2026')
    assert.equal(bb.stornoText(b.bewegungen[2]), 'Gegenbuchung (Storno) zur Buchung vom 10.10.2026')
    assert.equal(b.nichtVerbuchterSchwund, 0)
    assert.equal(bb.bestandskorrekturText('INV_PLUS', 10), 'Bestandskorrektur (Inventur +)')
    assert.equal(bb.bestandskorrekturText(null, -3), 'Bestandskorrektur (Inventur −)')
  })

  test('Chargenseite: Kontroll-Saldo enthält die Korrektur – keine Abweichung mehr (KAN-342)', async () => {
    const bew = await bb.ladeBewegungenCharge(db(befund()), T, C)
    assert.deepEqual(bew.map(x => [x.art, x.saldo]), [['pressung', 210], ['bestandskorrektur', 160]])
    assert.equal(bb.bestandsAbweichungDerCharge(bew, 160), null)
  })

  test('Zuordnung zum Gebinde über den Belegungszeitraum der Charge', () => {
    const bel = [
      { chargeId: 'hier', charge: 'H', von: '2026-10-05', bis: null },
      { chargeId: 'weg', charge: 'W', von: '2026-10-01', bis: '2026-10-05' },
    ]
    const k = (id, weinausbau_id, datum, storno_von_id = null) => ({ id, weinausbau_id, datum, storno_von_id })
    const korr = [
      k('a', 'hier', '2026-10-01'),   // vor der Belegung hier
      k('b', 'hier', '2026-10-06'),
      k('c', 'weg', '2026-10-03'),    // innerhalb der Belegung
      k('d', 'weg', '2026-10-08'),    // danach – gehört ins neue Gebinde
      k('e', 'weg', '2026-10-09', 'c'),   // Storno folgt seiner Korrektur
      k('f', 'neu', '2026-10-06'),    // Charge ohne Belegung hier
    ]
    assert.deepEqual(bb.korrekturenImGebinde(korr, bel, [{ id: 'hier' }]).map(x => x.id), ['b', 'c', 'e'])
    // Charge heute im Gebinde ohne Mengenbewegung: alle Korrekturen
    assert.deepEqual(bb.korrekturenImGebinde([k('g', 'hier', '2026-09-01')], [], [{ id: 'hier' }]).map(x => x.id), ['g'])
  })

  test('Abfrage: nur eigener Betrieb, nur quelle_tabelle weinausbau_bestand und offener Bestand', () => {
    const s = quelle('src/lib/behoerden/bewegungsbuch.ts')
    const i = s.indexOf("from('kellerbuch_buchungen')")
    const kette = s.slice(i, s.indexOf("'kellerbuch_buchungen'),", i))
    for (const m of [".eq('tenant_id', tenantId)", ".eq('quelle_tabelle', 'weinausbau_bestand')", ".eq('bestand', 'offen')", ".in('weinausbau_id', ids)", ".order('id'"]) {
      assert.ok(kette.includes(m), m)
    }
    // Bestandsmeldung/BSM bleiben unverändert
    assert.match(s, /bestandskorrekturen: \[\],/)
  })
})

describe('KAN-376: Schwund im Behälter-Bewegungsbuch mindert immer den Bestand', () => {
  const seite = quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/bewegungen/page.tsx')
  const actions = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
  test('Seite nutzt schwundBuchen (Chargen-Weg) samt Formular mit Begründung, keine Nachbuchung mehr', () => {
    assert.match(seite, /import \{ schwundBuchen \} from '\.\.\/\.\.\/\.\.\/actions'/)
    assert.match(seite, /<SchwundBuchenForm key=\{c\.id\}/)
    assert.match(seite, /action=\{schwundBuchen\.bind\(null, c\.id as string\)\}/)
    assert.doesNotMatch(seite, /manuellSchwundBuchen|Nachbuchung\)|Schwund nachbuchen|ändert sich\s+dabei nicht/)
  })
  test('manuellSchwundBuchen entfernt; kein schwund_buchen mit p_bestand_mindern: false mehr in der App', () => {
    assert.doesNotMatch(actions, /export async function manuellSchwundBuchen/)
    const i = actions.indexOf('export async function schwundBuchen(')
    const rumpf = actions.slice(i, actions.indexOf('\n}\n', i))
    assert.match(rumpf, /p_bestand_mindern: true/)
    assert.match(rumpf, /schwundGrundFehler\(notiz\)/)
    assert.match(rumpf, /kellerbuchSchreibrecht\(\['kellerbuch', 'warenwirtschaft'\]\)/)
  })
  test('Formular: Überschrift je Charge möglich, Standard „Schwund buchen“', () => {
    const f = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/SchwundBuchenForm.tsx')
    assert.match(f, /titel = 'Schwund buchen'/)
  })
})

describe('KAN-376: Journal – Mengen, Schwund, Links', nurMitHooks, () => {
  test('beschreibung: keine „0 L“, „€ 0“ oder „0 Fl.“', async () => {
    const { beschreibung } = await j()
    assert.equal(beschreibung({ datum: '2026-10-22', menge_liter: 0 }), '22.10.2026')   // Befund „22.10.2026 · 0 L“
    assert.equal(beschreibung({ datum: '2026-10-22', menge_liter: '0.000' }), '22.10.2026')
    assert.equal(beschreibung({ name: 'X', betrag: 0, anzahl_flaschen: 0, menge_kg: 0 }), 'X')
    assert.equal(beschreibung({ name: 'GV', menge_liter: 12.5 }), 'GV · 12,5 L')
  })
  test('beschreibung: Schwundbuchung zeigt die Schwundmenge aus dem nachgeladenen Datensatz', async () => {
    const { beschreibung } = await j()
    const kennung = { datum: '2026-10-22', menge_liter: 0 }
    assert.equal(beschreibung(kennung, null, null, { umzug_typ: 'schwund', menge_liter: 0, schwund_liter: 50, brutto_liter: 50 }), '22.10.2026 · Schwund 50 L')
    assert.equal(beschreibung(kennung, null, null, { umzug_typ: 'schwund', menge_liter: 0, schwund_liter: null, brutto_liter: 7.5 }), '22.10.2026 · Schwund 7,5 L')
    // normaler Umzug: Menge wie bisher
    assert.equal(beschreibung({ datum: '2026-10-22', menge_liter: 300 }, null, null, { umzug_typ: 'umzug', schwund_liter: 0 }), '22.10.2026 · 300 L')
  })
  test('Links über den Elterndatensatz; ohne Datensatz (gelöscht) bzw. bei Löschung kein Link', async () => {
    const { journalLink } = await j()
    const faelle = [
      ['keller_umzuege', { von_weinausbau_id: 'w1', nach_weinausbau_id: 'w2' }, '/kellerbuch/weinausbau/w1'],
      ['keller_umzuege', { von_weinausbau_id: null, nach_weinausbau_id: 'w2' }, '/kellerbuch/weinausbau/w2'],
      ['verschneidungen', { ziel_weinausbau_id: 'w3' }, '/kellerbuch/weinausbau/w3'],
      ['verschneidung_quellen', { verschneidung: { ziel_weinausbau_id: 'w3' } }, '/kellerbuch/weinausbau/w3'],
      ['keller_behandlungen', { weinausbau_id: 'w4', behaelter_id: 'b1' }, '/kellerbuch/weinausbau/w4'],
      ['keller_behandlungen', { weinausbau_id: null, behaelter_id: 'b1' }, '/kellerbuch/behaelter/b1/behandlungen'],
      ['fuellung_chargen', { fuellung_id: 'f1' }, '/weinhandel/fuellungen/f1/edit'],
      ['fuellung_bewegungen', { fuellung_id: 'f1' }, '/weinhandel/fuellungen/f1/edit'],
      ['verkauf_positionen', { verkaufsposten_id: 'v1' }, '/weinhandel/verkauf/v1'],
      ['zahlungen', { verkaufsposten_id: 'v1', rechnung_id: 'r1' }, '/weinhandel/verkauf/v1'],
      ['zahlungen', { verkaufsposten_id: null, rechnung_id: 'r1' }, '/weinhandel/rechnungen/r1'],
      ['transportbescheinigungen', { verkaufsposten_id: 'v1' }, '/weinhandel/verkauf/v1/transportbescheinigung'],
      ['pressungen', { jahrgang_id: 'j1', lese_id: 'l1' }, '/kellerbuch/pressungen?jahrgang=j1&lese=l1'],
      ['pressung_behaelter', { weinausbau_id: 'w5', pressung: { jahrgang_id: 'j1', lese_id: 'l1' } }, '/kellerbuch/weinausbau/w5'],
      ['pressung_weingaerten', { pressung: { jahrgang_id: 'j1', lese_id: null } }, '/kellerbuch/pressungen?jahrgang=j1'],
      ['ernte_parzellen', { jahrgang_id: 'j1', lese_id: 'l1' }, '/erntemeldung/j1?lese=l1'],
      ['lesen', { jahrgang_id: 'j1' }, '/erntemeldung/j1?lese=x'],
      ['traubenverkauf', { verkaufsposten_id: 'v2' }, '/weinhandel/verkauf/v2'],
      ['ama_erntemeldungen', { jahrgang_id: 'j1' }, '/erntemeldung/j1'],
      ['weinanalysen', { weinausbau_id: 'w6' }, '/kellerbuch/weinausbau/w6/analysen'],
      ['pruefnummernantraege', { dac_antrag_id: 'd1' }, '/dac/d1/antrag'],
      ['grundstuecke', { weingarten_id: 'g1' }, '/weingarten/g1'],
    ]
    for (const [t, d, erwartet] of faelle) {
      assert.equal(journalLink(t, 'x', 'anlage', d), erwartet, t)
      assert.equal(journalLink(t, 'x', 'loeschung', d), null, `${t}: Löschung`)
    }
    for (const t of ['keller_umzuege', 'verschneidung_quellen', 'fuellung_bewegungen', 'pressungen', 'ernte_parzellen', 'grundstuecke']) {
      assert.equal(journalLink(t, 'x', 'anlage', null), null, `${t}: ohne nachgeladenen Datensatz kein Link`)
    }
    assert.equal(journalLink('ea_uva', 'x', 'aenderung'), '/buchhaltung/uva')
    assert.equal(journalLink('psm_lager_bewegungen', 'x', 'storno'), '/behandlungen/lager')
  })
  test('jeder Link zeigt auf eine vorhandene Seite', async () => {
    const { journalLink, TABELLE_LABEL } = await j()
    const voll = { von_weinausbau_id: 'i', ziel_weinausbau_id: 'i', weinausbau_id: 'i', behaelter_id: 'i', fuellung_id: 'i', verkaufsposten_id: 'i',
      rechnung_id: 'i', jahrgang_id: 'i', lese_id: 'i', dac_antrag_id: 'i', weingarten_id: 'i', verschneidung: { ziel_weinausbau_id: 'i' }, pressung: { jahrgang_id: 'i' } }
    let mitLink = 0
    for (const t of Object.keys(TABELLE_LABEL)) {
      const l = journalLink(t, 'i', 'anlage', voll)
      if (!l) continue
      mitLink++
      const pfad = l.split('?')[0].replace(/\/i(?=\/|$)/g, '/[id]')
      assert.ok(existsSync(new URL(`../../src/app/(dashboard)${pfad}/page.tsx`, import.meta.url)), `${t}: ${pfad}`)
    }
    assert.ok(mitLink >= 38, `zu wenige Tabellen mit Link (${mitLink})`)
  })
  test('journalZeilen nutzt die nachgeladenen Daten; nachzuladendeIds ohne Löschungen und ohne fremde Tabellen', async () => {
    const { journalZeilen, nachzuladendeIds } = await j()
    const roh = [
      { id: 1, tabelle: 'keller_umzuege', datensatz_id: 'u1', aktion: 'INSERT', kennung: { datum: '2026-10-22', menge_liter: 0 }, erstellt_am: '2026-10-22T08:00:00Z' },
      { id: 2, tabelle: 'keller_umzuege', datensatz_id: 'u2', aktion: 'DELETE', kennung: null, alt: { datum: '2026-10-01' }, erstellt_am: '2026-10-22T08:00:00Z' },
      { id: 3, tabelle: 'weinausbau', datensatz_id: 'w1', aktion: 'INSERT', kennung: { name: 'GV' }, erstellt_am: '2026-10-22T08:00:00Z' },
    ]
    assert.deepEqual([...nachzuladendeIds(roh)], [['keller_umzuege', ['u1']]])
    const daten = new Map([['keller_umzuege', new Map([['u1', { id: 'u1', von_weinausbau_id: 'w1', umzug_typ: 'schwund', menge_liter: 0, schwund_liter: 50 }]])]])
    const z = journalZeilen(roh, new Map(), daten)
    assert.equal(z[0].beschreibung, '22.10.2026 · Schwund 50 L')
    assert.equal(z[0].link, '/kellerbuch/weinausbau/w1')
    assert.equal(z[1].link, null)
    assert.equal(z[2].link, '/kellerbuch/weinausbau/w1')
  })
  test('laden.ts: Nachladen in Blöcken, mit Betriebsfilter, Fehler ausgewertet; Tabellen ohne tenant_id über die Elternzeile', async () => {
    const s = quelle('src/lib/journal/laden.ts')
    assert.match(s, /const daten = await ladeJournalDaten\(supabase, ctx\.tenantId, prot\.data\)/)
    assert.match(s, /inBloecken<R>\(ids, b => alle<R>\(/)
    assert.match(s, /\.eq\(mandant, tenantId\)/)
    assert.match(s, /if \(error\) throw new AktionsFehler/)
    const { JOURNAL_NACHLADEN } = await j()
    for (const [t, m] of [['verschneidung_quellen', 'verschneidung.tenant_id'], ['pressung_behaelter', 'pressung.tenant_id'],
      ['pressung_weingaerten', 'pressung.tenant_id'], ['ernte_parzellen', 'jahrgang.tenant_id']]) {
      assert.equal(JOURNAL_NACHLADEN[t].mandant, m, t)
      assert.match(JOURNAL_NACHLADEN[t].spalten, /!inner\(tenant_id/, t)
    }
  })
})
