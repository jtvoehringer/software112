// KAN-219 (07.10.2026) – E-Label D: Umleitung eines gedruckten QR-Codes auf ein anderes freigegebenes E-Label des Betriebs
// (z. B. die Nachfolgefüllung), mit Grund und Protokoll; die öffentliche Seite folgt der Umleitung (höchstens 5 Schritte).
// Weinpass global eindeutig (KAN-92) und QR ohne Fremddienst (KAN-217) bestanden schon – hier mit abgesichert.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 65 (nur per RPC, Grund, keine Schleife, nur freigegeben, eigener Betrieb, Protokoll nur lesbar).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { folgeUmleitung, umleitungGrundFehler } from '../../src/lib/elabel/oeffentlich.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan219_elabel_umleitung.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan219_elabel_umleitung.sql')
}

describe('KAN-219: Umleitung folgen', () => {
  const karte = {
    a: { id: 'a', umleitung_auf: 'b' }, b: { id: 'b', umleitung_auf: 'c' }, c: { id: 'c', umleitung_auf: null },
    x: { id: 'x', umleitung_auf: 'y' }, y: { id: 'y', umleitung_auf: 'x' },
    n: { id: 'n', umleitung_auf: 'fehlt' },
  }
  const lade = async (id) => karte[id] ?? null

  test('ohne Umleitung bleibt es beim Start', async () => {
    assert.equal((await folgeUmleitung(karte.c, lade)).id, 'c')
  })
  test('Kette bis zum letzten Ziel', async () => {
    assert.equal((await folgeUmleitung(karte.a, lade)).id, 'c')
  })
  test('höchstens max Schritte', async () => {
    assert.equal((await folgeUmleitung(karte.a, lade, 1)).id, 'b')
  })
  test('Schleife bricht ab, fehlendes bzw. nicht freigegebenes Ziel endet beim letzten gültigen', async () => {
    assert.equal((await folgeUmleitung(karte.x, lade)).id, 'y')
    assert.equal((await folgeUmleitung(karte.n, lade)).id, 'n')
  })
  test('Grund: mindestens 10 Zeichen', () => {
    assert.match(umleitungGrundFehler('kurz'), /10 Zeichen/)
    assert.equal(umleitungGrundFehler('Nachfolgefüllung 2027'), null)
  })
})

describe('KAN-219: Datenbank und Verdrahtung', () => {
  test('Migration: Spalte, Schutz-Trigger, Protokoll nur lesbar, RPC mit Zugriff/Abo/Modul und Schleifenprüfung', () => {
    const m = migration()
    assert.match(m, /ADD COLUMN umleitung_auf uuid REFERENCES public\.elabels\(id\) ON DELETE SET NULL/)
    assert.match(m, /z_fremdverweis_umleitung_auf/)
    assert.match(m, /CREATE TRIGGER b_elabel_umleitung BEFORE INSERT OR UPDATE ON public\.elabels/)
    assert.match(m, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.elabel_umleitungen FROM PUBLIC, authenticated/)
    assert.match(m, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\)/)
    assert.match(m, /PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\)/)
    assert.match(m, /IF v_schritt = p_elabel_id OR v_n > 5 THEN/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_elabel_umleiten\(uuid, uuid, uuid, text\) FROM PUBLIC, anon/)
  })
  test('Öffentliche Seite folgt der Umleitung nur im Betrieb des gedruckten E-Labels und nur zu freigegebenen', () => {
    const s = quelle('src/app/e/[code]/page.tsx')
    assert.match(s, /folgeUmleitung\(/)
    assert.match(s, /\.eq\('id', zielId\)\.eq\('tenant_id', \(start as R\)\.tenant_id\)\.eq\('status', 'freigegeben'\)/)
  })
  test('Verwaltung: Umleiten über die RPC, Bereich nur bei freigegebenem E-Label', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/elabel/actions.ts')
    assert.match(a, /rpc as any\)\('s112_elabel_umleiten'/)
    assert.doesNotMatch(a, /update\(\{\s*umleitung_auf/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/elabel/page.tsx'), /stand\?\.status === 'freigegeben' && \(\s*<ElabelUmleitung/)
  })
  test('Bestand: Weinpass über weinpass_code, QR-Codes ohne Fremddienst', () => {
    assert.match(quelle('src/app/w/[charge]/page.tsx'), /\.eq\('weinpass_code', schluessel\)/)
    for (const f of ['src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx', 'src/app/(dashboard)/weinhandel/fuellungen/[id]/elabel/page.tsx']) {
      assert.doesNotMatch(quelle(f), /qrserver|chart\.googleapis/, f)
    }
  })
})
