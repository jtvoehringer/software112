// KAN-418 Teil 2 (12.11.2026): Lieferung aus dem Auftrag – Regeln und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIEFERBAR_STATUS, auftragAusSuche, auftragIdAus, gleicherKunde, lieferFehler, lieferPositionenAus, lieferVorschlag, offeneMenge,
} from '../../src/lib/auftrag/lieferung.ts'
import { AUFTRAG_STATUS_LABEL, RESERVIERT_STATUS, reservierungAbgelaufen } from '../../src/lib/auftrag/regeln.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const K = '33333333-3333-4333-8333-333333333333'
const AUFTRAG = [
  { id: P1, fuellung_id: F1, name: 'Zierfandler 2025', menge: 12, geliefert: 5 },
  { id: P2, fuellung_id: F2, name: 'Rotgipfler 2025', menge: 6, geliefert: 6 },
]

function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}

describe('KAN-418 Teil 2: offene Mengen und Vorbelegung', () => {
  test('offen = bestellt − geliefert, nie negativ', () => {
    assert.equal(offeneMenge({ menge: 12, geliefert: 5 }), 7)
    assert.equal(offeneMenge({ menge: 12, geliefert: null }), 12)
    assert.equal(offeneMenge({ menge: 6, geliefert: 9 }), 0)
  })
  test('Vorschlag: nur Positionen mit offener Menge, in der Reihenfolge des Auftrags', () => {
    // KAN-418 Teil 4: der Vorschlag trägt zusätzlich den Angebotspreis – null, wenn der Auftrag nicht aus einem Angebot stammt
    assert.deepEqual(lieferVorschlag(AUFTRAG), [{ position_id: P1, fuellung_id: F1, name: 'Zierfandler 2025', offen: 7, preis: null }])
    assert.deepEqual(lieferVorschlag([]), [])
  })
  test('Auftrags-ID aus Adresszeile und Formular: nur UUIDs', () => {
    assert.equal(auftragAusSuche(`?auftrag=${P1.toUpperCase()}`), P1)
    assert.equal(auftragAusSuche('?auftrag=abc'), '')
    assert.equal(auftragAusSuche('?mail=1'), '')
    for (const roh of [null, undefined, 5, '', `${P1}'; --`]) assert.equal(auftragIdAus(roh), '', String(roh))
  })
  test('lieferbar sind offene und teilgelieferte Aufträge – dieselben, die reservieren', () => {
    assert.deepEqual([...LIEFERBAR_STATUS], [...RESERVIERT_STATUS])
    assert.equal(AUFTRAG_STATUS_LABEL.abgeschlossen, 'Abgeschlossen')
    // ein abgeschlossener Auftrag reserviert nichts und zeigt keinen Ablauf-Hinweis
    assert.equal(reservierungAbgelaufen({ status: 'abgeschlossen', reserviert_bis: '2026-01-01' }, '2026-11-12'), false)
  })
})

