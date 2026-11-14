// KAN-453 G3b (14.11.2026): Storno einer Gutschrift.
// Befund: Eine Gutschrift (KAN-419) ließ sich nicht stornieren – ein Tippfehler blieb für immer stehen, die Rechnung war
// nicht mehr stornierbar, und eine irrtümliche Rücknahme (KAN-452) blieb im Bestand. Neu: Stornobeleg am Storno-Datum
// (wie bei der Rechnung), die stornierte Gutschrift zählt nicht mehr gegen ihre Rechnung, die Rücknahme wird
// zurückgebucht. Datenbank: DB-Test 04_gutschrift_storno.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { alsBeleg, istGutschriftStorno, istStornobeleg, zaehltMitBetrag, STORNO_FELDER } from '../../src/lib/verkauf/rechnungen.ts'
import { bereitsGutgeschrieben, gutschriftSumme, gutschriftWirksam, restBetrag, restMenge } from '../../src/lib/verkauf/gutschrift.ts'
import { stornobelegPdfInhalt } from '../../src/lib/verkauf/stornobelegPdf.ts'
import { bmdRechnungKopf, gutschriftRechnungIds, positionenMitSteuerfall, rechnungFaelle } from '../../src/lib/buchhaltung/bmd.ts'
import { bewegungsartLabel } from '../../src/app/(dashboard)/weinhandel/fuellungen/bewegungsarten.ts'
import { fuellungStornoSperren } from '../../src/lib/handel/fuellungStornoSperre.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}
const M = migration('kan453a_gutschrift_storno')

// Rechnung: 6 Flaschen à 12 € (20 %); Gutschrift über 2 Flaschen + 6 € Preisnachlass, storniert durch ST-2026-0001
const P = { id: 'pf', name: 'Wein', menge: 6, preis_brutto: 12, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20 }
const ZEILEN = [
  { position_id: 'pf', lieferschein_id: 'ls1', lieferscheinnummer: 'LS-1', typ: 'flasche', name: 'Wein', menge: 2, einheit: 'Stk', preis_brutto: 12, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20, frei: false, ruecknahme: true },
  { position_id: null, lieferschein_id: null, lieferscheinnummer: null, typ: 'sonstiges', name: 'Preisnachlass', menge: 1, einheit: null, preis_brutto: 6, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20, frei: true, ruecknahme: false },
]
const GUTSCHRIFT = { id: 'g1', art: 'gutschrift', aktiv: true, storniert: false, rechnungsnummer: 'GS-2026-0001', datum: '2026-11-12', gutschrift_zu_id: 'r1', gutschrift_positionen: ZEILEN }
// wie s112_gutschrift_stornieren: die Zeilen der Gutschrift mit negativer Menge als Momentaufnahme
const STORNIERT = { ...GUTSCHRIFT, storniert: true, storniert_durch_id: 's1', storno_positionen: ZEILEN.map(z => ({ ...z, menge: -z.menge })) }
const STORNO = { id: 's1', art: 'storno', aktiv: true, rechnungsnummer: 'ST-2026-0001', datum: '2026-11-14', notizen: 'Gutschrift war ein Irrtum', storno_von_id: 'g1',
  storno_von: { id: 'g1', rechnungsnummer: 'GS-2026-0001', datum: '2026-11-12', art: 'gutschrift', gutschrift_zu_id: 'r1', storno_positionen: STORNIERT.storno_positionen } }

