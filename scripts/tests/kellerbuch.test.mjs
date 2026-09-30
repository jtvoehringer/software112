// Tests der Behördenmeldungen Gruppe „Kellerbuch“ (24.09.2026) – ohne Datenbank
//
// Aufruf (Node ≥ 22.6, keine zusätzliche Abhängigkeit):
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test scripts/tests/kellerbuch.test.mjs
//
// Die Ladefunktionen laufen gegen eine Attrappe des Supabase-Clients (Tabellen als Arrays,
// eq/in/gte/lte/is werden ausgewertet). Geprüft werden Parameter, Zeilen, Rundung, Saldo,
// Übertrag, Charge-Zuordnung über den Belegungszeitraum, Kellergemeinschaft, 403/404,
// Dateinamen und die fertigen CSV-Zellen (Profil EXCEL_AT).
// kellerbuch-hooks.mjs löst '@/…', Pfade ohne Endung und 'server-only' auf.

import { register } from 'node:module'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

register('./kellerbuch-hooks.mjs', import.meta.url)

const csv = await import('../../src/lib/csv/index.ts')
const hilfen = await import('../../src/lib/behoerden/kellerbuch-hilfen.ts')
const typen = await import('../../src/lib/behoerden/typen.ts')
const { KATALOG_KELLERBUCH } = await import('../../src/lib/behoerden/katalog/kellerbuch.ts')
const { MELDUNGEN_KELLERBUCH: M } = await import('../../src/lib/behoerden/register/kellerbuch.ts')
const bewegungsbuch = await import('../../src/lib/behoerden/bewegungsbuch.ts')
const weinbuch = await import('../../src/lib/behoerden/weinbuch.ts')
const rueck = await import('../../src/lib/behoerden/rueckverfolgung.ts')
const blend = await import('../../src/lib/behoerden/blend.ts')
const aend = await import('../../src/lib/behoerden/aenderungsprotokoll.ts')
const mgExport = await import('../../src/lib/behoerden/mostgewicht_export.ts')

const { csvDatei, csvDateiname, PROFIL_EXCEL_AT } = csv
const T = '11111111-1111-4111-8111-111111111111'
const X = '99999999-9999-4999-8999-999999999999'
const G1 = 'a0000000-0000-4000-8000-000000000001'
const G2 = 'a0000000-0000-4000-8000-000000000002'
const G3 = 'a0000000-0000-4000-8000-000000000003'
const C1 = 'c0000000-0000-4000-8000-000000000001'
const C2 = 'c0000000-0000-4000-8000-000000000002'
const BETRIEB = { name: 'Weingut Test', betriebsnummer: '1234567' }

// ── Attrappe des Supabase-Clients ───────────────────────────────────────────

function attrappe(tabellen, rpc = {}) {
  const log = []
  function from(tabelle) {
    const filter = []
    let einzel = false
    const sortierung = []
    const b = {
      select() { return b }, range() { return b }, limit() { return b },
      order(k, o) { sortierung.push([k, o?.ascending !== false]); return b },
      ilike() { return b }, contains() { return b },
      eq(k, v) { filter.push(['eq', k, v]); return b },
      neq(k, v) { filter.push(['neq', k, v]); return b },
      in(k, v) { filter.push(['in', k, v]); return b },
      gte(k, v) { filter.push(['gte', k, v]); return b },
      lte(k, v) { filter.push(['lte', k, v]); return b },
      lt(k, v) { filter.push(['lt', k, v]); return b },
      is(k, v) { filter.push(['is', k, v]); return b },
      // KAN-127: or('a.gte.x,b.gte.y') wie PostgREST (eq, gte, lte)
      or(ausdruck) { filter.push(['or', ausdruck, null]); return b },
      not(k, op, v) { filter.push([op === 'is' ? 'nichtNull' : 'neq', k, v]); return b },
      maybeSingle() { einzel = true; return b },
      single() { einzel = true; return b },
      then(ok, fehler) {
        log.push({ tabelle, filter: [...filter] })
        let rows = (tabellen[tabelle] ?? []).slice()
        for (const [op, k, v] of filter) {
          rows = rows.filter(r => {
            // Felder eingebetteter Zeilen ('pressung.tenant_id') wie PostgREST mit !inner
            const wert = (zeile, pfad) => pfad.split('.').reduce((o, t) => (o == null ? undefined : o[t]), zeile)
            if (op === 'or') {
              return k.split(',').some(t => {
                const [feld, o2, ...rest] = t.split('.')
                const v2 = rest.join('.'), y = wert(r, feld)
                return o2 === 'eq' ? String(y) === v2 : o2 === 'gte' ? y != null && y >= v2 : o2 === 'lte' ? y != null && y <= v2 : false
              })
            }
            const x = wert(r, k)
            if (op === 'eq') return x === v
            if (op === 'neq') return x !== v
            if (op === 'in') return v.includes(x)
            if (op === 'gte') return x != null && x >= v
            if (op === 'lte') return x != null && x <= v
            if (op === 'lt') return x != null && x < v
            if (op === 'is') return v === null ? x == null : x === v
            if (op === 'nichtNull') return x != null
            return true
          })
        }
        rows.sort((r1, r2) => {
          for (const [k, auf] of sortierung) {
            const a = r1[k] ?? '', b2 = r2[k] ?? ''
            if (a < b2) return auf ? -1 : 1
            if (a > b2) return auf ? 1 : -1
          }
          return 0
        })
        return Promise.resolve({ data: einzel ? (rows[0] ?? null) : rows, error: null }).then(ok, fehler)
      },
    }
    return b
  }
  return { from, rpc: (name, args) => Promise.resolve({ data: rpc[name] ? rpc[name](args) : [], error: null }), log }
}

const gebindeRpc = (zeilen) => ({ lade_behaelter: ({ p_tenant_id }) => (p_tenant_id === T ? zeilen : []) })
const gebinde = (id, name, extra = {}) => ({
  id, tenant_id: T, name, typ: 'stahltank', volumen_liter: 5000, standort: 'Keller 1', aktiv: true, gemeinsam: false,
  stapler: false, notizen: null, import_quelle: null, eigentuemer_name: 'Weingut Test', fremd: false,
  eigen_liter: 0, fremd_liter: 0, fremd_betrieb: null, ...extra,
})

/** CSV in Zeilen/Zellen (ohne BOM; nur für Testdaten ohne Anführungszeichen) */
function zellen(text) {
  assert.ok(text.startsWith('\uFEFF'), 'BOM fehlt')
  assert.ok(text.endsWith('\r\n'), 'abschließendes CRLF fehlt')
  return text.slice(1, -2).split('\r\n').map(l => l.split(';'))
}

