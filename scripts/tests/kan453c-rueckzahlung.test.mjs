// KAN-453 G3c (14.11.2026): Rückzahlung am Guthaben einer Rechnung.
// Befund: Seit KAN-419 kann eine Rechnung ein Guthaben haben (Zahlungen + Gutschriften über dem Rechnungsbetrag) – es
// ließ sich nicht auszahlen, die offenen Posten zeigten es nicht einmal, und bei E&A-Betrieben blieb die Umsatzsteuer
// der Gutschrift stehen. Neu: Rückzahlung = negative Zahlung (nur über die RPC), ihre E&A-Einnahme ist negativ.
// Datenbank: DB-Test 04_rueckzahlung.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { istRueckzahlung, rueckzahlungEingabeFehler, RUECKZAHLUNG_ARTEN } from '../../src/lib/verkauf/rueckzahlung.ts'
import { sollJeZahlung, planeVerkaufsEinnahmen } from '../../src/lib/ea/verkaufEinnahmenPlan.ts'

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
const M = migration('kan453b_rueckzahlung')

describe('KAN-453: Eingabeprüfung der Rückzahlung (wie die Datenbank)', () => {
  const r = { guthaben: 20, rechnungDatum: '2026-11-10', heute: '2026-11-14' }
  test('bis zum Guthaben, auch in Teilen; darüber, 0 und negativ am Betragsfeld', () => {
    assert.equal(rueckzahlungEingabeFehler({ betrag: 20, datum: '2026-11-14' }, r), null)
    assert.equal(rueckzahlungEingabeFehler({ betrag: 0.01, datum: '2026-11-12' }, r), null)
    const zuViel = rueckzahlungEingabeFehler({ betrag: 20.01, datum: '2026-11-14' }, r)
    assert.equal(zuViel.feld, 'betrag')
    assert.match(zuViel.text, /\(20,01 €\) übersteigt das Guthaben der Rechnung \(20,00 €\)/)
    for (const b of [0, -5, Number.NaN, 0.004]) assert.equal(rueckzahlungEingabeFehler({ betrag: b, datum: '2026-11-14' }, r)?.feld, 'betrag', String(b))
  })
  test('Datum: nicht vor der Rechnung, nicht in der Zukunft – am Datumsfeld', () => {
    assert.equal(rueckzahlungEingabeFehler({ betrag: 5, datum: '2026-11-09' }, r).feld, 'datum')
    assert.match(rueckzahlungEingabeFehler({ betrag: 5, datum: '2026-11-15' }, r).text, /Datum der Rückzahlung.*Zukunft/)
    assert.equal(rueckzahlungEingabeFehler({ betrag: 5, datum: '' }, r).feld, 'datum')
  })
  test('Rückzahlung = negativer Betrag; „Gutschrift“ ist keine Zahlungsart der Rückzahlung', () => {
    assert.equal(istRueckzahlung({ betrag: -15 }), true)
    assert.equal(istRueckzahlung({ betrag: '-0.01' }), true)
    assert.equal(istRueckzahlung({ betrag: 15 }), false)
    assert.deepEqual([...RUECKZAHLUNG_ARTEN], ['bank', 'bar', 'karte', 'sonstig'])
  })
})

