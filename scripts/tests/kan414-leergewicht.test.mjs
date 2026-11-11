// KAN-414 (11.11.2026) – Leergewicht der Flasche je Füllung, Verpackung je Exportauftrag, Netto-/Bruttogewicht in den
// Exportdokumenten. Vorher stand in CMR und EUR.1 kein Gewicht; die e-AD-Datei rechnete Menge × 1,25 kg unabhängig von
// der Einheit (bei „Fl“ also Flaschenzahl × 1,25 kg).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const g = () => laden('lib/export/gewicht.ts')
const f = (ml, leer) => ({ flaschengroesse_ml: ml, leergewicht_g: leer })

describe('KAN-414: Gewicht je Flasche und Position', nurMitHooks, () => {
  test('0,75 l mit 500 g Leergewicht → netto 0,743 kg, brutto 1,243 kg', async () => {
    const { flaschenGewicht } = await g()
    assert.deepEqual(flaschenGewicht(750, 500), { nettoKg: 0.743, bruttoKg: 1.243 })
    assert.deepEqual(flaschenGewicht(750, null), { nettoKg: 0.743, bruttoKg: null })
    assert.deepEqual(flaschenGewicht(null, 500), { nettoKg: null, bruttoKg: null })
  })
  test('600 Flaschen 0,75 l / 500 g → netto 445,50 kg, brutto 745,50 kg', async () => {
    const { positionsGewicht } = await g()
    const p = positionsGewicht({ menge: '600', einheit: 'Fl', fuellung: f(750, 500) })
    assert.deepEqual(p, { liter: 450, flaschen: 600, nettoKg: 445.5, bruttoKg: 745.5, fehlt: null })
  })
  test('HL: lose Ware ohne Flaschengewicht – der alte Fehler (Flaschenzahl × 1,25 kg) ist weg', async () => {
    const { positionsGewicht } = await g()
    assert.deepEqual(positionsGewicht({ menge: 2, einheit: 'HL', fuellung: null }), { liter: 200, flaschen: null, nettoKg: 198, bruttoKg: 198, fehlt: null })
    // 600 Flaschen wogen in der e-AD-Datei 750 kg (600 × 1,25), jetzt 745,5 kg bzw. leer ohne Leergewicht
    assert.equal(positionsGewicht({ menge: 600, einheit: 'Fl', fuellung: f(750, null) }).bruttoKg, null)
  })
  test('kein Schätzwert: ohne Füllung, Flaschengröße, Leergewicht oder bei „Kiste“ bleibt das Gewicht leer', async () => {
    const { positionsGewicht } = await g()
    assert.equal(positionsGewicht({ menge: 10, einheit: 'Fl', fuellung: null }).fehlt, 'fuellung')
    assert.equal(positionsGewicht({ menge: 10, einheit: 'Fl', fuellung: f(null, 500) }).fehlt, 'flaschengroesse')
    const ohneLeer = positionsGewicht({ menge: 10, einheit: 'Fl', fuellung: f(750, null) })
    assert.deepEqual([ohneLeer.fehlt, ohneLeer.nettoKg, ohneLeer.bruttoKg], ['leergewicht', 7.43, null])
    assert.equal(positionsGewicht({ menge: 10, einheit: 'Kiste', fuellung: f(750, 500) }).fehlt, 'kiste')
    assert.equal(positionsGewicht({ menge: 0, einheit: 'Fl', fuellung: f(750, 500) }).fehlt, 'menge')
  })
})

