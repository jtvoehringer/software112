// KAN-104 (08.10.2026) – Sammelrechnung aus mehreren Lieferscheinen: Liste je Kunde (ein Empfänger, ganze Lieferscheine),
// Freigabeliste vor dem Erstellen, Rechnungsdruck je Lieferschein mit Nummer und Lieferdatum, Verweise auf die Rechnungsseite.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 70 (s112_rechnung_erstellen mit zwei Lieferscheinen eines Kunden, verschiedene Kunden abgelehnt), 69 (bezahlt je Rechnung).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lieferscheinBetrag, offeneLieferscheineJeKunde } from '../../src/lib/verkauf/sammelrechnung.ts'
import { rechnungSummen } from '../../src/lib/verkauf/rechnungDruck.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-104: Lieferscheine je Kunde', () => {
  const zeilen = [
    { id: 'l2', datum: '2026-10-05', lieferscheinnummer: 'LS-2026-0002', kontakt_id: 'k1', firma_id: null, verkauf_positionen: [{ menge: 2, preis_brutto: 10 }] },
    { id: 'l1', datum: '2026-10-01', lieferscheinnummer: 'LS-2026-0001', kontakt_id: 'k1', firma_id: null, verkauf_positionen: [{ menge: 1, preis_brutto: 9.9, rabatt_pct: 10 }] },
    { id: 'l3', datum: '2026-10-02', lieferscheinnummer: 'LS-2026-0003', kontakt_id: null, firma_id: 'f1', verkauf_positionen: [{ menge: 1, preis_brutto: null }] },
  ]
  const namen = { k1: 'Anna Huber', f1: 'Gasthaus Adler' }
  const kunden = offeneLieferscheineJeKunde(zeilen, l => namen[l.kontakt_id ?? l.firma_id])
  test('ein Empfänger = gleiche kontakt_id und firma_id; Kunden nach Name, Lieferscheine nach Datum', () => {
    assert.deepEqual(kunden.map(k => k.name), ['Anna Huber', 'Gasthaus Adler'])
    assert.deepEqual(kunden[0].lieferscheine.map(l => l.nummer), ['LS-2026-0001', 'LS-2026-0002'])
    assert.equal(kunden[0].summe, 28.91)   // 8,91 + 20
  })
  test('Position ohne Preis wird gekennzeichnet und zählt nicht', () => {
    assert.deepEqual(lieferscheinBetrag([{ menge: 1, preis_brutto: null }, { menge: 2, preis_brutto: 5 }]), { betrag: 10, ohnePreis: true })
    assert.equal(kunden[1].lieferscheine[0].ohnePreis, true)
  })
})

describe('KAN-104: Rechnungssummen wie die Rechnung der Verkaufsseite', () => {
  test('Netto/USt je Satz, fehlender Satz = 13 %, ohne Preis zählt nicht', () => {
    const s = rechnungSummen([{ menge: 10, preis_brutto: 12, ust_satz: 20 }, { menge: 2, preis_brutto: 11.3 }, { menge: 1, preis_brutto: null, ust_satz: 20 }])
    assert.equal(Math.round(s.brutto * 100) / 100, 142.6)
    assert.deepEqual(s.ust.map(u => [u.satz, Math.round(u.netto * 100) / 100]), [[20, 100], [13, 20]])
    assert.equal(Math.round(s.netto * 100) / 100, 120)
  })
})

describe('KAN-104: Verdrahtung', () => {
  test('Seite Sammelrechnung: nur nicht berechnete, nicht stornierte Lieferscheine, seitenweise; Freigabeliste vor dem Erstellen', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/sammelrechnung/page.tsx')
    assert.match(p, /\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)\.eq\('storniert', false\)\.is\('rechnung_id', null\)\n\s+\.order\('datum'\)\.order\('id'\)\)/)
    const c = quelle('src/app/(dashboard)/weinhandel/sammelrechnung/SammelrechnungClient.tsx')
    assert.match(c, /Abzurechnende Lieferscheine – bitte prüfen/)
    assert.match(c, /router\.push\(`\/weinhandel\/rechnungen\/\$\{rechnungId\}`\)/)
    assert.match(quelle('src/lib/navigation/index.ts'), /href: '\/weinhandel\/sammelrechnung'/)
  })
  test('Rechnungsseite: je Lieferschein Nummer und Lieferdatum', () => {
    const r = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(r, /Lieferschein \{g\.id \?/)
    assert.match(r, /vom \{d\(g\.datum\)\}/)
    assert.match(r, /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)/)
  })
  test('Lieferschein einer Sammelrechnung: kein eigener Rechnungsdruck/Versand, Verweis auf die Rechnung; offene Posten verlinken die Rechnung', () => {
    const v = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(v, /const isRechnung       = modusRechnung && berechnet && !sammelrechnung/)
    assert.match(v, /\{!posten\.storniert && berechnet && !sammelrechnung && \(/)
    assert.match(v, /'Teil der Sammelrechnung '/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/offene-posten/page.tsx'), /href:            p\.verkaufspostenIds\.length > 1 \? `\/weinhandel\/rechnungen\/\$\{p\.id\}` : undefined,/)
  })
})
