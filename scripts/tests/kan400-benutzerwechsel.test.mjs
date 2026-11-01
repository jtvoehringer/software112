// KAN-400 (01.11.2026): Ein Browser hat genau eine Anmeldung (Sitzungs-Cookie für alle Tabs). Meldet sich in einem
// anderen Tab ein anderer Benutzer an, zeigte ein offener Tab weiter den alten Benutzer, schrieb aber mit der neuen
// Sitzung. Der Betriebs-Wächter erkennt den Benutzerwechsel und sperrt mit „Anderer Benutzer angemeldet“.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as w from '../../src/lib/tenant/waechter.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const A = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

describe('KAN-400: Benutzer in Meldung und Abfrage', () => {
  test('Meldung trägt den Benutzer mit und wird wieder gelesen', () => {
    const m = w.meldungBauen({ tenantId: A, name: 'Sandbox', userId: U1, benutzer: 'jv@icp-consultants.at' }, 'tab-1', 5)
    assert.equal(m.userId, U1)
    assert.equal(m.benutzer, 'jv@icp-consultants.at')
    assert.deepEqual(w.meldungLesen(JSON.stringify(m)), m)
  })
  test('Meldung ohne Benutzer bleibt wie bisher (ältere Tabs)', () => {
    const m = w.meldungBauen({ tenantId: A, name: 'Sandbox' }, 'tab-1', 5)
    assert.equal('userId' in m, false)
    assert.equal('userId' in w.meldungLesen(m), false)
  })
  test('benutzerAusAntwort: auch ohne Betrieb, Unsinn = keine Aussage', () => {
    assert.deepEqual(w.benutzerAusAntwort({ tenantId: null, userId: U2, benutzer: 'pd@x.at' }), { userId: U2, benutzer: 'pd@x.at' })
    assert.deepEqual(w.benutzerAusAntwort({ userId: U2 }), { userId: U2, benutzer: '' })
    assert.equal(w.benutzerAusAntwort({ tenantId: A }), null)
    assert.equal(w.benutzerAusAntwort({ userId: '' }), null)
    assert.equal(w.benutzerAusAntwort({ userId: 'x'.repeat(101) }), null)
    assert.equal(w.benutzerAusAntwort(null), null)
    assert.equal(w.benutzerAusAntwort('U2'), null)
  })
})

describe('KAN-400: Entscheidung', () => {
  const ok = (benutzer) => ({ ok: true, aktiv: { tenantId: A, name: 'Sandbox' }, benutzer })
  test('Server meldet anderen Benutzer → sperren', () => {
    assert.deepEqual(w.benutzerGewechselt(U1, ok({ userId: U2, benutzer: 'pd@x.at' })), { userId: U2, benutzer: 'pd@x.at' })
  })
  test('gleicher Benutzer, keine Aussage oder Seite ohne Benutzer → nicht sperren', () => {
    assert.equal(w.benutzerGewechselt(U1, ok({ userId: U1, benutzer: 'jv@x.at' })), null)
    assert.equal(w.benutzerGewechselt(U1, ok(null)), null)
    assert.equal(w.benutzerGewechselt(U1, ok(undefined)), null)
    assert.equal(w.benutzerGewechselt(null, ok({ userId: U2, benutzer: '' })), null)
    assert.equal(w.benutzerGewechselt(undefined, ok({ userId: U2, benutzer: '' })), null)
  })
  test('Server-Antwort zählt vor der Meldung eines anderen Tabs', () => {
    const hinweis = { tenantId: A, name: 'Sandbox', userId: U2, benutzer: 'pd@x.at' }
    assert.equal(w.benutzerGewechselt(U1, ok({ userId: U1, benutzer: '' }), hinweis), null)
  })
  test('Abfrage gescheitert → abweichende Meldung eines anderen Tabs zählt, sonst nicht', () => {
    const hinweis = { tenantId: A, name: 'Sandbox', userId: U2, benutzer: 'pd@x.at' }
    assert.deepEqual(w.benutzerGewechselt(U1, { ok: false }, hinweis), { userId: U2, benutzer: 'pd@x.at' })
    assert.equal(w.benutzerGewechselt(U1, { ok: false }, { ...hinweis, userId: U1 }), null)
    assert.equal(w.benutzerGewechselt(U1, { ok: false }, { tenantId: A, name: 'Sandbox' }), null)
    assert.equal(w.benutzerGewechselt(U1, { ok: false }), null)
  })
  test('andererBenutzer: nur bei bekanntem, abweichendem Benutzer nachfragen', () => {
    assert.equal(w.andererBenutzer(U1, { tenantId: A, name: '', userId: U2 }), true)
    assert.equal(w.andererBenutzer(U1, { tenantId: A, name: '', userId: U1 }), false)
    assert.equal(w.andererBenutzer(U1, { tenantId: A, name: '' }), false)
    assert.equal(w.andererBenutzer(null, { tenantId: A, name: '', userId: U2 }), false)
    assert.equal(w.andererBenutzer(U1, null), false)
  })
  test('Sperrtext nennt den neuen Benutzer bzw. „ein anderer Benutzer“', () => {
    assert.match(w.benutzerSperrText('pd@x.at'), /jetzt ‚pd@x\.at‘ angemeldet/)
    assert.match(w.benutzerSperrText('pd@x.at'), /nur einen Benutzer gleichzeitig/)
    assert.match(w.benutzerSperrText(''), /jetzt ein anderer Benutzer angemeldet/)
  })
})

describe('KAN-400: Verdrahtung', () => {
  test('API liefert den Benutzer aus getUser(), auch ohne Mitgliedschaft', () => {
    const r = quelle('src/app/api/betrieb/aktiv/route.ts')
    assert.match(r, /const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\)/)
    assert.match(r, /\{ userId: user\.id, benutzer: user\.email \?\? '' \}/)
    assert.match(r, /if \(!membership\) return NextResponse\.json\(\{ tenantId: null, name: null, \.\.\.wer \}/)
    assert.match(r, /mandant: mandantName\(kopf\), \.\.\.wer \}/)
  })
  test('Layout übergibt den Benutzer an den Wächter', () => {
    assert.match(quelle('src/app/(dashboard)/layout.tsx'), /<BetriebsWaechter [^>]*userId=\{user\.id\} benutzer=\{user\.email \?\? ''\}/)
  })
  test('Wächter prüft den Benutzer vor dem Betrieb, ohne „Zurück … wechseln“', () => {
    const c = quelle('src/components/BetriebsWaechter.tsx')
    const pruef = c.indexOf('benutzerGewechselt(seite.userId, ergebnis, hinweis)')
    assert.ok(pruef > 0)
    assert.ok(pruef < c.indexOf('sperrGrund(', pruef), 'Benutzerwechsel vor Betriebswechsel')
    assert.match(c, /weichtAb\(seite\.tenantId, m\) \|\| andererBenutzer\(seite\.userId, m\)/)
    assert.match(c, /sperre\?\.benutzer \? 'Anderer Benutzer angemeldet' : 'Betrieb gewechselt'/)
    assert.match(c, /sperre\.benutzer \? benutzerSperrText\(sperre\.benutzer\.benutzer\)/)
    assert.match(c, /\{!sperre\.benutzer && \(\s*<button type="button" onClick=\{zurueck\}/)
  })
})
