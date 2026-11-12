// KAN-434 (12.11.2026): Weinexport Teil C – Handelsrechnung und Proforma vollständig (Epic KAN-431).
// Befund (Zollrecherche KAN-417 A.4/B.2/B.5, ÖWM-Leitfaden Kap. 1): Der Rechnung fehlten die UID des Kunden, der Hinweis
// auf die Steuerbefreiung, Nebenkosten, Packstücke, Liter und die Ursprungserklärung; eine Proforma gab es nicht.
// Jetzt: Befreiungstext je Lieferfall, Ursprungserklärung je Abkommen (nur angekreuzt, über 6.000 EUR nur mit Nummer),
// Rechnungsbetrag = Warenwert + Fracht + Versicherung, Proforma als zweite Ansicht derselben Bauteile.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ABKOMMEN, ABKOMMEN_NUR_HINWEIS, BEFREIUNG_AUSFUHR, BEFREIUNG_IGL, PROFORMA_VERMERK, URSPRUNG_WERTGRENZE, abkommenFuer, befreiung,
  nebenkostenFehler, nebenkostenWert, rechnungHinweise, rechnungsSumme, ursprungserklaerung,
} from '../../src/lib/export/rechnungTexte.ts'
import { lieferfall } from '../../src/lib/export/grunddaten.ts'
import { exportauftragFehler, exportKopf } from '../../src/lib/export/auftragEingabe.ts'
import { EXPORT_DOKUMENTE, EXPORT_STANDARD_DOKUMENTE, EXPORT_WAEHLBARE_DOKUMENTE, hatDruckansicht } from '../../src/lib/export/dokumente.ts'

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
const ROUTE = 'src/app/api/weinexport/[id]/dokument/[art]/route.ts'
const fall = (land, uid = '') => lieferfall({ destination_land: land, kunde_uid: uid })

describe('KAN-434: Steuerbefreiung je Lieferfall', () => {
  test('EU mit UID = innergemeinschaftliche Lieferung, Drittland = Ausfuhr', () => {
    assert.deepEqual(befreiung(fall('DE', 'DE123456789')), { art: 'igl', text: BEFREIUNG_IGL, label: 'steuerfreie innergemeinschaftliche Lieferung', warnung: null })
    assert.equal(befreiung(fall('CH')).text, BEFREIUNG_AUSFUHR)
    assert.equal(befreiung(fall('US', 'US99')).art, 'ausfuhr', 'im Drittland zählt die UID nicht')
    assert.equal(befreiung(fall('GB')).art, 'ausfuhr')
    assert.match(BEFREIUNG_IGL, /^Steuerfreie innergemeinschaftliche Lieferung gemäß Art\. 6 Abs\. 1 iVm Art\. 7 UStG \/ /)
    assert.match(BEFREIUNG_AUSFUHR, /^Steuerfreie Ausfuhrlieferung gemäß § 6 Abs\. 1 Z 1 iVm § 7 UStG \/ /)
  })
  test('EU ohne UID und Inland: kein Befreiungstext, aber eine Warnung (4A)', () => {
    const b2c = befreiung(fall('DE'))
    assert.equal(b2c.art, 'keine'); assert.equal(b2c.text, null)
    assert.match(b2c.warnung, /nicht steuerfrei – ohne UID des Kunden fällt die Umsatzsteuer des Bestimmungslands an/)
    const inland = befreiung(fall('AT', 'ATU12345678'))
    assert.equal(inland.text, null); assert.match(inland.warnung, /Lieferung im Inland – nicht steuerfrei/)
    const ohneLand = befreiung(fall(''))
    assert.equal(ohneLand.text, null); assert.equal(ohneLand.warnung, null, '„Bestimmungsland fehlt“ meldet schon die Grunddaten-Liste')
  })
})