describe('KAN-453: E&A-Einnahmen – die Rückzahlung mindert sie am Tag der Rückzahlung', () => {
  // Rechnung 120 € brutto zu 20 % (100 netto) – ganz bezahlt, Gutschrift 24 €, Rückzahlung 24 €
  const POS = [{ preis_brutto: 12, menge: 10, ust_satz: 20 }]
  const Z1 = { id: 'z1', betrag: 120, datum: '2026-11-10', erstelltAm: '2026-11-10T10:00:00Z' }
  const RZ = { id: 'z2', betrag: -24, datum: '2026-11-14', erstelltAm: '2026-11-14T10:00:00Z' }
  test('negative Einnahme je USt-Satz am Datum der Rückzahlung; die Zahlung davor bleibt, wie sie war', () => {
    assert.deepEqual(sollJeZahlung(POS, [Z1]), [{ zahlung_id: 'z1', datum: '2026-11-10', betrag_netto: 100, ust_satz: 20 }])
    assert.deepEqual(sollJeZahlung(POS, [Z1, RZ]), [
      { zahlung_id: 'z1', datum: '2026-11-10', betrag_netto: 100, ust_satz: 20 },
      { zahlung_id: 'z2', datum: '2026-11-14', betrag_netto: -20, ust_satz: 20 },
    ])
  })
  test('zwei Steuersätze: anteilig, Summe aller Einnahmen = Netto des behaltenen Betrags', () => {
    const pos = [{ preis_brutto: 12, menge: 10, ust_satz: 20 }, { preis_brutto: 11.3, menge: 6, ust_satz: 13 }]   // 120 + 67,80 = 187,80
    const soll = sollJeZahlung(pos, [{ ...Z1, betrag: 187.8 }, { ...RZ, betrag: -18.78 }])
    const je = satz => Math.round(soll.filter(s => s.ust_satz === satz).reduce((s, x) => s + x.betrag_netto, 0) * 100)
    assert.equal(je(20), 9000)   // 100 netto × 0,9
    assert.equal(je(13), 5400)   // 60 netto × 0,9
    assert.deepEqual(soll.filter(s => s.zahlung_id === 'z2').map(s => [s.ust_satz, s.betrag_netto]).sort((a, b) => a[0] - b[0]), [[13, -6], [20, -10]])
  })
  test('Teilzahlung, Gutschrift, Rückzahlung des Guthabens: Einnahmen = was der Kunde am Ende bezahlt hat', () => {
    // 120 € Rechnung, 72 € bezahlt, Gutschrift 60 € → Guthaben 12 €, Rückzahlung 12 € → behalten 60 € = 50 netto
    const soll = sollJeZahlung(POS, [{ ...Z1, betrag: 72 }, { ...RZ, betrag: -12 }])
    assert.deepEqual(soll.map(s => s.betrag_netto), [60, -10])
  })
  test('Überzahlung und ihre Rückzahlung berühren die Einnahmen nicht (Quote höchstens 1)', () => {
    assert.deepEqual(sollJeZahlung(POS, [{ ...Z1, betrag: 150 }, { ...RZ, betrag: -30 }]), [{ zahlung_id: 'z1', datum: '2026-11-10', betrag_netto: 100, ust_satz: 20 }])
  })
  test('Abgleich: negative Einnahme wird angelegt, stimmt sie schon, passiert nichts; Storno der Rückzahlung bucht sie gegen', () => {
    const e1 = { id: 'e1', zahlung_id: 'z1', betrag_netto: 100, ust_satz: 20, is_locked: false, import_quelle: 'verkauf', storniert_am: null, storno_von_id: null }
    const neu = planeVerkaufsEinnahmen(POS, [Z1, RZ], [e1])
    assert.deepEqual(neu, { gesperrt: false, stornieren: [], anlegen: [{ zahlung_id: 'z2', datum: '2026-11-14', betrag_netto: -20, ust_satz: 20 }] })
    const e2 = { ...e1, id: 'e2', zahlung_id: 'z2', betrag_netto: -20 }
    assert.deepEqual(planeVerkaufsEinnahmen(POS, [Z1, RZ], [e1, e2]), { gesperrt: false, stornieren: [], anlegen: [] })
    // Rückzahlung storniert (nicht mehr gültig): ihre Einnahme wird gegengebucht
    assert.deepEqual(planeVerkaufsEinnahmen(POS, [Z1], [e1, e2]), { gesperrt: false, stornieren: ['e2'], anlegen: [] })
  })
})

