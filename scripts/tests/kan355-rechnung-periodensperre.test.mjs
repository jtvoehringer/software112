// KAN-355 (23.10.2026, UAT Musterhof) – Rechnung RE-0039 entstand mit Rechnungsdatum 16.03.2026, obwohl 01/2025–08/2026
// abgeschlossen und die UVA 2026 Q1 übermittelt war (Verkauf mit „Rechnung sofort“). Jetzt sperrt die Datenbank das
// Rechnungsdatum wie Zahlungen (Entwurf supabase/entwurf/kan355_rechnung_periodensperre.sql, DB-Test 82), und die App prüft
// vorab: createVerkauf (Rechnung sofort), rechnungErstellen (Lieferschein, Sammelrechnung), Traubenverkauf – Ablehnungen als
// { error } am Formular, Hinweis auf den ersten offenen Tag im Datumsfeld.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'
import * as sperre from '../../src/lib/verkauf/rechnungsdatumSperre.ts'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()

const quelle = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const verkauf = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/verkauf/actions.ts') : null
const rd = hooksMoeglich ? await laden('lib/verkauf/rechnungsdatum.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const LS = '00000000-0000-4000-8000-0000000000c1'
const GRUND = 'Monat 3/2026 ist bereits abgeschlossen.'
const DB_SPERRE = 'Rechnung mit Datum 16.03.2026 nicht möglich: Monat 3/2026 ist bereits abgeschlossen. Bitte ein Rechnungsdatum im offenen Zeitraum wählen.'
const fd = (f = {}) => { const d = new FormData(); for (const [k, w] of Object.entries(f)) d.set(k, w); return d }

/** Musterhof wie im Befund: 01/2025–08/2026 abgeschlossen, UVA 2026 Q1 und Q2 übermittelt */
const abschluesse = () => [...Array(20)].map((_, i) => ({ tenant_id: T, jahr: 2025 + Math.floor(i / 12), monat: (i % 12) + 1 }))
const uvas = () => [{ tenant_id: T, jahr: 2026, zeitraum: 'Q1', gesperrt: true }, { tenant_id: T, jahr: 2026, zeitraum: 'Q2', gesperrt: true },
  { tenant_id: T, jahr: 2026, zeitraum: 'Q3', gesperrt: false }]

/** Fake: pruefe_ea_zeitraum_offen nach den Tabellen, s112_rechnung_erstellen optional mit Fehler */
function db({ offen = null, pruefFehler = null, erstellenFehler = null } = {}) {
  const d = datenbank({ ea_monatsabschluss: abschluesse(), ea_uva: uvas(), verkaufsposten: [] }, {
    rpc: (name, args) => {
      if (name === 'pruefe_ea_zeitraum_offen') {
        if (pruefFehler) return { data: null, error: pruefFehler }
        const zu = offen ?? (args.p_datum < '2026-09-01')
        return { data: [{ offen: !zu, grund: zu ? GRUND : null }], error: null }
      }
      if (name === 's112_rechnung_erstellen') return erstellenFehler ? { data: null, error: erstellenFehler } : { data: 'neue-rechnung', error: null }
      return { data: null, error: { message: `rpc ${name} nicht nachgebildet` } }
    },
  })
  globalThis.__serverFake = d
  return d
}
const rpcs = d => d.aufrufe.filter(a => a.art === 'rpc').map(a => a.tabelle)

beforeEach(() => { globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: null } })

