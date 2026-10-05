// KAN-166 Etappe 1 (30.09.2026): Mitarbeiter (winzer mit Schreibmodul Rieden) bearbeiten und löschen Maßnahmen und
// PSM-/Dünger-Lagerbewegungen. Seit KAN-88 (05.10.2026): stornieren statt löschen (auch Mitarbeiter), endgültig löschen
// nur stornierte Zeilen über s112_storniert_loeschen (Grund ins Änderungsprotokoll); s112_buchung_loeschen entfällt.
// Weitere Prüfungen in kan88-psm-storno.test.mjs, DB-Test 40.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const q = p => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

test('Maßnahmen-Liste: Stift und Stornieren für alle mit Schreibrecht Rieden (KAN-88: statt Löschen)', () => {
  const page = q('app/(dashboard)/behandlungen/page.tsx')
  assert.match(page, /const writeOk = canWrite\(role, 'rieden'\)/)
  assert.match(page, /<BehandlungenClient behandlungen=\{behandlungen\} schreibOk=\{writeOk\} \/>/)
  assert.doesNotMatch(page, /canAdmin/)
  const c = q('app/(dashboard)/behandlungen/BehandlungenClient.tsx')
  assert.doesNotMatch(c, /adminOk|confirm\(/)
  assert.match(c, /<StornoButton action=\{grund => stornoBehandlung\(b\.id, grund\)\}/)
})

test('Lager: Stornieren für writeOk (KAN-88: statt Löschen)', () => {
  for (const [datei, fn] of [['LagerClient.tsx', 'stornoLagerBewegung'], ['DuengerLagerClient.tsx', 'stornoDuengerBewegung']]) {
    const c = q(`app/(dashboard)/behandlungen/lager/${datei}`)
    assert.match(c, new RegExp(`\\{writeOk && \\(b\\.storniert_am \\?[\\s\\S]{0,600}<StornoButton action=\\{grund => ${fn}\\(b\\.id, grund\\)\\}`), datei)
    assert.doesNotMatch(c, /handleDelete/, datei)
  }
})

test('Server Actions löschen endgültig nur über s112_storniert_loeschen mit Grund – kein direktes .delete() mehr', () => {
  const a = q('app/(dashboard)/behandlungen/actions.ts')
  const del = a.slice(a.indexOf('export async function loescheBehandlung'))
  assert.match(del, /\(supabase\.rpc as any\)\('s112_storniert_loeschen', \{\s*p_tenant_id: tenantId, p_tabelle: 'behandlungen', p_id: id, p_grund: grund\.trim\(\),/)
  assert.doesNotMatch(del.slice(0, 900), /\.delete\(\)/)
  const l = q('app/(dashboard)/behandlungen/lager/actions.ts')
  assert.match(l, /'s112_storniert_loeschen'/)
  assert.doesNotMatch(l.slice(l.indexOf('async function lagerStornieren'), l.indexOf('// ── PSM-Stammdaten')), /\.delete\(\)/)
})

test('StornoButton: Modus „loeschen“ mit eigenem Text und Mistkübel', () => {
  const b = q('components/StornoButton.tsx')
  assert.match(b, /modus\?: 'storno' \| 'loeschen'/)
  assert.match(b, /loeschen \? 'Grund des Löschens' : 'Grund des Stornos'/)
  assert.match(b, /loeschen \? <Trash2/)
})
