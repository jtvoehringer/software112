// KAN-484 (18.11.2026): Import von Kontakten und Firmen mündet vor dem Speichern in einen Prüfdialog – was importiert
// wird, was übersprungen wird und wo Angaben fehlen; das Segment lässt sich dort nachtragen.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SEGMENT_MAP, SEGMENT_NACHTRAG, SEGMENT_STANDARD, SEGMENT_WERTE, hatFehlendeAngaben, istSegment, mitSegmentNachtrag,
  pruefeZeile, segmentAus, zusammenfassung,
} from '../../src/lib/crm/importPruefung.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

const MAP_K = { vorname: 'Vorname', nachname: 'Nachname', email: 'E-Mail', land: 'Land', segment: 'Segment' }
const MAP_F = { name: 'Firma', email: 'E-Mail', land: 'Land', segment: 'Segment' }

describe('KAN-484: Segment', () => {
  test('Werte = Enum kundensegment (SEGMENTE in lib/crm/types.ts), Zuordnung nur auf gültige Werte', () => {
    const typen = quelle('src/lib/crm/types.ts')
    const block = typen.slice(typen.indexOf('export const SEGMENTE'), typen.indexOf('] as const'))
    const werte = [...block.matchAll(/value:\s*'([a-z]+)'/g)].map(m => m[1])
    assert.deepEqual([...SEGMENT_WERTE].sort(), werte.sort())
    for (const w of Object.values(SEGMENT_MAP)) assert.ok(istSegment(w), w)
    assert.equal(SEGMENT_MAP['gastro'], 'gastronomie')
    assert.equal(SEGMENT_MAP['ab hof'], 'abhof')
  })

  test('fehlt / unbekannt → Standard wie bisher, erkannt → Wert, Nachtrag vor der Datei', () => {
    assert.deepEqual(segmentAus('kontakte', {}, MAP_K), { wert: 'privat', status: 'fehlt', roh: null })
    assert.deepEqual(segmentAus('firmen', { Segment: '  ' }, MAP_F), { wert: 'gastronomie', status: 'fehlt', roh: null })
    assert.deepEqual(segmentAus('kontakte', { Segment: 'xyz' }, MAP_K), { wert: 'privat', status: 'unbekannt', roh: 'xyz' })
    assert.deepEqual(segmentAus('firmen', { Segment: 'Großhandel' }, MAP_F), { wert: 'grosshandel', status: 'ok', roh: 'Großhandel' })
    assert.deepEqual(segmentAus('kontakte', { Segment: 'xyz', [SEGMENT_NACHTRAG]: 'handel' }, MAP_K), { wert: 'handel', status: 'nachgetragen', roh: 'xyz' })
    // ungültiger Nachtrag zählt nicht
    assert.equal(segmentAus('kontakte', { Segment: 'export', [SEGMENT_NACHTRAG]: 'quatsch' }, MAP_K).wert, 'export')
    // ohne Zuordnung der Spalte: fehlt
    assert.equal(segmentAus('kontakte', { Segment: 'export' }, { nachname: 'Nachname' }).status, 'fehlt')
    assert.deepEqual(SEGMENT_STANDARD, { kontakte: 'privat', firmen: 'gastronomie' })
  })

  test('Nachträge hängen nur gültige Werte an die richtige Zeile, die Datei bleibt unverändert', () => {
    const rows = [{ Nachname: 'A' }, { Nachname: 'B' }, { Nachname: 'C' }]
    const mit = mitSegmentNachtrag(rows, new Map([[1, 'handel'], [2, 'quatsch']]))
    assert.equal(mit[0][SEGMENT_NACHTRAG], undefined)
    assert.equal(mit[1][SEGMENT_NACHTRAG], 'handel')
    assert.equal(mit[2][SEGMENT_NACHTRAG], undefined)
    assert.equal(rows[1][SEGMENT_NACHTRAG], undefined)
  })
})

