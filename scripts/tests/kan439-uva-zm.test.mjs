// KAN-439 (13.11.2026): Weinexport E2, Teil 1 – Steuerfall in der UVA (Kz 011/017) und Zusammenfassende Meldung.
// Befund: Die UVA kannte nur eine Sammelzeile „0 %“ ohne Kennzahl; eine Zusammenfassende Meldung gab es nicht.
// Seit KAN-436 trägt ein Verkauf aus dem Exportauftrag seinen Steuerfall – daraus kommen jetzt Kz 011 (Ausfuhr),
// Kz 017 (innergemeinschaftliche Lieferung) und die ZM je UID. 0-%-Umsätze ohne Steuerfall bleiben ohne Kennzahl.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// zm.ts und uva.ts hängen an '@/'-Importen (Supabase-Lader) – die reinen Funktionen werden deshalb am Quelltext und
// über eine kleine Nachbildung der Rechenregel geprüft; die Datenbankseite prüft DB-Test 71 gegen Staging.

describe('KAN-439: UVA – Kennzahlen 011 und 017', () => {
  const u = quelle('src/lib/behoerden/uva.ts')
  test('zwei eigene Zeilen mit Kennzahl; die Rest-Zeile zu 0 % bleibt ohne Kennzahl und zeigt nur den Rest', () => {
    assert.match(u, /z\('kz011', '011', 'Ausfuhrlieferungen \(steuerfrei\)', b\('bmgl_ausfuhr'\), null\),/)
    assert.match(u, /z\('kz017', '017', 'Innergemeinschaftliche Lieferungen \(steuerfrei\)', b\('bmgl_igl'\), null\),/)
    assert.match(u, /z\('ust0', null, UVA_0_PROZENT_BEZEICHNUNG, uvaRestNull\(uva\), null\),/)
    assert.match(u, /return summe\(\[betrag\(uva\.bmgl_ust_0\) \?\? 0, -\(betrag\(uva\.bmgl_ausfuhr\) \?\? 0\), -\(betrag\(uva\.bmgl_igl\) \?\? 0\)\]\)/)
    assert.ok(u.indexOf("z('kz011'") > u.indexOf("z('kz006'") && u.indexOf("z('kz017'") < u.indexOf("z('ust0'"), 'Reihenfolge: steuerpflichtig, 011, 017, Rest')
    // Kz 000 bleibt die Summe aller Bemessungsgrundlagen (011 und 017 sind Teil von bmgl_ust_0, nicht zusätzlich)
    assert.match(u, /const kz000 = summe\(\[b\('bmgl_ust_0'\), b\('bmgl_ust_10'\), b\('bmgl_ust_13'\), b\('bmgl_ust_20'\)\]\)/)
  })
  test('Warnung nur noch für den Rest ohne Steuerfall', () => {
    assert.match(u, /find\(k => k\.schluessel === 'ust0'\)\?\.bemessungsgrundlage \?\? 0\) !== 0/)
    assert.match(u, /Steuerfreie Umsätze \(0 %\) ohne gespeicherten Steuerfall in /)
  })
  test('Laden, Speichern und Druckseite kennen die neuen Spalten', () => {
    assert.match(u, /\.select\('id, jahr, zeitraum, bmgl_ust_0, bmgl_ausfuhr, bmgl_igl, /)
    const a = quelle('src/app/(dashboard)/buchhaltung/actions.ts')
    assert.match(a, /bmgl_ausfuhr: row\.bmgl_ausfuhr \|\| 0,\s+bmgl_igl:     row\.bmgl_igl     \|\| 0,/)
    const p = quelle('src/app/(dashboard)/buchhaltung/uva/page.tsx')
    assert.match(p, /\(\['kz011', 'kz017'\] as const\)\.map/)
    assert.match(p, /\/weinexport\/zusammenfassende-meldung\?jahr=\$\{jahr\}&zeitraum=\$\{uva\.zeitraum\}/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['bmgl_ausfuhr', 'bmgl_igl']) assert.ok(schema.ea_uva.includes(s), s)
  })
  test('Migration: Teilmengen nach Steuerfall für E&A (Zahlung) und Doppik (Rechnung, Stornobeleg)', () => {
    const m = migration('kan439a_uva_steuerfall')
    assert.match(m, /ADD COLUMN bmgl_ausfuhr numeric\(12,2\) NOT NULL DEFAULT 0,\s+ADD COLUMN bmgl_igl     numeric\(12,2\) NOT NULL DEFAULT 0;/)
    assert.match(m, /LEFT JOIN verkaufsposten vk ON vk\.id = t\.verkaufsposten_id AND vk\.tenant_id = t\.tenant_id/)
    assert.match(m, /GROUP BY r\.id, coalesce\(p\.ust_satz, 13\), v\.steuerfall/)
    assert.equal(m.split('(SELECT max(v.steuerfall) FROM verkaufsposten v WHERE v.rechnung_id = o.id AND v.tenant_id = o.tenant_id)').length - 1, 2, 'Original und Stornobeleg')
    assert.match(m, /SUM\(CASE WHEN a\.typ='einnahme' AND a\.satz=0 AND a\.sf='ausfuhr' THEN a\.netto ELSE 0 END\),\s+SUM\(CASE WHEN a\.typ='einnahme' AND a\.satz=0 AND a\.sf='igl' THEN a\.netto ELSE 0 END\)/)
    // die Summe zu 0 % bleibt unverändert (alle 0-%-Umsätze)
    assert.match(m, /SUM\(CASE WHEN a\.typ='einnahme' AND a\.satz=0  THEN a\.netto ELSE 0 END\),/)
    // neu angelegt (Rückgabetyp) – Rechte wie zuvor: nicht für PUBLIC und anon
    assert.match(m, /DROP FUNCTION public\.berechne_ea_uva\(uuid, smallint, text\);/)
    assert.match(m, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id\);/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.berechne_ea_uva\(uuid, smallint, text\) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public\.berechne_ea_uva\(uuid, smallint, text\) TO authenticated, service_role;/)
    assert.match(m, /SET search_path TO 'public'/)
  })
})

