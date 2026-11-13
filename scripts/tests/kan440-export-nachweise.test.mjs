// KAN-440 Teil 2 (13.11.2026): Weinexport E3 – Ausfuhr- und Gelangensnachweis.
// Befund: Am Exportauftrag gab es keinen Platz für den Nachweis der steuerfreien Lieferung – keine MRN, keinen Beleg,
// keine Frist; „Abgeschlossen“ ging ohne jede Prüfung. Jetzt: Belege je Auftrag, Fristanzeige (Auftrag, Liste,
// Dashboard) und Abschluss nur mit Nachweis bzw. Begründung.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  nachweisFrist, nachweisOffen, plusMonate, nachweisArtenFuer, nachweisName, nachweisDateiFehler, nachweisEingabeFehler,
  nachweisPfad, ausfuhranmeldungFehler, mrnBereinigt, istNachweisArt, NACHWEIS_ARTEN, NACHWEIS_MAX_BYTES,
} from '../../src/lib/export/nachweise.ts'
import { exportSchritte, exportUebergangFehler } from '../../src/lib/export/workflow.ts'

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

const basis = { status: 'versendet', verkaufsposten_id: 'v1', nachweise: 0, rechnungsdatum: '2026-08-31', gebiet: 'drittland' }
const stufe = (a, heute) => nachweisFrist({ ...basis, ...a }, heute).stufe

describe('KAN-440: Fristrechnung', () => {
  test('Kalendermonate – Monatsende bleibt Monatsende, Jahreswechsel, Schaltjahr', () => {
    assert.equal(plusMonate('2026-08-31', 6), '2027-02-28')
    assert.equal(plusMonate('2027-08-31', 6), '2028-02-29')
    assert.equal(plusMonate('2026-11-13', 6), '2027-05-13')
    assert.equal(plusMonate('2026-01-15', 5), '2026-06-15')
  })
  test('Staffel: offen → Hinweis ab 30 Tagen → Warnung ab 5 Monaten → überfällig nach 6 Monaten', () => {
    assert.equal(stufe({}, '2026-09-29'), 'offen')         // 29 Tage
    assert.equal(stufe({}, '2026-09-30'), 'hinweis')       // 30 Tage
    assert.equal(stufe({}, '2027-01-30'), 'hinweis')
    assert.equal(stufe({}, '2027-01-31'), 'warnung')       // 5 Monate
    assert.equal(stufe({}, '2027-02-28'), 'warnung')       // letzter Tag der Frist
    assert.equal(stufe({}, '2027-03-01'), 'ueberfaellig')
    const f = nachweisFrist(basis, '2027-03-01')
    assert.equal(f.faelligAm, '2027-02-28')
    assert.equal(f.text, 'Ausfuhrnachweis fehlt – Frist am 28.02.2027 abgelaufen (6 Monate nach der Lieferung).')
    assert.equal(nachweisFrist(basis, '2026-09-01').text, 'Ausfuhrnachweis noch offen – Frist bis 28.02.2027.')
  })
  test('EU: dieselbe Staffel, anderer Name', () => {
    assert.equal(stufe({ gebiet: 'eu' }, '2027-03-01'), 'ueberfaellig')
    assert.match(nachweisFrist({ ...basis, gebiet: 'eu' }, '2026-10-15').text, /^Gelangensnachweis fehlt seit über 30 Tagen – Frist bis 28\.02\.2027\.$/)
    assert.equal(nachweisName('eu'), 'Gelangensnachweis')
    assert.equal(nachweisName('drittland'), 'Ausfuhrnachweis')
  })
  test('Fristbeginn: Rechnungsdatum vor Versanddatum; ohne beides „fehlt noch“ ohne Fristende', () => {
    assert.equal(nachweisFrist({ ...basis, rechnungsdatum: '2026-08-31', versanddatum: '2026-01-01' }, '2026-09-01').faelligAm, '2027-02-28')
    assert.equal(nachweisFrist({ ...basis, rechnungsdatum: null, versanddatum: '2026-01-01' }, '2026-09-01').stufe, 'ueberfaellig')
    const ohne = nachweisFrist({ ...basis, rechnungsdatum: null, versanddatum: null }, '2026-09-01')
    assert.deepEqual([ohne.stufe, ohne.faelligAm, ohne.text], ['offen', null, 'Ausfuhrnachweis fehlt noch.'])
  })
  test('keine Frist: Mustersendung, storniert, Inland, Land fehlt, vor der Lieferung', () => {
    for (const a of [{ mustersendung: true }, { storniert_am: '2026-09-01T10:00:00Z' }, { gebiet: 'inland' }, { gebiet: null },
      { status: 'bestaetigt', verkaufsposten_id: null }, { status: 'entwurf', verkaufsposten_id: null }]) {
      assert.equal(stufe(a, '2027-12-31'), 'keine', JSON.stringify(a))
    }
    // mit Rechnung läuft die Frist schon vor „Versendet“
    assert.equal(stufe({ status: 'bestaetigt' }, '2027-03-01'), 'ueberfaellig')
  })
  test('erledigt mit Nachweis; „ohne Nachweis abgeschlossen“ warnt nicht mehr, nennt aber den Grund', () => {
    assert.equal(stufe({ nachweise: 1 }, '2027-12-31'), 'erledigt')
    const ohne = nachweisFrist({ ...basis, status: 'abgeschlossen', abschluss_ohne_nachweis: 'Beleg liegt beim Spediteur' }, '2027-12-31')
    assert.deepEqual([ohne.stufe, ohne.text], ['ohne', 'Ohne Ausfuhrnachweis abgeschlossen: Beleg liegt beim Spediteur'])
    assert.deepEqual(['keine', 'erledigt', 'ohne', 'offen', 'hinweis', 'warnung', 'ueberfaellig'].map(s => nachweisOffen({ stufe: s, faelligAm: null, text: '' })),
      [false, false, false, true, true, true, true])
  })
})

