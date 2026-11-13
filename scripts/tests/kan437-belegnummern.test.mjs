// KAN-437 Teil 3 (13.11.2026): Weinexport F – länderspezifische Belegnummern am Exportauftrag (COLA, Prior Notice …).
// Befund: Für Nummern, die das Zielland bzw. der Importeur zur Sendung verlangt, blieb nur das Notizfeld.
// Die Sperre nach „Abgeschlossen“ und die Grenzen der Spalte prüft DB-Test 06.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { belegnummernAus, belegnummernFehler, belegnummernText, belegVorschlaege, BELEGNUMMERN_MAX, BELEGNUMMER_LAENGE } from '../../src/lib/export/belegnummern.ts'

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

describe('KAN-437: Belegnummern – Eingabe', () => {
  test('lesen: nur Bezeichnung und Nummer, getrimmt; alles andere fällt weg', () => {
    assert.deepEqual(belegnummernAus([{ bezeichnung: ' COLA ', nummer: ' 123 ', tenant_id: 'x', admin: true }, { bezeichnung: '', nummer: '' }, { bezeichnung: 'A' }, null, 'x']),
      [{ bezeichnung: 'COLA', nummer: '123' }])
    for (const v of [null, undefined, {}, 'COLA', 5]) assert.deepEqual(belegnummernAus(v), [])
  })
  test('prüfen: leere Zeilen fallen weg, halb ausgefüllte sind ein Fehler; Längen und Anzahl wie in der Datenbank', () => {
    assert.equal(belegnummernFehler([]), null)
    assert.equal(belegnummernFehler([{ bezeichnung: 'COLA', nummer: '123' }, { bezeichnung: '', nummer: ' ' }]), null)
    assert.match(belegnummernFehler([{ bezeichnung: 'COLA', nummer: '' }]), /Zeile 1: Bitte die Nummer zu „COLA“ angeben/)
    assert.match(belegnummernFehler([{ bezeichnung: 'COLA', nummer: '1' }, { bezeichnung: '', nummer: '99' }]), /Zeile 2: Bitte angeben, wofür die Nummer 99 ist/)
    assert.match(belegnummernFehler([{ bezeichnung: 'x'.repeat(BELEGNUMMER_LAENGE + 1), nummer: '1' }]), /höchstens 60 Zeichen/)
    const viele = n => Array.from({ length: n }, (_, i) => ({ bezeichnung: 'B', nummer: String(i) }))
    assert.equal(belegnummernFehler(viele(BELEGNUMMERN_MAX)), null)
    assert.match(belegnummernFehler(viele(BELEGNUMMERN_MAX + 1)), /Höchstens 20 Belegnummern/)
    for (const v of [null, {}, 'x', [null], [['a', 'b']], ['COLA']]) assert.equal(belegnummernFehler(v), 'Ungültige Belegnummern.', JSON.stringify(v))
  })
  test('Text für Liste und CSV; Vorschläge je Zielland', () => {
    assert.equal(belegnummernText([{ bezeichnung: 'COLA', nummer: '123' }, { bezeichnung: 'Prior Notice', nummer: '456' }]), 'COLA: 123; Prior Notice: 456')
    assert.equal(belegnummernText(null), '')
    assert.deepEqual([...belegVorschlaege(' us ')], ['COLA', 'Prior Notice'])
    assert.deepEqual([...belegVorschlaege('GB')], [])
    assert.deepEqual([...belegVorschlaege(null)], [])
  })
})

describe('KAN-437: Belegnummern – Verdrahtung und Migration', () => {
  test('PATCH: in der Positivliste, geprüft, nur die bereinigte Liste wird geschrieben', () => {
    const r = quelle('src/app/api/weinexport/[id]/route.ts')
    assert.match(r, /'ausfuhr_mrn', 'ausfuhr_anmeldung_datum', 'laender_belege'\] as const/)
    assert.match(r, /const bf = belegnummernFehler\(b\.laender_belege\)\s+if \(bf\) return fehler\(bf, 400\)\s+update\.laender_belege = belegnummernAus\(b\.laender_belege\)/)
  })
  test('Kasten: nur Drittland, änderbar bis „Abgeschlossen“; Laden mit try/finally, Antwort ausgewertet', () => {
    const p = quelle('src/app/(dashboard)/weinexport/[id]/page.tsx')
    assert.match(p, /\{gebiet === 'drittland' && \(!a\.storniert_am \|\| belegnummernAus\(a\.laender_belege\)\.length > 0\) && \(/)
    assert.match(p, /<ExportBelegnummernPanel[\s\S]{0,260}darfAendern=\{darfSchreiben && !a\.storniert_am && a\.status !== 'abgeschlossen'\}/)
    const k = quelle('src/app/(dashboard)/weinexport/[id]/ExportBelegnummernPanel.tsx')
    assert.match(k, /setLaeuft\(true\)\s+try \{[\s\S]+?if \(!res\.ok\) \{[\s\S]+?\} finally \{\s+setLaeuft\(false\)/)
    assert.match(k, /body: JSON\.stringify\(\{ laender_belege: belegnummernAus\(zeilen\) \}\)/)
  })
  test('CSV der Auftragsliste: Spalte „Belegnummern“ vor dem Storno, aus derselben Ladefunktion', () => {
    const e = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.match(e, /\{ kopf: 'EMCS-Datum', typ: 'datum', wert: z => z\.emcsDatum \},\s+\{ kopf: 'Belegnummern', typ: 'text', wert: z => z\.belegnummern \},\s+\{ kopf: 'Storniert am'/)
    assert.match(e, /belegnummern: belegnummernText\(a\.laender_belege\) \|\| null,/)
    assert.match(e, /storno_grund, laender_belege, kontakte\(vorname, nachname\), firmen\(name\)'\)/)
  })
  test('Migration: Spalte mit Grenzen, in der Positivliste der Sperre, nach „Abgeschlossen“ gesperrt', () => {
    const m = migration('kan437b_export_belegnummern')
    assert.match(m, /ADD COLUMN laender_belege jsonb NOT NULL DEFAULT '\[\]'::jsonb\s+CONSTRAINT exportauftraege_laender_belege_chk CHECK \(jsonb_typeof\(laender_belege\) = 'array' AND jsonb_array_length\(laender_belege\) <= 20\);/)
    assert.match(m, /ausfuhr_mrn,ausfuhr_anmeldung_datum,laender_belege',/)
    assert.match(m, /IF OLD\.status = ''abgeschlossen'' AND NEW\.laender_belege IS DISTINCT FROM OLD\.laender_belege THEN/)
    assert.match(m, /<> 1 THEN\s+RAISE EXCEPTION 'KAN-437: s112_export_workflow_schutz – Ankerstelle nicht genau einmal gefunden';/)
    assert.match(m, /BEFORE INSERT OR UPDATE OF status, abschluss_ohne_nachweis, ausfuhr_mrn, ausfuhr_anmeldung_datum, laender_belege ON public\.exportauftraege/)
    assert.ok(JSON.parse(quelle('scripts/schema.json')).exportauftraege.includes('laender_belege'))
  })
  test('Handbuch', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /titel: 'Belegnummern am Exportauftrag'/)
  })
})
