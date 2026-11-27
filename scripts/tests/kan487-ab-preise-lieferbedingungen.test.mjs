// KAN-487 (27.11.2026): Auftragsbestätigung mit Preisen und Vereinbarungen.
// Befund (UAT, Nebenbefund zu KAN-418): Die Auftragsbestätigung zeigte nur Flaschen; gewünscht sind die Preise, statt
// „Die Ware ist bis … reserviert“ ein Pflichtfeld für das Vereinbarte (Arbeitstitel „Incoterms“ – ein Freitext ohne
// Vorgabe, Entscheidung Jörgen 27.11.2026), und der Satz „Es gelten die Preise zum Zeitpunkt der Lieferung“ entfällt.
// Dafür trägt jeder Auftrag Preise je Position (Momentaufnahme wie am Angebot) und Vereinbarungen; Aufträge von
// früher werden einmal ergänzt. Die Regeln der Datenbank prüft DB-Test 98.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIEFERBEDINGUNGEN_MAX, auftragFehler, auftragPositionenAus, auftragPositionenFuerDb, auftragUnvollstaendig, auftragErgaenzbar,
  lieferbedingungenFehler, ergaenzPositionenAus, ergaenzFehler, ergaenzPositionenFuerDb,
} from '../../src/lib/auftrag/regeln.ts'
import { abPreisPositionen, abHinweise } from '../../src/lib/auftrag/bestaetigung.ts'
import { angebotSummen } from '../../src/lib/auftrag/angebot.ts'

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
const F1 = '11111111-1111-4111-8111-111111111111'
const P1 = '33333333-3333-4333-8333-333333333333'
const P2 = '44444444-4444-4444-8444-444444444444'
const HEUTE = '2026-11-27'
const kopf = (mehr = {}) => ({ kunde: `kontakt:${F1}`, datum: HEUTE, reserviert_bis: '2026-12-11', lieferbedingungen: 'Abholung ab Hof', notizen: null, ...mehr })
const pos = (mehr = {}) => ({ fuellung_id: F1, menge: 6, preis_brutto: 12.5, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 13, ...mehr })