/** Meldung wie die Route ausführen: parameter → laden → csvDatei → Dateiname */
async function ausfuehren(id, query, supabase, membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }) {
  const m = M[id]
  const p = m.parameter(new URLSearchParams(query))
  if (typen.istParameterFehler(p)) return { parameterFehler: p.fehler }
  const e = await m.laden({ supabase, tenantId: T, membership, betrieb: BETRIEB }, p)
  const datei = csvDatei(e.zeilen, m.spalten, m.profil ?? PROFIL_EXCEL_AT)
  return { ...datei, warnungen: [...(e.warnungen ?? []), ...datei.warnungen], dateiname: csvDateiname(m.dateiteile(p, BETRIEB), '2026-09-24'), tabelle: zellen(datei.text) }
}

// ── Testdaten Bewegungsbuch/Kellerbehandlungen ──────────────────────────────

function kellerDaten() {
  return {
    weinausbau: [
      { id: C1, tenant_id: T, name: 'GV 2025', jahrgang: 2025, rebsorte: 'Grüner Veltliner', menge_liter: '889.5', aktiv: true, status: 'ausbau', ist_eroeffnungsbestand: false, anfangsbestand_liter: null, created_at: '2025-09-20T08:00:00+00:00', behaelter_id: G1, qualitaetsstufe: 'qualitaetswein', transaktions_nr: null },
      { id: C2, tenant_id: T, name: 'ZW Reserve', jahrgang: 2024, rebsorte: 'Zweigelt', menge_liter: '300', aktiv: true, status: 'ausbau', ist_eroeffnungsbestand: false, behaelter_id: null, qualitaetsstufe: null },
    ],
    pressung_behaelter: [
      { id: 'pb1', behaelter_id: G1, weinausbau_id: C1, menge_liter: '1000', notizen: null, pressung: { id: 'p1', datum: '2025-09-20', notizen: 'Handlese', tenant_id: T } },
      // fremder Betrieb im selben Gebinde (Mehrfach-Mitgliedschaft) – darf nicht mitzählen
      { id: 'pb2', behaelter_id: G1, weinausbau_id: 'fremd', menge_liter: '500', notizen: null, pressung: { id: 'p2', datum: '2025-09-21', notizen: null, tenant_id: X } },
    ],
    keller_umzuege: [],
    fuellungen: [
      { id: 'f1', tenant_id: T, weinausbau_id: C1, datum: '2026-03-01', name: 'GV Klassik', anzahl_flaschen: 134, flaschengroesse_ml: 750, menge_liter_gefuellt: '100.5', pruefnummer: 'N 1234/26', chargennummer: 'L-26-01', aktiv: true },
    ],
    verkauf_positionen: [
      { id: 'v1', tenant_id: T, weinausbau_id: C1, typ: 'tank', menge: '10', einheit: 'L', verkaufsposten: { datum: '2026-04-01', storniert: false, rechnungsnummer: 'RE-2026-0007', firma: { name: '=Gasthaus Linde' }, kontakt: null } },
      { id: 'v2', tenant_id: T, weinausbau_id: C1, typ: 'tank', menge: '99', einheit: 'L', verkaufsposten: { datum: '2026-04-02', storniert: true, rechnungsnummer: 'RE-2026-0008' } },
    ],
    zukauf_posten: [],
    verschneidung_quellen: [],
    verschneidungen: [],
    keller_behandlungen: [
      { id: 'k1', tenant_id: T, behaelter_id: G1, weinausbau_id: C1, datum: '2025-10-01', menge: '50', einheit: 'g', volumen_liter_ist: '1000', notizen: 'nach Gärende', typ_name_snapshot: 'Schwefelung', typ: { name: 'Schwefelung' }, weinausbau: { name: 'GV 2025' }, behaelter: { name: 'Tank 1' } },
      // ohne Charge: am 05.11.2025 lag nur GV 2025 im Gebinde → Zuordnung über den Belegungszeitraum
      { id: 'k2', tenant_id: T, behaelter_id: G1, weinausbau_id: null, datum: '2025-11-05', menge: '0.005', einheit: 'kg', volumen_liter_ist: null, notizen: null, typ_name_snapshot: 'Bentonit', typ: null, weinausbau: null, behaelter: { name: 'Tank 1' } },
      // ohne Charge, vor der ersten Befüllung → keine Charge
      { id: 'k3', tenant_id: T, behaelter_id: G1, weinausbau_id: null, datum: '2025-08-01', menge: null, einheit: '-', volumen_liter_ist: null, notizen: 'Reinigung', typ_name_snapshot: 'Reinigung', typ: { name: 'Reinigung' }, weinausbau: null, behaelter: { name: 'Tank 1' } },
    ],
  }
}

const gebindeKeller = [
  gebinde(G1, 'Tank 1', { fremd_liter: 200, fremd_betrieb: 'Weingut Partner', gemeinsam: true }),
  gebinde(G2, 'Barrique 7', { typ: 'barrique', volumen_liter: 225 }),
  gebinde(G3, 'Tank 9', { fremd: true, eigentuemer_name: 'Weingut Partner', aktiv: false }),
]

// ── Hilfen ────────────────────────────────────────────────────────────────

describe('Hilfen: Parameter und Zeitraum', () => {
  test('Zeitraum: gültig, ungültig, von nach bis', () => {
    assert.deepEqual(hilfen.zeitraumAus(new URLSearchParams('von=2026-01-01&bis=2026-12-31')), { von: '2026-01-01', bis: '2026-12-31' })
    assert.deepEqual(hilfen.zeitraumAus(new URLSearchParams('')), { von: null, bis: null })
    assert.ok(typen.istParameterFehler(hilfen.zeitraumAus(new URLSearchParams('von=2026-02-30'))))
    assert.ok(typen.istParameterFehler(hilfen.zeitraumAus(new URLSearchParams('von=1.1.2026'))))
    assert.ok(typen.istParameterFehler(hilfen.zeitraumAus(new URLSearchParams('von=2026-05-01&bis=2026-04-01'))))
    assert.equal(hilfen.zeitraumTeil({ von: '2026-01-01', bis: null }), 'ab_2026-01-01')
    assert.equal(hilfen.zeitraumTeil({ von: null, bis: null }), null)
  })
  test('Wiener Tagesbeginn als UTC (Winter- und Sommerzeit)', () => {
    assert.equal(hilfen.wienTagesbeginnUtc('2026-01-15'), '2026-01-14T23:00:00.000Z')
    assert.equal(hilfen.wienTagesbeginnUtc('2026-07-01'), '2026-06-30T22:00:00.000Z')
    assert.equal(hilfen.wienTagesbeginnUtc('2026-03-29'), '2026-03-28T23:00:00.000Z')
    assert.equal(hilfen.folgetag('2026-12-31'), '2027-01-01')
  })
  test('UUID-Parameter und Jahrgang', () => {
    assert.ok(typen.istParameterFehler(hilfen.uuidAus(new URLSearchParams(''), 'behaelter', 'Gebinde')))
    assert.ok(typen.istParameterFehler(hilfen.uuidAus(new URLSearchParams('behaelter=1;drop'), 'behaelter', 'Gebinde')))
    assert.equal(hilfen.uuidAus(new URLSearchParams(`behaelter=${G1.toUpperCase()}`), 'behaelter', 'Gebinde'), G1)
    assert.ok(typen.istParameterFehler(hilfen.jahrgangOptional(new URLSearchParams('jahrgang=20x5'))))
    assert.equal(hilfen.jahrgangOptional(new URLSearchParams('jahrgang=2025')), 2025)
  })
})

