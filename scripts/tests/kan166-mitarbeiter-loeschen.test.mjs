// KAN-166 Etappe 1 (30.09.2026): Mitarbeiter (winzer mit Schreibmodul Rieden) bearbeiten und löschen Maßnahmen und
// PSM-/Dünger-Lagerbewegungen; Löschen nur mit Grund über die RPC s112_buchung_loeschen (Rolle, Modul, Betrieb, Abo,
// Grund ins Änderungsprotokoll). Die DB-Seite prüfen der zurückgerollte Staging-Test und die DB-Testsuite.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const q = p => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

test('Maßnahmen-Liste: Stift und Mistkübel für alle mit Schreibrecht Rieden, Löschen mit Grund', () => {
  const page = q('app/(dashboard)/behandlungen/page.tsx')
  assert.match(page, /const writeOk = canWrite\(role, 'rieden'\)/)
  assert.match(page, /<BehandlungenClient behandlungen=\{behandlungen\} schreibOk=\{writeOk\} \/>/)
  assert.doesNotMatch(page, /canAdmin/)
  const c = q('app/(dashboard)/behandlungen/BehandlungenClient.tsx')
  assert.doesNotMatch(c, /adminOk|confirm\(/)
  assert.match(c, /<StornoButton modus="loeschen" action=\{grund => deleteBehandlung\(b\.id, grund\)\}/)
})

test('Lager: Mistkübel für writeOk, Löschen mit Grund', () => {
  for (const [datei, fn] of [['LagerClient.tsx', 'deleteLagerBewegung'], ['DuengerLagerClient.tsx', 'deleteDuengerBewegung']]) {
    const c = q(`app/(dashboard)/behandlungen/lager/${datei}`)
    assert.match(c, new RegExp(`\\{writeOk && \\(\\s*// KAN-166[^\\n]*\\n\\s*<StornoButton modus="loeschen" action=\\{grund => ${fn}\\(b\\.id, grund\\)\\}`), datei)
    assert.doesNotMatch(c, /handleDelete/, datei)
  }
})

test('Server Actions löschen nur über die RPC mit Grund – kein direktes .delete() mehr', () => {
  const a = q('app/(dashboard)/behandlungen/actions.ts')
  const del = a.slice(a.indexOf('export async function deleteBehandlung'))
  assert.match(del, /\(supabase\.rpc as any\)\('s112_buchung_loeschen', \{\s*p_tenant_id: tenantId, p_tabelle: 'behandlungen', p_id: id, p_grund: grund\.trim\(\),/)
  assert.doesNotMatch(del.slice(0, 900), /\.delete\(\)/)
  const l = q('app/(dashboard)/behandlungen/lager/actions.ts')
  assert.match(l, /'s112_buchung_loeschen'/)
  assert.doesNotMatch(l.slice(l.indexOf('async function lagerLoeschen'), l.indexOf('// ── PSM-Stammdaten')), /\.delete\(\)/)
})

test('StornoButton: Modus „loeschen“ mit eigenem Text und Mistkübel', () => {
  const b = q('components/StornoButton.tsx')
  assert.match(b, /modus\?: 'storno' \| 'loeschen'/)
  assert.match(b, /loeschen \? 'Grund des Löschens' : 'Grund des Stornos'/)
  assert.match(b, /loeschen \? <Trash2/)
})