describe('KAN-439 Teil 2: BMD-Übergabe mit dem gespeicherten Steuerfall', () => {
  test('Steuerfall des Verkaufs geht vor dem Kundenland; mit Steuer bleibt es Inland; ohne Steuerfall wie bisher', async () => {
    const { steuerfallMitVerkauf, steuerfall, erloesSchluessel } = await import('../../src/lib/buchhaltung/bmd.ts')
    // Käufer im Inland, Ware geht in die USA bzw. nach Deutschland (bisher: 'steuerfrei')
    assert.equal(steuerfallMitVerkauf(0, 'AT', 'ausfuhr'), 'export')
    assert.equal(steuerfallMitVerkauf(0, 'AT', 'igl'), 'ig')
    // Käufer in Deutschland, Ausfuhr in die Schweiz (bisher: 'ig')
    assert.equal(steuerfallMitVerkauf(0, 'DE', 'ausfuhr'), 'export')
    assert.equal(steuerfallMitVerkauf(20, 'US', 'ausfuhr'), 'inland')
    for (const [satz, land] of [[0, 'AT'], [0, 'DE'], [0, 'US'], [0, null], [13, 'DE']]) {
      assert.equal(steuerfallMitVerkauf(satz, land, null), steuerfall(satz, land))
    }
    assert.equal(erloesSchluessel('flasche', false, 0, steuerfallMitVerkauf(0, 'AT', 'ausfuhr')), 'erloes_export')
    assert.equal(erloesSchluessel('flasche', false, 0, steuerfallMitVerkauf(0, 'AT', 'igl')), 'erloes_ig')
  })
  test('Positionen samt Steuerfall: laufende Rechnung über ihre Lieferscheine, Storno-Paar über die Momentaufnahme', async () => {
    const { positionenMitSteuerfall, momentaufnahmeLieferscheinIds } = await import('../../src/lib/buchhaltung/bmd.ts')
    const laufend = { lieferscheine: [{ id: 'l1', steuerfall: 'igl', verkauf_positionen: [{ name: 'a' }, { name: 'b' }] }, { id: 'l2', steuerfall: null, verkauf_positionen: [{ name: 'c' }] }], verkauf_positionen: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
    const storno = { lieferscheine: [], verkauf_positionen: [{ name: 'x', lieferschein_id: 'l8' }, { name: 'y', lieferschein_id: 'l9' }, { name: 'z' }] }
    assert.deepEqual(momentaufnahmeLieferscheinIds([laufend, storno, storno]), ['l8', 'l9'])
    const vk = new Map([['l8', 'ausfuhr'], ['l9', null]])
    assert.deepEqual(positionenMitSteuerfall(laufend, vk).map(x => [x.pos.name, x.verkaufSteuerfall]), [['a', 'igl'], ['b', 'igl'], ['c', null]])
    assert.deepEqual(positionenMitSteuerfall(storno, vk).map(x => [x.pos.name, x.verkaufSteuerfall]), [['x', 'ausfuhr'], ['y', null], ['z', null]])
  })
  test('Route: Steuerfall am Lieferschein geladen, Storno-Paare in Blöcken nachgeladen, Fehler ausgewertet', () => {
    const r = quelle('src/app/api/export/bmd/route.ts')
    assert.match(r, /'id, lieferscheinnummer, datum, steuerfall'\)\}`\)/)
    assert.match(r, /await inBloecken<R>\(momentaufnahmeLieferscheinIds\(posten\), b => alle<R>\(\(supabase\.from\('verkaufsposten'\) as any\)/)
    assert.match(r, /\.select\('id, steuerfall'\)\.eq\('tenant_id', tenantId\)\.in\('id', b\)\.order\('id'\)\)\)/)
    assert.match(r, /if \(vk\.error\) throw new AktionsFehler/)
    assert.match(r, /for \(const \{ pos, verkaufSteuerfall \} of positionenMitSteuerfall\(p, verkaufFall\)\) \{/)
    assert.match(r, /const fall = steuerfallMitVerkauf\(satz, land, verkaufSteuerfall\)/)
  })
})

describe('KAN-439 Teil 2: Journal und UVA-Nachtrag (Migrationen)', () => {
  test('Journal: Bestimmungsland des Verkaufs vor dem Land des Käufers – in der einen Funktion aller Verkaufswege', () => {
    const m = migration('kan439b_journal_lieferland')
    assert.match(m, /CREATE OR REPLACE FUNCTION public\.s112_journal_verkauf_stand\(p jsonb, vp jsonb\)/)
    assert.match(m, /IF NULLIF\(btrim\(coalesce\(vp ->> 'lieferland', ''\)\), ''\) IS NOT NULL THEN\s+v_partner := v_partner \|\| jsonb_build_object\('land', upper\(btrim\(vp ->> 'lieferland'\)\)\);/)
    assert.match(m, /SET search_path TO 'public'/)
    assert.doesNotMatch(m, /SECURITY DEFINER/)
  })
  test('UVA: Steuerfall des Storno-Paars über die lieferschein_id der Momentaufnahme; Ankerstelle genau zweimal', () => {
    const m = migration('kan439c_uva_steuerfall_momentaufnahme')
    assert.match(m, /c_neu constant text := '\(SELECT v\.steuerfall FROM verkaufsposten v WHERE v\.id = \(x\.pos ->> ''lieferschein_id''\)::uuid AND v\.tenant_id = o\.tenant_id\)';/)
    assert.match(m, /\/ length\(c_alt\) <> 2 THEN\s+RAISE EXCEPTION/)
    assert.match(m, /EXECUTE replace\(v_def, c_alt, c_neu\);/)
  })
  test('Handbuch nennt BMD, Journal und das Storno nur der Rechnung', () => {
    const h = quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(h, /Die BMD-Übergabe bucht diese Rechnungen mit dem gespeicherten Steuerfall/)
    assert.match(h, /zählt ein Verkauf aus dem Exportauftrag nach dem Bestimmungsland als Verkauf im Inland oder ins Ausland/)
    assert.match(h, /auch wenn nur die Rechnung storniert wurde und der Lieferschein offen bleibt/)
  })
})

describe('KAN-439: Zusammenfassende Meldung', () => {
  const z = quelle('src/lib/behoerden/zm.ts')
  test('nur Rechnungen, deren Lieferscheine alle „igl“ sind; UID vom Verkauf', () => {
    assert.match(z, /const igl = faelle\.filter\(f => f\?\.steuerfall === 'igl'\)/)
    assert.match(z, /igl: faelle\.length > 0 && igl\.length === faelle\.length, gemischt: igl\.length > 0 && igl\.length < faelle\.length, uid: igl\[0\]\?\.kunde_uid \?\? null/)
    assert.match(z, /bitte von Hand aufteilen/)
  })
  test('Storno wie in der UVA: Original zählt weiter, Stornobeleg negativ, Altfälle nicht', () => {
    assert.match(z, /if \(r\.storniert === true\) \{[\s\S]{0,200}if \(!r\.storniert_durch_id\) continue[\s\S]{0,260}if \(f\.igl\) aus\.push\(\{ uid: f\.uid, betrag: wert\(pos\), nummer \}\)/)
    assert.match(z, /const pos = \(o\.storno_positionen \?\? \[\]\) as R\[\][\s\S]{0,200}if \(f\.igl\) aus\.push\(\{ uid: f\.uid, betrag: -wert\(pos\), nummer \}\)/)
    assert.match(z, /if \(r\.aktiv === false\) continue/)
  })
  // Nachtrag (13.11.2026): Wird nur die Rechnung storniert, ist der Lieferschein wieder „nicht berechnet“ und hängt
  // nicht mehr an ihr – Steuerfall und UID des Storno-Paars kamen dann nicht mehr an, das Paar fehlte in der Meldung.
  test('Steuerfall des Storno-Paars aus der Momentaufnahme (lieferschein_id), nicht über die Lieferscheine an der Rechnung', () => {
    assert.match(z, /function steuerfallDerMomentaufnahme\(positionen: readonly R\[\], verkaeufe: ReadonlyMap<string, ZmVerkauf>\): Einordnung \{\s+const ids = \[\.\.\.new Set\(positionen\.map\(p => String\(p\?\.lieferschein_id \?\? ''\)\)\.filter\(Boolean\)\)\]\s+return einordnen\(ids\.map\(id => verkaeufe\.get\(id\)\)\)/)
    assert.equal(z.split('steuerfallDerMomentaufnahme(pos, verkaeufe)').length - 1, 2, 'Original und Stornobeleg')
    assert.equal(z.split('steuerfallDer(r)').length - 1, 1, 'nur die laufende Rechnung liest ihre Lieferscheine')
    // geladen in Blöcken, im eigenen Betrieb, auch stornierte Verkäufe
    assert.match(z, /await inBloecken<R>\(zmLieferscheinIds\(rechnungen, originale\), b => alle<R>\(\(supabase\.from\('verkaufsposten'\) as any\)\s+\.select\('id, steuerfall, kunde_uid'\)\s+\.eq\('tenant_id', tenantId\)\.in\('id', b\)\.order\('id'\)\)\)/)
    assert.match(z, /if \(vk\.error\) throw new AktionsFehler/)
  })
  test('Laden: Betrieb, Zeitraum nach Rechnungsdatum, vollständig und in fester Reihenfolge; Originale in Blöcken', () => {
    assert.match(z, /\.eq\('tenant_id', tenantId\)\s+\.gte\('datum', von\)\s+\.lte\('datum', bis\)\s+\.order\('datum'\)\.order\('id'\)\)/)
    assert.match(z, /await inBloecken<R>\(stornoVon, b => alle<R>\(/)
    assert.match(z, /\.eq\('tenant_id', tenantId\)\.in\('id', b\)\.order\('id'\)/)
    assert.match(z, /if \(error\) throw new AktionsFehler/)
    assert.match(z, /if \(orig\.error\) throw new AktionsFehler/)
  })
  test('Zeitraum: Monat, Quartal und Jahr als reine Datumsrechnung (kein toISOString)', () => {
    assert.doesNotMatch(z, /toISOString/)
    assert.match(z, /new Date\(Date\.UTC\(jahr, monat, 0\)\)\.getUTCDate\(\)/)
    // Nachbildung der Regel: letzter Tag je Zeitraum
    const letzter = (j, m) => new Date(Date.UTC(j, m, 0)).getUTCDate()
    assert.deepEqual([letzter(2026, 2), letzter(2028, 2), letzter(2026, 12), letzter(2026, 6)], [28, 29, 31, 30])
  })
  test('UID-Prüfung: fehlend, formal ungültig, österreichisch', () => {
    assert.match(z, /if \(!uid\) return 'UID fehlt'/)
    assert.match(z, /\/\^\[A-Z\]\{2\}\[A-Z0-9\+\*\.\]\{2,12\}\$\/\.test\(uid\)/)
    assert.match(z, /if \(uid\.startsWith\('AT'\)\) return 'österreichische UID – keine innergemeinschaftliche Lieferung'/)
  })
  test('CSV-Spalten', () => {
    const koepfe = [...z.slice(z.indexOf('export const SPALTEN_ZM'), z.indexOf('export type ZmParameter')).matchAll(/kopf: '([^']+)'/g)].map(x => x[1])
    assert.deepEqual(koepfe, ['Jahr', 'Zeitraum', 'Länderkennzeichen', 'UID des Erwerbers', 'Bemessungsgrundlage (€)', 'Anzahl Belege', 'Belege'])
  })
  test('Katalog, Register und Seite: Gruppe Weinverkehr & Export, Modul Exportaufträge, Marker', () => {
    const k = quelle('src/lib/behoerden/katalog/verkehr.ts')
    const eintrag = k.slice(k.indexOf("'zusammenfassende-meldung': {"), k.indexOf('  exportauftraege: {'))
    assert.match(eintrag, /zugriff: 'mitglied',\s+modul: 'modul_export',/)
    assert.match(eintrag, /druckPfad: '\/weinexport\/zusammenfassende-meldung',\s+pflicht: true,/)
    const r = quelle('src/lib/behoerden/register/verkehr.ts')
    assert.match(r, /'zusammenfassende-meldung': definiereMeldung\(KATALOG_VERKEHR\['zusammenfassende-meldung'\], \{/)
    assert.match(r, /laden: \(ctx, p\) => ladeZm\(ctx\.supabase, ctx\.tenantId, p\),\s+spalten: SPALTEN_ZM,/)
    const s = quelle('src/app/(dashboard)/weinexport/zusammenfassende-meldung/page.tsx')
    assert.equal(s.split('\n')[0], '// behoerdenmeldung: zusammenfassende-meldung')
    assert.match(s, /if \(!einst\?\.modul_export\) redirect\('\/dashboard'\)/)
    assert.match(s, /<CsvExportKnopf href=\{csvPfad\('zusammenfassende-meldung', \{ jahr, zeitraum \}\)\} \/>/)
    assert.match(s, /ladeZm\(supabase, tenantId, \{ jahr, zeitraum \}\)/, 'Druck und CSV nutzen dieselbe Ladefunktion')
  })
})
