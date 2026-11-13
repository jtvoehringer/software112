// KAN-450 (13.11.2026): Stripe – Nettopreise mit 20 % USt abrechnen.
// Befund: Der Checkout übergab Stripe nur Preis und Menge – der Kunde hätte genau den Nettobetrag gezahlt, die
// Rechnung keine Umsatzsteuer ausgewiesen; Paketwechsel und Premium-Support ebenso. Jetzt hängt ein fester Steuersatz
// am Abo, der Checkout fragt die UID ab, und ohne hinterlegten Steuersatz wird gar nicht abgerechnet.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  stripeSteuersatzId, checkoutSteuerOptionen, steuersatzNachziehen, STEUERSATZ_FEHLT, ABO_PREIS_HINWEIS, ABO_UST_PROZENT,
} from '../../src/lib/abo/steuer.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-450: Steuersatz aus der Umgebung', () => {
  test('nur eine echte Steuersatz-ID zählt – leer, Leerzeichen, Preis-ID oder Text gelten als „fehlt“', () => {
    assert.equal(stripeSteuersatzId({ STRIPE_TAX_RATE_UST: 'txr_1AbCdEf' }), 'txr_1AbCdEf')
    assert.equal(stripeSteuersatzId({ STRIPE_TAX_RATE_UST: '  txr_1AbCdEf \n' }), 'txr_1AbCdEf')
    for (const v of [undefined, '', '   ', 'price_123', '20', 'txr_', 'txr_ab cd', 'tx_123']) {
      assert.equal(stripeSteuersatzId({ STRIPE_TAX_RATE_UST: v }), null, String(v))
    }
  })
  test('Meldung und Preis-Hinweis', () => {
    assert.match(STEUERSATZ_FEHLT, /Umsatzsteuersatz fehlt/)
    assert.match(STEUERSATZ_FEHLT, /Es wurde nichts abgerechnet/)
    assert.equal(ABO_UST_PROZENT, 20)
    assert.equal(ABO_PREIS_HINWEIS, 'Alle Preise sind Nettopreise zuzüglich 20 % USt.')
  })
})

describe('KAN-450: Checkout-Optionen und Nachziehen', () => {
  test('UID-Abfrage, Rechnungsadresse, Kundendaten aus dem Checkout – kein Stripe Tax daneben', () => {
    const o = checkoutSteuerOptionen()
    assert.deepEqual(o, { tax_id_collection: { enabled: true }, customer_update: { name: 'auto', address: 'auto' }, billing_address_collection: 'required' })
    assert.ok(!('automatic_tax' in o), 'fester Steuersatz und Stripe Tax schließen sich aus')
  })
  test('bestehendes Abo: Steuersatz nur setzen, wenn er fehlt', () => {
    assert.deepEqual(steuersatzNachziehen({}, 'txr_a'), { default_tax_rates: ['txr_a'] })
    assert.deepEqual(steuersatzNachziehen({ default_tax_rates: null }, 'txr_a'), { default_tax_rates: ['txr_a'] })
    assert.deepEqual(steuersatzNachziehen({ default_tax_rates: [] }, 'txr_a'), { default_tax_rates: ['txr_a'] })
    // anderer Satz am Abo (z. B. aus einer anderen Umgebung bzw. von Hand): unserer ersetzt ihn
    assert.deepEqual(steuersatzNachziehen({ default_tax_rates: [{ id: 'txr_alt' }] }, 'txr_a'), { default_tax_rates: ['txr_a'] })
    assert.equal(steuersatzNachziehen({ default_tax_rates: [{ id: 'txr_a' }] }, 'txr_a'), null)
    assert.equal(steuersatzNachziehen({ default_tax_rates: ['txr_a'] }, 'txr_a'), null)
  })
})

