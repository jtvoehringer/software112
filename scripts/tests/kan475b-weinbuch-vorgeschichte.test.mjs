// KAN-475 Nebenbefund (19.11.2026, UAT Musterhof): Schönung an der Charge „St. Laurent Reserve“, eine Minute später
// Teilumzug in ein leeres Gebinde – im Weinbuch der neuen Charge fehlte die Schönung. Das Weinbuch zeigte nur die
// eigenen Kellerbehandlungen der Charge; die Seite „Kellerbehandlungen“ suchte den Umzug nur in der einzeiligen
// Schreibweise (von_ und nach_weinausbau_id in einer Zeile) und fand Buchungen aus Quell- und Zielzeile nicht.
//
// Jetzt: ein Baustein (src/lib/kellerbuch/behandlungVorgeschichte.ts) für Weinbuch und Seite – Behandlungen der
// Ursprungscharge bis zum ZEITPUNKT des Umzugs, über mehrere Umzüge hinweg, ohne Verschnitte und Stornierte.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ladeBehandlungVorgeschichte, umzuegeAus, vorDemUmzug, vorgeschichteAus } from '../../src/lib/kellerbuch/behandlungVorgeschichte.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-475 Nebenbefund: Grenze ist der Zeitpunkt des Umzugs', () => {
  const u = { datum: '2026-11-19', zeitpunkt: '2026-11-19T12:49:30.725907+00:00' }
  test('früherer Tag zählt, späterer nicht; am selben Tag entscheidet der Erfassungszeitpunkt', () => {
    assert.equal(vorDemUmzug({ datum: '2026-11-18', created_at: '2026-11-18T23:00:00+00:00' }, u), true)
    assert.equal(vorDemUmzug({ datum: '2026-11-20', created_at: '2026-11-19T10:00:00+00:00' }, u), false)
    assert.equal(vorDemUmzug({ datum: '2026-11-19', created_at: '2026-11-19T12:48:39.752804+00:00' }, u), true)   // Fall aus dem UAT
    assert.equal(vorDemUmzug({ datum: '2026-11-19', created_at: '2026-11-19T13:30:00+00:00' }, u), false)
    // andere Schreibweise desselben Zeitpunkts (Zeitzone) – verglichen wird der Zeitpunkt, nicht der Text
    assert.equal(vorDemUmzug({ datum: '2026-11-19', created_at: '2026-11-19T13:48:39+01:00' }, u), true)
  })
  test('Altdaten ohne Zeitpunkt: die Behandlung des Umzugstages zählt mit; ohne Datum nie', () => {
    assert.equal(vorDemUmzug({ datum: '2026-11-19', created_at: null }, u), true)
    assert.equal(vorDemUmzug({ datum: '2026-11-19', created_at: '2026-11-19T20:00:00+00:00' }, { datum: '2026-11-19', zeitpunkt: null }), true)
    assert.equal(vorDemUmzug({ datum: null, created_at: null }, u), false)
  })
})

describe('KAN-475 Nebenbefund: Umzüge in beiden Schreibweisen', () => {
  test('Buchung aus Quell- und Zielzeile (umzug_batch_id) und einzeilige Altbuchung', () => {
    const ziel = [
      { id: 'z1', nach_weinausbau_id: 'B', von_weinausbau_id: null, umzug_batch_id: 'x', datum: '2026-11-19', erstellt_am: 't1' },
      { id: 'z2', nach_weinausbau_id: 'B', von_weinausbau_id: 'ALT', umzug_batch_id: null, datum: '2026-01-05T00:00:00', erstellt_am: null },
      { id: 'z3', nach_weinausbau_id: 'B', von_weinausbau_id: 'B', umzug_batch_id: null, datum: '2026-02-01', erstellt_am: null },   // Gebindewechsel derselben Charge
      { id: 'z4', nach_weinausbau_id: 'B', von_weinausbau_id: null, umzug_batch_id: null, datum: '2026-02-02', erstellt_am: null },   // ohne Quelle
    ]
    const quell = [{ id: 'q1', umzug_batch_id: 'x', von_weinausbau_id: 'A' }, { id: 'q2', umzug_batch_id: 'x', von_weinausbau_id: 'A' }, { id: 'q3', umzug_batch_id: 'y', von_weinausbau_id: 'FREMD' }]
    assert.deepEqual(umzuegeAus(ziel, quell), [
      { ziel: 'B', quelle: 'A', datum: '2026-11-19', zeitpunkt: 't1' },
      { ziel: 'B', quelle: 'ALT', datum: '2026-01-05', zeitpunkt: null },
    ])
  })
})