describe('KAN-487: Vereinbarungen sind ein Pflicht-Freitext', () => {
  test('leer abgelehnt, bis 300 Zeichen erlaubt – ohne Vorgabeliste', () => {
    assert.equal(LIEFERBEDINGUNGEN_MAX, 300)
    for (const leer of ['', '   ', null, undefined, 5]) assert.match(lieferbedingungenFehler(leer), /Vereinbarungen angeben/, String(leer))
    for (const frei of ['Abholung ab Hof', 'EXW', 'Lieferung frei Haus bis 15.12., Zahlung bei Übergabe', 'x'.repeat(300)]) assert.equal(lieferbedingungenFehler(frei), null, frei.slice(0, 20))
    assert.match(lieferbedingungenFehler('x'.repeat(301)), /höchstens 300 Zeichen/)
  })
  test('der Auftrag wird ohne Vereinbarungen nicht angenommen', () => {
    assert.equal(auftragFehler(kopf(), [pos()], HEUTE), null)
    assert.match(auftragFehler(kopf({ lieferbedingungen: ' ' }), [pos()], HEUTE), /Vereinbarungen angeben/)
    assert.match(auftragFehler(kopf({ lieferbedingungen: 'x'.repeat(301) }), [pos()], HEUTE), /höchstens 300 Zeichen/)
  })
  test('keine Auswahlliste im Formular, kein Bezug zu den Incoterms des Weinexports', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/auftraege/neu/AuftragForm.tsx')
    assert.match(f, /<textarea id="auftrag-lieferbedingungen" rows=\{2\} required maxLength=\{LIEFERBEDINGUNGEN_MAX\}/)
    // Beschriftung „Vereinbarungen“ (Entscheidung Jörgen 27.11.2026) – in Formular, Ergänzen-Schritt, Detailseite und PDF
    assert.ok(f.includes('>Vereinbarungen *</label>'))
    assert.ok(quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/AuftragErgaenzen.tsx').includes('>Vereinbarungen *</label>'))
    assert.ok(quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/page.tsx').includes('<dt className="text-xs text-s112-muted">Vereinbarungen</dt>'))
    for (const d of ['src/app/(dashboard)/weinhandel/auftraege/neu/AuftragForm.tsx', 'src/app/(dashboard)/weinhandel/auftraege/[id]/AuftragErgaenzen.tsx',
      'src/app/(dashboard)/weinhandel/auftraege/[id]/page.tsx', 'src/lib/auftrag/bestaetigung.ts', 'src/lib/auftrag/bestaetigungLaden.ts']) {
      assert.doesNotMatch(quelle(d), /Lieferbedingungen/, d)
    }
    assert.doesNotMatch(f + quelle('src/lib/auftrag/regeln.ts') + quelle('src/lib/auftrag/bestaetigung.ts'), /INCOTERMS|auftragEingabe/)
  })
})

describe('KAN-487: Preise je Position am Auftrag', () => {
  test('Preis und Steuersatz sind Pflicht, Rabatte 0 bis 100 %', () => {
    assert.match(auftragFehler(kopf(), [pos({ preis_brutto: NaN })], HEUTE), /Position 1: Bitte einen Preis je Flasche/)
    assert.match(auftragFehler(kopf(), [pos(), pos({ preis_brutto: -1 })], HEUTE), /Position 2: Bitte einen Preis je Flasche/)
    assert.match(auftragFehler(kopf(), [pos({ rabatt_pct: 101 })], HEUTE), /Rabatt muss zwischen 0 und 100/)
    assert.match(auftragFehler(kopf(), [pos({ sonderrabatt_pct: -1 })], HEUTE), /Sonderrabatt muss zwischen 0 und 100/)
    assert.match(auftragFehler(kopf(), [pos({ ust_satz: NaN })], HEUTE), /Steuersatz angeben/)
    assert.equal(auftragFehler(kopf(), [pos({ preis_brutto: 0 })], HEUTE), null, 'Preis 0 (Muster, Geschenk) ist erlaubt')
  })
  test('aus dem Formular gelesen und für die Datenbank als Text mit Dezimalpunkt', () => {
    const p = auftragPositionenAus(JSON.stringify([{ fuellung_id: F1, menge: '6', preis_brutto: '12.5', rabatt_pct: '10', sonderrabatt_pct: '', ust_satz: '13' }]))
    assert.deepEqual(p, [pos({ rabatt_pct: 10 })])
    assert.deepEqual(auftragPositionenFuerDb(p), [{ fuellung_id: F1, menge: '6', preis_brutto: '12.50', rabatt_pct: '10.00', sonderrabatt_pct: '0.00', ust_satz: '13.00' }])
    // leerer Preis bleibt ungültig – wird nicht still zu 0
    const ohne = auftragPositionenAus(JSON.stringify([{ fuellung_id: F1, menge: '6', preis_brutto: '', ust_satz: '13' }]))
    assert.match(auftragFehler(kopf(), ohne, HEUTE), /Preis je Flasche/)
    for (const preis of ['12,50', '1e2', '-3', '12.505']) {
      assert.match(auftragFehler(kopf(), auftragPositionenAus(JSON.stringify([{ fuellung_id: F1, menge: '6', preis_brutto: preis, ust_satz: '13' }])), HEUTE), /Preis je Flasche/, preis)
    }
  })
  test('Server Action: Vereinbarungen und Preise gehen an die RPC', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts')
    assert.ok(a.includes("lieferbedingungen: String(formData.get('lieferbedingungen') ?? '').trim(),"))
    assert.ok(a.includes('notizen: kopf.notizen, lieferbedingungen: kopf.lieferbedingungen,'))
    assert.ok(a.includes('p_positionen: auftragPositionenFuerDb(positionen),'))
    assert.ok(a.indexOf('const fehler = auftragFehler(kopf, positionen, heuteWien())') < a.indexOf("'s112_auftrag_anlegen'"))
  })
  test('Übernahme aus dem Angebot: dessen Preise stehen im Formular', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/auftraege/neu/page.tsx')
    assert.ok(p.includes(".select('id, fuellung_id, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz').eq('tenant_id', tenantId).eq('auftrag_id', angebotId)"))
    assert.ok(p.includes("preis: zahlWert(f.vk_preis_brutto),"))
  })
})