describe('KAN-484: Zeilenprüfung (Abnahmebeispiel)', () => {
  const datei = [
    { Vorname: 'Anna', Nachname: 'Ohne', 'E-Mail': 'anna@example.at', Land: 'AT', Segment: '' },
    { Vorname: 'Ben', Nachname: 'Fremd', 'E-Mail': '', Land: 'DE', Segment: 'xyz' },
    { Vorname: 'Cara', Nachname: 'Atlantis', 'E-Mail': '', Land: 'Atlantis', Segment: 'Handel' },
    { Vorname: 'Dora', Nachname: '', 'E-Mail': 'dora@example.at', Land: 'AT', Segment: 'privat' },
    { Vorname: 'Emil', Nachname: 'Korrekt', 'E-Mail': 'emil@example.at', Land: 'Österreich', Segment: 'Privat' },
  ]
  const zeilen = datei.map((r, i) => pruefeZeile('kontakte', r, MAP_K, i))

  test('Status, Zeilennummer und Hinweise je Zeile', () => {
    assert.deepEqual(zeilen.map(z => [z.zeile, z.status]), [[2, 'neu'], [3, 'neu'], [4, 'neu'], [5, 'uebersprungen'], [6, 'neu']])
    assert.deepEqual(zeilen[0].hinweise, ['Segment fehlt'])
    assert.deepEqual(zeilen[1].hinweise, ['Segment „xyz“ unbekannt'])
    assert.deepEqual(zeilen[2].hinweise, ['Land „Atlantis“ nicht erkannt – bleibt leer'])
    assert.equal(zeilen[3].grund, 'Nachname fehlt')
    assert.deepEqual(zeilen[4].hinweise, [])
    assert.equal(zeilen[4].name, 'Emil Korrekt')
    assert.equal(zeilen[4].segment.wert, 'privat')
  })

  test('Zusammenfassung: 4 neu · 1 übersprungen · 3 mit fehlenden Angaben', () => {
    assert.deepEqual(zusammenfassung(zeilen), { neu: 4, dubletten: 0, uebersprungen: 1, mitFehlendenAngaben: 3 })
    assert.equal(hatFehlendeAngaben(zeilen[3]), false, 'übersprungene Zeilen zählen nicht als „fehlende Angaben“')
  })

  test('Zeilennummer mit Blockversatz, Firmen über den Firmennamen, unbrauchbare E-Mail als Hinweis', () => {
    const z = pruefeZeile('firmen', { Firma: 'Weinbar', 'E-Mail': 'keine Adresse', Segment: 'gastro' }, MAP_F, 150)
    assert.equal(z.zeile, 152)
    assert.equal(z.index, 150)
    assert.equal(z.status, 'neu')
    assert.equal(z.segment.wert, 'gastronomie')
    assert.ok(z.hinweise.some(h => /E-Mail „keine Adresse“ unbrauchbar/.test(h)), z.hinweise.join(' | '))
    assert.equal(pruefeZeile('firmen', { Firma: ' ' }, MAP_F, 0).grund, 'Name fehlt')
  })
})

describe('KAN-484: Verdrahtung', () => {
  const route = quelle('src/app/api/import/route.ts')
  const client = quelle('src/app/(dashboard)/admin/import/ImportClient.tsx')
  const dialog = quelle('src/app/(dashboard)/admin/import/ImportPruefDialog.tsx')

  test('Route: Prüfmodus nach allen Rechteprüfungen, ohne Schreibzugriff, nur Kontakte/Firmen', () => {
    const anfang = route.indexOf('if (pruefen === true) {')
    assert.ok(anfang > 0)
    const block = route.slice(anfang, route.indexOf('return NextResponse.json({ zeilen })', anfang))
    assert.ok(route.indexOf("canWrite(activeMembership, 'crm')") < anfang, 'Recht CRM vor der Prüfung')
    assert.ok(route.indexOf('schreibSperreKonflikt(activeMembership)') < anfang)
    assert.ok(route.indexOf('seitenBetriebKonflikt(tenantId)') < anfang)
    assert.ok(!/\.(insert|update|upsert|delete)\(|generateAccountnummer|findOrCreateLageId/.test(block), 'Prüfung schreibt nichts')
    assert.match(block, /istCrmImportTyp\(typ\)/)
    assert.match(block, /pruefeZeile\(typ, rows\[i\], mapping, zeilenBasis - 2 \+ i\)/)
    assert.match(block, /kundenNameSet\.has/, 'Dubletten wie beim Import')
    assert.match(block, /findFirmaId\(firmaName\)/, 'Firma nicht gefunden')
  })

  test('Route: Import nimmt das Segment aus segmentAus() (Nachtrag), keine eigene Zuordnung mehr', () => {
    assert.ok(!/const SEGMENT_MAP/.test(route))
    assert.match(route, /segmentAus\('kontakte', row, mapping\)\.wert/)
    assert.match(route, /segmentAus\('firmen', row, mapping\)\.wert/)
  })

  test('Client: Kontakte/Firmen erst prüfen, Nachträge gehen mit an den Import', () => {
    assert.match(client, /mitPruefung \? startPruefung\(\) : startImport\(\)/)
    assert.match(client, /pruefen: true/)
    assert.match(client, /mitSegmentNachtrag\(parsed\.rows, segmente\)/)
    assert.match(client, /<ImportPruefDialog /)
    assert.match(dialog, /useDialog\(true, onAbbrechen/)
    assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/)
    assert.match(dialog, /Noch ist nichts gespeichert/)
  })
})
