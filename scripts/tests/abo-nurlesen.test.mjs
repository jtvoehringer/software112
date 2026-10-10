// Tests für den Nur-Lesen-Modus bei gesperrtem Abo (KAN-5): Abo-Stand und Ausnahmen per ID,
// Cache-Gegenprobe, Paket-Entscheidung und Abgleich des Stripe-Webhooks (Fake-Admin-Client),
// Pfad-Ausnahmen und Antworten des Client-Wächters, Abgleich Server ↔ Browser ↔ Datenbank,
// der Guard check-schreibsperre.js an Beispiel-Dateien – ohne Browser und ohne Datenbank
// (25.09.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/abo-nurlesen.test.mjs
//
// src/lib/abo/regeln.ts importiert '@/lib/pakete' (ohne Server-Importe) – aufgelöst über denselben
// Hook wie die Ernte-Tests (ernte.aufloesung.mjs).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { createRequire, register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

register('./ernte.aufloesung.mjs', import.meta.url)
const r = await import('../../src/lib/abo/regeln.ts')
const nl = await import('../../src/lib/abo/nurLesen.ts')
const sa = await import('../../src/lib/abo/stripeAbgleich.ts')
const { PAKET_REIHENFOLGE } = await import('../../src/lib/pakete.ts')

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const SANDBOX = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
const DEMO = '33333333-3333-4333-8333-333333333333'
const KUNDE = '0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b'
const ORIGIN = 'https://software112.icp-consultants.at'
const SUPABASE = 'https://zwcsgnemijkpyxrqykul.supabase.co'
const JETZT = Date.parse('2026-09-25T10:00:00Z')
const FREI = { gesperrt: false, warnung: false, zahlungOffen: false }
const GESPERRT = { gesperrt: true, warnung: false, zahlungOffen: false }

const stand = (p) => r.aboStandBerechnen({ tenantId: KUNDE, stripeStatus: null, trialEndsAt: null, role: 'tenant_admin', ...p }, JETZT)

describe('Abo-Stand', () => {
  test('ohne Stripe-Status (manuell betreut) nie gesperrt', () => {
    assert.deepEqual(stand({ stripeStatus: null }), FREI)
    assert.deepEqual(stand({ stripeStatus: '' }), FREI)
  })

  test('gesperrte Status sperren', () => {
    for (const s of ['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused']) {
      assert.deepEqual(stand({ stripeStatus: s }), GESPERRT, s)
    }
    assert.deepEqual([...r.ABO_GESPERRTE_STATUS].sort(), ['canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused', 'unpaid'])
  })

  test('active frei, past_due nur Warnung', () => {
    assert.deepEqual(stand({ stripeStatus: 'active' }), FREI)
    assert.deepEqual(stand({ stripeStatus: 'past_due' }), { gesperrt: false, warnung: true, zahlungOffen: false })
  })

  test('Testphase sperrt erst nach Ablauf', () => {
    assert.equal(stand({ stripeStatus: 'trialing', trialEndsAt: '2026-10-01T00:00:00Z' }).gesperrt, false)
    assert.equal(stand({ stripeStatus: 'trialing', trialEndsAt: '2026-09-20T00:00:00Z' }).gesperrt, true)
    assert.equal(stand({ stripeStatus: 'trialing', trialEndsAt: null }).gesperrt, false)
    assert.equal(r.istTrialAbgelaufen('trialing', 'kein Datum', JETZT), false, 'ungültiges Datum sperrt nicht')
    assert.equal(r.istTrialAbgelaufen('active', '2026-09-20T00:00:00Z', JETZT), false, 'nur solange trialing')
  })

  test('Super-Admin ausgenommen, andere Rollen nicht', () => {
    assert.equal(stand({ stripeStatus: 'unpaid', role: 'system_admin' }).gesperrt, false)
    for (const role of ['tenant_admin', 'winzer', 'leser', null]) assert.equal(stand({ stripeStatus: 'unpaid', role }).gesperrt, true, String(role))
  })

  test('Sandbox und Demo-Musterhof über die feste ID ausgenommen', () => {
    for (const id of [SANDBOX, DEMO, SANDBOX.toUpperCase(), ` ${DEMO} `]) {
      assert.equal(r.istSandboxOderDemo(id), true, id)
      assert.deepEqual(stand({ tenantId: id, stripeStatus: 'canceled' }), FREI, id)
    }
    assert.equal(r.SANDBOX_TENANT_ID, SANDBOX)
    assert.equal(r.DEMO_TENANT_ID, DEMO)
  })

  test('der Name zählt nicht mehr: ein Betrieb „Sandbox“ mit anderer ID ist gesperrt', () => {
    assert.equal(r.istSandboxOderDemo(KUNDE), false)
    assert.equal(r.istSandboxOderDemo('Sandbox'), false)
    assert.equal(r.istSandboxOderDemo(null), false)
    assert.equal(r.istSandboxOderDemo(undefined), false)
    assert.equal(stand({ tenantId: KUNDE, stripeStatus: 'unpaid', name: 'Sandbox' }).gesperrt, true)
  })

  test('Registrierung ohne abgeschlossenen Checkout: „Zahlung offen“ statt Nur-Lesen-Modus (Umleitung auf /abo)', () => {
    assert.deepEqual(stand({ stripeStatus: 'incomplete', aboId: null }), { gesperrt: true, warnung: false, zahlungOffen: true })
    assert.equal(stand({ stripeStatus: 'incomplete', aboId: 'sub_1' }).zahlungOffen, false, 'Abo vorhanden (3-D-Secure offen) → Nur-Lesen')
    assert.equal(stand({ stripeStatus: 'incomplete' }).zahlungOffen, false, 'Abo-ID unbekannt → keine Umleitung')
    assert.equal(stand({ stripeStatus: 'canceled', aboId: null }).zahlungOffen, false, 'gekündigt → Nur-Lesen, nicht /abo')
    assert.equal(stand({ stripeStatus: 'incomplete', aboId: null, role: 'system_admin' }).zahlungOffen, false)
    assert.equal(stand({ tenantId: SANDBOX, stripeStatus: 'incomplete', aboId: null }).zahlungOffen, false)
  })

  test('Meldungen', () => {
    assert.equal(r.SCHREIBSPERRE_MELDUNG, 'Das Abo dieses Betriebs ist gesperrt – Änderungen sind im Nur-Lesen-Modus nicht möglich. Bitte unter „Abo“ klären.')
    assert.equal(`${r.NUR_LESEN_TITEL}: ${r.NUR_LESEN_BANNER}`, 'Nur-Lesen-Modus: Das Abo dieses Betriebs ist gesperrt – Änderungen sind nicht möglich.')
    assert.deepEqual(r.sperrAntwortKoerper(), { ok: false, fehler: r.SCHREIBSPERRE_MELDUNG, error: r.SCHREIBSPERRE_MELDUNG, meldung: r.SCHREIBSPERRE_MELDUNG, grund: 'nur_lesen', nurLesen: true, art: 'speichern' })
    const ki = r.sperrAntwortKoerper('ki')
    assert.equal(ki.fehler, r.KI_SPERRE_MELDUNG)
    assert.equal(ki.art, 'ki')
    assert.match(r.KI_SPERRE_MELDUNG, /KI-Abfragen und Assistent/)
    assert.doesNotMatch(r.KI_SPERRE_MELDUNG, /Änderungen/, 'eine Abfrage ist keine Änderung')
  })

  test('Sperrmeldung im Antworttext erkennen (Server-Action-Antwort, DB-Fehler)', () => {
    assert.equal(r.sperrArtImText(`0:{"error":"${r.SCHREIBSPERRE_MELDUNG}"}`), 'speichern')
    assert.equal(r.sperrArtImText(`1:E{"digest":"S112|${r.SCHREIBSPERRE_MELDUNG}"}`), 'speichern', 'AktionsFehler')
    assert.equal(r.sperrArtImText(`{"fehler":"${r.KI_SPERRE_MELDUNG}"}`), 'ki')
    assert.equal(r.sperrArtImText('0:{"ok":true}'), null)
    assert.equal(r.sperrArtImText(''), null)
    assert.equal(r.sperrArtImText(null), null)
  })
})

