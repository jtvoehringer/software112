// Abdeckung kleiner Bausteine unter 70 % Branches (STABILITAET.md, Lücke 5; KAN-248, 09.10.2026):
//  - lib/finanzen/stornoGegenzeile.ts: Gegenzeile am Storno-Tag in Wien (Mitternacht, Zeitumstellung) – daran hängt der
//    laufende Saldo in Kassabuch und Kontoabstimmung (§ 131 BAO)
//  - lib/stammdaten/bezuege.ts: Bezüge per RPC (nur Werte > 0, Fehler als Meldung), Löschsperre der Datenbank erkennen
//  - lib/handel/partnerLaden.ts: Firma vor Kontakt, ohne Partner, nicht gefunden
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'
import { mitStornoGegenzeile, wienTag } from '../../src/lib/finanzen/stornoGegenzeile.ts'

hooksRegistrieren()
const bezuege = hooksMoeglich ? await laden('lib/stammdaten/bezuege.ts') : null
const partner = hooksMoeglich ? await laden('lib/handel/partnerLaden.ts') : null
const T = '00000000-0000-4000-8000-000000000001'

describe('Storno-Gegenzeile (Kassabuch, Kontoabstimmung)', () => {
  const z = { id: 'z1', datum: '2026-03-20', betrag: 50, text: 'Zahlung RE 7' }

  test('ohne Storno: nur die Bewegung, unverändert', () => {
    assert.deepEqual(mitStornoGegenzeile(z, { storniertAm: null }, 'text'), [z])
  })

  test('mit Storno: Vermerk an der Bewegung, Gegenzeile mit umgekehrtem Betrag, eigener id, Grund und Zusatzfeldern', () => {
    const [b, g] = mitStornoGegenzeile(z, { storniertAm: '2026-03-25T09:00:00Z', grund: 'Doppelt erfasst' }, 'text', { abgeglichen: false })
    assert.deepEqual(b, { ...z, text: 'Zahlung RE 7 (storniert am 25.03.2026)' })
    assert.deepEqual(g, { ...z, abgeglichen: false, id: 'z1:storno', datum: '2026-03-25', betrag: -50, text: 'Storno: Zahlung RE 7 – Doppelt erfasst' })
  })

  test('Storno kurz nach Mitternacht in Wien zählt zum Wiener Tag – im Winter (UTC+1) und im Sommer (UTC+2)', () => {
    assert.equal(wienTag('2026-01-14T23:30:00Z'), '2026-01-15')   // 00:30 MEZ
    assert.equal(wienTag('2026-07-14T22:30:00Z'), '2026-07-15')   // 00:30 MESZ
    assert.equal(wienTag('2026-07-14T21:30:00Z'), '2026-07-14')   // 23:30 MESZ
    assert.equal(wienTag('2026-03-29T00:30:00Z'), '2026-03-29')   // Tag der Umstellung auf Sommerzeit
  })

  test('ohne Grund: Gegenzeile nur mit „Storno:“, negativer Betrag wird positiv', () => {
    const [, g] = mitStornoGegenzeile({ ...z, betrag: -12.5 }, { storniertAm: '2026-03-25T09:00:00Z' }, 'text')
    assert.equal(g.text, 'Storno: Zahlung RE 7')
    assert.equal(g.betrag, 12.5)
  })
})

describe('Bezüge von Stammdaten', nurMitHooks, () => {
  test('RPC-Ergebnis: nur Werte > 0, Zahlen aus Text', async () => {
    const db = datenbank({}, { rpc: () => ({ data: { 'Maßnahmen': 3, 'Chargen': 0, 'Lese': '2' }, error: null }) })
    assert.deepEqual(await bezuege.ladeBezuege(db, T, 'weingarten', 'w1'), { 'Maßnahmen': 3, 'Lese': 2 })
    assert.deepEqual(db.aufrufe[0].werte, { p_tenant_id: T, p_tabelle: 'weingarten', p_id: 'w1' })
  })

  test('RPC-Fehler → verständliche Meldung statt „kein Bezug“ (sonst ginge das Löschen an die Datenbank)', async () => {
    const db = datenbank({}, { rpc: () => ({ data: null, error: { code: 'XX000', message: 'kaputt' } }) })
    await assert.rejects(bezuege.ladeBezuege(db, T, 'kontakte', 'k1'), /Bezüge konnten nicht geprüft werden: kaputt/)
  })

  test('leeres Ergebnis → kein Bezug', async () => {
    const db = datenbank({}, { rpc: () => ({ data: null, error: null }) })
    assert.deepEqual(await bezuege.ladeBezuege(db, T, 'firmen', 'f1'), {})
  })

  test('Löschsperre des Triggers erkennen – nur 42501 mit „deaktivieren statt löschen“', () => {
    assert.equal(bezuege.istBezugsSperre({ code: '42501', message: 'Ried hat Bezüge – deaktivieren statt löschen' }), true)
    assert.equal(bezuege.istBezugsSperre({ code: '42501', message: 'permission denied for table weingarten' }), false)
    assert.equal(bezuege.istBezugsSperre({ code: '23503', message: 'deaktivieren statt löschen' }), false)
    assert.equal(bezuege.istBezugsSperre(null), false)
  })
})

describe('Partner für die Pflichtprüfung (Verkauf, Traubenverkauf, Zukauf)', nurMitHooks, () => {
  const db = () => datenbank({
    firmen: [{ id: 'f1', tenant_id: T, name: 'Vinothek', betrieb_nr: '123' }],
    kontakte: [{ id: 'k1', tenant_id: T, vorname: 'Anna', nachname: 'Huber', betrieb_nr: null }],
    crm_freigaben: [],
  })

  test('ohne Partner: nicht vorhanden, keine Abfrage', async () => {
    const d = db()
    assert.deepEqual(await partner.ladePartner(d, T, null, null), { vorhanden: false, name: null, betriebNr: null })
    assert.deepEqual(d.aufrufe, [])
  })

  test('Firma vor Kontakt; Kontakt mit zusammengesetztem Namen', async () => {
    assert.deepEqual(await partner.ladePartner(db(), T, 'k1', 'f1'), { vorhanden: true, name: 'Vinothek', betriebNr: '123' })
    assert.deepEqual(await partner.ladePartner(db(), T, 'k1', null), { vorhanden: true, name: 'Anna Huber', betriebNr: null })
  })

  test('nicht gefunden (anderer Betrieb, gelöscht) → Meldung statt leerem Partner', async () => {
    await assert.rejects(partner.ladePartner(db(), T, null, 'f-fremd'), /Firma wurde nicht gefunden/)
    await assert.rejects(partner.ladePartner(db(), T, 'k-fremd', null), /Kontakt wurde nicht gefunden/)
  })
})
