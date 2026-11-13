// KAN-456 (13.11.2026): Rollen/Rechte R4, Teil 3 – Mittelauswahl für das Profil „Extern“.
// Befund: „Extern“ erfasst Maßnahmen, liest aber die Tabellen der Mittel nicht (Lager, Einkauf, Preise) – das Formular
// zeigte keine Mittel, die Server Action meldete „Pflanzenschutzmittel wurde nicht gefunden“. Neu: drei Funktionen ohne
// Preis (Migration kan412d_extern_mittel) und profilClient(), der `.from('<mittel>')` für solche Mitglieder dorthin
// lenkt. Das Verhalten der Datenbank prüft DB-Test 07_extern_massnahme auf Staging.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MITTEL_FUNKTIONEN, brauchtMittelOhnePreis, profilClient, psmNachtragen, spaltenOhne } from '../../src/lib/auth/profilClient.ts'

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
const M = migration('kan412d_extern_mittel')
const SCHEMA = JSON.parse(quelle('scripts/schema.json'))

/** Attrappe: merkt sich Aufrufe; rpc liefert einen Baukasten mit select/eq/or/order/maybeSingle */
function attrappe(zeilen = []) {
  const aufrufe = []
  const bau = art => {
    const b = { art }
    for (const f of ['select', 'eq', 'or', 'order', 'is']) b[f] = (...a) => { aufrufe.push([art, f, ...a]); return b }
    b.maybeSingle = async () => ({ data: zeilen[0] ?? null, error: null })
    b.then = (ok, fehler) => Promise.resolve({ data: zeilen, error: null }).then(ok, fehler)
    return b
  }
  return {
    aufrufe,
    from(tabelle) { aufrufe.push(['from', tabelle]); return bau(`from:${tabelle}`) },
    rpc(fn, args) { aufrufe.push(['rpc', fn, args]); return bau(`rpc:${fn}`) },
    auth: { getUser() { return 'benutzer' } },
  }
}
const EXTERN = { role: 'winzer', profil: 'extern', tenantId: 't1' }

describe('KAN-456: wer braucht die Mittel ohne Preis', () => {
  test('nur Mitglieder mit Maßnahmen, aber ohne Betriebsmittel – also „Extern“', () => {
    assert.equal(brauchtMittelOhnePreis(EXTERN), true)
    assert.equal(brauchtMittelOhnePreis({ role: 'winzer', profil: 'vertrieb', tenantId: 't1' }), false)   // erfasst keine Maßnahmen
    for (const role of ['system_admin', 'tenant_admin', 'winzer', 'leser']) assert.equal(brauchtMittelOhnePreis({ role, tenantId: 't1' }), false, role)
    assert.equal(brauchtMittelOhnePreis(null), false)
    assert.equal(brauchtMittelOhnePreis({ role: 'winzer', profil: 'extern', tenantId: null }), false)
  })
})