describe('KAN-453: Belege', () => {
  test('Stornobeleg zu einer Gutschrift: positive Beträge aus der Momentaufnahme, ohne Sonderfall in alsBeleg', () => {
    assert.equal(istStornobeleg(STORNO), true)
    assert.equal(istGutschriftStorno(STORNO), true)
    assert.equal(istGutschriftStorno({ art: 'storno', storno_von: { art: 'rechnung' } }), false)
    assert.equal(istGutschriftStorno(GUTSCHRIFT), false)
    assert.deepEqual(alsBeleg(STORNO).verkauf_positionen.map(p => [p.name, p.menge]), [['Wein', 2], ['Preisnachlass', 1]])
    // die stornierte Gutschrift bleibt in ihrem Zeitraum wirksam (negativ), der Stornobeleg in seinem (positiv)
    assert.deepEqual(alsBeleg(STORNIERT).verkauf_positionen.map(p => p.menge), [-2, -1])
    assert.equal(zaehltMitBetrag(STORNIERT), true)
    assert.equal(zaehltMitBetrag(STORNO), true)
    assert.match(STORNO_FELDER, /storno_von:storno_von_id\(id, rechnungsnummer, datum, art, gutschrift_zu_id, storno_positionen\)/)
  })
  test('die stornierte Gutschrift zählt nicht mehr gegen die Rechnung: Restmenge, Restbetrag', () => {
    assert.equal(gutschriftWirksam(GUTSCHRIFT), true)
    assert.equal(gutschriftWirksam(STORNIERT), false)
    assert.equal(gutschriftWirksam({ aktiv: false }), false)
    assert.equal(gutschriftSumme([GUTSCHRIFT]), 30)
    assert.equal(gutschriftSumme([STORNIERT]), 0)
    assert.equal(restMenge(P, bereitsGutgeschrieben([GUTSCHRIFT])), 4)
    assert.equal(restMenge(P, bereitsGutgeschrieben([STORNIERT])), 6)
    assert.equal(restBetrag([P], [STORNIERT, GUTSCHRIFT]), 42)
    assert.match(quelle('src/lib/verkauf/umsatz.ts'), /if \(g\.art !== 'gutschrift' \|\| !g\.gutschrift_zu_id \|\| g\.storniert === true\) continue/)
  })
  test('Stornobeleg-PDF: Bezug auf die Gutschrift, positive Summe; Layout nennt die Gutschrift', () => {
    const i = stornobelegPdfInhalt(STORNO)
    assert.deepEqual(i.storno, { zuNummer: 'GS-2026-0001', zuDatumIso: '2026-11-12', grund: 'Gutschrift war ein Irrtum', zuArt: 'gutschrift' })
    assert.equal(i.gesamt, 30)
    assert.equal(stornobelegPdfInhalt({ ...STORNO, storno_von: { ...STORNO.storno_von, art: 'rechnung' } }).storno.zuArt, 'rechnung')
    const s = quelle('src/lib/pdf/verkaufRechnungPdf.tsx')
    assert.match(s, /\{gutschrift \? 'GUTSCHRIFT' : zuGutschrift \? 'STORNOBELEG' : storno \? 'STORNORECHNUNG' : 'RECHNUNG'\}/)
    assert.match(s, /zu \{zuGutschrift \? 'Gutschrift' : 'Rechnung'\} \{storno\.zuNummer\} vom \{fmtDate\(storno\.zuDatumIso\)\}/)
    assert.match(s, /Dieser Stornobeleg hebt die Gutschrift \$\{storno\.zuNummer\}/)
  })
})

