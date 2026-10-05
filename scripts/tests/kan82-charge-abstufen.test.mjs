// KAN-82 (05.10.2026): Aktion „Abstufen“ an der Charge und im Kellerplan – Datum, Menge, Pflichtgrund, Protokoll.
// Entscheidungen Jörgen: Teilmenge nur mit Umzug in ein leeres Gebinde (danach wird die neue Charge abgestuft);
// Rückdatieren bis zum Kellerbuch-Abschluss (prüft die RPC, DB-Test 32).
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const ab = hooksMoeglich ? await laden('lib/kellerbuch/abstufen.ts') : null

const m = (stufe, zusatz = null, herkunft = null, erzeugnis = null) => ({ stufe, zusatz, erzeugnis, herkunft })

describe('KAN-82 Auswahl beim Abstufen', nurMitHooks, () => {
  test('Stufen: bisherige und niedrigere, keine höhere, kein „Sonstiges“', () => {
    const liste = [{ value: 'wein', label: 'Wein', rang: 0 }, { value: 'landwein', label: 'Landwein', rang: 1 }, { value: 'qualitaetswein', label: 'Qualitätswein', rang: 2 },
      { value: 'kabinett', label: 'Kabinett', rang: 3 }, { value: 'spaetlese', label: 'Spätlese', rang: 4 }, { value: 'sonstiges', label: 'Sonstiges', rang: 0 }]
    const o = ab.abstufenStufen(m('kabinett'), liste).map(x => x.value)
    assert.equal(o[0], 'kabinett')
    assert.ok(o.includes('qualitaetswein') && o.includes('landwein') && o.includes('wein'))
    assert.ok(!o.includes('spaetlese') && !o.includes('sonstiges'))
  })
  test('Zusatz: bisheriger und darunter; ohne Zusatz keine Auswahl', () => {
    const z = ab.abstufenZusaetze(m('qualitaetswein', 'grosse_reserve')).map(x => x.value)
    assert.ok(z.includes('grosse_reserve') && z.includes('reserve'))
    assert.deepEqual(ab.abstufenZusaetze(m('qualitaetswein')), [])
  })
  test('Herkunft: bisherige und breitere Stufen; ohne Herkunft keine Auswahl', () => {
    assert.deepEqual(ab.abstufenHerkuenfte(m('qualitaetswein', null, 'kremstal_gebietswein')).map(x => x.value),
      ['kremstal_gebietswein', 'wlnoe', 'weinland', 'wein'])
    assert.deepEqual(ab.abstufenHerkuenfte(m('qualitaetswein')), [])
  })
})

describe('KAN-82 Prüfung', nurMitHooks, () => {
  const alt = m('kabinett', null, 'kremstal_gebietswein')
  test('zulässig: niedrigere Stufe, breitere Herkunft, beides', () => {
    assert.equal(ab.abstufenFehler(alt, m('qualitaetswein', null, 'kremstal_gebietswein')), null)
    assert.equal(ab.abstufenFehler(alt, m('kabinett', null, 'wlnoe')), null)
    assert.equal(ab.abstufenFehler(alt, m('landwein', null, 'weinland')), null)
  })
  test('abgelehnt: nichts geändert, Aufwertung, anderer Ast, Herkunft neu gesetzt, Erzeugnis', () => {
    assert.match(ab.abstufenFehler(alt, alt), /Nichts zu ändern/)
    assert.match(ab.abstufenFehler(alt, m('spaetlese', null, 'kremstal_gebietswein')), /keine Abstufung/)
    assert.match(ab.abstufenFehler(alt, m('kabinett', null, 'kamptal_gebietswein')), /nur eine breitere Stufe/)
    assert.match(ab.abstufenFehler(m('kabinett'), m('kabinett', null, 'wein')), /keine Herkunft/)
    assert.match(ab.abstufenFehler(m('qualitaetswein', null, null, 'SEKTGU'), m('qualitaetswein')), /Erzeugnis/)
  })
  test('Zusatz verlieren bzw. senken ist eine Abstufung', () => {
    assert.equal(ab.abstufenFehler(m('qualitaetswein', 'grosse_reserve'), m('qualitaetswein', 'reserve')), null)
    assert.equal(ab.abstufenFehler(m('qualitaetswein', 'reserve'), m('qualitaetswein')), null)
  })
  test('Teilmenge: zwischen 0,01 L und unter dem Bestand', () => {
    assert.equal(ab.teilmengeFehler(200, 800), null)
    assert.match(ab.teilmengeFehler(null, 800), /mindestens 0,01 L/)
    assert.match(ab.teilmengeFehler(800, 800), /ganze Charge/)
  })
  test('Text für Protokoll und Weinbuch', () => {
    assert.equal(ab.abstufungText(alt, m('qualitaetswein', null, 'wlnoe')), 'Kabinett → Qualitätswein · Kremstal DAC – Gebietswein → Niederösterreich – Qualitätswein')
  })
})

describe('KAN-82 Verdrahtung', () => {
  const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
  const f = a.slice(a.indexOf('export async function chargeAbstufen'), a.indexOf('// ANALYSEN'))
  test('Action: Schreibrecht, Prüfung, RPC; Teilmenge über Umzug, ganze Charge mit PN-Rückfrage', () => {
    assert.match(f, /const tenantId = await kellerbuchSchreibrecht\(\)/)
    assert.match(f, /const fehler = abstufenFehler\(alt, neu\)/)
    assert.match(f, /const r = await umziehen\(fd\)/)
    assert.match(f, /pruefePruefnummernSchaden\(supabase, tenantId, 'abstufung'/)
    assert.match(f, /rpc\('s112_charge_abstufen', \{\n\s*p_tenant_id: tenantId, p_weinausbau_id: zielId, p_datum: datum, p_neu, p_grund: grund, p_quelle_weinausbau_id: quelleId,/)
  })
  test('Einstiege: Charge, Kellerplan, Befehlspalette', () => {
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /\/kellerbuch\/weinausbau\/\$\{weinausbau\.id\}\/abstufen/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx'), /\/kellerbuch\/weinausbau\/\$\{dialogWein\.weinausbauId\}\/abstufen/)
    assert.match(quelle('src/components/CommandPalette.tsx'), /id: 'a:abstufen'.*href: '\/kellerbuch\/abstufen'/)
  })
  test('Weinbuch zeigt Abstufungen samt Grund', () => {
    const w = quelle('src/lib/wein/weinbuch.ts')
    assert.match(w, /from\('charge_umstufungen'\)/)
    assert.match(w, /typ: 'umstufung'/)
    assert.match(quelle('src/lib/behoerden/weinbuch.ts'), /umstufung:\s+'Abstufung'/)
  })
  test('FAQ widerspricht nicht mehr („Downgrade jederzeit“)', () => {
    const faq = quelle('src/app/(dashboard)/hilfe/faq/page.tsx')
    assert.doesNotMatch(faq, /Downgrade ist jederzeit möglich/i)
    assert.match(faq, /über „Abstufen“ ab \(an der Charge, im Kellerplan und über Strg K\)/)
  })
})
