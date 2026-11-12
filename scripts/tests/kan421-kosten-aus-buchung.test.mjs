// KAN-421 (12.11.2026): Ausgabe beim Buchen in die Kostenrechnung übernehmen – Rechenfunktionen und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KOSTEN_FELD, kostenAufteilungFehler, kostenHerkunft, kostenRest, kostenRpcZeilen, kostenSumme, kostenZeilenAus,
} from '../../src/lib/kosten/aufteilung.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const KS1 = '11111111-1111-4111-8111-111111111111'
const KS2 = '22222222-2222-4222-8222-222222222222'
const KA = '33333333-3333-4333-8333-333333333334'
const json = z => JSON.stringify(z)

describe('KAN-421: Aufteilung lesen', () => {
  test('leer, fehlend und leere Zeilen ergeben keine Zeile', () => {
    assert.deepEqual(kostenZeilenAus(null), [])
    assert.deepEqual(kostenZeilenAus(''), [])
    assert.deepEqual(kostenZeilenAus('[]'), [])
    assert.deepEqual(kostenZeilenAus(json([{ kostenstelle_id: '', kostenart_id: '', betrag: '' }])), [])
  })
  test('Beträge mit Komma, Punkt und Tausenderpunkt; kaufmännisch auf Cent', () => {
    const z = kostenZeilenAus(json([
      { kostenstelle_id: KS1, kostenart_id: KA, betrag: '80,00' },
      { kostenstelle_id: KS2, kostenart_id: '', betrag: '1.234,505' },
      { kostenstelle_id: KS2, betrag: 40.1 },
    ]))
    assert.deepEqual(z, [
      { kostenstelle_id: KS1, kostenart_id: KA, betrag: 80 },
      { kostenstelle_id: KS2, kostenart_id: null, betrag: 1234.51 },
      { kostenstelle_id: KS2, kostenart_id: null, betrag: 40.1 },
    ])
  })
  test('nicht lesbar: kein JSON, kein Feld, fremde Kennung statt UUID', () => {
    assert.equal(kostenZeilenAus('{'), null)
    assert.equal(kostenZeilenAus('{"a":1}'), null)
    assert.equal(kostenZeilenAus(json([1])), null)
    assert.equal(kostenZeilenAus(json([{ kostenstelle_id: 'x; drop', betrag: 1 }])), null)
    assert.equal(kostenZeilenAus(json([{ kostenstelle_id: KS1, kostenart_id: 'abc', betrag: 1 }])), null)
    assert.equal(kostenZeilenAus(42), null)
  })
})