describe('KAN-418 Teil 2: Positionen der Lieferung', () => {
  test('nur Flaschen mit Füllung und Auftragsposition zählen zur Lieferung', () => {
    const l = lieferPositionenAus([
      { typ: 'flasche', fuellung_id: F1, menge: 5, auftrag_position_id: P1 },
      { typ: 'flasche', fuellung_id: F1, menge: 3 },                              // freie Mehrmenge
      { typ: 'flasche', fuellung_id: F1, menge: 2, auftrag_position_id: 'x' },    // keine UUID
      { typ: 'tank', fuellung_id: null, menge: 100, auftrag_position_id: P1 },
      { typ: 'sonstiges', fuellung_id: null, menge: 1, auftrag_position_id: P2 },
    ])
    assert.deepEqual(l, [{ position_id: P1, fuellung_id: F1, menge: 5 }])
  })
  test('höchstens die offene Menge – auch über mehrere Zeilen derselben Auftragsposition', () => {
    assert.equal(lieferFehler([{ position_id: P1, fuellung_id: F1, menge: 7 }], AUFTRAG), null)
    assert.match(lieferFehler([{ position_id: P1, fuellung_id: F1, menge: 8 }], AUFTRAG), /nur noch 7 Flaschen offen, 8 angefragt.*eigene Position/)
    assert.match(lieferFehler([{ position_id: P1, fuellung_id: F1, menge: 4 }, { position_id: P1, fuellung_id: F1, menge: 4 }], AUFTRAG), /nur noch 7 Flaschen offen, 8 angefragt/)
    assert.match(lieferFehler([{ position_id: P2, fuellung_id: F2, menge: 1 }], AUFTRAG), /nur noch 0 Flaschen offen/)
  })
  test('fremde Position, falsche Füllung, ungültige Menge, leere Lieferung', () => {
    assert.match(lieferFehler([], AUFTRAG), /keine Position des Auftrags/)
    assert.match(lieferFehler([{ position_id: K, fuellung_id: F1, menge: 1 }], AUFTRAG), /gehört nicht zu diesem Auftrag/)
    assert.match(lieferFehler([{ position_id: P1, fuellung_id: F2, menge: 1 }], AUFTRAG), /Füllung passt nicht/)
    for (const menge of [0, -1, 1.5, NaN]) assert.match(lieferFehler([{ position_id: P1, fuellung_id: F1, menge }], AUFTRAG), /ganze Zahl ab 1 Flasche/, String(menge))
  })
  test('derselbe Kunde: Kontakt bzw. Firma des Auftrags', () => {
    assert.equal(gleicherKunde({ kontakt_id: K, firma_id: null }, K, null), true)
    assert.equal(gleicherKunde({ kontakt_id: K, firma_id: null }, P1, null), false)
    assert.equal(gleicherKunde({ kontakt_id: K, firma_id: null }, K, F1), false)
    assert.equal(gleicherKunde({ kontakt_id: null, firma_id: F1 }, null, F1), true)
    assert.equal(gleicherKunde({ kontakt_id: null, firma_id: F1 }, K, null), false)
    assert.equal(gleicherKunde({ kontakt_id: null, firma_id: null }, null, null), false)
  })
})

