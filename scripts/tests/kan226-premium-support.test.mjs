// KAN-226 (08.10.2026): Premium-Support als Zusatzpaket – Stand am Betrieb (Beginn/Ende inklusive), Kündigung zum
// Monatsende, Eingabeprüfung der Mandantenverwaltung und Verdrahtung (Admin, Hilfe, Abo, Navigation).
// Die Datenbank-Regeln (Zeitraum, Benutzer dürfen nichts setzen) prüft DB-Test 68.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const ps = hooksMoeglich ? await laden('lib/abo/premiumSupport.ts') : null

describe('KAN-226 Stand des Premium-Supports', nurMitHooks, () => {
  test('ohne Beginn: nicht gebucht', () => {
    assert.deepEqual(ps.premiumSupportStand({ seit: null, bis: null }, '2026-10-08'), { status: 'ohne' })
    assert.equal(ps.premiumSupportAktiv({ seit: null, bis: null }, '2026-10-08'), false)
  })
  test('Beginn und Ende gelten inklusive', () => {
    const z = { seit: '2026-10-08', bis: '2026-10-31' }
    assert.equal(ps.premiumSupportStand(z, '2026-10-07').status, 'geplant')
    assert.equal(ps.premiumSupportStand(z, '2026-10-08').status, 'aktiv')
    assert.equal(ps.premiumSupportStand(z, '2026-10-31').status, 'aktiv')
    assert.equal(ps.premiumSupportStand(z, '2026-11-01').status, 'beendet')
  })
  test('unbefristet bleibt aktiv; Zeitstempel aus der DB werden auf den Tag gekürzt', () => {
    assert.equal(ps.premiumSupportAktiv({ seit: '2026-01-01', bis: null }, '2030-12-31'), true)
    assert.equal(ps.premiumSupportAktiv({ seit: '2026-10-08T00:00:00+00:00', bis: null }, '2026-10-08'), true)
  })
  test('Texte', () => {
    assert.equal(ps.premiumSupportText(ps.premiumSupportStand({ seit: '2026-10-01', bis: null }, '2026-10-08')), 'Aktiv seit 01.10.2026')
    assert.equal(ps.premiumSupportText(ps.premiumSupportStand({ seit: '2026-10-01', bis: '2026-10-31' }, '2026-10-08')), 'Aktiv bis 31.10.2026 (gekündigt)')
    assert.equal(ps.premiumSupportText(ps.premiumSupportStand({ seit: '2026-09-01', bis: '2026-09-30' }, '2026-10-08')), 'Beendet am 30.09.2026')
    assert.equal(ps.premiumSupportText({ status: 'ohne' }), 'Nicht gebucht')
  })
})

describe('KAN-226 Kündigung zum Monatsende', nurMitHooks, () => {
  test('letzter Tag des laufenden Monats, auch Februar und Schaltjahr', () => {
    assert.equal(ps.kuendigungZumMonatsende('2026-10-08'), '2026-10-31')
    assert.equal(ps.kuendigungZumMonatsende('2026-11-30'), '2026-11-30')
    assert.equal(ps.kuendigungZumMonatsende('2027-02-10'), '2027-02-28')
    assert.equal(ps.kuendigungZumMonatsende('2028-02-01'), '2028-02-29')
    assert.equal(ps.kuendigungZumMonatsende('2026-12-31'), '2026-12-31')
  })
  test('heuteWien rechnet in Wiener Zeit (UTC 23:30 am 31.10. = 1.11. in Wien)', () => {
    assert.equal(ps.heuteWien(new Date('2026-10-31T23:30:00Z')), '2026-11-01')
    assert.equal(ps.heuteWien(new Date('2026-07-15T21:59:00Z')), '2026-07-15')
    assert.equal(ps.heuteWien(new Date('2026-07-15T22:00:00Z')), '2026-07-16')
  })
})

describe('KAN-226 Eingabeprüfung (Mandantenverwaltung)', nurMitHooks, () => {
  test('gültige Eingaben', () => {
    assert.equal(ps.premiumSupportEingabeFehler('', ''), null)
    assert.equal(ps.premiumSupportEingabeFehler('2026-10-01', ''), null)
    assert.equal(ps.premiumSupportEingabeFehler('2026-10-01', '2026-10-01'), null)
    assert.equal(ps.premiumSupportEingabeFehler(' 2026-10-01 ', '2026-10-31'), null)
  })
  test('ungültige Eingaben', () => {
    assert.match(ps.premiumSupportEingabeFehler('', '2026-10-31'), /Ohne Beginn/)
    assert.match(ps.premiumSupportEingabeFehler('2026-10-31', '2026-10-01'), /vor dem Beginn/)
    assert.match(ps.premiumSupportEingabeFehler('01.10.2026', ''), /Beginn/)
    assert.match(ps.premiumSupportEingabeFehler('2026-10-01', '2026-13-01'), /Ende/)
  })
})

describe('KAN-226 Verdrahtung', () => {
  test('Admin-Aktion: nur Plattform-Admin, ohne Sandbox-Freigabe, mit Eingabeprüfung', () => {
    const a = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
    const f = a.slice(a.indexOf('export async function setPremiumSupport'))
    assert.match(f, /assertSystemAdmin\(tenantId, \{ sandboxFreigabe: false \}\)/)
    assert.match(f, /premiumSupportEingabeFehler\(seitRoh, bisRoh\)/)
    assert.match(f, /premium_support_seit: seit, premium_support_bis: bis/)
  })
  test('Seiten lesen die Spalten fehlertolerant (App vor der Migration benutzbar)', () => {
    const d = quelle('src/app/(dashboard)/admin/mandanten/[id]/page.tsx')
    assert.match(d, /psFehler \? undefined/)
    assert.doesNotMatch(d.match(/\.select\('id, name, slug[^)]*\)/)[0], /premium_support/)
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/page.tsx'), /psFehler \? null/)
  })
  test('Hilfe-Navigation enthält „Support“, Abo-Seite verlinkt darauf', () => {
    assert.match(quelle('src/lib/navigation/index.ts'), /href: '\/hilfe\/support'/)
    assert.match(quelle('src/app/abo/page.tsx'), /href="\/hilfe\/support"/)
  })
  test('Preis und Reaktionszeit laut Entscheidung KAN-226', () => {
    const q = quelle('src/lib/abo/premiumSupport.ts')
    assert.match(q, /preisMonatNetto: 79,/)
    assert.match(q, /reaktionszeit: '2 bis 4 Stunden'/)
  })
})