describe('KAN-421: Aufteilung prüfen', () => {
  const z = (...b) => b.map(betrag => ({ kostenstelle_id: KS1, kostenart_id: null, betrag }))
  test('ohne Zeile immer in Ordnung – auch bei einer Einnahme', () => {
    assert.equal(kostenAufteilungFehler([], 'einnahme', 100), null)
    assert.equal(kostenAufteilungFehler([], 'ausgabe', NaN), null)
  })
  test('Summe bis zum Nettobetrag, Rest bleibt ohne Kostenstelle', () => {
    assert.equal(kostenAufteilungFehler(z(80, 40), 'ausgabe', 120), null)
    assert.equal(kostenAufteilungFehler(z(80), 'ausgabe', 120), null)
    assert.equal(kostenRest(z(80), 120), 40)
    assert.equal(kostenRest(z(80, 40), 120), 0)
    assert.equal(kostenSumme(z(0.1, 0.2)), 0.3)   // nicht 0,30000000000000004
    assert.equal(kostenAufteilungFehler(z(0.1, 0.2), 'ausgabe', 0.3), null)
  })
  test('Summe über dem Nettobetrag, Betrag 0, fehlende Kostenstelle, Einnahme, zu viele Zeilen', () => {
    assert.match(kostenAufteilungFehler(z(80, 50), 'ausgabe', 120), /130,00 €.*120,00 €/)
    assert.match(kostenAufteilungFehler(z(0), 'ausgabe', 120), /Betrag über 0/)
    assert.match(kostenAufteilungFehler(z(NaN), 'ausgabe', 120), /Betrag über 0/)
    assert.match(kostenAufteilungFehler(z(-5), 'ausgabe', 120), /Betrag über 0/)
    assert.match(kostenAufteilungFehler([{ kostenstelle_id: '', kostenart_id: null, betrag: 5 }], 'ausgabe', 120), /Kostenstelle wählen/)
    assert.match(kostenAufteilungFehler(z(10), 'einnahme', 120), /Nur Ausgaben/)
    assert.match(kostenAufteilungFehler(z(...Array(21).fill(1)), 'ausgabe', 120), /Höchstens 20/)
    assert.match(kostenAufteilungFehler(null, 'ausgabe', 120), /nicht gelesen/)
    assert.match(kostenAufteilungFehler(z(10), 'ausgabe', NaN), /höher als der Nettobetrag/)
  })
  test('RPC-Zeilen und Herkunft', () => {
    assert.deepEqual(kostenRpcZeilen([{ kostenstelle_id: KS1, kostenart_id: KA, betrag: 5 }]), [{ kostenstelle_id: KS1, kostenart_id: KA, betrag: 5 }])
    assert.equal(kostenHerkunft({}), 'manuell')
    assert.equal(kostenHerkunft({ ea_transaktion_id: 'a', buchung: { storniert_am: null, storno_von_id: null } }), 'buchung')
    assert.equal(kostenHerkunft({ ea_transaktion_id: 'a', buchung: { storniert_am: '2026-11-12', storno_von_id: null } }), 'storniert')
    assert.equal(kostenHerkunft({ ea_transaktion_id: 'a', buchung: { storniert_am: null, storno_von_id: 'b' } }), 'storno')
  })
})

