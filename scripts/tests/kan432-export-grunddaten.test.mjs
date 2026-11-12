// KAN-432 (12.11.2026): Weinexport Teil A – Grunddaten am Exportauftrag (Epic KAN-431).
// Befund (Zollrecherche KAN-417, ÖWM-Leitfaden): Dem Auftrag fehlten Lieferfall (EU/Drittland, B2B/B2C), UID des Kunden,
// Versanddatum, Zahlungsbedingungen, Packstücke, Liter und Alkohol; die Rechnungsansicht zeigte unter
// „Zahlungsbedingungen“ den Incoterm. Jetzt abgeleitet aus Füllung, Prüfnummernantrag, Analyse, Kunde und Betrieb –
// fehlende Werte werden nie geschätzt, sondern als Hinweis gezeigt.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  alkoholAus, farbeAus, flaschenDerPosition, flaschenJeKarton, grunddatenHinweise, grunddatenPosition, grunddatenSummen,
  juengsteAnalyse, kartonFehler, knAchtstellig, kundeUidFehler, lieferfall, packstuecke, uidBereinigt, zahlungsbedingungenVorschlag,
} from '../../src/lib/export/grunddaten.ts'
import { exportauftragFehler, exportKopf, exportPositionen } from '../../src/lib/export/auftragEingabe.ts'
import { positionsGewicht } from '../../src/lib/export/gewicht.ts'

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

const FUELLUNG = { id: 'f1', name: 'Zierfandler', jahrgang: 2025, rebsorte: 'Zierfandler', weinart: 'weiss', flaschengroesse_ml: 750, pruefnummer: 'N 12345/26', weinausbau_id: 'c1' }
const pos = (teil = {}) => ({ menge: 30, einheit: 'Fl', flaschen_je_karton: 6, taric_code: '2204.2138', fuellung: FUELLUNG, antrag: { alkohol_prozent: 12.5 }, analyseAlkohol: 12.8, ...teil })

describe('KAN-432: Lieferfall', () => {
  test('EU, Drittland, Inland aus dem Bestimmungsland; B2B nur mit UID', () => {
    assert.deepEqual(lieferfall({ destination_land: 'DE', kunde_uid: 'DE123456789' }), { gebiet: 'eu', kunde: 'b2b', label: 'EU · B2B' })
    assert.deepEqual(lieferfall({ destination_land: 'DE', kunde_uid: '' }), { gebiet: 'eu', kunde: 'b2c', label: 'EU · B2C' })
    assert.equal(lieferfall({ destination_land: 'CH', kunde_uid: 'CHE-123.456.789' }).label, 'Drittland · B2B')
    assert.equal(lieferfall({ destination_land: 'GB' }).gebiet, 'drittland')   // seit dem Brexit Drittland
    assert.equal(lieferfall({ destination_land: 'US' }).label, 'Drittland · B2C')
    assert.equal(lieferfall({ destination_land: 'at' }).gebiet, 'inland')
    assert.equal(lieferfall({ destination_land: '' }).label, 'Land fehlt · B2C')
    assert.equal(lieferfall({ destination_land: 'XX' }).gebiet, null)
  })
  test('UID: bereinigt (ohne Leerzeichen, groß), Länderkürzel vorn, höchstens 20 Zeichen', () => {
    assert.equal(uidBereinigt(' de 123 456 789 '), 'DE123456789')
    assert.equal(kundeUidFehler(''), null)
    assert.equal(kundeUidFehler('atu12345678'), null)
    assert.match(kundeUidFehler('123456789'), /Länderkürzel/)
    assert.match(kundeUidFehler('DE' + '1'.repeat(19)), /höchstens 20 Zeichen/)
  })
  test('Zahlungsbedingungen aus dem Zahlungsziel', () => {
    assert.equal(zahlungsbedingungenVorschlag(30), 'Zahlbar innerhalb von 30 Tagen netto')
    assert.equal(zahlungsbedingungenVorschlag('14'), 'Zahlbar innerhalb von 14 Tagen netto')
    assert.equal(zahlungsbedingungenVorschlag(0), 'Zahlbar sofort ohne Abzug')
    for (const w of [null, undefined, '', -1, 2.5, 'abc']) assert.equal(zahlungsbedingungenVorschlag(w), '', String(w))
  })
})