describe('KAN-355: Regeln für das Rechnungsdatum (rein)', () => {
  test('gesperrte Monate aus Monatsabschluss und gesperrter UVA (Quartal und Monat), offene UVA zählt nicht', () => {
    const s = sperre.gesperrteMonate([{ jahr: 2026, monat: 8 }, { jahr: '2025', monat: '12' }],
      [{ jahr: 2026, zeitraum: 'Q1', gesperrt: true }, { jahr: 2026, zeitraum: '05' }, { jahr: 2026, zeitraum: 'Q3', gesperrt: false }])
    assert.deepEqual([...s].sort(), ['2025-12', '2026-01', '2026-02', '2026-03', '2026-05', '2026-08'])
  })
  test('erster offener Tag: Erster nach dem letzten gesperrten Monat vor heute', () => {
    const s = sperre.gesperrteMonate(abschluesse(), uvas())
    assert.equal(sperre.ersterOffenerTag('2026-10-23', s), '2026-09-01')
    assert.equal(sperre.ersterOffenerTag('2026-09-01', s), '2026-09-01')
    assert.equal(sperre.ersterOffenerTag('2026-08-15', s), null, 'heute selbst gesperrt → kein Hinweis')
    assert.equal(sperre.ersterOffenerTag('2026-10-23', new Set()), null, 'nichts gesperrt → kein Hinweis')
    assert.equal(sperre.ersterOffenerTag('2027-01-10', new Set(['2026-11'])), '2026-12-01', 'über den Jahreswechsel')
  })
  test('Meldung wie die Datenbank, mit erstem offenen Tag und Hinweis „Rechnung später“', () => {
    assert.equal(sperre.rechnungsdatumMeldung('2026-03-16', GRUND, null),
      'Rechnung mit Datum 16.03.2026 nicht möglich: Monat 3/2026 ist bereits abgeschlossen. Bitte ein Rechnungsdatum im offenen Zeitraum wählen.')
    const m = sperre.rechnungsdatumMeldung('2026-03-16', 'Zeitraum wurde bereits per UVA übermittelt', '2026-09-01', true)
    assert.match(m, /^Rechnung mit Datum 16\.03\.2026 nicht möglich: Zeitraum wurde bereits per UVA übermittelt\. Bitte ein Rechnungsdatum ab 01\.09\.2026 wählen/)
    assert.match(m, /„Rechnung später“/)
  })
  test('vortag und frühestes Datum (ohne Zeitzonenversatz)', () => {
    assert.equal(sperre.vortag('2026-09-01'), '2026-08-31')
    assert.equal(sperre.vortag('2027-01-01'), '2026-12-31')
    assert.equal(sperre.fruehestesDatum('2026-03-16', '2026-09-01'), '2026-09-01')
    assert.equal(sperre.fruehestesDatum('2026-10-02', '2026-09-01'), '2026-10-02')
    assert.equal(sperre.fruehestesDatum('', null), undefined)
  })
})

describe('KAN-355: rechnungsdatumFehler (Vorabprüfung über pruefe_ea_zeitraum_offen)', nurMitHooks, () => {
  test('gesperrt → Meldung mit erstem offenen Tag', async () => {
    const d = db()
    const m = await rd.rechnungsdatumFehler(d, T, '2026-03-16', '2026-10-23')
    assert.match(m, /^Rechnung mit Datum 16\.03\.2026 nicht möglich: Monat 3\/2026 ist bereits abgeschlossen\. Bitte ein Rechnungsdatum ab 01\.09\.2026 wählen/)
    assert.ok(d.aufrufe.some(a => a.tabelle === 'ea_monatsabschluss' && a.filter.some(f => f[0] === 'eq' && f[1] === 'tenant_id' && f[2] === T)))
  })
  test('offen → null, ohne die Abschlüsse zu laden', async () => {
    const d = db()
    assert.equal(await rd.rechnungsdatumFehler(d, T, '2026-10-01', '2026-10-23'), null)
    assert.deepEqual(d.aufrufe.map(a => a.tabelle), ['rpc:pruefe_ea_zeitraum_offen'])
  })
  test('Fehler der Prüfung → Meldung statt still „offen“ (KAN-253)', async () => {
    const m = await rd.rechnungsdatumFehler(db({ pruefFehler: { code: 'XX000', message: 'Verbindung weg' } }), T, '2026-10-01', '2026-10-23')
    assert.match(m, /Buchungszeitraum konnte nicht geprüft werden/)
  })
  test('ungültiges Datum → Meldung ohne Datenbank', async () => {
    const d = db()
    assert.match(await rd.rechnungsdatumFehler(d, T, '16.03.2026', '2026-10-23'), /gültiges Rechnungsdatum/)
    assert.equal(d.aufrufe.length, 0)
  })
  test('ersterOffenerRechnungstag: Lesefehler wird geworfen (KAN-254)', async () => {
    const d = datenbank({ ea_monatsabschluss: [], ea_uva: [] }, { vorher: e => (e.tabelle === 'ea_uva' ? { error: { message: 'kaputt' } } : null) })
    await assert.rejects(() => rd.ersterOffenerRechnungstag(d, T, '2026-10-23'), /UVA-Zeiträume konnten nicht geladen werden/)
  })
})

