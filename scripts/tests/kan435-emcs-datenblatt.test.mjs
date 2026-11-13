// KAN-435 D1 (13.11.2026): Weinexport D – EMCS-Datenblatt statt e-AD-XML, altes Begleitdokument-Muster gekennzeichnet.
// Befund (KAN-417): Die XML-Datei unter /api/weinexport/[id]/emcs sah aus wie eine EMCS-Meldung, war aber nicht
// einreichbar (Verbrauchsteuernummer = UID, Produktcode für alles „W200“, Menge nicht in Litern, kein Alkoholgehalt);
// Handbuch und FAQ behaupteten, sie lasse sich importieren. Das Dokument „V1/V2“ zitierte die aufgehobene VO 436/2009.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

hooksRegistrieren()

describe('KAN-435 D1: Regeln des Datenblatts', nurMitHooks, () => {
  test('Produktcode-Vorschlag nur für Wein in Behältnissen: Schaumwein W300, Stillwein W200, sonst keiner', async () => {
    const { produktcodeVorschlag } = await laden('lib/behoerden/emcsDatenblatt.ts')
    assert.equal(produktcodeVorschlag('2204.10.93'), 'W300')
    assert.equal(produktcodeVorschlag('22041011'), 'W300')
    assert.equal(produktcodeVorschlag('2204.21.79'), 'W200')
    assert.equal(produktcodeVorschlag('2204 22 38'), 'W200')
    assert.equal(produktcodeVorschlag('22042993'), 'W200')
    assert.equal(produktcodeVorschlag('2204.21'), 'W200')          // auch sechsstellig
    assert.equal(produktcodeVorschlag('2204.30.10'), null)         // Traubenmost: kein Vorschlag
    assert.equal(produktcodeVorschlag('2205.10.10'), null)         // Wermut
    assert.equal(produktcodeVorschlag(null), null)
    assert.equal(produktcodeVorschlag(''), null)
  })
  test('Verkehrszweig-Code wie in EMCS; unbekannte Transportart ohne Code', async () => {
    const { verkehrszweig } = await laden('lib/behoerden/emcsDatenblatt.ts')
    assert.deepEqual(verkehrszweig('LKW'), { code: '3', text: 'Straßenverkehr' })
    assert.deepEqual(verkehrszweig('Schiff'), { code: '1', text: 'Seeverkehr' })
    assert.deepEqual(verkehrszweig('Bahn'), { code: '2', text: 'Eisenbahnverkehr' })
    assert.deepEqual(verkehrszweig(' flugzeug '), { code: '4', text: 'Luftverkehr' })
    assert.equal(verkehrszweig('Kurier'), null)
    assert.equal(verkehrszweig(null), null)
  })
  test('Kopf und Zeilen: Werte aus dem Auftrag, Fehlendes bleibt leer – nichts wird geschätzt', async () => {
    const { datenblattKopf, datenblattZeilen } = await laden('lib/behoerden/emcsDatenblatt.ts')
    const auftrag = { referenz: 'EX-2026-0007', versanddatum: '2026-11-20', transport_art: 'LKW', destination_stadt: 'München', destination_land: 'DE',
      kunde_uid: 'DE123456789', emcs_arc_nummer: null, ausfuhr_mrn: null, firmen: { name: 'Weinhandel & Söhne GmbH' } }
    const betrieb = { betrieb_name: 'Weingut Test', betrieb_strasse: 'Hauptstraße 1', betrieb_plz: '2352', betrieb_ort: 'Gumpoldskirchen', betrieb_uid: 'ATU12345678' }
    const kopf = datenblattKopf(auftrag, betrieb, 'EU · B2B')
    assert.equal(kopf.versenderAnschrift, 'Hauptstraße 1, 2352 Gumpoldskirchen')
    assert.equal(kopf.empfaengerName, 'Weinhandel & Söhne GmbH')
    assert.equal(kopf.verkehrszweigCode, '3')
    assert.equal(kopf.arc, null)
    const pos = [
      { positionId: 'p1', position: 1, taric: '2204.21.79', bezeichnung: 'Zierfandler 2025', liter: 450, alkohol: 13.5, nettoKg: 445.5, bruttoKg: 745.5, kartons: 100, flaschen: 600, flaschengroesseMl: 750 },
      { positionId: 'p2', position: 2, taric: '2204.10.93', bezeichnung: 'Sekt brut', liter: 45, alkohol: null, nettoKg: null, bruttoKg: null, kartons: null, flaschen: 60, flaschengroesseMl: 750 },
      { positionId: 'p3', position: 3, taric: null, bezeichnung: 'Fassware', liter: null, alkohol: null, nettoKg: null, bruttoKg: null, kartons: null, flaschen: null, flaschengroesseMl: null },
    ]
    const z = datenblattZeilen(kopf, pos)
    assert.deepEqual(z.map(x => x.produktcode), ['W200', 'W300', null])
    assert.deepEqual(z.map(x => x.knCode), ['22042179', '22041093', null])
    assert.equal(z[0].liter, 450)
    assert.equal(z[0].packstuecke, 100)
    assert.equal(z[1].alkohol, null)
    assert.equal(z[2].liter, null)
    assert.equal(z[2].referenz, 'EX-2026-0007')
    // ohne Betriebsdaten bzw. Transportart: leer statt Platzhalter (die XML schrieb „AT-UID-UNBEKANNT“ bzw. Code 3)
    const leer = datenblattKopf({ referenz: 'EX-1' }, {}, null)
    assert.equal(leer.versenderUid, null)
    assert.equal(leer.versenderAnschrift, null)
    assert.equal(leer.verkehrszweigCode, null)
  })
  test('CSV: Menge in Litern, Produktcode als Vorschlag gekennzeichnet, Codes mit führender Null als Text', async () => {
    const { SPALTEN_EMCS_DATENBLATT, datenblattKopf, datenblattZeilen } = await laden('lib/behoerden/emcsDatenblatt.ts')
    const { csvText } = await laden('lib/csv/index.ts')
    const koepfe = SPALTEN_EMCS_DATENBLATT.map(s => s.kopf)
    for (const k of ['Menge (l)', 'Alkohol (% vol)', 'KN-Code', 'Nettogewicht (kg)', 'Bruttogewicht (kg)', 'Packstücke (Kartons)', 'Verkehrszweig (Code)', 'ARC', 'MRN Ausfuhranmeldung']) assert.ok(koepfe.includes(k), k)
    assert.ok(koepfe.includes('Produktcode (Vorschlag – in EMCS prüfen)'))
    const zeilen = datenblattZeilen(datenblattKopf({ referenz: 'EX-1', transport_art: 'LKW' }, {}, null),
      [{ positionId: 'p1', position: 1, taric: '2204.21.79', bezeichnung: 'GV', liter: 90, alkohol: 12.5, nettoKg: 89.1, bruttoKg: 149.1, kartons: 20, flaschen: 120, flaschengroesseMl: 750 }])
    const text = csvText(zeilen, SPALTEN_EMCS_DATENBLATT)
    const [kopfzeile, erste] = text.replace(/^﻿/, '').split('\r\n')
    const zelle = name => erste.split(';')[kopfzeile.split(';').indexOf(name)]
    assert.equal(zelle('Menge (l)'), '90,00')
    assert.equal(zelle('Alkohol (% vol)'), '12,5')
    assert.equal(zelle('Bruttogewicht (kg)'), '149,10')
    assert.match(zelle('KN-Code'), /22042179/)
    assert.match(zelle('Produktcode (Vorschlag – in EMCS prüfen)'), /W200/)
  })
})

