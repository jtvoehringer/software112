// KAN-115 (07.10.2026) – Traubensaft, Essig, Destillat als nicht bestandsrelevante Sonstige Produkte mit Lagerstand;
// Vorgang „Verarbeiten“ bucht den Zugang beim Produkt, der Verkauf mindert, Storno bucht zurück, Rückverfolgung zeigt
// Charge → Verarbeitung → Produkt → Abnehmer.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 61 (RPCs, append-only, Vorzeichen, Lagerprüfung, Mandanten-Löschung samt Stoffkonto).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan115_sonstige_produkte_lager.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan115_sonstige_produkte_lager.sql')
}
const p = () => laden('lib/warenwirtschaft/sonstigeProdukte.ts')

describe('KAN-115: Sonstige Produkte – Logik', nurMitHooks, () => {
  test('Stück-Vorschlag: Liter ÷ Liter je Stück, abgerundet; ohne Angabe keiner', async () => {
    const { stueckVorschlag } = await p()
    assert.equal(stueckVorschlag(300, 1), 300)
    assert.equal(stueckVorschlag(100, '0.75'), 133)
    assert.equal(stueckVorschlag(100, null), null)
    assert.equal(stueckVorschlag(null, 1), null)
  })
  test('Kontoauszug: chronologisch, laufender Saldo, Storno gekennzeichnet; Lagerstand = Summe', async () => {
    const { produktKonto, lagerstand } = await p()
    const b = [
      { id: 'v', datum: '2026-10-02', art: 'verkauf', menge: -50 },
      { id: 'z', datum: '2026-10-01', art: 'verarbeitung', menge: 300 },
      { id: 's', datum: '2026-10-03', art: 'storno', menge: 50, storno_von_id: 'v' },
    ]
    const k = produktKonto(b)
    assert.deepEqual(k.zeilen.map(z => [z.bewegung.id, z.saldo, z.storniert]), [['z', 300, false], ['v', 250, true], ['s', 300, false]])
    assert.equal(lagerstand(b), 300)
  })
  test('Buchung prüfen: Art, Datum, Menge, Inventur ≠ Lagerstand', async () => {
    const { produktBuchungFehler } = await p()
    const g = { datum: '2026-10-07', heute: '2026-10-07', bestand: 12 }
    assert.equal(produktBuchungFehler({ ...g, art: 'zugang', menge: 5 }), null)
    assert.match(produktBuchungFehler({ ...g, art: 'verkauf', menge: 5 }), /Art/)
    assert.match(produktBuchungFehler({ ...g, art: 'zugang', menge: 0 }), /größer als 0/)
    assert.match(produktBuchungFehler({ ...g, art: 'zugang', menge: 5, datum: '2026-10-08' }), /Zukunft/)
    assert.equal(produktBuchungFehler({ ...g, art: 'inventur', menge: 0 }), null)
    assert.match(produktBuchungFehler({ ...g, art: 'inventur', menge: 12 }), /keine Differenz/)
  })
  test('Verkauf: über alle Positionen je Produkt höchstens der Lagerstand, Menge > 0', async () => {
    const { sonstigeLagerFehler } = await p()
    const art = [{ id: 'a', name: 'Traubensaft 1 l', einheit: 'Stk', bestand_fuehren: true }, { id: 'o', name: 'Gutschein', einheit: 'Stk', bestand_fuehren: false }]
    const bew = [{ artikel_id: 'a', menge: 300 }, { artikel_id: 'a', menge: -100 }]
    const pos = (m1, m2) => [{ typ: 'sonstiges', sonstige_artikel_id: 'a', menge: m1 }, { typ: 'sonstiges', sonstige_artikel_id: 'a', menge: m2 }, { typ: 'sonstiges', sonstige_artikel_id: 'o', menge: -5 }]
    assert.equal(sonstigeLagerFehler(pos(150, 50), art, bew), null)
    assert.match(sonstigeLagerFehler(pos(150, 51), art, bew), /Nicht genug „Traubensaft 1 l“ auf Lager: verkauft 201 Stk, Lagerstand 200 Stk/)
    assert.match(sonstigeLagerFehler(pos(-1, 0), art, bew), /größer als 0/)
  })
  test('Rückverfolgung: Verarbeitung je Charge, Verkäufe des Produkts erst ab dem Verarbeitungstag, Endverbraucher summiert', async () => {
    const { produktZeilen } = await laden('lib/behoerden/rueckruf.ts')
    const chargen = new Map([['w1', { name: 'GV Klassik', chargennummer: 'CH-1' }]])
    const vz = [
      { id: 'v1', weinausbauId: 'w1', datum: '2026-10-01', liter: 300, zweck: 'traubensaft', artikel: { id: 'a', name: 'Traubensaft 1 l', einheit: 'Stk', menge: 300 } },
      { id: 'v2', weinausbauId: 'w1', datum: '2026-10-02', liter: 20, zweck: 'essig', artikel: null },
    ]
    const vk = [
      { artikelId: 'a', menge: 10, einheit: 'Stk', posten: { datum: '2026-09-30', rechnungsnummer: 'R-0', firma: { name: 'Vorher GmbH' } } },
      { artikelId: 'a', menge: 24, einheit: 'Stk', posten: { datum: '2026-10-03', rechnungsnummer: 'R-1', firma: { name: 'Heuriger Huber', ort: 'Krems', betrieb_nr: '123' } } },
      { artikelId: 'a', menge: 6, einheit: 'Stk', posten: { datum: '2026-10-04', rechnungsnummer: 'R-2' } },
    ]
    const z = produktZeilen(vz, chargen, vk)
    assert.deepEqual(z.map(x => [x.art, x.produkt, x.abnehmer, x.menge, x.einheit]), [
      ['Verarbeitung', 'Traubensaft 1 l (aus GV Klassik)', 'Eigener Betrieb', 300, 'Stk'],
      ['Verarbeitung', 'Essig (aus GV Klassik)', 'Eigener Betrieb', 20, 'L'],
      ['Verkauf Produkt', 'Traubensaft 1 l', 'Heuriger Huber', 24, 'Stk'],
      ['Endverbraucher (summiert)', 'Traubensaft 1 l', 'Endverbraucher', 6, 'Stk'],
    ])
    assert.equal(z[0].los, 'CH-1')
  })
})

