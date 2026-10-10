// KAN-45 (10.10.2026): Rest von AP8 nach KAN-107/KAN-41 – Art des Stoffs (kellermittel.art), BKI-Blatt „Besondere Konten“
// im Format der Spezifikation (je Buchung, Anfangsstand, Empfangscharge mit Sorte/Stufe/JG) und die KTM/RTK-Bestände
// zur Bestandsmeldung (§ 29 Abs. 3 WG, nachrichtlich).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import * as sk from '../../src/lib/kellerbuch/stoffkonto.ts'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()
const bk = hooksMoeglich ? await laden('lib/behoerden/besondereKonten.ts') : null
const reg = hooksMoeglich ? await laden('lib/behoerden/register.ts') : null
const bs = hooksMoeglich ? await laden('lib/behoerden/bki-schnittstelle.ts') : null
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Migration: eingespielt (supabase/migrations) oder noch Entwurf (supabase/entwurf, nicht eingecheckt) */
function migration() {
  const f = readdirSync(new URL('../../supabase/migrations/', import.meta.url)).find(n => /_kan45_kellermittel_art\.sql$/.test(n))
  if (f) return quelle(`supabase/migrations/${f}`)
  const e = new URL('../../supabase/entwurf/kan45_kellermittel_art.sql', import.meta.url)
  return existsSync(e) ? readFileSync(e, 'utf8') : null
}

