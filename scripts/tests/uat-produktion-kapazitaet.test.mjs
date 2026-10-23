// UAT-Befund 23.10.2026 (Musterhof): Produktion „sektpaultest“ (Schaumwein) – 1.100 l aus „Grüner Veltliner Zukauf“ in
// „Barrique 3“ (225 l) ohne Warnung angenommen; die Herkunftskarte meldete „Journal 1.100,00 l · Mischungsrechnung
// 0,00 l“, und im Journal (Übersicht → Journal) war nicht zu sehen, woher die Charge kam.
//  1. Fassungsvermögen des Ziel-Gebindes (produktionFehler/gebindeFehler – Formular und Server Action)
//  2. Mischungsrechnung und Abgleich kennen die Produktion (Lader blendKomposition, zugaengeLautRechnung)
//  3. Journal: Produktion mit Bezeichnung, Bereich, Link; Charge zeigt „aus Produktion …“
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gebindeFehler, produktionFehler } from '../../src/lib/kellerbuch/produktion.ts'
import { verdichteHerkunft, zugaengeLautRechnung, vergleicheHerkunft } from '../../src/lib/kellerbuch/herkunft.ts'
import { zusammensetzung } from '../../src/lib/wein/mischungsrechnung.ts'
import { hooksRegistrieren, laden, nurMitHooks, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const basis = { art: 'schaumwein', name: 'sektpaultest', behaelterId: 'barrique-3', datum: '2026-10-23', heute: '2026-10-23', zutaten: [] }
const gv = { weinausbauId: 'gv-zukauf', menge: 1100, bestand: 1100, weinart: 'weiss', name: 'Grüner Veltliner Zukauf' }
const barrique = { name: 'Barrique 3', volumen: 225 }

describe('1. Fassungsvermögen des Ziel-Gebindes', () => {
  test('Befund: 1.100 l passen nicht in „Barrique 3“ (225 l) – Gesamtprüfung und Schritt 3', () => {
    const erwartet = 'Die neue Charge (1.100 l) passt nicht in „Barrique 3“ (Fassungsvermögen 225 l).'
    assert.ok(produktionFehler({ ...basis, wein: [gv], gebinde: barrique }).includes(erwartet))
    assert.deepEqual(produktionFehler({ ...basis, wein: [gv], gebinde: barrique }, 3), [erwartet])
    assert.deepEqual(produktionFehler({ ...basis, wein: [gv], gebinde: barrique }, 2), [])
  })
  test('Zielmenge zählt mit Zutaten (Wasser), genau voll geht, Volumen unbekannt sperrt nicht', () => {
    const spritzer = { ...basis, art: 'spritzer', wein: [{ ...gv, menge: 150 }], zutaten: [{ art: 'wasser', menge: 80, einheit: 'l' }] }
    assert.match(gebindeFehler(230, barrique), /\(230 l\) passt nicht in „Barrique 3“/)
    assert.ok(produktionFehler({ ...spritzer, gebinde: barrique }).some(f => /230 l/.test(f)))
    assert.deepEqual(produktionFehler({ ...spritzer, zutaten: [{ art: 'wasser', menge: 75, einheit: 'l' }], gebinde: barrique }), [])
    assert.equal(gebindeFehler(1100, { name: 'Tank', volumen: null }), null)
    assert.equal(gebindeFehler(1100, { name: 'Tank', volumen: 0 }), null)
    assert.equal(gebindeFehler(1100, null), null)
    assert.equal(gebindeFehler(1100.5, { name: 'Tank 1', volumen: 1100 }), 'Die neue Charge (1.100,5 l) passt nicht in „Tank 1“ (Fassungsvermögen 1.100 l).')
  })
  test('Formular und Server Action nutzen dieselbe Prüfung mit dem Gebinde (Server: Tenant-Filter, Fehler ausgewertet)', () => {
    const form = quelle('src/app/(dashboard)/kellerbuch/produktion/ProduktionForm.tsx')
    assert.match(form, /gebinde: zielGebinde \? \{ name: zielGebinde\.name, volumen: zielGebinde\.volumen \} : null/)
    assert.match(form, /produktionFehler\(eingabe, schritt\)/)
    assert.match(form, /produktionFehler\(eingabe\)/)
    const a = quelle('src/app/(dashboard)/kellerbuch/produktion/actions.ts')
    assert.match(a, /from\('behaelter'\) as any\)\s*\n\s*\.select\('id, name, volumen_liter'\)\.eq\('tenant_id', tenantId\)\.eq\('id', e\.behaelterId\)\.maybeSingle\(\)/)
    assert.match(a, /if \(bErr\) throw new AktionsFehler/)
    assert.match(a, /datum: e\.datum, heute: wienHeute\(\), wein, zutaten: e\.zutaten, gebinde \}\)/)
  })
})

