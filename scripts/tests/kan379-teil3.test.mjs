// KAN-379 Teil 3 (27.10.2026) – Stornobeleg in der App: Storno-Datum im Dialog (vorbelegt heute, nicht vor dem
// Beleg-/Rechnungsdatum, nicht in der Zukunft, Ablehnung der Datenbank am Feld), Rückbuchung des Bestands am Storno-Datum,
// Stornobeleg als PDF „Stornorechnung“ und Versand, Nummernkreis Stornobeleg in der Mandantenverwaltung.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'
import { stornoDatumFehler, istStornoDatumAblehnung } from '../../src/lib/storno/datum.ts'
import { stornobelegPdfInhalt } from '../../src/lib/verkauf/stornobelegPdf.ts'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()

const quelle = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const verkauf = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/verkauf/actions.ts') : null
const bestand = hooksMoeglich ? await laden('lib/verkauf/bestand.ts') : null
const { heuteWien } = hooksMoeglich ? await laden('lib/datum/wien.ts') : { heuteWien: () => '' }

const T = '00000000-0000-4000-8000-000000000001'
const RE = '00000000-0000-4000-8000-0000000000e1'
const VP = '00000000-0000-4000-8000-0000000000c1'

describe('KAN-379: Storno-Datum (stornoDatumFehler)', () => {
  const g = { heute: '2026-10-27', ab: '2026-10-10' }
  test('Pflicht, Format, Zukunft, vor dem Belegdatum', () => {
    assert.equal(stornoDatumFehler('', g), 'Bitte das Storno-Datum angeben.')
    assert.equal(stornoDatumFehler(null, g), 'Bitte das Storno-Datum angeben.')
    assert.equal(stornoDatumFehler('27.10.2026', g), 'Das Storno-Datum ist ungültig.')
    assert.equal(stornoDatumFehler('2026-10-28', g), 'Das Storno-Datum (28.10.2026) liegt in der Zukunft.')
    assert.equal(stornoDatumFehler('2026-10-09', g), 'Das Storno-Datum (09.10.2026) liegt vor dem Belegdatum (10.10.2026).')
  })
  test('Grenzen selbst gültig; ohne Untergrenze nur heute/Zukunft', () => {
    assert.equal(stornoDatumFehler('2026-10-27', g), null)
    assert.equal(stornoDatumFehler('2026-10-10', g), null)
    assert.equal(stornoDatumFehler('2020-01-01', { heute: '2026-10-27' }), null)
    assert.equal(stornoDatumFehler('2026-10-15', { heute: '2026-10-27', ab: '2026-10-10T12:00:00Z' }), null)
  })
  test('Ablehnung der Datenbank zum Datum: HINT storno_datum und periodensperre', () => {
    assert.equal(istStornoDatumAblehnung('storno_datum'), true)
    assert.equal(istStornoDatumAblehnung('periodensperre'), true)
    assert.equal(istStornoDatumAblehnung('rechnung_zahlungen'), false)
    assert.equal(istStornoDatumAblehnung(undefined), false)
  })
})