describe('KAN-453: Server Action, Oberfläche, Anzeige', () => {
  const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  const fn = a.slice(a.indexOf('export async function rueckzahlungErfassen('), a.indexOf('// KAN-453 G3b: Gutschrift stornieren'))
  test('Rechte wie Zahlungen, Eingaben geprüft, RPC, Ablehnungen am richtigen Feld', () => {
    assert.match(fn, /const tenantId = await getZahlungsKontext\(\)/)
    assert.match(fn, /rpc\('s112_rueckzahlung_erfassen', \{\n\s+p_tenant_id: tenantId, p_rechnung_id: rechnungId, p_betrag: betrag, p_datum: e\.datum, p_art: e\.art,/)
    assert.match(fn, /if \(istStornoDatumAblehnung\(hint\)\) return \{ error: meldung, feld: 'datum' \}\n\s+if \(hint === 'rueckzahlung_betrag'\) return \{ error: meldung, feld: 'betrag' \}/)
    assert.match(fn, /if \(!\(RUECKZAHLUNG_ARTEN as readonly string\[\]\)\.includes\(String\(e\.art\)\)\)/)
  })
  test('danach die E&A-Einnahme wie bei jeder Zahlung; ein Fehler dort wird gemeldet, nicht verschluckt', () => {
    assert.match(fn, /const ea = await syncEaEinnahmeFuerVerkauf\(String\(z\.verkaufsposten_id\)\)/)
    assert.match(fn, /eaErgebnisPruefen\(ea, 'gespeichert'\)\n\s+return \{ ok: true \}/)
    assert.match(fn, /if \(zErr \|\| !z\?\.verkaufsposten_id\) \{\n\s+throw new AktionsFehler\(`Die Rückzahlung ist gebucht \(bitte nicht erneut erfassen\)/)
  })
  test('Offene Posten: Gutschriften und Guthaben sichtbar, Rückzahlung nur mit Schreibrecht und Guthaben; Vorschlag der Zahlung nach Gutschriften', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/offene-posten/page.tsx')
    assert.match(s, /gutgeschrieben:  p\.gutgeschrieben,\n\s+offen:           p\.offen,\n\s+guthaben:        p\.guthaben,/)
    const c = quelle('src/app/(dashboard)/weinhandel/offene-posten/OffenePostenClient.tsx')
    assert.match(c, /const offenerBetrag = p\.offen/)
    assert.match(c, /\{writeOk && p\.guthaben > 0 && p\.rechnungId && \(\n\s+<button onClick=\{\(\) => setRueckzahlung\(v => !v\)\}/)
    assert.match(c, /<RueckzahlungErfassen rechnungId=\{p\.rechnungId\} rechnungsnummer=\{p\.rechnungsnummer\} rechnungDatum=\{p\.datum\.slice\(0, 10\)\} guthaben=\{p\.guthaben\}/)
    assert.match(c, /Guthaben \{fmt\(p\.guthaben\)\}/)
  })
  test('Formular: dieselbe Prüfung wie der Server, Ladezustand im finally, Fehler am Feld, Eingaben bleiben', () => {
    const f = quelle('src/components/handel/RueckzahlungErfassen.tsx')
    assert.match(f, /const f = rueckzahlungEingabeFehler\(\{ betrag: zahl, datum \}, \{ guthaben, rechnungDatum, heute \}\)\n\s+if \(f\) \{ setFehler\(f\); return \}/)
    assert.match(f, /\} finally \{\n\s+setSpeichern\(false\)/)
    assert.match(f, /if \('error' in r\) \{ setFehler\(\{ feld: r\.feld \?\? null, text: r\.error \}\); return \}/)
    assert.doesNotMatch(f, /value="gutschrift"/)
  })
  test('Kassabuch, Kontoabstimmung und Zahlungsliste nennen die Rückzahlung beim Namen', () => {
    assert.match(quelle('src/lib/behoerden/kassabuch.ts'), /art: Number\(z\.betrag\) < 0 \? 'Rückzahlung' : 'Zahlungseingang',/)
    assert.match(quelle('src/app/(dashboard)/konten/[id]/abstimmung/page.tsx'), /\$\{Number\(z\.betrag\) < 0 \? 'Rückzahlung' : 'Zahlungseingang'\}/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx'), /\{Number\(z\.betrag\) < 0 \? ' · Rückzahlung' : ''\}/)
  })
  test('Handbuch, FAQ und Projektregeln', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /„Rückzahlung erfassen“: Betrag \(höchstens das Guthaben, auch in Teilen\)/)
    const f = quelle('src/app/(dashboard)/hilfe/faq/page.tsx')
    for (const frage of ['Wie berichtige ich eine Rechnung nur teilweise (Gutschrift)?', 'Die Gutschrift war falsch – wie nehme ich sie zurück?', 'Der Kunde hat schon bezahlt und bekommt Geld zurück – wie buche ich das?']) assert.ok(f.includes(frage), frage)
    assert.match(quelle('CLAUDE.md'), /Rückzahlung \(seit KAN-453 G3c\)/)
  })
})

describe('KAN-453: Migration kan453b', () => {
  test('negative Zahlung nur über die RPC; Betrag 0 nie', () => {
    assert.match(M, /ADD CONSTRAINT zahlungen_betrag_check CHECK \(betrag <> 0\);/)
    assert.match(M, /CREATE TRIGGER a_rueckzahlung_schutz BEFORE INSERT OR UPDATE OF betrag ON public\.zahlungen\n\s+FOR EACH ROW EXECUTE FUNCTION public\.s112_rueckzahlung_schutz\(\);/)
    assert.match(M, /IF NEW\.betrag < 0 AND \(TG_OP = 'INSERT' OR NEW\.betrag IS DISTINCT FROM OLD\.betrag\)\n\s+AND coalesce\(current_setting\('s112\.rueckzahlung', true\), ''\) <> 'an' THEN/)
    assert.match(M, /REVOKE EXECUTE ON FUNCTION public\.s112_rueckzahlung_schutz\(\) FROM PUBLIC, anon, authenticated;/)
  })
  test('RPC: Zugriffs-, Abo- und Modulprüfung, Obergrenze Guthaben, Zeitraum; nicht für anon', () => {
    assert.match(M, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);\n\s+PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);\n\s+PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft', 'ea'\);/)
    assert.match(M, /v_guthaben := greatest\(v_gezahlt \+ public\.s112_gutschrift_summe\(p_tenant_id, v_r\.id\) - v_gesamt, 0\);\n\s+IF v_betrag > v_guthaben THEN/)
    assert.match(M, /v_sperre := public\.s112_ea_zeitraum_sperrgrund\(p_tenant_id, p_datum\);/)
    assert.match(M, /REVOKE EXECUTE ON FUNCTION public\.s112_rueckzahlung_erfassen\(uuid, uuid, numeric, date, text, uuid, text\) FROM PUBLIC, anon;/)
    assert.match(M, /PERFORM set_config\('s112\.rueckzahlung', 'an', true\);\n\s+INSERT INTO public\.zahlungen[\s\S]{0,300}PERFORM set_config\('s112\.rueckzahlung', '', true\);/)
  })
  test('E&A: negativ nur die Einnahme einer Verkaufszahlung; Gutschrift mit Rückzahlung nicht stornierbar', () => {
    assert.match(M, /betrag_netto >= 0 OR storno_von_id IS NOT NULL\n\s+OR \(typ = 'einnahme' AND import_quelle = 'verkauf' AND zahlung_id IS NOT NULL\)\);/)
    assert.match(M, /AND z\.storniert_am IS NULL AND z\.betrag < 0\) THEN\n\s+RAISE EXCEPTION 'Zur Rechnung % gibt es eine Rückzahlung/)
    assert.match(M, /RAISE EXCEPTION 'KAN-453: Anker fehlt bzw\. ist nicht eindeutig \(s112_gutschrift_stornieren, % Treffer\)', v_n;/)
  })
})
