// KAN-437 Teil 2 (13.11.2026): Weinexport F – Export-Registrierungen des Betriebs mit Ablaufdatum und Erinnerung.
// Befund: Für Registrierungen, die Zielländer vom Hersteller verlangen (FDA mit US-Agent, GACC, MFDS), gab es keinen
// Platz und keine Erinnerung – eine abgelaufene Registrierung fiel erst an der Grenze auf.
// Die Rechte der Tabelle (Betrieb, Rollen, Modul, Abo, Zwei-Faktor) prüfen die DB-Tests 01, 10, 11, 12, 14, 15, 78.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REGISTRIERUNG_ARTEN, REGISTRIERUNG_VORWARNUNG_TAGE, registrierungEingabeFehler, registrierungStand, registrierungName,
  registrierungHinweise, registrierungFristen, fdaErneuerungsfenster, istRegistrierungArt,
} from '../../src/lib/export/registrierungen.ts'

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
const reg = (art, gueltig_bis, mehr = {}) => ({ id: `r-${art}-${gueltig_bis}`, art, bezeichnung: null, nummer: '12345', gueltig_bis, zusatz: null, notiz: null, ...mehr })

describe('KAN-437: Eingabe', () => {
  test('Art, Nummer, Bezeichnung bei „sonstige“, Datum, Längen – wie die Datenbank', () => {
    assert.equal(registrierungEingabeFehler({ art: 'fda', nummer: '12345678901' }), null)
    assert.equal(registrierungEingabeFehler({ art: 'fda', nummer: '1', gueltig_bis: '2026-12-31', zusatz: 'US Agent Inc.' }), null)
    assert.match(registrierungEingabeFehler({ art: 'fda', nummer: '  ' }), /Nummer der Registrierung/)
    assert.match(registrierungEingabeFehler({ art: 'zoll', nummer: '1' }), /Art der Registrierung/)
    assert.match(registrierungEingabeFehler({ art: 'sonstige', nummer: '1' }), /Bezeichnung angeben/)
    assert.equal(registrierungEingabeFehler({ art: 'sonstige', nummer: '1', bezeichnung: 'SFA Singapur' }), null)
    assert.match(registrierungEingabeFehler({ art: 'fda', nummer: '1', gueltig_bis: '31.12.2026' }), /Ablaufdatum ist ungültig/)
    assert.match(registrierungEingabeFehler({ art: 'fda', nummer: 'x'.repeat(61) }), /höchstens 60/)
    assert.match(registrierungEingabeFehler({ art: 'fda', nummer: '1', notiz: 'x'.repeat(401) }), /höchstens 400/)
    assert.equal(istRegistrierungArt('constructor'), false)
  })
  test('Arten decken sich mit dem CHECK der Tabelle', () => {
    const m = migration('kan437a_export_registrierungen')
    const check = /CHECK \(art IN \(([^)]+)\)\)/.exec(m)[1].split(',').map(s => s.trim().replace(/'/g, '')).sort()
    assert.deepEqual(check, Object.keys(REGISTRIERUNG_ARTEN).sort())
    assert.equal(registrierungName({ art: 'fda' }), 'FDA-Registrierung')
    assert.equal(registrierungName({ art: 'sonstige', bezeichnung: ' SFA Singapur ' }), 'SFA Singapur')
  })
})

describe('KAN-437: Ablauf und Erinnerung', () => {
  test('gültig → läuft ab (90 Tage) → abgelaufen; der letzte gültige Tag zählt noch', () => {
    assert.equal(REGISTRIERUNG_VORWARNUNG_TAGE, 90)
    const st = (bis, heute) => registrierungStand({ gueltig_bis: bis }, heute).stufe
    assert.equal(st(null, '2026-11-13'), 'ohne_ablauf')
    assert.equal(st('2027-02-12', '2026-11-13'), 'gueltig')       // 91 Tage
    assert.equal(st('2027-02-11', '2026-11-13'), 'laeuft_ab')     // 90 Tage
    assert.equal(st('2026-11-13', '2026-11-13'), 'laeuft_ab')     // letzter Tag
    assert.equal(st('2026-11-12', '2026-11-13'), 'abgelaufen')
    assert.equal(registrierungStand({ gueltig_bis: '2026-12-31' }, '2026-11-13').text, 'läuft am 31.12.2026 ab')
  })
  test('FDA-Erneuerungsfenster: Oktober bis Dezember gerader Jahre', () => {
    assert.deepEqual(['2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01', '2027-11-13', '2028-10-15'].map(fdaErneuerungsfenster), [false, true, true, false, false, true])
  })
  test('Hinweise am Auftrag: USA ohne, mit ablaufender bzw. abgelaufener FDA-Registrierung', () => {
    assert.deepEqual(registrierungHinweise('US', [], '2027-03-01'), ['FDA-Registrierung ist nicht hinterlegt.'])
    assert.deepEqual(registrierungHinweise('us', [reg('fda', '2029-12-31')], '2027-03-01'), [])
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2027-04-30')], '2027-03-01'), ['FDA-Registrierung 12345: läuft am 30.04.2027 ab.'])
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2027-02-28')], '2027-03-01'), ['FDA-Registrierung 12345: abgelaufen am 28.02.2027.'])
    // mehrere Einträge: der mit dem spätesten Ablauf zählt; einer ohne Ablaufdatum gilt als gültig
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2025-12-31'), reg('fda', '2029-12-31')], '2027-03-01'), [])
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2025-12-31'), reg('fda', null)], '2027-03-01'), [])
  })
  test('FDA im Erneuerungsfenster: zusätzlicher Hinweis, solange die Registrierung nicht über das Jahr hinaus läuft', () => {
    const h = registrierungHinweise('US', [reg('fda', '2026-12-31')], '2026-11-13')
    assert.deepEqual(h, ['FDA-Registrierung 12345: läuft am 31.12.2026 ab.', 'FDA-Registrierung: Die Erneuerung ist jetzt fällig (Oktober bis Dezember gerader Jahre).'])
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2028-12-31')], '2026-11-13'), [], 'schon erneuert')
    assert.equal(registrierungHinweise('US', [reg('fda', null)], '2026-11-13').length, 1, 'ohne Ablaufdatum: nur die Erinnerung an das Fenster')
  })
  test('China und Südkorea: Hinweis mit dem Vermerk „nicht geprüft“; andere Länder und EU ohne Hinweis', () => {
    assert.deepEqual(registrierungHinweise('CN', [], '2027-03-01'), ['GACC-Registrierung ist nicht hinterlegt (laut Länderhinweis nötig – nicht geprüft).'])
    assert.deepEqual(registrierungHinweise('KR', [reg('mfds', '2029-01-01')], '2027-03-01'), [])
    assert.deepEqual(registrierungHinweise('KR', [reg('fda', '2029-01-01')], '2027-03-01'), ['MFDS-Vorregistrierung ist nicht hinterlegt (laut Länderhinweis nötig – nicht geprüft).'])
    for (const l of ['GB', 'CH', 'JP', 'DE', '', null]) assert.deepEqual(registrierungHinweise(l, [], '2027-03-01'), [], String(l))
  })
  test('Fristen fürs Dashboard: nur abgelaufene und binnen 90 Tagen ablaufende', () => {
    const f = registrierungFristen([reg('fda', '2027-02-28', { zusatz: 'US Agent Inc.' }), reg('gacc', '2027-04-30'), reg('mfds', '2029-01-01'), reg('sonstige', null, { bezeichnung: 'SFA' })], '2027-03-01')
    assert.deepEqual(f.map(x => [x.bezeichnung, x.status, x.faelligAm, x.statusText]), [
      ['FDA-Registrierung erneuern', 'ueberfaellig', '2027-02-28', 'abgelaufen am 28.02.2027'],
      ['GACC-Registrierung erneuern', 'faellig', '2027-04-30', 'läuft am 30.04.2027 ab'],
    ])
    assert.match(f[0].hinweis, /Nr\. 12345 · US Agent Inc\./)
    assert.ok(f.every(x => x.key.startsWith('exportreg:')))
  })
})

describe('KAN-437: Verdrahtung und Migration', () => {
  test('Dashboard: Registrierungen als abgeleitete Frist; Auftrag: Hinweis nur bei Drittland, blockiert nichts', () => {
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.match(d, /registrierungFristen\(await ladeExportRegistrierungen\(ctx\.supabase, ctx\.tenantId\), ctx\.heuteStr\)/)
    assert.match(d, /href: '\/weinexport\/registrierungen', quelle: 'system'/)
    const p = quelle('src/app/(dashboard)/weinexport/[id]/page.tsx')
    assert.match(p, /const regHinweise = gebiet === 'drittland' && !a\.storniert_am\s+\? registrierungHinweise\(a\.destination_land, await ladeExportRegistrierungen\(supabase, tenantId\), heute\)\s+: \[\]/)
    const k = quelle('src/app/(dashboard)/weinexport/[id]/ExportLaenderhinweise.tsx')
    assert.match(k, /\{registrierungen\.length > 0 && \(\s+<div role="status"[^>]*data-registrierung-hinweise>/)
    // Entscheidung 4A: nur Hinweis – die Regeln des Statuswechsels kennen keine Registrierungen
    assert.doesNotMatch(quelle('src/lib/export/workflow.ts'), /registrierung/i)
  })
  test('Server Actions: Prüfungen vor dem Schreiben, geänderte bzw. gelöschte Zeile zurückholen, immer mit dem Betrieb', () => {
    const a = quelle('src/app/(dashboard)/weinexport/registrierungen/actions.ts')
    const reihenfolge = ['getCurrentMembership()', 'pruefeSeitenBetrieb(membership.tenantId)', 'pruefeSchreibzugriff(membership)', "canWrite(membership, 'warenwirtschaft')", "pruefeModul('modul_export')"]
    const stellen = reihenfolge.map(t => a.indexOf(t))
    assert.ok(stellen.every(i => i > 0))
    assert.deepEqual(stellen, [...stellen].sort((x, y) => x - y))
    assert.match(a, /\.update\(\{ \.\.\.werte, aktualisiert_am: [^}]+\}\)\.eq\('id', e\.id\)\.eq\('tenant_id', tenantId\)\.select\('id'\)/)
    assert.match(a, /\.insert\(\{ tenant_id: tenantId, \.\.\.werte \}\)\.select\('id'\)/)
    assert.match(a, /\.delete\(\)\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.select\('id'\)/)
    assert.equal(a.split('const tenantId = await schreibrecht()').length - 1, 2)
    assert.doesNotMatch(a, /tenant_id: e\.|e\.tenant/, 'der Betrieb kommt nie aus der Eingabe')
  })
  test('Laden: im eigenen Betrieb, vollständig, feste Reihenfolge, Fehler ausgewertet', () => {
    const l = quelle('src/lib/export/registrierungenLaden.ts')
    assert.match(l, /\.eq\('tenant_id', tenantId\)\s+\.order\('gueltig_bis', \{ nullsFirst: false \}\)\.order\('erstellt_am'\)\.order\('id'\)\)/)
    assert.match(l, /if \(error\) throw new AktionsFehler/)
  })
  test('Migration: Tabelle mit allen Policies nur für authenticated, Index, CHECKs', () => {
    const m = migration('kan437a_export_registrierungen')
    for (const p of ['export_registrierungen_select', 'export_registrierungen_insert', 'export_registrierungen_update', 'export_registrierungen_delete', 'modul_insert', 'modul_update',
      'modul_delete', 'mitgliedschaft_aktiv', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del', 'zwei_faktor_aal', 'paketmodul_ins', 'paketmodul_upd', 'paketmodul_del']) {
      assert.match(m, new RegExp(`CREATE POLICY ${p} ON public\\.export_registrierungen [^;]*TO authenticated`), p)
    }
    assert.equal(m.split('CREATE POLICY ').length - 1, 15)
    assert.match(m, /tenant_id       uuid NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE,/)
    assert.match(m, /CREATE INDEX export_registrierungen_tenant_idx ON public\.export_registrierungen \(tenant_id, gueltig_bis\);/)
    assert.match(m, /CHECK \(art <> 'sonstige' OR bezeichnung IS NOT NULL\)/)
    assert.match(m, /REVOKE ALL ON public\.export_registrierungen FROM anon;/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.deepEqual(schema.export_registrierungen, ['id', 'tenant_id', 'art', 'bezeichnung', 'nummer', 'gueltig_bis', 'zusatz', 'notiz', 'erstellt_am', 'aktualisiert_am'])
  })
  test('Seite, Verweis in der Liste, Handbuch', () => {
    assert.match(quelle('src/app/(dashboard)/weinexport/registrierungen/page.tsx'), /if \(!einst\?\.modul_export \|\| !tenantId\) redirect\('\/dashboard'\)/)
    assert.match(quelle('src/app/(dashboard)/weinexport/page.tsx'), /<Link href="\/weinexport\/registrierungen"/)
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /titel: 'Export-Registrierungen', inhalt: 'Unter Weinexport › Registrierungen/)
  })
})