describe('KAN-355: Rechnung erstellen (Lieferschein, Sammelrechnung) gibt { error } zurück', nurMitHooks, () => {
  test('Rechnungsdatum im abgeschlossenen Monat → { error } vor der RPC', async () => {
    const d = db()
    const r = await verkauf.rechnungErstellen([LS], fd({ rechnungsdatum: '2026-03-16' }))
    assert.match(r.error, /^Rechnung mit Datum 16\.03\.2026 nicht möglich/)
    assert.ok(!rpcs(d).includes('rpc:s112_rechnung_erstellen'), 'keine Rechnungsnummer gezogen')
  })
  test('Ablehnung der Datenbank (42501 Periodensperre, Wettlauf) → { error } mit ihrer Meldung', async () => {
    db({ offen: false, erstellenFehler: { code: '42501', message: DB_SPERRE, hint: 'periodensperre' } })
    assert.deepEqual(await verkauf.rechnungErstellen([LS], fd({ rechnungsdatum: '2026-10-20' })), { error: DB_SPERRE })
  })
  test('Prüfregel der RPC (22023) → { error }; offen → { rechnungId }; unerwarteter Fehler wird geworfen', async () => {
    db({ offen: false, erstellenFehler: { code: '22023', message: 'Das Rechnungsdatum liegt vor dem Lieferdatum (20.10.2026).' } })
    assert.deepEqual(await verkauf.rechnungErstellen([LS], fd({ rechnungsdatum: '2026-10-19' })), { error: 'Das Rechnungsdatum liegt vor dem Lieferdatum (20.10.2026).' })
    db({ offen: false })
    assert.deepEqual(await verkauf.rechnungErstellen([LS], fd({ rechnungsdatum: '2026-10-20' })), { rechnungId: 'neue-rechnung' })
    db({ offen: false, erstellenFehler: { code: 'XX000', message: 'interner Fehler' } })
    await assert.rejects(() => verkauf.rechnungErstellen([LS], fd({ rechnungsdatum: '2026-10-20' })), /interner Fehler/)
  })
  test('Eingabefehler → { error } statt Wurf', async () => {
    db()
    assert.match((await verkauf.rechnungErstellen([], fd({ rechnungsdatum: '2026-10-20' }))).error, /mindestens einen Lieferschein/)
    assert.match((await verkauf.rechnungErstellen([LS], fd({ rechnungsdatum: '' }))).error, /gültiges Rechnungsdatum/)
  })
})

describe('KAN-355: Verkauf mit „Rechnung sofort“ im abgeschlossenen Zeitraum (Befund RE-0039)', nurMitHooks, () => {
  test('→ { error } mit Hinweis auf „Rechnung später“, vor jeder Abbuchung und jedem Beleg', async () => {
    const d = db()
    const r = await verkauf.createVerkauf(fd({ datum: '2026-03-16', rechnung_sofort: 'true', positionen_json: '[{"typ":"sonstiges","name":"x","menge":1}]' }))
    assert.match(r.error, /^Rechnung mit Datum 16\.03\.2026 nicht möglich: Monat 3\/2026 ist bereits abgeschlossen\. Bitte ein Rechnungsdatum ab 01\.09\.2026 wählen/)
    assert.match(r.error, /„Rechnung später“/)
    assert.deepEqual(d.aufrufe.filter(a => a.art !== 'select').map(a => a.tabelle), ['rpc:pruefe_ea_zeitraum_offen'])
  })
  test('„Rechnung später“: Lieferschein im abgeschlossenen Monat bleibt möglich (keine Zeitraumprüfung)', async () => {
    const d = db()
    await assert.rejects(() => verkauf.createVerkauf(fd({ datum: '2026-03-16', rechnung_sofort: 'false', positionen_json: '[]' })), /Mindestens eine Position/)
    assert.ok(!rpcs(d).includes('rpc:pruefe_ea_zeitraum_offen'))
  })
})