describe('KAN-487: Auftragsbestätigung', () => {
  const zeilen = [
    { name: 'Riesling Reserve 2025', menge: 12, preis_brutto: 18, rabatt_pct: 10, sonderrabatt_pct: 0, ust_satz: 13, fuellung: { flaschengroesse_ml: 750 } },
    { name: 'Zweigelt 2025', menge: '6', preis_brutto: '9.90', rabatt_pct: '0', sonderrabatt_pct: '0', ust_satz: '13', fuellung: { flaschengroesse_ml: 750 } },
  ]
  test('Positionen: Preis je Flasche vor Rabatt, Rabatttext, Zeilenbetrag', () => {
    assert.deepEqual(abPreisPositionen(zeilen), [
      { name: 'Riesling Reserve 2025', sub: '0,75 L', flaschen: 12, preis: 18, rabatt: '10 %', betrag: 194.4 },
      { name: 'Zweigelt 2025', sub: '0,75 L', flaschen: 6, preis: 9.9, rabatt: '', betrag: 59.4 },
    ])
  })
  test('Gesamt brutto = Summe der gedruckten Zeilen; Netto und USt. herausgerechnet', () => {
    const s = angebotSummen(zeilen)
    assert.equal(s.brutto, 253.8)
    assert.equal(s.flaschen, 18)
    assert.deepEqual(s.ust, [{ satz: 13, netto: 224.6, steuer: 29.2 }])
    assert.equal(s.netto, 224.6)
  })
  test('Vereinbarungen stehen unter den Summen', () => {
    assert.deepEqual(abHinweise('Lieferung frei Haus bis 15.12.'), ['Vereinbarungen: Lieferung frei Haus bis 15.12.'])
    const pdf = quelle('src/lib/pdf/auftragsbestaetigungPdf.tsx')
    for (const t of ['Preis', 'Rabatt', 'Betrag', 'Summe netto', 'Gesamt brutto', 'Preise je Flasche in Euro inklusive Umsatzsteuer.']) assert.ok(pdf.includes(t), t)
    assert.ok(pdf.indexOf('Gesamt brutto') < pdf.indexOf('{hinweise.map('))
  })
})