describe('KAN-435 D1: Verdrahtung', () => {
  test('die XML-Route ist weg, nirgends mehr ein Link darauf', () => {
    assert.equal(existsSync(path.join(WURZEL, 'src/app/api/weinexport/[id]/emcs/route.ts')), false)
    const p = quelle('src/app/(dashboard)/weinexport/[id]/EmcsPanel.tsx')
    assert.doesNotMatch(p, /e-AD XML|\/emcs'/)
    assert.match(p, /<Link href=\{'\/weinexport\/' \+ auftragId \+ '\/emcs-datenblatt'\}/)
    assert.match(p, /software:112 übermittelt nichts an EMCS/)
  })
  test('Datenblatt: Seite mit Marker, Vermerk „kein amtliches Dokument“, CSV über die zentrale Route, dieselbe Ladefunktion', () => {
    const s = quelle('src/app/(dashboard)/weinexport/[id]/emcs-datenblatt/page.tsx')
    assert.ok(s.startsWith('// behoerdenmeldung: emcs-datenblatt\n'))
    assert.match(s, /csvPfad\('emcs-datenblatt', \{ id, referenz: k\.referenz \}\)/)
    assert.match(s, /const blatt = await ladeEmcsDatenblatt\(supabase, tenantId, \{ id \}\)/)
    assert.match(s, /\{DATENBLATT_VERMERK\}/)
    assert.match(s, /if \(!einst\?\.modul_export\) redirect\('\/dashboard'\)/)
    const l = quelle('src/lib/behoerden/emcsDatenblatt.ts')
    assert.match(l, /export const DATENBLATT_VERMERK = 'Kein amtliches Dokument – Daten zum Erfassen in EMCS'/)
    assert.match(l, /const erg = await ladeExportauftrag\(supabase, tenantId, p\)/)
    assert.match(l, /\.eq\('tenant_id', tenantId\)/)
    assert.match(l, /if \(error\) throw new AktionsFehler\(/)
    const k = quelle('src/lib/behoerden/katalog/verkehr.ts')
    assert.match(k, /'emcs-datenblatt': \{[^}]*modul: 'modul_export',[^}]*druckPfad: '\/weinexport\/\[id\]\/emcs-datenblatt',/)
    const r = quelle('src/lib/behoerden/register/verkehr.ts')
    assert.match(r, /'emcs-datenblatt': definiereMeldung\(KATALOG_VERKEHR\['emcs-datenblatt'\], \{/)
    assert.match(r, /spalten: SPALTEN_EMCS_DATENBLATT,/)
    assert.match(quelle('src/lib/behoerden/uebersicht.ts'), /'\/weinexport\/\[id\]\/emcs-datenblatt': \{ pfad: '\/weinexport', label: 'Auftrag wählen' \},/)
  })
  test('altes Begleitdokument-Muster: umbenannt, nicht mehr Standard, weiter wählbar und druckbar, ohne VO 436/2009', async () => {
    const d = await import('../../src/lib/export/dokumente.ts')
    const alt = d.EXPORT_DOKUMENTE.find(x => x.art === 'v1v2')
    assert.deepEqual(alt, { art: 'v1v2', label: 'Weinbegleitdokument (altes Muster)', druck: true, standard: false, waehlbar: true })
    assert.ok(!d.EXPORT_STANDARD_DOKUMENTE.includes('v1v2'))
    assert.ok(d.EXPORT_WAEHLBARE_DOKUMENTE.includes('v1v2'))
    assert.match(d.ALTES_MUSTER_HINWEIS, /entspricht nicht dem Weinbegleitdokument nach VO \(EU\) 2018\/273/)
    const r = quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts')
    assert.doesNotMatch(r, /436\/2009|V1\/V2 –|SIMPLIFIED ACCOMPANYING/)
    // der Hinweis steht nur am Bildschirm (.hinweis-leiste ist im Druck ausgeblendet) und läuft über escHtml
    assert.match(r, /<div class="hinweis-leiste"><strong>\$\{e\(ALTES_MUSTER_HINWEIS\)\}<\/strong><\/div>/)
    const c = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
    assert.equal(d.dokumentHinweis('v1v2'), d.ALTES_MUSTER_HINWEIS)
    assert.equal(d.dokumentHinweis('eur1'), null)
    assert.ok(c.includes('{dokumentHinweis(dok.dokument_art) && <p className="text-[11px] text-s112-warn-fg mt-0.5">{dokumentHinweis(dok.dokument_art)}</p>}'))
  })
  test('Hilfe: keine Aussage mehr, die Datei lasse sich in EMCS importieren; kein „V1/V2“ als gültiges Dokument', () => {
    for (const datei of ['src/app/(dashboard)/hilfe/handbuch/page.tsx', 'src/app/(dashboard)/hilfe/faq/page.tsx']) {
      const t = quelle(datei)
      assert.doesNotMatch(t, /e-AD XML Download|importiert werden kann|EU-Zollsystem für Weinbewegungen|Simplified Accompanying Document/, datei)
      assert.match(t, /software:112 übermittelt nichts an EMCS/, datei)
      assert.match(t, /Weinbegleitdokument \(altes Muster\)/, datei)
    }
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /Die frühere Datei „e-AD XML“ gibt es nicht mehr/)
  })
})
