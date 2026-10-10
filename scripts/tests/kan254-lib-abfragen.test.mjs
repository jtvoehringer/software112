// KAN-254 (09.10.2026): Abfragen in src/lib werten ihren Fehler aus – Folge von KAN-251/252/253.
// Hier: der Wächter erfasst src/lib, und Regressionen der folgenreichsten Stellen (alle ohne den Fix rot):
//   - pruefeBenutzerlimit: Lesefehler hieß „max_benutzer NULL = unbegrenzt“ → das Limit war ausgehebelt
//   - ladeAbsenderIndex: Lesefehler ergab einen leeren Index, der 60 s zwischengespeichert wurde
//   - ladeRechnungsKontext: Lesefehler hieß „kein Lieferschein“ bzw. zu wenige Positionen (Zahlungen, E&A)
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { pruefeWurzel } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))

describe('check-einzelabfrage: src/lib wird geprüft', () => {
  test('Abfrage ohne error in src/lib → Fund (seit Sweep 91 auch src/components); außerhalb von lib/app/components → nicht', () => {
    const wurzel = mkdtempSync(path.join(tmpdir(), 's112-kan254-'))
    try {
      const abfrage = `export async function f(s) {\n  const { data } = await s.from('t').select('id').eq('a', 1)\n  return data\n}\n`
      mkdirSync(path.join(wurzel, 'src', 'lib', 'x'), { recursive: true })
      mkdirSync(path.join(wurzel, 'src', 'components'), { recursive: true })
      mkdirSync(path.join(wurzel, 'src', 'typen'), { recursive: true })
      writeFileSync(path.join(wurzel, 'src', 'lib', 'x', 'laden.ts'), abfrage)
      writeFileSync(path.join(wurzel, 'src', 'components', 'Anzeige.ts'), abfrage)
      writeFileSync(path.join(wurzel, 'src', 'typen', 'Muster.ts'), abfrage)
      const e = pruefeWurzel(wurzel)
      assert.deepEqual(e.funde.map(f => f.split('  ')[0]).sort(), ['src/components/Anzeige.ts:2', 'src/lib/x/laden.ts:2'])
    } finally { rmSync(wurzel, { recursive: true, force: true }) }
  })
})

hooksRegistrieren()
const pakete = hooksMoeglich ? await laden('lib/pakete-server.ts') : null
const absender = hooksMoeglich ? await laden('lib/crm/absender.ts') : null
const rk = hooksMoeglich ? await laden('lib/verkauf/rechnungsKontext.ts') : null

const T = 't1'
const fehlerBei = (tabelle, art = 'select') => e => (e.tabelle === tabelle && e.art === art ? { error: { message: 'Zeitüberschreitung' } } : null)

describe('KAN-254: Lesefehler in Bibliotheken', nurMitHooks, () => {
  test('Benutzerlimit: Lesefehler → nicht erlaubt, mit Klartext (nie „unbegrenzt“)', async () => {
    const daten = () => ({ tenants: [{ id: T, max_benutzer: 3 }], tenant_memberships: [{ id: 'm1', tenant_id: T, role: 'winzer', aktiv: true }] })
    for (const tab of ['tenants', 'tenant_memberships']) {
      const s = await pakete.pruefeBenutzerlimit(datenbank(daten(), { vorher: fehlerBei(tab) }), T)
      assert.equal(s.erlaubt, false, tab)
      assert.match(pakete.benutzerlimitFehler(s), /Benutzerlimit konnte nicht geprüft werden: Zeitüberschreitung/)
    }
    const ok = await pakete.pruefeBenutzerlimit(datenbank(daten()), T)
    assert.deepEqual([ok.erlaubt, ok.limit, ok.anzahl, ok.fehler], [true, 3, 1, undefined])
    const voll = await pakete.pruefeBenutzerlimit(datenbank({ ...daten(), tenants: [{ id: T, max_benutzer: 1 }] }), T)
    assert.match(pakete.benutzerlimitFehler(voll), /Benutzerlimit erreicht: Ihr Paket umfasst 1 Benutzer/)
  })

  test('Absender-Index: Lesefehler wirft und wird nicht zwischengespeichert – der nächste Aufruf lädt neu', async () => {
    absender.absenderIndexVerwerfen()
    const daten = () => ({
      kontakte: [{ id: 'k1', tenant_id: T, aktiv: true, vorname: 'Max', nachname: 'Gast', email: 'max@gastro.at', email_weitere: [], accountnummer: null, is_lead: false, firma_id: null }],
      firmen: [], email_lead_ignoriert: [],
    })
    await assert.rejects(absender.ladeAbsenderIndex(datenbank(daten(), { vorher: fehlerBei('kontakte') }), T), /Absender-Erkennung konnten nicht geladen werden/)
    const idx = await absender.ladeAbsenderIndex(datenbank(daten()), T)
    assert.equal(absender.absenderStatus(idx, 'max@gastro.at').status, 'kontakt', 'kein leerer Index aus dem Zwischenspeicher')
  })

  test('Rechnungskontext: Lesefehler wirft statt „kein Lieferschein“ bzw. zu wenige Positionen', async () => {
    const daten = () => ({
      verkaufsposten: [
        { id: 'ls1', tenant_id: T, rechnung_id: 'r1', rechnungsnummer: 'RE-1', positionen: [{ preis_brutto: 10, menge: 1 }] },
        { id: 'ls2', tenant_id: T, rechnung_id: 'r1', rechnungsnummer: 'RE-1', positionen: [{ preis_brutto: 20, menge: 1 }] },
      ],
    })
    let n = 0
    const zweiterFehler = datenbank(daten(), { vorher: e => (e.tabelle === 'verkaufsposten' && ++n === 2 ? { error: { message: 'weg' } } : null) })
    await assert.rejects(rk.ladeRechnungsKontext(zweiterFehler, T, 'ls1', 'preis_brutto, menge'), /Lieferscheine der Rechnung konnten nicht geladen werden: weg/)
    await assert.rejects(rk.ladeRechnungsKontext(datenbank(daten(), { vorher: fehlerBei('verkaufsposten') }), T, 'ls1', 'preis_brutto, menge'), /Lieferschein konnte nicht geladen werden/)
    const k = await rk.ladeRechnungsKontext(datenbank(daten()), T, 'ls1', 'preis_brutto, menge')
    assert.deepEqual(k.lieferscheinIds.sort(), ['ls1', 'ls2'])
    assert.equal(k.positionen.length, 2)
  })
})