describe('KAN-475 Nebenbefund: übernommene Behandlungen (Kette)', () => {
  const namen = new Map([['A', 'St. Laurent Reserve'], ['B', 'St. Laurent Reserve (Teil)']])
  const umzuege = [
    { ziel: 'B', quelle: 'A', datum: '2026-11-19', zeitpunkt: '2026-11-19T12:49:30+00:00' },
    { ziel: 'C', quelle: 'B', datum: '2026-12-01', zeitpunkt: '2026-12-01T09:00:00+00:00' },
  ]
  const beh = [
    { id: 'a1', weinausbau_id: 'A', datum: '2025-10-05', created_at: '2025-10-05T00:00:00+00:00', typ_name_snapshot: 'Hefegabe' },
    { id: 'a2', weinausbau_id: 'A', datum: '2026-11-19', created_at: '2026-11-19T12:48:39+00:00', typ_name_snapshot: 'Schönung (Bentonit)' },
    { id: 'a3', weinausbau_id: 'A', datum: '2026-11-19', created_at: '2026-11-19T13:30:00+00:00', typ_name_snapshot: 'Schwefelung nach dem Umzug' },
    { id: 'a4', weinausbau_id: 'A', datum: '2026-11-25', created_at: '2026-11-25T08:00:00+00:00', typ_name_snapshot: 'Filtration' },
    { id: 'b1', weinausbau_id: 'B', datum: '2026-11-25', created_at: '2026-11-25T10:00:00+00:00', typ_name_snapshot: 'Schwefelung' },
    { id: 'b2', weinausbau_id: 'B', datum: '2026-12-05', created_at: '2026-12-05T10:00:00+00:00', typ_name_snapshot: 'Filtration' },
  ]
  const kurz = z => z.map(x => `${x.behandlung.id}<${x.chargeId}@${x.bis}`)
  test('Fall aus dem UAT: die Schönung vor dem Teilumzug ist übernommen, was danach kam, nicht', () => {
    const r = vorgeschichteAus('B', umzuege, beh, namen)
    assert.deepEqual(kurz(r), ['a1<A@2026-11-19', 'a2<A@2026-11-19'])
    assert.equal(r[1].charge, 'St. Laurent Reserve')
  })
  test('zweiter Umzug: die neue Charge erbt von B und – begrenzt durch den ersten Umzug – von A', () => {
    assert.deepEqual(kurz(vorgeschichteAus('C', umzuege, beh, namen)), ['a1<A@2026-11-19', 'a2<A@2026-11-19', 'b1<B@2026-12-01'])
  })
  test('ein Umzug in die Ursprungscharge NACH der Abspaltung zählt für die neue Charge nicht', () => {
    const mitSpaet = [...umzuege, { ziel: 'A', quelle: 'X', datum: '2026-11-22', zeitpunkt: null }]
    const r = vorgeschichteAus('B', mitSpaet, [...beh, { id: 'x1', weinausbau_id: 'X', datum: '2026-01-01', created_at: null }], namen)
    assert.deepEqual(kurz(r), ['a1<A@2026-11-19', 'a2<A@2026-11-19'])
  })
  test('Charge ohne Umzug, die Ursprungscharge selbst, Kreis (hin und zurück): keine bzw. endliche Vorgeschichte', () => {
    assert.deepEqual(vorgeschichteAus('A', umzuege, beh, namen), [])
    assert.deepEqual(vorgeschichteAus('Z', umzuege, beh, namen), [])
    const kreis = [{ ziel: 'B', quelle: 'A', datum: '2026-11-19', zeitpunkt: null }, { ziel: 'A', quelle: 'B', datum: '2026-11-10', zeitpunkt: null }]
    assert.deepEqual(kurz(vorgeschichteAus('B', kreis, beh, namen)), ['a1<A@2026-11-19', 'a2<A@2026-11-19', 'a3<A@2026-11-19'])
  })
})

