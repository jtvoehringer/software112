// KAN-440 Teil 1 (13.11.2026): Weinexport E3 – Statuswechsel des Exportauftrags nur noch mit Prüfung.
// Befund: Der Status war ein frei wählbares Auswahlfeld; die Route schrieb jeden Wert direkt – auch rückwärts und
// „Versendet“ ohne Rechnung. Jetzt: Übergangsmatrix in der Datenbank (RPC + Trigger) und dieselben Regeln in der App.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSchritte, exportUebergangFehler, istExportStatus, EXPORT_STATUS, EXPORT_GRUND_MIN } from '../../src/lib/export/workflow.ts'

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
const GRUND = 'Lieferung wurde verschoben'

describe('KAN-440: Übergangsmatrix (wie die Datenbank)', () => {
  test('vorwärts je ein Schritt; Sprünge, gleicher und unbekannter Status werden abgelehnt', () => {
    assert.deepEqual([...EXPORT_STATUS], ['entwurf', 'bestaetigt', 'versendet', 'abgeschlossen'])
    assert.equal(exportUebergangFehler({ status: 'entwurf' }, 'bestaetigt', null, false), null)
    assert.match(exportUebergangFehler({ status: 'entwurf' }, 'versendet', null, true), /Schritt für Schritt/)
    assert.match(exportUebergangFehler({ status: 'entwurf' }, 'abgeschlossen', null, true), /Schritt für Schritt/)
    assert.match(exportUebergangFehler({ status: 'bestaetigt' }, 'bestaetigt', null, true), /bereits „Bestätigt“/)
    assert.equal(exportUebergangFehler({ status: 'entwurf' }, 'geliefert', null, true), 'Unbekannter Status.')
    assert.equal(istExportStatus('versendet'), true)
    assert.equal(istExportStatus('Versendet'), false)
    // ohne Status gilt der Auftrag als Entwurf (Altbestand)
    assert.equal(exportUebergangFehler({ status: null }, 'bestaetigt', null, false), null)
  })
  test('„Versendet“ nur mit Rechnung bzw. ausgebuchtem Muster', () => {
    assert.match(exportUebergangFehler({ status: 'bestaetigt' }, 'versendet', null, true), /wenn die Rechnung gestellt ist/)
    assert.match(exportUebergangFehler({ status: 'bestaetigt', mustersendung: true }, 'versendet', null, true), /wenn das Muster ausgebucht ist/)
    assert.equal(exportUebergangFehler({ status: 'bestaetigt', verkaufsposten_id: 'v1' }, 'versendet', null, false), null)
    assert.equal(exportUebergangFehler({ status: 'bestaetigt', mustersendung: true, muster_ausgebucht_am: '2026-11-13' }, 'versendet', null, false), null)
    assert.equal(exportUebergangFehler({ status: 'versendet', verkaufsposten_id: 'v1' }, 'abgeschlossen', null, false), null)
  })
  test('zurück: nur Betriebsleitung, mit Grund; auf Entwurf nur ohne Rechnung/Muster', () => {
    assert.match(exportUebergangFehler({ status: 'bestaetigt' }, 'entwurf', GRUND, false), /nur die Betriebsleitung/)
    assert.match(exportUebergangFehler({ status: 'bestaetigt' }, 'entwurf', 'zu kurz', true), /mindestens 10 Zeichen/)
    assert.match(exportUebergangFehler({ status: 'bestaetigt' }, 'entwurf', '          ', true), /mindestens 10 Zeichen/)
    assert.equal(exportUebergangFehler({ status: 'bestaetigt' }, 'entwurf', GRUND, true), null)
    assert.match(exportUebergangFehler({ status: 'bestaetigt', verkaufsposten_id: 'v1' }, 'entwurf', GRUND, true), /solange es eine Rechnung/)
    assert.match(exportUebergangFehler({ status: 'bestaetigt', muster_ausgebucht_am: '2026-11-13' }, 'entwurf', GRUND, true), /solange es eine Rechnung/)
    assert.equal(exportUebergangFehler({ status: 'versendet', verkaufsposten_id: 'v1' }, 'bestaetigt', GRUND, true), null)
    assert.equal(EXPORT_GRUND_MIN, 10)
  })
  test('„Abgeschlossen“ ist endgültig, storniert geht nichts', () => {
    assert.match(exportUebergangFehler({ status: 'abgeschlossen' }, 'versendet', GRUND, true), /abgeschlossen – der Status lässt sich nicht mehr ändern/)
    assert.equal(exportUebergangFehler({ status: 'entwurf', storniert_am: '2026-11-13T10:00:00Z' }, 'bestaetigt', null, true), 'Der Exportauftrag ist storniert.')
  })
})