describe('KAN-450: Verdrahtung', () => {
  const abo = quelle('src/app/abo/actions.ts')
  const adm = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
  test('beide Checkouts: Abbruch ohne Steuersatz VOR dem Stripe-Aufruf, dieselben Abo-Daten und Optionen', () => {
    for (const [name, t, tenant] of [['Betrieb', abo, 'membership.tenantId'], ['Plattform-Admin', adm, 'tenantId']]) {
      const i = t.indexOf('checkout.sessions.create({')
      assert.ok(i > 0, name)
      const davor = t.slice(0, i)
      assert.ok(davor.lastIndexOf('if (!steuersatzId) return { error: STEUERSATZ_FEHLT }') > davor.lastIndexOf('const steuersatzId = stripeSteuersatzId()'), `${name}: Abbruch`)
      const aufruf = t.slice(i, t.indexOf('})', i))
      assert.ok(aufruf.includes(`subscription_data: checkoutAboDaten(${tenant}, steuersatzId),`), `${name}: Abo-Daten`)
      assert.ok(aufruf.includes('...checkoutSteuerOptionen(),'), `${name}: Optionen`)
      assert.ok(!/trial_period_days|trial_end|automatic_tax/.test(aufruf), `${name}: kein Testzeitraum, kein Stripe Tax`)
    }
    // der Admin-Checkout baut seine Abo-Daten nicht mehr selbst
    assert.doesNotMatch(adm, /subscription_data: \{\s+metadata: \{ tenant_id: tenantId \},\s+\},/)
  })
  test('Abo-Daten tragen den Steuersatz', () => {
    const r = quelle('src/lib/abo/regeln.ts')
    assert.match(r, /export function checkoutAboDaten\(tenantId: string, steuersatzId: string\): \{ metadata: \{ tenant_id: string \}; default_tax_rates: string\[\] \} \{\s+return \{ metadata: \{ tenant_id: tenantId \}, default_tax_rates: \[steuersatzId\] \}/)
  })
  test('Paketwechsel: Abbruch ohne Steuersatz; Nachziehen eigens und vor dem Wechsel', () => {
    const wechsel = abo.slice(abo.indexOf("return { error: 'Dieses Paket ist bereits aktiv.' }"), abo.indexOf('// ── Premium-Support buchen und kündigen'))
    assert.match(wechsel, /const steuersatzId = stripeSteuersatzId\(\)\s+if \(!steuersatzId\) return \{ error: STEUERSATZ_FEHLT \}/)
    const n = wechsel.indexOf('if (nachziehen) await stripe.subscriptions.update(sub.id, nachziehen)')
    const w = wechsel.indexOf('items: [{ id: item.id, price: priceId }],')
    assert.ok(n > 0 && w > n, 'erst der Steuersatz, dann der Wechsel')
    // im Wechsel-Aufruf selbst stehen nur Position und Abrechnungsart (pending_if_incomplete erlaubt nichts Weiteres)
    assert.match(wechsel, /items: \[\{ id: item\.id, price: priceId \}\],\s+\.\.\.paketwechselParameter\(altesPaket, paket\),\s+\}\)/)
  })
  test('Premium-Support: Abbruch ohne Steuersatz; Nachziehen vor der neuen Position', () => {
    const ps = abo.slice(abo.indexOf('export async function premiumSupportBuchenAction'), abo.indexOf('export async function premiumSupportKuendigenAction'))
    assert.match(ps, /if \(fehler\) return \{ error: fehler \}\s+\/\/[^\n]*\n\s+const steuersatzId = stripeSteuersatzId\(\)\s+if \(!steuersatzId\) return \{ error: STEUERSATZ_FEHLT \}/)
    assert.ok(ps.indexOf('if (nachziehen) await stripe.subscriptions.update(sub.id, nachziehen)') < ps.indexOf("metadata: { s112_art: PREMIUM_ART"), 'erst der Steuersatz')
  })
  test('Anzeige: Preise als netto, Hinweis auf Abo- und Registrierungsseite, Handbuch', () => {
    assert.match(quelle('src/lib/pakete.ts'), /return `\$\{paket\.preisMonat\} € \/ Monat netto`/)
    for (const f of ['src/app/abo/AboClient.tsx', 'src/app/signup/SignupClient.tsx']) {
      assert.match(quelle(f), /data-preis-hinweis>\{ABO_PREIS_HINWEIS\}<\/p>/, f)
    }
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /titel: 'Preise und Rechnung', inhalt: 'Alle Preise \(Pakete, Zusatzmandant, Premium-Support\) sind Nettopreise zuzüglich 20 % Umsatzsteuer\./)
  })
  test('Doku nennt Steuersatz, Variable, Rechnungsvorlage, Kunden-E-Mails und Kundenportal', () => {
    const d = quelle('docs/STRIPE_EINRICHTUNG.md')
    for (const t of ['STRIPE_TAX_RATE_UST', 'Steuersätze', 'exklusive', 'Rechnungsvorlage', 'Kunden-E-Mails', 'Rechnungsverlauf', 'default_tax_rates']) {
      assert.ok(d.includes(t), t)
    }
  })
})