// ── 2. Mischungsrechnung ─────────────────────────────────────────────────────────────────────────────────────
const T = 'tenant-1'
const GV = 'gv-zukauf', SEKT = 'sektpaultest', SPR = 'spritzer-2026'
const produktion = (id, ziel, eingaenge, teil = {}) => ({
  id, tenant_id: T, datum: '2026-10-23', erstellt_am: '2026-10-23T10:00:00Z', ziel_weinausbau_id: ziel, gebucht: true, storniert_am: null,
  wein_liter: eingaenge.filter(e => e.art === 'wein').reduce((s, e) => s + e.menge, 0),
  ziel_menge: eingaenge.filter(e => ['wein', 'wasser', 'saft', 'aroma'].includes(e.art)).reduce((s, e) => s + e.menge, 0),
  eingaenge, ...teil,
})
function db({ storniert = false } = {}) {
  const pSekt = produktion('pd-sekt', SEKT, [{ id: 'e1', art: 'wein', weinausbau_id: GV, menge: 1100 }, { id: 'e2', art: 'zucker', weinausbau_id: null, menge: 24 }],
    storniert ? { storniert_am: '2026-10-23T12:00:00Z' } : {})
  const pSpr = produktion('pd-spr', SPR, [{ id: 'e3', art: 'wein', weinausbau_id: GV, menge: 300 }, { id: 'e4', art: 'wasser', weinausbau_id: null, menge: 200 }])
  const alle = [pSekt, pSpr]
  return datenbank({
    weinausbau: [
      { id: GV, tenant_id: T, name: 'Grüner Veltliner Zukauf', rebsorte: 'Grüner Veltliner', jahrgang: 2026, menge_liter: storniert ? 1100 : 0, ist_eroeffnungsbestand: false, created_at: '2026-10-01T08:00:00Z' },
      { id: SEKT, tenant_id: T, name: 'sektpaultest', rebsorte: null, jahrgang: 2026, menge_liter: storniert ? 0 : 1100, ist_eroeffnungsbestand: false, created_at: '2026-10-23T10:00:00Z' },
      { id: SPR, tenant_id: T, name: 'Spritzer', rebsorte: null, jahrgang: 2026, menge_liter: 500, ist_eroeffnungsbestand: false, created_at: '2026-10-23T10:00:00Z' },
    ],
    zukauf_posten: [{ id: 'zk-1', tenant_id: T, datum: '2026-10-01', erstellt_am: '2026-10-01T08:00:00Z', menge: 1400, rebsorte: 'Grüner Veltliner', jahrgang: 2026,
      ziel_weinausbau_id: GV, aktiv: true, art: 'wein', lieferant_firma: { name: 'Weinbau Huber' }, lieferant_kontakt: null }],
    produktionen: alle,
    produktion_eingaenge: alle.flatMap(p => p.eingaenge.filter(e => e.art === 'wein').map(e => ({ id: e.id, tenant_id: T, art: 'wein', weinausbau_id: e.weinausbau_id, produktion: p }))),
  })
}
// Zeilen der Sicht charge_herkunft (Journal) zur Produktion: ZU_PROD je Quelle, Zusatzvolumen als Wurzel ohne Quelle
const zeile = (beleg, nach, von, liter) => ({ beleg_nr: beleg, datum: '2026-10-23', art: 'ZU_PROD', nach_weinausbau_id: nach, nach_fuellung_id: null, von_weinausbau_id: von, liter, gegenbuchung: false })