describe('KAN-440: angebotene Schritte', () => {
  const knoepfe = (a, bl) => exportSchritte(a, bl).map(s => `${s.knopf}${s.gesperrt ? ' ✗' : ''}`)
  test('Mitarbeiter: nur der nächste Schritt; ohne Rechnung gesperrt mit Hinweis', () => {
    assert.deepEqual(knoepfe({ status: 'entwurf' }, false), ['Bestätigen'])
    assert.deepEqual(knoepfe({ status: 'bestaetigt' }, false), ['Als versendet markieren ✗'])
    assert.match(exportSchritte({ status: 'bestaetigt' }, false)[0].gesperrt, /Rechnung gestellt/)
    assert.deepEqual(knoepfe({ status: 'bestaetigt', verkaufsposten_id: 'v1' }, false), ['Als versendet markieren'])
    assert.deepEqual(knoepfe({ status: 'versendet', verkaufsposten_id: 'v1' }, false), ['Abschließen'])
  })
  test('Betriebsleitung: zusätzlich ein Schritt zurück – der fehlende Grund sperrt den Knopf nicht', () => {
    assert.deepEqual(knoepfe({ status: 'entwurf' }, true), ['Bestätigen'])
    assert.deepEqual(knoepfe({ status: 'bestaetigt' }, true), ['Als versendet markieren ✗', 'Zurück auf „Entwurf“'])
    assert.deepEqual(knoepfe({ status: 'bestaetigt', verkaufsposten_id: 'v1' }, true), ['Als versendet markieren', 'Zurück auf „Entwurf“ ✗'])
    assert.deepEqual(knoepfe({ status: 'versendet', verkaufsposten_id: 'v1' }, true), ['Abschließen', 'Zurück auf „Bestätigt“'])
    assert.equal(exportSchritte({ status: 'versendet' }, true)[1].zurueck, true)
  })
  test('abgeschlossen und storniert: keine Schritte', () => {
    assert.deepEqual(exportSchritte({ status: 'abgeschlossen' }, true), [])
    assert.deepEqual(exportSchritte({ status: 'bestaetigt', storniert_am: '2026-11-13T10:00:00Z' }, true), [])
  })
})

