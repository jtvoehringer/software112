// Hotfix (05.10.2026): Titel für Kontakte – vorangestellt aus der Auswahl, nachgestellt frei.
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
const t = hooksMoeglich ? await laden('lib/crm/titel.ts') : null

describe('Kontakt-Titel', nurMitHooks, () => {
  test('Auswahl: gängige österreichische Titel, leer → null, fremder Wert abgelehnt, gespeicherter Altwert bleibt', () => {
    for (const x of ['Mag.', 'Dr.', 'Dipl.-Ing.', 'DI', 'Ing.', 'KR', 'ÖkR', 'Univ.-Prof.']) assert.ok(t.TITEL_OPTS.includes(x), x)
    assert.deepEqual(t.titelAusFormular(' Mag. '), { wert: 'Mag.', fehler: null })
    assert.deepEqual(t.titelAusFormular(''), { wert: null, fehler: null })
    assert.match(t.titelAusFormular('Graf').fehler, /nicht in der Auswahl/)
    assert.deepEqual(t.titelAusFormular('Bürgermeister', 'Bürgermeister'), { wert: 'Bürgermeister', fehler: null })
  })
  test('Nachgestellt: frei alphanumerisch, Länge und Zeichen geprüft', () => {
    assert.deepEqual(t.titelNachgestelltAusFormular('  MSc,  MBA '), { wert: 'MSc, MBA', fehler: null })
    assert.deepEqual(t.titelNachgestelltAusFormular('LL.M. (WU)'), { wert: 'LL.M. (WU)', fehler: null })
    assert.deepEqual(t.titelNachgestelltAusFormular(''), { wert: null, fehler: null })
    assert.match(t.titelNachgestelltAusFormular('=HYPERLINK()').fehler, /unzulässige Zeichen/)
    assert.match(t.titelNachgestelltAusFormular('x'.repeat(61)).fehler, /zu lang/)
  })
  test('Anzeigename: „Mag. Maria Muster, MSc“ bzw. nach Nachname „Muster Maria (Mag., MSc)“', () => {
    const k = { titel: 'Mag.', vorname: 'Maria', nachname: 'Muster', titel_nachgestellt: 'MSc' }
    assert.equal(t.kontaktAnzeigename(k), 'Mag. Maria Muster, MSc')
    assert.equal(t.kontaktAnzeigename(k, 'nachname'), 'Muster Maria (Mag., MSc)')
    assert.equal(t.kontaktAnzeigename({ vorname: 'Max', nachname: 'Muster' }), 'Max Muster')
    assert.equal(t.kontaktAnzeigename({ nachname: 'Muster' }, 'nachname'), 'Muster')
  })
})

describe('Kontakt-Titel Verdrahtung', () => {
  test('Formular, Server Actions, Spaltenliste, Detail', () => {
    const f = quelle('src/app/(dashboard)/crm/kontakte/KontakteClient.tsx')
    assert.match(f, /<select aria-label="Titel" name="titel"/)
    assert.match(f, /name="titel_nachgestellt"/)
    const a = quelle('src/app/(dashboard)/crm/actions.ts')
    assert.equal((a.match(/\.\.\.kontaktTitel\(formData/g) ?? []).length, 2)
    assert.match(quelle('src/lib/crm/liste.ts'), /quelle, titel, titel_nachgestellt'/)
    assert.match(quelle('src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx'), /const name = kontaktAnzeigename\(kontakt\)/)
  })
})

describe('Kontakt-Titel in der Anschrift', () => {
  test('Rechnung/Lieferschein, Rechnungs-E-Mail, Weinexport-Dokumente und Momentaufnahme führen den Titel', () => {
    const r = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(r, /kontakt:kontakte!kontakt_id\(id, titel, vorname, nachname, titel_nachgestellt,/)
    assert.match(r, /return kontaktAnzeigename\(p\.kontakt as R\)/)
    assert.equal((r.match(/kontaktAnzeigename\(posten\.zh_kontakt as R\)/g) ?? []).length, 2)
    const m = quelle('src/app/api/weinhandel/verkauf/[id]/send/route.ts')
    assert.match(m, /if \(p\.kontakt\) return kontaktAnzeigename\(p\.kontakt\)/)
    assert.match(m, /zHande: posten\.zh_kontakt \? kontaktAnzeigename\(posten\.zh_kontakt\) : null/)
    assert.match(quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts'), /kontakte\(titel,vorname,nachname,titel_nachgestellt,email\)/)
  })
})
