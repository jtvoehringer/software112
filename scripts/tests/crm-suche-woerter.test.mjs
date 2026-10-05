// Regressionstest (05.10.2026): Kontakt-/Firmenliste findet „Dörfler Franz“.
// Befund Gebeshuber: Suche „Dörfler Franz“ → „Keine Treffer“, obwohl der Kontakt (Nachname Dörfler, Vorname Franz)
// existiert. Die Liste suchte den ganzen Text in jedem Feld einzeln; kein Feld enthält beide Wörter. Jetzt muss jedes
// Wort in irgendeinem Feld vorkommen (ein or()-Filter je Wort, PostgREST verknüpft mehrere or-Parameter mit UND).
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as liste from '../../src/lib/crm/liste.ts'

/** Attrappe: merkt sich die or()-Filter, liefert nichts */
function client() {
  const ors = []
  const q = {
    select: () => q, eq: () => q, is: () => q, ilike: () => q, order: () => q,
    or: f => { ors.push(f); return q },
    range: () => Promise.resolve({ data: [], count: 0, error: null }),
  }
  return { ors, from: () => q }
}
const filter = (extra = {}) => liste.filterAusParams({ q: '', ...extra }, 'kontakt')

/** Wertet die or()-Filter wie PostgREST gegen eine Zeile aus (ilike %wort%, Groß/klein egal) */
function passt(ors, zeile) {
  return ors.every(f => f.split(',').some(teil => {
    const [spalte, , muster] = teil.split('.')
    const wort = muster.slice(1, -1).toLowerCase()
    return String(zeile[spalte] ?? '').toLowerCase().includes(wort)
  }))
}

test('„Dörfler Franz“: ein Filter je Wort, der Kontakt (Nachname Dörfler, Vorname Franz) passt', async () => {
  const c = client()
  await liste.ladeKontakteSeite(c, 't-1', { ...filter(), q: 'Dörfler Franz' })
  assert.equal(c.ors.length, 2)
  const franz = { nachname: 'Dörfler', vorname: 'Franz', email: 'franz.doerfler@siemens.com' }
  assert.ok(passt(c.ors, franz))
  assert.ok(!passt(c.ors, { nachname: 'Dörfler', vorname: 'Maria' }))
  // Reihenfolge egal
  const c2 = client()
  await liste.ladeKontakteSeite(c2, 't-1', { ...filter(), q: 'Franz Dörfler' })
  assert.ok(passt(c2.ors, franz))
})

test('Komma, Klammern und Anführungszeichen brechen die or()-Syntax nicht', () => {
  assert.deepEqual(liste.suchWoerter('Dörfler, Franz'), ['Dörfler', 'Franz'])
  assert.deepEqual(liste.suchWoerter('  "Weingut (Wien)"  '), ['Weingut', 'Wien'])
  assert.deepEqual(liste.suchWoerter('50%_rabatt\\x'), ['50', 'rabatt', 'x'])
  assert.deepEqual(liste.suchWoerter(''), [])
  for (const f of liste.suchFilter(liste.KONTAKT_SUCHSPALTEN, 'a,b (c) "d"')) assert.doesNotMatch(f.replace(/\.ilike\.%[^,%]*%/g, ''), /[()"]/)
  assert.equal(liste.suchWoerter('a b c d e f g').length, liste.SUCHWOERTER_MAX)
})

test('Firmenliste: Wörter ebenfalls einzeln („Siemens Österreich“ passt auf „Siemens AG Österreich“)', async () => {
  const c = client()
  await liste.ladeFirmenSeite(c, 't-1', { ...liste.filterAusParams({ q: '' }, 'firma'), q: 'Siemens Österreich' })
  assert.equal(c.ors.length, 2)
  assert.ok(passt(c.ors, { name: 'Siemens AG Österreich' }))
})

test('ohne Suchtext kein or()-Filter', async () => {
  const c = client()
  await liste.ladeKontakteSeite(c, 't-1', filter())
  assert.equal(c.ors.length, 0)
})