describe('KAN-432: Packstücke', () => {
  test('Flaschen je Karton: ganze Zahl 1–60', () => {
    assert.equal(flaschenJeKarton('6'), 6)
    assert.equal(flaschenJeKarton(12), 12)
    for (const w of [0, 61, 2.5, '', null, 'abc']) assert.equal(flaschenJeKarton(w), null, String(w))
    assert.equal(kartonFehler(''), null)
    assert.equal(kartonFehler('12'), null)
    assert.match(kartonFehler('61'), /ganze Zahl von 1 bis 60/)
  })
  test('Kartons aufgerundet, Anbruch sichtbar; „Kiste“ = Menge × Flaschen je Kiste; lose Ware ohne Flaschen', () => {
    assert.deepEqual(packstuecke({ menge: 30, einheit: 'Fl', flaschen_je_karton: 6 }), { kartons: 5, anbruch: 0 })
    assert.deepEqual(packstuecke({ menge: 32, einheit: 'Fl', flaschen_je_karton: 6 }), { kartons: 6, anbruch: 2 })
    assert.equal(flaschenDerPosition({ menge: 10, einheit: 'Kiste', flaschen_je_karton: 6 }), 60)
    assert.deepEqual(packstuecke({ menge: 10, einheit: 'Kiste', flaschen_je_karton: 6 }), { kartons: 10, anbruch: 0 })
    assert.equal(flaschenDerPosition({ menge: 10, einheit: 'Kiste' }), null)
    assert.equal(flaschenDerPosition({ menge: 2, einheit: 'HL', flaschen_je_karton: 6 }), null)
    assert.equal(packstuecke({ menge: 30, einheit: 'Fl' }), null)
  })
  test('Gewicht: eine Kiste rechnet über die Flaschen je Kiste – ohne Angabe bleibt das Gewicht leer', () => {
    const f = { flaschengroesse_ml: 750, leergewicht_g: 500 }
    const flaschen = positionsGewicht({ menge: 60, einheit: 'Fl', fuellung: f })
    const kisten = positionsGewicht({ menge: 10, einheit: 'Kiste', flaschen_je_karton: 6, fuellung: f })
    assert.deepEqual(kisten, flaschen)
    assert.equal(kisten.liter, 45)
    assert.equal(positionsGewicht({ menge: 10, einheit: 'Kiste', fuellung: f }).fehlt, 'kiste')
    assert.equal(positionsGewicht({ menge: 10, einheit: 'Kiste', flaschen_je_karton: 0, fuellung: f }).bruttoKg, null)
  })
})

