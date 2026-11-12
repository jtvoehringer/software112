// KAN-426 (12.11.2026): Import von Kontakten und Firmen im CRM – Bezeichnung Pflicht, Filter „Import“.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CRM_IMPORT_TYPEN, IMPORT_BEZEICHNUNG_MAX, importBezeichnungAus, importBezeichnungFehler, importFilterAus, importVorschlaege,
  istCrmImportTyp, zaehleImporte,
} from '../../src/lib/crm/importBezeichnung.ts'
import { filterAusParams, paramsAusFilter } from '../../src/lib/crm/liste.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-426: Bezeichnung des Imports', () => {
  test('Pflicht, 2 bis 120 Zeichen, Leerraum bereinigt', () => {
    assert.match(importBezeichnungFehler(''), /Bezeichnung für den Import/)
    assert.match(importBezeichnungFehler('   '), /Bezeichnung für den Import/)
    assert.match(importBezeichnungFehler('x'), /Bezeichnung für den Import/)
    assert.match(importBezeichnungFehler(undefined), /Bezeichnung für den Import/)
    assert.equal(importBezeichnungFehler('Messe Seoul 2026'), null)
    assert.equal(importBezeichnungFehler('x'.repeat(IMPORT_BEZEICHNUNG_MAX)), null)
    assert.match(importBezeichnungFehler('x'.repeat(IMPORT_BEZEICHNUNG_MAX + 1)), /höchstens 120/)
    assert.equal(importBezeichnungAus('  Messe   Seoul\t2026 '), 'Messe Seoul 2026')
    assert.equal(importFilterAus(null), '')
    assert.equal(importFilterAus(' Messe  Seoul 2026 '), 'Messe Seoul 2026')
  })
  test('nur Kontakte und Firmen sind CRM-Importe', () => {
    assert.deepEqual([...CRM_IMPORT_TYPEN], ['kontakte', 'firmen'])
    assert.equal(istCrmImportTyp('kontakte'), true)
    assert.equal(istCrmImportTyp('firmen'), true)
    for (const t of ['gebinde', 'fuellungen', 'eroeffnung_tank', '', null, 7]) assert.equal(istCrmImportTyp(t), false, String(t))
  })
  test('vorhandene Importe zählen und zusammenführen', () => {
    const k = zaehleImporte([{ import_quelle: 'Messe Seoul 2026' }, { import_quelle: ' Messe Seoul 2026 ' }, { import_quelle: null }, { import_quelle: 'Altsystem' }, {}])
    assert.deepEqual(k, [{ bezeichnung: 'Altsystem', anzahl: 1 }, { bezeichnung: 'Messe Seoul 2026', anzahl: 2 }])
    assert.deepEqual(importVorschlaege(k, [{ bezeichnung: 'Vinexpo', anzahl: 3 }, { bezeichnung: 'Altsystem', anzahl: 9 }]), ['Altsystem', 'Messe Seoul 2026', 'Vinexpo'])
  })
})

describe('KAN-426: Filter „Import“ in den Listen', () => {
  test('Adresse ↔ Filter für Kontakte und Firmen', () => {
    for (const art of ['kontakt', 'firma']) {
      const f = filterAusParams({ import: ' Messe  Seoul 2026 ' }, art)
      assert.equal(f.imp, 'Messe Seoul 2026', art)
      assert.equal(paramsAusFilter(f), '?import=Messe+Seoul+2026', art)
      assert.equal(filterAusParams({}, art).imp, '', art)
    }
  })
  test('Abfragen filtern auf import_quelle; Listen, Zähler und Export sind verdrahtet', () => {
    const liste = quelle('src/lib/crm/liste.ts')
    assert.equal((liste.match(/if \(f\.imp\) q = q\.eq\('import_quelle', f\.imp\)/g) ?? []).length, 2)
    const kSeite = quelle('src/app/(dashboard)/crm/kontakte/page.tsx')
    assert.match(kSeite, /\.select\('id, quelle, import_quelle'\)\.eq\('tenant_id', tenantId\)/)
    assert.match(kSeite, /const importe = zaehleImporte\(/)
    const fSeite = quelle('src/app/(dashboard)/crm/firmen/page.tsx')
    assert.match(fSeite, /\.select\('id, import_quelle'\)\.eq\('tenant_id', tenantId\)\.not\('import_quelle', 'is', null\)/)
    assert.match(fSeite, /return alle\(q\.order\('id'\)\)/)
    for (const [p, art] of [['src/app/(dashboard)/crm/kontakte/KontakteClient.tsx', 'kontakte'], ['src/app/(dashboard)/crm/firmen/FirmenClient.tsx', 'firmen']]) {
      const s = quelle(p)
      assert.match(s, /<ImportFilter importe=\{importe\} wert=\{filter\.imp\} onChange=\{imp => setzeFilter\(\{ imp \}\)\} \/>/, p)
      assert.match(s, new RegExp(`href=\\{\`/api/export/${art}\\$\\{filter\\.imp \\? \`\\?import=\\$\\{encodeURIComponent\\(filter\\.imp\\)\\}\` : ''\\}\`\\}`), p)
      assert.match(s, new RegExp(`\\{writeOk && \\(\\s*<Link href="/crm/import\\?typ=${art}"`), p)
      const route = quelle(`src/app/api/export/${art}/route.ts`)
      assert.match(route, /const imp = importFilterAus\(req\.nextUrl\.searchParams\.get\('import'\)\)/, art)
      // Filter vor der Sortierung – nach .order() gibt es kein .eq() mehr
      assert.match(route, /\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)\n\s*if \(imp\) q = q\.eq\('import_quelle', imp\)\n\s*const \{ data, error \} = await alle\(q\.order\('(nachname|name)'\)\.order\('id'\)\)/, art)
    }
  })
})