describe('Art des Stoffs', () => {
  test('Wertebereich der App = CHECK der Migration; Konzentrate = KTM und RTK', (t) => {
    const m = migration()
    if (!m) { t.skip('Migration weder eingespielt noch als Entwurf vorhanden'); return }
    const check = /CHECK \(art IN \(([^)]*)\)\)/.exec(m)[1].split(',').map(x => x.trim().replace(/'/g, ''))
    assert.deepEqual(check, sk.STOFF_ARTEN.map(a => a.value))
    assert.deepEqual([...sk.KONZENTRAT_ARTEN].sort(), ['ktm', 'rtk_fluessig', 'rtk_pulver'])
  })

  test('Vorschlag aus Name und Einheit (wie die Migration)', () => {
    assert.deepEqual([
      ['RTK', 'l'], ['RTK Pulver', 'kg'], ['Rektifiziertes Traubenmostkonzentrat', 'l'], ['KTM', 'l'], ['Saccharose', 'kg'],
      ['Weinsäure', 'kg'], ['Kaliumhydrogencarbonat', 'kg'], ['Entsäuerungskalk', 'kg'], ['Bentonit', 'kg'],
    ].map(([n, e]) => sk.stoffArtVorschlag(n, e)),
    ['rtk_fluessig', 'rtk_pulver', 'rtk_fluessig', 'ktm', 'zucker', 'saeuerungsmittel', 'entsaeuerungsmittel', 'entsaeuerungsmittel', 'sonstiges'])
  })
})

describe('BKI-Blatt „Besondere Konten“', () => {
  const stoff = { name: 'Saccharose', art: 'zucker', einheit: 'kg' }
  const B = [
    { id: '1', datum: '2026-07-20', art: 'anfangsbestand', menge: 100, erstellt_am: 'a' },
    { id: '2', datum: '2026-08-05', art: 'zugang', menge: 50, beleg: '4711', lieferant: 'Lager', los: 'L1', erstellt_am: 'b' },
    { id: '3', datum: '2026-09-10', art: 'verwendung', menge: -30, zweck: 'Anreicherung', charge: 'GV Kirchberg', chargeNr: '2026/07', sorte: 'Grüner Veltliner', qualitaet: 'QUW', jahrgang: 2026, erstellt_am: 'c' },
    { id: '4', datum: '2026-09-11', art: 'zugang', menge: 999, erstellt_am: 'd' },
    { id: '5', datum: '2026-09-12', art: 'storno', menge: -999, storno_von_id: '4', erstellt_am: 'e' },
  ]

  test('Zeitraum, Anfangsstand je Buchung, Stornos fallen samt Gegenbuchung weg (B1)', () => {
    const z = sk.bkiKontoZeilen(stoff, B, { von: '2026-08-01', bis: '2026-09-30' })
    assert.deepEqual(z.map(x => [x.datum, x.buchungsart, x.anfangsstand, x.menge]), [
      ['2026-08-05', 'Zugang', 100, 50],
      ['2026-09-10', 'Verwendung (Anreicherung)', 150, -30],
    ])
    assert.deepEqual([z[0].beleg, z[0].los, z[0].art, z[0].empfangscharge], ['4711', 'L1', 'Zucker', null])
    assert.deepEqual([z[1].empfangscharge, z[1].sorte, z[1].qualitaet, z[1].jahrgang, z[1].weinBezeichnung], ['2026/07', 'Grüner Veltliner', 'QUW', 2026, 'GV Kirchberg'])
    assert.equal(sk.bkiKontoZeilen(stoff, B, { von: null, bis: null }).length, 3)
  })

  test('Meldung im Register, Spalten laut Spezifikation, Blatt der Gesamtdatei', nurMitHooks, () => {
    const m = reg.meldungFinden('bki-besondere-konten')
    assert.deepEqual(m.spalten.map(s => s.kopf), ['Datum', 'BelegNr.', 'Buchungsart', 'Bezeichnung', 'Art', 'Los-Nr', 'Anfangsstand', 'Menge', 'Einheit', 'Empfangscharge', 'Sorte', 'Qualitätsstufe', 'JG', 'Bezeichnung Wein'])
    assert.deepEqual(m.spalten.filter(s => s.typ === 'dezimal').map(s => s.stellen), [3, 3])
    assert.equal(bs.BKI_BLAETTER.find(b => b.blatt === 'Besondere Konten').meldung, 'bki-besondere-konten')
    assert.equal(bs.parameterFuer('bki-besondere-konten', { von: '2026-08-01', bis: '2026-09-30', stichtag: '2026-09-30' }).toString(), 'von=2026-08-01&bis=2026-09-30')
  })

  test('Laden: nur der eigene Betrieb, Hinweis bei Stoff ohne Art', nurMitHooks, async () => {
    const d = datenbank({
      kellermittel: [{ id: 'k1', tenant_id: 't1', name: 'Saccharose', einheit: 'kg', aktiv: true, art: 'sonstiges' }, { id: 'kx', tenant_id: 't2', name: 'Fremd', einheit: 'kg', aktiv: true, art: 'zucker' }],
      kellermittel_buchungen: [
        { id: 'b1', tenant_id: 't1', kellermittel_id: 'k1', datum: '2026-08-02', art: 'zugang', menge: 10, erstellt_am: '1' },
        { id: 'b2', tenant_id: 't2', kellermittel_id: 'kx', datum: '2026-08-02', art: 'zugang', menge: 10, erstellt_am: '1' },
      ],
    })
    const r = await bk.ladeBkiBesondereKonten(d, 't1', { von: '2026-08-01', bis: '2026-08-31' })
    assert.deepEqual(r.zeilen.map(z => [z.stoff, z.menge]), [['Saccharose', 10]])
    assert.match(r.warnungen[0], /Stoff ohne Art .*Saccharose/)
  })
})

describe('Verdrahtung', () => {
  test('Anlegen verlangt die Art, Art änderbar, Seite mit BKI-CSV, BSM mit KTM/RTK-Beständen', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/besondere-konten/actions.ts')
    assert.match(a, /if \(!istStoffArt\(art\)\) throw new AktionsFehler\('Bitte die Art des Stoffs wählen/)
    assert.match(a, /insert\(\{ tenant_id: tenantId, name, einheit, art,/)
    assert.match(a, /export async function stoffArtSetzen\(id: string, art: string\)[\s\S]{0,400}\.eq\('tenant_id', tenantId\)\.select\('id'\)/)
    const p = quelle('src/app/(dashboard)/kellerbuch/besondere-konten/page.tsx')
    assert.match(p, /^\/\/ behoerdenmeldung: besondere-konten, bki-besondere-konten\n/)
    assert.match(p, /csvPfad\('bki-besondere-konten'/)
    assert.match(quelle('src/app/(dashboard)/reports/(pflicht)/bestandsmeldung-bsm/page.tsx'), /ladeKonzentratBestaende\(supabase, tenantId, p\.bis\)/)
    assert.ok(JSON.parse(quelle('scripts/schema.json')).kellermittel.includes('art'))
  })
})
