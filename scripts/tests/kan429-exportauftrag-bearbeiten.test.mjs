// KAN-429 (12.11.2026): Exportauftrag bearbeiten (Entwurf und Bestätigt), Sperre ab „Versendet“ – Regeln und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXPORT_BEARBEITBAR_STATUS, EXPORT_POSITIONEN_MAX, exportBearbeitbar, exportKopf, exportMenge, exportPositionen, exportauftragFehler,
} from '../../src/lib/export/auftragEingabe.ts'

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
const F = '11111111-1111-4111-8111-111111111111'
const pos = (mehr = {}) => ({ fullung_id: F, beschreibung: 'Riesling', menge: '600', einheit: 'Fl', preis_eur: '9', taric_code: '2204.21', ...mehr })

describe('KAN-429: Positionen prüfen', () => {
  // UAT 12.11.2026: EX-0005 stand mit einer Position über 0 Flaschen da – das Gewicht blieb leer
  test('Menge über 0 Pflicht (Zahl oder Text mit Dezimalpunkt); 0, leer, Komma und Text werden abgelehnt', () => {
    assert.equal(exportauftragFehler({ positionen: [pos(), pos({ menge: 1.5 }), pos({ menge: '2.5' }), pos({ menge: '600.00' })] }), null)
    for (const menge of [0, '0', '', null, undefined, 'viel', '-3', '1e3', '2,5']) {
      assert.match(exportauftragFehler({ positionen: [pos(), pos({ menge })] }), /Position 2: Bitte eine Menge über 0 angeben\./, String(menge))
    }
  })
  test('Füllung oder Bezeichnung Pflicht; Höchstzahl', () => {
    assert.equal(exportauftragFehler({ positionen: [pos({ fullung_id: '' })] }), null)
    assert.equal(exportauftragFehler({ positionen: [pos({ beschreibung: '' })] }), null)
    assert.match(exportauftragFehler({ positionen: [pos({ fullung_id: '', beschreibung: '  ' })] }), /Position 1: Bitte eine Füllung wählen oder eine Bezeichnung angeben/)
    assert.match(exportauftragFehler({ positionen: Array.from({ length: EXPORT_POSITIONEN_MAX + 1 }, () => pos()) }), /Höchstens 200 Positionen/)
  })
  test('Listen- und Längenfehler kommen weiter zuerst (bestehende Meldungen unverändert)', () => {
    assert.match(exportauftragFehler({ positionen: [{ einheit: 'Fl' }, { einheit: 'Fass' }] }), /Position 2: unbekannte Einheit/)
  })
  test('Mengen als Zahl für die Datenbank', () => {
    assert.equal(exportMenge('600.00'), 600)
    assert.equal(exportMenge('2.5'), 2.5)
    assert.equal(exportMenge('1.500'), 1.5)   // Zahlenfeld: Dezimalpunkt, kein Tausenderpunkt
    assert.equal(exportMenge(12), 12)
    for (const w of ['', null, undefined, 'x', '-1', '2,5', NaN, Infinity]) assert.equal(exportMenge(w), null, String(w))
  })
})

describe('KAN-429: bearbeitbar je Status', () => {
  test('Entwurf und Bestätigt ja; Versendet, Abgeschlossen und storniert nein', () => {
    assert.deepEqual([...EXPORT_BEARBEITBAR_STATUS], ['entwurf', 'bestaetigt'])
    assert.equal(exportBearbeitbar({ status: 'entwurf', storniert_am: null }), true)
    assert.equal(exportBearbeitbar({ status: 'bestaetigt' }), true)
    assert.equal(exportBearbeitbar({ status: null }), true)   // Altzeile ohne Status = Entwurf (wie die Datenbank)
    assert.equal(exportBearbeitbar({ status: 'versendet' }), false)
    assert.equal(exportBearbeitbar({ status: 'abgeschlossen' }), false)
    assert.equal(exportBearbeitbar({ status: 'entwurf', storniert_am: '2026-11-12T10:00:00Z' }), false)
  })
})