describe('KAN-440: Route, Detailseite, Migration', () => {
  test('Route: Status nur über die RPC, als eigener Schritt; nie mehr direkt per update', () => {
    const r = quelle('src/app/api/weinexport/[id]/route.ts')
    assert.match(r, /\.rpc\('s112_exportauftrag_status_setzen', \{[^}]*p_tenant_id: tenantId, p_auftrag_id: id, p_status: b\.status, p_grund: /)
    assert.match(r, /if \(!istExportStatus\(b\.status\)\) return fehler\('Ungültiger Status', 400\)/)
    assert.match(r, /if \(Object\.keys\(b\)\.some\(k => k !== 'status' && k !== 'grund'\)\) return fehler\(/)
    assert.doesNotMatch(r, /update\.status/)
    // Ablehnungen der Datenbank kommen mit ihrem Text beim Benutzer an
    assert.match(r, /se\.code === 'P0002' \? 404 : se\.code === '42501' \? 403 : se\.code === '23514' \|\| se\.code === '22023' \? 409 : 500/)
    // die Prüfungen davor bleiben (2FA, Modul, Betrieb der Seite, Abo, Schreibrecht)
    assert.ok(r.indexOf("canWrite(membership, 'warenwirtschaft')") < r.indexOf("s112_exportauftrag_status_setzen', {"))
  })
  test('Detailseite: Knöpfe aus exportSchritte statt freier Auswahl; Grund beim Zurückstufen; Abschließen mit Rückfrage', () => {
    const c = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
    assert.doesNotMatch(c, /<select value=\{status\}/)
    assert.match(c, /const schritte = darfSchreiben \? exportSchritte\(\{ \.\.\.auftrag, status \}, betriebsleitung\) : \[\]/)
    assert.match(c, /disabled=\{saving \|\| !!s\.gesperrt\}/)
    assert.match(c, /if \(schritt\.status === 'abgeschlossen' && !\(await rueckfrage\(\{/)
    assert.match(c, /disabled=\{saving \|\| grund\.trim\(\)\.length < EXPORT_GRUND_MIN\}/)
    assert.match(c, /router\.refresh\(\)/)
    const p = quelle('src/app/(dashboard)/weinexport/[id]/page.tsx')
    assert.match(p, /betriebsleitung=\{canAdmin\(membership\?\.role \?\? null\)\}/)
  })
  test('Migration: Trigger sperrt den direkten Weg, RPC mit allen Prüfungen und Rechten', () => {
    const m = migration('kan440a_export_workflow')
    assert.match(m, /CREATE TRIGGER a_export_workflow BEFORE INSERT OR UPDATE OF status ON public\.exportauftraege/)
    assert.match(m, /IF v_rolle NOT IN \('authenticated', 'anon'\) OR v_frei = '\*' OR v_frei = TG_TABLE_NAME THEN\s+RETURN NEW;/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_export_workflow_schutz\(\) FROM PUBLIC, anon, authenticated;/)
    const rpc = m.slice(m.indexOf('CREATE FUNCTION public.s112_exportauftrag_status_setzen'))
    assert.match(rpc, /SECURITY DEFINER\s+SET search_path = public/)
    for (const p of ["pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer'])", 's112_pruefe_abo_schreibsperre(p_tenant_id)',
      "s112_pruefe_paketmodul(p_tenant_id, 'modul_export')", "s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')"]) {
      assert.ok(rpc.includes(`PERFORM public.${p};`), p)
    }
    assert.ok(rpc.indexOf('pruefe_tenant_zugriff') < rpc.indexOf('s112_pruefe_abo_schreibsperre'))
    assert.match(rpc, /WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;/)
    assert.match(rpc, /PERFORM set_config\('s112\.freeze_frei', 'exportauftraege', true\);[\s\S]+PERFORM set_config\('s112\.aenderung_grund', '', true\);\s+PERFORM set_config\('s112\.freeze_frei', '', true\);/)
    assert.match(rpc, /REVOKE EXECUTE ON FUNCTION public\.s112_exportauftrag_status_setzen\(uuid, uuid, text, text\) FROM PUBLIC, anon;/)
  })
  test('gleiche Texte in App und Datenbank', () => {
    const m = migration('kan440a_export_workflow')
    const w = quelle('src/lib/export/workflow.ts')
    for (const t of ['„Versendet“ geht erst, wenn die Rechnung gestellt ist.', '„Versendet“ geht erst, wenn das Muster ausgebucht ist.',
      'Zurückstufen darf nur die Betriebsleitung.', 'Zurück auf „Entwurf“ geht nicht, solange es eine Rechnung bzw. ein ausgebuchtes Muster gibt.',
      'Der Exportauftrag ist abgeschlossen – der Status lässt sich nicht mehr ändern.']) {
      assert.ok(m.includes(t), `Migration: ${t}`)
      assert.ok(w.includes(t), `App: ${t}`)
    }
  })
  test('Handbuch beschreibt die Schritte', () => {
    const h = quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(h, /„Als versendet markieren“ geht erst, wenn die Rechnung gestellt bzw\. das Muster ausgebucht ist/)
    assert.match(h, /Zurückstufen kann nur die Betriebsleitung/)
  })
})
