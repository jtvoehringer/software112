// KAN-215 (06.10.2026): Abrechnungsverbund – Nebenmandanten über das Stripe-Abo eines Hauptmandanten (Premium) abrechnen,
// Standardpreis oder vereinbarter Preis je Nebenmandant, Austritt → Nur-Lesen, keine eigene Testphase.
// Die Datenbank-Regeln (keine Ketten, Preis nur im Verbund, Benutzer dürfen nichts setzen) prüft DB-Test 44.
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

const K = { standardPreisId: 'price_zusatz', produktId: 'prod_zusatz' }
const pos = (id, priceId, metadata = {}, quantity = 1, betragCent = null) => ({ id, priceId, metadata, quantity, betragCent })
const paketAus = id => (id === 'price_premium' ? 'premium' : id === 'price_basis' ? 'basis' : null)

describe('KAN-215 Positionsplanung im Stripe-Abo', nurMitHooks, () => {
  test('Standardpreis: eine Position mit Menge = Anzahl der Nebenmandanten', () => {
    const neben = [{ tenantId: 'b', name: 'B', preisCent: null }, { tenantId: 'c', name: 'C', preisCent: null }]
    const r = v.zusatzPositionenPlan(neben, [pos('si_p', 'price_premium')], K)
    assert.equal(r.fehler, null)
    assert.deepEqual(r.aenderungen, [{ price: 'price_zusatz', quantity: 2, metadata: { s112_art: 'zusatzmandant_standard' } }])
    // bestehende Position: nur die Menge anpassen, sonst nichts
    const ist = [pos('si_p', 'price_premium'), pos('si_z', 'price_zusatz', { s112_art: 'zusatzmandant_standard' }, 1)]
    assert.deepEqual(v.zusatzPositionenPlan(neben, ist, K).aenderungen, [{ id: 'si_z', quantity: 2 }])
    assert.deepEqual(v.zusatzPositionenPlan(neben.slice(0, 1), ist, K).aenderungen, [])
    assert.deepEqual(v.zusatzPositionenPlan([], ist, K).aenderungen, [{ id: 'si_z', deleted: true }])
  })

  test('vereinbarter Preis: eigene Position je Nebenmandant, Preisänderung ersetzt die Position', () => {
    const neben = [{ tenantId: 'b', name: 'Spaetrot', preisCent: 9900 }]
    const neu = v.zusatzPositionenPlan(neben, [pos('si_p', 'price_premium')], K).aenderungen
    assert.deepEqual(neu, [{
      price_data: { currency: 'eur', product: 'prod_zusatz', unit_amount: 9900, recurring: { interval: 'month' } },
      quantity: 1, metadata: { s112_art: 'zusatzmandant', s112_tenant_id: 'b', s112_name: 'Spaetrot' },
    }])
    const ist = [pos('si_p', 'price_premium'), pos('si_b', 'price_x', { s112_art: 'zusatzmandant', s112_tenant_id: 'b' }, 1, 9900)]
    assert.deepEqual(v.zusatzPositionenPlan(neben, ist, K).aenderungen, [])
    const teurer = v.zusatzPositionenPlan([{ tenantId: 'b', name: 'Spaetrot', preisCent: 12900 }], ist, K).aenderungen
    assert.deepEqual(teurer[0], { id: 'si_b', deleted: true })
    assert.equal(teurer[1].price_data.unit_amount, 12900)
    // ausgetreten → Position weg; Paket-Position bleibt immer unberührt
    assert.deepEqual(v.zusatzPositionenPlan([], ist, K).aenderungen, [{ id: 'si_b', deleted: true }])
  })

  test('fehlende Stripe-Konfiguration bzw. ungültiger Preis → Meldung, keine Änderung', () => {
    assert.match(v.zusatzPositionenPlan([{ tenantId: 'b', name: 'B', preisCent: null }], [], { standardPreisId: null, produktId: 'p' }).fehler, /STRIPE_PRICE_ZUSATZMANDANT/)
    assert.match(v.zusatzPositionenPlan([{ tenantId: 'b', name: 'B', preisCent: 5000 }], [], { standardPreisId: 's', produktId: null }).fehler, /STRIPE_PRODUCT_ZUSATZMANDANT/)
    assert.match(v.zusatzPositionenPlan([{ tenantId: 'b', name: 'B', preisCent: 50 }], [], K).fehler, /ungültig/)
  })

  test('Paket-Position: die mit Paket-Preis, nie ein Zusatzmandant (vorher immer items[0])', () => {
    const ist = [pos('si_z', 'price_zusatz', { s112_art: 'zusatzmandant_standard' }), pos('si_p', 'price_premium')]
    assert.equal(v.paketPosition(ist, paketAus).id, 'si_p')
    assert.equal(v.paketPosition([pos('si_z', 'price_x', { s112_art: 'zusatzmandant' }), pos('si_alt', 'price_alt')], paketAus).id, 'si_alt')
  })
})

