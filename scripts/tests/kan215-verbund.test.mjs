// KAN-215 (06.10.2026): Abrechnungsverbund – Nebenmandanten über das Stripe-Abo eines Hauptmandanten (Premium) abrechnen,
// Standardpreis oder vereinbarter Preis je Nebenmandant, Austritt → Nur-Lesen, keine eigene Testphase.
// Die Datenbank-Regeln (keine Ketten, Preis nur im Verbund, Benutzer dürfen nichts setzen) prüft DB-Test 44.
// KAN-214 (08.10.2026): Submandant kostet 0 € – Positionsplanung und Preiseingabe entfallen (Tests entfernt), Premium
// beim Hauptmandanten genügt (ohne Stripe-Abo); weitere Prüfungen in kan214-submandant.test.mjs.
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
const v = hooksMoeglich ? await laden('lib/abo/verbund.ts') : null

const pos = (id, priceId, metadata = {}, quantity = 1, betragCent = null) => ({ id, priceId, metadata, quantity, betragCent })
const paketAus = id => (id === 'price_premium' ? 'premium' : id === 'price_basis' ? 'basis' : null)

describe('KAN-215 Paket-Position im Stripe-Abo', nurMitHooks, () => {
  test('Paket-Position: die mit Paket-Preis, nie ein Zusatzmandant (vorher immer items[0])', () => {
    const ist = [pos('si_z', 'price_zusatz', { s112_art: 'zusatzmandant_standard' }), pos('si_p', 'price_premium')]
    assert.equal(v.paketPosition(ist, paketAus).id, 'si_p')
    assert.equal(v.paketPosition([pos('si_z', 'price_x', { s112_art: 'zusatzmandant' }), pos('si_alt', 'price_alt')], paketAus).id, 'si_alt')
  })
})

describe('KAN-215 Regeln', nurMitHooks, () => {
  const haupt = { id: 'a', name: 'Weingut', abrechnung_ueber: null, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', stripe_plan: 'premium' }
  const neben = { id: 'b', name: 'Spaetrot', abrechnung_ueber: null, stripe_customer_id: null, stripe_subscription_id: null, stripe_plan: null }
  test('Beitritt nur zu einem Hauptmandanten mit Premium, ohne Ketten und ohne Doppelabrechnung', () => {
    assert.equal(v.beitrittFehler(neben, haupt, false), null)
    assert.match(v.beitrittFehler(neben, { ...haupt, stripe_plan: 'standard' }, false), /Premium-Paket/)
    // KAN-214: Premium genügt, ein Stripe-Abo ist nicht nötig (Pilotbetriebe ohne Stripe)
    assert.equal(v.beitrittFehler(neben, { ...haupt, stripe_customer_id: null, stripe_subscription_id: null }, false), null)
    assert.match(v.beitrittFehler(neben, { ...haupt, abrechnung_ueber: 'x' }, false), /kein Hauptmandant/)
    assert.match(v.beitrittFehler(neben, haupt, true), /ist Hauptmandant und kann nicht selbst Submandant werden/)
    assert.match(v.beitrittFehler({ ...neben, stripe_subscription_id: 'sub_b' }, haupt, false), /eigenes Stripe-Abo/)
    assert.match(v.beitrittFehler(haupt, haupt, false), /über sich selbst/)
  })
  test('Beitritt übernimmt Kunde, Abo, Status und Testphase des Hauptmandanten (keine eigene Testphase), Austritt → Nur-Lesen', () => {
    const w = v.beitrittsWerte({ id: 'a', stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', stripe_status: 'trialing', stripe_trial_ends_at: '2026-10-20T00:00:00Z', stripe_current_period_end: null })
    assert.deepEqual([w.abrechnung_ueber, w.stripe_customer_id, w.stripe_subscription_id, w.stripe_status, w.stripe_plan, w.stripe_trial_ends_at, w.zusatz_preis_cent],
      ['a', 'cus_a', 'sub_a', 'trialing', 'premium', '2026-10-20T00:00:00Z', null])   // KAN-214: 0 €
    const a = v.austrittsWerte(true)
    assert.deepEqual([a.abrechnung_ueber, a.stripe_customer_id, a.stripe_subscription_id, a.stripe_status], [null, null, null, 'cancelled'])
    // KAN-214: ohne geteiltes Stripe-Abo bleibt der Status (kein Nur-Lesen für Pilotbetriebe)
    assert.equal('stripe_status' in v.austrittsWerte(false), false)
  })
  test('Paketwechsel des Hauptmandanten unter Premium nur ohne Submandanten', () => {
    assert.equal(v.paketwechselVerbundFehler('premium', 2), null)
    assert.equal(v.paketwechselVerbundFehler('standard', 0), null)
    assert.match(v.paketwechselVerbundFehler('standard', 1), /setzt Premium voraus/)
  })
})

describe('KAN-215 Verdrahtung', () => {
  test('Webhook und Paketwechsel nehmen die Paket-Position, nicht items[0]', () => {
    const w = quelle('src/app/api/stripe/webhook/route.ts')
    assert.match(w, /paketPosition\(roh\.map\(aboPositionAus\), paketFromPriceId\)/)
    assert.doesNotMatch(w, /s\.items\?\.data\?\.\[0\]/)
    const a = quelle('src/app/abo/actions.ts')
    assert.match(a, /paketPosition\(sub\.items\.data\.map/)
    assert.match(a, /paketwechselVerbundFehler\(paket, count \?\? 0\)/)
  })
  test('Nebenmandanten: kein eigenes Portal, kein Checkout, keine Kündigung des Hauptabos; Checkout ohne Testphase', () => {
    const a = quelle('src/app/abo/actions.ts')
    // Portal (createOwnStripePortalSession), Checkout (starteZahlungAction) und Paketwechsel
    assert.equal(a.split('abrechnung_ueber) return { error').length - 1 + a.split("abrechnung_ueber) {\n    return { error").length - 1, 3)
    // KAN-402: auch nach Austritt aus dem Verbund kein Testzeitraum – es gibt keine Testphase mehr
    assert.doesNotMatch(a, /trial_period_days/)
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts'), /if \(\(data as R\)\.abrechnung_ueber\) throw new AktionsFehler/)
  })
  test('Migration: Spalten, Ketten-Trigger, Preis-CHECK', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan215_abrechnungsverbund.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan215_abrechnungsverbund.sql')
    assert.match(m, /ADD COLUMN abrechnung_ueber uuid REFERENCES public\.tenants\(id\) ON DELETE SET NULL/)
    assert.match(m, /CREATE TRIGGER a_abrechnungsverbund BEFORE INSERT OR UPDATE OF abrechnung_ueber ON public\.tenants/)
    assert.match(m, /zusatz_preis_cent BETWEEN 100 AND 10000000 AND abrechnung_ueber IS NOT NULL/)
  })
})