describe('KAN-418 Teil 2: createVerkauf', () => {
  const s = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  const cv = s.slice(s.indexOf('export async function createVerkauf'), s.indexOf('export async function speichereVerkaufTexte'))
  const i = t => { const n = cv.indexOf(t); assert.ok(n >= 0, t); return n }
  test('Auftrag wird vor jedem Schreibzugriff geprüft: eigener Betrieb, lieferbar, derselbe Kunde, offene Mengen', () => {
    const pruefung = cv.slice(i("auftragIdAus(formData.get('auftrag_id'))"), i('// ── Prüfung VOR dem ersten Schreibzugriff'))
    assert.match(pruefung, /\.eq\('id', auftragId\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)/)
    assert.match(pruefung, /if \(aufErr\) throw new AktionsFehler/)
    assert.match(pruefung, /LIEFERBAR_STATUS\.includes/)
    assert.match(pruefung, /gleicherKunde\(/)
    assert.match(pruefung, /lieferFehler\(lieferPos,/)
    assert.doesNotMatch(pruefung, /\.insert\(|\.update\(|\.rpc\b/)
  })
  test('Lieferung wird vor der Bestandsbuchung vermerkt, erst danach entsteht der Beleg', () => {
    assert.ok(i("('s112_auftrag_liefern'") < i('bestandBuchenAllesOderNichts('))
    assert.ok(i('bestandBuchenAllesOderNichts(') < i("(supabase.from('verkaufsposten') as any).insert("))
    assert.match(cv, /p_auftrag_id: auftragId, p_verkaufsposten_id: postenId, p_positionen: lieferPos/)
    // ohne Auftrag kein Aufruf
    assert.match(cv, /if \(auftragId\) \{\n\s+\/\/ eslint-disable-next-line[^\n]*\n\s+const \{ error: lErr \}/)
  })
  test('jeder Abbruch nach dem Vermerk nimmt die Lieferung zurück', () => {
    const fang = cv.slice(i('abbuchungen = await bestandBuchenAllesOderNichts('), i('let rechnungsnummer'))
    assert.match(fang, /const lz = await lieferungZurueck\(\)/)
    const abbruch = cv.slice(i('const abbruch = async'), i('// Transaktionsnummer vergeben'))
    assert.match(abbruch, /if \(!postenStornieren\) \{\n\s+const lz = await lieferungZurueck\(\)/)
    assert.match(cv, /'s112_auftrag_lieferung_zuruecknehmen', \{ p_tenant_id: tenantId, p_verkaufsposten_id: postenId \}/)
  })
})

describe('KAN-418 Teil 2: Formular und Seiten', () => {
  test('Verkaufsformular: Vorbelegung aus ?auftrag=, Obergrenze, Bezug im Formular', () => {
    const f = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
    assert.match(f, /auftragAusSuche\(window\.location\.search\)/)
    assert.match(f, /ladeAuftragFuerLieferung\(auftragId\)/)
    assert.match(f, /if \(auftrag\) formData\.set\('auftrag_id', auftrag\.id\)/)
    assert.match(f, /auftrag_position_id:\s+auftrag && p\.typ === 'flasche'/)
    assert.match(f, /Number\(p\.menge\) > \(p\.auftrag_offen \?\? 0\)/)
    // andere Füllung → kein Bezug mehr zur Auftragsposition
    assert.match(f, /next\[idx\]\.auftrag_position_id = undefined/)
  })
  test('Auftrags-Actions: Vorbelegung und Abschließen mit Schreibrecht, Abschließen nur über die RPC', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/auftraege/actions.ts')
    const laden = a.slice(a.indexOf('export async function ladeAuftragFuerLieferung'), a.indexOf('export async function auftragAbschliessen'))
    assert.match(laden, /await getCtx\(\)/)
    assert.match(laden, /\.eq\('id', auftragId\)\.eq\('tenant_id', tenantId\)/)
    assert.match(laden, /if \(aErr\) return \{ error/)
    assert.match(laden, /if \(zErr\) return \{ error/)
    const ab = a.slice(a.indexOf('export async function auftragAbschliessen'), a.indexOf('export async function setzeReservierungBis'))
    assert.match(ab, /await getCtx\(\)/)
    assert.match(ab, /'s112_auftrag_abschliessen', \{ p_tenant_id: tenantId, p_auftrag_id: id \}/)
    assert.doesNotMatch(a, /\.insert\(|\.delete\(|\.upsert\(/)
  })
  test('Auftragsdetail: Liefern nur lieferbar und mit Schreibrecht; Stornieren nur ohne Lieferung, Abschließen nur teilgeliefert', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/page.tsx')
    assert.match(p, /\/weinhandel\/verkauf\/neu\?auftrag=\$\{a\.id\}/)
    assert.match(p, /kannStornieren=\{a\.status === 'offen'\} kannAbschliessen=\{a\.status === 'teilgeliefert'\}/)
    assert.match(p, /darfSchreiben && reserviert/)
    assert.match(p, /inBloecken<R>\(verkaufIds/)
    const k = quelle('src/app/(dashboard)/weinhandel/auftraege/[id]/AuftragAktionen.tsx')
    assert.match(k, /await rueckfrage\(\{/)
    assert.doesNotMatch(k, /confirm\(/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx'), /zu Auftrag <Link href=\{`\/weinhandel\/auftraege\/\$\{auftragZuVerkauf\.id\}`\}/)
  })
  test('Wächter und Abgleich kennen die Lieferungen', () => {
    assert.match(quelle('scripts/check-alle.js'), /'auftrag_lieferungen'/)
    const ab = quelle('scripts/daten-abgleich.sql')
    assert.match(ab, /'lieferung_ohne_verkauf'/)
    assert.match(ab, /'auftrag_geliefert_ungleich'/)
  })
})

describe('KAN-418 Teil 2: Migration', () => {
  const sql = migration('kan418c_auftrag_lieferung')
  test('Lieferungen nur lesbar; Verweis auf den Verkauf ohne Fremdschlüssel, Verweise in den Auftrag geprüft und indiziert', () => {
    assert.ok(sql.includes("t text := 'auftrag_lieferungen';"))
    const policies = sql.split('\n').filter(z => z.includes('CREATE POLICY '))
    assert.equal(policies.length, 6)
    for (const p of policies) {
      assert.ok(p.includes(' TO authenticated'), p)
      if (!p.includes('AS RESTRICTIVE')) assert.ok(p.includes(' FOR SELECT '), p)
    }
    assert.match(sql, /verkaufsposten_id\s+uuid NOT NULL,/)
    for (const sp of ['auftrag_id', 'auftrag_position_id']) assert.ok(sql.includes(`CREATE TRIGGER z_fremdverweis_${sp} BEFORE INSERT OR UPDATE OF ${sp}, tenant_id ON public.auftrag_lieferungen`), sp)
    for (const idx of ['tenant_id', 'auftrag_id', 'auftrag_position_id', 'verkaufsposten_id']) assert.ok(sql.includes(`ON public.auftrag_lieferungen (${idx})`), idx)
  })
  test('RPCs: Zugriff vor Abo-Sperre und Schreibmodul; interne Funktionen ohne EXECUTE für Benutzer', () => {
    for (const f of ['s112_auftrag_liefern', 's112_auftrag_lieferung_zuruecknehmen', 's112_auftrag_abschliessen', 's112_auftrag_stornieren']) {
      const ab = sql.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${f}\\(`))
      assert.ok(ab >= 0, f)
      const k = sql.slice(ab, ab + 1200)
      const z = k.indexOf('pruefe_tenant_zugriff(p_tenant_id'), abo = k.indexOf('s112_pruefe_abo_schreibsperre(p_tenant_id)'), modul = k.indexOf("s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')")
      assert.ok(z >= 0 && abo > z && modul > abo, `${f}: ${z}/${abo}/${modul}`)
    }
    for (const f of ['s112_auftrag_status_setzen(uuid)', 's112_auftrag_lieferung_zurueck_intern(uuid, text)', 's112_auftrag_lieferung_storno()']) {
      assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f)
    }
    for (const f of ['s112_auftrag_liefern(uuid, uuid, uuid, jsonb)', 's112_auftrag_lieferung_zuruecknehmen(uuid, uuid)', 's112_auftrag_abschliessen(uuid, uuid)']) {
      assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`), f)
    }
    assert.equal((sql.match(/SECURITY DEFINER\nSET search_path = public/g) ?? []).length, 7)
  })
  test('Obergrenze, Storno-Rücknahme über jeden Weg, Rücknahme nicht bei gültigem Verkauf', () => {
    assert.ok(sql.includes('IF v_z.menge > v_p.menge - v_p.geliefert THEN'))
    assert.ok(sql.includes("HINT = 'auftrag_offen'"))
    assert.ok(sql.includes('CREATE TRIGGER z_auftrag_lieferung_storno AFTER UPDATE OF storniert ON public.verkaufsposten'))
    assert.ok(sql.includes('WHEN (NEW.storniert IS TRUE AND OLD.storniert IS DISTINCT FROM TRUE)'))
    assert.ok(sql.includes('WHERE v.id = p_verkaufsposten_id AND v.storniert IS NOT TRUE'))
    assert.ok(sql.includes("CHECK (status IN ('offen', 'teilgeliefert', 'geliefert', 'abgeschlossen', 'storniert'))"))
  })
})