describe('Katalog und Register', () => {
  test('jede Katalog-id hat genau einen Register-Eintrag mit Spalten', () => {
    assert.deepEqual(Object.keys(M).sort(), Object.keys(KATALOG_KELLERBUCH).sort())
    for (const [id, m] of Object.entries(M)) {
      assert.equal(m.id, id)
      assert.equal(m.gruppe, 'kellerbuch')
      assert.ok(m.spalten.length > 0, id)
      assert.ok(m.druckPfad?.startsWith('/'), id)
    }
  })
  test('Zugriff: Pflichtmeldung Weinbuch-Sammlung, Controlling für Keller-Auswertungen', () => {
    assert.equal(M['weinbuch-sammlung'].zugriff, 'betriebsleitung')
    assert.equal(M['weinbuch-sammlung'].pflicht, true)
    assert.equal(M['keller-auswertungen'].zugriff, 'auswertungen')
    assert.equal(M.aenderungsprotokoll.zugriff, 'verwaltung')
    for (const id of ['bewegungsbuch', 'keller-behandlungen', 'gebindeverzeichnis', 'weinbuch', 'rueckverfolgung', 'blend-protokoll']) assert.equal(M[id].zugriff, 'mitglied', id)
  })
})

// ── Bewegungsbuch ────────────────────────────────────────────────────────────

describe('bewegungsbuch', () => {
  test('nur „bis“: Bewegungen ohne Datum stehen am Anfang (Saldo geht auf)', () => {
    const b = (datum, menge) => ({ datum, art: 'zukauf', beschreibung: 'x', menge, chargeId: null, charge: null, gegenstelle: null, beleg: null })
    const mit = bewegungsbuch.mitSaldo([b('', 500), b('2026-03-01', 100), b('2026-08-01', -50)])
    const nurBis = bewegungsbuch.imZeitraumMitUebertrag(mit, { von: null, bis: '2026-06-30' })
    assert.deepEqual(nurBis.map(z => [z.datum, z.menge, z.saldo]), [['', 500, 500], ['2026-03-01', 100, 600]])
    const summe = nurBis.reduce((s, z) => s + z.menge, 0)
    assert.equal(summe, nurBis.at(-1).saldo)
    // mit „von“: undatierte Bewegung steckt im Übertrag
    const vonBis = bewegungsbuch.imZeitraumMitUebertrag(mit, { von: '2026-01-01', bis: '2026-06-30' })
    assert.deepEqual(vonBis.map(z => [z.art, z.saldo]), [['uebertrag', 500], ['zukauf', 600]])
  })

  test('Parameter: Gebinde Pflicht, Zeitraum geprüft', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    assert.match((await ausfuehren('bewegungsbuch', '', sb)).parameterFehler, /Gebinde fehlt/)
    assert.match((await ausfuehren('bewegungsbuch', `behaelter=${G1}&von=2026-13-01`, sb)).parameterFehler, /von/)
  })

  test('gesamter Zeitraum: Zu-/Abgänge, Saldo, fremder Betrieb und Storno ausgelassen', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    const r = await ausfuehren('bewegungsbuch', `behaelter=${G1}`, sb)
    const [kopf, ...z] = r.tabelle
    assert.deepEqual(kopf, ['Datum', 'Gebinde', 'Art', 'Charge', 'Vorgang', 'Zugang (l)', 'Abgang (l)', 'Saldo (l)', 'Gegenstelle', 'Beleg', 'Hinweis'])
    assert.equal(r.zeilen, 6)   // Pressung, 3 Behandlungen, Abfüllung, Tankverkauf (Storno fehlt, fremde Pressung fehlt)
    const pressung = z.find(c => c[2] === 'Pressung')
    assert.deepEqual(pressung.slice(0, 8), ['20.09.2025', 'Tank 1', 'Pressung', 'GV 2025', 'Ernte / Pressung – Handlese', '1000,00', '', '1000,00'])
    const abf = z.find(c => c[2] === 'Abfüllung')
    assert.deepEqual([abf[5], abf[6], abf[7], abf[9]], ['', '100,50', '899,50', 'N 1234/26'])
    assert.equal(abf[4], 'Abfüllung: GV Klassik · Prüfnr. N 1234/26')
    const vk = z.find(c => c[2] === 'Tankverkauf')
    assert.deepEqual([vk[6], vk[7], vk[8], vk[9]], ['10,00', '889,50', "'=Gasthaus Linde", 'RE-2026-0007'])   // Formelschutz
    const beh = z.find(c => c[4] === 'Bentonit')
    assert.deepEqual([beh[0], beh[2], beh[5], beh[6], beh[7]], ['05.11.2025', 'Kellerbehandlung', '', '', '1000,00'])
    assert.ok(r.warnungen.some(w => w.includes('Weingut Partner') && w.includes('200,00 L')), r.warnungen.join(' | '))
  })

  test('Zeitraum ab 01.01.2026: Übertrag mit Saldo davor, Dateiname mit Gebinde und Zeitraum', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    const r = await ausfuehren('bewegungsbuch', `behaelter=${G1}&von=2026-01-01`, sb)
    const [, ...z] = r.tabelle
    assert.equal(z.length, 3)
    assert.deepEqual(z[0].slice(0, 8), ['01.01.2026', 'Tank 1', 'Übertrag', '', 'Übertrag – Saldo vor dem 01.01.2026', '', '', '1000,00'])
    assert.deepEqual(z.map(c => c[7]), ['1000,00', '899,50', '889,50'])
    assert.equal(r.dateiname.utf8, 'Bewegungsbuch_1234567_Tank-1_ab_2026-01-01_2026-09-24.csv')
  })

  test('Leermeldung: Zeitraum ohne Bewegungen ergibt nur die Kopfzeile', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    const r = await ausfuehren('bewegungsbuch', `behaelter=${G1}&von=2027-01-01&bis=2027-12-31`, sb)
    // Übertrag bleibt (Bestand zum Beginn) – ohne „von“ vor allen Bewegungen wäre die Datei leer
    assert.equal(r.zeilen, 1)
    const leer = await ausfuehren('bewegungsbuch', `behaelter=${G1}&bis=2020-12-31`, sb)
    assert.equal(leer.zeilen, 0)
    assert.equal(leer.tabelle.length, 1)
  })

  test('unbekanntes Gebinde → 404', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    await assert.rejects(ausfuehren('bewegungsbuch', `behaelter=${C2}`, sb), e => e instanceof typen.MeldungsFehler && e.status === 404)
  })

  test('Belegungszeitraum: aktive Charge bleibt offen, eindeutige Zuordnung', () => {
    const bew = [
      { datum: '2025-09-20', art: 'pressung', menge: 1000, chargeId: 'A', charge: 'A' },
      { datum: '2025-12-01', art: 'umzug_aus', menge: -1000, chargeId: 'A', charge: 'A' },
      { datum: '2026-01-10', art: 'umzug_ein', menge: 500, chargeId: 'B', charge: 'B' },
    ]
    const b = bewegungsbuch.belegungszeitraeume(bew, [{ id: 'B', aktiv: true }])
    assert.deepEqual(b.map(x => [x.chargeId, x.von, x.bis]), [['A', '2025-09-20', '2025-12-01'], ['B', '2026-01-10', null]])
    assert.equal(bewegungsbuch.chargeAmTag(b, '2025-10-15').chargeId, 'A')
    assert.equal(bewegungsbuch.chargeAmTag(b, '2025-12-24'), null)
    assert.equal(bewegungsbuch.chargeAmTag(b, '2026-09-01').chargeId, 'B')
  })
})