describe('KAN-440: Eingaben', () => {
  test('Arten je Lieferfall – die übliche zuerst', () => {
    assert.equal(nachweisArtenFuer('drittland')[0], 'ausgangsvermerk')
    assert.equal(nachweisArtenFuer('eu')[0], 'gelangensbestaetigung')
    assert.deepEqual([...nachweisArtenFuer('eu')].sort(), Object.keys(NACHWEIS_ARTEN).sort())
    assert.equal(istNachweisArt('frachtbrief'), true)
    assert.equal(istNachweisArt('toString'), false)
  })
  test('Datei: Pflicht, nicht leer, Typ, Größe', () => {
    assert.match(nachweisDateiFehler(null), /als Datei wählen/)
    assert.match(nachweisDateiFehler({ name: 'a.pdf', type: 'application/pdf', size: 0 }), /ist leer/)
    assert.match(nachweisDateiFehler({ name: 'a.docx', type: 'application/msword', size: 10 }), /nicht unterstütztes Dateiformat/)
    assert.match(nachweisDateiFehler({ name: 'a.pdf', type: 'application/pdf', size: NACHWEIS_MAX_BYTES + 1 }), /zu groß/)
    assert.equal(nachweisDateiFehler({ name: 'a.pdf', type: 'application/pdf', size: NACHWEIS_MAX_BYTES }), null)
  })
  test('Art und Datum: nicht in der Zukunft', () => {
    assert.equal(nachweisEingabeFehler({ art: 'ausgangsvermerk', datum: '2026-11-13' }, '2026-11-13'), null)
    assert.match(nachweisEingabeFehler({ art: 'ausgangsvermerk', datum: '2026-11-14' }, '2026-11-13'), /in der Zukunft/)
    assert.match(nachweisEingabeFehler({ art: 'quittung', datum: '2026-11-13' }, '2026-11-13'), /Art des Nachweises/)
    assert.match(nachweisEingabeFehler({ art: 'sonstiger', datum: '13.11.2026' }, '2026-11-13'), /Datum des Nachweises/)
    assert.match(nachweisEingabeFehler({ art: 'sonstiger', datum: '2026-11-13', notiz: 'x'.repeat(401) }, '2026-11-13'), /höchstens 400/)
  })
  test('Ablagepfad: Betrieb und Auftrag als Ordner, Dateiname entschärft', () => {
    assert.equal(nachweisPfad('t1', 'a1', 'Ausgangsvermerk März (1).pdf', 1700000000000), 't1/a1/1700000000000-Ausgangsvermerk_M_rz__1_.pdf')
    assert.equal(nachweisPfad('t1', 'a1', '../../x', 5), 't1/a1/5-.._.._x')
    assert.ok(!nachweisPfad('t1', 'a1', '../../x', 5).slice('t1/a1/'.length).includes('/'), 'kein weiterer Ordner aus dem Dateinamen')
  })
  test('MRN: 18 Zeichen, Leerzeichen und Kleinbuchstaben werden bereinigt; beide Felder dürfen leer sein', () => {
    assert.equal(mrnBereinigt(' 26at 100000 abcdefg1 '), '26AT100000ABCDEFG1')
    assert.equal(ausfuhranmeldungFehler({ mrn: '26AT100000ABCDEFG1', datum: '2026-11-13' }, '2026-11-13'), null)
    assert.equal(ausfuhranmeldungFehler({ mrn: '', datum: '' }, '2026-11-13'), null)
    assert.match(ausfuhranmeldungFehler({ mrn: '26AT1000', datum: '' }, '2026-11-13'), /18 Zeichen/)
    assert.match(ausfuhranmeldungFehler({ mrn: '', datum: '2026-11-14' }, '2026-11-13'), /in der Zukunft/)
  })
})