describe('KAN-432: aus der Füllung abgeleitet', () => {
  test('Alkohol: Prüfnummernantrag vor der jüngsten Analyse, sonst unbekannt (nie geschätzt)', () => {
    assert.deepEqual(alkoholAus(12.5, 12.8), { wert: 12.5, quelle: 'pruefnummernantrag' })
    assert.deepEqual(alkoholAus(null, '12.84'), { wert: 12.8, quelle: 'analyse' })
    assert.deepEqual(alkoholAus(0, 13), { wert: 13, quelle: 'analyse' })
    assert.equal(alkoholAus(null, null), null)
    assert.equal(alkoholAus('', 0), null)
  })
  test('jüngste Analyse: nach Datum, dann Erfassungszeitpunkt – Analysen ohne Alkoholwert zählen nicht', () => {
    const a = [
      { id: '1', analyse_datum: '2026-09-01', created_at: '2026-09-01T08:00:00Z', alkohol_vol: 12.1 },
      { id: '2', analyse_datum: '2026-10-05', created_at: '2026-10-05T08:00:00Z', alkohol_vol: 12.6 },
      { id: '3', analyse_datum: '2026-10-05', created_at: '2026-10-05T15:00:00Z', alkohol_vol: 12.7 },
      { id: '4', analyse_datum: '2026-11-01', created_at: '2026-11-01T08:00:00Z', alkohol_vol: null },
    ]
    assert.equal(juengsteAnalyse(a).id, '3')
    assert.equal(juengsteAnalyse([...a].reverse()).id, '3')
    assert.equal(juengsteAnalyse([a[3]]), null)
    assert.equal(juengsteAnalyse([]), null)
  })
  test('Farbe und KN-Code', () => {
    assert.equal(farbeAus('weiss'), 'weiss')
    assert.equal(farbeAus('Rose'), 'rose')
    assert.equal(farbeAus('orange'), null)
    assert.equal(knAchtstellig('2204.2138'), true)
    assert.equal(knAchtstellig('2204 21 38'), true)
    assert.equal(knAchtstellig('2204.21'), false)   // der bisherige Standardwert ist nur sechsstellig
    assert.equal(knAchtstellig(''), false)
  })
  test('Position: Liter, Kartons, Alkohol, Prüfnummer, Farbe – ohne Füllung bleibt alles leer', () => {
    assert.deepEqual(grunddatenPosition(pos()), {
      flaschen: 30, liter: 22.5, kartons: 5, anbruch: 0, flaschenJeKarton: 6, alkohol: 12.5, alkoholQuelle: 'pruefnummernantrag',
      pruefnummer: 'N 12345/26', farbe: 'weiss', rebsorte: 'Zierfandler', jahrgang: '2025', knAchtstellig: true,
    })
    const frei = grunddatenPosition({ menge: 12, einheit: 'Fl', beschreibung: 'Geschenkkarton', taric_code: '2204.21', analyseAlkohol: 12 })
    assert.deepEqual([frei.liter, frei.alkohol, frei.pruefnummer, frei.farbe, frei.kartons, frei.knAchtstellig], [null, null, null, null, null, false])
    assert.equal(grunddatenPosition({ menge: 2, einheit: 'HL', fuellung: FUELLUNG }).liter, 200)
    // Prüfnummer der Füllung fehlt → die des Antrags
    assert.equal(grunddatenPosition(pos({ fuellung: { ...FUELLUNG, pruefnummer: null }, antrag: { alkohol_prozent: 12.5, pruefnummer: 'N 999/26' } })).pruefnummer, 'N 999/26')
  })
  test('Summen: Liter weiß und rot (Rosé zählt zu rot); unvollständig bleibt unvollständig', () => {
    const s = grunddatenSummen([
      grunddatenPosition(pos()),
      grunddatenPosition(pos({ menge: 12, fuellung: { ...FUELLUNG, weinart: 'rot' } })),
      grunddatenPosition(pos({ menge: 6, fuellung: { ...FUELLUNG, weinart: 'rose' } })),
    ])
    assert.deepEqual(s, { flaschen: 48, kartons: 8, liter: 36, literWeiss: 22.5, literRot: 13.5, literOhneFarbe: 0 })
    const u = grunddatenSummen([grunddatenPosition(pos()), grunddatenPosition({ menge: 6, einheit: 'Fl', taric_code: '2204.21' })])
    assert.equal(u.liter, null)
    assert.equal(u.kartons, null)
    assert.equal(u.flaschen, 36)
  })
})