describe('Abo-Stand mit Cache und ungecachter Gegenprobe', () => {
  const kopf = (status, extra = {}) => ({ tenant: { stripe_status: status, stripe_trial_ends_at: null, stripe_subscription_id: 'sub_1' }, ...extra })
  function lader(gecacht, frisch) {
    const aufrufe = { gecacht: 0, frisch: 0 }
    return { aufrufe, lade: { gecacht: async () => { aufrufe.gecacht++; return gecacht }, frisch: async () => { aufrufe.frisch++; return frisch } } }
  }

  test('system_admin, Sandbox und Demo: ganz ohne Abfrage', async () => {
    for (const m of [{ tenantId: KUNDE, role: 'system_admin' }, { tenantId: SANDBOX, role: 'winzer' }, { tenantId: DEMO, role: 'leser' }, { tenantId: null, role: 'winzer' }]) {
      const { aufrufe, lade } = lader(kopf('unpaid'), kopf('unpaid'))
      assert.deepEqual(await r.aboStandErmitteln(m, lade, JETZT), FREI, JSON.stringify(m))
      assert.deepEqual(aufrufe, { gecacht: 0, frisch: 0 }, JSON.stringify(m))
    }
  })

  test('nicht gesperrt laut Cache: keine zweite Abfrage', async () => {
    const { aufrufe, lade } = lader(kopf('active'), kopf('unpaid'))
    assert.deepEqual(await r.aboStandErmitteln({ tenantId: KUNDE, role: 'winzer' }, lade, JETZT), FREI)
    assert.deepEqual(aufrufe, { gecacht: 1, frisch: 0 })
  })

  test('gesperrt laut Cache, aber inzwischen bezahlt: frischer Stand gewinnt (keine Ablehnung aus veraltetem Cache)', async () => {
    const { aufrufe, lade } = lader(kopf('unpaid'), kopf('active'))
    assert.deepEqual(await r.aboStandErmitteln({ tenantId: KUNDE, role: 'winzer' }, lade, JETZT), FREI)
    assert.deepEqual(aufrufe, { gecacht: 1, frisch: 1 })
  })

  test('gesperrt laut Cache und laut Datenbank: gesperrt', async () => {
    const { lade } = lader(kopf('unpaid'), kopf('unpaid'))
    assert.deepEqual(await r.aboStandErmitteln({ tenantId: KUNDE, role: 'winzer' }, lade, JETZT), GESPERRT)
  })

  test('Ladefehler im Cache: ungecacht nachladen; scheitert auch das, fail-open (DB-Ebene sperrt)', async () => {
    const f = lader({ tenant: null, ladefehler: true }, kopf('unpaid'))
    assert.deepEqual(await r.aboStandErmitteln({ tenantId: KUNDE, role: 'winzer' }, f.lade, JETZT), GESPERRT)
    assert.equal(f.aufrufe.frisch, 1)
    const g = lader({ tenant: null, ladefehler: true }, { tenant: null, ladefehler: true })
    assert.deepEqual(await r.aboStandErmitteln({ tenantId: KUNDE, role: 'winzer' }, g.lade, JETZT), FREI)
  })

  test('zahlungOffen kommt aus dem Kopf (Abo-ID leer)', async () => {
    const { lade } = lader(kopf('incomplete'), { tenant: { stripe_status: 'incomplete', stripe_trial_ends_at: null, stripe_subscription_id: null } })
    assert.deepEqual(await r.aboStandErmitteln({ tenantId: KUNDE, role: 'tenant_admin' }, lade, JETZT), { gesperrt: true, warnung: false, zahlungOffen: true })
  })
})

describe('Stripe-Webhook: Paket nur mit Zahlung', () => {
  const e = (ereignis, status, neuesPaket, bisherigesPaket) => r.paketEntscheidung({ ereignis, status, neuesPaket, bisherigesPaket })

  test('active und trialing: Paket laut Preis (auch Downgrade)', () => {
    for (const status of ['active', 'trialing']) {
      assert.deepEqual(pick(e('aktualisiert', status, 'premium', 'basis')), { planSetzen: true, plan: 'premium', moduleAnwenden: true }, status)
      assert.deepEqual(pick(e('aktualisiert', status, 'basis', 'premium')), { planSetzen: true, plan: 'basis', moduleAnwenden: true }, status)
      assert.deepEqual(pick(e('aktualisiert', status, 'standard', null)), { planSetzen: true, plan: 'standard', moduleAnwenden: true }, status)
    }
  })

  test('gesperrter Status (u. a. incomplete): nichts freischalten, nichts umstellen', () => {
    for (const status of ['incomplete', 'incomplete_expired', 'unpaid', 'canceled', 'cancelled', 'paused']) {
      assert.deepEqual(pick(e('aktualisiert', status, 'premium', 'basis')), { planSetzen: false, plan: 'basis', moduleAnwenden: false }, status)
      assert.deepEqual(pick(e('aktualisiert', status, 'premium', null)), { planSetzen: false, plan: null, moduleAnwenden: false }, `${status}: Neukunde ohne Zahlung`)
      assert.deepEqual(pick(e('aktualisiert', status, 'basis', 'premium')), { planSetzen: false, plan: 'premium', moduleAnwenden: false }, `${status}: bisherige Module bleiben`)
    }
  })

  test('past_due: kein Upgrade ohne Zahlung, Downgrade und gleiches Paket schon', () => {
    assert.equal(e('aktualisiert', 'past_due', 'premium', 'standard').moduleAnwenden, false)
    assert.equal(e('aktualisiert', 'past_due', 'basis', null).moduleAnwenden, false, 'von „kein Paket“ ist ein Upgrade')
    assert.deepEqual(pick(e('aktualisiert', 'past_due', 'basis', 'premium')), { planSetzen: true, plan: 'basis', moduleAnwenden: true })
    assert.deepEqual(pick(e('aktualisiert', 'past_due', 'standard', 'standard')), { planSetzen: true, plan: 'standard', moduleAnwenden: true })
  })

  test('Kündigung: stripe_plan leeren, Module für den Nur-Lesen-Modus stehen lassen', () => {
    for (const status of ['cancelled', 'canceled', 'active', null]) {
      assert.deepEqual(pick(e('geloescht', status, null, 'premium')), { planSetzen: true, plan: null, moduleAnwenden: false }, String(status))
    }
  })

  test('unbekannter oder fehlender Status: keine Änderung', () => {
    assert.deepEqual(pick(e('aktualisiert', 'irgendwas', 'premium', 'basis')), { planSetzen: false, plan: 'basis', moduleAnwenden: false })
    assert.deepEqual(pick(e('aktualisiert', null, 'premium', 'basis')), { planSetzen: false, plan: 'basis', moduleAnwenden: false })
  })

  test('jede Entscheidung trägt eine Begründung', () => {
    for (const s of ['active', 'past_due', 'unpaid', 'x', null]) assert.ok(e('aktualisiert', s, 'premium', 'basis').grund.length > 10)
  })

  test('istUpgrade folgt PAKET_REIHENFOLGE', () => {
    assert.deepEqual(PAKET_REIHENFOLGE, ['basis', 'standard', 'premium'])
    assert.equal(r.istUpgrade('basis', 'standard'), true)
    assert.equal(r.istUpgrade('standard', 'premium'), true)
    assert.equal(r.istUpgrade(null, 'basis'), true)
    assert.equal(r.istUpgrade('premium', 'basis'), false)
    assert.equal(r.istUpgrade('standard', 'standard'), false)
    assert.equal(r.istUpgrade('basis', null), false)
  })
})

