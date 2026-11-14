// KAN-458 (14.11.2026): Rechtsverhältnis, Einheitswert und SVS-Zurechnung der Grundstücke in eigener Tabelle.
// Befund: Das Profil „Extern“ liest die Grundstücke seiner Rieden – und damit auch Pacht/Eigentum, Einheitswert und
// SVS-Zurechnung, die in derselben Tabelle standen. Neu: grundstueck_recht (Lesebereich ea, höchstens eine Zeile je
// Grundstück); die App liest über eine Einbettung und schreibt über speichereGrundstueckRecht(). Schritt 1 (kan458a):
// Tabelle neben den alten Spalten mit Abgleich; Schritt 2 (kan458b): Abgleich und alte Spalten entfernt, Demo-Funktionen
// umgestellt. Datenbank: DB-Test 07_grundstueck_recht.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECHT_SPALTEN, RECHT_EINBETTUNG, mitRecht, speichereGrundstueckRecht } from '../../src/lib/wein/grundstueckRecht.ts'
import { canRead } from '../../src/lib/auth/lesebereiche.ts'
import { meldungsBereich } from '../../src/lib/behoerden/bereich.ts'

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
const M = migration('kan458a_grundstueck_recht')
const M2 = migration('kan458b_grundstuecke_ohne_recht')
const SCHEMA = JSON.parse(quelle('scripts/schema.json'))
const LISTE = JSON.parse(quelle('scripts/lesebereiche.json'))

describe('KAN-458: Lesen über die Einbettung', () => {
  test('Einbettung nennt genau die fünf Spalten', () => {
    assert.deepEqual([...RECHT_SPALTEN], ['rechtsverhaeltnis', 'einheitswert', 'einheitswert_bescheid', 'einheitswert_quelle', 'svs_zurechnung'])
    assert.equal(RECHT_EINBETTUNG, 'recht:grundstueck_recht(rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung)')
  })
  test('mitRecht: Objekt, Liste, fehlende Zeile und fehlendes Leserecht', () => {
    const basis = { id: 'g1', gst_nr: '12/3' }
    assert.deepEqual(mitRecht({ ...basis, recht: { rechtsverhaeltnis: 'pacht', einheitswert: 1200.5, einheitswert_bescheid: '2026-01-15', einheitswert_quelle: 'import', svs_zurechnung: 'pacht_fremd' } }),
      { ...basis, rechtsverhaeltnis: 'pacht', einheitswert: 1200.5, einheitswert_bescheid: '2026-01-15', einheitswert_quelle: 'import', svs_zurechnung: 'pacht_fremd' })
    assert.equal(mitRecht({ ...basis, recht: [{ rechtsverhaeltnis: 'eigentum', svs_zurechnung: 'eigen' }] }).rechtsverhaeltnis, 'eigentum')
    // ohne Zeile bzw. ohne Leserecht (Einbettung null): dieselben Standardwerte wie die frühere Spalte
    for (const recht of [null, undefined, []]) {
      assert.deepEqual(mitRecht({ ...basis, recht }), { ...basis, rechtsverhaeltnis: null, einheitswert: null, einheitswert_bescheid: null, einheitswert_quelle: null, svs_zurechnung: 'eigen' })
    }
    assert.ok(!('recht' in mitRecht({ ...basis, recht: null })))
  })
  test('ein Einheitswert 0 bleibt 0 (nicht „kein Wert“)', () => {
    assert.equal(mitRecht({ id: 'g', recht: { einheitswert: 0, svs_zurechnung: 'keine' } }).einheitswert, 0)
  })
})

