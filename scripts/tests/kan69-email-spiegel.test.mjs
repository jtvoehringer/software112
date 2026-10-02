// KAN-69 (01.10.2026): E-Mail-Spiegelung schreibt nur bei aktiver Mitgliedschaft des
// Verbindungs-Users und nicht in abo-gesperrte Betriebe (Nur-Lesen-Modus, KAN-5).
// Einheitstests für lib/email/spiegelFreigabe.ts plus Quelltextprüfung von lib/email/spiegel.ts.
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan69-email-spiegel.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

register('./ernte.aufloesung.mjs', import.meta.url)
const f = await import('../../src/lib/email/spiegelFreigabe.ts')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')

const SANDBOX = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
const KUNDE = '0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b'
const FREMD = '1c2d3e4f-5061-4728-9bac-1d2e3f4a5b6c'
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const JETZT = Date.parse('2026-10-01T10:00:00Z')

const betrieb = (id, stripe_status = 'active', stripe_trial_ends_at = null) => ({ id, stripe_status, stripe_trial_ends_at })
const mitglied = (tenant_id, user_id, aktiv = true) => ({ tenant_id, user_id, aktiv })
const verb = (tenant_id, user_id) => ({ tenant_id, user_id, email_address: `${user_id.slice(-1)}@beispiel.at` })

describe('spiegelFreigabe', () => {
  test('offener Betrieb mit aktiver Mitgliedschaft: freigegeben (Postfach-Nutzung unverändert)', () => {
    const v = verb(KUNDE, U1)
    const r = f.spiegelFreigabe([v], [mitglied(KUNDE, U1)], [betrieb(KUNDE)], JETZT)
    assert.deepEqual(r.freigegeben, [v])
    assert.deepEqual(r.uebersprungen, [])
  })

  test('Abo gesperrt (unpaid, canceled, abgelaufene Testphase): übersprungen', () => {
    for (const b of [betrieb(KUNDE, 'unpaid'), betrieb(KUNDE, 'canceled'), betrieb(KUNDE, 'trialing', '2026-09-30T00:00:00Z')]) {
      const r = f.spiegelFreigabe([verb(KUNDE, U1)], [mitglied(KUNDE, U1)], [b], JETZT)
      assert.equal(r.freigegeben.length, 0, b.stripe_status)
      assert.equal(r.uebersprungen[0].grund, 'abo')
    }
  })

  test('past_due und laufende Testphase sperren nicht', () => {
    for (const b of [betrieb(KUNDE, 'past_due'), betrieb(KUNDE, 'trialing', '2026-10-10T00:00:00Z'), betrieb(KUNDE, null)]) {
      assert.equal(f.spiegelFreigabe([verb(KUNDE, U1)], [mitglied(KUNDE, U1)], [b], JETZT).freigegeben.length, 1, String(b.stripe_status))
    }
  })

  test('Sandbox bleibt frei, auch mit gesperrtem Status', () => {
    assert.equal(f.spiegelFreigabe([verb(SANDBOX, U1)], [mitglied(SANDBOX, U1)], [betrieb(SANDBOX, 'unpaid')], JETZT).freigegeben.length, 1)
  })

  test('fremde tenant_id (keine Mitgliedschaft) bzw. inaktive Mitgliedschaft: übersprungen', () => {
    const r = f.spiegelFreigabe(
      [verb(FREMD, U1), verb(KUNDE, U2)],
      [mitglied(KUNDE, U1), mitglied(KUNDE, U2, false), mitglied(FREMD, U2)],
      [betrieb(KUNDE), betrieb(FREMD)], JETZT)
    assert.equal(r.freigegeben.length, 0)
    assert.deepEqual(r.uebersprungen.map(u => u.grund), ['mitgliedschaft', 'mitgliedschaft'])
  })

  test('Mitgliedschaft mit aktiv = null zählt nicht als aktiv', () => {
    assert.equal(f.spiegelFreigabe([verb(KUNDE, U1)], [mitglied(KUNDE, U1, null)], [betrieb(KUNDE)], JETZT).uebersprungen[0].grund, 'mitgliedschaft')
  })

  test('Betrieb nicht gefunden: übersprungen', () => {
    assert.equal(f.spiegelFreigabe([verb(KUNDE, U1)], [mitglied(KUNDE, U1)], [], JETZT).uebersprungen[0].grund, 'betrieb')
  })

  test('jeder Grund hat einen deutschen Text', () => {
    for (const g of ['mitgliedschaft', 'betrieb', 'abo']) assert.ok(f.SPIEGEL_SPERR_TEXT[g])
  })
})

describe('spiegel.ts verdrahtet die Freigabe', () => {
  const s = lies('src/lib/email/spiegel.ts')

  test('Schleife läuft nur über freigegebene Verbindungen', () => {
    assert.match(s, /spiegelFreigabe\(/)
    assert.match(s, /for \(const uc of freigegeben\)/)
    assert.doesNotMatch(s, /for \(const uc of \(verbindungen/)
  })

  test('Mitgliedschaften und Abo-Stand werden geladen, Fehler → nichts spiegeln (fail-closed)', () => {
    assert.match(s, /from\('tenant_memberships'\)[^\n]*select\('tenant_id, user_id, aktiv'\)/)
    assert.match(s, /from\('tenants'\)[^\n]*select\('id, stripe_status, stripe_trial_ends_at'\)/)
    assert.match(s, /if \(me \|\| be\) \{[\s\S]{0,200}return erg/)
  })

  test('spiegleNebenbei geht über spiegleMailboxen (gleiche Prüfung)', () => {
    const neben = s.slice(s.indexOf('export async function spiegleNebenbei'))
    assert.match(neben, /spiegleMailboxen\(budgetMs, tenantId, userId\)/)
  })

  test('Cron zählt ausgelassene Postfächer nicht als Fehler', () => {
    const c = lies('src/app/api/cron/taeglich/route.ts')
    assert.match(c, /emailSpiegel\.uebersprungen/)
    assert.doesNotMatch(c, /fehlerAnzahl = [^\n]*uebersprungen/)
  })
})