describe('KAN-456: profilClient', () => {
  test('ohne Profil kommt der Client unverändert zurück', () => {
    const c = attrappe()
    assert.equal(profilClient(c, { role: 'winzer', tenantId: 't1' }), c)
    assert.equal(profilClient(c, null), c)
  })
  test('Extern: Mittel-Tabellen gehen an die Funktion des eigenen Betriebs, alle anderen Tabellen wie bisher', () => {
    const c = attrappe()
    const p = profilClient(c, EXTERN)
    p.from('pflanzenschutzmittel').select('id, name').eq('aktiv', true)
    p.from('duengemittel')
    p.from('betriebsmittel')
    p.from('behandlungen').select('id')
    assert.deepEqual(c.aufrufe.filter(a => a[0] === 'rpc'), [
      ['rpc', 's112_psm_ohne_preis', { p_tenant_id: 't1' }],
      ['rpc', 's112_duengemittel_ohne_preis', { p_tenant_id: 't1' }],
      ['rpc', 's112_betriebsmittel_ohne_preis', { p_tenant_id: 't1' }],
    ])
    assert.deepEqual(c.aufrufe.filter(a => a[0] === 'from'), [['from', 'behandlungen']])
    assert.deepEqual(c.aufrufe.find(a => a[0] === 'rpc:s112_psm_ohne_preis' && a[1] === 'eq'), ['rpc:s112_psm_ohne_preis', 'eq', 'aktiv', true])
  })
  test('select() wird um den Preis gekürzt – sonst lehnt die Datenbank die Abfrage ab', () => {
    const c = attrappe()
    const p = profilClient(c, EXTERN)
    p.from('pflanzenschutzmittel').select('id, name, wartezeit_tage, preis_pro_einheit, bienengefaehrlich')
    p.from('betriebsmittel').select('id, name, gruppe, einheit, preis_pro_einheit, ea_kategorie_id')
    p.from('duengemittel').select('*')
    assert.deepEqual(c.aufrufe.filter(a => a[1] === 'select').map(a => a[2]), ['id, name, wartezeit_tage, bienengefaehrlich', 'id, name, gruppe, einheit', '*'])
    assert.equal(spaltenOhne('preis_pro_einheit', ['preis_pro_einheit']), '')
  })
  test('andere Eigenschaften des Clients bleiben erreichbar (auth, rpc)', () => {
    const c = attrappe()
    const p = profilClient(c, EXTERN)
    assert.equal(p.auth.getUser(), 'benutzer')
    p.rpc('get_next_transaktionsnr', { p_tenant_id: 't1' })
    assert.deepEqual(c.aufrufe.at(-1), ['rpc', 'get_next_transaktionsnr', { p_tenant_id: 't1' }])
  })
})

describe('KAN-456: eingebettete Mittel nachtragen', () => {
  const zeilen = [{ id: 'b1', psm_id: 'p1', psm: null }, { id: 'b2', psm_id: null, psm: null }, { id: 'b3', psm_id: 'p9', psm: null }]
  test('Extern: Name und Wartezeit aus der Funktion; unbekannte und leere bleiben', async () => {
    const c = attrappe([{ id: 'p1', name: 'Kupfer', wartezeit_tage: 21 }])
    const r = await psmNachtragen(c, EXTERN, zeilen)
    assert.deepEqual(r.map(z => z.psm), [{ name: 'Kupfer', wartezeit_tage: 21 }, null, null])
    assert.deepEqual(c.aufrufe[0], ['rpc', 's112_psm_ohne_preis', { p_tenant_id: 't1' }])
  })
  test('ohne Profil bzw. ohne fehlende Mittel: keine Abfrage', async () => {
    const c = attrappe()
    assert.equal(await psmNachtragen(c, { role: 'winzer', tenantId: 't1' }, zeilen), zeilen)
    assert.equal(await psmNachtragen(c, EXTERN, [{ id: 'b1', psm_id: 'p1', psm: { name: 'x' } }]).then(r => r.length), 1)
    assert.equal(c.aufrufe.length, 0)
  })
})