describe('KAN-429: Daten für die RPC', () => {
  test('Kopf: leere Texte zu null, Zahlen als Zahl, Land als ISO-Code der Route', () => {
    assert.deepEqual(exportKopf({ firma_id: F, kontakt_id: '', datum: '2026-11-12', lieferdatum: '', incoterms: 'DAP', transport_art: 'LKW',
      destination_land: 'Deutschland', destination_stadt: ' München ', eori_kunde: '', versicherungswert: '5400', verpackung_kg: 80, notizen: '' }, 'DE'), {
      kontakt_id: null, firma_id: F, datum: '2026-11-12', lieferdatum: null, incoterms: 'DAP', transport_art: 'LKW', destination_land: 'DE',
      destination_stadt: 'München', eori_kunde: null, versicherungswert: 5400, verpackung_kg: 80, notizen: null,
      versanddatum: null, zahlungsbedingungen: null, kunde_uid: null,   // KAN-432: Grunddaten für die Dokumente
      mustersendung: false,   // KAN-433
      fracht_eur: null, versicherung_eur: null, ursprungserklaerung: false,   // KAN-434
    })
    assert.equal(exportKopf({}, null).versicherungswert, null)
  })
  test('Positionen: Menge und Preis als Zahl, Vorgaben für Einheit und TARIC, keine fremden Felder', () => {
    assert.deepEqual(exportPositionen({ positionen: [pos({ menge: '2.5', preis_eur: '' }), { beschreibung: ' frei ', menge: 3, id: 'x', exportauftrag_id: 'y', tenant_id: 'z' }] }), [
      { fullung_id: F, beschreibung: 'Riesling', menge: 2.5, einheit: 'Fl', preis_eur: 0, taric_code: '2204.21', flaschen_je_karton: null },   // KAN-432
      { fullung_id: null, beschreibung: 'frei', menge: 3, einheit: 'Fl', preis_eur: 0, taric_code: '2204.21', flaschen_je_karton: null },
    ])
    assert.deepEqual(exportPositionen({}), [])
  })
})

