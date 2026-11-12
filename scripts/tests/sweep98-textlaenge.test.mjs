// Sweep 98 (10.10.2026): Textlängen wie in der Datenbank.
// Befund: /api/weinexport schrieb EORI-Nummer (varchar(30)), Destination Stadt (varchar(100)), Incoterms, Transportart,
// Einheit und TARIC ungeprüft – eine zu lange Eingabe endete mit dem rohen Datenbankfehler „value too long for type
// character varying(30)“. Dazu fehlte maxLength an Lieferadresse, Gebinde (Material, Langbezeichnung) und TBS-Nummer.
// Jetzt prüft exportauftragFehler() (Route und Formular nutzen dieselben Listen), die Felder haben maxLength, und
// scripts/check-textlaenge.js hält Formular und Datenbankgrenze über scripts/text-grenzen.json zusammen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exportauftragFehler, EXPORT_MAX } from '../../src/lib/export/auftragEingabe.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeFeld, pruefeWurzel } = require(path.join(HIER, '..', 'check-textlaenge.js'))
const liste = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'text-grenzen.json'), 'utf8'))

// Stand der Datenbank 10.10.2026 (scripts/text-grenzen.sql) – jede Spalte braucht ein Formularfeld oder einen Grund
const DATENBANK = [
  'behaelter.bezeichnung_lang', 'behaelter.lp_pickerl', 'behaelter.material', 'behandlungen.anwender_name',
  'dac_antrag.antragsnummer', 'dac_antrag.untersuchungsnummer', 'export_dokumente.dokument_art', 'export_dokumente.status',
  'exportauftraege.destination_land', 'exportauftraege.destination_stadt', 'exportauftraege.emcs_status',
  'exportauftraege.eori_kunde', 'exportauftraege.incoterms', 'exportauftraege.referenz', 'exportauftraege.status',
  'exportauftraege.taric_code', 'exportauftraege.transport_art', 'exportauftraege.ursprungsland', 'exportauftraege.waehrung',
  'exportauftrag_positionen.einheit', 'exportauftrag_positionen.taric_code', 'firmen.telefon_vorwahl',
  'fuellungen.zolltarifnummer', 'kellerbuch_abschluesse.bemerkung', 'kellermittel.name', 'kontakte.mobil_vorwahl',
  'kontakte.position', 'kontakte.quelle', 'kontakte.telefon_vorwahl', 'kontakte.titel', 'kontakte.titel_nachgestellt',
  'lieferadressen.bezeichnung', 'lieferadressen.empfaenger', 'lieferadressen.ort', 'lieferadressen.plz',
  'lieferadressen.strasse', 'meldung_abgaben.dateiname', 'produktion_eingaenge.bezeichnung',
  'tenant_einstellungen.export_prefix', 'tenant_einstellungen.ki_abfragen_paket', 'tenant_einstellungen.weinexport_paket',
  'zukauf_posten.tbs_nummer_lieferant',
]

describe('Weinexport: Eingaben prüfen', () => {
  test('gültiger Auftrag → kein Fehler', () => {
    assert.equal(exportauftragFehler({ incoterms: 'EXW', transport_art: 'LKW', eori_kunde: 'AT1234567890', destination_stadt: 'München',
      // KAN-429 (12.11.2026): eine gültige Position braucht jetzt Menge über 0 und Füllung bzw. Bezeichnung
      positionen: [{ einheit: 'Fl', taric_code: '2204.21', menge: 6, beschreibung: 'Riesling' }] }), null)
    assert.equal(exportauftragFehler({}), null)
  })

  test('zu lang bzw. nicht aus der Liste → Meldung statt Datenbankfehler', () => {
    assert.match(exportauftragFehler({ eori_kunde: 'X'.repeat(EXPORT_MAX.eori + 1) }), /EORI-Nummer darf höchstens 30 Zeichen/)
    assert.match(exportauftragFehler({ destination_stadt: 'X'.repeat(101) }), /höchstens 100 Zeichen/)
    assert.match(exportauftragFehler({ incoterms: 'XYZ123' }), /Unbekannte Incoterms/)
    assert.match(exportauftragFehler({ transport_art: 'Rakete' }), /Unbekannte Transportart/)
    assert.match(exportauftragFehler({ positionen: [{ einheit: 'Fl' }, { einheit: 'Fass' }] }), /Position 2: unbekannte Einheit/)
    assert.match(exportauftragFehler({ positionen: [{ taric_code: '1'.repeat(21) }] }), /TARIC-Code darf höchstens 20/)
  })

  test('Route prüft vor der Referenznummer, Formular nutzt dieselben Listen', () => {
    const route = readFileSync(path.join(ROOT, 'src/app/api/weinexport/route.ts'), 'utf8')
    assert.ok(route.indexOf('exportauftragFehler(body)') > 0 && route.indexOf('exportauftragFehler(body)') < route.indexOf("get_next_exportnummer"))
    const form = readFileSync(path.join(ROOT, 'src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx'), 'utf8')
    assert.match(form, /from '@\/lib\/export\/auftragEingabe'/)
    assert.doesNotMatch(form, /const INCOTERMS = \[/)
  })
})

describe('Wächter', () => {
  test('Erkennung', () => {
    assert.equal(pruefeFeld('<input name="plz" maxLength={12} />', 'name="plz"', 12), null)
    assert.equal(pruefeFeld('<input name="plz" maxLength={KONST} />', 'name="plz"', 12), null)
    assert.match(pruefeFeld('<input name="plz" />', 'name="plz"', 12), /kein maxLength/)
    assert.match(pruefeFeld('<input name="plz" maxLength={20} />', 'name="plz"', 12), /über der Grenze 12/)
    assert.match(pruefeFeld('<input name="ort" />', 'name="plz"', 12), /nicht gefunden/)
  })

  test('jede Längengrenze der Datenbank hat ein Formularfeld oder einen Grund', () => {
    const erfasst = [...liste.spalten.map(s => s.spalte), ...Object.keys(liste.ohne_formular)].sort()
    assert.deepEqual(erfasst, [...DATENBANK].sort())
  })

  test('Projekt: alle eingetragenen Felder haben ein passendes maxLength', () => {
    const e = pruefeWurzel(ROOT)
    assert.ok(e.felder >= 20)
    assert.deepEqual(e.funde, [])
  })
})