describe('KAN-414: Gewicht der Sendung', nurMitHooks, () => {
  test('Abnahmefall: 600 Flaschen + 60 kg Verpackung → netto 445,50 kg, brutto 805,50 kg', async () => {
    const { sendungsGewicht, kgText } = await g()
    const s = sendungsGewicht([{ menge: 600, einheit: 'Fl', fuellung: f(750, 500) }], '60')
    assert.deepEqual([s.nettoKg, s.bruttoKg, s.verpackungKg, s.unvollstaendig, s.hinweis], [445.5, 805.5, 60, 0, null])
    assert.equal(kgText(s.bruttoKg), '805.50')
    assert.equal(kgText(null), '')
  })
  test('Summe aus den gerundeten Positionswerten; Verpackung nur im Brutto', async () => {
    const { sendungsGewicht } = await g()
    const s = sendungsGewicht([
      { menge: 7, einheit: 'Fl', fuellung: f(750, 455) },    // 5,1975 → 5,20 netto; 8,3825 → 8,38 brutto
      { menge: 3, einheit: 'Fl', fuellung: f(1500, 900) },   // 4,455 → 4,46 netto; 7,155 → 7,16 brutto
    ], null)
    assert.deepEqual(s.positionen.map(p => [p.nettoKg, p.bruttoKg]), [[5.2, 8.38], [4.46, 7.16]])
    assert.deepEqual([s.nettoKg, s.bruttoKg, s.verpackungKg], [9.66, 15.54, 0])
  })
  test('fehlt einer Position das Leergewicht: Brutto leer, Netto bleibt, Hinweis nennt den Grund', async () => {
    const { sendungsGewicht } = await g()
    const s = sendungsGewicht([
      { menge: 60, einheit: 'Fl', fuellung: f(750, 500) },
      { menge: 60, einheit: 'Fl', fuellung: f(750, null) },
    ], 12)
    assert.equal(s.bruttoKg, null)
    assert.equal(s.nettoKg, 89.1)
    assert.equal(s.unvollstaendig, 1)
    assert.match(s.hinweis, /fehlt das Leergewicht der Flasche/)
    assert.match(s.hinweis, /bleibt das Gewicht leer/)
    assert.equal(sendungsGewicht([], 5).bruttoKg, null)   // ohne Positionen kein Gewicht
  })
})

describe('KAN-414: Eingabe und Verdrahtung', nurMitHooks, () => {
  test('Leergewicht: leer in Ordnung, 1 … 5.000 g, sonst Meldung', async () => {
    const { leergewichtFehler } = await laden('lib/handel/leergewicht.ts')
    assert.equal(leergewichtFehler('', null), null)
    assert.equal(leergewichtFehler(null, null), null)
    assert.equal(leergewichtFehler('500', 500), null)
    assert.equal(leergewichtFehler('5000', 5000), null)
    assert.match(leergewichtFehler('abc', null), /keine gültige Zahl/)
    assert.match(leergewichtFehler('0', 0), /zwischen 1 und 5\.000 g/)
    assert.match(leergewichtFehler('5001', 5001), /zwischen 1 und 5\.000 g/)
  })
  test('Verpackung: leer, 0 und Dezimalzahl gehen; negativ und Text nicht', async () => {
    const { verpackungFehler, verpackungWert } = await laden('lib/export/auftragEingabe.ts')
    assert.equal(verpackungFehler(null), null)
    assert.equal(verpackungFehler(''), null)
    assert.equal(verpackungFehler(0), null)
    assert.equal(verpackungFehler(60.5), null)
    assert.equal(verpackungWert('60.5'), 60.5)
    assert.match(verpackungFehler('60,5'), /0 bis 100.000/)   // Komma wandelt das Formular um (zahlAus)
    assert.equal(verpackungWert(''), null)
    assert.match(verpackungFehler(-1), /0 bis 100\.000/)
    assert.match(verpackungFehler('viel'), /0 bis 100\.000/)
  })
})