describe('KAN-440: Abschließen nur mit Nachweis bzw. Begründung', () => {
  const versendet = { status: 'versendet', verkaufsposten_id: 'v1' }
  test('ohne Nachweis: Begründung nötig; mit Nachweis und bei Mustersendungen nicht', () => {
    assert.match(exportUebergangFehler(versendet, 'abgeschlossen', null, false), /fehlt der Ausfuhr- bzw\. Gelangensnachweis/)
    assert.match(exportUebergangFehler(versendet, 'abgeschlossen', 'zu kurz', false), /fehlt der Ausfuhr- bzw\. Gelangensnachweis/)
    assert.equal(exportUebergangFehler(versendet, 'abgeschlossen', 'Beleg liegt beim Spediteur', false), null)
    assert.equal(exportUebergangFehler({ ...versendet, nachweise: 1 }, 'abgeschlossen', null, false), null)
    assert.equal(exportUebergangFehler({ status: 'versendet', mustersendung: true, muster_ausgebucht_am: '2026-11-13' }, 'abgeschlossen', null, false), null)
  })
  test('Knopf „Abschließen“ bleibt frei und fragt die Begründung ab', () => {
    const [s] = exportSchritte(versendet, false)
    assert.deepEqual([s.status, s.gesperrt, s.grundNoetig, s.zurueck], ['abgeschlossen', null, true, false])
    assert.equal(exportSchritte({ ...versendet, nachweise: 2 }, false)[0].grundNoetig, false)
    assert.equal(exportSchritte({ status: 'entwurf' }, false)[0].grundNoetig, false)
    assert.equal(exportSchritte(versendet, true)[1].grundNoetig, true, 'zurückstufen fragt immer den Grund ab')
  })
})