describe('KAN-429: Route, Seite und Formular', () => {
  const route = quelle('src/app/api/weinexport/[id]/route.ts')
  const put = route.slice(route.indexOf('export async function PUT('))
  const i = t => { const n = put.indexOf(t); assert.ok(n >= 0, t); return n }
  test('PUT: Zwei-Faktor, Modul, Betrieb der Seite, Schreibsperre und Schreibrecht (Mitgliedschaft) vor der Prüfung', () => {
    assert.ok(i('await pruefeZweiFaktor()') < i("modulKonflikt('modul_export')"))
    assert.ok(i("modulKonflikt('modul_export')") < i('seitenBetriebKonflikt(tenantId)'))
    assert.ok(i('seitenBetriebKonflikt(tenantId)') < i('schreibSperreKonflikt(membership)'))
    assert.ok(i('schreibSperreKonflikt(membership)') < i("canWrite(membership, 'warenwirtschaft')"))
    assert.ok(i("canWrite(membership, 'warenwirtschaft')") < i('exportauftragFehler(b)'))
    assert.ok(i('exportauftragFehler(b)') < i("'s112_exportauftrag_aendern'"))
  })
  test('PUT schreibt nur über die RPC – Betrieb aus der Sitzung, nie aus dem Body', () => {
    assert.ok(put.includes('p_tenant_id: tenantId, p_auftrag_id: id, p_kopf: exportKopf(b, destinationLand), p_positionen: exportPositionen(b)'))
    assert.ok(!/\.from\(|\.update\(|\.insert\(|\.delete\(|b\.tenant_id/.test(put), 'kein direkter Tabellenzugriff, kein tenant_id aus dem Body')
    assert.ok(put.includes("error.code === '42501' ? 409"))
  })
  test('Bearbeiten-Seite: Schreibrecht, Export-Modul, eigener Betrieb, nur bearbeitbare Aufträge', () => {
    const p = quelle('src/app/(dashboard)/weinexport/[id]/bearbeiten/page.tsx')
    const j = t => { const n = p.indexOf(t); assert.ok(n >= 0, t); return n }
    assert.ok(j("canWrite(membership, 'warenwirtschaft')") < j(".from('exportauftraege')"))
    assert.ok(p.includes(".eq('id', id).eq('tenant_id', tenantId).maybeSingle()"))
    assert.ok(p.includes('if (!exportBearbeitbar(auftrag as'))
    assert.ok(p.includes("bearbeiten={{ id, referenz:"))
  })
  test('Formular: dieselbe Prüfung vor dem Senden, PUT beim Bearbeiten, Ladezustand mit finally', () => {
    const f = quelle('src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx')
    assert.ok(f.indexOf('const eingabeFehler = exportauftragFehler(body)') < f.indexOf('setSaving(true)'))
    assert.ok(f.includes("method: bearbeiten ? 'PUT' : 'POST'"))
    assert.match(f, /\} finally \{\n\s+setSaving\(false\)/)
    assert.ok(f.includes('wieder auf „Ausstehend“ – bitte neu ausstellen.'))
  })
  test('Detailseite: „Bearbeiten“ nur bearbeitbar und mit Schreibrecht, sonst Sperrhinweis', () => {
    const c = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
    assert.ok(c.includes('{darfSchreiben && exportBearbeitbar({ status, storniert_am: auftrag.storniert_am }) && ('))
    assert.ok(c.includes('href={`/weinexport/${auftrag.id}/bearbeiten`}'))
    assert.ok(c.includes('<GesperrtHinweis grund="Exportauftrag versendet'))
  })
  test('Anlegen nutzt dieselbe Prüfung (Menge 0 abgelehnt)', () => {
    const r = quelle('src/app/api/weinexport/route.ts')
    assert.ok(r.indexOf('exportauftragFehler(body)') < r.indexOf("'get_next_exportnummer'"))
  })
})

describe('KAN-429: Migration', () => {
  const sql = migration('kan429_exportauftrag_aendern')
  test('Freeze ab versendet/abgeschlossen: Status, EMCS, Verpackung und Storno bleiben änderbar', () => {
    assert.ok(sql.includes('CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.exportauftraege'))
    assert.ok(sql.includes("'o.storniert_am IS NULL AND o.status IN (''versendet'', ''abgeschlossen'')'"))
    assert.ok(sql.includes("'status,emcs_arc_nummer,emcs_status,emcs_datum,verpackung_kg,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund'"))
  })
  test('Positionen eines versendeten Auftrags gesperrt – Dokumente nicht', () => {
    assert.ok(sql.includes("IF TG_TABLE_NAME = 'exportauftrag_positionen'"))
    assert.ok(sql.includes("AND a.status IN ('versendet', 'abgeschlossen')) THEN"))
  })
  test('RPC: Zugriff, Abo-Sperre, Paket-Modul Export, Schreibmodul; nur Entwurf/Bestätigt; Löschsperre nur für diesen Auftrag frei', () => {
    const f = sql.slice(sql.indexOf('CREATE FUNCTION public.s112_exportauftrag_aendern('))
    const k = t => { const n = f.indexOf(t); assert.ok(n >= 0, t); return n }
    assert.ok(k('pruefe_tenant_zugriff(p_tenant_id') < k('s112_pruefe_abo_schreibsperre(p_tenant_id)'))
    assert.ok(k('s112_pruefe_abo_schreibsperre(p_tenant_id)') < k("s112_pruefe_paketmodul(p_tenant_id, 'modul_export')"))
    assert.ok(k("s112_pruefe_paketmodul(p_tenant_id, 'modul_export')") < k("s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')"))
    assert.ok(k("NOT IN ('entwurf', 'bestaetigt') THEN") < k('UPDATE public.exportauftraege SET'))
    assert.ok(k('IF v_m IS NULL OR v_m <= 0 THEN') < k('UPDATE public.exportauftraege SET'))
    assert.ok(k("set_config('s112.storno_loeschen', p_auftrag_id::text, true)") < k("set_config('s112.storno_loeschen', '', true)"))
    assert.ok(f.includes("WHERE exportauftrag_id = p_auftrag_id AND status = 'ausgestellt'"))
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.s112_exportauftrag_aendern(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;'))
    assert.ok(f.includes('SECURITY DEFINER\nSET search_path = public'))
  })
})