describe('KAN-458: Schreiben', () => {
  function attrappe(antwort) {
    const aufrufe = []
    return {
      aufrufe,
      from(tabelle) {
        return { upsert(werte, opt) { aufrufe.push({ tabelle, werte, opt }); return { select: async spalten => { aufrufe.at(-1).select = spalten; return antwort } } } }
      },
    }
  }
  test('legt an bzw. ändert nur die übergebenen Werte – eine Zeile je Grundstück', async () => {
    const c = attrappe({ data: [{ id: 'r1' }], error: null })
    assert.equal(await speichereGrundstueckRecht(c, 't1', 'g1', { rechtsverhaeltnis: 'pacht' }), null)
    assert.deepEqual(c.aufrufe, [{ tabelle: 'grundstueck_recht', werte: { tenant_id: 't1', grundstueck_id: 'g1', rechtsverhaeltnis: 'pacht' }, opt: { onConflict: 'grundstueck_id' }, select: 'id' }])
  })
  test('Datenbankfehler und 0 geschriebene Zeilen (RLS) werden gemeldet', async () => {
    assert.equal(await speichereGrundstueckRecht(attrappe({ data: null, error: { message: 'verletzt CHECK' } }), 't', 'g', {}), 'verletzt CHECK')
    assert.match(await speichereGrundstueckRecht(attrappe({ data: [], error: null }), 't', 'g', {}), /konnten nicht gespeichert werden/)
  })
})

