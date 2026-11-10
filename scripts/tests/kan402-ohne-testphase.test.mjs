// KAN-402 (10.11.2026) – keine kostenlose Testphase mehr (Vertrag v3: NV 2.3/4.1, AGB 2.3). Die entgeltliche Nutzung
// beginnt mit der Freischaltung; Registrierung, Abo-Seite und Hilfe dürfen keine Testphase mehr versprechen.
// Altfälle mit Stripe-Status 'trialing' wertet die Sperrlogik weiter aus (Status-Etikett „Testphase“ in
// lib/stripe/client.ts, Morgenbericht-Befund) – das ist kein Versprechen an neue Kunden.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('KAN-402: keine Testphase in Texten für Kunden', () => {
  const dateien = [
    'src/app/signup/actions.ts',
    'src/app/signup/SignupClient.tsx',
    'src/app/signup/willkommen/page.tsx',
    'src/app/abo/AboClient.tsx',
    'src/app/(dashboard)/hilfe/faq/page.tsx',
    'src/app/(dashboard)/hilfe/handbuch/page.tsx',
  ]
  for (const d of dateien) {
    test(`${d}: kein Hinweis auf eine (kostenlose, 14-tägige) Testphase`, () => {
      const s = quelle(d)
      assert.doesNotMatch(s, /14-tägig|14 Tage|kostenlos testen/, d)
      // Code-Kommentare zu KAN-402 dürfen „Testphase“ nennen, sichtbare Texte nicht
      // „eine kostenlose Testphase gibt es nicht“ (FAQ, Handbuch) ist erlaubt
      const ohneKommentare = s.replace(/\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/eine kostenlose Testphase gibt es nicht/g, '')
      assert.doesNotMatch(ohneKommentare, /Testphase/, d)
    })
  }
  test('FAQ erklärt, wann die Abrechnung beginnt', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/faq/page.tsx'), /frage: 'Wann beginnt die Abrechnung\?'/)
    assert.match(quelle('src/app/signup/SignupClient.tsx'), /Abrechnung monatlich ab der Freischaltung/)
  })
  test('Abo-Seite: Hinweis „Noch kein Paket gebucht“ statt „Testphase abgelaufen“', () => {
    const a = quelle('src/app/abo/AboClient.tsx')
    assert.match(a, /Noch kein Paket gebucht/)
    assert.doesNotMatch(a, /trialAbgelaufen/)
    assert.match(quelle('src/app/abo/page.tsx'), /nochKeinPaketGebucht\(stripeStatus, hatAbo\)/)
  })
})