function pick(x) {
  return { planSetzen: x.planSetzen, plan: x.plan, moduleAnwenden: x.moduleAnwenden }
}

describe('Stripe-Webhook: Zuordnung von Ereignissen zum Betrieb (aboZuordnung)', () => {
  const z = (p) => r.aboZuordnung({ ereignis: 'aktualisiert', gespeicherteAboId: 'sub_1', aboId: 'sub_1', aktuellerStatus: 'active', ...p }).aktion

  test('Abo-Ereignisse des eigenen bzw. ersten Abos werden übernommen', () => {
    assert.equal(z({}), 'uebernehmen')
    assert.equal(z({ gespeicherteAboId: null }), 'uebernehmen', 'erstes Abo')
    assert.equal(z({ gespeicherteAboId: '' }), 'uebernehmen', 'leere ID wie keine')
  })

  test('(a) nach der Kündigung bezahlte Schlussrechnung entsperrt NICHT', () => {
    assert.equal(z({ ereignis: 'rechnung', gespeicherteAboId: null, aboId: 'sub_alt', aktuellerStatus: 'canceled' }), 'ignorieren')
    assert.equal(z({ ereignis: 'rechnung', gespeicherteAboId: null, aboId: 'sub_alt', aktuellerStatus: 'active' }), 'ignorieren', 'auch wenn Stripe noch active meldete')
  })

  test('(b) Rechnung des aktuellen Abos: Status laut Stripe übernehmen (payment_failed nach unpaid schreibt unpaid)', () => {
    assert.equal(z({ ereignis: 'rechnung', aktuellerStatus: 'unpaid' }), 'uebernehmen')
    assert.equal(z({ ereignis: 'rechnung', aktuellerStatus: 'past_due' }), 'uebernehmen')
  })

  test('(c) deleted eines alten Doppel-Abos sperrt den zahlenden Kunden NICHT', () => {
    assert.equal(z({ ereignis: 'geloescht', gespeicherteAboId: 'sub_neu', aboId: 'sub_alt', aktuellerStatus: 'canceled' }), 'ignorieren')
    assert.equal(z({ ereignis: 'geloescht', gespeicherteAboId: 'sub_1', aboId: 'sub_1', aktuellerStatus: 'canceled' }), 'beenden')
    assert.equal(z({ ereignis: 'geloescht', gespeicherteAboId: null, aboId: 'sub_1', aktuellerStatus: 'canceled' }), 'ignorieren', 'schon beendet (Wiederholung)')
  })

  test('spätes updated eines beendeten Abos verknüpft es nicht wieder', () => {
    assert.equal(z({ gespeicherteAboId: null, aboId: 'sub_alt', aktuellerStatus: 'canceled' }), 'ignorieren')
    assert.equal(z({ gespeicherteAboId: null, aboId: 'sub_alt', aktuellerStatus: 'incomplete_expired' }), 'ignorieren')
    assert.equal(z({ aktuellerStatus: 'canceled' }), 'beenden', 'eigenes Abo laut Stripe beendet → wie deleted')
  })

  test('neues Abo bei anderem gespeicherten: nur wenn das gespeicherte beendet ist', () => {
    assert.equal(z({ gespeicherteAboId: 'sub_alt', aboId: 'sub_neu', gespeichertesAboBeendet: true }), 'uebernehmen')
    assert.equal(z({ gespeicherteAboId: 'sub_alt', aboId: 'sub_neu', gespeichertesAboBeendet: false }), 'ignorieren')
    assert.equal(z({ gespeicherteAboId: 'sub_alt', aboId: 'sub_neu' }), 'ignorieren', 'unbekannt → ignorieren')
  })

  test('Testphase nur einmal je Stripe-Kunde', () => {
    assert.equal(r.testphaseTage({ bisherigeAbos: 0, tage: 14 }), 14)
    assert.equal(r.testphaseTage({ bisherigeAbos: 1, tage: 14 }), undefined, 'Wiederabschluss nach Kündigung: sofort zahlen')
    assert.equal(r.testphaseTage({ bisherigeAbos: 0, tage: 0 }), undefined)
  })
})

// ── Fake-Admin-Client für aboEreignisAbgleichen ──────────────────────────────
function fakeAdmin(tenants, { fehlerBeim = null } = {}) {
  const log = []
  const from = (tabelle) => {
    assert.equal(tabelle, 'tenants')
    const q = { art: 'select', filter: [], daten: null, rueckgabe: false }
    const passt = (t) => q.filter.every(([op, sp, w]) => op === 'eq' ? t[sp] === w : (t[sp] ?? null) === null)
    const b = {
      select() { if (q.art === 'update') q.rueckgabe = true; return b },
      update(d) { q.art = 'update'; q.daten = d; return b },
      eq(sp, w) { q.filter.push(['eq', sp, w]); return b },
      is(sp, w) { assert.equal(w, null); q.filter.push(['is', sp, null]); return b },
      then(ok, nok) {
        let erg
        if (fehlerBeim === q.art) erg = { data: null, error: { message: 'DB weg' } }
        else if (q.art === 'select') erg = { data: tenants.filter(passt).map(t => ({ ...t })), error: null }
        else {
          const treffer = tenants.filter(passt)
          treffer.forEach(t => Object.assign(t, q.daten))
          log.push({ daten: q.daten, anzahl: treffer.length })
          erg = { data: q.rueckgabe ? treffer.map(t => ({ id: t.id })) : null, error: null }
        }
        return Promise.resolve(erg).then(ok, nok)
      },
    }
    return b
  }
  return { admin: { from }, log }
}

