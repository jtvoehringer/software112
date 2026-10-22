// KAN-353 Nachtrag (22.10.2026, Entscheidung Jörgen): Das CRM-Formular prüft die Weinbau-Betriebsnummer von Kontakt
// und Firma genauso wie die Schnellanlage aus der Partner-Suche – optional, nur Ziffern, höchstens 10 Stellen, nicht „0“.
// Vorher speicherte das CRM jede Eingabe ungeprüft.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-353: Betriebsnummer im CRM', () => {
  test('Regel (Händler-Variante = optional)', nurMitHooks, async () => {
    const { weinbauBetriebsnummerPruefen } = await laden('lib/betrieb/betriebsnummer.ts')
    assert.deepEqual(weinbauBetriebsnummerPruefen('', 'weinhaendler'), { ok: true, wert: null })
    assert.equal(weinbauBetriebsnummerPruefen('4285221', 'weinhaendler').ok, true)
    assert.equal(weinbauBetriebsnummerPruefen('12a4', 'weinhaendler').ok, false)
    assert.equal(weinbauBetriebsnummerPruefen('0', 'weinhaendler').ok, false)
    assert.equal(weinbauBetriebsnummerPruefen('12345678901', 'weinhaendler').ok, false)
  })

  test('Anlegen und Ändern von Kontakt und Firma prüfen die Betriebsnummer vor dem Schreiben', () => {
    const a = quelle('src/app/(dashboard)/crm/actions.ts')
    assert.match(a, /function betriebNrFeld\(formData: FormData\)[\s\S]{0,200}weinbauBetriebsnummerPruefen\(formData\.get\('betrieb_nr'\) \?\? '', 'weinhaendler'\)/)
    assert.equal((a.match(/const bnr = betriebNrFeld\(formData\)\n\s+if \(bnr\.fehler !== undefined\) return \{ error: bnr\.fehler \}/g) ?? []).length, 4)
    assert.doesNotMatch(a, /betrieb_nr:\s+\(formData\.get\('betrieb_nr'\) as string\) \|\| null/)
    assert.equal((a.match(/betrieb_nr:\s+bnr\.wert/g) ?? []).length, 4)
  })
})
