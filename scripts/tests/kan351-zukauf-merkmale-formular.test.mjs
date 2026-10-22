// KAN-351 (22.10.2026) – Zukauf bearbeiten: Rebsorte, Weinart, Jahrgang, Qualität, Herkunft … wirkten änderbar,
// obwohl die Zielcharge schon weiterbewegt war; die Ablehnung (updateZukauf, Trigger a_freeze) kam erst nach dem
// Speichern. Jetzt: dieselbe Bedingung (zukaufMerkmaleFest) in Seite und Action, das Formular sperrt die Merkmal-Felder
// und zeigt <GesperrtHinweis> mit dem Grund.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const s = hooksMoeglich ? await laden('lib/zukauf/merkmalSperre.ts') : null
const C = '00000000-0000-4000-8000-0000000000c1'

describe('KAN-351: Bedingung wie der Trigger a_freeze', nurMitHooks, () => {
  test('Zielcharge mit Folgebuchung → fest, Grund „weiterbewegt“', () => {
    const lage = { art: 'wein', zielWeinausbauId: C, folgebuchungen: 2 }
    assert.equal(s.zukaufMerkmaleFest(lage), true)
    assert.equal(s.zukaufMerkmalSperrGrund(lage), 'Die Zielcharge ist bereits weiterbewegt')
  })
  test('ohne Folgebuchung, ohne Zielcharge oder Trauben → änderbar', () => {
    for (const lage of [
      { art: 'wein', zielWeinausbauId: C, folgebuchungen: 0 },
      { art: 'most', zielWeinausbauId: null, folgebuchungen: 3 },   // ohne Charge zählt keine Folgebuchung (wie der Trigger)
      { art: 'trauben', zielWeinausbauId: null, folgebuchungen: 0 },
    ]) {
      assert.equal(s.zukaufMerkmaleFest(lage), false, JSON.stringify(lage))
      assert.equal(s.zukaufMerkmalSperrGrund(lage), null)
    }
  })
  test('Flaschenzukauf immer fest (Weinlager-Artikel)', () => {
    const lage = { art: 'flaschen', zielWeinausbauId: null, folgebuchungen: 0 }
    assert.equal(s.zukaufMerkmaleFest(lage), true)
    assert.match(s.zukaufMerkmalSperrGrund(lage), /Weinlager-Artikel/)
  })
  test('Trigger-Bedingung der letzten Migration stimmt mit der Funktion überein', () => {
    const dateien = readdirSync(new URL('../../supabase/migrations', import.meta.url)).filter(n => n.endsWith('.sql')).sort()
    let letzte = null
    for (const n of dateien) {
      const t = quelle(`supabase/migrations/${n}`)
      const m = t.match(/CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public\.zukauf_posten[\s\S]*?\$\$([\s\S]*?)\$\$/)
      if (m) letzte = m[1].replace(/\s+/g, ' ').trim()
    }
    assert.equal(letzte, "o.storniert_am IS NULL AND o.aktiv AND (o.art = 'flaschen' OR o.ziel_weinausbau_id IS NOT NULL AND public.s112_zukauf_hat_folgebuchung(o.ziel_weinausbau_id, o.id))",
      'Trigger geändert – zukaufMerkmaleFest (src/lib/zukauf/merkmalSperre.ts) nachziehen')
  })
})

describe('KAN-351: Seite, Formular und Action nutzen dieselbe Bedingung', () => {
  test('Seite berechnet merkmaleFest und reicht Grund weiter', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/page.tsx')
    assert.match(p, /const merkmalLage = \{ art: z\.art, zielWeinausbauId, folgebuchungen: folge\.length \}/)
    assert.match(p, /const merkmaleFest = zukaufMerkmaleFest\(merkmalLage\)/)
    assert.match(p, /merkmaleFest=\{merkmaleFest\}/)
    assert.match(p, /merkmalSperrGrund=\{merkmalSperrGrund\}/)
  })
  test('Action prüft mit derselben Funktion', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
    assert.match(a, /if \(zukaufMerkmaleFest\(\{ art: a\.art, zielWeinausbauId: chargeId, folgebuchungen: folge\.length \}\)\) \{/)
  })
  test('Formular: Merkmal-Felder gesperrt, GesperrtHinweis, gespeicherte Herkunft wird gesendet', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx')
    assert.match(f, /<GesperrtHinweis\n\s+grund=/)
    for (const feld of ['aria-label="Datum"', 'aria-label="Rebsorte\\(n\\)"', 'aria-label="Jahrgang"', 'aria-label="Qualitätsstufe"', 'aria-label="Alkoholgehalt \\(%vol\\)"']) {
      assert.match(f, new RegExp(`${feld}[^<]{0,260}?disabled=\\{merkmaleFest\\}`), feld)
    }
    assert.match(f, /name="weinart"[^>]*disabled=\{merkmaleFest\}/)
    assert.match(f, /<LandSelect [^>]*disabled=\{merkmaleFest\}/)
    assert.match(f, /nurAnzeige=\{merkmaleFest\}/)
    assert.match(f, /<MostgewichtEingabe [^>]*disabled=\{merkmaleFest\}/)
    assert.match(f, /emptyLabel="– bitte wählen –"\n\s+disabled=\{merkmaleFest\}/)
    assert.match(f, /onChange=\{e => setAnreicherung\(e\.target\.checked\)\} disabled=\{merkmaleFest\}/)
    assert.match(f, /if \(merkmaleFest && value !== initial\.art\) return true/)
    assert.match(f, /fd\.set\('herkunft',\s+merkmaleFest \? initial\.herkunft_gespeichert : herkunft\)/)
    // änderbar bleiben Notizen, Rechnungsnummer und Prüfnummer
    assert.doesNotMatch(f, /aria-label="Notizen"[^>]*disabled/)
    assert.doesNotMatch(f, /aria-label="Staatl\. Prüfnummer"[^>]*disabled/)
  })
})