describe('KAN-115: Datenbank und Verdrahtung', () => {
  test('Migration: Bewegungen nur per RPC, Vorzeichen, Verkauf/Verarbeitung je einmal, Verarbeiten mit Produkt, Nachbesserung KAN-107', () => {
    const m = migration()
    assert.match(m, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.sonstige_artikel_bewegungen FROM authenticated/)
    assert.match(m, /CONSTRAINT sonstige_artikel_bewegungen_vorzeichen CHECK/)
    assert.match(m, /CREATE UNIQUE INDEX sonstige_artikel_bewegungen_verkauf_einmal/)
    assert.match(m, /CREATE UNIQUE INDEX sonstige_artikel_bewegungen_verarbeitung_einmal/)
    assert.match(m, /p_zweck text, p_notizen text DEFAULT NULL, p_artikel_id uuid DEFAULT NULL, p_stueck numeric DEFAULT NULL\)/)
    assert.match(m, /schon verkauft/)
    assert.match(m, /ADD COLUMN sonstige_artikel_id uuid REFERENCES public\.sonstige_artikel\(id\)/)
    for (const sp of ['keller_behandlung_id', 'weinausbau_id', 'behaelter_id']) {
      assert.match(m, new RegExp(`ADD CONSTRAINT kellermittel_buchungen_${sp}_fkey FOREIGN KEY \\(${sp}\\) REFERENCES public\\.\\w+\\(id\\) ON DELETE SET NULL`), sp)
    }
  })
  test('Verkauf: Produkt-Id aus der Auswahl, Vorprüfung, RPC nach den Positionen, Storno nur bei Produkt-Positionen', () => {
    const f = quelle(`${D}/weinhandel/verkauf/neu/page.tsx`)
    assert.match(f, /onNameChange=\{text => updatePos\(idx, \{ name: text, sonstige_artikel_id: '' \}\)\}/)
    assert.match(f, /sonstige_artikel_id: a\.id,/)
    const a = quelle(`${D}/weinhandel/verkauf/actions.ts`)
    assert.match(a, /const mitLager = await pruefeSonstigeProdukte\(supabase, tenantId, positionen\)/)
    assert.match(a, /sonstige_artikel_id:   p\.typ === 'sonstiges' \? \(p\.sonstige_artikel_id \|\| null\) : null,/)
    assert.match(a, /'s112_artikel_verkauf_buchen', \{ p_tenant_id: tenantId, p_verkaufsposten_id: postenId \}\)\n\s+if \(lagerErr\) await abbruch\(/)
    const b = quelle('src/lib/verkauf/bestand.ts')
    assert.match(b, /if \(positionen\.some\(p => p\.typ === 'sonstiges' && p\.sonstige_artikel_id\)\) \{\n[\s\S]{0,200}'s112_artikel_verkauf_stornieren'/)
  })
  test('Verarbeiten: Produkt und Stück an die RPC; Produktseite mit Lagerkonto; Löschen mit Bewegungen → deaktivieren', () => {
    const k = quelle(`${D}/kellerbuch/actions.ts`)
    assert.match(k, /\.\.\.\(artikelId \? \{ p_artikel_id: artikelId, p_stueck: stueck \} : \{\}\)/)
    assert.match(quelle(`${D}/kellerbuch/weinausbau/[id]/verarbeiten/VerarbeitenForm.tsx`), /fd\.set\('artikel_id', produktId\)/)
    assert.match(quelle(`${D}/weinhandel/sonstige-artikel/[id]/ProduktLagerClient.tsx`), /produktKonto\(bewegungen\)/)
    assert.match(quelle(`${D}/weinhandel/sonstige-artikel/actions.ts`), /'23503'\) return \{ error: 'Das Produkt hat Lagerbewegungen oder Verkäufe/)
  })
})