// Supabase-Attrappe mit eq/in/is-Filtern (alles andere wird durchgereicht)
function attrappe(tabellen, protokoll = []) {
  return {
    from(t) {
      let zeilen = [...(tabellen[t] ?? [])]
      protokoll.push(t)
      const b = {
        select: () => b, order: () => b,
        eq: (s, w) => { zeilen = zeilen.filter(z => (s === 'tenant_id' ? true : z[s] === w)); return b },
        in: (s, liste) => { zeilen = zeilen.filter(z => liste.includes(z[s])); return b },
        is: (s, w) => { zeilen = zeilen.filter(z => (z[s] ?? null) === w); return b },
        range: (von, bis) => Promise.resolve({ data: zeilen.slice(von, bis + 1), error: null }),
        then: (ok, nein) => Promise.resolve({ data: zeilen, error: null }).then(ok, nein),
      }
      return b
    },
  }
}

describe('KAN-475 Nebenbefund: Lader (Fall aus dem UAT, Daten wie im Musterhof)', () => {
  const A = '33333333-3333-4333-8333-000b00000015', B = '3eeb6d65-ae6d-48a4-886f-f20dd70d9395'
  const tabellen = () => ({
    keller_umzuege: [
      { id: 'u1', zeilen_typ: 'quelle', umzug_batch_id: 'x', von_weinausbau_id: A, nach_weinausbau_id: null, datum: '2026-11-19', erstellt_am: '2026-11-19T12:49:30.520166+00:00', verschnitt: false, storniert_am: null },
      { id: 'u2', zeilen_typ: 'ziel', umzug_batch_id: 'x', von_weinausbau_id: null, nach_weinausbau_id: B, datum: '2026-11-19', erstellt_am: '2026-11-19T12:49:30.725907+00:00', verschnitt: false, storniert_am: null },
      // Verschnitt und stornierter Umzug in dieselbe Charge: keine Vorgeschichte
      { id: 'u3', zeilen_typ: 'ziel', umzug_batch_id: null, von_weinausbau_id: 'V', nach_weinausbau_id: B, datum: '2026-11-20', erstellt_am: null, verschnitt: true, storniert_am: null },
      { id: 'u4', zeilen_typ: 'ziel', umzug_batch_id: null, von_weinausbau_id: 'S', nach_weinausbau_id: B, datum: '2026-11-20', erstellt_am: null, verschnitt: false, storniert_am: '2026-11-20T10:00:00+00:00' },
    ],
    keller_behandlungen: [
      { id: 'k1', weinausbau_id: A, datum: '2025-10-05', created_at: '2025-10-05T00:00:00+00:00', typ_name_snapshot: 'Hefegabe', pressung_id: null, storniert_am: null },
      { id: 'k2', weinausbau_id: A, datum: '2026-11-19', created_at: '2026-11-19T12:48:39.752804+00:00', typ_name_snapshot: 'Schönung (Bentonit)', pressung_id: null, storniert_am: null },
      { id: 'k3', weinausbau_id: A, datum: '2026-06-01', created_at: '2026-06-01T00:00:00+00:00', typ_name_snapshot: 'storniert', pressung_id: null, storniert_am: '2026-06-02T00:00:00+00:00' },
      { id: 'k4', weinausbau_id: 'V', datum: '2026-01-01', created_at: null, typ_name_snapshot: 'vom Verschnittpartner', pressung_id: null, storniert_am: null },
      { id: 'k5', weinausbau_id: 'S', datum: '2026-01-01', created_at: null, typ_name_snapshot: 'vom stornierten Umzug', pressung_id: null, storniert_am: null },
    ],
    weinausbau: [{ id: A, name: 'St. Laurent Reserve' }, { id: B, name: 'St. Laurent Reserve' }],
  })
  test('neue Charge: Hefegabe und Schönung der Ursprungscharge, ohne Stornierte, ohne Verschnitt', async () => {
    const r = await ladeBehandlungVorgeschichte(attrappe(tabellen()), 'T', [B])
    assert.equal(r.error, null)
    assert.deepEqual(r.data.get(B).map(z => [z.behandlung.typ_name_snapshot, z.charge, z.bis]),
      [['Hefegabe', 'St. Laurent Reserve', '2026-11-19'], ['Schönung (Bentonit)', 'St. Laurent Reserve', '2026-11-19']])
  })
  test('Ursprungscharge bzw. Charge ohne Umzug: leer, ohne Abfrage der Behandlungen', async () => {
    const protokoll = []
    const r = await ladeBehandlungVorgeschichte(attrappe(tabellen(), protokoll), 'T', [A])
    assert.deepEqual([r.error, r.data.get(A)], [null, []])
    assert.deepEqual(protokoll, ['keller_umzuege'])
  })
  test('Lesefehler → Fehlertext statt leerer Vorgeschichte', async () => {
    const kaputt = { from: () => { const b = { select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, range: async () => ({ data: null, error: { message: 'weg' } }) }; return b } }
    const r = await ladeBehandlungVorgeschichte(kaputt, 'T', [B])
    assert.equal(r.data, null)
    assert.match(r.error, /Umzüge der Charge konnten nicht geladen werden \(weg\)/)
  })
})