describe('KAN-414: Dokumente, Routen, Migration', () => {
  test('Dokumente drucken Gewichte aus derselben Rechnung; CMR ohne festes „–“ in der Bruttomasse', () => {
    const d = quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts')
    assert.match(d, /fuellungen\(bezeichnung,flaschengroesse_ml,leergewicht_g\)/)
    assert.match(d, /const gew = sendungsGewicht\(/)
    assert.match(d, /<th>Rohmasse kg<\/th>/)
    assert.match(d, /Bruttomasse gesamt/)
    assert.match(d, /Netto \/ Net kg<\/th><th>Brutto \/ Gross kg<\/th>/)
    assert.match(d, /Bruttogewicht \/ Gross weight/)
    assert.equal((d.match(/gew\.positionen\[i\]\?\.bruttoKg/g) ?? []).length >= 3, true)
  })
  test('e-AD-Datei rechnet über positionsGewicht (mit Einheit), nicht mehr Menge × 1,25', () => {
    const m = quelle('src/app/api/weinexport/[id]/emcs/route.ts')
    assert.match(m, /<GrossWeight>\$\{kgText\(positionsGewicht\(\{ menge: p\.menge, einheit: p\.einheit, fuellung: p\.fuellungen \?\? null \}\)\.bruttoKg\)\}<\/GrossWeight>/)
    assert.doesNotMatch(quelle('src/lib/export/exportWerte.ts'), /1\.25/)
  })
  test('Füllung: Feld im Anlegen und Bearbeiten, Speichern über die RPC mit Grund', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    assert.match(a, /leergewicht_g:\s+leergewicht,/)
    assert.match(a, /\.\.\.\(mitLeergewicht \? \{ leergewicht_g: leergewichtNeu \} : \{\}\),/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx'), /name="leergewicht_g"/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx'), /name="leergewicht_g" defaultValue=\{f\.leergewicht_g \?\? ''\}/)
  })
  test('Exportauftrag: Verpackung beim Anlegen und nachträglich (PATCH-Positivliste), CSV mit Gewichten', () => {
    assert.match(quelle('src/app/api/weinexport/route.ts'), /verpackung_kg:\s+verpackungWert\(body\.verpackung_kg\)/)
    const p = quelle('src/app/api/weinexport/[id]/route.ts')
    assert.match(p, /const AENDERBAR = \['status', 'emcs_arc_nummer', 'emcs_status', 'verpackung_kg'\] as const/)
    assert.match(p, /verpackungFehler\(b\.verpackung_kg\)/)
    const b = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.match(b, /kopf: 'Nettogewicht \(kg\)'/)
    assert.match(b, /kopf: 'Bruttogewicht \(kg\)'/)
  })
  test('Migration: Spalten mit CHECK, Positivliste, RPC, Grund-Pflicht und Protokoll um leergewicht_g erweitert', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const datei = readdirSync(dir).find(x => /kan414_leergewicht\.sql$/.test(x))
    const entwurf = new URL('../../supabase/entwurf/kan414_leergewicht.sql', import.meta.url)
    if (!datei && !existsSync(entwurf)) return   // Entwurfsordner ist nicht eingecheckt
    const sql = (datei ? readFileSync(new URL(datei, dir), 'utf8') : readFileSync(entwurf, 'utf8')).replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN leergewicht_g numeric\n\s+CONSTRAINT fuellungen_leergewicht_chk CHECK/)
    assert.match(sql, /ADD COLUMN verpackung_kg numeric\n\s+CONSTRAINT exportauftraege_verpackung_chk CHECK/)
    assert.match(sql, /'name,vk_preis_brutto,einstandspreis,mwst_pct,zolltarifnummer,notizen,aktiv,leergewicht_g,aktualisiert_am,/)
    assert.match(sql, /c_erlaubt constant text\[\] := ARRAY\[[^\]]*'leergewicht_g'\]/)
    assert.match(sql, /BEFORE UPDATE OF name, vk_preis_brutto, einstandspreis, mwst_pct, zolltarifnummer, notizen, aktiv, leergewicht_g ON public\.fuellungen/)
    assert.match(sql, /'mwst_pct', 'zolltarifnummer', 'leergewicht_g'\);/)
    // sonst wortgleich zur KAN-378-Migration: dieselben Schutzprüfungen
    assert.match(sql, /PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_fuellung_grund_pflicht\(\) FROM PUBLIC, anon, authenticated;/)
  })
})
