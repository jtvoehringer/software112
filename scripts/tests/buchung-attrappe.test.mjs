// Selbsttest der Supabase-Attrappe scripts/tests/buchung-attrappe.mjs (28.09.2026). Die
// Charakterisierungstests der Buchungslogik verlassen sich darauf, dass sie select-Liste,
// Einbettungen (!inner) und Sortierung wie PostgREST auswertet – sonst blieben Regressionen im
// Produktivcode grün (Zugriff auf eine nicht selektierte Spalte, entferntes !inner, umbenannter
// Alias, falsche NULL-Reihenfolge).
//
// Aufruf: npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { datenbank } from './buchung-attrappe.mjs'

describe('Supabase-Attrappe (buchung-attrappe.mjs)', () => {
  test('select-Liste: nur die genannten Spalten, Alias, fehlende Spalte = null, „*“ bzw. ohne Liste = ganze Zeile', async () => {
    const db = datenbank({ t: [{ id: 1, a: 'x', b: 2 }] })
    assert.deepEqual((await db.from('t').select('id')).data, [{ id: 1 }])
    assert.deepEqual((await db.from('t').select('id, wert:b, fehlt')).data, [{ id: 1, wert: 2, fehlt: null }])
    assert.deepEqual((await db.from('t').select('*')).data, [{ id: 1, a: 'x', b: 2 }])
    assert.deepEqual((await db.from('t').select()).data, [{ id: 1, a: 'x', b: 2 }])
    assert.deepEqual((await db.from('t').select('id').maybeSingle()).data, { id: 1 })
  })

  test('single(): genau eine Zeile, sonst PGRST116 – auch nach insert(...).select(...)', async () => {
    const db = datenbank({ t: [{ id: 1 }, { id: 2 }] })
    assert.deepEqual((await db.from('t').select('id').eq('id', 2).single()).data, { id: 2 })
    assert.equal((await db.from('t').select('id').eq('id', 9).single()).error.code, 'PGRST116')
    assert.equal((await db.from('t').select('id').single()).error.code, 'PGRST116')
    assert.deepEqual((await db.from('t').insert({ id: 3, nr: 'A' }).select('nr').single()).data, { nr: 'A' })
  })

  test('update/delete/insert mit .select(…): Rückgabe auf die Liste beschränkt, ohne .select() keine', async () => {
    const db = datenbank({ t: [{ id: 1, a: 'x', b: 2 }, { id: 2, a: 'y', b: 3 }] })
    assert.deepEqual((await db.from('t').update({ a: 'z' }).eq('id', 1).select('id')).data, [{ id: 1 }])
    assert.equal(db.tabellen.t[0].a, 'z')
    assert.equal((await db.from('t').update({ a: 'q' }).eq('id', 1)).data, null)
    assert.deepEqual((await db.from('t').delete().eq('id', 2).select('id, b')).data, [{ id: 2, b: 3 }])
    assert.deepEqual((await db.from('t').insert({ a: 'n', b: 9 }).select('b')).data, [{ b: 9 }])
  })

  test('Einbettungen: verschachtelt projiziert, unter dem Alias bzw. Tabellennamen der Testzeile', async () => {
    const db = datenbank({
      tx: [
        { id: 1, kategorie_id: 'k1', kategorie: { name: 'Wein', konto_nr: 4000, extra: 'weg' }, pos: [{ m: 1, n: 'a' }] },
        { id: 2, kategorie_id: null },
      ],
    })
    assert.deepEqual((await db.from('tx').select('id, kategorie:ea_kategorien!kategorie_id(name), pos(m)')).data, [
      { id: 1, kategorie: { name: 'Wein' }, pos: [{ m: 1 }] },
      { id: 2, kategorie: null, pos: null },
    ])
  })

  test('Filter auf eingebettete Felder: mit !inner fallen Elternzeilen weg, ohne !inner nur die Einbettung', async () => {
    const tabellen = () => ({
      k: [
        { id: 1, e: { aktiv: true }, p: [{ m: 1 }, { m: 2 }] },
        { id: 2, e: { aktiv: false }, p: [{ m: 1 }] },
        { id: 3, e: null, p: [] },
      ],
    })
    const db = datenbank(tabellen())
    assert.deepEqual((await db.from('k').select('id, e!inner(aktiv)').eq('e.aktiv', true)).data, [{ id: 1, e: { aktiv: true } }])
    assert.deepEqual((await db.from('k').select('id, e!inner(aktiv)')).data.map(r => r.id), [1, 2], 'ohne verknüpfte Zeile fällt die Elternzeile weg')
    assert.deepEqual((await db.from('k').select('id, e(aktiv)').eq('e.aktiv', true)).data,
      [{ id: 1, e: { aktiv: true } }, { id: 2, e: null }, { id: 3, e: null }])
    assert.deepEqual((await db.from('k').select('id, p(m)').eq('p.m', 2)).data,
      [{ id: 1, p: [{ m: 2 }] }, { id: 2, p: [] }, { id: 3, p: [] }])
    assert.deepEqual((await db.from('k').select('id, p!inner(m)').eq('p.m', 2)).data, [{ id: 1, p: [{ m: 2 }] }])
    assert.deepEqual(db.tabellen.k, tabellen().k, 'Testdaten bleiben unverändert')
  })

  test('Fehler statt stiller Annahmen: Filter ohne Einbettung in der Liste, unbekannte select- und order-Formen', async () => {
    const db = datenbank({ k: [{ id: 1, e: { aktiv: true }, j: { x: 1 } }] })
    await assert.rejects(async () => db.from('k').select('id').eq('e.aktiv', true), /keine Einbettung „e“/)
    await assert.rejects(async () => db.from('k').select('j->x'), /nicht nachgebildet/)
    assert.throws(() => db.from('k').select('id').order('id', { referencedTable: 'e' }), /nicht nachgebildet/)
  })

  test('order: Zahlen numerisch (auch als Text), NULL aufsteigend zuletzt, absteigend zuerst, nullsFirst übersteuert', async () => {
    const db = datenbank({ n: [{ id: 'a', w: '10' }, { id: 'b', w: '9' }, { id: 'c', w: null }] })
    const ids = async (...ordnungen) => {
      const q = db.from('n').select('id')
      for (const o of ordnungen) q.order(...o)
      return (await q).data.map(r => r.id)
    }
    assert.deepEqual(await ids(['w']), ['b', 'a', 'c'])
    assert.deepEqual(await ids(['w', { ascending: false }]), ['c', 'a', 'b'])
    assert.deepEqual(await ids(['w', { ascending: false, nullsFirst: false }]), ['a', 'b', 'c'])
    assert.deepEqual(await ids(['w', { nullsFirst: true }]), ['c', 'b', 'a'])
  })
})