describe('KAN-379: Stornobeleg als PDF (stornobelegPdfInhalt)', () => {
  const pos = (n, ls, menge, preis, extra = {}) => ({ lieferscheinnummer: ls, lieferdatum: '2026-10-01', typ: 'flasche', name: n, menge,
    einheit: 'Fl.', preis_brutto: preis, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 13, ...extra })
  const beleg = (positionen) => ({
    id: 'st', art: 'storno', rechnungsnummer: 'ST-2026-0001', datum: '2026-10-27', notizen: 'Preis falsch verrechnet',
    storno_von: { id: 're', rechnungsnummer: 'RE-0050', datum: '2026-10-20', storno_positionen: positionen },
  })
  test('Positionen des Originals mit negativer Menge und negativen Beträgen, Bezug und Grund', () => {
    const i = stornobelegPdfInhalt(beleg([pos('Grüner Veltliner', 'LS-1', 6, 11.3), pos('Zweigelt', 'LS-1', 2, 10, { rabatt_pct: 10 })]))
    assert.equal(i.nummer, 'ST-2026-0001')
    assert.equal(i.datumIso, '2026-10-27')
    assert.deepEqual(i.storno, { zuNummer: 'RE-0050', zuDatumIso: '2026-10-20', grund: 'Preis falsch verrechnet' })
    assert.deepEqual(i.positionen.map(p => p.menge), [-6, -2])
    assert.ok(Math.abs(i.positionen[0].summe - -67.8) < 1e-9)
    assert.ok(Math.abs(i.positionen[1].summe - -18) < 1e-9)
    assert.equal(i.positionen[1].rabattPct, 10)
    assert.ok(Math.abs(i.gesamt - -85.8) < 1e-9)
    assert.ok(Math.abs(i.gesamtNetto - -85.8 / 1.13) < 1e-9)
    assert.deepEqual(Object.keys(i.ustGruppen), ['13'])
    assert.ok(i.ustGruppen['13'] < 0)
    assert.deepEqual(i.positionen.map(p => p.abschnitt), [null, null], 'ein Lieferschein: keine Zwischenzeile')
  })
  test('Sammelrechnung: Zwischenzeile je Lieferschein; Tankposition gekennzeichnet; Position ohne Preis ohne Betrag', () => {
    const i = stornobelegPdfInhalt(beleg([pos('A', 'LS-1', 1, 5), pos('B', 'LS-2', 100, null, { typ: 'tank', einheit: 'L' })]))
    assert.deepEqual(i.positionen.map(p => p.abschnitt), ['Lieferschein LS-1 vom 01.10.2026', 'Lieferschein LS-2 vom 01.10.2026'])
    assert.equal(i.positionen[1].sub, 'Tankverkauf')
    assert.equal(i.positionen[1].summe, null)
    assert.equal(i.gesamt, -5)
  })
  test('nur für Stornobelege', () => {
    assert.throws(() => stornobelegPdfInhalt({ art: 'rechnung' }), /Kein Stornobeleg/)
    assert.throws(() => stornobelegPdfInhalt({ art: 'storno', storno_von: null }), /ohne Rechnung/)
  })
  test('PDF-Layout: Titel, Bezug, Stornobetrag, Grund, kein Zahlungsteil und kein Skonto', () => {
    const s = quelle('src/lib/pdf/verkaufRechnungPdf.tsx')
    assert.match(s, /\{storno \? 'STORNORECHNUNG' : 'RECHNUNG'\}/)
    assert.match(s, /zu Rechnung \{storno\.zuNummer\} vom \{fmtDate\(storno\.zuDatumIso\)\}/)
    assert.match(s, /\{storno \? 'Stornobetrag' : 'Rechnungsbetrag'\}/)
    assert.match(s, /Grund: \{storno\.grund\}/)
    assert.match(s, /const skonto = storno \? null : props\.skonto/)
    assert.match(s, /\{!storno && \(\n\s+<Text style=\{styles\.metaText\}>\n\s+\{bank\.zahlungszielTage === 0/)
  })
})

describe('KAN-379: Versand des Stornobelegs', () => {
  test('eigene Route nur für Stornobelege, Prüfungen vor dem Versand, gemeinsamer Mail-Helfer', () => {
    const r = quelle('src/app/api/weinhandel/rechnungen/[id]/send/route.ts')
    assert.match(r, /const zweiFaktor = await pruefeZweiFaktor\(\)\n\s+if \(zweiFaktor\) return zweiFaktor/)
    assert.match(r, /seitenBetriebKonflikt\(membership\.tenantId, 'error'\)/)
    assert.match(r, /schreibSperreKonflikt\(membership\)/)
    assert.match(r, /canWrite\(membership, 'warenwirtschaft'\)/)
    assert.match(r, /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)/)
    assert.match(r, /if \(\(roh as R\)\.art !== 'storno'\)/)
    assert.match(r, /storno: inhalt\.storno,/)
    assert.match(r, /belegPerMailSenden\(\{/)
    const v = quelle('src/app/api/weinhandel/verkauf/[id]/send/route.ts')
    assert.match(v, /belegPerMailSenden\(\{/)
    assert.doesNotMatch(v, /nodemailer|getValidUserAccessToken/, 'Mailversand nur noch im Helfer')
    const h = quelle('src/lib/email/belegVersand.ts')
    assert.match(h, /\.eq\('tenant_id', tenantId\)\.eq\('user_id', userId\)\.maybeSingle\(\)/)
    assert.match(h, /if \(userCfgErr\) return \{ ok: false, status: 500/)
  })
  test('Stornobeleg-Seite bietet den Versand über die eigene Route an', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(p, /\{storno && membership && canWrite\(membership, 'warenwirtschaft'\) && \(/)
    assert.match(p, /pfad=\{`\/api\/weinhandel\/rechnungen\/\$\{r\.id\}\/send`\} titel="Stornorechnung"/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/RechnungVersandPanel.tsx'), /fetch\(pfad \?\? `\/api\/weinhandel\/verkauf\/\$\{verkaufId\}\/send`/)
  })
})

describe('KAN-379: Nummernkreis Stornobeleg (Mandantenverwaltung)', () => {
  test('Präfix und Stellen speichern in den DB-Grenzen, Vorschau mit Jahr', () => {
    const a = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
    assert.match(a, /storno_prefix:    sPrefix,\n\s+storno_stellen:   sStellen,/)
    assert.match(a, /Math\.max\(3, Math\.min\(8, parseInt\(dezimal\(formData\.get\('storno_stellen'\)/)
    assert.match(a, /replace\(\/\[\^A-Za-z0-9\]\/g, ''\)\.slice\(0, 8\)\.toUpperCase\(\)\n\s+return p \|\| 'ST'/)
    const c = quelle('src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx')
    assert.match(c, /name="storno_prefix"/)
    assert.match(c, /name="storno_stellen"/)
    assert.match(c, /Nächster Stornobeleg/)
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/[id]/page.tsx'), /storno_prefix:     s\?\.storno_prefix \?\? 'ST',/)
  })
})

describe('KAN-379: Storno-Datum im Dialog (statisch)', () => {
  test('StornoButton: Pflichtfeld vorbelegt mit heute, min/max, Fehler am Feld, feld: datum aus der Action', () => {
    const s = quelle('src/components/StornoButton.tsx')
    assert.match(s, /useState\(stornoDatum\?\.heute \?\? ''\)/)
    assert.match(s, /min=\{stornoDatum\.ab\?\.slice\(0, 10\) \|\| undefined\} max=\{stornoDatum\.heute\}/)
    assert.match(s, /stornoDatumFehler\(sDatum, stornoDatum\)/)
    assert.match(s, /if \(r\.feld === 'datum' && stornoDatum\) setDatumFehler\(r\.error\)/)
    assert.match(s, /aria-describedby=\{datumFehler \? `\$\{id\}-df` : undefined\}/)
  })
  test('Verkaufsseite: Datum für Rechnungsstorno und Verkauf samt Rechnung (ab Rechnungsdatum), Verkaufsstorno nur ohne Rechnung', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(p, /const stornoDatumVerkauf = berechnet \? undefined : \{ heute, ab: String\(posten\.datum \?\? ''\) \|\| null \}/)
    assert.match(p, /const stornoDatumRechnung = \{ heute, ab: rechnung\?\.datum \? String\(rechnung\.datum\) : null \}/)
    assert.match(p, /<RechnungStornoKnopf action=\{rechnungStornoAction\} stornoDatum=\{stornoDatumRechnung\} \/>/)
    assert.match(p, /<VerkaufSamtRechnungStornoKnopf action=\{samtStornoAction\} stornoDatum=\{stornoDatumRechnung\} \/>/)
    assert.match(p, /stornoDatum=\{stornoDatumVerkauf\} \/>/)
    assert.match(p, /entsteht ein Stornobeleg \(ST-…\) mit heutigem Datum/)
    for (const k of ['RechnungStornoKnopf', 'VerkaufSamtRechnungStornoKnopf']) {
      const s = quelle(`src/app/(dashboard)/weinhandel/verkauf/[id]/${k}.tsx`)
      assert.match(s, /Stornobeleg \(ST-…\)/, k)
      assert.doesNotMatch(s, /bleibt mit ihrer Nummer als storniert erhalten/, k)
    }
  })
})

function db({ fehler = null, posten = {} } = {}) {
  const d = datenbank({
    rechnungen: [{ id: RE, tenant_id: T, rechnungsnummer: 'RE-0050', datum: '2026-10-20', storniert: false, aktiv: true }],
    verkaufsposten: [{ id: VP, tenant_id: T, rechnung_id: RE, rechnungsnummer: 'RE-0050', storniert: false, datum: '2026-10-20', ...posten }],
  }, {
    rpc: (name) => {
      if (name === 's112_rechnung_stornieren') return fehler ? { data: null, error: fehler } : { data: 'st', error: null }
      if (name === 's112_verkauf_samt_rechnung_stornieren') return fehler ? { data: null, error: fehler } : { data: { rechnungsnummer: 'RE-0050' }, error: null }
      return { data: null, error: { message: `rpc ${name} nicht nachgebildet` } }
    },
  })
  globalThis.__serverFake = d
  globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
  return d
}
const rpcWerte = (d, name) => d.aufrufe.filter(a => a.tabelle === `rpc:${name}`).map(a => a.werte)

describe('KAN-379: Server Actions reichen das Storno-Datum durch', nurMitHooks, () => {
  test('rechnungStornieren: p_datum an die RPC; ohne Datum wie bisher (Standard der Datenbank: heute)', async () => {
    let d = db()
    assert.equal(await verkauf.rechnungStornieren(RE, VP, 'Preis falsch verrechnet', '2026-10-21'), undefined)
    assert.equal(rpcWerte(d, 's112_rechnung_stornieren')[0].p_datum, '2026-10-21')
    d = db()
    await verkauf.rechnungStornieren(RE, VP, 'Preis falsch verrechnet')
    assert.equal('p_datum' in rpcWerte(d, 's112_rechnung_stornieren')[0], false)
  })
  test('ungültiges Datum → Fehler am Feld, ohne RPC-Aufruf', async () => {
    const d = db()
    assert.deepEqual(await verkauf.rechnungStornieren(RE, VP, 'Preis falsch verrechnet', '2999-01-01'),
      { error: 'Das Storno-Datum (01.01.2999) liegt in der Zukunft.', feld: 'datum' })
    assert.deepEqual(rpcWerte(d, 's112_rechnung_stornieren'), [])
  })
  test('Ablehnung der Datenbank zum Datum (HINT storno_datum) → am Feld; andere Ablehnungen am Formular', async () => {
    const M = 'Das Storno-Datum (19.10.2026) liegt vor dem Rechnungsdatum der Rechnung RE-0050 (20.10.2026).'
    db({ fehler: { code: '23514', message: M, hint: 'storno_datum' } })
    assert.deepEqual(await verkauf.rechnungStornieren(RE, VP, 'Preis falsch verrechnet', '2026-10-19'), { error: M, feld: 'datum' })
    const Z = 'Zur Rechnung RE-0050 gibt es Zahlungen – bitte zuerst die Zahlungen stornieren.'
    db({ fehler: { code: '22023', message: Z, hint: 'rechnung_zahlungen' } })
    assert.deepEqual(await verkauf.rechnungStornieren(RE, VP, 'Preis falsch verrechnet', '2026-10-21'), { error: Z })
  })
  test('verkaufSamtRechnungStornieren: p_datum an die RPC, Datumsablehnung am Feld', async () => {
    const d = db()
    assert.equal(await verkauf.verkaufSamtRechnungStornieren(VP, 'Kunde hat storniert', '2026-10-22'), undefined)
    assert.equal(rpcWerte(d, 's112_verkauf_samt_rechnung_stornieren')[0].p_datum, '2026-10-22')
    const M = 'Storno mit Datum 22.10.2026 nicht möglich: Monat 10/2026 ist bereits abgeschlossen. Bitte ein Storno-Datum im offenen Zeitraum wählen.'
    db({ fehler: { code: '42501', message: M, hint: 'periodensperre' } })
    assert.deepEqual(await verkauf.verkaufSamtRechnungStornieren(VP, 'Kunde hat storniert', '2026-10-22'), { error: M, feld: 'datum' })
  })
})

describe('KAN-379: Rückbuchung beim Verkaufsstorno am Storno-Datum (stornoTagFuerVerkauf)', nurMitHooks, () => {
  const heute = '2026-10-27'
  test('ohne Rechnung: gewähltes Datum; leer oder heute → heute', () => {
    const p = { datum: '2026-10-01', rechnung_id: null }
    assert.equal(bestand.stornoTagFuerVerkauf(p, '2026-10-15', heute), '2026-10-15')
    assert.equal(bestand.stornoTagFuerVerkauf(p, null, heute), heute)
    assert.equal(bestand.stornoTagFuerVerkauf(p, heute, heute), heute)
  })
  test('nicht vor dem Lieferdatum, nicht in der Zukunft', () => {
    const p = { datum: '2026-10-01', rechnung_id: null }
    assert.throws(() => bestand.stornoTagFuerVerkauf(p, '2026-09-30', heute), /liegt vor dem Belegdatum \(01\.10\.2026\)/)
    assert.throws(() => bestand.stornoTagFuerVerkauf(p, '2026-10-28', heute), /liegt in der Zukunft/)
  })
  test('mit 1:1-Rechnung nur heute (Stornobeleg legt die Datenbank mit heutigem Datum an)', () => {
    const p = { datum: '2026-10-01', rechnung_id: RE, rechnungsnummer: 'RE-0050' }
    assert.throws(() => bestand.stornoTagFuerVerkauf(p, '2026-10-15', heute), /Rechnung RE-0050 – ihr Stornobeleg entsteht mit heutigem Datum/)
    assert.equal(bestand.stornoTagFuerVerkauf(p, heute, heute), heute)
  })
  test('verkaufspostenStornieren bucht am Storno-Datum zurück (nicht mehr fest heute)', () => {
    const s = quelle('src/lib/verkauf/bestand.ts')
    assert.match(s, /const stornoTag = stornoTagFuerVerkauf\(posten, opt\.datum \?\? null, heuteWien\(\)\)/)
    assert.match(s, /\{ postenId, datum: stornoTag, grund: stornoGrund \}/)
    assert.match(s, /\.select\('id, rechnungsnummer, storniert, rechnung_id, datum'\)/)
  })
  test('stornoVerkauf: ungültiges Datum → Fehler am Feld, vor jeder Buchung', async () => {
    const d = db({ posten: { rechnung_id: null, rechnungsnummer: null } })
    const r = await verkauf.stornoVerkauf(VP, 'Kunde hat storniert', null, 'gestern')
    assert.deepEqual(r, { error: 'Das Storno-Datum ist ungültig.', feld: 'datum' })
    assert.deepEqual(d.aufrufe.filter(a => a.art !== 'select'), [])
    assert.equal(typeof heuteWien(), 'string')
  })
})

// KAN-379 Nachtrag (UAT 28.10.2026): Storno-Wege am Verkauf beschriftet, Storno-Datum hervorgehoben, nach dem Storno
// Hinweis mit Links auf Rechnung und Stornobeleg (die Verbindung steht nur noch in der Momentaufnahme)
describe('KAN-379 Nachtrag: Storno am Verkauf auffindbar', () => {
  const q = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const ordner = 'src/app/(dashboard)/weinhandel/verkauf/[id]/'
  test('die drei Storno-Knöpfe am Verkauf zeigen ihre Beschriftung', () => {
    for (const k of ['RechnungStornoKnopf', 'VerkaufSamtRechnungStornoKnopf', 'StornoKnopf']) {
      assert.match(q(`${ordner}${k}.tsx`), /<StornoButton\n\s+mitText\n/, k)
    }
    const b = q('src/components/StornoButton.tsx')
    assert.match(b, /\{mitText && <span>\{text\}<\/span>\}/)
    assert.match(b, /bg-s112-warn-bg[^"]*">\n\s+Storno-Datum <span/)
  })
  test('Verkauf lädt stornierte Rechnungen über die Momentaufnahme und verlinkt den Stornobeleg', () => {
    const s = q(`${ordner}page.tsx`)
    // Hotfix 28.10.2026: JSON-Text statt Array – supabase-js machte aus dem Array {[object Object]} → 22P02 auf JEDER
    // Verkaufsseite; Einbettung über die Spalte (verwiesene Zeile), nicht rechnungen!… (Gegenrichtung)
    assert.match(s, /\.filter\('storno_positionen', 'cs', JSON\.stringify\(\[\{ lieferschein_id: id \}\]\)\)/)
    assert.doesNotMatch(s, /\.contains\('storno_positionen'/)
    assert.match(s, /storniert_durch:storniert_durch_id\(id, rechnungsnummer, datum\)/)
    assert.match(s, /durch Stornobeleg <Link href=\{`\/weinhandel\/rechnungen\/\$\{st\.id\}`\}/)
  })
})
