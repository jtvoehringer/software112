// KAN-214 (08.10.2026, Entscheidungen Jörgen): Hauptmandant und Submandanten – Submandant 0 € (keine Stripe-Position),
// nur Premium beim Hauptmandanten Pflicht (auch ohne Stripe-Abo), CRM und Kellergebinde gemeinschaftlich (Freigaben in
// beide Richtungen beim Beitritt), Support-Anfragen unter dem Hauptmandanten (JSM-Organisation).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'
import { supportOrganisation, beschreibungMitKontext } from '../../src/lib/support/anfrage.ts'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const v = hooksMoeglich ? await laden('lib/abo/verbund.ts') : null

describe('KAN-214: Hauptmandant und Submandanten', () => {
  test('Gemeinschaft: Keller- und CRM-Freigaben in beide Richtungen', nurMitHooks, () => {
    assert.deepEqual(v.gemeinschaftsFreigaben('haupt', 'sub'), [
      { eigentuemer_tenant_id: 'haupt', nutzer_tenant_id: 'sub', aktiv: true, notizen: 'Hauptmandant/Submandant (KAN-214)' },
      { eigentuemer_tenant_id: 'sub', nutzer_tenant_id: 'haupt', aktiv: true, notizen: 'Hauptmandant/Submandant (KAN-214)' },
    ])
  })

  test('Pilotbetrieb ohne Stripe (Gebeshuber/Spaetrot): Beitritt erlaubt, Werte ohne Abo', nurMitHooks, () => {
    const haupt = { id: 'g', name: 'Weingut Johannes Gebeshuber', abrechnung_ueber: null, stripe_customer_id: null, stripe_subscription_id: null, stripe_plan: 'premium' }
    const sub = { id: 's', name: 'Spaetrot Gebeshuber GmbH', abrechnung_ueber: null, stripe_customer_id: null, stripe_subscription_id: null, stripe_plan: null }
    assert.equal(v.beitrittFehler(sub, haupt, false), null)
    const w = v.beitrittsWerte(haupt)
    assert.deepEqual([w.abrechnung_ueber, w.zusatz_preis_cent, w.stripe_subscription_id, w.stripe_status, w.stripe_plan], ['g', null, null, null, 'premium'])
  })

  test('Support: Organisation des Hauptmandanten, Ticket nennt beide', () => {
    assert.equal(supportOrganisation('Spaetrot Gebeshuber GmbH', 'Weingut Johannes Gebeshuber'), 'Weingut Johannes Gebeshuber')
    assert.equal(supportOrganisation('Weingut Johannes Gebeshuber', null), 'Weingut Johannes Gebeshuber')
    assert.equal(supportOrganisation('Sandbox', '  '), 'Sandbox')
    const k = { betriebName: 'Spaetrot Gebeshuber GmbH', hauptName: 'Weingut Johannes Gebeshuber', tenantId: 't1', benutzerName: null, benutzerEmail: 'a@b.at', rolle: 'winzer', seite: null, userAgent: null, appVersion: null, zeitpunkt: 'x' }
    assert.match(beschreibungMitKontext('Hilfe', k), /Betrieb: Spaetrot Gebeshuber GmbH \(t1\) – Submandant von Weingut Johannes Gebeshuber/)
    assert.match(beschreibungMitKontext('Hilfe', { ...k, hauptName: null }), /Betrieb: Spaetrot Gebeshuber GmbH \(t1\)\n/)
  })

  test('Verdrahtung: kein Stripe beim Beitritt/Austritt, Freigaben, Module ohne Stripe sofort, Kandidaten ohne Abo-Pflicht', () => {
    const a = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
    assert.doesNotMatch(a, /verbundStripeAbgleichen|preisCentAusEingabe/)
    assert.equal(existsSync(new URL('../../src/lib/abo/verbundStripe.ts', import.meta.url)), false)
    assert.match(a, /export async function verbundBeitreten\(tenantId: string, hauptId: string\)/)
    assert.match(a, /for \(const tab of \['keller_freigaben', 'crm_freigaben'\]\)[\s\S]{0,200}upsert\(gemeinschaftsFreigaben\(hauptId, tenantId\), \{ onConflict: 'eigentuemer_tenant_id,nutzer_tenant_id' \}\)/)
    assert.match(a, /if \(!mitAbo \|\| e\.moduleAnwenden\) \{\n\s+const f = await wendePaketAn\(admin, tenantId, 'premium'\)/)
    assert.match(a, /update\(austrittsWerte\(!!\(n as R\)\.stripe_subscription_id\)\)/)
    const p = quelle('src/app/(dashboard)/admin/mandanten/[id]/page.tsx')
    assert.match(p, /select\('id, name'\)\.eq\('stripe_plan', 'premium'\)\n\s+\.is\('abrechnung_ueber', null\)/)
    const k = quelle('src/lib/support/kontext.ts')
    assert.match(k, /organisationName: supportOrganisation\(betriebName, hauptName\)/)
    for (const r of ['src/app/api/support/anfragen/route.ts', 'src/app/api/support/rueckruf/route.ts']) {
      assert.match(quelle(r), /organisationZuordnen\(k\.organisationName, accountId\)/, r)
    }
  })
})
