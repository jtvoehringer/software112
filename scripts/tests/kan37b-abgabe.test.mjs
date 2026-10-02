// KAN-37 Etappe B (02.10.2026): Beim Einreichen der AMA-Erntemeldung wird die Datei als Snapshot gespeichert
// (meldung_abgaben, RPC s112_ama_einreichen) und ist danach byte-gleich abrufbar (/meldungen/<id>/csv?abgabe=<id>).
// Die Datenbankseite prüfen die DB-Tests (20_sperren_protokoll_trigger: kan37b_*); hier die Verdrahtung im Code.
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan37b-abgabe.test.mjs
//          (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('KAN-37 B: Abgabe mit Snapshot', () => {
  test('„Eingereicht“ läuft über s112_ama_einreichen mit dem Snapshot, die Rückmeldung weiter über s112_ama_status_setzen', () => {
    const a = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
    const fn = a.slice(a.indexOf('export async function amaStatusSetzen'), a.indexOf('export async function amaKorrekturAnlegen'))
    assert.match(fn, /if \(status === 'eingereicht'\) \{\s*const abgabe = await abgabeErzeugen\(\{ supabase, tenantId, membership \}, 'erntemeldung', \{ jahrgang: String\(jg\.jahrgang\) \}\)/)
    assert.match(fn, /'s112_ama_einreichen', \{[^}]*p_abgabe: abgabe/)
    assert.match(fn, /'s112_ama_status_setzen'/)
  })
  test('Snapshot entsteht wie die zentrale CSV-Route: dieselbe Ladefunktion, Spalten, Profil und Dateiname', () => {
    const s = quelle('src/lib/behoerden/abgabe.ts')
    const r = quelle('src/app/(dashboard)/meldungen/[meldung]/csv/route.ts')
    for (const muster of [/meldungFinden\(id\)/, /csvDatei\(ergebnis\.zeilen, meldung\.spalten, /, /meldungsDateiname\(meldung, p, betrieb\)/, /meldung\.profil \?\? PROFIL_EXCEL_AT/]) {
      assert.match(s, muster)
      assert.match(r, muster)
    }
    assert.match(s, /csv: datei\.text/)
  })
  test('Download der abgegebenen Datei: nur eigener Betrieb und passende Meldung, Text unverändert', () => {
    const r = quelle('src/app/(dashboard)/meldungen/[meldung]/csv/route.ts')
    const teil = r.slice(r.indexOf("searchParams.get('abgabe')"), r.indexOf('const p = meldung.parameter'))
    assert.match(teil, /\.eq\('tenant_id', tenantId\)\.eq\('meldung', id\)\.eq\('id', abgabeId\)/)
    assert.match(teil, /csvAntwort\(abgabe\.csv_text, /)
    // erst nach Sitzungssperre und Modul-/Rollenprüfung
    assert.ok(r.indexOf("searchParams.get('abgabe')") > r.indexOf('zugriffsFehler(meldung, membership, module)'))
  })
  test('Lese-Seite zeigt die gespeicherte Datei je Version (mit SHA-256)', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/AmaMeldungKarte.tsx')
    assert.match(k, /csvPfad\('erntemeldung', \{ abgabe: version\.abgabe\.id \}\)/)
    assert.match(k, /SHA-256/)
    const l = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    assert.match(l, /from\('meldung_abgaben'\)[\s\S]*?\.eq\('tenant_id', tenantId\)/)
  })
})

describe('KAN-37 C: Meldungsrahmen und Lese-Sperre', () => {
  test('Lese-Seite zeigt Stichtag/Abgabefrist und den Sperrhinweis nach dem Einreichen', () => {
    const k = quelle('src/app/(dashboard)/erntemeldung/[id]/AmaMeldungKarte.tsx')
    assert.match(k, /Stichtag \{datumDe\(amaMeldung\.stichtag\)\} · Abgabe bis \{datumDe\(amaMeldung\.abgabefrist\)\}/)
    const c = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    assert.match(c, /const meldesperre = amaMeldung && !AMA_OFFEN\.includes\(amaMeldung\.status\)/)
    const l = quelle('src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts')
    assert.match(l, /ama_referenznr, stichtag, abgabefrist'\)/)
  })
})
