// Server Actions Konten und Kellerbuch (STABILITAET.md, Lücke 4; KAN-241, 08.10.2026):
//  - konten/actions.ts: Kontext, Admin-Vorgänge, Umbuchung (Konten, Betrag, Datum heute in Wien), Storno, Abgleich
//  - kellerbuch/actions.ts und kellerbuch/kellerplan/actions.ts: JEDE schreibende Action prüft das Schreibrecht vorab
//    wie die RLS der Tabelle (vorher prüften Gebinde, Charge bearbeiten, Analyse, Schwund und Kellerplan nur per RLS –
//    ein Leser bekam eine technische Fehlermeldung).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}')
DOPPEL['@/lib/auth/modul'] = modul("export const pruefeModul = async f => { if ((globalThis.__modulAus ?? []).includes(f)) { const e = new Error('Modul aus: ' + f); e.name = 'AktionsFehler'; throw e } }; export const hatModul = async () => true")
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()

const konten = hooksMoeglich ? await laden('app/(dashboard)/konten/actions.ts') : null
const keller = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/actions.ts') : null
const plan = hooksMoeglich ? await laden('app/(dashboard)/kellerbuch/kellerplan/actions.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const K1 = '00000000-0000-4000-8000-0000000000a1', K2 = '00000000-0000-4000-8000-0000000000a2'
const formular = f => { const fd = new FormData(); for (const [k, w] of Object.entries(f)) fd.set(k, w); return fd }
const als = (role, schreibmodule = []) => { globalThis.__membership = { tenantId: T, role, schreibmodule } }
const db = (t = {}) => datenbank({ konten: [], konto_umbuchungen: [], ...t }, { rpc: () => ({ data: null, error: null }) })
const schreib = d => d.aufrufe.filter(a => a.art !== 'select')
const RECHTE = /Keine Schreibberechtigung für das Kellerbuch/

beforeEach(() => { als('tenant_admin'); globalThis.__modulAus = [] })

describe('Konten (konten/actions.ts)', nurMitHooks, () => {
  test('ohne Mandant bzw. ohne E&A-Modul: Abbruch vor jedem Zugriff', async () => {
    globalThis.__membership = null
    let d = db(); globalThis.__serverFake = d
    await assert.rejects(konten.createUmbuchung(formular({})), /Kein Mandant/)
    als('tenant_admin'); globalThis.__modulAus = ['modul_ea']
    await assert.rejects(konten.createKonto(formular({ name: 'Bank', eroeffnungsdatum: '2026-01-01' })), /Modul aus: modul_ea/)
    assert.deepEqual(d.aufrufe, [])
  })

  test('Konto anlegen und deaktivieren nur Betriebsleitung; Pflichtfelder; Typ standardmäßig Giro', async () => {
    als('winzer', ['ea'])
    let d = db(); globalThis.__serverFake = d
    assert.match((await konten.createKonto(formular({ name: 'Bank', eroeffnungsdatum: '2026-01-01' }))).error, /nur Admins/)
    assert.match((await konten.deaktiviereKonto(K1)).error, /Keine Berechtigung/)
    assert.deepEqual(schreib(d), [])
    als('tenant_admin')
    assert.deepEqual(await konten.createKonto(formular({ name: '' , eroeffnungsdatum: '2026-01-01' })), { error: 'Pflichtfelder fehlen' })
    assert.deepEqual(await konten.createKonto(formular({ name: 'Raiffeisen', eroeffnungsdatum: '2026-01-01', eroeffnungssaldo: '1.234,50' })), { ok: true })
    assert.deepEqual([d.tabellen.konten[0].typ, d.tabellen.konten[0].eroeffnungssaldo], ['giro', 1234.5])
  })

  test('Umbuchung: Freigabe E&A, zwei verschiedene Konten, Betrag > 0, Datum ohne Angabe = heute in Wien', async () => {
    als('winzer', ['warenwirtschaft'])
    let d = db(); globalThis.__serverFake = d
    assert.deepEqual(await konten.createUmbuchung(formular({ von_konto_id: K1, nach_konto_id: K2, betrag: '10' })), { error: 'Keine Berechtigung.' })
    als('winzer', ['ea'])
    assert.deepEqual(await konten.createUmbuchung(formular({ von_konto_id: K1, betrag: '10' })), { error: 'Bitte beide Konten wählen.' })
    assert.deepEqual(await konten.createUmbuchung(formular({ von_konto_id: K1, nach_konto_id: K1, betrag: '10' })), { error: 'Von- und Nach-Konto müssen unterschiedlich sein.' })
    for (const b of ['0', '-5', '']) assert.deepEqual(await konten.createUmbuchung(formular({ von_konto_id: K1, nach_konto_id: K2, betrag: b })), { error: 'Ungültiger Betrag.' })
    assert.deepEqual(schreib(d), [])
    const { heuteWien } = await laden('lib/datum/wien.ts')
    assert.deepEqual(await konten.createUmbuchung(formular({ von_konto_id: K1, nach_konto_id: K2, betrag: '250,00' })), { ok: true })
    assert.deepEqual([d.tabellen.konto_umbuchungen[0].betrag, d.tabellen.konto_umbuchungen[0].datum], [250, heuteWien()])
  })

  test('Umbuchung stornieren: Grund ≥ 10 Zeichen vor jedem Zugriff, getrimmt an die RPC', async () => {
    const d = db(); globalThis.__serverFake = d
    assert.match((await konten.stornoUmbuchung('u', K1, K2, 'kurz')).error, /mindestens 10 Zeichen|Grund/)
    assert.deepEqual(d.aufrufe, [])
    assert.deepEqual(await konten.stornoUmbuchung('u', K1, K2, ' Falsches Konto gewählt '), { ok: true })
    assert.deepEqual(d.aufrufe.find(a => a.tabelle === 'rpc:s112_umbuchung_stornieren').werte, { p_tenant_id: T, p_id: 'u', p_grund: 'Falsches Konto gewählt' })
  })

  test('Abgleich-Häkchen: nur mit Freigabe E&A', async () => {
    als('leser')
    const d = db(); globalThis.__serverFake = d
    assert.deepEqual(await konten.setzeAbgeglichen(K1, 'zahlung', 'z', true), { error: 'Keine Berechtigung.' })
    assert.deepEqual(schreib(d), [])
  })
})

describe('Kellerbuch: Schreibrecht vorab in jeder Action (KAN-241)', nurMitHooks, () => {
  // [Name, Aufruf, Module, die die RLS der Tabelle zulässt]
  const faelle = [
    ['Gebinde anlegen', () => keller.createBehaelter(formular({ name: 'T1' })), ['kellerbuch']],
    ['Gebinde bearbeiten', () => keller.updateBehaelter('b', formular({ name: 'T1' })), ['kellerbuch']],
    ['Gebinde löschen', () => keller.deleteBehaelter('b'), ['kellerbuch']],
    ['Pickerl entfernen', () => keller.pickerlEntfernen('b'), ['kellerbuch']],
    ['Charge bearbeiten', () => keller.updateWeinausbau('w', formular({})), ['kellerbuch', 'rieden']],
    ['Analyse anlegen', () => keller.createAnalyse(formular({})), ['kellerbuch']],
    ['Schwund buchen', () => keller.schwundBuchen('w', formular({})), ['kellerbuch', 'warenwirtschaft']],
    // KAN-376: „Schwund manuell“ (manuellSchwundBuchen, Nachbuchung ohne Bestandsminderung) entfällt – das
    // Bewegungsbuch des Gebindes bucht Schwund über schwundBuchen (Fall oben)
    ['Kellerplan anlegen', () => plan.createKellerplan(formular({ name: 'Keller' })), ['kellerbuch']],
  ]
  for (const [name, aufruf, erlaubt] of faelle) {
    test(`${name}: Leser und Mitarbeiter ohne passende Freigabe abgelehnt, ohne Datenbankzugriff; erlaubt mit ${erlaubt.join(' oder ')}`, async () => {
      for (const m of [['leser', []], ['winzer', ['crm', 'ea']]]) {
        als(...m)
        const d = db(); globalThis.__serverFake = d
        await assert.rejects(aufruf(), RECHTE, `${name}: ${m[0]}`)
        assert.deepEqual(d.aufrufe, [], `${name}: ${m[0]} ohne Datenbankzugriff`)
      }
      for (const mod of erlaubt) {
        als('winzer', [mod])
        globalThis.__serverFake = db()
        // die Rechteprüfung lässt durch – was danach kommt (Pflichtfelder, Datenbank), ist hier egal
        await aufruf().then(() => {}, e => assert.doesNotMatch(String(e?.message), RECHTE, `${name}: ${mod} muss durchkommen`))
      }
    })
  }
})