describe('KAN-453: Auswertungen', () => {
  test('BMD: Storno zu GS, Steuerfall freier Zeilen über die berichtigte Rechnung', () => {
    const kopf = bmdRechnungKopf(STORNO, 'Muster')
    assert.equal(kopf.extbelegnr, 'GS-2026-0001')
    assert.match(kopf.text, /Storno ST-2026-0001 zu GS GS-2026-0001/)
    assert.match(bmdRechnungKopf({ ...STORNO, storno_von: { rechnungsnummer: 'RE-1', art: 'rechnung' } }, 'Muster').text, /zu RE RE-1/)
    assert.deepEqual(gutschriftRechnungIds([STORNO, GUTSCHRIFT, { art: 'rechnung', id: 'x' }]), ['r1'])
    const faelle = new Map([['ls1', 'ig'], ...rechnungFaelle([{ rechnung_id: 'r1', steuerfall: 'ig' }])])
    const pos = positionenMitSteuerfall(alsBeleg(STORNO), faelle)
    assert.deepEqual(pos.map(p => [p.pos.name, p.pos.menge, p.verkaufSteuerfall]), [['Wein', 2, 'ig'], ['Preisnachlass', 1, 'ig']])
  })
  test('Zusammenfassende Meldung: Stornobeleg zu einer Gutschrift mit Steuerfall und UID der berichtigten Rechnung', () => {
    // zm.ts hängt an @/-Importen (Datenbank) – geprüft wird der Quelltext; die Rechnung dahinter (−wert der negativen
    // Momentaufnahme = positiv) deckt der Beleg-Test oben ab
    const z = quelle('src/lib/behoerden/zm.ts')
    assert.match(z, /const f = o\.art === 'gutschrift'\n\s+\? einordnen\(gutschriftFaelle\.get\(String\(o\.gutschrift_zu_id \?\? ''\)\) \?\? \[\]\)\n\s+: steuerfallDerMomentaufnahme\(pos, verkaeufe\)/)
    assert.match(z, /if \(f\.igl\) aus\.push\(\{ uid: f\.uid, betrag: -wert\(pos\), nummer \}\)/)
    assert.match(z, /\.select\('id, art, gutschrift_zu_id, storno_positionen'\)/)
    assert.match(z, /\[\.\.\.rechnungen, \.\.\.orig\.data\]\.filter\(r => r\.art === 'gutschrift' && r\.gutschrift_zu_id\)/)
    // die stornierte Gutschrift selbst bleibt im Zweig „Gutschrift“ (vor dem Zweig „storniert“) – negativ in ihrem Zeitraum
    assert.ok(z.indexOf("if (r.art === 'gutschrift') {") < z.indexOf('if (r.storniert === true) {'))
  })
  test('Bewegungslisten und BSM kennen die Gegenbewegung; sie zählt als Bestandsbuchung der Füllung', () => {
    assert.equal(bewegungsartLabel('ruecknahme_storno'), 'Rücknahme storniert (Gutschrift storniert)')
    const b = quelle('src/lib/behoerden/bsm.ts')
    assert.match(b, /case 'ruecknahme_storno':.*\n\s+case 'ruecknahme':.*\n\s+return k\.kundeAusland \? 'VK_FL_AU' : 'VK_FL_AT'/)
    assert.match(b, /const istVerkauf = fb\.art\.startsWith\('verkauf'\) \|\| fb\.art\.startsWith\('ruecknahme'\)/)
    assert.match(b, /fb\.art === 'ruecknahme_storno' \? 'Gegenbuchung \(Gutschrift storniert\)' : null/)
    assert.match(fuellungStornoSperren([{ id: 'f1' }], [], [{ fuellung_id: 'f1', art: 'ruecknahme' }, { fuellung_id: 'f1', art: 'ruecknahme_storno' }]).get('f1'), /2 Bestandsbuchungen/)
  })
})

