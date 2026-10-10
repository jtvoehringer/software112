// Sweep 90 (KAN-282, 10.10.2026): Zählabfragen werten ihren Fehler aus.
// `const { count } = await …` ohne error hieß bei einem Datenbankfehler 0: Signup legte einen zweiten Betrieb an,
// E-Mail-Abruf und M365-Webhook legten dieselbe Mail doppelt an, Paketwechsel ignorierte den Abrechnungsverbund,
// eine Kellerbehandlung ließ sich ohne Pflichtstoff speichern, Kacheln zeigten 0.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-einzelabfrage.js'))
hooksRegistrieren()
const g = hooksMoeglich ? await laden('lib/supabase/geladen.ts') : null
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const US = "'use server'\n"

describe('check-einzelabfrage: Zählabfragen', () => {
  test('{ count } ohne error → Fund, auch in Promise.all; mit error bzw. begründet → kein Fund', () => {
    const z = t => pruefeText(t).funde.map(f => [f.zeile, /Zählabfrage/.test(f.text)])
    assert.deepEqual(z(`${US}export async function a(s) {\n  const { count } = await s.from('t').select('id', { count: 'exact', head: true })\n  return count\n}\n`), [[3, true]])
    assert.deepEqual(z(`${US}export async function a(s) {\n  const [{ count: n }, { count: m, error }] = await Promise.all([s.from('t').select('id'), s.from('u').select('id')])\n  return n + m + !!error\n}\n`), [[3, true]])
    assert.deepEqual(z(`${US}export async function a(s) {\n  const { count, error } = await s.from('t').select('id', { count: 'exact', head: true })\n  if (error) throw error\n  return count\n}\n`), [])
    assert.deepEqual(z(`${US}export async function a(s) {\n  // abfrage-ohne-fehler: nur eine Anzeige ohne Folgen, Fehler darf 0 heißen\n  const { count } = await s.from('t').select('id')\n  return count\n}\n`), [])
  })

  test('Projekt sauber, keine Altfälle', () => {
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    assert.equal(e.altfaelle, 0)
  })
})

describe('gezaehlt()', nurMitHooks, () => {
  test('liefert die Anzahl (null → 0), wirft bei error', () => {
    assert.equal(g.gezaehlt({ count: 7, error: null }, 'Leads'), 7)
    assert.equal(g.gezaehlt({ count: null, error: null }, 'Leads'), 0)
    assert.throws(() => g.gezaehlt({ count: null, error: { message: 'Zeitüberschreitung' } }, 'Leads'), /Leads konnte nicht gezählt werden \(Zeitüberschreitung\)/)
  })
})

describe('Regression: Entscheidungen nach einer Zählung', () => {
  test('Signup: Lesefehler → neutrale Antwort, kein zweiter Betrieb', () => {
    assert.match(quelle('src/app/signup/actions.ts'), /if \(mitglErr\) \{[^}]*return neutraleAntwort\(email\) \}\n/)
  })
  test('E-Mail-Abruf überspringt, M365-Webhook antwortet 500 (erneute Zustellung) – kein Duplikat', () => {
    assert.match(quelle('src/app/api/email/poll/route.ts'), /if \(dupErr\) \{[^}]*continue \}\n\s*if \(\(count \?\? 0\) > 0\) continue/)
    assert.match(quelle('src/app/api/m365/webhook/route.ts'), /if \(dupErr\) \{[\s\S]{0,200}status: 500 \}\)\n\s*\}\n\s*if \(\(count \?\? 0\) > 0\) continue/)
  })
  test('Nachricht: gescheitertes Aktualisieren legt keinen zusätzlichen Eintrag an', () => {
    assert.match(quelle('src/app/api/nachrichten/message/route.ts'), /if \(updErr\) \{ void ereignisMelden\([^)]*\); return \}\n[\s\S]{0,80}if \(!count \|\| count === 0\)/)
  })
  test('Paketwechsel und Kellerbehandlung lehnen bei Lesefehler ab', () => {
    assert.match(quelle('src/app/abo/actions.ts'), /if \(verbundErr\) return \{ error: dbFehlerText\(verbundErr, 'Abrechnungsverbund konnte nicht geprüft werden'\) \}/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/actions.ts'), /if \(kmZErr\) throw new AktionsFehler\(dbFehlerText\(kmZErr, 'Stoffe konnten nicht geprüft werden'\)\)/)
  })
})
