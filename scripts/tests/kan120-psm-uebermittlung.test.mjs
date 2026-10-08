// KAN-120 (08.10.2026) – PSM-Übermittlung vorbereiten: Status je Aufzeichnung (offen / exportiert / Korrektur offen)
// aus dem Hash der Exportzeilen gegen den letzten Export, Auswahl ohne Doppelexport, erneuter Download eines Laufs,
// Adapter „csv-datei“ spaltengleich mit der CSV psm-uebermittlung. DB-Seite: DB-Test 72.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as st from '../../src/lib/uebermittlung/psm/stand.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const zeile = (id, extra = {}) => ({
  datensatzId: id, betriebsnummer: '1234567', anwender: 'Karin K.', datum: '2026-05-10', datumBis: null, startzeit: '07:00', endzeit: '09:00',
  artVerwendung: 'Freiland', massnahme: 'Spritzung', kultur: 'Weinrebe', eppoKultur: 'VITVI', eppoSchaderreger: 'PLASVI', bbch: '57',
  mittel: 'Kupfer X', registernummer: '3456', aufwand: 1.5, aufwandEinheit: 'kg/ha', flaecheHa: 0.8, kgNr: '10001', kgName: 'Musterdorf',
  gstNr: '123/4', feldstueck: '1', schlag: '1', erfasstAm: '2026-05-10T10:00:00Z', erfasstVon: 'Karin K.', verzugH: 0, nacherfasst: false, ...extra,
})
const prot = (id, hash, am, exportId = 'e1') => ({ behandlung_id: id, export_id: exportId, hash, version: 1, status: 'exportiert', exportiert_am: am, exportiert_von_name: 'Karin K.' })

describe('KAN-120: Übermittlungsstand', () => {
  test('Hash: deterministisch, ändert sich mit dem Inhalt', () => {
    const a = [zeile('m1')]
    assert.match(st.zeilenHash(a), /^[0-9a-f]{64}$/)
    assert.equal(st.zeilenHash(a), st.zeilenHash([zeile('m1')]))
    assert.notEqual(st.zeilenHash(a), st.zeilenHash([zeile('m1', { aufwand: 2 })]))
  })

  test('offen, exportiert, Korrektur offen; zwei Grundstücke = eine Maßnahme', () => {
    const m1 = [zeile('m1', { gstNr: '1' }), zeile('m1', { gstNr: '2' })]
    const m2 = [zeile('m2')]
    const m3 = [zeile('m3')]
    const protokoll = [prot('m2', st.zeilenHash(m2), '2026-05-11T08:00:00Z'), prot('m3', st.zeilenHash([zeile('m3', { aufwand: 9 })]), '2026-05-11T08:00:00Z')]
    const stand = st.standJeMassnahme([...m1, ...m2, ...m3], protokoll)
    const s = Object.fromEntries(stand.map(x => [x.behandlungId, x]))
    assert.equal(s.m1.status, 'offen')
    assert.equal(s.m1.zeilen.length, 2)
    assert.equal(s.m2.status, 'exportiert')
    assert.equal(s.m3.status, 'korrektur')
    assert.equal(st.STATUS_TEXT.korrektur, 'Korrektur offen')
    // kein Doppelexport: nur offene und geänderte
    assert.deepEqual(st.auswahlFuerExport(stand).map(x => x.behandlungId).sort(), ['m1', 'm3'])
  })

  test('maßgeblich ist der letzte Export', () => {
    const m = [zeile('m1')]
    const stand = st.standJeMassnahme(m, [prot('m1', st.zeilenHash(m), '2026-05-11T08:00:00Z', 'e1'), prot('m1', 'f'.repeat(64), '2026-05-12T08:00:00Z', 'e2')])
    assert.equal(stand[0].status, 'korrektur')
    assert.equal(stand[0].letzterExport.export_id, 'e2')
  })

  test('nach dem Export storniert: einmal Korrektur offen (ohne Zeilen), danach erledigt', () => {
    const vorher = st.standJeMassnahme([], [prot('m9', st.zeilenHash([zeile('m9')]), '2026-05-11T08:00:00Z')])
    assert.equal(vorher.length, 1)
    assert.equal(vorher[0].status, 'korrektur')
    assert.equal(vorher[0].entfallen, true)
    assert.match(st.entfallenHinweis(vorher), /1 bereits exportierte Aufzeichnung ist inzwischen storniert/)
    const nachher = st.standJeMassnahme([], [prot('m9', st.zeilenHash([zeile('m9')]), '2026-05-11T08:00:00Z', 'e1'), prot('m9', st.zeilenHash([]), '2026-05-12T08:00:00Z', 'e2')])
    assert.equal(nachher[0].status, 'exportiert')
    assert.equal(st.entfallenHinweis([]), null)
  })

  test('erneut herunterladen: nur unveränderte Maßnahmen des Laufs', () => {
    const m1 = [zeile('m1')], m2 = [zeile('m2', { aufwand: 3 })]
    const protokoll = [prot('m1', st.zeilenHash(m1), '2026-05-11T08:00:00Z', 'e1'), prot('m2', st.zeilenHash([zeile('m2')]), '2026-05-11T08:00:00Z', 'e1'), prot('m3', 'a'.repeat(64), '2026-05-12T08:00:00Z', 'e2')]
    const stand = st.standJeMassnahme([...m1, ...m2], protokoll)
    const lauf = st.zeilenEinesLaufs(stand, protokoll, 'e1')
    assert.deepEqual(lauf.zeilen.map(z => z.datensatzId), ['m1'])
    assert.equal(lauf.massnahmen, 2)
    assert.equal(lauf.fehlend, 1)
    assert.equal(st.zeilenEinesLaufs(stand, protokoll, 'gibt-es-nicht').massnahmen, 0)
  })

  test('Pflichthinweise: Anwender, Registernummer, Betriebsnummer', () => {
    assert.deepEqual(st.pflichtHinweise([zeile('m1')], '1234567'), [])
    const h = st.pflichtHinweise([zeile('m1', { anwender: null }), zeile('m1', { anwender: null, gstNr: '2' }), zeile('m2', { registernummer: null, mittel: 'Schwefel Y' })], null)
    assert.equal(h.length, 3)
    assert.match(h[0], /^1 Anwendung hat keinen Anwender/)
    assert.match(h[1], /Schwefel Y/)
    assert.match(h[2], /Betriebsnummer fehlt/)
  })
})

