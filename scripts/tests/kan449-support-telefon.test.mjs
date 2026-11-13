// KAN-449 (13.11.2026), Vorab-Teil: Support-Telefonnummer nur für Betriebe mit Premium-Support.
// Die KI-Annahme mit Sammelruf ist zurückgestellt; bis dahin steht Jörgens Nummer in der Vercel-Variable SUPPORT_TELEFON.
// Befund davor: Die Nummer kam aus NEXT_PUBLIC_SUPPORT_TELEFON – eine NEXT_PUBLIC-Variable kann im Browser-Paket landen
// und wäre damit auch für Betriebe ohne Premium-Support auslesbar; auf „Abo & Zahlung“ stand sie gar nicht.
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
const ps = hooksMoeglich ? await laden('lib/abo/premiumSupport.ts') : null

describe('KAN-449: Support-Kontakt aus der Umgebung', nurMitHooks, () => {
  test('serverseitige Variable geht vor; die alte NEXT_PUBLIC-Variable bleibt Rückfall', () => {
    assert.equal(ps.supportKontakt({ SUPPORT_TELEFON: ' +43 664 0000000 ' }).telefon, '+43 664 0000000')
    assert.equal(ps.supportKontakt({ SUPPORT_TELEFON: '+43 1 111', NEXT_PUBLIC_SUPPORT_TELEFON: '+43 1 222' }).telefon, '+43 1 111')
    assert.equal(ps.supportKontakt({ NEXT_PUBLIC_SUPPORT_TELEFON: '+43 1 222' }).telefon, '+43 1 222')
    assert.equal(ps.supportKontakt({ SUPPORT_TELEFON: '   ' }).telefon, null)
    assert.equal(ps.supportKontakt({}).telefon, null)
    assert.equal(ps.supportKontakt({ NEXT_PUBLIC_SUPPORT_EMAIL: ' support@example.org ' }).email, 'support@example.org')
  })
  test('tel:-Verweis: nur + und Ziffern', () => {
    assert.equal(ps.telefonVerweis('+43 664 000 00 00'), 'tel:+436640000000')
    assert.equal(ps.telefonVerweis('+43.664 (0) 12-34'), 'tel:+436640' + '1234')
  })
})

describe('KAN-449: Anzeige nur mit Premium-Support', () => {
  test('„Abo & Zahlung“: Nummer nur, solange der Premium-Support aktiv ist und eine Nummer hinterlegt ist', () => {
    const p = quelle('src/app/abo/page.tsx')
    assert.match(p, /const supportTelefon = supportKontakt\(\)\.telefon/)
    assert.match(p, /\{psStand\.status === 'aktiv' && supportTelefon && \(\s+<p className="text-s112-text-2" data-support-telefon>/)
    assert.match(p, /<a href=\{telefonVerweis\(supportTelefon\)\}/)
    assert.equal(p.split('supportTelefon}').length - 1, 1, 'die Nummer steht nur in diesem einen Block')
  })
  test('Hilfe › Support: Nummer nur im Zweig „Premium-Support aktiv“', () => {
    const s = quelle('src/app/(dashboard)/hilfe/support/page.tsx')
    const aktiv = s.slice(s.indexOf('{premium ? ('), s.indexOf(') : ('))
    assert.match(aktiv, /\{kontakt\.telefon && \(/)
    assert.equal(s.split('kontakt.telefon').length - 1, s.slice(s.indexOf('{premium ? ('), s.indexOf(') : (')).split('kontakt.telefon').length - 1,
      'außerhalb des Premium-Zweigs kommt die Nummer nicht vor')
  })
  test('die Nummer steht nicht im Quelltext – nur in der Variable', () => {
    const l = quelle('src/lib/abo/premiumSupport.ts')
    assert.match(l, /const telefon = \(env\.SUPPORT_TELEFON \?\? ''\)\.trim\(\) \|\| \(env\.NEXT_PUBLIC_SUPPORT_TELEFON \?\? ''\)\.trim\(\)/)
    for (const f of ['src/lib/abo/premiumSupport.ts', 'src/app/abo/page.tsx', 'src/app/(dashboard)/hilfe/support/page.tsx']) {
      assert.doesNotMatch(quelle(f), /\+43[\s.]?6\d\d/, f)
    }
  })
})
