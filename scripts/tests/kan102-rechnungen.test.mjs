// KAN-102 (08.10.2026) – Rechnung vom Lieferschein trennen, Etappe 1: Tabelle rechnungen, Lieferschein-Nummernkreis,
// Übergang 1:1 (Rechnung im Insert, Spiegel, Wartung), Altbelege, Demo-Musterhof. Lieferscheinnummer auf Detail, Druck, Liste.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 68 (Vergabe, Spiegel, Rechte, Mandantentrennung, Wartung).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan102_rechnungen.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan102_rechnungen.sql')
}

describe('KAN-102: Datenmodell', () => {
  const m = migration()
  test('rechnungen: Nummer eindeutig je Betrieb, nur lesbar für Mitglieder, Löschsperre und Protokoll', () => {
    assert.match(m, /CREATE UNIQUE INDEX rechnungen_nummer_eindeutig ON public\.rechnungen \(tenant_id, rechnungsnummer\);/)
    assert.match(m, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.rechnungen FROM authenticated;/)
    assert.match(m, /CREATE POLICY rechnungen_select ON public\.rechnungen FOR SELECT TO authenticated/)
    assert.match(m, /CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public\.rechnungen/)
    assert.match(m, /CREATE POLICY zwei_faktor_aal ON public\.rechnungen AS RESTRICTIVE/)
    assert.match(m, /CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF rechnungsnummer, datum/)
    for (const s of ['kontakt_id', 'firma_id', 'zh_kontakt_id', 'bmd_export_id']) {
      assert.match(m, new RegExp(`CREATE TRIGGER z_fremdverweis_${s} BEFORE INSERT OR UPDATE OF ${s}, tenant_id ON public\\.rechnungen`), s)
    }
  })
  test('Lieferschein: eigener Nummernkreis, Vergabe nur im Insert, rechnung_id nur vom System', () => {
    assert.match(m, /ADD COLUMN lieferschein_prefix  text    NOT NULL DEFAULT 'LS'/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_lieferscheinnummer_ziehen\(uuid\) FROM PUBLIC, anon, authenticated;/)
    assert.match(m, /CREATE TRIGGER a_lieferscheinnummer BEFORE INSERT OR UPDATE OF lieferscheinnummer ON public\.verkaufsposten/)
    assert.match(m, /CREATE TRIGGER a_rechnung_id_schutz BEFORE UPDATE OF rechnung_id ON public\.verkaufsposten/)
    assert.match(m, /CREATE UNIQUE INDEX verkaufsposten_lieferscheinnummer_eindeutig ON public\.verkaufsposten \(tenant_id, lieferscheinnummer\)/)
  })
  test('Übergang 1:1: Rechnung im Insert nach der Nummernvergabe, Spiegel nur bei genau einem Lieferschein, Wartung räumt auf', () => {
    // b_… läuft alphabetisch nach a_momentaufnahme und a_rechnungsnummer (Nummer und Momentaufnahme stehen schon)
    assert.match(m, /CREATE TRIGGER b_rechnung_anlegen BEFORE INSERT ON public\.verkaufsposten/)
    assert.ok('a_rechnungsnummer' < 'b_rechnung_anlegen' && 'a_momentaufnahme' < 'b_rechnung_anlegen')
    assert.match(m, /OR EXISTS \(SELECT 1 FROM public\.verkaufsposten v WHERE v\.rechnung_id = NEW\.rechnung_id AND v\.id <> NEW\.id\) THEN\n\s+RETURN NULL;/)
    assert.match(m, /CREATE TRIGGER z_rechnung_aufraeumen AFTER DELETE ON public\.verkaufsposten/)
  })
  test('Altbelege: je Lieferschein eine Rechnung, Selbstprüfung bricht sonst ab', () => {
    assert.match(m, /RAISE EXCEPTION 'KAN-102: % Lieferschein\(e\) ohne passende Rechnung', v_n;/)
    assert.match(m, /RAISE EXCEPTION 'KAN-102: % Rechnung\(en\) ohne Lieferschein', v_n;/)
  })
  test('Demo-Musterhof: feste Lieferscheinnummer wie RE, Zähler danach', () => {
    assert.match(m, /v_ls text := 'LS-' \|\| to_char\(p_datum, 'YYYY'\) \|\| '-' \|\| lpad\(p_nr::text, 4, '0'\);/)
    assert.match(m, /set lieferschein_zaehler = 1 \+ coalesce\(\(select max\(substring\(v\.lieferscheinnummer from '\(\\d\+\)\$'\)::int\)/)
  })
})

describe('KAN-102: Oberfläche und Listen', () => {
  test('Lieferscheindruck zeigt die Lieferscheinnummer, die Rechnung als Bezug', () => {
    const d = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(d, /\{posten\.lieferscheinnummer && <p className="text-sm">Nr\. \{posten\.lieferscheinnummer\}<\/p>\}/)
    assert.match(d, /zu Rechnung \{posten\.rechnungsnummer\}/)
  })
  test('Verkaufsliste: Lieferscheinnummer sichtbar und durchsuchbar', () => {
    const l = quelle('src/app/(dashboard)/weinhandel/verkauf/page.tsx')
    assert.match(l, /`lieferscheinnummer\.ilike\.\*\$\{qSicher\}\*`/)
    assert.match(l, /\{p\.lieferscheinnummer && /)
  })
  test('rechnungen ist berichtsrelevant mit Löschsperre', () => {
    const j = JSON.parse(quelle('scripts/storno-tabellen.json'))
    assert.ok(j.berichtsrelevant.includes('rechnungen'))
    assert.ok(j.scharf.includes('rechnungen'))
  })
})