function deps(tenants, extra = {}) {
  const fa = fakeAdmin(tenants, extra)
  const calls = { paket: [], invalid: 0, geladen: [] }
  return {
    fa, calls,
    d: {
      admin: fa.admin,
      aboLaden: async (id) => { calls.geladen.push(id); return extra.gespeichert?.[id] ?? { id, status: 'active', priceId: null, periodeEnde: null, testphaseEnde: null } },
      paketAnwenden: async (tenantId, paket) => { calls.paket.push([tenantId, paket]); return null },
      paketAusPreis: (p) => (p === 'price_premium' ? 'premium' : p === 'price_basis' ? 'basis' : null),
      invalidieren: () => { calls.invalid++ },
      log: { info() {}, error() {} },
    },
  }
}

const abo = (p) => ({ id: 'sub_1', status: 'active', priceId: 'price_premium', periodeEnde: 1790000000, testphaseEnde: null, ...p })

describe('Stripe-Webhook: Abgleich mit Fake-Admin-Client (aboEreignisAbgleichen)', () => {
  test('erstes Abo, active: Abo-ID, Status und Paket laut Preis, Module angewendet', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: null, stripe_plan: null, stripe_status: 'incomplete' }]
    const { d, calls } = deps(t)
    const e = await sa.aboEreignisAbgleichen(d, { ereignis: 'aktualisiert', kundeId: 'cus_1', abo: abo() })
    assert.equal(e[0].aktion, 'uebernehmen')
    assert.equal(t[0].stripe_subscription_id, 'sub_1')
    assert.equal(t[0].stripe_status, 'active')
    assert.equal(t[0].stripe_plan, 'premium')
    assert.deepEqual(calls.paket, [['T1', 'premium']])
    assert.ok(calls.invalid >= 1)
  })

  test('Checkout mit offener Zahlung (incomplete): Status ja, Paket und Module nein', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: null, stripe_plan: null }]
    const { d, calls } = deps(t)
    await sa.aboEreignisAbgleichen(d, { ereignis: 'aktualisiert', kundeId: 'cus_1', abo: abo({ status: 'incomplete' }) })
    assert.equal(t[0].stripe_status, 'incomplete')
    assert.equal(t[0].stripe_plan, null)
    assert.deepEqual(calls.paket, [])
  })

  test('Kündigung: Abo-ID leer, cancelled, stripe_plan leer – Module bleiben (kein wendePaketAn)', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_plan: 'premium', stripe_status: 'active' }]
    const { d, calls } = deps(t)
    const e = await sa.aboEreignisAbgleichen(d, { ereignis: 'geloescht', kundeId: 'cus_1', abo: abo({ status: 'canceled' }) })
    assert.equal(e[0].aktion, 'beenden')
    assert.equal(t[0].stripe_subscription_id, null)
    assert.equal(t[0].stripe_status, 'cancelled')
    assert.equal(t[0].stripe_plan, null)
    assert.deepEqual(calls.paket, [], 'Module stehen lassen')
  })

  test('(a) Schlussrechnung nach Kündigung bezahlt: Betrieb bleibt gesperrt', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: null, stripe_plan: null, stripe_status: 'cancelled' }]
    const { d, fa } = deps(t)
    const e = await sa.aboEreignisAbgleichen(d, { ereignis: 'rechnung', kundeId: 'cus_1', abo: abo({ status: 'canceled' }) })
    assert.equal(e[0].aktion, 'ignorieren')
    assert.equal(t[0].stripe_status, 'cancelled')
    assert.equal(fa.log.length, 0, 'nichts geschrieben')
  })

  test('(b) payment_failed nach unpaid: frischer Status unpaid bleibt (keine bloße Warnung)', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_plan: 'premium', stripe_status: 'unpaid' }]
    const { d, calls } = deps(t)
    await sa.aboEreignisAbgleichen(d, { ereignis: 'rechnung', kundeId: 'cus_1', abo: abo({ status: 'unpaid' }) })
    assert.equal(t[0].stripe_status, 'unpaid')
    assert.equal(t[0].stripe_plan, 'premium', 'Paket bleibt')
    assert.deepEqual(calls.paket, [])
  })

  test('(c) deleted eines alten Doppel-Abos: zahlender Kunde bleibt aktiv', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_neu', stripe_plan: 'premium', stripe_status: 'active' }]
    const { d } = deps(t)
    await sa.aboEreignisAbgleichen(d, { ereignis: 'geloescht', kundeId: 'cus_1', abo: abo({ id: 'sub_alt', status: 'canceled' }) })
    assert.equal(t[0].stripe_status, 'active')
    assert.equal(t[0].stripe_subscription_id, 'sub_neu')
  })

  test('neues Abo ersetzt ein laut Stripe beendetes (gespeichertes wird nachgefragt)', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_alt', stripe_plan: null, stripe_status: 'cancelled' }]
    const { d, calls } = deps(t, { gespeichert: { sub_alt: abo({ id: 'sub_alt', status: 'canceled' }) } })
    await sa.aboEreignisAbgleichen(d, { ereignis: 'aktualisiert', kundeId: 'cus_1', abo: abo({ id: 'sub_neu', priceId: 'price_basis' }) })
    assert.deepEqual(calls.geladen, ['sub_alt'])
    assert.equal(t[0].stripe_subscription_id, 'sub_neu')
    assert.equal(t[0].stripe_plan, 'basis')
  })

  test('Abo-ID inzwischen geändert (paralleles Ereignis): nichts überschreiben, kein Paket', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stripe_plan: 'basis' }]
    const { d, calls } = deps(t)
    // zwischen Lesen und Schreiben ändert ein anderes Ereignis die Abo-ID
    const orig = d.admin.from
    let erster = true
    d.admin.from = (tab) => { const b = orig(tab); if (erster) { erster = false; const then = b.then; b.then = (ok, nok) => then.call(b, (erg) => { t[0].stripe_subscription_id = 'sub_2'; return ok(erg) }, nok) } return b }
    const e = await sa.aboEreignisAbgleichen(d, { ereignis: 'aktualisiert', kundeId: 'cus_1', abo: abo() })
    assert.equal(e[0].aktion, 'uebersprungen')
    assert.equal(t[0].stripe_subscription_id, 'sub_2')
    assert.deepEqual(calls.paket, [])
  })

  test('Datenbankfehler wirft (Webhook antwortet 500, Stripe stellt erneut zu)', async () => {
    const t = [{ id: 'T1', stripe_customer_id: 'cus_1', stripe_subscription_id: null, stripe_plan: null }]
    await assert.rejects(sa.aboEreignisAbgleichen(deps(t, { fehlerBeim: 'select' }).d, { ereignis: 'aktualisiert', kundeId: 'cus_1', abo: abo() }), /nicht lesbar/)
    await assert.rejects(sa.aboEreignisAbgleichen(deps(t, { fehlerBeim: 'update' }).d, { ereignis: 'aktualisiert', kundeId: 'cus_1', abo: abo() }), /nicht gespeichert/)
  })

  test('Webhook-Route nutzt den Abgleich und liest den Status frisch von Stripe', () => {
    const route = readFileSync(path.join(ROOT, 'src', 'app', 'api', 'stripe', 'webhook', 'route.ts'), 'utf8')
    assert.match(route, /aboEreignisAbgleichen\(/)
    assert.match(route, /subscriptions\.retrieve\(/)
    assert.doesNotMatch(route, /stripe_status:\s*'active'/, 'kein blindes active mehr')
    assert.doesNotMatch(route, /stripe_status:\s*'past_due'/, 'kein blindes past_due mehr')
    assert.match(route, /status: 500/)
    const abo = readFileSync(path.join(ROOT, 'src', 'app', 'abo', 'actions.ts'), 'utf8')
    assert.match(abo, /testphaseTage\(/)
    assert.doesNotMatch(abo, /trial_period_days: TRIAL_TAGE/, 'keine bedingungslose Testphase mehr')
  })
})

describe('Client-Wächter: welche Anfragen zurückgehalten werden', () => {
  const art = (input, init) => nl.schreibAnfrageArt(input, init, ORIGIN, SUPABASE)
  const aktion = { method: 'POST', headers: { Accept: 'text/x-component', 'Next-Action': '7f3a9c0e41d2b8', 'Next-Router-State-Tree': '%5B%5D' } }

  test('lesende Anfragen gehen immer durch', () => {
    for (const method of [undefined, 'GET', 'get', 'HEAD', 'OPTIONS']) {
      assert.equal(art('/api/ki-abfrage', method ? { method } : undefined), null, String(method))
      assert.equal(art(`${SUPABASE}/rest/v1/kontakte?select=*`, method ? { method } : undefined), null, String(method))
    }
    assert.equal(art('/meldungen/bki-traubenverkauf/csv?jahrgang=2026'), null, 'CSV-Export')
    assert.equal(art('/api/export/bmd?art=stammdaten'), null, 'BMD-Export')
  })

  test('Server Actions werden erkannt – aber NICHT zurückgehalten (Formular bekommt die Antwort des Servers)', () => {
    assert.equal(art(`${ORIGIN}/kellerbuch`, aktion), 'aktion')
    assert.equal(art('/weinhandel/verkauf/neu', aktion), 'aktion')
    assert.equal(art('/dashboard/fristen', { ...aktion, headers: new Headers(aktion.headers) }), 'aktion', 'Headers-Objekt')
    assert.equal(art('/dashboard', { method: 'POST', headers: [['next-action', 'abc']] }), 'aktion', 'Header-Liste, Kleinschreibung')
    assert.equal(art('/dashboard', { method: 'POST', headers: { 'X-Wert': 'Ümlaut…' } }), 'api', 'Nicht-ASCII-Kopfzeile wirft nicht')
    assert.equal(art('/dashboard', { method: 'POST' }), 'api', 'ohne Next-Action: API-Form')
    assert.equal(nl.zurueckhalten('aktion'), false)
    for (const a of ['api', 'datenbank', 'speicher']) assert.equal(nl.zurueckhalten(a), true, a)
  })

  test('schreibende API-Anfragen → api (KI, Assistent, Import, Belege …)', () => {
    for (const p of ['/api/ki-abfrage', '/api/assistent/chat', '/api/import', '/api/buchhaltung/belege', '/api/weinexport/1/dokument', '/api/visitkarte', '/api/nachrichten/lead-vorschlag']) {
      assert.equal(art(p, { method: 'POST' }), 'api', p)
    }
    assert.equal(art('/api/weinexport/1', { method: 'PATCH' }), 'api')
    assert.equal(art('/api/nachrichten/delete?id=1', { method: 'DELETE' }), 'api')
  })

  test('Request- und URL-Objekte', () => {
    assert.equal(art(new Request(`${ORIGIN}/api/ki-abfrage`, { method: 'POST', body: '{}' })), 'api')
    assert.equal(art(new Request(`${ORIGIN}/api/ki-abfrage`)), null)
    assert.equal(art(new URL('/api/kostenrechnung', ORIGIN), { method: 'POST' }), 'api')
    assert.equal(art(new Request(`${ORIGIN}/kellerbuch`, { method: 'POST', headers: { 'Next-Action': 'x' } })), 'aktion')
    assert.equal(nl.anfragePfad(new Request(`${ORIGIN}/api/ki-abfrage?x=1`), ORIGIN), '/api/ki-abfrage')
    assert.equal(nl.anfragePfad('/api/visitkarte', ORIGIN), '/api/visitkarte')
    assert.equal(nl.anfragePfad(42, ORIGIN), '')
  })

  test('freie Pfade: Abo, Stripe, Anmeldung, Betrieb wechseln, Profil, Zwei-Faktor', () => {
    const frei = ['/abo', '/abo/', '/api/stripe/webhook', '/auth/betrieb', '/auth/callback', '/api/auth/m365', '/login', '/signup',
      '/betrieb-waehlen', '/zwei-faktor', '/profil', '/api/profil', '/benutzer', '/betrieb/einstellungen',
      '/api/benachrichtigungen', '/api/release-notes', '/api/system/ereignis', '/api/besuchsplanung',
      '/api/nachrichten/disconnect', '/api/betrieb/aktiv', '/api/me/active-tenant']
    for (const p of frei) {
      assert.equal(nl.nurLesenFreierPfad(p), true, p)
      // Server Actions werden auch hier erkannt (Hinweis bei Ablehnung), aber nie zurückgehalten
      assert.equal(art(p, aktion), 'aktion', `${p} (Server Action)`)
      assert.equal(art(`${p}?x=1`, { method: 'POST' }), null, `${p} (POST)`)
    }
  })

  test('Pfadgrenzen: nur exakt oder darunter', () => {
    for (const p of ['/abonnement', '/abox', '/api/profile', '/benutzerliste', '/api/meldungen', '/profilbild', '/api/stripes']) {
      assert.equal(nl.nurLesenFreierPfad(p), false, p)
      assert.equal(art(p, { method: 'POST' }), 'api', p)
    }
    assert.equal(nl.nurLesenFreierPfad('/betrieb'), false, '/betrieb selbst ist nicht frei, nur /betrieb/einstellungen')
    assert.equal(nl.nurLesenFreierPfad('/betrieb-waehlen/x'), true)
  })

  test('Supabase direkt: Tabellen und Speicher schreiben → gesperrt; Auth, RPC, Signieren, Listen frei', () => {
    assert.equal(art(`${SUPABASE}/rest/v1/keller_behandlungen`, { method: 'POST' }), 'datenbank')
    assert.equal(art(`${SUPABASE}/rest/v1/keller_behandlungen?id=eq.1`, { method: 'PATCH' }), 'datenbank')
    assert.equal(art(`${SUPABASE}/rest/v1/keller_behandlungen?id=eq.1`, { method: 'DELETE' }), 'datenbank')
    assert.equal(art(`${SUPABASE}/rest/v1/rpc/get_next_rechnungsnummer`, { method: 'POST' }), null, 'RPC (auch lesende; schreibende sperrt die DB)')
    assert.equal(art(`${SUPABASE}/auth/v1/logout`, { method: 'POST' }), null, 'Abmelden')
    assert.equal(art(`${SUPABASE}/auth/v1/factors/abc/verify`, { method: 'POST' }), null, 'Zwei-Faktor')
    assert.equal(art(`${SUPABASE}/storage/v1/object/belege/t/1.pdf`, { method: 'POST' }), 'speicher')
    assert.equal(art(`${SUPABASE}/storage/v1/object/belege/t/1.pdf`, { method: 'PUT' }), 'speicher')
    assert.equal(art(`${SUPABASE}/storage/v1/object/belege`, { method: 'DELETE' }), 'speicher')
    assert.equal(art(`${SUPABASE}/storage/v1/object/sign/belege/t/1.pdf`, { method: 'POST' }), null, 'signierter Link')
    assert.equal(art(`${SUPABASE}/storage/v1/object/list/belege`, { method: 'POST' }), null, 'Liste')
    assert.equal(nl.schreibAnfrageArt(`${SUPABASE}/rest/v1/x`, { method: 'POST' }, ORIGIN, null), null, 'ohne Supabase-URL keine Aussage')
  })

  test('fremde Herkünfte und Unlesbares gehen durch', () => {
    assert.equal(art('https://api.stripe.com/v1/checkout/sessions', { method: 'POST' }), null)
    assert.equal(art('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST' }), null)
    assert.equal(art('//evil.example/api/x', { method: 'POST' }), null, 'protokollrelativ = fremd')
    assert.equal(art(42, { method: 'POST' }), null)
    assert.equal(art(null, { method: 'POST' }), null)
  })
})