describe('KAN-440: Routen, Seiten, Migration', () => {
  test('Upload-Route: alle Prüfungen vor dem Schreiben, Datei wieder weg, wenn die Zeile scheitert', () => {
    const r = quelle('src/app/api/weinexport/[id]/nachweis/route.ts')
    const reihenfolge = ['pruefeZweiFaktor()', "modulKonflikt('modul_export')", 'seitenBetriebKonflikt(tenantId)', 'schreibSperreKonflikt(membership)',
      "canWrite(membership, 'warenwirtschaft')", 'nachweisEingabeFehler(', 'nachweisDateiFehler(', ".from('exportauftraege')", '.upload(pfad', ".from('export_nachweise')"]
    const stellen = reihenfolge.map(t => r.indexOf(t))
    assert.ok(stellen.every(i => i > 0), `fehlt: ${reihenfolge[stellen.findIndex(i => i < 0)]}`)
    assert.deepEqual(stellen, [...stellen].sort((a, b) => a - b), 'Reihenfolge der Prüfungen')
    assert.match(r, /\.select\('id, status, storniert_am'\)\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)\s+if \(ae\) return fehler/)
    assert.match(r, /nachweisPfad\(tenantId, id, datei\.name, Date\.now\(\)\)/)
    assert.match(r, /upsert: false/)
    assert.match(r, /if \(ie \|\| !\(\(zeile \?\? \[\]\) as R\[\]\)\.length\) \{[\s\S]{0,200}\.remove\(\[pfad\]\)/)
  })
  test('Öffnen und Entfernen: Zeile über id, Auftrag UND Betrieb; gelöschte Zeile zurückholen, Datei danach', () => {
    const r = quelle('src/app/api/weinexport/[id]/nachweis/[nid]/route.ts')
    assert.match(r, /\.select\('datei_pfad'\)\.eq\('id', nid\)\.eq\('exportauftrag_id', id\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)\s+if \(error\) return fehler/)
    assert.match(r, /createSignedUrl\(pfad, GUELTIG_S\)/)
    assert.match(r, /\.delete\(\)\.eq\('id', nid\)\.eq\('exportauftrag_id', id\)\.eq\('tenant_id', tenantId\)\.select\('id, datei_pfad'\)/)
    assert.match(r, /if \(zeilen\.length === 0\) return fehler\(/)
    assert.ok(r.indexOf('.delete()') < r.indexOf('.remove(zeilen.map'), 'Datei erst nach der Zeile')
    const del = r.slice(r.indexOf('export async function DELETE'))
    for (const p of ['pruefeZweiFaktor()', "modulKonflikt('modul_export')", 'seitenBetriebKonflikt(tenantId)', 'schreibSperreKonflikt(membership)', "canWrite(membership, 'warenwirtschaft')"]) {
      assert.ok(del.includes(p) && del.indexOf(p) < del.indexOf('.delete()'), p)
    }
  })
  test('PATCH: MRN und Datum der Ausfuhranmeldung in der Positivliste, geprüft und bereinigt', () => {
    const r = quelle('src/app/api/weinexport/[id]/route.ts')
    assert.match(r, /const AENDERBAR = \['status', 'grund', 'emcs_arc_nummer', 'emcs_status', 'verpackung_kg', 'ausfuhr_mrn', 'ausfuhr_anmeldung_datum'\] as const/)
    assert.match(r, /const af = ausfuhranmeldungFehler\(\{ mrn, datum \}, heuteWien\(\)\)\s+if \(af\) return fehler\(af, 400\)/)
    assert.match(r, /update\.ausfuhr_mrn = mrnBereinigt\(mrn\) \|\| null/)
  })
  test('Seite, Liste und Dashboard nutzen dieselbe Fristregel', () => {
    const p = quelle('src/app/(dashboard)/weinexport/[id]/page.tsx')
    assert.match(p, /const frist = nachweisFrist\(\{[\s\S]{0,400}rechnungsdatum: vk\?\.datum \?\? null, gebiet,\s+\}, heute\)/)
    assert.match(p, /darfAendern=\{darfSchreiben && !a\.storniert_am && a\.status !== 'abgeschlossen'\}/)
    assert.match(p, /nachweise=\{nachweise\.length\}/)
    const l = quelle('src/lib/export/nachweisLaden.ts')
    assert.match(l, /\.eq\('tenant_id', tenantId\)\.eq\('exportauftrag_id', auftragId\)\s+\.order\('datum'\)\.order\('erstellt_am'\)\.order\('id'\)/)
    assert.equal(l.split(".eq('tenant_id', tenantId)").length - 1, 4, 'jede Abfrage im eigenen Betrieb')
    assert.equal(l.split('throw new AktionsFehler').length - 1, 4, 'jeder Lesefehler wird ausgewertet')
    assert.match(l, /inBloecken<R>\(verkaufIds, b => alle<R>\(/)
    assert.match(l, /\.filter\(z => nachweisOffen\(z\.frist\)\)/)
    assert.match(quelle('src/app/(dashboard)/weinexport/page.tsx'), /await ladeOffeneNachweise\(supabase, tenantId, heuteWien\(\)\)/)
    const d = quelle('src/app/(dashboard)/dashboard/fristen/page.tsx')
    assert.match(d, /exportEinst\?\.modul_export && ctx\.tenantId \? await ladeOffeneNachweise\(ctx\.supabase, ctx\.tenantId, ctx\.heuteStr\) : \[\]/)
  })
  test('Kasten: Laden mit try/finally, Antworten ausgewertet, Entfernen mit Rückfrage', () => {
    const c = quelle('src/app/(dashboard)/weinexport/[id]/ExportNachweisPanel.tsx')
    assert.equal(c.split('setLaeuft(true)').length - 1, 3)
    assert.equal(c.split('} finally {\n      setLaeuft(false)').length - 1, 3)
    assert.equal(c.split('if (!res.ok) {').length - 1, 3)
    assert.match(c, /await rueckfrage\(\{ titel: 'Nachweis entfernen\?'/)
    assert.doesNotMatch(c, /confirm\(/)
  })
  test('Migration: Tabelle mit allen Policies, Sperre, Speicher, Abschluss nur mit Nachweis', () => {
    const m = migration('kan440b_export_nachweise')
    assert.match(m, /exportauftrag_id uuid NOT NULL REFERENCES public\.exportauftraege\(id\) ON DELETE CASCADE,/)
    assert.match(m, /datei_pfad LIKE tenant_id::text \|\| '\/' \|\| exportauftrag_id::text \|\| '\/%'\)/)
    for (const p of ['export_nachweise_select', 'export_nachweise_insert', 'export_nachweise_delete', 'modul_insert', 'modul_delete', 'mitgliedschaft_aktiv',
      'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del', 'zwei_faktor_aal', 'paketmodul_ins', 'paketmodul_upd', 'paketmodul_del']) {
      assert.match(m, new RegExp(`CREATE POLICY ${p} ON public\\.export_nachweise [^;]*TO authenticated`), p)
    }
    assert.doesNotMatch(m, /CREATE POLICY [a-z_]+ ON public\.export_nachweise (?![^;]*TO authenticated)/)
    assert.match(m, /REVOKE ALL ON public\.export_nachweise FROM anon;\nREVOKE UPDATE ON public\.export_nachweise FROM authenticated;/)
    assert.match(m, /CREATE INDEX export_nachweise_tenant_idx ON public\.export_nachweise \(tenant_id\);\nCREATE INDEX export_nachweise_auftrag_idx ON public\.export_nachweise \(exportauftrag_id\);/)
    assert.match(m, /CREATE TRIGGER z_fremdverweis_exportauftrag_id BEFORE INSERT OR UPDATE OF exportauftrag_id, tenant_id ON public\.export_nachweise/)
    assert.match(m, /CREATE TRIGGER a_nachweis_schutz BEFORE INSERT OR UPDATE OR DELETE ON public\.export_nachweise/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_export_nachweis_schutz\(\) FROM PUBLIC, anon, authenticated;/)
    // Speicher: privat, Ordner = Betrieb
    assert.match(m, /VALUES \('export-nachweise', 'export-nachweise', false, 5242880, ARRAY\['application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp'\]\)/)
    assert.equal(m.split("(storage.foldername(objects.name))[1]").length - 1, 3)
    assert.equal(m.split('ON storage.objects FOR').length - 1, 3, 'Lesen, Hochladen, Löschen – kein Ändern')
    // Statuswechsel: jede Stelle genau einmal ersetzt, sonst Abbruch
    assert.match(m, /<> 1 THEN\s+RAISE EXCEPTION 'KAN-440: s112_exportauftrag_status_setzen – Stelle nicht genau einmal gefunden/)
    assert.match(m, /SET status = p_status, abschluss_ohne_nachweis = v_ohne WHERE id = v_a\.id AND tenant_id = p_tenant_id;/)
    // Positivliste der Sperre: MRN und Datum der Ausfuhranmeldung bleiben ab „Versendet“ änderbar
    assert.match(m, /verkaufsposten_id,muster_ausgebucht_am,ausfuhr_mrn,ausfuhr_anmeldung_datum',/)
    assert.match(m, /BEFORE INSERT OR UPDATE OF status, abschluss_ohne_nachweis, ausfuhr_mrn, ausfuhr_anmeldung_datum ON public\.exportauftraege/)
  })
  test('gleicher Text in App und Datenbank; Schema-Dateien und Runbook nachgezogen', () => {
    const t = 'Zum Abschließen fehlt der Ausfuhr- bzw. Gelangensnachweis – bitte den Nachweis erfassen oder den Abschluss ohne Nachweis begründen (mindestens '
    assert.ok(migration('kan440b_export_nachweise').includes(t + '10 Zeichen).'))
    assert.ok(quelle('src/lib/export/workflow.ts').includes(t + '${EXPORT_GRUND_MIN} Zeichen).'))
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.deepEqual(schema.export_nachweise, ['id', 'tenant_id', 'exportauftrag_id', 'art', 'datum', 'datei_pfad', 'dateiname', 'notiz', 'erstellt_am', 'erstellt_von'])
    for (const s of ['ausfuhr_mrn', 'ausfuhr_anmeldung_datum', 'abschluss_ohne_nachweis']) assert.ok(schema.exportauftraege.includes(s), s)
    assert.match(quelle('scripts/fremdschluessel.json'), /"n":"export_nachweise_exportauftrag_id_fkey","t":"export_nachweise","s":\["exportauftrag_id"\],"z":"exportauftraege"/)
    assert.match(quelle('docs/Mandant_loeschen.md'), /`export-nachweise`/)
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /titel: 'Ausfuhr- und Gelangensnachweis'/)
  })
})