describe('KAN-426: Importseite und Route', () => {
  test('Seite /crm/import: nur mit Schreibrecht CRM, Baustein im CRM-Modus', () => {
    const s = quelle('src/app/(dashboard)/crm/import/page.tsx')
    assert.match(s, /if \(!canWrite\(membership, 'crm'\)\) redirect\('\/crm\/kontakte'\)/)
    assert.match(s, /<ImportClient modus="crm" bezeichnungen=\{bezeichnungen\} initialTyp=\{istCrmImportTyp\(typ\) \? typ : 'kontakte'\} \/>/)
  })
  test('Baustein: im CRM nur zwei Importarten, Bezeichnung leer und Pflicht, vor dem ersten Block geprüft', () => {
    const s = quelle('src/app/(dashboard)/admin/import/ImportClient.tsx')
    assert.match(s, /const CRM_TYPEN = ALLE_TYPEN\.filter\(t => istCrmImportTyp\(t\)\)/)
    assert.match(s, /const typen = imCrm \? CRM_TYPEN : ALLE_TYPEN/)
    assert.match(s, /useState\(imCrm \? '' : HERKUNFT_DEFAULT\)/)
    const start = s.slice(s.indexOf('async function startImport()'))
    assert.ok(start.indexOf('importBezeichnungFehler(herkunft)') > 0 && start.indexOf('importBezeichnungFehler(herkunft)') < start.indexOf("fetch('/api/import'"))
    assert.match(start, /herkunft: herkunftText, zeilenOffset: start, crm: imCrm \}/)
    assert.match(s, /role="alert" className="basis-full text-xs text-s112-err-fg">\{herkunftFehler\}/)
    // Verwaltung unverändert: Vorbelegung bleibt
    assert.match(s, /imCrm \? importBezeichnungAus\(herkunft\) : \(herkunft\.trim\(\) \|\| HERKUNFT_DEFAULT\)/)
  })
  test('Route: CRM-Import nur Kontakte/Firmen mit Bezeichnung; Kontakte und Firmen brauchen Schreibrecht CRM', () => {
    const s = quelle('src/app/api/import/route.ts')
    assert.match(s, /if \(crm === true\) \{\s*if \(!istCrmImportTyp\(typ\)\) return NextResponse\.json\(\{ fehler: [^}]+\}, \{ status: 400 \}\)\s*const bezFehler = importBezeichnungFehler\(herkunft\)\s*if \(bezFehler\) return NextResponse\.json\(\{ fehler: bezFehler \}, \{ status: 400 \}\)/)
    assert.match(s, /if \(istCrmImportTyp\(typ\) && !canWrite\(activeMembership, 'crm'\)\)\s*return NextResponse\.json\(\{ fehler: [^}]+\}, \{ status: 403 \}\)/)
    // Recht vor dem ersten Schreiben
    assert.ok(s.indexOf("!canWrite(activeMembership, 'crm')") < s.indexOf(".from('kontakte') as any).insert("))
    assert.match(s, /const importQuelle = crm === true \? importBezeichnungAus\(herkunft\)/)
  })
  test('Kontakt-Detail zeigt den Import mit Link auf die gefilterte Liste', () => {
    assert.match(quelle('src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx'), /href=\{`\/crm\/kontakte\?import=\$\{encodeURIComponent\(kontakt\.import_quelle\)\}`\}/)
    assert.match(quelle('src/lib/crm/liste.ts'), /notizen, erstellt_am, import_quelle, importiert_am, is_l/)
  })
})