// ── Kellerbehandlungen ───────────────────────────────────────────────────────

describe('keller-behandlungen', () => {
  test('je Gebinde: Charge erfasst bzw. aus Belegung, Dosierung, Menge mit 3 Stellen', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    const r = await ausfuehren('keller-behandlungen', `behaelter=${G1}`, sb)
    const [kopf, ...z] = r.tabelle
    assert.deepEqual(kopf, ['Datum', 'Gebinde', 'Charge', 'Zuordnung Charge', 'Behandlung / Verfahren', 'Menge', 'Einheit', 'Dosierung (g/hl)', 'Volumen Ist (l)', 'Notizen'])
    assert.deepEqual(z.map(c => c[0]), ['01.08.2025', '01.10.2025', '05.11.2025'])
    assert.deepEqual(z[0].slice(2, 7), ['', 'keine Charge im Gebinde', 'Reinigung', '', ''])
    assert.deepEqual(z[1].slice(2, 9), ['GV 2025', 'an der Behandlung erfasst', 'Schwefelung', '50,000', 'g', '5,0', '1000,00'])
    assert.deepEqual(z[2].slice(2, 7), ['GV 2025', 'aus dem Belegungszeitraum des Gebindes', 'Bentonit', '0,005', 'kg'])
    assert.ok(r.warnungen.some(w => w.startsWith('1 Behandlung ist ohne erfasste Charge')))
    assert.ok(r.warnungen.some(w => w.startsWith('1 Behandlung hat keine Charge')))
    assert.equal(r.dateiname.utf8, 'Kellerbehandlungen_1234567_Tank-1_2026-09-24.csv')
  })
  test('ohne Gebinde → Parameterfehler (die Liste aller Gebinde ist eine eigene Meldung)', async () => {
    const r = await ausfuehren('keller-behandlungen', 'von=2025-10-01', attrappe(kellerDaten(), gebindeRpc(gebindeKeller)))
    assert.match(r.parameterFehler, /Gebinde fehlt/)
  })
  test('alle Gebinde mit Zeitraum (Keller-Auswertungen, Zugriff Controlling)', async () => {
    assert.equal(M['keller-behandlungen-alle'].zugriff, 'auswertungen')
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    const r = await ausfuehren('keller-behandlungen-alle', 'von=2025-10-01&bis=2025-10-31', sb)
    assert.equal(r.zeilen, 1)
    assert.equal(r.dateiname.utf8, 'Kellerbehandlungen_1234567_alle-Gebinde_2025-10-01_bis_2025-10-31_2026-09-24.csv')
  })
})

// ── Gebindeverzeichnis ───────────────────────────────────────────────────────

describe('gebindeverzeichnis', () => {
  test('Gebinde × Charge, leeres Gebinde, Kellergemeinschaft nur als Belegung', async () => {
    const sb = attrappe(kellerDaten(), gebindeRpc(gebindeKeller))
    const r = await ausfuehren('gebindeverzeichnis', '', sb)
    const [kopf, ...z] = r.tabelle
    assert.equal(kopf[0], 'Gebinde')
    assert.equal(z.length, 3)
    const t1 = z.find(c => c[0] === 'Tank 1')
    // 889,50 eigen + 200 fremd = 1089,50 von 5000 l = 21,8 %
    assert.deepEqual([t1[1], t1[2], t1[4], t1[6], t1[8], t1[9], t1[11], t1[12], t1[13], t1[14], t1[15]],
      ['Stahltank', '5000,00', 'Ja', 'GV 2025', 'Grüner Veltliner', 'GV', '889,50', '1089,50', '21,8', '200,00', 'Weingut Partner'])
    const leer = z.find(c => c[0] === 'Barrique 7')
    assert.deepEqual([leer[1], leer[6], leer[11], leer[12]], ['Barrique', '', '', '0,00'])
    const fremd = z.find(c => c[0] === 'Tank 9')
    assert.deepEqual([fremd[4], fremd[5]], ['Nein', 'Weingut Partner'])
    assert.ok(r.warnungen.some(w => w.includes('Kellergemeinschaft')))
    assert.ok(r.warnungen.some(w => w.includes('keinem Gebinde zugeordnet')))
    const aktiv = await ausfuehren('gebindeverzeichnis', 'aktiv=1', attrappe(kellerDaten(), gebindeRpc(gebindeKeller)))
    assert.equal(aktiv.zeilen, 2)
    assert.equal(aktiv.dateiname.utf8, 'Gebindeverzeichnis_1234567_aktive_2026-09-24.csv')
  })
})

// ── Weinbuch ─────────────────────────────────────────────────────────────────