describe('KAN-434: Nebenkosten und Rechnungsbetrag', () => {
  test('Rechnungsbetrag = Warenwert + Fracht + Versicherung, kaufmännisch auf Cent', () => {
    assert.deepEqual(rechnungsSumme(1000, { fracht_eur: 120, versicherung_eur: '30.005' }), { warenwert: 1000, fracht: 120, versicherung: 30.01, betrag: 1150.01 })
    assert.deepEqual(rechnungsSumme(570.5, {}), { warenwert: 570.5, fracht: null, versicherung: null, betrag: 570.5 })
    assert.equal(rechnungsSumme(0.1, { fracht_eur: 0.2 }).betrag, 0.3)
    assert.equal(rechnungsSumme(100, { fracht_eur: 0 }).fracht, 0, '0 ist ein Wert, nicht „leer“')
  })
  test('Prüfung: leer oder 0 bis 9.999.999,99', () => {
    for (const v of [null, undefined, '', 0, 12.5, '12.50', 9999999.99]) assert.equal(nebenkostenFehler(v, 'Die Fracht'), null, String(v))
    for (const v of [-1, '-1', '12,5', 'abc', 10000000, NaN, Infinity]) assert.match(nebenkostenFehler(v, 'Die Fracht'), /^Die Fracht \(EUR\) muss ein Betrag/, String(v))
    assert.equal(nebenkostenWert(''), null); assert.equal(nebenkostenWert('120.456'), 120.46)
    assert.match(exportauftragFehler({ datum: '2026-11-12', positionen: [], versicherung_eur: -5 }) ?? '', /Die Versicherung \(EUR\)/)
  })
  test('Kopf für die RPC: Beträge als Zahl, Ursprungserklärung nur bei einem Land mit Abkommen', () => {
    const k = exportKopf({ datum: '2026-11-12', fracht_eur: '120.5', versicherung_eur: '', ursprungserklaerung: true }, 'GB')
    assert.deepEqual([k.fracht_eur, k.versicherung_eur, k.ursprungserklaerung], [120.5, null, true])
    assert.equal(exportKopf({ ursprungserklaerung: true }, 'US').ursprungserklaerung, false, 'USA: kein Abkommen')
    assert.equal(exportKopf({ ursprungserklaerung: true }, 'DE').ursprungserklaerung, false)
    assert.equal(exportKopf({ ursprungserklaerung: 'ja' }, 'GB').ursprungserklaerung, false, 'nur ein ausdrückliches Ja')
  })
})

