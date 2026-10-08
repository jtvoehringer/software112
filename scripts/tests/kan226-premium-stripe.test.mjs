// KAN-226 Teil 2 (08.10.2026) – Premium-Support über Stripe: Zusatzposition im bestehenden Abo (buchen, zum Monatsende
// kündigen), Abgleich des Kennzeichens im Webhook (nur beenden, was über Stripe lief), Paket-Erkennung ignoriert die
// Premium-Position, ohne Stripe-Preis kein Knopf.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as ps from '../../src/lib/abo/premiumStripe.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pos = (id, priceId, metadata = {}) => ({ id, priceId, metadata })
const H = '2026-10-08', ME = '2026-10-31'

describe('KAN-226 Teil 2: Premium-Support über Stripe', () => {
  test('Premium-Position je Betrieb (Kennzeichen, sonst Preis ohne Betriebs-Kennzeichen)', () => {
    const p = [pos('a', 'price_paket'), pos('b', 'price_ps', { s112_art: 'premium_support', s112_tenant_id: 't1' })]
    assert.equal(ps.premiumPositionFuer(p, 't1', 'price_ps')?.id, 'b')
    assert.equal(ps.premiumPositionFuer(p, 't2', 'price_ps'), null)          // Nebenmandant im Verbund: nicht seine Position
    assert.equal(ps.premiumPositionFuer([pos('c', 'price_ps')], 't1', 'price_ps')?.id, 'c')   // im Dashboard angelegt
    assert.equal(ps.premiumPositionFuer([pos('c', 'price_ps')], 't1', null), null)
  })

  test('Abgleich: neu gebucht, Kündigung zurückgenommen, unverändert', () => {
    assert.deepEqual(ps.premiumAbgleichPlan({ jetzt: true, vorher: false, aboBeendet: false, bisher: { seit: null, bis: null }, heute: H, monatsende: ME }), { seit: H, bis: null })
    assert.deepEqual(ps.premiumAbgleichPlan({ jetzt: true, vorher: true, aboBeendet: false, bisher: { seit: '2026-09-01', bis: ME }, heute: H, monatsende: ME }), { seit: '2026-09-01', bis: null })
    assert.equal(ps.premiumAbgleichPlan({ jetzt: true, vorher: true, aboBeendet: false, bisher: { seit: '2026-09-01', bis: null }, heute: H, monatsende: ME }), null)
    // nach Ende wieder gebucht → neuer Beginn
    assert.deepEqual(ps.premiumAbgleichPlan({ jetzt: true, vorher: false, aboBeendet: false, bisher: { seit: '2026-05-01', bis: '2026-06-30' }, heute: H, monatsende: ME }), { seit: H, bis: null })
  })

  test('Abgleich: entfernt bzw. Abo beendet → bis Monatsende; manuell gebucht bleibt unangetastet', () => {
    assert.deepEqual(ps.premiumAbgleichPlan({ jetzt: false, vorher: true, aboBeendet: false, bisher: { seit: '2026-09-01', bis: null }, heute: H, monatsende: ME }), { seit: '2026-09-01', bis: ME })
    assert.deepEqual(ps.premiumAbgleichPlan({ jetzt: true, vorher: true, aboBeendet: true, bisher: { seit: '2026-09-01', bis: null }, heute: H, monatsende: ME }), { seit: '2026-09-01', bis: ME })
    // vom Plattform-Admin ohne Stripe gebucht: anderes Abo-Ereignis ohne Premium-Position → nichts tun
    assert.equal(ps.premiumAbgleichPlan({ jetzt: false, vorher: false, aboBeendet: false, bisher: { seit: '2026-09-01', bis: null }, heute: H, monatsende: ME }), null)
    assert.equal(ps.premiumAbgleichPlan({ jetzt: false, vorher: false, aboBeendet: true, bisher: { seit: '2026-09-01', bis: null }, heute: H, monatsende: ME }), null)
    // bereits gekündigt (Aktion setzte bis) → nichts tun
    assert.equal(ps.premiumAbgleichPlan({ jetzt: false, vorher: true, aboBeendet: false, bisher: { seit: '2026-09-01', bis: ME }, heute: H, monatsende: ME }), null)
  })

  test('buchenFehler: Rolle, Verbund, Preis, Abo, schon gebucht', () => {
    const ok = { darfVerwalten: true, preisId: 'price_ps', hatAbo: true, abrechnungUeber: false, aktivUnbefristet: false }
    assert.equal(ps.buchenFehler(ok), null)
    assert.match(ps.buchenFehler({ ...ok, darfVerwalten: false }) ?? '', /Betriebsleitung/)
    assert.match(ps.buchenFehler({ ...ok, abrechnungUeber: true }) ?? '', /anderen Betrieb/)
    assert.match(ps.buchenFehler({ ...ok, preisId: null }) ?? '', /noch nicht direkt buchbar/)
    assert.match(ps.buchenFehler({ ...ok, hatAbo: false }) ?? '', /kein Abo/)
    assert.match(ps.buchenFehler({ ...ok, aktivUnbefristet: true }) ?? '', /bereits gebucht/)
  })

  test('Verdrahtung: Aktionen, Webhook, Paket-Erkennung, Knopf nur mit Preis', () => {
    const a = quelle('src/app/abo/actions.ts')
    assert.match(a, /metadata: \{ s112_art: PREMIUM_ART, s112_tenant_id: k\.membership\.tenantId \}/)
    assert.match(a, /proration_behavior: 'create_prorations'/)
    assert.match(a, /stripe\.subscriptionItems\.del\(pos\.id, \{ proration_behavior: 'none' \}\)/)
    assert.match(a, /premium_support_bis: kuendigungZumMonatsende\(heuteWien\(\)\)/)
    assert.match(a, /const gesperrt = await schreibSperreFehler\(membership\)/)
    const w = quelle('src/app/api/stripe/webhook/route.ts')
    assert.match(w, /const vorher = \(event\.data as R\)\.previous_attributes\?\.items\?\.data as R\[\] \| undefined/)
    assert.match(w, /await premiumAbgleichen\(admin, kundeId, sub, null, true\)/)
    assert.match(quelle('src/lib/abo/verbund.ts'), /p\.metadata\?\.s112_art === PREMIUM_ART\)\)/)
    const p = quelle('src/app/abo/page.tsx')
    assert.match(p, /const psSelbst = canAdmin\(role\) && !!\(process\.env\.STRIPE_PRICE_PREMIUM_SUPPORT \?\? ''\)\.trim\(\) && hatAbo && !t\?\.abrechnung_ueber && !abo\.gesperrt/)
  })
})