describe('Client-Wächter: Antwort statt Absenden', () => {
  test('API: 403 JSON mit fehler/error/meldung – KI-Routen mit der KI-Meldung', async () => {
    const a = nl.sperrAntwort('api', '/api/import')
    const res = new Response(a.body, { status: a.status, headers: a.headers })
    assert.equal(res.status, 403)
    assert.equal(res.ok, false)
    assert.deepEqual(await res.json(), r.sperrAntwortKoerper())
    assert.equal(res.headers.get('x-s112-nur-lesen'), '1')
    for (const p of ['/api/ki-abfrage', '/api/assistent/chat', '/api/nachrichten/lead-vorschlag', '/api/visitkarte']) {
      assert.equal(JSON.parse(nl.sperrAntwort('api', p).body).fehler, r.KI_SPERRE_MELDUNG, p)
      assert.equal(nl.sperrArtFuer('api', p), 'ki', p)
    }
    assert.equal(nl.sperrArtFuer('datenbank', '/api/ki-abfrage'), 'speichern')
    assert.equal(nl.sperrArtFuerPfad('/api/ki-abfragen'), 'speichern', 'Pfadgrenze')
  })

  test('PostgREST- und Speicher-Fehlerform', async () => {
    const db = JSON.parse(nl.sperrAntwort('datenbank').body)
    assert.equal(db.code, '42501')
    assert.equal(db.hint, 'abo_gesperrt', 'wie die Datenbank-Sperre')
    assert.equal(db.message, r.SCHREIBSPERRE_MELDUNG)
    const sp = JSON.parse(nl.sperrAntwort('speicher').body)
    assert.equal(sp.message, r.SCHREIBSPERRE_MELDUNG)
  })

  test('fehlerText() zeigt die Sperre wie eine Ablehnung des Servers', async () => {
    const { fehlerText, dbFehlerText, AktionsFehler } = await import('../../src/lib/fehler.ts')
    assert.equal(fehlerText(new AktionsFehler(r.SCHREIBSPERRE_MELDUNG)), r.SCHREIBSPERRE_MELDUNG, 'pruefeSchreibzugriff wirft AktionsFehler')
    assert.equal(dbFehlerText(JSON.parse(nl.sperrAntwort('datenbank').body)), r.SCHREIBSPERRE_MELDUNG, '42501 unverändert')
  })
})