describe('KAN-453: Server Action und Seite', () => {
  test('gutschriftStornieren: Eingaben geprüft, RPC, Datums-Ablehnung am Datumsfeld', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    const fn = a.slice(a.indexOf('export async function gutschriftStornieren('), a.indexOf('// KAN-453 G3a (Entscheidung 2A)'))
    assert.match(fn, /const tenantId = await getTenantId\(\)/)
    assert.match(fn, /const f = stornoGrundFehler\(grund\)\n\s+if \(f\) return \{ error: f \}/)
    assert.match(fn, /stornoDatumFehler\(stornoDatum, \{ heute: heuteWien\(\) \}\)/)
    assert.match(fn, /rpc\('s112_gutschrift_stornieren', \{\n\s+p_tenant_id: tenantId, p_gutschrift_id: gutschriftId, p_grund: grund\.trim\(\), \.\.\.\(stornoDatum \? \{ p_datum: stornoDatum \} : \{\}\),/)
    assert.match(fn, /istStornoDatumAblehnung\(\(error as \{ hint\?: unknown \}\)\.hint\) \? \{ error: meldung, feld: 'datum' \} : \{ error: meldung \}/)
  })
  test('Seite: Knopf nur an der nicht stornierten Gutschrift mit Schreibrecht; Stornobeleg nennt die Gutschrift; Liste kennzeichnet stornierte', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(s, /\{gutschrift && !r\.storniert && membership && canWrite\(membership, 'warenwirtschaft'\) && \(\n\s+<div className="no-print flex justify-end">\n\s+<StornoButton action=\{gutschriftStornieren\.bind\(null, String\(r\.id\)\)\} label="Gutschrift stornieren" mitText/)
    assert.match(s, /stornoDatum=\{\{ heute: heuteWien\(\), ab: String\(r\.datum\)\.slice\(0, 10\)/)
    assert.match(s, /Stornobeleg zu \{zuGutschrift \? 'Gutschrift' : 'Rechnung'\} <Link/)
    assert.match(s, /\.select\('id, rechnungsnummer, datum, aktiv, storniert, gutschrift_positionen'\)/)
    const p = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/GutschriftPanel.tsx')
    assert.match(p, /gutschriftWirksam\(g\)\n\s+\? <>−\{fmtEur\(gutschriftBrutto\(g\)\)\}/)
    assert.match(p, /storniert \(\{fmtEur\(gutschriftBrutto\(g\)\)\}\)/)
  })
  test('Handbuch und Projektregeln', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /„Gutschrift stornieren“ mit Storno-Datum und Grund/)
    assert.match(quelle('CLAUDE.md'), /Storno einer Gutschrift \(seit KAN-453 G3b\)/)
  })
})

describe('KAN-453: Migration', () => {
  test('eigene RPC mit Zugriffs-, Abo- und Modulprüfung; nicht für anon', () => {
    assert.match(M, /CREATE FUNCTION public\.s112_gutschrift_stornieren\(p_tenant_id uuid, p_gutschrift_id uuid, p_grund text, p_datum date DEFAULT NULL\)\nRETURNS uuid\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public/)
    assert.match(M, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);\n\s+PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);\n\s+PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft'\);\n\s+IF length\(v_grund\) < 10/)
    assert.match(M, /REVOKE EXECUTE ON FUNCTION public\.s112_gutschrift_stornieren\(uuid, uuid, text, date\) FROM PUBLIC, anon;/)
  })
  test('Momentaufnahme der stornierten Gutschrift: ihre Zeilen mit negativer Menge', () => {
    assert.match(M, /jsonb_agg\(x\.pos \|\| jsonb_build_object\('menge', -\(\(x\.pos ->> 'menge'\)::numeric\)\) ORDER BY x\.nr\)/)
    assert.match(M, /CHECK \(art IN \('rechnung', 'gutschrift'\) OR \(NOT storniert AND storniert_durch_id IS NULL\)\)/)
  })
  test('Rückbuchung nur, wenn die Ware frei im Bestand ist; Gegenbewegung ist ein Abgang mit Verweis, je Gutschrift einmal', () => {
    assert.match(M, /IF v_alt - v_b\.stk < greatest\(v_res, 0\) THEN\n\s+RAISE EXCEPTION '„%“: Die zurückgenommene Ware ist nicht mehr im Bestand/)
    assert.equal([...M.matchAll(/HINT = 'ruecknahme_bestand'/g)].length, 2)
    assert.match(M, /art NOT IN \('bruch', 'eigenverbrauch', 'schwund', 'verkauf', 'ruecknahme_storno'\) OR menge_stk < 0\)/)
    assert.match(M, /CHECK \(\(art IN \('ruecknahme', 'ruecknahme_storno'\)\) = \(gutschrift_id IS NOT NULL\)\)/)
    assert.match(M, /CREATE UNIQUE INDEX fuellung_bewegungen_ruecknahme_storno_einmal ON public\.fuellung_bewegungen \(gutschrift_id, fuellung_id, verkaufsposten_id\)\n\s+WHERE art = 'ruecknahme_storno';/)
  })
  test('Eingriffe in bestehende Funktionen: jeder Anker genau einmal, sonst Abbruch', () => {
    assert.match(M, /IF v_n <> 1 THEN\n\s+RAISE EXCEPTION 'KAN-453: Anker fehlt bzw\. ist nicht eindeutig/)
    assert.equal([...M.matchAll(/\n    ARRAY\['/g)].length, 6)
    assert.equal([...M.matchAll(/AND NOT g\.storniert/g)].length, 3)   // Summe, Restmenge, Rechnung wieder stornierbar
    assert.doesNotMatch(M, /CREATE OR REPLACE FUNCTION/)
  })
})
