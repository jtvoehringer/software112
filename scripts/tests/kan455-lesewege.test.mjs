// KAN-455 (13.11.2026): Rollen/Rechte R3, Teil Datenbank – Lesewege an den Sperr-Policies vorbei.
// Befund: SECURITY-DEFINER-Funktionen (UVA-Berechnung, CRM-Zähler, Behälterliste, Einkauf von Pflanzenschutzmitteln …)
// und der Storage liefen an den Policies „lesebereich“ (KAN-454) vorbei – ein Mitarbeiter mit Profil hätte dort alles
// gelesen. Neu: Leseprüfung in 27 Funktionen und eine Sperr-Policy auf storage.objects (Migration kan412c_lesewege).
// Das Verhalten prüft DB-Test 07 auf Staging; dieser Test hält Migration, DB-Test und Bereichsliste zusammen.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const LISTE = JSON.parse(quelle('scripts/lesebereiche.json'))
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}
const M = migration('kan412c_lesewege')
const DBTEST = quelle('scripts/db-tests/07_lesewege.sql')
function feld(name) {
  const m = new RegExp(`${name}\\s+constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(DBTEST)
  assert.ok(m, `${name} im DB-Test 07`)
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}
/** ('funktion', 'bereich')-Zeilen des n-ten VALUES-Blocks der Migration */
function werte(n) {
  const bloecke = [...M.matchAll(/FOR r IN SELECT \* FROM \(VALUES\n([\s\S]*?)\n {2}\) AS t\(funktion, bereich\) LOOP/g)]
  assert.equal(bloecke.length, 2, 'zwei Listen in der Migration (plpgsql, sql)')
  return [...bloecke[n][1].matchAll(/\('([a-z_0-9]+)', '([a-z]+)'\)/g)].map(x => `${x[1]}=${x[2]}`)
}

describe('KAN-455: Leseprüfung in den Funktionen', () => {
  const plpgsql = werte(0)
  const sql = werte(1)
  test('Migration und DB-Test 07 nennen dieselben Funktionen mit demselben Bereich', () => {
    // dazu seit KAN-456 (kan412d_extern_mittel) die drei Funktionen „Mittel ohne Preis“ mit dem Bereich massnahmen
    const erwartet = [...plpgsql, ...sql, 's112_stammdaten_bezuege=*', 'ki_readonly_query=ki',
      's112_psm_ohne_preis=massnahmen', 's112_duengemittel_ohne_preis=massnahmen', 's112_betriebsmittel_ohne_preis=massnahmen',
      // seit KAN-459 (kan459b_schreibwege_lesebereich) vier schreibende Funktionen
      's112_privat_bloecke=crm', 'setze_kontobewegung_abgeglichen=ea', 's112_fuellung_nachtragen=keller', 's112_storniert_loeschen=*'].sort()
    assert.deepEqual(feld('c_soll'), erwartet)
    assert.equal(erwartet.length, 34)
  })
  test('jeder Bereich ist ein Lesebereich der Liste – nie „allgemein“', () => {
    for (const e of [...plpgsql, ...sql]) {
      const b = e.split('=')[1]
      assert.ok(Object.keys(LISTE.bereiche).includes(b), e)
      assert.notEqual(b, 'allgemein', e)
    }
  })
  test('keine Funktion steht in beiden Listen des DB-Tests', () => {
    const soll = feld('c_soll').map(e => e.split('=')[0])
    const frei = feld('c_frei')
    assert.deepEqual(soll.filter(f => frei.includes(f)), [])
    assert.equal(new Set(frei).size, frei.length)
  })
  test('bewusst ohne Lesebereich: Zeitraum-Prüfung der E&A (der Verkauf braucht sie) und die Rechte-Helfer', () => {
    const frei = feld('c_frei')
    for (const f of ['pruefe_ea_zeitraum_offen', 's112_darf_lesen', 's112_paketmodul_frei', 's112_mandant_mitglieder']) assert.ok(frei.includes(f), f)
    assert.ok(!frei.includes('s112_privat_bloecke'), 'seit KAN-459 mit Leseprüfung crm – einzige Aufrufstelle ist die CRM-Seite')
  })
  test('ein Profil erreicht über sein Schreibmodul keine Funktion eines gesperrten Bereichs', () => {
    const soll = Object.fromEntries(feld('c_soll').map(e => e.split('=')))
    // Extern schreibt im Modul Rieden: Lese/AMA, Pressung, Einkauf und Übermittlung von Mitteln, Storno des Traubenverkaufs
    assert.equal(soll.s112_lager_einkauf, 'betriebsmittel')
    assert.equal(soll.s112_psm_uebermittlung_protokollieren, 'betriebsmittel')
    assert.equal(soll.s112_ama_meldung_speichern, 'lese')
    assert.equal(soll.s112_pressung_anlegen, 'lese')
    assert.equal(soll.s112_verkauf_samt_rechnung_stornieren, 'verkauf')
    // Vertrieb schreibt im Modul Warenwirtschaft: Schwund und Journal gehören zum Keller
    assert.equal(soll.schwund_buchen, 'keller')
    assert.equal(soll.s112_schwund_minderung, 'keller')
    assert.equal(soll.journal_abgleichen, 'keller')
  })
  test('die Prüfung wird genau einmal eingefügt, sonst bricht die Migration ab', () => {
    assert.match(M, /IF v_alt ~ 's112_pruefe_lesen' THEN RAISE EXCEPTION/)
    assert.match(M, /IF v_alt !~ c_ptz THEN RAISE EXCEPTION/)
    assert.match(M, /Prüfung nicht genau einmal eingefügt/)
    assert.match(M, /Anker der Mitgliedsprüfung nicht genau einmal/)
    assert.equal([...M.matchAll(/Anker fehlt/g)].length, 2)   // Stammdaten-Bezüge, KI-Abfrage
  })
  test('Stammdaten-Bezüge: Bereich je Tabelle wie in der Bereichsliste', () => {
    const block = /PERFORM public\.s112_pruefe_lesen\(p_tenant_id, CASE([\s\S]*?)ELSE '([a-z]+)' END\);/.exec(M)
    assert.ok(block)
    const zuordnung = {}
    for (const z of block[1].matchAll(/WHEN p_tabelle IN \(([^)]+)\) THEN '([a-z]+)'/g)) {
      for (const t of z[1].matchAll(/'([a-z_]+)'/g)) zuordnung[t[1]] = z[2]
    }
    for (const [t, b] of Object.entries(zuordnung)) assert.equal(LISTE.tabellen[t], b, t)
    assert.equal(Object.keys(zuordnung).length, 9)
    assert.equal(LISTE.tabellen.keller_behandlungstypen, block[2])   // ELSE-Zweig
  })
})

describe('KAN-455: Helfer und KI-Abfrage', () => {
  test('s112_pruefe_lesen: 42501 mit HINT lesebereich, für Benutzer nicht aufrufbar', () => {
    assert.match(M, /RAISE EXCEPTION 'Für diesen Bereich fehlt das Leserecht\.' USING ERRCODE = '42501', HINT = 'lesebereich'/)
    assert.match(M, /REVOKE EXECUTE ON FUNCTION public\.s112_pruefe_lesen\(uuid, text\) FROM PUBLIC, anon, authenticated;/)
    assert.match(M, /SECURITY DEFINER\s+SET search_path = public/)
  })
  test('KI-Abfrage: Bereich ki über die für authenticated ausführbare Prüfung (Eigentümer ki_abfrage)', () => {
    assert.match(M, /IF NOT public\.s112_darf_lesen\(p_tenant_id, 'ki'\) THEN/)
  })
  test('in den DB-Tests eingestuft', () => {
    assert.match(quelle('scripts/db-tests/_helfer.sql'), /\('intern',\s+'--S', false, 's112_pruefe_lesen\(p_tenant_id uuid, p_bereich text\)'\)/)
  })
})

describe('KAN-455: Storage', () => {
  const policy = /CREATE POLICY lesebereich ON storage\.objects AS RESTRICTIVE FOR SELECT TO authenticated USING \(([\s\S]*?)\n\);/.exec(M)
  test('eine Sperr-Policy, nur Lesen, nur authenticated', () => {
    assert.ok(policy)
    assert.equal([...M.matchAll(/CREATE POLICY/g)].length, 1)
  })
  test('jeder Bucket mit Betriebsordner hat seinen Bereich – wie im DB-Test; mandant-logos bleibt öffentlich', () => {
    const buckets = [...policy[1].matchAll(/bucket_id <> '([a-z-]+)' OR [^\n]*s112_lesegesperrte_tenants\('([a-z]+)'\)/g)].map(x => `${x[1]}=${x[2]}`)
    assert.deepEqual(buckets, ['aktivitaet-dokumente=crm', 'analysen=keller', 'dokumente=betrieb', 'ea-belege=ea', 'etiketten=lager', 'export-nachweise=verkauf', 'fuellung-bilder=lager'])
    assert.deepEqual(feld('c_buckets'), buckets)
    assert.doesNotMatch(policy[1], /mandant-logos/)
    for (const b of buckets) assert.ok(Object.keys(LISTE.bereiche).includes(b.split('=')[1]), b)
  })
  test('Objekte ohne Betriebsordner sperrt die Policy nicht zusätzlich (NULL-sicher)', () => {
    assert.equal([...policy[1].matchAll(/\(storage\.foldername\(name\)\)\[1\] IS NULL/g)].length, 7)
  })
})