// ── Abgleich Server ↔ Browser ↔ Datenbank ────────────────────────────────────

function routeDateien(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) routeDateien(p, out)
    else if (/^route\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

/** src/app/(gruppe)/a/[id]/route.ts → /a/x */
function urlPfad(datei) {
  const rel = path.relative(path.join(ROOT, 'src', 'app'), path.dirname(datei)).split(path.sep)
  return '/' + rel.filter(s => !/^\(.*\)$/.test(s)).map(s => (/^\[.*\]$/.test(s) ? 'x' : s)).join('/')
}

/** Schreibende Handler einer Route mit „schreibsperre-ausnahme:“ bzw. mit Prüfung */
function handlerDerRoute(text) {
  const zeilen = text.replace(/\r\n/g, '\n').split('\n')
  const out = []
  zeilen.forEach((z, i) => {
    const m = /^export async function (POST|PUT|PATCH|DELETE)\(/.exec(z)
    if (!m) return
    let j = i - 1
    let ausnahme = false
    while (j >= 0 && zeilen[j].trim().startsWith('//')) { if (zeilen[j].includes('schreibsperre-ausnahme:')) ausnahme = true; j-- }
    out.push({ methode: m[1], ausnahme })
  })
  return out
}

describe('Abgleich: Ausnahmen des Servers sind im Browser frei', () => {
  // Server-zu-Server bzw. nur Super-Admin (hat nie den Nur-Lesen-Modus) – der Browser ruft sie im
  // Arbeitsbereich nicht auf, eine Freigabe im Wächter ist dort nicht nötig
  const OHNE_BROWSER = new Set(['/api/sumup/webhook', '/api/m365/webhook', '/api/csp-bericht', '/api/email/poll', '/api/email/spiegel',
    '/api/cron/taeglich', '/api/cron/morgenbericht', '/api/cron/ea-dauerauftraege'])
  const routen = routeDateien(path.join(ROOT, 'src', 'app')).map(d => ({ pfad: urlPfad(d), handler: handlerDerRoute(readFileSync(d, 'utf8')), text: readFileSync(d, 'utf8') }))

  test('jede Route-Ausnahme ist im Wächter freigegeben (sonst hielte der Browser zurück, was der Server erlaubt)', () => {
    const ausnahmen = routen.filter(x => x.handler.some(h => h.ausnahme))
    assert.ok(ausnahmen.length >= 10, `nur ${ausnahmen.length} Ausnahmen gefunden – Pfadberechnung prüfen`)
    for (const x of ausnahmen) {
      if (OHNE_BROWSER.has(x.pfad)) continue
      assert.equal(nl.nurLesenFreierPfad(x.pfad), true, `${x.pfad}: Server-Ausnahme, aber im Wächter nicht frei (NUR_LESEN_FREIE_PFADE)`)
    }
  })

  test('freie API-Pfade sperren serverseitig nicht (Freigabe im Browser wäre sonst wirkungslos)', () => {
    for (const x of routen) {
      if (!x.pfad.startsWith('/api/') || !nl.nurLesenFreierPfad(x.pfad)) continue
      assert.equal(x.text.includes('schreibSperreKonflikt('), false, `${x.pfad} ist im Wächter frei, prüft aber die Schreibsperre`)
    }
  })

  test('KI, Assistent und schreibende Kernrouten prüfen die Schreibsperre – KI-Routen mit der KI-Meldung', () => {
    for (const p of ['/api/ki-abfrage', '/api/assistent/chat', '/api/import', '/api/buchhaltung/belege', '/api/visitkarte', '/api/nachrichten/lead-vorschlag', '/api/weinexport', '/api/kostenrechnung']) {
      const x = routen.find(y => y.pfad === p)
      assert.ok(x, `${p} nicht gefunden`)
      assert.ok(x.text.includes('schreibSperreKonflikt('), `${p} ohne schreibSperreKonflikt()`)
    }
    for (const k of nl.NUR_LESEN_KI_PFADE) {
      const treffer = routen.filter(y => y.pfad === k || y.pfad.startsWith(k + '/'))
      assert.ok(treffer.length > 0, `${k}: keine Route`)
      for (const x of treffer) {
        if (!x.handler.length) continue
        assert.match(x.text, /schreibSperreKonflikt\(.*, 'ki'\)/, `${x.pfad}: KI-Route ohne art 'ki'`)
      }
    }
  })

  test('KI-RPC: Fehler werden ausgewertet (fail-closed), nicht verworfen', () => {
    const ki = readFileSync(path.join(ROOT, 'src', 'app', 'api', 'ki-abfrage', 'route.ts'), 'utf8')
    assert.match(ki, /error: limitFehler \} = await \(kiZaehler\.rpc as any\)\('check_und_increment_ki_abfrage'/)   // KAN-22: Admin-Client
    assert.match(ki, /hint === 'abo_gesperrt'/)
    const mb = readFileSync(path.join(ROOT, 'src', 'lib', 'morgenbericht', 'ki.ts'), 'utf8')
    assert.match(mb, /error: limitFehler \} = await \(client\.rpc as any\)\('check_und_increment_ki_abfrage'/)
    assert.match(mb, /'gesperrt'/)
  })

  test('der CSV-Export sperrt bei gesperrtem Abo nicht mehr (nur noch Zwei-Faktor)', () => {
    const csv = readFileSync(path.join(ROOT, 'src', 'app', '(dashboard)', 'meldungen', '[meldung]', 'csv', 'route.ts'), 'utf8')
    assert.equal(/schreibSperre/.test(csv), false)
    const sperren = readFileSync(path.join(ROOT, 'src', 'lib', 'auth', 'sperren.ts'), 'utf8')
    assert.match(sperren, /export type SitzungsSperre = 'mfa' \| null/)
  })

  test('BMD-Export im Nur-Lesen-Modus: keine neuen Personenkonten, Protokoll-Stand im Kopf', () => {
    const bmd = readFileSync(path.join(ROOT, 'src', 'app', 'api', 'export', 'bmd', 'route.ts'), 'utf8')
    assert.match(bmd, /if \(this\.nurLesen\) return sammelkonto\(\)/)
    assert.match(bmd, /'X-BMD-Protokolliert'/)
    const client = readFileSync(path.join(ROOT, 'src', 'app', '(dashboard)', 'controlling', 'bmd', 'BmdClient.tsx'), 'utf8')
    assert.match(client, /X-BMD-Protokolliert/)
  })

  test('Datenbank-Ausnahmen passen zur Freiliste (und zur Migration, sobald sie im Repo liegt)', () => {
    assert.deepEqual([...nl.NUR_LESEN_DB_AUSNAHMEN].sort(), ['benachrichtigungen', 'tenant_memberships', 'user_email_connections'])
    // /api/benachrichtigungen ist im Browser frei und schreibt nur benachrichtigungen
    const b = routen.find(y => y.pfad === '/api/benachrichtigungen')
    const tabellen = [...b.text.matchAll(/from\('([a-z_]+)'\)/g)].map(m => m[1])
    for (const t of tabellen) assert.ok(nl.NUR_LESEN_DB_AUSNAHMEN.includes(t), `/api/benachrichtigungen schreibt ${t}, das die DB sperrt`)
    const migDir = path.join(ROOT, 'supabase', 'migrations')
    const mig = existsSync(migDir) ? readdirSync(migDir).find(f => /_kan5_abo_schreibsperre\.sql$/.test(f)) : null
    if (!mig) return   // Migration noch nicht eingespielt
    const sql = readFileSync(path.join(migDir, mig), 'utf8')
    const m = /v_ausnahmen constant text\[\] := ARRAY\[([^\]]*)\]/.exec(sql)
    assert.ok(m, 'v_ausnahmen nicht gefunden')
    assert.deepEqual(m[1].split(',').map(s => s.trim().replace(/'/g, '')).sort(), [...nl.NUR_LESEN_DB_AUSNAHMEN].sort())
    assert.ok(sql.includes(r.SCHREIBSPERRE_MELDUNG), 'Meldung der RPC-Sperre weicht von SCHREIBSPERRE_MELDUNG ab')
  })

  test('Nachricht öffnen spiegelt im Nur-Lesen-Modus keine Aktivität', () => {
    const msg = readFileSync(path.join(ROOT, 'src', 'app', 'api', 'nachrichten', 'message', 'route.ts'), 'utf8')
    assert.match(msg, /if \(kontaktInfo && msg\.id && tenantId && !nurLesen\)/)
    assert.match(msg, /leadVorschlag: absender === 'unbekannt' && !nurLesen/)
  })
})

describe('Layout im Nur-Lesen-Modus', () => {
  const layout = readFileSync(path.join(ROOT, 'src', 'app', '(dashboard)', 'layout.tsx'), 'utf8')

  test('Hinweisleisten werden nicht mitgedruckt (Rechnung, Lieferschein, Etiketten, Behördendrucke)', () => {
    const leisten = [...layout.matchAll(/<div (?:role="status" )?data-print="hide" className="print:hidden mb-4/g)]
    assert.equal(leisten.length, 3, 'Zwei-Faktor-, Nur-Lesen- und Zahlungswarnung-Leiste')
  })

  test('Befehlspalette ohne „Neu …“, Assistent ausgeblendet, Hinweis nach der AppShell, Umleitung nur bei offener Zahlung', () => {
    assert.match(layout, /darfSchreiben=\{canWrite\(role\) && !billingBlocked\}/)
    assert.match(layout, /!billingBlocked && <AssistentWidget \/>/)
    assert.ok(layout.indexOf('<NurLesenHinweis />') > layout.indexOf('</AppShell>'), 'Hinweis im DOM nach der AppShell')
    assert.match(layout, /if \(abo\.zahlungOffen\) redirect\('\/abo'\)/)
  })

  test('Hinweis: kein automatisches Ausblenden, Escape nur im Hinweis, dauerhafte Statusregion', () => {
    const h = readFileSync(path.join(ROOT, 'src', 'components', 'NurLesenHinweis.tsx'), 'utf8')
    assert.doesNotMatch(h, /ANZEIGE_MS|setTimeout\(\(\) => setSichtbar\(false\)/)
    assert.doesNotMatch(h, /window\.addEventListener\('keydown'/)
    assert.match(h, /role="status" aria-live="polite" className="sr-only"/)
  })
})

describe('Bausteine bleiben frei von Server- und React-Importen', () => {
  test('regeln.ts, nurLesen.ts und stripeAbgleich.ts', () => {
    for (const datei of ['regeln.ts', 'nurLesen.ts', 'stripeAbgleich.ts']) {
      const text = readFileSync(path.join(ROOT, 'src', 'lib', 'abo', datei), 'utf8')
      const importe = [...text.matchAll(/^(?:import|export) .* from '([^']+)'/gm)].map(m => m[1])
      for (const i of importe) assert.ok(['@/lib/pakete', '@/lib/abo/regeln', '@/lib/fehler'].includes(i), `${datei} importiert ${i}`)
    }
  })
})

describe('Next-Interna, auf die sich der Wächter verlässt', () => {
  const require = createRequire(import.meta.url)
  const nextDir = path.dirname(require.resolve('next/package.json'))
  const lies = rel => readFileSync(path.join(nextDir, 'dist', rel), 'utf8')

  test('Server Actions tragen die Kopfzeile next-action', () => {
    assert.match(lies('client/components/app-router-headers.js'), /ACTION_HEADER = 'next-action'/)
  })

  test('revalidateTag kennt { expire: 0 } (sofort ablaufen statt stale-while-revalidate)', () => {
    const kopf = readFileSync(path.join(ROOT, 'src', 'lib', 'tenant', 'kopf.ts'), 'utf8')
    assert.match(kopf, /revalidateTag\(`tenant-\$\{tenantId\}`, \{ expire: 0 \}\)/)
    const doku = path.join(nextDir, 'dist', 'docs', '01-app', '03-api-reference', '04-functions', 'revalidateTag.md')
    if (existsSync(doku)) assert.match(readFileSync(doku, 'utf8'), /\{ expire: 0 \}/)
  })
})

// ── Guard check-schreibsperre.js an Beispiel-Dateien ─────────────────────────

describe('Guard check-schreibsperre.js', () => {
  function lauf(dateien) {
    const wurzel = mkdtempSync(path.join(tmpdir(), 'kan5-guard-'))
    try {
      for (const [rel, inhalt] of Object.entries({ 'src/app/api/leer/route.ts': 'export async function GET() { return null }\n', ...dateien })) {
        const ziel = path.join(wurzel, rel)
        mkdirSync(path.dirname(ziel), { recursive: true })
        writeFileSync(ziel, inhalt)
      }
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-schreibsperre.js')], { env: { ...process.env, S112_GUARD_ROOT: wurzel }, encoding: 'utf8' })
      return { code: r.status, text: `${r.stdout}${r.stderr}` }
    } finally {
      rmSync(wurzel, { recursive: true, force: true })
    }
  }

  test('sauberer Fall besteht', () => {
    const r = lauf({ 'src/app/x/actions.ts': `'use server'\nasync function ctx() { const m = await hole(); await pruefeSchreibzugriff(m); return m }\nexport async function speichere() { const m = await ctx(); await db.from('a').insert({}) }\n` })
    assert.equal(r.code, 0, r.text)
  })

  test('Schreiben im Aufrufer VOR dem prüfenden Helfer wird gemeldet', () => {
    const r = lauf({ 'src/app/x/actions.ts': `'use server'\nasync function ctx() { const m = await hole(); await pruefeSchreibzugriff(m); return m }\nexport async function speichere() { await db.from('a').insert({}); const m = await ctx() }\n` })
    assert.equal(r.code, 1)
    assert.match(r.text, /SCHREIBSPERRE_ZU_SPAET/)
    assert.match(r.text, /vor dem Aufruf von ctx\(\)/)
  })

  test('Datei-Ausnahme gilt nur im Dateikopf', () => {
    const ok = lauf({ 'src/app/x/actions.ts': `'use server'\n// schreibsperre-ausnahme-datei: Plattform-Admin, von der Sperre ausgenommen\nexport async function a() { await db.from('a').insert({}) }\n` })
    assert.equal(ok.code, 0, ok.text)
    const spaet = lauf({ 'src/app/x/actions.ts': `'use server'\nexport async function a() { await db.from('a').insert({}) }\n// schreibsperre-ausnahme-datei: irgendwo versteckt, gilt nicht\n` })
    assert.equal(spaet.code, 1)
    assert.match(spaet.text, /AUSNAHME_DATEI_ZU_SPAET/)
  })

  test('Inline-\'use server\' mit eigenem Schreibzugriff braucht die Prüfung; reine Weiterleitung nicht', () => {
    const weiter = lauf({ 'src/app/x/page.tsx': `import { speichere } from './actions'\nexport default function S() { async function h(fd: FormData) { 'use server'\n await speichere(fd) }\n return null }\n` })
    assert.equal(weiter.code, 0, weiter.text)
    const selbst = lauf({ 'src/app/x/page.tsx': `export default function S() { async function h() { 'use server'\n await db.from('a').delete() }\n return null }\n` })
    assert.equal(selbst.code, 1)
    assert.match(selbst.text, /Inline-Server-Action schreibt selbst/)
  })

  test('GET, der schreibt, muss die Schreibsperre fragen oder begründen', () => {
    const offen = lauf({ 'src/app/api/y/route.ts': `export async function GET() { await db.from('a').update({}) ; return null }\n` })
    assert.equal(offen.code, 1)
    assert.match(offen.text, /SCHREIBENDER_GET/)
    const gefragt = lauf({ 'src/app/api/y/route.ts': `export async function GET() { const n = await schreibSperre(m); if (!n) await db.from('a').update({}); return null }\n` })
    assert.equal(gefragt.code, 0, gefragt.text)
    const begruendet = lauf({ 'src/app/api/y/route.ts': `// schreibsperre-ausnahme: persönliche Einstellung, keine Betriebsdaten\nexport async function GET() { await db.from('a').update({}); return null }\n` })
    assert.equal(begruendet.code, 0, begruendet.text)
  })
})

// KAN-8 (06.10.2026): Upgrade nur gegen bezahlte Rechnung
describe('KAN-8 Paketwechsel: Upgrade sofort abrechnen, nur nach Zahlung freischalten', () => {
  test('Upgrade: always_invoice + pending_if_incomplete; Downgrade und gleiches Paket: Gutschrift wie bisher', () => {
    const up = { proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' }
    const runter = { proration_behavior: 'create_prorations' }
    assert.deepEqual(r.paketwechselParameter('basis', 'standard'), up)
    assert.deepEqual(r.paketwechselParameter('standard', 'premium'), up)
    assert.deepEqual(r.paketwechselParameter(null, 'basis'), up)
    assert.deepEqual(r.paketwechselParameter('premium', 'standard'), runter)
    assert.deepEqual(r.paketwechselParameter('standard', 'standard'), runter)
  })
  test('Selbstservice-Wechsel: Parameter aus paketwechselParameter, metadata nie im Upgrade-Aufruf, pending_update schaltet nichts frei', () => {
    const s = readFileSync(new URL('../../src/app/abo/actions.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const aufruf = s.slice(s.indexOf('const aktualisiert = await stripe.subscriptions.update'), s.indexOf('aboStatus = aktualisiert.status'))
    assert.match(aufruf, /\.\.\.paketwechselParameter\(altesPaket, paket\)/)
    assert.doesNotMatch(aufruf, /metadata|create_prorations/)
    assert.match(s, /zahlungAusstehend = !!aktualisiert\.pending_update/)
    assert.match(s, /if \(zahlungAusstehend \|\| !entscheidung\.moduleAnwenden\) \{/)
  })
})