describe('KAN-215 Regeln', nurMitHooks, () => {
  const haupt = { id: 'a', name: 'Weingut', abrechnung_ueber: null, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', stripe_plan: 'premium' }
  const neben = { id: 'b', name: 'Spaetrot', abrechnung_ueber: null, stripe_customer_id: null, stripe_subscription_id: null, stripe_plan: null }
  test('Beitritt nur zu einem Hauptmandanten mit Premium-Abo, ohne Ketten und ohne Doppelabrechnung', () => {
    assert.equal(v.beitrittFehler(neben, haupt, false), null)
    assert.match(v.beitrittFehler(neben, { ...haupt, stripe_plan: 'standard' }, false), /Premium-Paket/)
    assert.match(v.beitrittFehler(neben, { ...haupt, stripe_subscription_id: null }, false), /kein Stripe-Abo/)
    assert.match(v.beitrittFehler(neben, { ...haupt, abrechnung_ueber: 'x' }, false), /kein Hauptmandant/)
    assert.match(v.beitrittFehler(neben, haupt, true), /Hauptmandant eines Verbunds/)
    assert.match(v.beitrittFehler({ ...neben, stripe_subscription_id: 'sub_b' }, haupt, false), /eigenes Stripe-Abo/)
    assert.match(v.beitrittFehler(haupt, haupt, false), /über sich selbst/)
  })
  test('Beitritt übernimmt Kunde, Abo, Status und Testphase des Hauptmandanten (keine eigene Testphase), Austritt → Nur-Lesen', () => {
    const w = v.beitrittsWerte({ id: 'a', stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a', stripe_status: 'trialing', stripe_trial_ends_at: '2026-10-20T00:00:00Z', stripe_current_period_end: null }, 9900)
    assert.deepEqual([w.abrechnung_ueber, w.stripe_customer_id, w.stripe_subscription_id, w.stripe_status, w.stripe_plan, w.stripe_trial_ends_at, w.zusatz_preis_cent],
      ['a', 'cus_a', 'sub_a', 'trialing', 'premium', '2026-10-20T00:00:00Z', 9900])
    const a = v.austrittsWerte()
    assert.deepEqual([a.abrechnung_ueber, a.stripe_customer_id, a.stripe_subscription_id, a.stripe_status], [null, null, null, 'cancelled'])
  })
  test('Paketwechsel des Hauptmandanten unter Premium nur ohne Nebenmandanten', () => {
    assert.equal(v.paketwechselVerbundFehler('premium', 2), null)
    assert.equal(v.paketwechselVerbundFehler('standard', 0), null)
    assert.match(v.paketwechselVerbundFehler('standard', 1), /setzt Premium voraus/)
  })
  test('Preis-Eingabe in Euro', () => {
    assert.deepEqual(v.preisCentAusEingabe(''), { cent: null, fehler: null })
    assert.deepEqual(v.preisCentAusEingabe('99,50'), { cent: 9950, fehler: null })
    assert.deepEqual(v.preisCentAusEingabe('99'), { cent: 9900, fehler: null })
    assert.deepEqual(v.preisCentAusEingabe('1.234,50'), { cent: 123450, fehler: null })
    assert.match(v.preisCentAusEingabe('abc').fehler, /Betrag in Euro/)
    assert.match(v.preisCentAusEingabe('0,50').fehler, /zwischen 1 €/)
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
  test('Nebenmandanten: kein eigenes Portal, kein Checkout, keine Kündigung des Hauptabos; keine zweite Testphase', () => {
    const a = quelle('src/app/abo/actions.ts')
    // Portal (createOwnStripePortalSession), Checkout (starteZahlungAction) und Paketwechsel
    assert.equal(a.split('abrechnung_ueber) return { error').length - 1 + a.split("abrechnung_ueber) {\n    return { error").length - 1, 3)
    assert.match(a, /bisherigeAbos: bisherige\.data\.length \+ \(gekuendigt \? 1 : 0\)/)
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