describe('weinbuch und weinbuch-sammlung', () => {
  test('eine Zeile je Ereignis, Details mit „ | “, Zeitpunkt in Wiener Zeit', () => {
    const wb = {
      wa: { id: C1, name: 'GV 2025', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaetsstufe: null, status: 'ausbau', menge_liter: 889.5, behaelter_id: G1, behaelter_name: 'Tank 1' },
      events: [
        { datum: '2025-09-20', typ: 'pressung', titel: 'Pressung', details: ['1.000 L Most', 'Weingärten: Ried Hochrain'] },
        { datum: '2026-02-28T23:30:00+00:00', typ: 'dac', titel: 'DAC-Antrag', details: ['Prüfnummer: N 1234/26'], badge: 'Genehmigt' },
      ],
    }
    const text = csv.csvText(weinbuch.weinbuchZeilen(wb), weinbuch.SPALTEN_WEINBUCH)
    const [kopf, a, b] = zellen(text)
    assert.deepEqual(kopf, ['Charge', 'Jahrgang', 'Rebsorte', 'BKI-Kürzel', 'Gebinde (aktuell)', 'Datum', 'Art', 'Ereignis', 'Details', 'Status'])
    assert.deepEqual(a, ['GV 2025', '2025', 'Grüner Veltliner', 'GV', 'Tank 1', '20.09.2025', 'Pressung', 'Pressung', '1.000 L Most | Weingärten: Ried Hochrain', ''])
    assert.deepEqual(b.slice(5), ['01.03.2026', 'DAC / Prüfnummer', 'DAC-Antrag', 'Prüfnummer: N 1234/26', 'Genehmigt'])
  })
  test('unbekannte Charge → 404; Sammlung mit Filter und Dateiname', async () => {
    const daten = kellerDaten()
    daten.weinausbau[0].behaelter = { name: 'Tank 1' }
    const sb = attrappe(daten, gebindeRpc(gebindeKeller))
    await assert.rejects(ausfuehren('weinbuch', `charge=${G2}`, sb), e => e instanceof typen.MeldungsFehler && e.status === 404)
    const w = await ausfuehren('weinbuch', `charge=${C1}`, sb)
    assert.deepEqual(w.tabelle.slice(1).map(c => c[6]), ['Pressung', 'Kellerbehandlung', 'Füllung'])   // k1 an der Charge; k2/k3 nicht, weil erfasste vorhanden
    assert.equal(w.dateiname.utf8, 'Weinbuch_1234567_GV-2025_2026-09-24.csv')
    assert.match((await ausfuehren('weinbuch-sammlung', 'jahrgang=abc', sb)).parameterFehler, /Jahrgang/)
    const s = await ausfuehren('weinbuch-sammlung', 'jahrgang=2025&sorte=Grüner Veltliner', sb)
    assert.equal(s.zeilen, 3)   // ein Weinbuch (GV 2025) mit drei Ereignissen
    assert.equal(s.dateiname.utf8, 'Weinbuch-Sammlung_1234567_2025_Grüner-Veltliner_2026-09-24.csv')
    assert.equal(s.dateiname.ascii, 'Weinbuch-Sammlung_1234567_2025_Gruener-Veltliner_2026-09-24.csv')
  })
  // KAN-128 (Merge-Voraussetzung der Migration A): der Trigger schreibt in jede Lese mit °KMW das
  // gerechnete °Oe – das Weinbuch darf es nicht roh („86.7 °Oe“) und nicht als Messwert zeigen
  // KAN-127: Lese-Ereignisse kommen aus den Lesezeilen der Charge (pressung_weingaerten), nicht mehr aus allen
  // Erntemeldungs-Einträgen der Weingärten im Jahrgang. Die Lesezeilen stehen in pressung_behaelter (Bewegungsgraph)
  // und werden über pressung_weingaerten (id) samt Pressung nachgeladen.
  function mitLesezeilen(daten, zeilen) {
    const pressung = { ...daten.pressung_behaelter[0].pressung, erstellt_am: '2025-09-20T10:00:00Z', jahrgang_id: 'j2025', lese_id: null, jahrgang: { jahrgang: 2025 }, lese: null, most_liter_gesamt: null, weinbezeichnung: null }
    const pw = zeilen.map((z, i) => ({
      id: `pw${i + 1}`, zukauf_posten_id: null, grundstueck_id: z.grundstueck ? `g${i + 1}` : null, ...z,
      pressung,
    }))
    daten.pressung_behaelter[0].pressung = { ...pressung, pressung_weingaerten: pw }
    daten.pressung_weingaerten = pw
    daten.weinjahrgaenge = [{ id: 'j2025', tenant_id: T, jahrgang: 2025 }]
    return daten
  }
  // KAN-128 (Merge-Voraussetzung der Migration A): der Trigger schreibt in jede Lese mit °KMW das
  // gerechnete °Oe – das Weinbuch darf es nicht roh („86.7 °Oe“) und nicht als Messwert zeigen
  test('KAN-128: Mostgewicht der Lese – °KMW mit Komma, °Oe nur als Messwert, gerechnet nie ohne „≈“', async () => {
    const daten = kellerDaten()
    daten.weinausbau[0].behaelter = { name: 'Tank 1' }
    const lese = (ernte_datum, kmw, oechsle, mostgewicht_einheit) => ({
      trauben_kg: '1200', rebsorte: null, ernte_datum, kmw, oechsle, mostgewicht_einheit, weingarten_id: 'w1',
      weingarten: { id: 'w1', name: 'Ried Hochrain' }, grundstueck: { gst_nr: '1234/5', katastralgemeinde: '04023', ama_feldnummer: null },
    })
    mitLesezeilen(daten, [
      lese('2025-09-16', 17.6, 86.7, 'kmw'),          // gemessen °KMW, °Oe vom Trigger gerechnet (Zahl wie aus PostgREST)
      lese('2025-09-17', '18.95', '93.8', 'kmw'),     // numerische Texte, 2 Stellen
      lese('2025-09-18', '17.09', '84.0', 'oechsle'), // gemessen °Oe, °KMW nach Variante B
      lese('2025-09-19', null, null, 'kmw'),          // ohne Mostgewicht
    ])
    const w = await ausfuehren('weinbuch', `charge=${C1}`, attrappe(daten, gebindeRpc(gebindeKeller)))
    const leseZeilen = w.tabelle.slice(1).filter(c => c[6] === 'Ernte / Lese')
    assert.deepEqual(leseZeilen.map(c => c[5]), ['16.09.2025', '17.09.2025', '18.09.2025', '19.09.2025'])
    const details = leseZeilen.map(c => c[8])
    assert.equal(details[0], 'Ried: Ried Hochrain | GST 1234/5 | 1.200 kg | 17,6 °KMW')
    assert.equal(details[1], 'Ried: Ried Hochrain | GST 1234/5 | 1.200 kg | 18,95 °KMW')
    assert.equal(details[2], 'Ried: Ried Hochrain | GST 1234/5 | 1.200 kg | ≈ 17,09 °KMW · 84,0 °Oe')
    assert.equal(details[3], 'Ried: Ried Hochrain | GST 1234/5 | 1.200 kg')
    for (const d of details) {
      assert.doesNotMatch(d, /\d\.\d+ °/, `Punkt statt Komma: ${d}`)
      // gemessen in °KMW: kein °Oe; gemessen in °Oe: der gerechnete °KMW-Wert trägt „≈“
      if (/°Oe/.test(d)) assert.match(d, /≈ \d+,\d+ °KMW · \d+,\d °Oe/, d)
    }
    // Erntemeldungs-Einträge anderer Weingärten erscheinen nicht mehr
    daten.ernte_parzellen = [{ jahrgang_id: 'j2025', weingarten_id: 'w9', ernte_datum: '2025-09-01', menge_kg: '1', weingarten: { name: 'Fremde Ried' }, grundstueck: null }]
    const w2 = await ausfuehren('weinbuch', `charge=${C1}`, attrappe(daten, gebindeRpc(gebindeKeller)))
    assert.ok(!w2.tabelle.some(c => /Fremde Ried/.test(c[8] ?? '')))
  })
  test('KAN-128: Lese aus der Pressungszeile mit derselben Mostgewicht-Regel, ohne Lesedatum mit Vermerk', async () => {
    const daten = kellerDaten()
    daten.weinausbau[0].behaelter = { name: 'Tank 1' }
    mitLesezeilen(daten, [
      { trauben_kg: '600', rebsorte: 'Grüner Veltliner', ernte_datum: '2025-09-18', kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle', weingarten_id: 'w1', weingarten: { id: 'w1', name: 'Ried Hochrain' }, grundstueck: null },
      { trauben_kg: '400', rebsorte: 'Grüner Veltliner', ernte_datum: null, kmw: 18.2, oechsle: 89.9, mostgewicht_einheit: 'kmw', weingarten_id: 'w2', weingarten: { id: 'w2', name: 'Ried Au' }, grundstueck: null },
    ])
    const w = await ausfuehren('weinbuch', `charge=${C1}`, attrappe(daten, gebindeRpc(gebindeKeller)))
    const lesen = w.tabelle.slice(1).filter(c => c[6] === 'Ernte / Lese')
    assert.equal(lesen.length, 2)
    const [a, b] = [lesen.find(c => c[8].includes('Hochrain'))[8], lesen.find(c => c[8].includes('Ried Au'))]
    assert.match(a, /\| ≈ 17,09 °KMW · 84,0 °Oe \|/)
    assert.equal(b[5], '20.09.2025')                                       // ohne Lesedatum: Datum der Pressung
    assert.match(b[8], /\| 18,2 °KMW \|/)
    assert.match(b[8], /Lesedatum nicht erfasst – Datum der Pressung/)
    assert.doesNotMatch(b[8], /°Oe/)
  })
  test('KAN-128: mostgewichtWeinbuchText()', () => {
    const t = mgExport.mostgewichtWeinbuchText
    assert.equal(t({ kmw: 17.4, oechsle: 85.7, einheit: 'kmw' }), '17,4 °KMW')
    assert.equal(t({ kmw: '18.95', oechsle: null, einheit: null }), '18,95 °KMW')          // vor Migration A: nur °KMW
    assert.equal(t({ kmw: 17.09, oechsle: 84, einheit: 'oechsle' }), '≈ 17,09 °KMW · 84,0 °Oe')
    assert.equal(t({ kmw: null, oechsle: '83.5', einheit: null }), '≈ 17,0 °KMW · 83,5 °Oe')   // nur °Oe → gemessen in °Oe, Variante B (17,00)
    assert.equal(t({ kmw: null, oechsle: null, einheit: 'kmw' }), null)
    assert.equal(t(null), null)
  })
  test('Weinbuch-Fallback: Behandlungen ohne Charge nur im Belegungszeitraum', async () => {
    const daten = kellerDaten()
    daten.weinausbau[0].behaelter = { name: 'Tank 1' }
    daten.keller_behandlungen = daten.keller_behandlungen.filter(k => !k.weinausbau_id)   // nur k2 (Belegung GV 2025) und k3 (davor)
    const w = await ausfuehren('weinbuch', `charge=${C1}`, attrappe(daten, gebindeRpc(gebindeKeller)))
    // k2 in der Belegung von GV 2025; k3 (vor der Befüllung, keine Belegung) nicht still weglassen,
    // sondern mit Vermerk und Hinweis (Druck darf gegenüber früher nichts verlieren)
    assert.deepEqual(w.tabelle.slice(1).map(c => [c[5], c[7]]), [['01.08.2025', 'Reinigung'], ['20.09.2025', 'Pressung'], ['05.11.2025', 'Bentonit'], ['01.03.2026', 'GV Klassik']])
    assert.match(w.tabelle[1][8], /Zuordnung zur Charge nicht eindeutig/)
    assert.doesNotMatch(w.tabelle[3][8], /nicht eindeutig/)
    assert.ok(w.warnungen.some(x => /^1 Kellerbehandlung ohne Charge ist keiner Charge eindeutig zuzuordnen/.test(x)))
  })
})

// ── Rückverfolgung ───────────────────────────────────────────────────────────

describe('rueckverfolgung', () => {
  const fuellung = { id: 'f1', name: 'Cuvée Rot', chargennummer: 'L-26-02', pruefnummer: '04023/26', datum: '2026-03-01', jahrgang: 2024, rebsorte: 'Cuvée', anzahl_flaschen: '1000', flaschengroesse_ml: 750 }
  const pw1 = { id: 'pw1', weingarten_id: 'w1', grundstueck_id: 'g1', trauben_kg: '600.4', rebsorte: 'Zweigelt', ernte_datum: '2024-09-29', kmw: '19.25', weingarten: { id: 'w1', name: 'Ried Hochrain' }, grundstueck: { gst_nr: '1234/5', katastralgemeinde: '04023' } }
  const pw2 = { id: 'pw2', weingarten_id: 'w2', grundstueck_id: null, trauben_kg: '400', rebsorte: 'Zweigelt', ernte_datum: '2024-09-30', kmw: null, weingarten: { id: 'w2', name: 'Ried Au' }, grundstueck: null }
  const pressung = { id: 'pb1', menge_liter: '700', pressung: { id: 'p1', datum: '2024-09-30', tenant_id: T, pressung_weingaerten: [pw1, pw2] } }
  // Maßnahmen je Lese (KAN-75): Zeitfenster und Zuordnung liefert ladeChargeKette (Kette.lesen)
  const lesen = [
    { leseId: 'pw1', lese: pw1, pressungDatum: '2024-09-30', hinweise: [],
      fenster: { von: '2024-01-01', bis: '2024-09-29', jahrgang: 2024, bisAus: 'lesedatum' },
      massnahmen: [{ behandlung: { id: 'b1', datum: '2024-09-12', art: 'spritzung', psm: { name: 'Cuprozin' } }, nurWeingarten: false, grundstuecke: ['1234/5'], flaecheHa: 0.5 }] },
    { leseId: 'pw2', lese: pw2, pressungDatum: '2024-09-30', hinweise: ['Lese ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens ab 01.01. des Jahrgangs aufgeführt.'],
      fenster: { von: '2024-01-01', bis: '2024-09-30', jahrgang: 2024, bisAus: 'lesedatum' },
      massnahmen: [
        { behandlung: { id: 'b2', datum: '2024-07-01', datum_bis: '2024-07-03', art: 'laubarbeit', psm: null }, nurWeingarten: false, grundstuecke: ['7/1', '7/2'], flaecheHa: null },
        { behandlung: { id: 'b3', datum: '2024-08-01', art: 'duengung', psm: null }, nurWeingarten: true, grundstuecke: [], flaecheHa: null },
      ] },
  ]
  const ketten = [
    { fuellung, zuordnung: 'fuellung_chargen', chargen: [
      { weinausbauId: 'c1', anteilLiter: 450, kette: { weinausbau: { name: 'ZW 2024', jahrgang: 2024 }, pressungen: [pressung], lesen, analysen: [], umzuege: [] } },
      { weinausbauId: 'c2', anteilLiter: 300, kette: { weinausbau: { name: 'BF Zukauf', jahrgang: 2024 }, pressungen: [], lesen: [], analysen: [], umzuege: [] } },
    ] },
    { fuellung: { id: 'f2', name: 'Alt-Füllung', jahrgang: 2019 }, zuordnung: 'keine', chargen: [] },
  ]

  test('Füllung × Ursprung: Anteile, GST/KG als Code, Maßnahmen je Lese mit Zeitfenster', () => {
    const [kopf, ...z] = zellen(csv.csvText(rueck.rueckverfolgungZeilen(ketten), rueck.SPALTEN_RUECKVERFOLGUNG))
    assert.equal(kopf.length, 27)
    assert.deepEqual(kopf.slice(22), ['Behandlungen ab', 'Behandlungen bis', 'Behandlungen (Anzahl)', 'Behandlungen (Datum Mittel)', 'Hinweis Behandlungen'])
    assert.equal(z.length, 4)
    const [a, b, c, d] = z
    assert.deepEqual(a.slice(0, 8), ['Cuvée Rot', 'L-26-02', '04023/26', '01.03.2026', '2024', 'Cuvée', '1000', '750'])
    assert.deepEqual(a.slice(8, 16), ['ZW 2024', '2024', '450,00', '60,0', 'Pressung', '30.09.2024', '700,00', 'Ried Hochrain'])
    assert.deepEqual(a.slice(16, 22), ['04023', '1234/5', 'Zweigelt', '600', '29.09.2024', '19,25'])   // °KMW verlustfrei (2 Stellen)
    // Fensterbeginn immer 01.01. des Jahrgangs (Spalte „Behandlungen ab“), kein Hinweis dazu
    assert.deepEqual(a.slice(22), ['01.01.2024', '29.09.2024', '1', '12.09.2024 Cuprozin', ''])
    assert.deepEqual([b[15], b[16], b[17]], ['Ried Au', '', ''])
    assert.deepEqual(b.slice(22), ['01.01.2024', '30.09.2024', '2', '01.07.2024–03.07.2024 Laubarbeit (GST 7/1, 7/2) | 01.08.2024 Düngung (am Weingarten erfasst)',
      'Lese ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens ab 01.01. des Jahrgangs aufgeführt.'])
    assert.deepEqual([c[8], c[11], c[12], c[13]], ['BF Zukauf', '40,0', 'ohne Pressung (Zukauf, Eröffnungsbestand oder Verschnitt – siehe Blend-Protokoll)', ''])
    assert.deepEqual([d[0], d[8], d[12]], ['Alt-Füllung', '', 'keine Kellerbuch-Charge verknüpft – Rückverfolgung nur bis zur Abfüllung'])
  })
  test('Trefferliste (Listen-CSV im Browser) über den Baustein', () => {
    const [kopf, a] = zellen(csv.csvText([{ name: '@Sekt', bezeichnung: null, jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaet: 'Sekt', chargennummer: '007', pruefnummer: null, flaschengroesse_ml: 750, bestand_flaschen: '12', aktiv: true }], rueck.SPALTEN_RUECKVERFOLGUNG_TREFFER))
    assert.equal(kopf[0], 'Produktname')
    assert.deepEqual(a, ["'@Sekt", '', '2025', 'Grüner Veltliner', 'GV', 'Sekt', '007', '', '750', '12', 'Ja'])
  })
  test('Parameter: ungültige Füllung → 400', async () => {
    assert.match((await ausfuehren('rueckverfolgung', 'fuellung_id=abc', attrappe({}))).parameterFehler, /Füllung/)
  })
})

// ── Blend-Protokoll ──────────────────────────────────────────────────────────

describe('blend-protokoll', () => {
  const kopf = { art: 'fuellung', id: 'f1', name: 'Cuvée Rot', jahrgang: 2024, rebsorte: null, qualitaet: null, pruefnummer: 'N 77/26', chargennummer: 'L-26-02', datum: '2026-03-01', anzahlFlaschen: 1000, flaschengroesseMl: 750, bezugLiter: 750 }
  const komp = [
    { key: 'a', typ: 'pressung', rebsorte: 'Zweigelt', jahrgang: 2024, weingarten_name: 'Ried Hochrain', gst_nr: '1234/5', katastralgemeinde: '04023', ernte_datum: '2024-09-29', kmw: 19.25, zukauf_von: null, anteil_pct: 66.7 },
    { key: 'b', typ: 'zukauf', rebsorte: 'Blaufränkisch', jahrgang: 2024, weingarten_name: null, gst_nr: null, katastralgemeinde: null, ernte_datum: '2024-10-02', kmw: null, zukauf_von: '+Weinhandel Huber', anteil_pct: 33.3 },
  ]
  test('eine Zeile je Herkunftsanteil, Menge anteilig aus der Bezugsmenge', () => {
    const [k, a, b] = zellen(csv.csvText(blend.blendZeilen(kopf, komp), blend.SPALTEN_BLEND))
    assert.equal(k.length, 18)
    assert.deepEqual(a, ['Füllung', 'Cuvée Rot', 'N 77/26', 'L-26-02', 'Ried Hochrain · GST 1234/5', 'Pressung', 'Zweigelt', 'ZW', '2024', 'Ried Hochrain', '04023', '1234/5', '29.09.2024', '19,25', '', '66,7', '750,00', '500,25'])
    assert.deepEqual([b[4], b[5], b[14], b[15], b[17]], ['Zukauf – +Weinhandel Huber', 'Zukauf', "'+Weinhandel Huber", '33,3', '249,75'])
  })
  test('Parameter: genau eine Füllung oder Charge', async () => {
    assert.match((await ausfuehren('blend-protokoll', '', attrappe({}))).parameterFehler, /genau eine/)
    assert.match((await ausfuehren('blend-protokoll', `fuellung=${C1}&charge=${C2}`, attrappe({}))).parameterFehler, /genau eine/)
    await assert.rejects(ausfuehren('blend-protokoll', `charge=${C2}`, attrappe({ weinausbau: [], dac_antrag: [] })), e => e.status === 404)
  })
})

// ── Keller-Auswertungen (Umzüge) ─────────────────────────────────────────────

describe('keller-auswertungen', () => {
  test('Umzüge im Zeitraum: Ziel aus dem Batch, Schwund, ohne 100er-Deckel', async () => {
    const umzuege = [
      { id: 'u1', tenant_id: T, datum: '2026-02-01', zeilen_typ: 'quelle', umzug_typ: 'umzug', umzug_batch_id: 'B1', menge_liter: '500', brutto_liter: '500', schwund_liter: '2.5', transaktions_nr: 'TXN-000123', notizen: null, von_behaelter_id: G1, nach_behaelter_id: null, von_weinausbau: { name: 'GV 2025' } },
      { id: 'u2', tenant_id: T, datum: '2026-02-01', zeilen_typ: 'ziel', umzug_typ: 'umzug', umzug_batch_id: 'B1', menge_liter: '497.5', nach_behaelter_id: G2, nach_behaelter: { name: 'Barrique 7' } },
      { id: 'u3', tenant_id: T, datum: '2026-03-01', zeilen_typ: null, umzug_typ: 'schwund', menge_liter: '3', brutto_liter: null, schwund_liter: '3', von_behaelter_id: G1, von_weinausbau: { name: 'GV 2025' } },
      { id: 'u4', tenant_id: T, datum: '2025-12-01', zeilen_typ: 'quelle', umzug_typ: 'filtration', menge_liter: '100', brutto_liter: '100', von_behaelter_id: G1 },
    ]
    for (let i = 0; i < 150; i++) umzuege.push({ id: `m${i}`, tenant_id: T, datum: '2026-05-05', zeilen_typ: 'quelle', umzug_typ: 'filtration', menge_liter: '1', brutto_liter: '1', von_behaelter_id: G2 })
    const sb = attrappe({ keller_umzuege: umzuege }, gebindeRpc(gebindeKeller))
    const r = await ausfuehren('keller-auswertungen', 'von=2026-01-01&bis=2026-12-31', sb)
    assert.equal(r.zeilen, 152)
    const [kopf, ...z] = r.tabelle
    assert.deepEqual(kopf, ['Datum', 'Art', 'Von Gebinde', 'Charge', 'Nach Gebinde', 'Brutto (l)', 'Schwund (l)', 'Transaktion', 'Notizen'])
    const um = z.find(c => c[7] === 'TXN-000123')
    assert.deepEqual(um, ['01.02.2026', 'Umzug', 'Tank 1', 'GV 2025', 'Barrique 7', '500,00', '2,50', 'TXN-000123', ''])
    const sw = z.find(c => c[1] === 'Schwund')
    assert.deepEqual(sw.slice(0, 7), ['01.03.2026', 'Schwund', 'Tank 1', 'GV 2025', '', '3,00', '3,00'])
    assert.equal(r.dateiname.utf8, 'Keller-Umzüge_1234567_2026-01-01_bis_2026-12-31_2026-09-24.csv')
  })

  test('umzug_typ „normal“ (Standard beim Umziehen) heißt „Umzug“, nicht „normal“', async () => {
    const sb = attrappe({ keller_umzuege: [{ id: 'n1', tenant_id: T, datum: '2026-02-02', zeilen_typ: 'quelle', umzug_typ: 'normal', menge_liter: '10', brutto_liter: '10', von_behaelter_id: G1 }] }, gebindeRpc(gebindeKeller))
    const r = await ausfuehren('keller-auswertungen', 'von=2026-01-01', sb)
    assert.equal(r.tabelle[1][1], 'Umzug')
  })
})

// ── Änderungsprotokoll ───────────────────────────────────────────────────────

describe('aenderungsprotokoll', () => {
  const U1 = 'b0000000-0000-4000-8000-000000000001'
  const U2 = 'b0000000-0000-4000-8000-000000000002'
  const daten = () => ({
    bestandsprotokoll: [
      { id: 7, tenant_id: T, tabelle: 'weinausbau', datensatz_id: C1, aktion: 'UPDATE', alt: { menge_liter: 900.5, aktiv: true }, neu: { menge_liter: 889.5, aktiv: false }, geaenderte_spalten: ['aktiv', 'menge_liter'], db_rolle: 'authenticated', benutzer_id: U1, erstellt_am: '2026-03-29T00:59:00+00:00' },
      { id: 8, tenant_id: T, tabelle: 'keller_behandlungen', datensatz_id: 'k9', aktion: 'DELETE', alt: { id: 'k9', tenant_id: T, datum: '2026-04-01', menge: 2, einheit: 'g', notizen: '=cmd', created_at: 'x' }, neu: null, geaenderte_spalten: null, db_rolle: 'authenticated', benutzer_id: U2, erstellt_am: '2026-04-01T10:00:00Z' },
      { id: 9, tenant_id: X, tabelle: 'weinausbau', datensatz_id: C2, aktion: 'DELETE', alt: {}, neu: null, db_rolle: 'service_role', benutzer_id: null, erstellt_am: '2026-04-02T10:00:00Z' },
    ],
    tenant_memberships: [{ tenant_id: T, user_id: U1, role: 'winzer' }],
  })

  test('nur Betriebs-Manager und Super-Admins (403 für Mitarbeiter)', async () => {
    await assert.rejects(ausfuehren('aenderungsprotokoll', '', attrappe(daten()), { tenantId: T, role: 'winzer', schreibmodule: [] }),
      e => e instanceof typen.MeldungsFehler && e.status === 403)
  })

  test('Zeilen: Zeitpunkt in Wien, alt → neu kompakt, Löschung, E-Mail nur für Mitglieder', async () => {
    const r = await aend.ladeAenderungsprotokoll(attrappe(daten()), T, { role: 'tenant_admin' }, { von: null, bis: null }, {
      emailsLaden: async ids => new Map(ids.map(id => [id, 'mitarbeiter@weingut.at'])),
    })
    const [kopf, a, b] = zellen(csv.csvText(r.zeilen, aend.SPALTEN_AENDERUNGSPROTOKOLL))
    assert.equal(r.zeilen.length, 2)   // fremder Mandant ausgefiltert
    assert.equal(kopf[8], 'Alt → Neu')
    assert.deepEqual(a.slice(0, 5), ['7', '29.03.2026 01:59', 'Charge', 'weinausbau', 'Änderung'])
    assert.deepEqual(a.slice(7), ['aktiv, menge_liter', 'aktiv: ja → nein | menge_liter: 900,5 → 889,5', 'App-Benutzer', 'Mitarbeiter', 'mitarbeiter@weingut.at', ''])   // Benutzer-ID nur ohne E-Mail
    assert.deepEqual(b.slice(1, 5), ['01.04.2026 12:00', 'Kellerbehandlung', 'keller_behandlungen', 'Löschung'])
    assert.equal(b[8], 'gelöscht: id=k9 | datum=01.04.2026 | menge=2 | einheit=g | notizen==cmd')
    assert.deepEqual(b.slice(10), ['', '', U2])
    assert.ok(r.warnungen.some(w => w.includes('nicht (mehr) Mitglied')))
  })

  test('Alt → Neu: Zeitpunkte in Wiener Zeit, Kalendertage als TT.MM.JJJJ', () => {
    assert.equal(aend.wertText('2026-09-24T22:30:00+00:00'), '25.09.2026 00:30')   // nicht der 24.09.
    assert.equal(aend.wertText('2026-01-15 23:30:00+00'), '16.01.2026 00:30')
    assert.equal(aend.wertText('2026-04-01'), '01.04.2026')
    assert.equal(aend.wertText('2026-04-01 Notiz'), '2026-04-01 Notiz')
    assert.equal(aend.aenderungText('UPDATE', { storniert_am: null }, { storniert_am: '2026-09-24T22:30:00+00:00' }, ['storniert_am']), 'storniert_am: leer → 25.09.2026 00:30')
  })

  test('Zeitraum als Wiener Kalendertage (timestamptz-Filter)', async () => {
    const sb = attrappe(daten())
    await aend.ladeAenderungsprotokoll(sb, T, { role: 'system_admin' }, { von: '2026-03-29', bis: '2026-03-31' }, { emailsLaden: async () => new Map() })
    const f = sb.log.find(l => l.tabelle === 'bestandsprotokoll').filter
    assert.deepEqual(f.filter(x => x[1] === 'erstellt_am'), [['gte', 'erstellt_am', '2026-03-28T23:00:00.000Z'], ['lt', 'erstellt_am', '2026-03-31T22:00:00.000Z']])
  })
})