describe('KAN-456: Funktionen der Migration = Liste der App = Tabelle ohne die ausgelassenen Spalten', () => {
  for (const [tabelle, { fn, ohne }] of Object.entries(MITTEL_FUNKTIONEN)) {
    test(`${fn}: alle Spalten von ${tabelle} außer ${ohne.join(', ')}`, () => {
      const kopf = new RegExp(`CREATE FUNCTION public\\.${fn}\\(p_tenant_id uuid\\)\\nRETURNS TABLE\\(([^\\n]+)\\)\\n`).exec(M)
      assert.ok(kopf, 'Funktion in der Migration')
      const spalten = kopf[1].split(', ').map(s => s.split(' ')[0])
      assert.deepEqual([...spalten].sort(), SCHEMA[tabelle].filter(s => !ohne.includes(s)).sort())
      for (const s of ohne) assert.ok(SCHEMA[tabelle].includes(s) && !spalten.includes(s), s)
    })
  }
  test('Zugriff: Mitglied des Betriebs mit Lesebereich massnahmen; nicht für anon', () => {
    assert.equal([...M.matchAll(/PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, NULL\);\n {2}PERFORM public\.s112_pruefe_lesen\(p_tenant_id, 'massnahmen'\);/g)].length, 3)
    assert.equal([...M.matchAll(/REVOKE EXECUTE ON FUNCTION public\.s112_\w+_ohne_preis\(uuid\) FROM PUBLIC, anon;/g)].length, 3)
    assert.equal([...M.matchAll(/SECURITY DEFINER\nSET search_path = public/g)].length, 3)
  })
  test('Betriebsmittel nur des eigenen Betriebs; Pflanzenschutz- und Düngemittel samt Katalog', () => {
    assert.match(M, /FROM public\.betriebsmittel m\n {5}WHERE m\.tenant_id = p_tenant_id;/)
    assert.equal([...M.matchAll(/WHERE m\.tenant_id = p_tenant_id OR m\.tenant_id IS NULL;/g)].length, 2)
  })
  test('Morgenbericht: Tabelle und Seite im Bereich verwaltung', () => {
    assert.match(M, /CREATE POLICY lesebereich ON public\.morgenberichte AS RESTRICTIVE FOR SELECT TO authenticated\n {2}USING \(NOT \(tenant_id IN \(SELECT public\.s112_lesegesperrte_tenants\('verwaltung'\)\)\)\);/)
    assert.equal(JSON.parse(quelle('scripts/lesebereiche.json')).tabellen.morgenberichte, 'verwaltung')
  })
})

describe('KAN-456: Maßnahmen-Seiten und Server Action', () => {
  const D = 'src/app/(dashboard)/behandlungen/'
  test('Formular, Bearbeiten und alle fünf Actions lesen über profilClient', () => {
    assert.match(quelle(D + 'neu/page.tsx'), /const supabase = profilClient\(await createSupabaseServerClient\(\), await getCurrentMembership\(\)\)/)
    assert.match(quelle(D + '[id]/edit/page.tsx'), /const supabase = profilClient\(await createSupabaseServerClient\(\), await getCurrentMembership\(\)\)/)
    const a = quelle(D + 'actions.ts')
    assert.equal([...a.matchAll(/const supabase = profilClient\(await createSupabaseServerClient\(\), await getCurrentMembership\(\)\)/g)].length, 5)
    assert.doesNotMatch(a, /const supabase = await createSupabaseServerClient\(\)/)
  })
  test('die Action schreibt nicht in die Mittel-Tabellen (der Client taugt nur zum Lesen)', () => {
    const a = quelle(D + 'actions.ts')
    assert.doesNotMatch(a, /from\('(pflanzenschutzmittel|duengemittel|betriebsmittel)'\) as any\)\s*\.(insert|update|delete|upsert)\(/)
  })
  test('Kosten erfassen nur mit Lesebereich controlling (Extern erfasst keine Kosten)', () => {
    for (const f of ['neu/page.tsx', '[id]/edit/page.tsx']) assert.match(quelle(D + f), /kostenModul=\{\(await hatModul\('modul_controlling'\)\) && canRead\(membership, 'controlling'\)\}/, f)
  })
  test('Liste und Bearbeiten tragen das eingebettete Mittel nach', () => {
    assert.match(quelle(D + 'page.tsx'), /const rawB = await psmNachtragen\(supabase, membership, \(geladen\(rawBRes, 'Maßnahmen'\) \?\? \[\]\) as AR\[\]\)/)
    const e = quelle(D + '[id]/edit/page.tsx')
    assert.match(e, /\(await psmNachtragen\(supabase, membership, \[geladenB as AR\]\)\)\[0\]/)
    assert.match(e, /\.select\('id, psm_id, psm:psm_id\(name\)'\)/)
  })
})
