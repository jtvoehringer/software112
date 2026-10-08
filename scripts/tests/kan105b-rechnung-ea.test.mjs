// KAN-105 Teil B (08.10.2026) – E&A-Einnahme und „Als bezahlt markieren“ je Rechnung: Bei einer Rechnung über mehrere
// Lieferscheine (Sammelrechnung) zählen alle Lieferscheine (Positionen, Steuersätze) und alle Zahlungen der Rechnung;
// Einnahmen hängen am Anker-Lieferschein, bestehende werden über alle Lieferscheine der Rechnung erkannt.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ankerLieferschein, ladeRechnungsKontext } from '../../src/lib/verkauf/rechnungsKontext.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Attrappe: verkaufsposten mit eq/order/maybeSingle (Filter je Spalte) */
function db(zeilen) {
  return {
    from() {
      const filter = []
      const q = {
        select() { return q },
        eq(k, v) { filter.push(r => r[k] === v); return q },
        order() { return q },
        maybeSingle() { return Promise.resolve({ data: zeilen.find(r => filter.every(f => f(r))) ?? null, error: null }) },
        then(ok) { return Promise.resolve({ data: zeilen.filter(r => filter.every(f => f(r))), error: null }).then(ok) },
      }
      return q
    },
  }
}

describe('KAN-105 Teil B: Rechnungskontext', () => {
  const T = 't1'
  const zeilen = [
    { id: 'c', tenant_id: T, rechnung_id: 're1', rechnungsnummer: 'RE-9', positionen: [{ ust_satz: 20, preis_brutto: 12, menge: 1 }] },
    { id: 'a', tenant_id: T, rechnung_id: 're1', rechnungsnummer: 'RE-9', positionen: [{ ust_satz: 13, preis_brutto: 10, menge: 2 }] },
    { id: 'x', tenant_id: T, rechnung_id: null, rechnungsnummer: null, positionen: [{ ust_satz: 13, preis_brutto: 5, menge: 1 }] },
  ]
  test('Anker = kleinste ID, unabhängig vom Lieferschein der Zahlung', () => {
    assert.equal(ankerLieferschein(['c', 'a', 'b']), 'a')
  })
  test('Sammelrechnung: alle Lieferscheine und Positionen beider Steuersätze', async () => {
    const k = await ladeRechnungsKontext(db(zeilen), T, 'c', 'preis_brutto')
    assert.equal(k.rechnungId, 're1')
    assert.deepEqual([...k.lieferscheinIds].sort(), ['a', 'c'])
    assert.equal(k.anker, 'a')
    assert.deepEqual(k.positionen.map(p => p.ust_satz).sort(), [13, 20])
  })
  test('ohne Rechnung: nur dieser Lieferschein (wie bisher)', async () => {
    const k = await ladeRechnungsKontext(db(zeilen), T, 'x', 'preis_brutto')
    assert.deepEqual(k, { rechnungId: null, rechnungsnummer: null, lieferscheinIds: ['x'], anker: 'x', positionen: [{ ust_satz: 13, preis_brutto: 5, menge: 1 }] })
  })
  test('fremder Betrieb: nichts', async () => {
    assert.equal(await ladeRechnungsKontext(db(zeilen), 'fremd', 'c', 'preis_brutto'), null)
  })
})

describe('KAN-105 Teil B: Verdrahtung', () => {
  test('E&A-Abgleich: Zahlungen der Rechnung, Einnahmen am Anker, bestehende über alle Lieferscheine', () => {
    const b = quelle('src/app/(dashboard)/buchhaltung/actions.ts')
    assert.match(b, /\? zq\.eq\('rechnung_id', kontext\.rechnungId\)/)
    assert.match(b, /abgleichVerkaufsEinnahmen\(tenantId, kontext\.anker, \{ positionen: plan, zahlungen, beleg \}, kontext\.lieferscheinIds\)/)
    const e = quelle('src/lib/ea/verkaufEinnahmen.ts')
    assert.match(e, /lieferscheinIds\.length > 1\n\s+\? basis\.in\('verkaufsposten_id', \[\.\.\.lieferscheinIds\]\)/)
    assert.match(e, /: basis\.eq\('verkaufsposten_id', verkaufspostenId\)\)/)
  })
  test('„Als bezahlt markieren“: Restbetrag der ganzen Rechnung', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(a, /const kontext = await ladeRechnungsKontext\(supabase, tenantId, id, 'preis_brutto, menge, rabatt_pct, sonderrabatt_pct'\)/)
    assert.match(a, /kontext\?\.rechnungId \? zq\.eq\('rechnung_id', kontext\.rechnungId\) : zq\.eq\('verkaufsposten_id', id\)/)
  })
})
