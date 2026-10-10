// KAN-205 (05.10.2026): Lese und Pressung – Pflichtangaben und Sperre nach Verpressung bzw. Folgebuchung.
// Entscheidung Jörgen (05.10.2026): Mostgewicht ist bei der Lese Pflicht – auch bei Lesegut, das später verkauft wird.
// Matrix KAN-85; DB-Test 35.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const r = hooksMoeglich ? await laden('lib/wein/lesePflicht.ts') : null

describe('KAN-205 Regeln', nurMitHooks, () => {
  test('Lese: Ried/GST, Datum, Menge > 0 und Mostgewicht Pflicht', () => {
    assert.equal(r.lesePflichtFehler({ ort: true, datum: '2026-09-20', mengeKg: 1200, kmw: 19.2 }), null)
    assert.equal(r.lesePflichtFehler({ ort: false, datum: '', mengeKg: 0, kmw: null }),
      'Bitte noch angeben: Ried bzw. Grundstück, Lesedatum, Menge (kg, größer als 0), Mostgewicht.')
    assert.match(r.lesePflichtFehler({ ort: true, datum: '2026-09-20', mengeKg: 500, kmw: null }, 'GST 123/1'), /^GST 123\/1: Bitte noch angeben: Mostgewicht\.$/)
    assert.match(r.lesePflichtFehler({ ort: true, datum: '2026-09-20', mengeKg: NaN, kmw: 18 }), /Menge/)
  })
  test('Pressung: mindestens eine Trauben- und eine Behälterzeile; Sorte und Mostgewicht je Traubenzeile', () => {
    assert.match(r.pressungZeilenFehler(0, 1), /Traubenzeile/)
    assert.match(r.pressungZeilenFehler(1, 0), /Behälterzeile/)
    assert.equal(r.pressungZeilenFehler(2, 1), null)
    assert.equal(r.traubenzeilePflichtFehler({ nr: 1, rebsorte: 'Riesling', kmw: 18.5 }), null)
    assert.match(r.traubenzeilePflichtFehler({ nr: 2, rebsorte: ' ', kmw: null }), /^Traubenzeile 2: .*Rebsorte .*Grundstück.*, Mostgewicht\.$/)
  })
})

describe('KAN-205 Datenbank und App gleich', () => {
  const mig = () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan205_lese_pressung_freeze.sql'))
    return quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan205_lese_pressung_freeze.sql')
  }
  test('Trigger: Gründe und Positivlisten wie in lesePflicht.ts; Folgebuchungs-Funktion nicht für API-Rollen', () => {
    const m = mig()
    const regeln = quelle('src/lib/wein/lesePflicht.ts')
    const liste = name => [...regeln.match(new RegExp(`${name} = \\[([\\s\\S]+?)\\] as const`))[1].matchAll(/'([^']+)'/g)].map(x => x[1]).join(',')
    const grund = name => regeln.match(new RegExp(`${name} = '([^']+)'`))[1]
    assert.match(m, new RegExp(`ON public\\.ernte_parzellen\\s+FOR EACH ROW EXECUTE FUNCTION public\\.s112_freeze\\('${grund('LESE_FREEZE_GRUND')}'`))
    assert.ok(m.includes(`'${liste('LESE_FREEZE_ERLAUBT')}'`), 'Positivliste Lese')
    for (const tab of ['pressungen', 'pressung_weingaerten']) {
      assert.match(m, new RegExp(`ON public\\.${tab}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.s112_freeze\\('${grund('PRESSUNG_FREEZE_GRUND')}'`), tab)
    }
    assert.equal(m.split(`'${liste('PRESSUNG_FREEZE_ERLAUBT')}'`).length - 1, 2, 'Positivliste Pressung (Kopf und Traubenzeilen)')
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_charge_hat_folgebuchung\(uuid\) FROM PUBLIC, anon, authenticated;/)
  })
  test('Server Actions: Pflicht und Sperre verdrahtet', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    assert.match(a, /const pflicht = lesePflichtFehler\(\{ ort: !!weingartenId,/)
    assert.match(a, /if \(await leseVerbraucht\(supabase, tenantId, jahrgangId, alt\)\)/)
    assert.match(a, /if \(!ernteDatum\) throw new AktionsFehler\('Bitte das Lesedatum angeben\.'\)/)
    assert.match(a, /const zf = pressungZeilenFehler\(weingaerten\.length, behaelter\.length\)/)
    assert.match(a, /traubenzeilePflichtFehler\(\{ nr: w\.nr, rebsorte: w\.rebsorte, kmw: w\.kmw \}\)/)
    assert.match(a, /\.update\(pressungFest \? \{ notizen \} :/)
  })
  test('Formulare: Pflichtkennzeichen für Datum, Menge und Mostgewicht', () => {
    const f = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    // KAN-318: Datumsfeld über ZukunftsDatum (setzt type="date" selbst, Hinweis bei Datum in der Zukunft)
    assert.match(f, /<ZukunftsDatum aria-label="Ernte-Datum" name="ernte_datum" required defaultValue=\{parzelle\?\.ernte_datum/)
    assert.match(f, /name="menge_kg" type="text" inputMode="decimal" required/)
    assert.match(f, /<MostgewichtEingabe name="mostgewicht" startwert=\{mgStart\} required/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx'), /label="Mostgewicht" startwert=\{row\.mgStart\} required/)
  })
})