describe('2. Mischungsrechnung kennt die Produktion', nurMitHooks, () => {
  test('Befund: Abgleich ohne Abweichung (Journal 1.100 l = Mischungsrechnung 1.100 l), Herkunft = Zukauf', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    const g = await b.ladeBewegungsgraph(db(), T, [SEKT])
    assert.ok(g.chargen.has(GV), 'Quell-Charge gehört zum Graphen')
    const r = zugaengeLautRechnung(g.ereignisse, SEKT, '2026-10-01')
    assert.deepEqual([...r], [[GV, 1100]])
    assert.deepEqual(vergleicheHerkunft(verdichteHerkunft([zeile(1, SEKT, GV, 1100)], SEKT).vorgaenger, r), [])
    const z = zusammensetzung(g.ereignisse, SEKT, { gebuchterBestand: 1100 })
    assert.deepEqual(z.anteile.map(a => [a.typ, a.zukauf_von, a.anteil_pct, a.liter]), [['zukauf', 'Weinbau Huber', 100, 1100]])
    assert.deepEqual(z.warnungen, [])
  })
  test('Spritzer mit Wasser: Abgleich nur über den Wein (300 l), Zusatz verdünnt, Bestand = Zielmenge ohne Warnung', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    const g = await b.ladeBewegungsgraph(db(), T, [SPR])
    const r = zugaengeLautRechnung(g.ereignisse, SPR, '2026-10-01')
    assert.deepEqual([...r], [[GV, 300]])
    const journal = [zeile(2, SPR, GV, 300), zeile(2, SPR, null, 200)]
    assert.deepEqual(vergleicheHerkunft(verdichteHerkunft(journal, SPR).vorgaenger, r), [])
    const z = zusammensetzung(g.ereignisse, SPR, { gebuchterBestand: 500 })
    assert.deepEqual(z.anteile.map(a => [a.rebsorte, a.anteil_pct, a.liter]), [['Grüner Veltliner', 100, 500]])
    assert.deepEqual(z.warnungen, [])
  })
  test('Quelle sieht beide Produktionen als Abgang; stornierte Produktion zählt nicht', async () => {
    const b = await laden('lib/wein/blendKomposition.ts')
    const g = await b.ladeBewegungsgraph(db(), T, [GV])
    assert.deepEqual(g.ereignisse.filter(e => e.id.startsWith('pd:')).map(e => e.id).sort(), ['pd:pd-sekt', 'pd:pd-spr'])
    assert.deepEqual(zusammensetzung(g.ereignisse, GV, { gebuchterBestand: 0 }).anteile, [])
    const s = await b.ladeBewegungsgraph(db({ storniert: true }), T, [GV])
    assert.deepEqual(s.ereignisse.filter(e => e.id.startsWith('pd:')).map(e => e.id), ['pd:pd-spr'])
    const ziel = await b.ladeBewegungsgraph(db({ storniert: true }), T, [SEKT])
    assert.deepEqual([...zugaengeLautRechnung(ziel.ereignisse, SEKT, '2026-10-01')], [])
  })
})

describe('2b. Abgleich ohne Lader (reiner Kern)', () => {
  test('Umzug mit Schwund bleibt unverändert, Produktion verteilt höchstens die Quell-Liter', () => {
    const e = [
      { art: 'uebertrag', id: 'ku:1', datum: '2026-10-02', erfasst: null, grund: 'umzug', quellen: [{ charge: 'A', liter: 310 }], ziele: [{ charge: 'C', liter: 300 }] },
      { art: 'uebertrag', id: 'pd:1', datum: '2026-10-03', erfasst: null, grund: 'produktion', quellen: [{ charge: 'A', liter: 60 }, { charge: 'B', liter: 40 }], ziele: [{ charge: 'C', liter: 150 }] },
    ]
    assert.deepEqual([...zugaengeLautRechnung(e, 'C', '2026-10-01')], [['A', 360], ['B', 40]])
  })
})

