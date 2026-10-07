// KAN-206 (05.10.2026): Kellerbehandlung – Charge und Menge Pflicht, neue Typen eingestuft, Sperre bei Chargen mit
// Prüfnummer (nur Notizen/Storno), Kellerbuch-Periodensperre. Matrix KAN-85; DB-Test 33.
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
const r = hooksMoeglich ? await laden('lib/kellerbuch/behandlungRegeln.ts') : null

const PN = [{ weinausbau_id: 'c1', gueltig_ab: '2026-09-01', gueltig_bis: '2026-09-30' }, { weinausbau_id: 'c2', gueltig_ab: '2026-09-10', gueltig_bis: null }]

describe('KAN-206 Regeln', nurMitHooks, () => {
  test('Sperre: Charge am Behandlungstag mit gültiger Prüfnummer, Grenzen inklusive', () => {
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c1', datum: '2026-09-01' }, PN), true)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c1', datum: '2026-09-30' }, PN), true)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c1', datum: '2026-08-31' }, PN), false)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c1', datum: '2026-10-01' }, PN), false)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c2', datum: '2027-01-01T00:00:00' }, PN), true)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c3', datum: '2026-09-15' }, PN), false)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: null, datum: '2026-09-15' }, PN), false)
    assert.equal(r.behandlungPnGesperrt({ weinausbau_id: 'c2', datum: '2026-09-15', storniert_am: '2026-09-16' }, PN), false)
  })
  test('Charge: gewählt, einzige im Gebinde automatisch, mehrere → Fehler, leeres Gebinde ohne Charge', () => {
    assert.deepEqual(r.behandlungCharge('x', ['a', 'b']), { chargeId: 'x', fehler: null })
    assert.deepEqual(r.behandlungCharge(null, ['a']), { chargeId: 'a', fehler: null })
    assert.match(r.behandlungCharge(null, ['a', 'b']).fehler, /mehrere Chargen/)
    assert.deepEqual(r.behandlungCharge(null, []), { chargeId: null, fehler: null })
  })
  test('Menge Pflicht außer Einheit „-“, nicht negativ', () => {
    assert.match(r.behandlungMengeFehler(null, 'g'), /Menge angeben/)
    assert.match(r.behandlungMengeFehler(NaN, 'kg'), /Menge angeben/)
    assert.match(r.behandlungMengeFehler(-1, 'kg'), /negativ/)
    assert.equal(r.behandlungMengeFehler(0, '°C'), null)
    assert.equal(r.behandlungMengeFehler(null, '-'), null)
    assert.equal(r.behandlungMengeFehler(12.5, 'g'), null)
  })
  test('Neuer Typ: nur Pflege oder Veränderung', () => {
    assert.equal(r.neuerTypWirkungFehler('pflege'), null)
    assert.equal(r.neuerTypWirkungFehler('veraenderung'), null)
    assert.match(r.neuerTypWirkungFehler('unklar'), /pflegt oder verändert/)
    assert.match(r.neuerTypWirkungFehler(undefined), /pflegt oder verändert/)
  })
})

describe('KAN-206 Datenbank und App gleich', () => {
  const mig = () => {
    const dir = path.join(WURZEL, 'supabase/migrations')
    const f = readdirSync(dir).find(n => n.endsWith('_kan206_kellerbehandlung_sperre.sql'))
      ?? '../entwurf/kan206_kellerbehandlung_sperre.sql'
    return quelle(path.join('supabase/migrations', f))
  }
  test('Trigger: Grund, Positivliste und Periodensperre wie in behandlungRegeln.ts', async () => {
    const m = mig()
    const regeln = quelle('src/lib/kellerbuch/behandlungRegeln.ts')
    const grund = regeln.match(/BEHANDLUNG_FREEZE_GRUND = '([^']+)'/)[1]
    const erlaubt = regeln.match(/BEHANDLUNG_FREEZE_ERLAUBT = \[([^\]]+)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''))
    assert.match(m, new RegExp(`s112_freeze\\('${grund}'`))
    assert.ok(m.includes(`'${erlaubt.join(',')}'`), 'Positivliste im Trigger = BEHANDLUNG_FREEZE_ERLAUBT')
    assert.match(m, /pc\.gueltig_ab <= o\.datum::date\s+AND \(pc\.gueltig_bis IS NULL OR pc\.gueltig_bis >= o\.datum::date\)/)
    assert.match(m, /CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public\.keller_behandlungen/)
    assert.match(m, /update keller_behandlungstypen set pn_wirkung = ''pflege'' where tenant_id = c_t/)
  })
  test('Server Action: Menge, Charge, Sperre, Einstufung neuer Typen', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    assert.match(a, /const mengeFehler = behandlungMengeFehler\(menge, einheit\)/)
    assert.match(a, /const c = behandlungCharge\(gewaehlt, chargenListe\.map/)
    assert.match(a, /if \(behandlungPnGesperrt\(/)
    assert.match(a, /const wirkungFehler = neuerTypWirkungFehler\(wirkung\)/)
    assert.match(a, /sperrMeldung\(sperre, sp => BEHANDLUNG_FELDNAMEN\[sp\] \?\? sp\)/)
  })
  test('Formular: Sperrhinweis, gesperrte Felder, Pflichtkennzeichen; Assistent mit Einstufung', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx')
    // KAN-222: mit Korrektur durch die Betriebsleitung
    assert.match(p, /<GesperrtHinweis grund=\{BEHANDLUNG_FREEZE_GRUND\} erlaubt=\{\['Notizen'\]\} betriebsleitung=\{betriebsleitung\} \/>/)
    assert.match(p, /<fieldset disabled=\{formGesperrt\}/)
    assert.match(p, /required=\{formEinheit !== '-'\}/)
    assert.match(p, /PN_WIRKUNGEN\.filter\(w => w !== 'unklar'\)/)
    assert.match(p, /\.from\('pruefnummer_chargen'\) as any\)\s*\.select\('weinausbau_id, gueltig_ab, gueltig_bis'\)\.eq\('tenant_id', activeTenantId\)/)
    const t = quelle('src/lib/assistent/tools/kellerbehandlung.ts')
    assert.match(t, /typ_wirkung: \{ type: 'string', enum: \['pflege', 'veraenderung'\]/)
    assert.match(t, /pn_wirkung: String\(input\.typ_wirkung\)/)
  })
})
