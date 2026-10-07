// Sweep 5 (07.10.2026) – KAN-169 Maßnahmen nach der Lese der Ried gesperrt, KAN-222 „Mit Grund korrigieren“ für Füllung,
// Kellerbehandlung, Charge und Maßnahme.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 57 (Trigger a_freeze_ernte, Korrektur durch die Betriebsleitung).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan169_massnahmen_freeze_ernte.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan169_massnahmen_freeze_ernte.sql')
}

describe('KAN-169: sperrende Lese', nurMitHooks, () => {
  test('Lese am oder nach dem Maßnahmendatum an einer Ried der Maßnahme sperrt; die früheste zählt', async () => {
    const { sperrendeLese } = await laden('lib/behandlungen/ernteSperre.ts')
    const lesen = [{ ried: 'A', datum: '2026-09-20' }, { ried: 'A', datum: '2026-09-25' }, { ried: 'B', datum: '2026-10-01' }]
    assert.equal(sperrendeLese({ id: '1', datum: '2026-07-01', rieden: ['A'] }, lesen), '2026-09-20')
    assert.equal(sperrendeLese({ id: '1', datum: '2026-09-20', rieden: ['A'] }, lesen), '2026-09-20')   // am Lesetag
    assert.equal(sperrendeLese({ id: '1', datum: '2026-09-21', rieden: ['A'] }, lesen), '2026-09-25')
    assert.equal(sperrendeLese({ id: '1', datum: '2026-09-26', rieden: ['A'] }, lesen), null)            // nach der Lese
    assert.equal(sperrendeLese({ id: '1', datum: '2026-07-01', rieden: ['C'] }, lesen), null)            // andere Ried
    assert.equal(sperrendeLese({ id: '1', datum: '2026-07-01', rieden: ['C', 'B'] }, lesen), '2026-10-01')   // über ein Grundstück
    assert.equal(sperrendeLese({ id: '1', datum: null, rieden: ['A'] }, lesen), null)
  })
  test('Lader: Lesen ohne Stornierte, mandantengefiltert über den Jahrgang, Fehler statt Teilmenge', () => {
    const s = quelle('src/lib/behandlungen/ernteSperre.ts')
    assert.equal((s.match(/\.is\('storniert_am', null\)/g) ?? []).length, 2)
    assert.equal((s.match(/\.eq\('jahrgang\.tenant_id', tenantId\)/g) ?? []).length, 2)
    assert.equal((s.match(/throw new Error/g) ?? []).length, 3)
  })
  test('Trigger: dieselbe Regel wie die App (Ried direkt oder über das Grundstück, Lesedatum ≥ Maßnahme)', () => {
    const m = migration()
    assert.match(m, /ep\.storniert_am IS NULL/)
    assert.match(m, /ep\.ernte_datum >= p_datum/)
    assert.match(m, /coalesce\(ep\.weingarten_id, eg\.weingarten_id\)/)
    assert.match(m, /CREATE TRIGGER a_freeze_ernte BEFORE UPDATE OR DELETE ON public\.behandlungen/)
    assert.match(m, /'notizen,updated_at'/)
    assert.match(m, /CREATE TRIGGER a_freeze_ernte BEFORE UPDATE OR DELETE ON public\.behandlung_grundstuecke/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_massnahme_geerntet\(uuid, uuid, date\) FROM PUBLIC, anon, authenticated/)
    const { MASSNAHME_ERNTE_GRUND } = { MASSNAHME_ERNTE_GRUND: 'Ried nach der Maßnahme geerntet' }
    assert.ok(m.includes(`'${MASSNAHME_ERNTE_GRUND}'`))
    assert.ok(quelle('src/lib/behandlungen/ernteSperre.ts').includes(`MASSNAHME_ERNTE_GRUND = '${MASSNAHME_ERNTE_GRUND}'`))
  })
})