describe('3. Journal (Übersicht)', () => {
  const j = () => laden('lib/journal/journal.ts')
  test('Produktion: Bezeichnung, Bereich Kellerbuch, Link zur erzeugten Charge, Beschreibung mit Art und Menge', nurMitHooks, async () => {
    const { TABELLE_LABEL, bereichDerTabelle, journalLink, beschreibung, JOURNAL_NACHLADEN } = await j()
    assert.equal(TABELLE_LABEL.produktionen, 'Produktion')
    assert.equal(bereichDerTabelle('produktionen').key, 'kellerbuch')
    assert.equal(bereichDerTabelle('produktion_eingaenge').key, 'kellerbuch')
    assert.equal(journalLink('produktionen', 'p1', 'anlage', { ziel_weinausbau_id: SEKT }), `/kellerbuch/weinausbau/${SEKT}`)
    assert.equal(journalLink('produktion_eingaenge', 'e1', 'anlage', { weinausbau_id: GV, produktion: { ziel_weinausbau_id: SEKT } }), `/kellerbuch/weinausbau/${SEKT}`)
    assert.equal(journalLink('produktionen', 'p1', 'loeschung', { ziel_weinausbau_id: SEKT }), null)
    assert.equal(beschreibung({ datum: '2026-10-23' }, null, null, { art: 'schaumwein', ziel_menge: 1100 }), 'Schaumwein / Sekt · 23.10.2026 · 1.100 L')
    assert.equal(JOURNAL_NACHLADEN.produktion_eingaenge.mandant, 'produktion.tenant_id')
    assert.match(JOURNAL_NACHLADEN.produktion_eingaenge.spalten, /!inner\(tenant_id/)
  })
  test('Befund: neue Charge zeigt „aus Produktion Schaumwein / Sekt (1.100 L)“', nurMitHooks, async () => {
    const { journalZeilen, chargenFuerProduktionHerkunft, produktionHerkunftText } = await j()
    const roh = [
      { id: 1, tabelle: 'weinausbau', datensatz_id: SEKT, aktion: 'INSERT', kennung: { name: 'sektpaultest', menge_liter: 0 }, erstellt_am: '2026-10-23T10:00:00Z' },
      { id: 2, tabelle: 'weinausbau', datensatz_id: SEKT, aktion: 'UPDATE', geaenderte_spalten: ['menge_liter'], kennung: { name: 'sektpaultest', menge_liter: 1100 }, erstellt_am: '2026-10-23T10:00:00Z' },
      { id: 3, tabelle: 'weinausbau', datensatz_id: 'weg', aktion: 'DELETE', kennung: null, erstellt_am: '2026-10-23T10:00:00Z' },
    ]
    assert.deepEqual(chargenFuerProduktionHerkunft(roh), [SEKT])
    const daten = new Map([['weinausbau', new Map([[SEKT, { id: SEKT, produktion: [{ art: 'schaumwein', ziel_menge: 1100, storniert_am: null }] }]])]])
    const z = journalZeilen(roh, new Map(), daten)
    assert.equal(z[0].beschreibung, 'sektpaultest · aus Produktion Schaumwein / Sekt (1.100 L)')
    assert.equal(z[1].beschreibung, 'sektpaultest · 1.100 L · aus Produktion Schaumwein / Sekt (1.100 L)')
    assert.equal(z[0].link, `/kellerbuch/weinausbau/${SEKT}`)
    assert.equal(produktionHerkunftText([{ art: 'spritzer', ziel_menge: 500, storniert_am: '2026-10-24T08:00:00Z' }]), 'aus Produktion Perlweinspritzer / Spritzer (500 L) – storniert')
    assert.equal(produktionHerkunftText([]), null)
  })
  test('laden.ts lädt die Produktionen der Chargen in Blöcken, mit Betriebsfilter und Fehlerauswertung', () => {
    const s = quelle('src/lib/journal/laden.ts')
    assert.match(s, /const chargen = chargenFuerProduktionHerkunft\(roh\)/)
    assert.match(s, /inBloecken<R>\(chargen, b => alle<R>\(\(supabase\.from\(PRODUKTION_HERKUNFT\.tabelle\) as any\)\s*\n\s*\.select\(PRODUKTION_HERKUNFT\.spalten\)\s*\n\s*\.eq\('tenant_id', tenantId\)/)
    assert.match(s, /if \(error\) throw new AktionsFehler\(`Journal: Produktionen/)
  })
})