describe('KAN-432: Hinweisliste „Für die Dokumente fehlt noch …“', () => {
  const basis = { auftragId: 'a1', betrieb: { betrieb_uid: 'ATU1', betrieb_eori: null }, bearbeitbar: true }
  const mit = (auftrag, positionen = [pos()]) => grunddatenHinweise({ ...basis, auftrag,
    positionen: positionen.map(eingabe => ({ eingabe, daten: grunddatenPosition(eingabe) })) }).map(h => h.text)

  test('vollständiger EU-Auftrag: keine Hinweise', () => {
    assert.deepEqual(mit({ destination_land: 'DE', kunde_uid: 'DE1234', versanddatum: '2026-11-20', zahlungsbedingungen: '30 Tage' }), [])
  })
  test('Kopf: Versanddatum, Zahlungsbedingungen, UID bei EU, EORI bei Drittland, Inland', () => {
    const eu = mit({ destination_land: 'DE' })
    assert.ok(eu.some(t => /Versanddatum fehlt/.test(t)))
    assert.ok(eu.some(t => /Zahlungsbedingungen fehlen/.test(t)))
    assert.ok(eu.some(t => /UID des Kunden fehlt/.test(t)))
    assert.ok(!eu.some(t => /EORI/.test(t)))
    const dritt = mit({ destination_land: 'CH', versanddatum: '2026-11-20', zahlungsbedingungen: 'x' })
    assert.deepEqual(dritt, ['EORI-Nummer des Betriebs fehlt (Ausfuhr in ein Drittland).'])
    assert.ok(mit({ destination_land: 'AT' }).some(t => /keine Ausfuhr/.test(t)))
    assert.ok(mit({}).some(t => /Bestimmungsland fehlt/.test(t)))
  })
  test('Füllung: fehlender Alkohol, Prüfnummer, Farbe je Füllung nur einmal – mit Link zur Pflegestelle', () => {
    const ohne = pos({ fuellung: { ...FUELLUNG, pruefnummer: null, weinart: null }, antrag: null, analyseAlkohol: null })
    const h = grunddatenHinweise({ ...basis, auftrag: { destination_land: 'DE', kunde_uid: 'DE1', versanddatum: '2026-11-20', zahlungsbedingungen: 'x' },
      positionen: [ohne, ohne].map(eingabe => ({ eingabe, daten: grunddatenPosition(eingabe) })) })
    assert.deepEqual(h.map(x => x.text), [
      '„Zierfandler 2025“: Alkohol fehlt (weder Prüfnummernantrag noch Analyse mit Alkoholwert).',
      '„Zierfandler 2025“: Prüfnummer fehlt.',
      '„Zierfandler 2025“: Weinart (weiß, rot, rosé) fehlt.',
    ])
    assert.deepEqual(h.map(x => x.href), ['/kellerbuch/weinausbau/c1', '/weinhandel/fuellungen/f1/edit', '/weinhandel/fuellungen/f1/edit'])
  })
  test('Position: ohne Füllung, ohne Flaschen je Karton, KN-Code nicht achtstellig; lose Ware braucht beides nicht', () => {
    const t = mit({ destination_land: 'DE', kunde_uid: 'DE1', versanddatum: '2026-11-20', zahlungsbedingungen: 'x' }, [
      { menge: 6, einheit: 'Fl', beschreibung: 'frei', taric_code: '2204.21' },
      pos({ einheit: 'Kiste', flaschen_je_karton: null }),
      { menge: 2, einheit: 'HL', beschreibung: 'Fasswein', taric_code: '22042938' },
    ])
    assert.deepEqual(t, [
      'Position 1 hat keine Füllung – Liter, Alkohol, Prüfnummer und Farbe fehlen.',
      'Position 1: Flaschen je Karton fehlen – Packstücke nicht bestimmbar.',
      'Position 1: Zolltarifnummer „2204.21“ ist nicht achtstellig (KN-Code).',
      'Position 2: Flaschen je Karton fehlen – Packstücke, Liter und Gewicht nicht bestimmbar.',
    ])
  })
  test('gesperrter Auftrag: Hinweise des Auftrags ohne Link, Stammdaten bleiben verlinkt', () => {
    const h = grunddatenHinweise({ ...basis, bearbeitbar: false, auftrag: { destination_land: 'CH' }, positionen: [] })
    assert.equal(h.find(x => /Versanddatum/.test(x.text)).href, null)
    assert.equal(h.find(x => /EORI/.test(x.text)).href, '/betrieb/einstellungen')
  })
})