describe('KAN-222: Korrekturfelder je Tabelle', nurMitHooks, () => {
  const heute = '2026-10-07'
  test('jede Tabelle mit Pfaden zum Neuladen', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    for (const t of ['dac_antrag', 'fuellungen', 'keller_behandlungen', 'weinausbau', 'behandlungen']) {
      assert.ok(k.KORREKTUR_FELDER[t]?.length > 0, t)
      assert.ok(k.KORREKTUR_PFADE[t]?.length > 0, t)
    }
  })
  test('Füllung: Datum, Los, Jahrgang, Rebsorte – nicht Anzahl und Flaschengröße', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    const spalten = k.KORREKTUR_FELDER.fuellungen.map(f => f.spalte)
    assert.deepEqual(spalten, ['datum', 'chargennummer', 'jahrgang', 'rebsorte'])
    const alt = { datum: '2026-09-01', chargennummer: 'L-1', jahrgang: 2025, rebsorte: 'Zweigelt' }
    assert.deepEqual(k.korrekturAenderungen('fuellungen', alt, { datum: '2026-09-02', jahrgang: '2025' }, heute), { werte: { datum: '2026-09-02' } })
    assert.match(k.korrekturAenderungen('fuellungen', alt, { datum: '' }, heute).fehler, /Abfülldatum darf nicht leer sein/)
    assert.match(k.korrekturAenderungen('fuellungen', alt, { datum: '2026-12-01' }, heute).fehler, /in der Zukunft/)
    assert.deepEqual(k.korrekturAenderungen('fuellungen', alt, { anzahl_flaschen: '600' }, heute), { fehler: 'Keine Änderung – bitte mindestens einen Wert ändern.' })
  })
  test('Kellerbehandlung: Datum, Menge, Einheit – nicht der Typ', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    assert.deepEqual(k.KORREKTUR_FELDER.keller_behandlungen.map(f => f.spalte), ['datum', 'menge', 'einheit'])
    assert.deepEqual(k.korrekturAenderungen('keller_behandlungen', { datum: '2026-09-01', menge: 20, einheit: 'g/hl' }, { menge: '25,5' }, heute),
      { werte: { menge: 25.5 } })
    assert.match(k.korrekturAenderungen('keller_behandlungen', { menge: 20 }, { menge: 'viel' }, heute).fehler, /Menge: bitte eine Zahl/)
  })
  test('Charge: Jahrgang, Rebsorte, Weinart – Qualität/Herkunft nur über Abstufen', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    const spalten = k.KORREKTUR_FELDER.weinausbau.map(f => f.spalte)
    assert.deepEqual(spalten, ['jahrgang', 'rebsorte', 'weinart'])
    for (const nicht of ['qualitaetsstufe', 'zusatzbezeichnung', 'herkunft_code', 'menge_liter']) assert.ok(!spalten.includes(nicht), nicht)
    assert.deepEqual(k.korrekturAenderungen('weinausbau', { weinart: 'weiss' }, { weinart: 'rot' }, heute), { werte: { weinart: 'rot' } })
    assert.match(k.korrekturAenderungen('weinausbau', { weinart: 'weiss' }, { weinart: 'blau' }, heute).fehler, /Weinart: ungültiger Wert/)
  })
  test('Maßnahme: Datum und Mengen – nicht Ried, Mittel, Grundstücke', async () => {
    const k = await laden('lib/freeze/korrektur.ts')
    const spalten = k.KORREKTUR_FELDER.behandlungen.map(f => f.spalte)
    for (const nicht of ['weingarten_id', 'psm_id', 'duengemittel_id', 'art', 'storniert_am']) assert.ok(!spalten.includes(nicht), nicht)
    assert.deepEqual(k.korrekturAenderungen('behandlungen', { datum: '2026-06-01', aufwandmenge: 2 }, { datum: '2026-06-01', aufwandmenge: '2,5' }, heute),
      { werte: { aufwandmenge: 2.5 } })
  })
})

describe('Sweep 5: Verdrahtung', () => {
  test('Maßnahmen: Liste ohne Bearbeiten/Storno, Bearbeiten zeigt Hinweis und Korrektur, Actions mit Sperrmeldung', () => {
    const p = quelle(`${D}/behandlungen/page.tsx`)
    assert.match(p, /ladeErnteSperren\(supabase, tenantId, behandlungenRoh\.filter\(b => !b\.storniert_am\)/)
    const c = quelle(`${D}/behandlungen/BehandlungenClient.tsx`)
    assert.match(c, /\{b\.ernte_gesperrt \? \(/)
    const e = quelle(`${D}/behandlungen/[id]/edit/page.tsx`)
    assert.match(e, /if \(ernteGesperrt\) \{/)
    assert.match(e, /<FreezeKorrektur tabelle="behandlungen"/)
    assert.match(e, /betriebsleitung && \(/)
    const a = quelle(`${D}/behandlungen/actions.ts`)
    assert.equal((a.match(/massnahmeFehler\(error, '/g) ?? []).length, 2)
  })
  test('Korrektur-Baustein nur für die Betriebsleitung: Füllung, Kellerbehandlung, Charge', () => {
    const f = quelle(`${D}/weinhandel/fuellungen/[id]/edit/page.tsx`)
    assert.match(f, /membership && canAdmin\(membership\.role\) && !f\.storniert_am && \(/)
    assert.match(f, /<FreezeKorrektur tabelle="fuellungen"/)
    // außerhalb des Formulars (kein verschachteltes <form>)
    assert.ok(f.indexOf('<FreezeKorrektur') > f.indexOf('</FuellungEditFormular>'))
    const kb = quelle(`${D}/kellerbuch/behaelter/[id]/behandlungen/page.tsx`)
    assert.match(kb, /korrekturErlaubt\(\)\.then\(setBetriebsleitung\)/)
    assert.match(kb, /betriebsleitung && editId && /)
    assert.ok(kb.indexOf('<FreezeKorrektur') < kb.indexOf('<form onSubmit={handleSubmit}'))
    const ch = quelle(`${D}/kellerbuch/weinausbau/[id]/page.tsx`)
    assert.match(ch, /pnSperre === 'eingereicht' && role && canAdmin\(role\) && \(/)
    const ak = quelle(`${D}/freeze-korrektur-actions.ts`)
    assert.match(ak, /export async function korrekturErlaubt\(\): Promise<boolean> \{[\s\S]{0,200}seitenBetriebFehler[\s\S]{0,120}schreibSperreFehler\(membership\)[\s\S]{0,120}return canAdmin\(membership\.role\)/)
  })
})
