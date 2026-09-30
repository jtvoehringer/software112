// KAN-132 Etappe 7: Löschschutz, keine Maßnahme ohne Grundstück, KI-Regeln – und der Bug vom 30.09.2026
// (Maßnahme erfassen bei Gebeshuber: Ried doppelt angezeigt, GST bei gewählter Ried nicht angehakt).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('Löschschutz in allen drei Lösch-Actions vor dem DELETE', () => {
  const a = quelle('src/app/(dashboard)/weingarten/actions.ts')
  for (const [fn, aufruf] of [
    ['deleteWeingarten', 'loeschSperre(supabase, tenantId, { weingartenIds: [id] })'],
    ['deleteRied', 'loeschSperre(supabase, tenantId, { weingartenIds })'],
    ['deleteGrundstueck', 'loeschSperre(supabase, tenantId, { grundstueckIds: [id] })'],
  ]) {
    const start = a.indexOf(`export async function ${fn}(`)
    const ende = a.indexOf('export async function', start + 10)
    const rumpf = a.slice(start, ende)
    assert.ok(rumpf.includes(aufruf), fn)
    assert.ok(rumpf.indexOf(aufruf) < rumpf.indexOf('.delete()'), `${fn}: Prüfung vor dem Löschen`)
  }
  assert.match(a, /from\('behandlung_grundstuecke'\)[\s\S]{0,120}count: 'exact'/)
  assert.match(a, /from\('kosteneintrag_weingaerten'\)[\s\S]{0,120}count: 'exact'/)
})

test('keine Maßnahme ohne Grundstück: Action lehnt ab, Formular bietet Rieden ohne WI-GST nicht an', () => {
  const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
  assert.ok(a.indexOf('if (grundstueckeById.size === 0)') > 0)
  assert.ok(a.indexOf('if (grundstueckeById.size === 0)') < a.indexOf('// 3. Behandlung anlegen'), 'Prüfung vor dem Anlegen')
  const p = quelle('src/app/(dashboard)/behandlungen/neu/page.tsx')
  assert.match(p, /const spritzbar = gsts\.some\(g => g\.nutzart === 'WI'\)/)
})

test('Bug 30.09.2026: ganze Ried gewählt → ihre GST angehakt, Einzel-Klick nimmt nur dieses GST heraus; eine Lage mit einer Ried = eine Zeile', () => {
  const f = quelle('src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
  assert.match(f, /const isGstSel = wgSel \|\| selectedGSTs\.has\(g\.id\)/)
  assert.match(f, /if \(riedGewaehlt\) for \(const g of gstByWeingarten\[wgId\] \?\? \[\]\) n\.set\(g\.id, wgId\)/)
  assert.match(f, /const einzelRied = istEinzelRied\(gruppe\)/)
  assert.match(f, /\{!einzelRied && <div/)
})

test('KI-Kontext: Verteilregel und keine Doppelzählung der Kosten', () => {
  const k = quelle('src/app/api/ki-abfrage/route.ts')
  assert.match(k, /VERTEILUNG AUF GRUNDSTÜCKE \(KAN-132\)/)
  assert.match(k, /NIE den vollen kosteneintraege\.betrag/)
})