describe('KAN-458: die App nutzt die alten Spalten nicht mehr', () => {
  const ALT = /\b(rechtsverhaeltnis|einheitswert|einheitswert_bescheid|einheitswert_quelle|svs_zurechnung)\b/
  test('keine Abfrage auf grundstuecke wählt oder schreibt eine der fünf Spalten', () => {
    const funde = []
    const lauf = dir => {
      for (const e of readdirSync(path.join(WURZEL, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { lauf(p); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        const text = quelle(p)
        // select-Listen direkt hinter .from('grundstuecke') und Schreibobjekte an grundstuecke
        for (const m of text.matchAll(/from\('grundstuecke'\)[^\n]*\n?[^\n]*\.(select|update|insert|upsert)\(([^)]*)\)/g)) {
          const ohneEinbettung = m[2].replace(/RECHT_EINBETTUNG/g, '')
          if (ALT.test(ohneEinbettung)) funde.push(`${p.split(path.sep).join('/')}: ${m[1]}`)
        }
      }
    }
    lauf('src')
    assert.deepEqual(funde, [])
  })
  test('Rieden: Detailseite bettet ein, Actions speichern das Rechtsverhältnis getrennt und nur mit Leserecht', () => {
    assert.match(quelle('src/app/(dashboard)/weingarten/[id]/page.tsx'), /\$\{RECHT_EINBETTUNG\}`\)/)
    assert.match(quelle('src/app/(dashboard)/weingarten/[id]/page.tsx'), /rechtLesbar=\{canRead\(membership, 'ea'\)\}/)
    const a = quelle('src/app/(dashboard)/weingarten/actions.ts')
    assert.doesNotMatch(a, /rechtsverhaeltnis: {2,}\(formData\.get/)   // die frühere Zeile im Payload von grundstuecke
    assert.match(a, /if \(!formData\.has\('rechtsverhaeltnis'\) \|\| !canRead\(await getCurrentMembership\(\), 'ea'\)\) return/)
    assert.equal([...a.matchAll(/await rechtsverhaeltnisSpeichern\(supabase, tenantId, /g)].length, 2)   // anlegen und ändern
    assert.match(quelle('src/app/(dashboard)/weingarten/GrundstueckePanel.tsx'), /\{rechtLesbar && <div>\n\s+<label[^>]*>Rechtsverhältnis<\/label>/)
  })
  test('SVS: Tabelle und Import speichern über speichereGrundstueckRecht', () => {
    const a = quelle('src/app/(dashboard)/buchhaltung/svs/actions.ts')
    assert.equal([...a.matchAll(/await speichereGrundstueckRecht\(supabase, tenantId, /g)].length, 2)
    assert.doesNotMatch(a, /from\('grundstuecke'\) as any\)\s*\.update\(/)
  })
  test('Behördenmeldungen: SVS-Einheitswerte, Flächenverzeichnis und BKI-Weingärten lesen über die Einbettung', () => {
    assert.match(quelle('src/lib/behoerden/svs.ts'), /data\.map\(g => svsEinheitswertZeile\(mitRecht\(g\)\)\)/)
    assert.match(quelle('src/lib/behoerden/flaechenverzeichnis.ts'), /g\.data\.map\(r => gstAus\(mitRecht\(r\)\)\)/)
    assert.match(quelle('src/lib/behoerden/bki-weingaerten.ts'), /const alleGst = g\.data\.map\(mitRecht\)/)
    for (const f of ['svs.ts', 'flaechenverzeichnis.ts', 'bki-weingaerten.ts']) assert.match(quelle('src/lib/behoerden/' + f), /RECHT_EINBETTUNG/, f)
  })
})

describe('KAN-458: Lesebereich und Listen', () => {
  test('grundstueck_recht liegt im Bereich ea – Extern und Vertrieb lesen ihn nicht; die Grundstücke bleiben bei Rieden', () => {
    assert.equal(LISTE.tabellen.grundstueck_recht, 'ea')
    assert.equal(LISTE.tabellen.grundstuecke, 'rieden')
    for (const profil of ['extern', 'vertrieb']) assert.equal(canRead({ role: 'winzer', profil }, 'ea'), false, profil)
    assert.equal(canRead({ role: 'winzer', profil: 'extern' }, 'rieden'), true)
  })
  test('Flächenverzeichnis (enthält das Rechtsverhältnis) nur mit Lesebereich ea', () => {
    const k = quelle('src/lib/behoerden/katalog/flaechen.ts')
    assert.match(k, /flaechenverzeichnis: \{\n {4}bereich: 'ea',/)
    assert.equal(meldungsBereich({ gruppe: 'flaechen', bereich: 'ea' }), 'ea')
  })
  test('Schema, Fremdschlüssel und große Tabellen kennen die neue Tabelle', () => {
    assert.deepEqual(SCHEMA.grundstueck_recht, ['id', 'tenant_id', 'grundstueck_id', ...RECHT_SPALTEN, 'created_at', 'updated_at'])
    const fk = JSON.parse(quelle('scripts/fremdschluessel.json')).filter(f => f.t === 'grundstueck_recht')
    assert.deepEqual(fk.map(f => `${f.s.join()}→${f.z}`).sort(), ['grundstueck_id→grundstuecke', 'tenant_id→tenants'])
    assert.match(quelle('scripts/check-alle.js'), /'grundstuecke', 'grundstueck_recht',/)
  })
})

describe('KAN-458: Migration kan458a', () => {
  test('Tabelle: eine Zeile je Grundstück, Kaskade, CHECKs wie die alten Spalten', () => {
    assert.match(M, /grundstueck_id\s+uuid NOT NULL UNIQUE REFERENCES public\.grundstuecke\(id\) ON DELETE CASCADE/)
    assert.match(M, /rechtsverhaeltnis IS NULL OR rechtsverhaeltnis IN \('eigentum', 'pacht', 'nutzung'\)/)
    assert.match(M, /svs_zurechnung\s+text NOT NULL DEFAULT 'eigen'[\s\S]{0,120}IN \('eigen', 'pacht_fremd', 'pacht_angehoerige', 'verpachtet', 'keine'\)/)
    assert.match(M, /CREATE INDEX idx_grundstueck_recht_tenant ON public\.grundstueck_recht \(tenant_id\)/)
  })
  test('Policies nur für authenticated; Sperren für Mitgliedschaft, Zwei-Faktor, Abo, Schreibmodul und Lesebereich ea', () => {
    const policies = [...M.matchAll(/CREATE POLICY (\w+) ON public\.grundstueck_recht([^;]*);/g)]
    assert.equal(policies.length, 13)
    for (const p of policies) assert.match(p[2], /TO authenticated/, p[1])
    assert.deepEqual(policies.map(p => p[1]).sort(), ['abo_schreibsperre_del', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'grundstueck_recht_delete',
      'grundstueck_recht_insert', 'grundstueck_recht_select', 'grundstueck_recht_update', 'lesebereich', 'mitgliedschaft_aktiv', 'modul_delete', 'modul_insert',
      'modul_update', 'zwei_faktor_aal'])
    assert.match(M, /CREATE POLICY lesebereich ON public\.grundstueck_recht AS RESTRICTIVE FOR SELECT TO authenticated\n\s+USING \(NOT \(tenant_id IN \(SELECT public\.s112_lesegesperrte_tenants\('ea'\)\)\)\)/)
    assert.equal([...M.matchAll(/s112_darf_schreiben\(tenant_id, VARIADIC ARRAY\['rieden', 'ea'\]\)/g)].length, 4)
  })
  test('Fremdverweis-Trigger; Protokoll-Trigger erst NACH der Datenübernahme (kein Protokolleintrag je Grundstück)', () => {
    assert.match(M, /CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, tenant_id ON public\.grundstueck_recht/)
    const uebernahme = M.indexOf('INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis')
    const kopie = M.indexOf('FROM public.grundstuecke g;')
    const protokoll = M.indexOf('CREATE TRIGGER z_protokoll_anlegen AFTER INSERT ON public.grundstueck_recht')
    assert.ok(kopie > 0 && protokoll > kopie && uebernahme > 0)
  })
  test('Abgleich nur bei Änderung der alten Spalten; Funktion für Benutzer nicht aufrufbar; Selbstprüfung der Übernahme', () => {
    assert.match(M, /CREATE TRIGGER a_recht_abgleich AFTER INSERT OR UPDATE OF rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung\n\s+ON public\.grundstuecke/)
    assert.match(M, /REVOKE EXECUTE ON FUNCTION public\.s112_grundstueck_recht_abgleich\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(M, /SECURITY DEFINER\nSET search_path = public/)
    assert.match(M, /RAISE EXCEPTION 'KAN-458: % Grundstücke weichen in grundstueck_recht ab'/)
  })
  test('die alten Spalten bleiben in Schritt 1 stehen; die neue Tabelle kommt nicht in die KI-Liste', () => {
    assert.doesNotMatch(M, /DROP COLUMN/)
    assert.doesNotMatch(M, /CREATE OR REPLACE FUNCTION public\.ki_erlaubte_tabellen/)
  })
})

describe('KAN-458: Migration kan458b (Schritt 2)', () => {
  test('vor dem Entfernen: Abbruch, wenn alte Spalten und neue Tabelle auseinanderliegen', () => {
    const sicherung = M2.indexOf("RAISE EXCEPTION 'KAN-458: % Grundstücke weichen in grundstueck_recht von den alten Spalten ab'")
    assert.ok(sicherung > 0 && sicherung < M2.indexOf('DROP COLUMN'))
    for (const s of RECHT_SPALTEN) assert.ok(M2.includes(`OR r.${s} IS DISTINCT FROM g.${s}`), s)
    assert.match(M2, /WHERE r\.id IS NULL\n\s+OR r\.tenant_id IS DISTINCT FROM g\.tenant_id/)
  })
  test('Abgleich, Index und genau die fünf Spalten fallen', () => {
    assert.match(M2, /DROP TRIGGER a_recht_abgleich ON public\.grundstuecke;\nDROP FUNCTION public\.s112_grundstueck_recht_abgleich\(\);\nDROP INDEX public\.idx_grundstuecke_rechtsv;/)
    assert.deepEqual([...M2.matchAll(/^ {2}DROP COLUMN (\w+)[,;]$/gm)].map(m => m[1]), [...RECHT_SPALTEN])
    assert.doesNotMatch(M2, /CASCADE/)
  })
  test('Demo-Funktionen: Spalte aus dem INSERT, Zeile in grundstueck_recht; jeder Anker genau einmal, vor dem Entfernen', () => {
    for (const f of ['public.demo_musterhof_gebiete()', 'public.demo_musterhof_zuruecksetzen()']) assert.ok(M2.includes(`('${f}',`), f)
    assert.match(M2, /insert into grundstueck_recht \(tenant_id, grundstueck_id, rechtsverhaeltnis\)/)
    assert.match(M2, /on conflict \(grundstueck_id\) do nothing;/)
    assert.match(M2, /IF v_n <> 1 THEN RAISE EXCEPTION 'KAN-458: % – Anker % kommt %-mal vor \(erwartet 1\)'/)
    assert.ok(M2.indexOf('EXECUTE v_def;') < M2.indexOf('DROP TRIGGER a_recht_abgleich'))
  })
  test('Schema-Liste: grundstuecke ohne die fünf Spalten, der Spaltenfall der Leserechte ist erledigt', () => {
    for (const s of RECHT_SPALTEN) assert.ok(!SCHEMA.grundstuecke.includes(s), `${s} nicht mehr in grundstuecke`)
    assert.deepEqual(LISTE.spaltenfaelle.filter(f => f.tabelle === 'grundstuecke'), [])
    assert.doesNotMatch(quelle('scripts/db-tests/_helfer.sql'), /s112_grundstueck_recht_abgleich\(\)/)
  })
})