describe('KAN-475 Nebenbefund: Weinbuch und Seite nutzen den Baustein', () => {
  test('Weinbuch: übernommene Behandlungen als Kellerbehandlung mit Vermerk „über Charge …“, Lesefehler als Hinweis', () => {
    const w = quelle('src/lib/wein/weinbuch.ts')
    const i = w.indexOf('const vor = await ladeBehandlungVorgeschichte(supabase, tenantId, [String(wa.id)])')
    assert.ok(i > 0 && i < w.indexOf('for (const kb of kellerBeh) {'))
    assert.ok(w.includes('if (vor.error !== null) warnungen.push(`${vor.error}.`)'))
    assert.ok(w.includes('_vermerk: `über Charge „${z.charge}“ (vor dem Umzug am ${ttmmjjjj(z.bis)})`'))
    assert.ok(w.includes('id: `vor-${z.behandlung.id}`'))
  })
  test('Seite Kellerbehandlungen: keine eigene Abfrage der Umzüge mehr (fand Buchungen aus Quell- und Zielzeile nicht)', () => {
    const k = quelle('src/app/(dashboard)/kellerbuch/_behandlungen/Kellerbehandlungen.tsx')
    assert.ok(k.includes('const vg = await ladeBehandlungVorgeschichte(supabase, activeTenantId, [chargeId])'))
    assert.ok(k.includes('if (vg.error !== null) { setLadeFehler(vg.error); setLoading(false); return }'))
    assert.ok(!k.includes(".neq('von_weinausbau_id', chargeId)") && !k.includes(".lte('datum', u.datum)"))
  })
  test('Handbuch nennt Weinbuch und Zeitpunkt', () => {
    const h = quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.ok(h.includes('mit dem Vermerk „über Charge …“') && h.includes('Maßgeblich ist der Zeitpunkt des Umzugs'))
  })
})