describe('KAN-434: Ursprungserklärung', () => {
  const ohne = {}
  // Schweiz: nach der Wortlaut-Prüfung nur Hinweis (Entscheidung Jörgen 12.11.2026) – kein Präferenzzoll für üblichen Wein
  test('Abkommen: Vereinigtes Königreich, Japan, Südkorea – Brasilien und Schweiz nur als Hinweis (2A)', () => {
    assert.deepEqual(ABKOMMEN.map(a => a.land), ['GB', 'JP', 'KR'])
    assert.equal(abkommenFuer('gb')?.nummer, 'rex'); assert.equal(abkommenFuer('JP')?.nummer, 'rex')
    assert.equal(abkommenFuer('KR')?.nummer, 'ea')
    for (const land of ['CH', 'BR', 'US', 'CN', 'DE', 'AT', '', null]) assert.equal(abkommenFuer(land), null, String(land))
    assert.match(ABKOMMEN_NUR_HINWEIS.BR, /Mercosur/)
    assert.match(ABKOMMEN_NUR_HINWEIS.CH, /keinen Präferenzzoll .* keine Ursprungserklärung auf der Rechnung/)
    const ch = ursprungserklaerung({ land: 'CH', warenwert: 100, gewaehlt: true, betrieb: { betrieb_ea_bewilligung: 'AT/1' } })
    assert.deepEqual([ch.status, ch.zeilen.length, ch.hinweise.length], ['kein_abkommen', 0, 1], 'auch angekreuzt kein Text')
    assert.deepEqual(ursprungserklaerung({ land: 'BR', warenwert: 100, gewaehlt: true, betrieb: ohne }).status, 'kein_abkommen')
    assert.equal(ursprungserklaerung({ land: 'BR', warenwert: 100, gewaehlt: true, betrieb: ohne }).hinweise.length, 1)
    assert.deepEqual(ursprungserklaerung({ land: 'US', warenwert: 100, gewaehlt: true, betrieb: ohne }).hinweise, [])
  })
  test('amtlicher Wortlaut je Abkommen (Stand der Prüfung 12.11.2026)', () => {
    const z = (land, betrieb = ohne, wert = 5000) => ursprungserklaerung({ land, warenwert: wert, gewaehlt: true, betrieb }).zeilen
    assert.deepEqual(z('GB', { betrieb_rex_nummer: 'ATREX123' }), [
      'The exporter of the products covered by this document (Exporter Reference No ATREX123) declares that, except where otherwise clearly indicated, these products are of European Union preferential origin.'])
    assert.deepEqual(z('JP', { betrieb_rex_nummer: 'ATREX123' }), [
      'The exporter of the products covered by this document (Exporter Reference No ATREX123) declares that, except where otherwise clearly indicated, these products are of European Union preferential origin.',
      '(Origin criteria used) ............'])
    assert.deepEqual(z('KR', { betrieb_ea_bewilligung: 'AT/123/45' }), [
      'The exporter of the products covered by this document (customs authorisation No AT/123/45) declares that, except where otherwise clearly indicated, these products are of European Union preferential origin.'])
  })
  test('bis 6.000 EUR ohne Nummer: Referenz bleibt frei (GB, JP), Worte in Klammern entfallen (KR)', () => {
    const z = land => ursprungserklaerung({ land, warenwert: URSPRUNG_WERTGRENZE, gewaehlt: true, betrieb: ohne })
    assert.equal(z('GB').status, 'ok')
    assert.match(z('GB').zeilen[0], /this document \(Exporter Reference No \.{12}\) declares/)
    assert.match(z('KR').zeilen[0], /covered by this document declares that/)
    assert.equal(z('KR').unterschrift, 'Unterschrift des Ausführers und Name in Blockschrift / Signature of the exporter and name in clear script')
    assert.match(z('JP').unterschrift, /Printed name of the exporter/)
  })
  test('über 6.000 EUR ohne Nummer wird nicht gedruckt (3A); die falsche Nummer zählt nicht', () => {
    const u = ursprungserklaerung({ land: 'GB', warenwert: 6000.01, gewaehlt: true, betrieb: { betrieb_ea_bewilligung: 'AT/1' } })
    assert.equal(u.status, 'nummer_fehlt'); assert.deepEqual(u.zeilen, [])
    assert.match(u.hinweise[0], /über 6\.000 EUR, die REX-Nummer \(Registrierter Ausführer\) des Betriebs fehlt .* wird nicht gedruckt/)
    const kr = ursprungserklaerung({ land: 'KR', warenwert: 9000, gewaehlt: true, betrieb: { betrieb_rex_nummer: 'ATREX1' } })
    assert.equal(kr.status, 'nummer_fehlt'); assert.match(kr.hinweise[0], /nur ein Ermächtigter Ausführer/)
    assert.equal(ursprungserklaerung({ land: 'GB', warenwert: 9000, gewaehlt: true, betrieb: { betrieb_rex_nummer: ' ATREX1 ' } }).status, 'ok')
  })
  test('nur angekreuzt (1A): sonst kein Text, aber eine Erinnerung', () => {
    for (const v of [false, undefined, null, 'true', 1]) {
      const u = ursprungserklaerung({ land: 'GB', warenwert: 100, gewaehlt: v, betrieb: { betrieb_rex_nummer: 'X' } })
      assert.equal(u.status, 'nicht_gewaehlt', String(v)); assert.deepEqual(u.zeilen, [])
      assert.match(u.hinweise[0], /Präferenzabkommen .* nicht angekreuzt/)
    }
    assert.equal(exportKopf({ ursprungserklaerung: true }, 'CH').ursprungserklaerung, false, 'Schweiz: kein Ankreuzfeld, also nie gespeichert')
    assert.match(ursprungserklaerung({ land: 'JP', warenwert: 100, gewaehlt: true, betrieb: ohne }).hinweise[0], /Ursprungskriterium .* von Hand eintragen/)
  })
  test('Hinweise für Leiste und Liste: Steuerwarnung und Ursprung zusammen', () => {
    assert.deepEqual(rechnungHinweise({ auftrag: { destination_land: 'DE', kunde_uid: 'DE123456789' }, betrieb: {}, warenwert: 100 }), [])
    assert.equal(rechnungHinweise({ auftrag: { destination_land: 'DE' }, betrieb: {}, warenwert: 100 }).length, 1)
    assert.equal(rechnungHinweise({ auftrag: { destination_land: 'GB', ursprungserklaerung: true }, betrieb: {}, warenwert: 7000 }).length, 1)
    assert.deepEqual(rechnungHinweise({ auftrag: { destination_land: 'GB', ursprungserklaerung: true }, betrieb: {}, warenwert: 700 }), [])
  })
})