describe('KAN-355: Formulare und weitere Wege (statisch)', () => {
  test('RechnungErstellenPanel und Sammelrechnung werten { error } aus, Datumsfeld mit erstem offenen Tag', () => {
    for (const rel of ['src/app/(dashboard)/weinhandel/verkauf/[id]/RechnungErstellenPanel.tsx', 'src/app/(dashboard)/weinhandel/sammelrechnung/SammelrechnungClient.tsx']) {
      const c = quelle(rel)
      assert.match(c, /Promise<\{ rechnungId: string \} \| \{ error: string \}>/, rel)
      assert.match(c, /if \('error' in r\) \{\s*setFehler\(r\.error\)\s*return/, rel)
      assert.match(c, /min=\{(minDatum|fruehestesDatum\(spaetestes, offenAb\))\}/, rel)
      assert.match(c, /Rechnungsdatum frühestens \{datumAt\(offenAb\)\}/, rel)
    }
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx'), /offenAb=\{rechnungOffenAb\}/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/sammelrechnung/page.tsx'), /offenAb=\{offenAb\}/)
  })
  test('Neuer Verkauf zeigt { error } am Formular', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx'),
      /const r = await createVerkauf\(formData\)\n[^\n]*\n\s*if \('error' in r\) \{\s*setError\(r\.error\)\s*return/)
  })
  test('Traubenverkauf (Weinhandel und Erntemeldung) prüft das Rechnungsdatum vor dem ersten Schreiben', () => {
    const tv = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
    const neu = tv.indexOf("rechnungsdatumFehler(supabase, tenantId, datum, heuteWien())")
    assert.ok(neu > 0 && neu < tv.indexOf("'get_next_liefernummer'"), 'Neuanlage: vor Liefernummer und Insert')
    assert.match(tv, /if \(!altPostenId \|\| altDatum !== datum\)/)
    assert.ok(tv.indexOf('altDatum !== datum') < tv.indexOf(".update(payload)"), 'Bearbeiten: vor dem Update')
    const em = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const i = em.indexOf('rechnungsdatumFehler(supabase, tenantId, datum, heuteWien())')
    assert.ok(i > 0 && i < em.indexOf("'get_next_liefernummer'", i - 2000), 'createTraubenverkauf: vor Liefernummer')
  })
})

describe('KAN-355: Datenbank – Entwurf bzw. Migration und DB-Test 82', () => {
  const mig = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan355_rechnung_periodensperre.sql'))
  const pfad = mig ? `supabase/migrations/${mig}` : 'supabase/entwurf/kan355_rechnung_periodensperre.sql'
  const da = existsSync(new URL(`../../${pfad}`, import.meta.url))
  test('Trigger an rechnungen und verkauf_positionen, Wartung ausgenommen, Konventionen', { skip: da ? false : 'Entwurf nur lokal (supabase/entwurf ist nicht eingecheckt)' }, () => {
    const s = quelle(pfad)
    assert.match(s, /CREATE TRIGGER a_ea_periodensperre BEFORE INSERT OR UPDATE OF datum, tenant_id OR DELETE ON public\.rechnungen/)
    assert.match(s, /CREATE TRIGGER a_rechnung_periodensperre\s+BEFORE INSERT OR UPDATE OF menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz, verkaufsposten_id OR DELETE\s+ON public\.verkauf_positionen/)
    assert.equal((s.match(/IF public\.s112_wartung_frei\(/g) ?? []).length, 2)
    assert.equal((s.match(/public\.s112_ea_zeitraum_sperrgrund\(/g) ?? []).length, 5)
    for (const fn of ['s112_rechnung_periodensperre', 's112_rechnung_positionen_periodensperre']) {
      assert.match(s, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated;`))
    }
    assert.equal((s.match(/SET search_path = public/g) ?? []).length, 2)
    // Muster zusammengesetzt, damit check-replica diese Testdatei nicht selbst meldet
    assert.doesNotMatch(s.replace(/--.*$/gm, ''), new RegExp('session_' + 'replication_role|DISABLE ' + 'TRIGGER'))
    assert.match(s, /'Rechnung mit Datum % nicht möglich: % Bitte ein Rechnungsdatum im offenen Zeitraum wählen\.'/)
  })
  test('DB-Test 82 und Einstufung der Triggerfunktionen in _helfer.sql', () => {
    const t = quelle('scripts/db-tests/82_rechnung_periodensperre.sql')
    assert.match(t, /c_datei constant text := '82_rechnung_periodensperre'/)
    for (const n of ['sofort_abgeschlossen', 'sofort_uva', 'erstellen_gesperrt', 'datum_in_gesperrt_spiegel', 'pos_preis_gesperrt', 'storno_rechnung_gesperrt_ok', 'storno_verkauf_gesperrt_ok', 'lieferschein_ohne_rechnung_frei']) {
      assert.match(t, new RegExp(`'${n}'`), n)
    }
    const h = quelle('scripts/db-tests/_helfer.sql')
    assert.match(h, /\('trigger', +'--S', false, 's112_rechnung_periodensperre\(\)'\)/)
    assert.match(h, /\('trigger', +'--S', false, 's112_rechnung_positionen_periodensperre\(\)'\)/)
  })
})