describe('KAN-421: Verdrahtung', () => {
  const aktionen = quelle('src/app/(dashboard)/buchhaltung/actions.ts')
  test('beide Buchungswege prüfen die Aufteilung VOR dem Anlegen und übernehmen danach per RPC', () => {
    for (const name of ['createEaTransaktion', 'verbucheBeleg']) {
      const fn = aktionen.slice(aktionen.indexOf(`export async function ${name}(`))
      const ende = fn.indexOf('\nexport async function ', 10)
      const k = fn.slice(0, ende < 0 ? undefined : ende)
      const pruefung = k.indexOf('await kostenAusFormular(formData, typ, betrag_netto)')
      const anlegen = k.indexOf(".from('ea_transaktionen') as any)")
      const rpc = k.indexOf('await kostenUebernehmen(supabase, tenantId')
      assert.ok(pruefung > 0 && anlegen > pruefung && rpc > anlegen, name)
      assert.match(k, /if \('error' in kosten\) return \{ error: kosten\.error \}/, name)
    }
    assert.match(aktionen, /supabase\.rpc\('s112_ea_kosten_zuordnen', \{\s*p_tenant_id: tenantId, p_ea_transaktion_id: eaId, p_zeilen: kostenRpcZeilen\(zeilen\),/)
    assert.match(aktionen, /if \(zeilen\.length > 0\) await pruefeModul\('modul_controlling'\)/)
    // Ein Fehler der Übernahme lässt die Buchung nicht scheitern (kein { error } – sonst zweite Buchung)
    assert.match(aktionen, /if \(kostenHinweis\) hinweise\.push\(kostenHinweis\)/)
    assert.match(aktionen, /if \(kostenHinweis\) return \{ ok: true, hinweis: kostenHinweis \}/)
  })
  test('Formulare: Baustein nur mit Kostenstellen (Modul Controlling), Feldname wie in der Action', () => {
    assert.equal(KOSTEN_FELD, 'kosten_json')
    const baustein = quelle('src/components/buchhaltung/KostenAufteilung.tsx')
    assert.match(baustein, /<input type="hidden" name=\{KOSTEN_FELD\} value=\{json\} \/>/)
    for (const p of ['src/app/(dashboard)/buchhaltung/neu/page.tsx', 'src/app/(dashboard)/buchhaltung/belege/[id]/page.tsx']) {
      const s = quelle(p)
      assert.match(s, /einst\?\.modul_controlling \? geladen\(await \(supabase\.from\('kostenstellen'\) as any\)/, p)
      assert.match(s, /\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)\.order\('name'\)\.order\('id'\), 'Kostenstellen'\)/, p)
    }
    assert.match(quelle('src/app/(dashboard)/buchhaltung/neu/page.tsx'), /\{kostenstellen\.length > 0 && \(\s*<KostenAufteilung/)
    assert.match(quelle('src/app/(dashboard)/buchhaltung/belege/[id]/BelegBuchenForm.tsx'), /\{kostenstellen\.length > 0 && <KostenAufteilung kostenstellen=\{kostenstellen\} kostenarten=\{kostenarten\} \/>\}/)
  })
  test('Kostenrechnung: Einträge aus einer Buchung mit Belegen, nicht änderbar', () => {
    const route = quelle('src/app/api/kostenrechnung/route.ts')
    assert.match(route, /ea_transaktion_id, buchung:ea_transaktion_id\(id, storniert_am, storno_von_id\)/)
    assert.match(route, /\.from\('ea_belege'\) as any\)\s*\.select\('id, dateiname, ea_transaktion_id'\)\s*\.eq\('tenant_id', t\)\.in\('ea_transaktion_id', b\)/)
    assert.match(route, /if \(b\.action === 'aktualisieren' \|\| b\.action === 'loeschen'\) \{[\s\S]{0,500}if \(\(vorh as R \| null\)\?\.ea_transaktion_id\) return fehlerAntwort\(AUS_BUCHUNG, 409\)/)
    const seite = quelle('src/app/(dashboard)/controlling/kostenrechnung/page.tsx')
    assert.match(seite, /<BelegAnhang transaktionId=\{e\.ea_transaktion_id\}[^>]*offeneBelege=\{\[\]\} darfAnhaengen=\{false\} \/>/)
    assert.match(seite, /\{e\.ea_transaktion_id \? null : <div className="flex gap-2">/)
  })
  test('Migration: Kaskade, Prüf-Trigger, Index, Schutz, RPC mit allen Prüfungen, Storno-Spiegel', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(f => f.endsWith('_kan421_kosten_aus_buchung.sql'))
    const entwurf = path.join(WURZEL, 'supabase', 'entwurf', 'kan421_kosten_aus_buchung.sql')
    const pfad = datei ? path.join(ordner, datei) : entwurf   // Entwurfsordner ist nicht eingecheckt
    if (!existsSync(pfad)) return
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN ea_transaktion_id uuid REFERENCES public\.ea_transaktionen\(id\) ON DELETE CASCADE/)
    assert.match(sql, /CREATE INDEX kosteneintraege_ea_transaktion_idx ON public\.kosteneintraege \(ea_transaktion_id\)/)
    assert.match(sql, /CREATE TRIGGER z_fremdverweis_ea_transaktion_id\s+BEFORE INSERT OR UPDATE OF ea_transaktion_id, tenant_id ON public\.kosteneintraege/)
    const rpc = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_ea_kosten_zuordnen'), sql.indexOf('-- ── 4.'))
    for (const p of ["pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer'])", 's112_pruefe_abo_schreibsperre(p_tenant_id)',
      "s112_pruefe_paketmodul(p_tenant_id, 'modul_ea')", "s112_pruefe_paketmodul(p_tenant_id, 'modul_controlling')", "s112_pruefe_schreibmodul(p_tenant_id, 'ea')"]) {
      assert.ok(rpc.includes(`PERFORM public.${p};`), p)
    }
    assert.match(rpc, /SET search_path = public/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_ea_kosten_zuordnen\(uuid, uuid, jsonb\) FROM PUBLIC, anon;/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kosten_buchung_schutz\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kosten_storno_spiegeln\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(sql, /AFTER INSERT ON public\.ea_transaktionen\s+FOR EACH ROW WHEN \(NEW\.storno_von_id IS NOT NULL\)/)
  })
})
