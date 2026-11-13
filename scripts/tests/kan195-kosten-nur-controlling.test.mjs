// KAN-195 (04.10.2026): Die Datenbank sperrt das Schreiben in Paket-Modul-Tabellen, wenn das Modul aus ist – für die
// Kostenrechnung (kosteneintraege, kosteneintrag_weingaerten …) ist das modul_controlling. Das Maßnahmen-Formular
// bietet „Kosten erfassen“ deshalb nur mit Modul Controlling an, und die Server Actions fassen Kosteneinträge ohne
// Modul nicht an (sonst schlüge das Speichern der Maßnahme bzw. die Kostenbuchung still fehl).
//
// Aufruf:  npm run -s test:csv   bzw. node --test scripts/tests/kan195-kosten-nur-controlling.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = p => readFileSync(path.join(ROOT, p), 'utf8')
const AKTIONEN = lies('src/app/(dashboard)/behandlungen/actions.ts')

describe('KAN-195: Kosten in Maßnahmen nur mit Modul Controlling', () => {
  test('Server Actions: Kosteneintrag anlegen/aktualisieren nur mit hatModul(modul_controlling)', () => {
    assert.match(AKTIONEN, /if \(await hatModul\('modul_controlling'\)\) await ggfKostenEintragAnlegen\(/)
    assert.match(AKTIONEN, /if \(await hatModul\('modul_controlling'\)\) await ggfKostenEintragAktualisieren\(/)
    // keine ungeschützten Aufrufe
    assert.equal((AKTIONEN.match(/await ggfKostenEintrag(Anlegen|Aktualisieren)\(/g) ?? []).length, 2)
  })
  for (const [seite, formular] of [
    ['src/app/(dashboard)/behandlungen/neu/page.tsx', 'src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx'],
    ['src/app/(dashboard)/behandlungen/[id]/edit/page.tsx', 'src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx'],
  ]) {
    test(`${path.basename(formular)}: Abschnitt „Kosten erfassen“ nur mit kostenModul`, () => {
      // KAN-456: zusätzlich nur mit Lesebereich „controlling“ (das Profil „Extern“ erfasst keine Kosten) – das Modul bleibt Bedingung
      assert.match(lies(seite), /kostenModul=\{\(await hatModul\('modul_controlling'\)\) && canRead\(membership, 'controlling'\)\}/)
      assert.match(lies(formular), /className=\{kostenModul \? 'card space-y-3' : 'hidden'\}/)
    })
  }
})
