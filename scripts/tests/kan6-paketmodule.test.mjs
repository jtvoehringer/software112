// KAN-6 (06.10.2026): Paket-Module serverseitig prüfen – nicht nur auf Seitenebene. Server-Actions und API-Routen von
// E&A, Export und Controlling lehnen ohne Freischaltung ab (verständliche Meldung bzw. 403); die Datenbank sperrt das
// Schreiben zusätzlich (KAN-195, DB-Test 01 „paketmodul_tabellen“).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbFehlerText, PAKETMODUL_AUS_MELDUNG } from '../../src/lib/fehler.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const routen = dir => readdirSync(path.join(WURZEL, dir)).flatMap(n => {
  const p = path.join(dir, n)
  return statSync(path.join(WURZEL, p)).isDirectory() ? routen(p) : n === 'route.ts' ? [p] : []
})

describe('KAN-6 Paket-Module in Actions und Routen', () => {
  test('Datenbank-Sperre (HINT paketmodul_aus) wird verständlich gemeldet', () => {
    assert.equal(dbFehlerText({ code: '42501', hint: 'paketmodul_aus', message: 'Das Modul ist für diesen Betrieb nicht freigeschaltet (modul_ea).' }), PAKETMODUL_AUS_MELDUNG)
    assert.match(PAKETMODUL_AUS_MELDUNG, /Paketwechsel/)
  })

  test('Hilfen: pruefeModul (Actions) und modulKonflikt (403 in Routen) mit Klartext je Modul', () => {
    const m = quelle('src/lib/auth/modul.ts')
    assert.match(m, /export async function pruefeModul\(flag: ModulFlag\)[\s\S]*throw new AktionsFehler\(modulAusMeldung\(flag\)\)/)
    assert.match(m, /NextResponse\.json\(\{ fehler: modulAusMeldung\(flag\) \}, \{ status: 403 \}\)/)
    assert.match(m, /modul_ea: 'E&A-Rechnung'/)
  })

  test('Server-Actions der E&A, Konten, Anlagen, BMD und Exportaufträge prüfen das Modul', () => {
    const ea = quelle('src/app/(dashboard)/buchhaltung/actions.ts')
    assert.match(ea, /async function getCtx\(mitModul = true\)[\s\S]{0,600}if \(mitModul\) await pruefeModul\('modul_ea'\)/)
    // einzige Ausnahme: Einnahme aus dem Verkauf, die ohne Modul selbst überspringt
    assert.equal(ea.split('getCtx(false)').length - 1, 1)
    // (Fenster 1000 seit KAN-251: dazwischen steht jetzt die Fehlerprüfung der Einstellungen)
    assert.match(ea, /getCtx\(false\)[\s\S]{0,1000}if \(!\(einst as R \| null\)\?\.modul_ea\) return \{ ok: true, skipped: true \}/)
    assert.match(quelle('src/app/(dashboard)/buchhaltung/anlagen/actions.ts'), /await pruefeModul\('modul_ea'\)/)
    assert.match(quelle('src/app/(dashboard)/konten/actions.ts'), /await pruefeModul\('modul_ea'\)/)
    assert.equal(quelle('src/app/(dashboard)/controlling/bmd/actions.ts').split("hatModul('modul_ea')").length - 1, 2)
    assert.match(quelle('src/app/(dashboard)/weinexport/[id]/actions.ts'), /await pruefeModul\('modul_export'\)/)
  })

  test('jeder Handler der Routen /api/weinexport und /api/kostenrechnung prüft das Modul direkt nach der Zwei-Faktor-Prüfung', () => {
    const faelle = [...routen('src/app/api/weinexport').map(r => [r, 'modul_export']), ['src/app/api/kostenrechnung/route.ts', 'modul_controlling']]
    assert.ok(faelle.length >= 6)
    for (const [r, flag] of faelle) {
      const s = quelle(r)
      const handler = (s.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
      const pruefungen = s.split(`if (zweiFaktor) return zweiFaktor\n  const ohneModul = await modulKonflikt('${flag}')`).length - 1
      assert.ok(handler > 0, r)
      assert.equal(pruefungen, handler, r)
    }
  })
})