describe('KAN-487: Aufträge von früher ergänzen', () => {
  test('unvollständig: ohne Vereinbarungen oder mit einer Position ohne Preis bzw. Steuersatz', () => {
    const voll = [{ preis_brutto: 12.5, ust_satz: 13 }]
    assert.equal(auftragUnvollstaendig({ lieferbedingungen: 'Abholung' }, voll), false)
    assert.equal(auftragUnvollstaendig({ lieferbedingungen: null }, voll), true)
    assert.equal(auftragUnvollstaendig({ lieferbedingungen: '  ' }, voll), true)
    assert.equal(auftragUnvollstaendig({ lieferbedingungen: 'Abholung' }, [...voll, { preis_brutto: null, ust_satz: null }]), true)
    assert.equal(auftragUnvollstaendig({ lieferbedingungen: 'Abholung' }, [{ preis_brutto: 0, ust_satz: 0 }]), false, 'Preis 0 und 0 % sind Angaben')
  })
  test('ergänzbar nur, solange der Auftrag Flaschen reserviert', () => {
    for (const status of ['offen', 'teilgeliefert']) assert.equal(auftragErgaenzbar({ status, storniert_am: null }), true, status)
    for (const status of ['geliefert', 'abgeschlossen', 'storniert']) assert.equal(auftragErgaenzbar({ status, storniert_am: null }), false, status)
    assert.equal(auftragErgaenzbar({ status: 'offen', storniert_am: '2026-11-27T10:00:00Z' }), false)
  })
  test('Eingabe: jede Position einmal, mit Preis und Steuersatz', () => {
    const json = JSON.stringify([{ position_id: P1, preis_brutto: '12.5', rabatt_pct: '5', sonderrabatt_pct: '', ust_satz: '13' }, { position_id: P2, preis_brutto: '0', ust_satz: '20' }])
    const p = ergaenzPositionenAus(json)
    assert.deepEqual(p, [
      { position_id: P1, preis_brutto: 12.5, rabatt_pct: 5, sonderrabatt_pct: 0, ust_satz: 13 },
      { position_id: P2, preis_brutto: 0, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20 },
    ])
    assert.equal(ergaenzFehler('Abholung ab Hof', p), null)
    assert.match(ergaenzFehler('', p), /Vereinbarungen angeben/)
    assert.match(ergaenzFehler('Abholung', [p[0], p[0]]), /nicht gelesen/)
    assert.match(ergaenzFehler('Abholung', []), /nicht gelesen/)
    assert.match(ergaenzFehler('Abholung', [{ ...p[0], preis_brutto: NaN }]), /Position 1: Bitte einen Preis je Flasche/)
    for (const roh of [null, '{', '{}', JSON.stringify([{ position_id: 'abc', preis_brutto: '1', ust_satz: '13' }])]) assert.equal(ergaenzPositionenAus(roh), null, String(roh))
    assert.deepEqual(ergaenzPositionenFuerDb(p)[0], { position_id: P1, preis_brutto: '12.50', rabatt_pct: '5.00', sonderrabatt_pct: '0.00', ust_satz: '13.00' })
  })
  test('Seite: Ergänzen statt Auftragsbestätigung, solange etwas fehlt; Laden lehnt unvollständige Aufträge ab', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/page.tsx')
    assert.ok(p.includes('const ergaenzbar = unvollstaendig && darfSchreiben && auftragErgaenzbar('))
    assert.ok(p.includes('{ergaenzbar && <AuftragErgaenzen '))
    assert.ok(p.includes('{!unvollstaendig && abMoeglich('))
    const l = quelle('src/lib/auftrag/bestaetigungLaden.ts')
    assert.match(l, /if \(auftragUnvollstaendig\(a, zeilen\)\) \{\n\s+return \{ ok: false, status: 400,/)
  })
  test('Server Action: prüft wie das Formular, schreibt nur über die RPC', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts')
    const teil = a.slice(a.indexOf('export async function ergaenzeAuftrag'), a.indexOf('export async function stornoAuftrag'))
    assert.ok(teil.indexOf('const fehler = ergaenzFehler(lieferbedingungen, positionen)') < teil.indexOf('await getCtx()'))
    assert.ok(teil.indexOf('await getCtx()') < teil.indexOf("'s112_auftrag_ergaenzen'"))
    assert.doesNotMatch(teil, /\.from\(|\.update\(/)
    const k = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/AuftragErgaenzen.tsx')
    assert.match(k, /\} finally \{\n\s+setLaeuft\(false\)/)
  })
})

describe('KAN-487: Migration', () => {
  const sql = migration('kan487_auftrag_preise_lieferbedingungen')
  test('Spalte mit Längengrenze; in der Schema-Liste', () => {
    assert.match(sql, /ADD COLUMN lieferbedingungen text\s+CONSTRAINT auftraege_lieferbedingungen_chk\s+CHECK \(lieferbedingungen IS NULL OR \(lieferbedingungen = btrim\(lieferbedingungen\) AND char_length\(lieferbedingungen\) BETWEEN 1 AND 300\)\)/)
    assert.ok(JSON.parse(quelle('scripts/schema.json')).auftraege.includes('lieferbedingungen'))
  })
  test('Anlegen: Vereinbarungen und Preise sind Pflicht, die Preise werden gespeichert', () => {
    const anlegen = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.s112_auftrag_anlegen'), sql.indexOf('CREATE FUNCTION public.s112_auftrag_ergaenzen'))
    assert.ok(anlegen.includes("RAISE EXCEPTION 'Bitte die Lieferbedingungen angeben.' USING ERRCODE = '23514', HINT = 'lieferbedingungen';"))
    assert.ok(anlegen.includes("USING ERRCODE = '23514', HINT = 'preise';"))
    assert.ok(anlegen.includes('INSERT INTO public.auftrag_positionen (tenant_id, auftrag_id, fuellung_id, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz)'))
    assert.ok(anlegen.includes('reserviert_bis, notizen, lieferbedingungen, erstellt_von)'))
    // die Preise des Angebots werden nicht mehr über die Eingabe kopiert
    assert.doesNotMatch(anlegen, /SELECT DISTINCT ON \(fuellung_id\)/)
    assert.ok(anlegen.includes("REVOKE EXECUTE ON FUNCTION public.s112_auftrag_anlegen(uuid, jsonb, jsonb) FROM PUBLIC, anon;"))
  })
  test('Ergänzen: Zugriff vor Abo-Sperre und Schreibmodul, nur offen bzw. teilgeliefert, nur wenn etwas fehlt, nicht für PUBLIC/anon', () => {
    const erg = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_auftrag_ergaenzen'))
    const z = erg.indexOf('pruefe_tenant_zugriff(p_tenant_id'), abo = erg.indexOf('s112_pruefe_abo_schreibsperre(p_tenant_id)'), modul = erg.indexOf("s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')")
    assert.ok(z >= 0 && abo > z && modul > abo, `${z}/${abo}/${modul}`)
    assert.ok(erg.includes('SECURITY DEFINER\nSET search_path = public'))
    assert.ok(erg.includes("AND art = 'auftrag' FOR UPDATE;"))
    assert.ok(erg.includes("IF v_a.status NOT IN ('offen', 'teilgeliefert') THEN"))
    assert.ok(erg.includes("HINT = 'auftrag_vollstaendig';"))
    assert.ok(erg.indexOf("set_config('s112.auftrag_frei', 'ja', true)") < erg.indexOf("set_config('s112.auftrag_frei', '', true)"))
    assert.ok(erg.includes('REVOKE EXECUTE ON FUNCTION public.s112_auftrag_ergaenzen(uuid, uuid, text, jsonb) FROM PUBLIC, anon;'))
    assert.ok(erg.includes('GRANT EXECUTE ON FUNCTION public.s112_auftrag_ergaenzen(uuid, uuid, text, jsonb) TO authenticated, service_role;'))
  })
})
