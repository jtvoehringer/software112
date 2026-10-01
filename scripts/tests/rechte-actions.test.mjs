// Backlog-Abgleich Punkt 2 (01.10.2026): Berechtigungsprüfungen in Server-Actions (KAN-9, KAN-10, KAN-94)
//
// Aufruf:  node --test scripts/tests/rechte-actions.test.mjs   (läuft auch über npm run test:csv)
//
// Quelltext-Prüfungen – die Regeln sollen nicht still wieder verschwinden.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const MANDANT = 'src/app/(dashboard)/admin/mandanten/[id]/actions.ts'

describe('Mandantenverwaltung nur für Plattform-Admins', () => {
  test('assertSystemAdmin prüft plattform_admins, nicht die Rolle im aktiven Betrieb; Sandbox über die feste ID', () => {
    const q = quelle(MANDANT)
    assert.match(q, /if \(await istPlattformAdmin\(\)\) return/)
    assert.doesNotMatch(q, /getCurrentUserRole\(\)/)
    assert.doesNotMatch(q, /\.eq\('name', 'Sandbox'\)/)
    assert.match(q, /tenantId === SANDBOX_TENANT_ID/)
    for (const f of ['src/app/(dashboard)/admin/mandanten/actions.ts', 'src/app/(dashboard)/admin/kellergemeinschaft/actions.ts']) {
      assert.match(quelle(f), /await pruefePlattformAdmin\(\)/, f)
    }
    for (const f of ['src/app/(dashboard)/admin/mandanten/[id]/page.tsx', 'src/app/(dashboard)/admin/mandanten/page.tsx', 'src/app/(dashboard)/admin/kellergemeinschaft/page.tsx']) {
      const p = quelle(f)
      assert.match(p, /istPlattformAdmin\(\)/, f)
      assert.doesNotMatch(p, /role !== 'system_admin'/, f)
    }
  })
  test('Sandbox-Sonderfreigabe nicht für Stripe und Umbenennen', () => {
    const q = quelle(MANDANT)
    for (const fn of ['renameTenantAdmin', 'createStripeCustomer', 'createStripePortalSession', 'cancelStripeSubscription']) {
      assert.match(q, new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*await assertSystemAdmin\\(tenantId, \\{ sandboxFreigabe: false \\}\\)`), fn)
    }
  })
  test('Name ändern und Einladung erneut senden nur für Mitglieder des Ziel-Betriebs', () => {
    const q = quelle(MANDANT)
    for (const fn of ['resendInvite', 'updateMemberNameAdmin']) {
      assert.match(q, new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*await assertSystemAdmin\\(tenantId\\)\\s*await pruefeMitglied\\(userId, tenantId\\)`), fn)
    }
  })
})

describe('Kellerbuch und Stripe', () => {
  test('Umziehen prüft das Schreibrecht im Modul Kellerbuch (KAN-94)', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
    const start = q.indexOf('export async function umziehen(')
    const ende = q.indexOf('// Ziele vorab prüfen', start)
    assert.ok(start > 0 && ende > start)
    assert.match(q.slice(start, ende), /if \(!canWrite\(membership, 'kellerbuch'\)\) throw/)
  })
  test('Stripe-Webhook bricht ohne Secret ab, bevor er die Signatur prüft (KAN-9)', () => {
    const q = quelle('src/app/api/stripe/webhook/route.ts')
    const pruefung = q.indexOf('if (!secret)')
    const signatur = q.indexOf('constructEvent(')
    assert.ok(pruefung > 0 && pruefung < signatur)
    assert.match(q.slice(pruefung, signatur), /status: 500/)
  })
})
