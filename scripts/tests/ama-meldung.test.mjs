// KAN-148 C2 (30.09.2026): AMA-Erntemeldung – Statuswechsel nur vorwärts, Datum, neueste Version, und die Verdrahtung
// von Aktionen und Lesern auf die RPCs s112_ama_* bzw. die neueste Version.
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ama-meldung.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { amaDatumFehler, amaStatusFehler, neuesteAmaVersion, AMA_OFFEN } from '../../src/lib/behoerden/amaMeldung.ts'

const lies = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

test('Status nur vorwärts: bereit → eingereicht → bestätigt/abgelehnt', () => {
  assert.equal(amaStatusFehler('bereit', 'eingereicht'), null)
  assert.equal(amaStatusFehler('eingereicht', 'bestaetigt'), null)
  assert.equal(amaStatusFehler('eingereicht', 'abgelehnt'), null)
  assert.match(amaStatusFehler('bereit', 'bestaetigt'), /nur vorwärts/)
  assert.match(amaStatusFehler('entwurf', 'eingereicht'), /nur vorwärts/)
  assert.match(amaStatusFehler('bestaetigt', 'eingereicht'), /nur vorwärts/)
  assert.match(amaStatusFehler('abgelehnt', 'bestaetigt'), /nur vorwärts/)
  assert.match(amaStatusFehler('bereit', 'bereit'), /Unbekannter Zielstatus/)
  assert.match(amaStatusFehler('bereit', 'xyz'), /Unbekannter Zielstatus/)
  assert.deepEqual([...AMA_OFFEN], ['entwurf', 'bereit'])
})

test('Datum: Pflicht, gültig, nicht in der Zukunft', () => {
  assert.equal(amaDatumFehler('2026-09-30', '2026-09-30'), null)
  assert.equal(amaDatumFehler('2026-09-01', '2026-09-30'), null)
  assert.match(amaDatumFehler('2026-10-01', '2026-09-30'), /Zukunft/)
  assert.match(amaDatumFehler('', '2026-09-30'), /gültiges Datum/)
  assert.match(amaDatumFehler('30.09.2026', '2026-09-30'), /gültiges Datum/)
})

test('neueste Version: höchste Versionsnummer, fehlende Version = 1', () => {
  assert.equal(neuesteAmaVersion([]), null)
  assert.equal(neuesteAmaVersion(null), null)
  assert.equal(neuesteAmaVersion([{ id: 'a', version: 1 }, { id: 'c', version: 3 }, { id: 'b', version: 2 }]).id, 'c')
  assert.equal(neuesteAmaVersion([{ id: 'a' }, { id: 'b', version: 2 }]).id, 'b')
})

test('Verdrahtung: Speichern, Status und Korrektur nur über die RPCs', () => {
  const a = lies('src/app/(dashboard)/erntemeldung/actions.ts')
  const start = a.indexOf('export async function createOrUpdateAMAMeldung')
  const ende = a.indexOf('// ── Pressungen ──', start)
  const block = a.slice(start, ende)
  assert.ok(block.includes("'s112_ama_meldung_speichern'"))
  assert.ok(block.includes("'s112_ama_status_setzen'"))
  assert.ok(block.includes("'s112_ama_korrektur_anlegen'"))
  // keine direkten Schreibzugriffe mehr auf Meldung und Positionen
  assert.ok(!/from\('ama_meldepositionen'\)/.test(block), 'Positionen nur über die RPC')
  assert.ok(!/\.(insert|update|delete)\(/.test(block), 'kein direktes insert/update/delete')
})

test('Leser: neueste Version statt maybeSingle je Jahrgang', () => {
  const detail = (lies('src/app/(dashboard)/erntemeldung/[id]/page.tsx') + lies('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts'))   /* Laden seit dem Pilottest in leseKontext.ts */
  assert.ok(detail.includes("order('version', { ascending: false })"))
  assert.ok(detail.includes('neuesteAmaVersion('))
  const meldung = lies('src/lib/behoerden/erntemeldung.ts')
  assert.match(meldung, /\.order\('version', \{ ascending: false \}\)\s*\n\s*\.limit\(1\)\s*\n\s*\.maybeSingle\(\)/)
  const dashboard = lies('src/app/(dashboard)/dashboard/_shared/data.ts')
  assert.ok(dashboard.includes('ama_erntemeldungen(status, eingereicht_am, version)'))
  assert.ok(dashboard.includes('neuesteAmaVersion(amVersionen)'))
  const liste = lies('src/app/(dashboard)/erntemeldung/page.tsx')
  assert.ok(liste.includes("select('jahrgang_id, status, version')"))
  assert.ok(liste.includes('amaGesperrtByJG.get(j.id)'), 'Löschsperre bei jeder eingereichten Version')
})

test('Abgleich gemeldet ↔ Lesedaten je Rebsorte (KAN-148 Soll 5)', async () => {
  const { amaAbweichungen, amaAktualisierenText } = await import('../../src/lib/behoerden/amaMeldung.ts')
  const gemeldet = [{ rebsorte_name: 'Grüner Veltliner', menge_kg: 9000 }, { rebsorte_name: 'Riesling', menge_kg: '4000' }]
  // gleich (inkl. Toleranz 0,5 kg) → leer
  assert.deepEqual(amaAbweichungen(gemeldet, [{ rebsorte: 'Riesling', mengeKg: 4000.4 }, { rebsorte: 'Grüner Veltliner', mengeKg: 9000 }]), [])
  // Lese storniert (Riesling weg) und neue Sorte → beide gemeldet, alphabetisch
  assert.deepEqual(amaAbweichungen(gemeldet, [{ rebsorte: 'Grüner Veltliner', mengeKg: 9000 }, { rebsorte: 'Zweigelt', mengeKg: 100 }]), [
    { rebsorte: 'Riesling', gemeldetKg: 4000, aktuellKg: 0 },
    { rebsorte: 'Zweigelt', gemeldetKg: 0, aktuellKg: 100 },
  ])
  assert.equal(amaAktualisierenText('bereit'), '„Neu berechnen“')
  assert.equal(amaAktualisierenText(null), '„Neu berechnen“')
  assert.equal(amaAktualisierenText('bestaetigt'), '„Korrekturmeldung anlegen“ (neue Version)')
})

test('Erntemeldung: Hinweis auf Korrekturversion und Handlungstext je Status', () => {
  const m = lies('src/lib/behoerden/erntemeldung.ts')
  assert.ok(m.includes('Korrekturmeldung: Version ${version} ersetzt die eingereichte Version ${version - 1}.'))
  assert.equal((m.match(/auf der Lese-Seite \$\{aktualisieren\}/g) ?? []).length, 2)
})