describe('KAN-434: Druckansichten', () => {
  const r = quelle(ROUTE)
  const teil = r.slice(r.indexOf("    case 'rechnung':\n    case 'proforma': {"), r.indexOf("    case 'packliste': {"))
  test('Proforma ist ein wählbares Dokument mit Druckansicht, kein Standard (6A)', () => {
    assert.ok(EXPORT_WAEHLBARE_DOKUMENTE.includes('proforma'))
    assert.ok(!EXPORT_STANDARD_DOKUMENTE.includes('proforma'))
    assert.equal(hatDruckansicht('proforma'), true)
    assert.equal(EXPORT_DOKUMENTE.find(d => d.art === 'proforma')?.label, 'Proforma-Rechnung')
    assert.ok(teil.length > 1000, 'Rechnung und Proforma teilen sich einen Fall')
    assert.match(PROFORMA_VERMERK, /keine Zahlungsaufforderung \/ Pro forma invoice – not a demand for payment/)
    assert.match(teil, /\$\{proforma \? `<div class="muster">\$\{e\(PROFORMA_VERMERK\)\}<\/div>` : ''\}/)
    assert.match(teil, /\$\{!proforma && b\.rechnung_iban \? /, 'Bankverbindung nur auf der Rechnung')
  })
  test('alle Pflichtangaben stehen auf der Rechnung', () => {
    for (const s of [
      'UID / VAT No.: ${e(b.betrieb_uid ?? \'–\')}', 'UID / VAT No.: ${e(a.kunde_uid ?? \'–\')}', 'EORI: ${e(b.betrieb_eori ?? \'–\')}',
      'Versanddatum / Shipped on', 'Lieferbedingung / Delivery Term', 'Zahlungsbedingungen / Payment Terms', 'KN-Code / CN',
      'Warenwert / Value of goods', "nebenzeile('Fracht / Freight', summe.fracht)", "nebenzeile('Versicherung / Insurance', summe.versicherung)",
      'Packstücke / Packages', 'Nettogewicht / Net weight', 'Bruttogewicht / Gross weight', 'summen?.literWeiss', 'summen?.literRot',
      'Ursprungsland / Country of Origin', '${steuer.text ? `<div class="steuer">${e(steuer.text)}</div>` : \'\'}',
    ]) assert.ok(teil.includes(s), `Rechnung ohne ${s}`)
    assert.match(teil, /const summe = rechnungsSumme\(gesamtEUR, a\)/)
    assert.match(teil, /\$\{e\(eurText\(summe\.betrag\)\)\}/)
  })
  test('Ursprungserklärung nur im Status ok, Zeilen und Beschriftung über das Escaping', () => {
    assert.match(teil, /const ursprung = ursprungserklaerung\(\{ land: a\.destination_land, warenwert: gesamtEUR, gewaehlt: a\.ursprungserklaerung, betrieb: b \}\)/)
    assert.match(teil, /\$\{ursprung\.status === 'ok' \? `<div class="ursprung">/)
    assert.match(teil, /ursprung\.zeilen\.map\(z => `<div>\$\{e\(z\)\}<\/div>`\)/)
    assert.match(teil, /<div class="sign-box">\$\{e\(ursprung\.unterschrift \?\? ''\)\}<\/div>/)
    assert.doesNotMatch(teil, /\$\{(a|b|p|summe|steuer|ursprung)\??\.[\w?.]+\}/, 'kein Wert ungeschützt im HTML')
  })
  test('Betrieb: Nummern für die Erklärung werden mitgeladen', () => {
    assert.match(r, /betrieb_uid,betrieb_eori,betrieb_rex_nummer,betrieb_ea_bewilligung,rechnung_iban/)
  })
})

describe('KAN-434: Verdrahtung', () => {
  test('Migration: Spalten, Spaltenrechte, RPC an genau einer Stelle, Positivliste bleibt', () => {
    const m = migration('kan434_rechnung_angaben')
    assert.match(m, /ADD COLUMN fracht_eur          numeric\(12,2\) CONSTRAINT exportauftraege_fracht_chk CHECK \(fracht_eur IS NULL OR fracht_eur >= 0\)/)
    assert.match(m, /ADD COLUMN ursprungserklaerung boolean NOT NULL DEFAULT false;/)
    assert.match(m, /GRANT SELECT \(betrieb_rex_nummer, betrieb_ea_bewilligung\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    assert.match(m, /ursprungserklaerung = coalesce\(p_kopf ->> ''ursprungserklaerung'', ''''\) = ''true''/)
    assert.match(m, /<> 1 THEN\n    RAISE EXCEPTION 'KAN-434: /)
    assert.doesNotMatch(m, /CREATE TRIGGER|s112_freeze\(/)
  })
  test('Anlegen, Bearbeiten, Formular, Einstellungen, Schema', () => {
    const post = quelle('src/app/api/weinexport/route.ts')
    assert.match(post, /fracht_eur:          kopfNeu\.fracht_eur,\s+versicherung_eur:    kopfNeu\.versicherung_eur,\s+ursprungserklaerung: kopfNeu\.ursprungserklaerung,/)
    assert.match(quelle('src/app/(dashboard)/weinexport/[id]/bearbeiten/page.tsx'), /mustersendung, fracht_eur, versicherung_eur, ursprungserklaerung'\)/)
    const f = quelle('src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx')
    assert.match(f, /const abkommen = abkommenFuer\(destLand\)/)
    assert.match(f, /\{abkommen && \(/, 'Ankreuzfeld nur bei einem Land mit Abkommen')
    assert.match(f, /ursprungserklaerung: ursprung && abkommen !== null,/)
    assert.match(f, /aria-label="Fracht \(EUR\)"/); assert.match(f, /aria-label="Versicherung \(EUR\)"/)
    const a = quelle('src/app/(dashboard)/betrieb/einstellungen/actions.ts')
    assert.match(a, /betrieb_rex_nummer:        \(\(formData\.get\('betrieb_rex_nummer'\) as string \| null\) \?\? ''\)\.trim\(\)\.slice\(0, 40\) \|\| null,/)
    assert.match(a, /betrieb_ea_bewilligung:    /)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['fracht_eur', 'versicherung_eur', 'ursprungserklaerung']) assert.ok(schema.exportauftraege.includes(s), s)
    for (const s of ['betrieb_rex_nummer', 'betrieb_ea_bewilligung']) assert.ok(schema.tenant_einstellungen.includes(s), s)
  })
  test('Lader und CSV: Hinweise zur Rechnung, vier Spalten am Ende, Rechnungsbetrag aus den gerundeten Zeilen', () => {
    const l = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.match(l, /\.select\('betrieb_uid, betrieb_eori, betrieb_rex_nummer, betrieb_ea_bewilligung'\)/)
    assert.match(l, /\.\.\.rechnungHinweise\(\{ auftrag, betrieb: \(cfgRes\.data \?\? \{\}\) as R, warenwert: summeGerundet\(zeilen\.map\(z => z\.wertEur\)\) \}\)/)
    assert.match(l, /const summe = rechnungsSumme\(summeGerundet\(zeilen\.map\(z => z\.wertEur\)\), auftrag\)/)
    const spalten = l.slice(l.indexOf('export const SPALTEN_EXPORTAUFTRAG'), l.indexOf('function zahlOderNull'))
    const koepfe = [...spalten.matchAll(/kopf: '([^']+)'/g)].map(x => x[1])
    assert.deepEqual(koepfe.slice(-4), ['Fracht (€)', 'Versicherung (€)', 'Rechnungsbetrag (€)', 'Steuerbefreiung'])
  })
})