describe('KAN-432: Eingabeprüfung und Form für die Datenbank', () => {
  test('neue Felder werden geprüft – dieselbe Funktion in Formular, POST und PUT', () => {
    const ok = { positionen: [{ beschreibung: 'x', menge: 1, flaschen_je_karton: '6' }] }
    assert.equal(exportauftragFehler({ ...ok, versanddatum: '2026-11-20', zahlungsbedingungen: '30 Tage netto', kunde_uid: 'DE123456789' }), null)
    assert.match(exportauftragFehler({ ...ok, versanddatum: '20.11.2026' }), /Versanddatum/)
    assert.match(exportauftragFehler({ ...ok, zahlungsbedingungen: 'x'.repeat(301) }), /höchstens 300 Zeichen/)
    assert.match(exportauftragFehler({ ...ok, kunde_uid: '12345' }), /Länderkürzel/)
    assert.match(exportauftragFehler({ positionen: [{ beschreibung: 'x', menge: 1, flaschen_je_karton: '61' }] }), /Position 1: Flaschen je Karton/)
  })
  test('Kopf und Positionen: UID bereinigt, Flaschen je Karton als Zahl bzw. null', () => {
    const k = exportKopf({ datum: '2026-11-12', versanddatum: '2026-11-20', zahlungsbedingungen: ' 30 Tage ', kunde_uid: ' de 123 ' }, 'DE')
    assert.deepEqual([k.versanddatum, k.zahlungsbedingungen, k.kunde_uid], ['2026-11-20', '30 Tage', 'DE123'])
    assert.deepEqual(exportKopf({}, null).kunde_uid, null)
    assert.deepEqual(exportPositionen({ positionen: [{ menge: 6, flaschen_je_karton: '12' }, { menge: 6, flaschen_je_karton: '' }] }).map(p => p.flaschen_je_karton), [12, null])
  })
})