describe('KAN-120: Verdrahtung', () => {
  test('Adapter csv-datei: Spalten der Meldung psm-uebermittlung (kein zweites Format)', () => {
    const a = quelle('src/lib/uebermittlung/psm/csvDatei.ts')
    assert.match(a, /kanal: 'csv-datei'/)
    assert.match(a, /text: csvText\(zeilen, SPALTEN_PSM_UEBERMITTLUNG\)/)
    assert.match(quelle('src/lib/uebermittlung/psm/laden.ts'), /ladePsmUebermittlung\(supabase, tenantId, betriebsnummer, \{ jahr: null \}\)/)
  })
  test('Route: POST protokolliert vor der Datei, GET ohne Seiteneffekte, Prüfungen', () => {
    const r = quelle('src/app/api/behandlungen/uebermittlung/route.ts')
    const post = r.slice(r.indexOf('export async function POST'), r.indexOf('export async function GET'))
    const get = r.slice(r.indexOf('export async function GET'))
    assert.match(post, /seitenBetriebKonflikt\(tenantId\)/)
    assert.match(post, /schreibSperreKonflikt\(membership\)/)
    assert.match(post, /canWrite\(membership, 'rieden'\)/)
    assert.ok(post.indexOf("'s112_psm_uebermittlung_protokollieren'") < post.indexOf('adapter.serialisiere('), 'erst protokollieren, dann Datei')
    assert.match(post, /const auswahl = auswahlFuerExport\(stand\.stand\)/)
    assert.doesNotMatch(get, /rpc|insert|update|delete/i)
    assert.match(get, /zeilenEinesLaufs\(stand\.stand, stand\.protokoll, exportId\)/)
  })
  test('Oberfläche: Spalte Übermittlung, Export per POST mit Neuladen', () => {
    assert.match(quelle('src/app/(dashboard)/behandlungen/BehandlungenClient.tsx'), /<th className="px-3 py-2 text-left w-\[10%\]">Übermittlung<\/th>/)
    const p = quelle('src/app/(dashboard)/behandlungen/UebermittlungPanel.tsx')
    assert.match(p, /href="\/api\/behandlungen\/uebermittlung" methode="POST" nachErfolg=\{\(\) => router\.refresh\(\)\}/)
    const k = quelle('src/components/CsvExportKnopf.tsx')
    assert.match(k, /method: \(props\.href !== undefined && props\.methode\) \|\| 'GET'/)
  })
})
