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

describe('KAN-439: Zusammenfassende Meldung', () => {
  const z = quelle('src/lib/behoerden/zm.ts')
  test('nur Rechnungen, deren Lieferscheine alle „igl“ sind; UID vom Verkauf', () => {
    assert.match(z, /const igl = ls\.filter\(l => l\.steuerfall === 'igl'\)/)
    assert.match(z, /igl: ls\.length > 0 && igl\.length === ls\.length, gemischt: igl\.length > 0 && igl\.length < ls\.length/)
    assert.match(z, /uid: \(igl\[0\]\?\.kunde_uid as string \| null \| undefined\) \?\? null/)
    assert.match(z, /bitte von Hand aufteilen/)
  })
  test('Storno wie in der UVA: Original zählt weiter, Stornobeleg negativ, Altfälle nicht', () => {
    assert.match(z, /if \(r\.storniert === true\) \{[\s\S]{0,220}if \(r\.storniert_durch_id\) aus\.push\(\{ uid: f\.uid, betrag: wert\(\(r\.storno_positionen \?\? \[\]\) as R\[\]\), nummer \}\)/)
    assert.match(z, /if \(f\.igl\) aus\.push\(\{ uid: f\.uid, betrag: -wert\(\(o\.storno_positionen \?\? \[\]\) as R\[\]\), nummer \}\)/)
    assert.match(z, /if \(r\.aktiv === false\) continue/)
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
