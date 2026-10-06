// KAN-41 Paket 1 (06.10.2026) – datierter Statuswechsel Most ↔ Wein
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft: welche Statuswechsel buchungsrelevant sind (Most/teilweise gegoren ↔ Wein), die Datumsprüfung und die
// Verdrahtung: updateWeinausbau bucht diese Wechsel über die RPC s112_charge_status_setzen mit dem Formulardatum.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { istMostStatus, statusWechselBuchungsrelevant, statusDatumFehler } = await import('../../src/lib/kellerbuch/chargeStatus.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('statusWechselBuchungsrelevant()', () => {
  test('Most bzw. Gärung → Wein und zurück', () => {
    assert.equal(statusWechselBuchungsrelevant('gaerung', 'ausbau'), true)
    assert.equal(statusWechselBuchungsrelevant('ernte', 'abfuellung'), true)
    assert.equal(statusWechselBuchungsrelevant('ausbau', 'gaerung'), true)
  })
  test('innerhalb Most bzw. innerhalb Wein, unverändert → nicht relevant', () => {
    assert.equal(statusWechselBuchungsrelevant('ernte', 'gaerung'), false)
    assert.equal(statusWechselBuchungsrelevant('ausbau', 'abgeschlossen'), false)
    assert.equal(statusWechselBuchungsrelevant('ausbau', 'ausbau'), false)
  })
  test('istMostStatus', () => {
    assert.equal(istMostStatus('ernte'), true)
    assert.equal(istMostStatus('gaerung'), true)
    assert.equal(istMostStatus('ausbau'), false)
    assert.equal(istMostStatus(null), false)
  })
})

describe('statusDatumFehler()', () => {
  test('leer = heute, gültig, Zukunft, ungültig', () => {
    assert.equal(statusDatumFehler('', '2026-10-06'), null)
    assert.equal(statusDatumFehler('2026-10-01', '2026-10-06'), null)
    assert.match(statusDatumFehler('2026-10-07', '2026-10-06'), /Zukunft/)
    assert.match(statusDatumFehler('06.10.2026', '2026-10-06'), /gültiges Datum/)
  })
})

describe('Verdrahtung', () => {
  test('updateWeinausbau: buchungsrelevanter Wechsel über die RPC mit Formulardatum, Status nicht im einfachen Update', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const i = a.indexOf('if (statusWechselBuchungsrelevant(alt.status as string | null, neuStatus))')
    assert.ok(i > 0)
    const block = a.slice(i, i + 900)
    assert.match(block, /formData\.get\('status_datum'\)/)
    assert.match(block, /rpc\('s112_charge_status_setzen'/)
    assert.match(block, /delete payload\.status/)
    const update = a.indexOf(".update(payload).eq('id', id).eq('tenant_id', tenantId)", i)
    assert.ok(update > i && update - i < 1500, 'RPC direkt vor dem Update der übrigen Felder')
  })
  test('Formular zeigt das Datum nur bei einem buchungsrelevanten Wechsel', () => {
    const f = quelle('src/components/kellerbuch/WeinausbauForm.tsx')
    assert.match(f, /statusWechselBuchungsrelevant\(weinausbau\.status, status\) && \(/)
    assert.match(f, /name="status_datum"/)
  })
})
