// KAN-129 Etappe 5 (Soll 9): Assistent mit Lese-Nr., Kontext mit Lesen, N6, Palette, Suche, Texte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lesenZumDatum } from '../../src/lib/wein/lesen.ts'

test('Lese zum Datum: eindeutig nur, wenn genau eine Lese den Tag umfasst', () => {
  const lesen = [
    { id: 'l1', beginn: '2026-09-01', ende: '2026-10-15' },
    { id: 'l2', beginn: '2027-01-05', ende: null },
  ]
  assert.deepEqual(lesenZumDatum(lesen, '2026-09-20').map(l => l.id), ['l1'])
  assert.deepEqual(lesenZumDatum(lesen, '2027-01-12').map(l => l.id), ['l2'])
  assert.deepEqual(lesenZumDatum(lesen, '2026-11-20'), [])
  assert.deepEqual(lesenZumDatum([{ id: 'a', beginn: null, ende: null }, { id: 'b', beginn: null, ende: null }], '2026-09-20').length, 2)
})

const lies = p => fs.readFileSync(p, 'utf8')

test('Assistent: lese_nr, Rückfrage ohne Speichern, lese_id an die Action, N6', () => {
  const t = lies('src/lib/assistent/tools/ernte.ts')
  assert.ok(t.includes("lese_nr: { type: 'number'"), 'Schema')
  assert.ok(t.includes('und das Lesedatum passt nicht eindeutig zu einer') && t.includes('nichts gespeichert'), 'Rückfrage')
  assert.ok(t.indexOf("if (lese) fd.set('lese_id', lese.id)") < t.indexOf('await createMultipleErnteParzellen(jahrgangId, fd)'))
  const r = lies('src/app/api/assistent/chat/route.ts')
  assert.ok(r.includes("ziel_tabelle: ergebnis.lese_id ? 'lesen' : 'weinjahrgaenge'"), 'N6')
  assert.ok(!r.includes("ziel_tabelle: 'ernte_parzellen'"), 'N6: keine Jahrgangs-ID mehr als ernte_parzellen-Ziel')
  const k = lies('src/lib/assistent/kontext.ts')
  assert.ok(k.includes("lesen(lfd_nr, art, bezeichnung, beginn, ende)") && k.includes(': Lesen '), 'Kontext')
})

test('Palette, Navigation, Suche und Handbuch kennen die Lesen', () => {
  assert.ok(lies('src/components/CommandPalette.tsx').includes("label: 'Neue Lese anlegen'"))
  assert.match(lies('src/lib/navigation/index.ts'), /label: 'Lese', .*keywords: '[^']*neue lese eiswein/)
  const s = lies('src/app/api/global-search/route.ts')
  assert.ok(s.includes('href:       `/erntemeldung/${l.jahrgang_id}?lese=${l.lfd_nr}`'), 'Suche → Reiter der Lese')
  assert.ok(lies('src/app/(dashboard)/hilfe/handbuch/page.tsx').includes("titel: 'Lesen je Jahrgang (Hauptlese, Eiswein …)'"))
})