describe('KAN-432: Migration', () => {
  const m = migration('kan432_export_grunddaten')
  test('Spalten mit Grenzen; Betriebsvorgaben nur lesbar', () => {
    assert.match(m, /ADD COLUMN versanddatum        date,/)
    assert.match(m, /char_length\(zahlungsbedingungen\) <= 300/)
    assert.match(m, /char_length\(kunde_uid\) <= 20/)
    assert.match(m, /flaschen_je_karton IS NULL OR flaschen_je_karton BETWEEN 1 AND 60/)
    assert.match(m, /export_flaschen_je_karton smallint NOT NULL DEFAULT 6/)
    assert.match(m, /GRANT SELECT \(betrieb_eori, kleiner_weinerzeuger, export_flaschen_je_karton\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    assert.doesNotMatch(m, /GRANT UPDATE/)
  })
  test('die Freeze-Positivliste bleibt unverändert – neue Spalten sind ab „Versendet“ gesperrt', () => {
    assert.doesNotMatch(m, /CREATE TRIGGER a_freeze|s112_freeze\(/)
    const alt = migration('kan429_exportauftrag_aendern')
    for (const s of ['versanddatum', 'zahlungsbedingungen', 'kunde_uid']) assert.ok(!alt.slice(alt.indexOf('CREATE TRIGGER a_freeze'), alt.indexOf('-- ── 2.')).includes(s), s)
  })
  test('RPC nimmt die neuen Felder – vier Ankerstellen, jede genau einmal', () => {
    assert.match(m, /versanddatum        = NULLIF\(p_kopf ->> ''versanddatum'', ''''\)::date/)
    assert.match(m, /kunde_uid           = NULLIF\(upper\(regexp_replace/)
    assert.match(m, /sort_order, flaschen_je_karton\)/)
    assert.match(m, /Flaschen je Karton bitte als ganze Zahl von 1 bis 60 angeben/)
    assert.match(m, /<> 1 THEN\s+RAISE EXCEPTION 'KAN-432: s112_exportauftrag_aendern – Ankerstelle nicht genau einmal gefunden/)
  })
})

describe('KAN-432: Verdrahtung', () => {
  test('Lader: Alkohol aus nicht storniertem Antrag bzw. Analyse, in Blöcken, Fehler führen zum Abbruch', () => {
    const l = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.match(l, /flaschen_je_karton, fuellungen\(id,name,jahrgang,bezeichnung,flaschengroesse_ml,leergewicht_g,rebsorte,weinart,pruefnummer,weinausbau_id,dac_antrag_id\)/)
    assert.match(l, /ladeInBloecken<R>\(antragIds, b => alle<R>\(\(supabase\.from\('dac_antrag'\) as any\)\s+\.select\('id, alkohol_prozent, pruefnummer'\)\.eq\('tenant_id', tenantId\)\.in\('id', b\)\.is\('storniert_am', null\)/)
    assert.match(l, /\.from\('weinanalysen'\) as any\)\s+\.select\('id, weinausbau_id, analyse_datum, created_at, alkohol_vol'\)\.eq\('tenant_id', tenantId\)\.in\('weinausbau_id', b\)\.is\('storniert_am', null\)/)
    assert.match(l, /if \(antragRes\.error\) throw new AktionsFehler/)
    assert.match(l, /if \(analyseRes\.error\) throw new AktionsFehler/)
    assert.match(l, /bearbeitbar: exportBearbeitbar\(auftrag as/)
  })
  test('CSV: neue Spalten – Kopf nach dem Lieferdatum, Positionsangaben am Ende', () => {
    const l = quelle('src/lib/behoerden/exportauftrag.ts')
    const spalten = l.slice(l.indexOf('export const SPALTEN_EXPORTAUFTRAG'), l.indexOf('function zahlOderNull'))
    const koepfe = [...spalten.matchAll(/kopf: '([^']+)'/g)].map(x => x[1])
    assert.deepEqual(koepfe.slice(0, 7), ['Referenz', 'Datum', 'Lieferdatum', 'Versanddatum', 'Importeur', 'UID Importeur', 'Lieferfall'])
    assert.deepEqual(koepfe.slice(-8), ['Flaschen', 'Flaschen je Karton', 'Kartons', 'Alkohol (% vol)', 'Prüfnummer', 'Farbe', 'Rebsorte', 'Jahrgang'])
  })
  test('Anlegen und Bearbeiten speichern die neuen Felder', () => {
    const post = quelle('src/app/api/weinexport/route.ts')
    assert.match(post, /versanddatum:        kopfNeu\.versanddatum,\s+zahlungsbedingungen: kopfNeu\.zahlungsbedingungen,\s+kunde_uid:           kopfNeu\.kunde_uid,/)
    assert.match(post, /flaschen_je_karton: posNeu\[i\]\?\.flaschen_je_karton \?\? null/)
    assert.ok(post.indexOf('exportauftragFehler(body)') < post.indexOf('const kopfNeu = exportKopf(body, destinationLand)'))
    const b = quelle('src/app/(dashboard)/weinexport/[id]/bearbeiten/page.tsx')
    assert.match(b, /notizen, versanddatum, zahlungsbedingungen, kunde_uid, mustersendung'\)/)   // KAN-433: + mustersendung
    assert.match(b, /sort_order, flaschen_je_karton'\)/)
  })
  test('Formular: Felder mit Längengrenze, Vorschlag aus Kunde und Betrieb, Flaschen je Karton je Position', () => {
    const f = quelle('src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx')
    assert.match(f, /aria-label="UID-Nummer Importeur" maxLength=\{KUNDE_UID_MAX\}/)
    assert.match(f, /aria-label="Zahlungsbedingungen" maxLength=\{ZAHLUNGSBEDINGUNGEN_MAX\}/)
    assert.match(f, /aria-label="Versanddatum" type="date"/)
    assert.match(f, /aria-label=\{`Flaschen je Karton \$\{i \+ 1\}`\}/)
    assert.match(f, /flaschen_je_karton: kartonStandard \}\]\)/)
    assert.match(f, /zahlungsbedingungen: zahlung\.trim\(\) \|\| null,\s+kunde_uid: kundeUid\.trim\(\) \|\| null,/)
    for (const p of ['neu/page.tsx', '[id]/bearbeiten/page.tsx']) {
      const s = quelle(`src/app/(dashboard)/weinexport/${p}`)
      assert.match(s, /select\('id,name,uid_nummer,zahlungsziel_tage'\)/, p)
      assert.match(s, /vorgaben=\{\{ flaschenJeKarton: flaschenJeKarton\(einst\?\.export_flaschen_je_karton\) \?\? KARTON_STANDARD/, p)
    }
  })
  test('Detailseite: Lieferfall, Hinweisliste (nicht bei Storno), abgeleitete Spalten und Summen', () => {
    const d = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
    assert.match(d, /\{!auftrag\.storniert_am && grunddaten\.hinweise\.length > 0 && \(/)
    assert.match(d, /Für die Dokumente fehlt noch:/)
    assert.match(d, /\{grunddaten\.lieferfall\.label\}/)
    assert.match(d, /l weiß · \{fmtNum\(grunddaten\.summen\.literRot/)
    assert.match(quelle('src/app/(dashboard)/weinexport/[id]/page.tsx'), /grunddaten=\{ergebnis\.grunddaten\}/)
  })
  test('Rechnungsansicht: Lieferbedingungen = Incoterm, Zahlungsbedingungen = eigenes Feld', () => {
    const r = quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts')
    assert.match(r, /<strong>Lieferbedingungen \/ Delivery Terms:<\/strong> \$\{e\(a\.incoterms \?\? '–'\)\}/)
    assert.match(r, /<strong>Zahlungsbedingungen \/ Payment Terms:<\/strong> \$\{e\(a\.zahlungsbedingungen \?\? '–'\)\}/)
    assert.doesNotMatch(r, /Payment Terms:<\/strong> \$\{e\(a\.incoterms/)
  })
  test('Mein Betrieb: EORI, kleiner Weinerzeuger, Flaschen je Karton – mit Grenzen wie in der Datenbank', () => {
    const a = quelle('src/app/(dashboard)/betrieb/einstellungen/actions.ts')
    assert.match(a, /export_flaschen_je_karton: Math\.min\(60, Math\.max\(1, ganzzahlAus\(formData\.get\('export_flaschen_je_karton'\)\) \?\? 6\)\)/)
    assert.match(a, /kleiner_weinerzeuger:      formData\.get\('kleiner_weinerzeuger'\) === 'on'/)
    const c = quelle('src/app/(dashboard)/betrieb/einstellungen/EinstellungenClient.tsx')
    assert.match(c, /name="betrieb_eori" maxLength=\{30\}/)
    assert.match(c, /name="export_flaschen_je_karton" type="number" step="1" min="1" max="60" required/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['versanddatum', 'zahlungsbedingungen', 'kunde_uid']) assert.ok(schema.exportauftraege.includes(s), s)
    assert.ok(schema.exportauftrag_positionen.includes('flaschen_je_karton'))
    for (const s of ['betrieb_eori', 'kleiner_weinerzeuger', 'export_flaschen_je_karton']) assert.ok(schema.tenant_einstellungen.includes(s), s)
  })
})
