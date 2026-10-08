// KAN-105 Teil A (08.10.2026) – Folgesysteme auf die Rechnung: Zahlungen hängen an der Rechnung, bezahlt je Rechnung,
// BMD-Ausgangsrechnungen, Rechnungsausgangsjournal und offene Posten lesen rechnungen (mit den Positionen aller Lieferscheine).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 69; Rechnungsjournal mit Sammelrechnung: buchhaltung.test.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { alsBeleg, lieferscheineSelect, positionBrutto, positionenDerRechnung } from '../../src/lib/verkauf/rechnungen.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan105a_zahlung_rechnung.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan105a_zahlung_rechnung.sql')
}

describe('KAN-105: Baustein lib/verkauf/rechnungen', () => {
  const r = {
    id: 're1', rechnungsnummer: 'RE-1',
    lieferscheine: [
      { id: 'ls2', datum: '2026-10-05', lieferscheinnummer: 'LS-2026-0002', verkauf_positionen: [{ menge: 2, preis_brutto: 10 }] },
      { id: 'ls1', datum: '2026-10-01', lieferscheinnummer: 'LS-2026-0001', verkauf_positionen: [{ menge: 1, preis_brutto: 9.9, rabatt_pct: 10 }] },
    ],
  }
  test('Positionen aller Lieferscheine, nach Lieferdatum', () => {
    assert.deepEqual(positionenDerRechnung(r).map(p => p.preis_brutto), [9.9, 10])
    const b = alsBeleg(r)
    assert.deepEqual(b.verkaufsposten_ids, ['ls1', 'ls2'])
    assert.equal(b.verkauf_positionen.length, 2)
    assert.equal(b.rechnungsnummer, 'RE-1')
  })
  test('Bruttobetrag je Position wie der Trigger (auf Cent gerundet)', () => {
    assert.equal(positionBrutto({ menge: 1, preis_brutto: 9.9, rabatt_pct: 10 }), 8.91)
    assert.equal(positionBrutto({ menge: 3, preis_brutto: 9.9, sonderrabatt_pct: 5 }), 28.22)   // 28,215 → 28,22
    assert.equal(positionBrutto({ menge: 1, preis_brutto: null }), 0)
  })
  test('select-Teil über verkaufsposten!rechnung_id', () => {
    assert.equal(lieferscheineSelect('menge'), 'lieferscheine:verkaufsposten!rechnung_id(id, lieferscheinnummer, datum, verkauf_positionen(menge))')
  })
})

describe('KAN-105: Datenbank', () => {
  const m = migration()
  test('Zahlung → Rechnung per Trigger, Periodensperre lässt die Zuordnung zu', () => {
    assert.match(m, /CREATE TRIGGER a_zahlung_rechnung BEFORE INSERT OR UPDATE OF verkaufsposten_id, rechnung_id ON public\.zahlungen/)
    assert.match(m, /s112_ea_periodensperre\('abgeglichen,storniert_am,storniert_von,storniert_von_name,storno_grund,rechnung_id', ''\)/)
  })
  test('bezahlt je Rechnung über alle Lieferscheine', () => {
    assert.match(m, /WHERE v\.rechnung_id = v_re AND v\.tenant_id = v_tenant;/)
    assert.match(m, /FROM zahlungen WHERE rechnung_id = v_re AND tenant_id = v_tenant AND storniert_am IS NULL;/)
    assert.match(m, /UPDATE verkaufsposten\n\s+SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now\(\) ELSE NULL END\n\s+WHERE rechnung_id = v_re/)
  })
})

describe('KAN-105: Leser auf rechnungen', () => {
  test('BMD-Ausgangsrechnungen: Quelle rechnungen, Markierung an Rechnung und Lieferscheinen', () => {
    const b = quelle('src/app/api/export/bmd/route.ts')
    assert.match(b, /let q = \(supabase\.from\('rechnungen'\) as any\)/)
    assert.doesNotMatch(b, /\.from\('verkaufsposten'\) as any\)\n\s+\.select\(`id, datum, rechnungsnummer, skonto_pct/)
    assert.match(b, /admin\.from\('rechnungen'\)\.update\(\{ bmd_export_id: protId \}\)/)
    assert.match(b, /ids\.verkaufsposten\.push\(\.\.\.p\.verkaufsposten_ids\)/)
  })
  test('Rechnungsausgangsjournal: Quelle rechnungen', () => {
    assert.match(quelle('src/lib/behoerden/rechnungsausgang.ts'), /alle<R>\(\(supabase\.from\('rechnungen'\) as any\)/)
  })
  test('Offene Posten: Rechnungen, Zahlungen je Rechnung', () => {
    const o = quelle('src/app/(dashboard)/weinhandel/offene-posten/page.tsx')
    assert.match(o, /supabase\.from\('rechnungen'\) as any\)/)
    assert.match(o, /\.select\('rechnung_id, betrag'\)\n\s+\.in\('rechnung_id', b\)/)
  })
})
