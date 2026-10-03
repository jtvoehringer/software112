// KAN-192 Etappe A (03.10.2026): Kellerbuch-Abschluss – Vorschlag fürs Datum, Seite und Server-Action
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan192-abschluss.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { abschlussVorschlag } from '../../src/lib/kellerbuch/journal.ts'

const quelle = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

test('Vorschlag: letzter 31. Juli vor heute (BSM-Stichtag), danach gestern', () => {
  assert.equal(abschlussVorschlag('2026-10-03', null), '2026-07-31')
  assert.equal(abschlussVorschlag('2026-07-31', null), '2025-07-31')
  assert.equal(abschlussVorschlag('2026-08-01', null), '2026-07-31')
  assert.equal(abschlussVorschlag('2026-10-03', '2026-07-31'), '2026-10-02')
  assert.equal(abschlussVorschlag('2027-01-01', '2026-07-31'), '2026-12-31')
})

test('Server-Action: Betriebsprüfung, Schreibsperre, nur Betriebsleitung, RPC', () => {
  const a = quelle('src/app/(dashboard)/kellerbuch/journal/actions.ts')
  const i = (t) => a.indexOf(t)
  assert.ok(i('pruefeSeitenBetrieb(membership.tenantId)') > 0 && i('pruefeSchreibzugriff(membership)') > i('pruefeSeitenBetrieb(membership.tenantId)'))
  assert.ok(i('canAdmin(membership.role)') > i('pruefeSchreibzugriff(membership)'))
  assert.match(a, /rpc as any\)\('kellerbuch_abschliessen'/)
})

test('Seite: Abschluss-Karte für alle, Formular nur für die Betriebsleitung, Blend-Protokoll mit Chargennummer', () => {
  const p = quelle('src/app/(dashboard)/kellerbuch/journal/page.tsx')
  assert.match(p, /Kellerbuch-Abschluss/)
  assert.match(p, /canAdmin\(membership\.role\) && \(!gesperrtBis \|\| gesperrtBis < gestern\) && \(\s*<AbschlussForm/)
  const b = quelle('src/lib/behoerden/blend.ts')
  assert.match(b, /chargennummer: text\(wa\.chargennummer\)/)
})
