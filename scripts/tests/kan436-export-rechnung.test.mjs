// KAN-436 E1 (12.11.2026): Weinexport Teil E, Schritt 1 – Rechnung und Bestandsabgang aus dem Exportauftrag (Epic KAN-431).
// Befund (Zollrecherche KAN-417, Bestandsaufnahme): Ein Exportauftrag minderte weder den Flaschenbestand noch entstand
// eine Rechnung in der Fakturierung; im Rechnungsausgangsjournal und in der Rückruf-Liste stand er trotzdem.
// Jetzt: „Rechnung stellen“ legt über createVerkauf einen Verkauf mit Rechnung an (nur steuerfreie Fälle, nur
// Flaschenware), der Auftrag ist danach gesperrt; Mustersendungen buchen den Bestand als Entnahme aus.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportFaktura, fakturaFlaschen, fakturaRechnungstext, musterBuchung, steuerfallLabel } from '../../src/lib/export/fakturierung.ts'
import { BEFREIUNG_AUSFUHR, BEFREIUNG_IGL } from '../../src/lib/export/rechnungTexte.ts'
import { exportBearbeitbar } from '../../src/lib/export/auftragEingabe.ts'

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
const auftrag = (teil = {}) => ({ id: 'a1', referenz: 'EX-0007', status: 'bestaetigt', storniert_am: null, mustersendung: false, verkaufsposten_id: null,
  muster_ausgebucht_am: null, kontakt_id: null, firma_id: 'f1', destination_land: 'DE', kunde_uid: 'DE123456789', fracht_eur: null, versicherung_eur: null, ...teil })
const pos = (teil = {}) => ({ fullung_id: F, beschreibung: 'Zierfandler 2025', menge: 30, einheit: 'Fl', preis_eur: 9.5, flaschen_je_karton: 6, fuellungName: 'Zierfandler', ...teil })

describe('KAN-436: Rechnung aus dem Exportauftrag – Regeln', () => {
  test('Flaschenware in die EU mit UID: Verkaufspositionen, Steuerfall, UID und Land', () => {
    const f = exportFaktura(auftrag(), [pos()], 6)
    assert.deepEqual(f.fehler, [])
    assert.deepEqual(f.positionen, [{ typ: 'flasche', fuellung_id: F, name: 'Zierfandler 2025', menge: 30, einheit: 'Stk', preis_brutto: 9.5, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 0 }])
    assert.deepEqual([f.steuerfall, f.kundeUid, f.lieferland, f.firmaId, f.kontaktId, f.betrag], ['igl', 'DE123456789', 'DE', 'f1', null, 285])
  })
  test('Drittland = Ausfuhr, auch ohne UID', () => {
    const f = exportFaktura(auftrag({ destination_land: 'US', kunde_uid: null }), [pos()], 6)
    assert.deepEqual([f.fehler.length, f.steuerfall, f.kundeUid, f.lieferland], [0, 'ausfuhr', null, 'US'])
  })
  test('Kiste wird in Flaschen umgerechnet, der Zeilenwert bleibt', () => {
    const f = exportFaktura(auftrag(), [pos({ menge: 5, einheit: 'Kiste', preis_eur: 57 })], 6)
    assert.deepEqual(f.fehler, [])
    assert.deepEqual([f.positionen[0].menge, f.positionen[0].preis_brutto, f.betrag], [30, 9.5, 285])
    // Kartongröße der Position schlägt den Standard des Betriebs; ohne Angabe gilt der Standard
    assert.equal(fakturaFlaschen({ menge: 2, einheit: 'Kiste', flaschen_je_karton: 12 }, 6), 24)
    assert.equal(fakturaFlaschen({ menge: 2, einheit: 'Kiste', flaschen_je_karton: null }, 6), 12)
    assert.equal(fakturaFlaschen({ menge: 2, einheit: 'Kiste', flaschen_je_karton: null }, null), null)
    assert.equal(fakturaFlaschen({ menge: 2, einheit: 'HL' }, 6), null)
  })
  test('Preis je Kiste, der nicht auf Flaschen aufgeht: Meldung statt gerundetem Vorschlag', () => {
    const f = exportFaktura(auftrag(), [pos({ menge: 7, einheit: 'Kiste', preis_eur: 10.01, flaschen_je_karton: 6 })], 6)
    // 10,01 ÷ 6 = 1,6683 je Flasche → 42 × 1,6683 = 70,07; 7 × 10,01 = 70,07 → geht auf
    assert.deepEqual(f.fehler, [])
    // 10,00 ÷ 7 = 1,4286 je Flasche → 7.000 × 1,4286 = 10.000,20 statt 10.000,00
    const g = exportFaktura(auftrag(), [pos({ menge: 1000, einheit: 'Kiste', preis_eur: 10, flaschen_je_karton: 7 })], 6)
    assert.match(g.fehler.join(' '), /Preis je Kiste lässt sich nicht genau auf Flaschen umrechnen/)
    assert.deepEqual(g.positionen, [], 'mit Fehler keine Positionen')
  })
  test('Fracht und Versicherung als eigene Positionen (6A) – Betrag wie die Handelsrechnung', () => {
    const f = exportFaktura(auftrag({ fracht_eur: 120, versicherung_eur: '30' }), [pos()], 6)
    assert.deepEqual(f.positionen.slice(1).map(p => [p.typ, p.name, p.menge, p.preis_brutto, p.ust_satz]),
      [['sonstiges', 'Fracht / Freight', 1, 120, 0], ['sonstiges', 'Versicherung / Insurance', 1, 30, 0]])
    assert.equal(f.betrag, 435)
    assert.equal(exportFaktura(auftrag({ fracht_eur: 0 }), [pos()], 6).positionen.length, 1, '0 € ergibt keine Position')
  })
  test('keine Rechnung: nicht steuerfrei (3A), Mustersendung (4A), lose Ware (5A), Entwurf, schon verrechnet, storniert', () => {
    const fehler = (a, p = [pos()]) => exportFaktura(a, p, 6).fehler.join(' | ')
    assert.match(fehler(auftrag({ kunde_uid: '' })), /Nicht steuerfrei \(EU-Lieferung ohne UID des Kunden\) – bitte als normalen Verkauf erfassen/)
    assert.match(fehler(auftrag({ destination_land: 'AT' })), /Nicht steuerfrei \(Lieferung im Inland\)/)
    assert.match(fehler(auftrag({ destination_land: '' })), /Das Bestimmungsland fehlt/)
    assert.match(fehler(auftrag({ mustersendung: true })), /Mustersendung – keine Rechnung/)
    assert.match(fehler(auftrag(), [pos({ einheit: 'HL', menge: 2 })]), /Position 1 ist lose Ware \(HL\)/)
    assert.match(fehler(auftrag(), [pos({ fullung_id: null })]), /Position 1 hat keine Füllung/)
    assert.match(fehler(auftrag(), [pos({ menge: 2.5 })]), /keine ganze Zahl Flaschen/)
    assert.match(fehler(auftrag({ status: 'entwurf' })), /erst ab dem Status „Bestätigt“/)
    assert.match(fehler(auftrag({ verkaufsposten_id: 'v1' })), /schon eine Rechnung/)
    assert.match(fehler(auftrag({ storniert_am: '2026-11-12' })), /storniert/)
    assert.match(fehler(auftrag({ firma_id: null })), /Importeur fehlt/)
    assert.match(fehler(auftrag(), []), /keine Positionen/)
    assert.equal(fehler(auftrag({ status: 'versendet' })), '', 'auch ein versendeter Auftrag bekommt noch seine Rechnung')
  })
  test('Text auf der Rechnung: Befreiung, UID des Kunden, Exportauftrag', () => {
    assert.equal(fakturaRechnungstext({ steuerfall: 'igl', kundeUid: 'DE123456789' }, 'EX-0007'),
      `${BEFREIUNG_IGL}\nUID des Kunden / Customer VAT No.: DE123456789\nExportauftrag / Export order: EX-0007`)
    assert.equal(fakturaRechnungstext({ steuerfall: 'ausfuhr', kundeUid: null }, 'EX-0008'), `${BEFREIUNG_AUSFUHR}\nExportauftrag / Export order: EX-0008`)
    assert.ok(fakturaRechnungstext({ steuerfall: 'igl', kundeUid: 'X'.repeat(20) }, 'EX-0007').length < 1000, 'passt in den Rechnungstext (1.000 Zeichen)')
    assert.deepEqual([steuerfallLabel('igl'), steuerfallLabel('ausfuhr'), steuerfallLabel(null)], ['Innergemeinschaftliche Lieferung', 'Ausfuhrlieferung', null])
  })
})

describe('KAN-436: Mustersendung', () => {
  test('Flaschen je Auftrag; nur mit Kennzeichen, ab Bestätigt, ohne lose Ware', () => {
    const m = auftrag({ mustersendung: true })
    assert.deepEqual(musterBuchung(m, [pos({ menge: 6 }), pos({ menge: 2, einheit: 'Kiste', flaschen_je_karton: 3 })], 6), { fehler: [], flaschen: 12 })
    const fehler = (a, p = [pos()]) => musterBuchung(a, p, 6).fehler.join(' | ')
    assert.match(fehler(auftrag()), /nicht als Mustersendung gekennzeichnet/)
    assert.match(fehler(auftrag({ mustersendung: true, status: 'entwurf' })), /erst ab dem Status „Bestätigt“/)
    assert.match(fehler(auftrag({ mustersendung: true, muster_ausgebucht_am: '2026-11-12' })), /schon ausgebucht/)
    assert.match(fehler(m, [pos({ einheit: 'HL' })]), /keine lose Ware/)
    assert.match(fehler(m, [pos({ fullung_id: null })]), /nur mit Füllung/)
    assert.equal(musterBuchung(m, [pos({ einheit: 'HL' })], 6).flaschen, 0)
  })
})

describe('KAN-436: Sperre', () => {
  test('mit Rechnung bzw. ausgebuchtem Muster nicht mehr bearbeitbar', () => {
    assert.equal(exportBearbeitbar({ status: 'bestaetigt' }), true)
    assert.equal(exportBearbeitbar({ status: 'bestaetigt', verkaufsposten_id: 'v1' }), false)
    assert.equal(exportBearbeitbar({ status: 'bestaetigt', muster_ausgebucht_am: '2026-11-12' }), false)
    assert.equal(exportBearbeitbar({ status: 'versendet' }), false)
  })
  test('Migration: Freeze mit Rechnung/Muster, Schutz der Verknüpfung, Storno-Sperre, Rückweg über das Storno des Verkaufs', () => {
    const m = migration('kan436a_export_rechnung')
    assert.match(m, /o\.storniert_am IS NULL AND \(o\.status IN \(''versendet'', ''abgeschlossen''\) OR o\.verkaufsposten_id IS NOT NULL OR o\.muster_ausgebucht_am IS NOT NULL\)/)
    assert.match(m, /storno_grund,verkaufsposten_id,muster_ausgebucht_am',/, 'die beiden Spalten schützt der eigene Trigger')
    assert.match(m, /CREATE UNIQUE INDEX exportauftraege_verkaufsposten_idx ON public\.exportauftraege \(verkaufsposten_id\) WHERE verkaufsposten_id IS NOT NULL;/)
    assert.match(m, /CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public\.exportauftraege/)
    assert.match(m, /ADD CONSTRAINT verkaufsposten_igl_uid_chk CHECK \(steuerfall IS DISTINCT FROM 'igl' OR kunde_uid IS NOT NULL\)/)
    assert.match(m, /IF OLD\.verkaufsposten_id IS NOT NULL AND NOT v_frei THEN\s+RAISE EXCEPTION 'Die Rechnung zum Exportauftrag löst sich nur über das Storno der Rechnung\.'/)
    assert.match(m, /bitte zuerst die Rechnung stornieren\.' USING ERRCODE = '23514', HINT = 'export_rechnung'/)
    assert.match(m, /CREATE TRIGGER z_export_rechnung_storno AFTER UPDATE OF storniert ON public\.verkaufsposten\s+FOR EACH ROW WHEN \(NEW\.storniert IS TRUE AND OLD\.storniert IS DISTINCT FROM TRUE\)/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_export_rechnung_schutz\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(m, /REVOKE EXECUTE ON FUNCTION public\.s112_export_rechnung_storno\(\) FROM PUBLIC, anon, authenticated;/)
    // Muster-RPC: Reihenfolge der Prüfungen wie in CLAUDE.md, Buchung über die bestehende Bestandsfunktion
    const rpc = m.slice(m.indexOf('CREATE FUNCTION public.s112_export_muster_buchen'))
    const stellen = ['public.pruefe_tenant_zugriff(p_tenant_id', 'public.s112_pruefe_abo_schreibsperre(p_tenant_id)', "public.s112_pruefe_paketmodul(p_tenant_id, 'modul_export')", "public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft')"].map(s => rpc.indexOf(s))
    assert.ok(stellen.every((s, i) => s > 0 && (i === 0 || s > stellen[i - 1])), 'Zugriff → Abo → Paket-Modul → Schreibmodul')
    assert.match(rpc, /PERFORM public\.fuellung_bestand_buchen\(p_tenant_id, r\.fuellung_id, 'eigenverbrauch', p_datum, -r\.flaschen, NULL,/)
    assert.match(rpc, /REVOKE EXECUTE ON FUNCTION public\.s112_export_muster_buchen\(uuid, uuid, date, boolean\) FROM PUBLIC, anon;/)
    assert.match(migration('kan436b_export_schutz_reihenfolge'), /ALTER TRIGGER a_export_rechnung_schutz ON public\.exportauftraege RENAME TO zz_export_rechnung_schutz;/)
  })
})

describe('KAN-436: Verdrahtung', () => {
  const v = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  test('createVerkauf rechnet den Exportauftrag selbst nach und vergleicht mit der Eingabe', () => {
    const teil = v.slice(v.indexOf("const exportId = auftragIdAus(formData.get('export_id'))"), v.indexOf('// ── Prüfung VOR dem ersten Schreibzugriff'))
    assert.ok(teil.length > 400)
    assert.match(teil, /const ex = await ladeExportFaktura\(supabase, tenantId, exportId\)/)
    assert.match(teil, /if \(ex\.faktura\.fehler\.length > 0\) return \{ error: /)
    assert.match(teil, /JSON\.stringify\(ex\.faktura\.positionen\) !== JSON\.stringify\(positionen\)/)
    assert.match(teil, /ex\.faktura\.kontaktId !== kontaktId \|\| ex\.faktura\.firmaId !== firmaId/)
    assert.match(teil, /if \(rechnungSpaeter\) return \{ error: /)
    assert.ok(v.indexOf("const exportId = auftragIdAus(formData.get('export_id'))") < v.indexOf('bestandBuchenAllesOderNichts(supabase'), 'vor der Abbuchung')
  })
  test('Steuerfall am Verkauf, Verknüpfung nur ohne bestehende Rechnung, sonst Abbruch mit Storno des Belegs', () => {
    assert.match(v, /\.\.\.\(exportFall \? \{ steuerfall: exportFall\.steuerfall, kunde_uid: exportFall\.kundeUid, lieferland: exportFall\.lieferland \} : \{\}\),/)
    assert.match(v, /\.update\(\{ verkaufsposten_id: postenId \}\)\.eq\('id', exportId\)\.eq\('tenant_id', tenantId\)\.is\('verkaufsposten_id', null\)\.select\('id'\)/)
    assert.match(v, /if \(!verkn \|\| \(verkn as AR\[\]\)\.length === 0\) await abbruch\(/)
    assert.ok(v.indexOf(".update({ verkaufsposten_id: postenId })") > v.indexOf("(supabase.from('verkauf_positionen') as any).insert(posInserts)"), 'erst der vollständige Beleg, dann die Verknüpfung')
  })
  test('Action „Rechnung stellen“ nutzt createVerkauf mit den berechneten Werten; Muster über die RPC', () => {
    const a = quelle('src/app/(dashboard)/weinexport/[id]/actions.ts')
    const teil = a.slice(a.indexOf('export async function exportRechnungStellen'), a.indexOf('export async function exportMusterBuchen'))
    assert.match(teil, /const tenantId = await exportSchreibrecht\(\)/)
    assert.match(teil, /fd\.set\('export_id', id\)/)
    assert.match(teil, /fd\.set\('positionen_json', JSON\.stringify\(ex\.faktura\.positionen\)\)/)
    assert.match(teil, /fd\.set\('rechnungstext', fakturaRechnungstext\(ex\.faktura, referenz\)\)/)
    assert.match(teil, /fd\.set\('datum', heuteWien\(\)\)/)
    assert.match(teil, /const erg = await createVerkauf\(fd\)/)
    assert.match(a, /\('s112_export_muster_buchen', \{\s+p_tenant_id: tenantId, p_auftrag_id: id, p_datum: heuteWien\(\), p_zurueck: zurueck,/)
  })
  test('Doppelzählung: Journal und Rückruf lesen einen Exportauftrag mit Verkauf nicht noch einmal', () => {
    assert.match(quelle('src/lib/behoerden/rechnungsausgang.ts'), /\.eq\('export_dokumente\.status', 'ausgestellt'\)\s+\.is\('verkaufsposten_id', null\)/)
    assert.match(quelle('src/lib/behoerden/rueckruf.ts'), /\.is\('auftrag\.storniert_am', null\)\s+\.is\('auftrag\.verkaufsposten_id', null\)/)
  })
  test('Handelsrechnung druckt die Rechnungsnummer der Fakturierung, die Proforma nicht', () => {
    const r = quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts')
    assert.match(r, /\.select\('rechnungsnummer, datum'\)\.eq\('id', a\.verkaufsposten_id\)\.eq\('tenant_id', tenantId\)\.maybeSingle\(\)/)
    assert.match(r, /\$\{e\(\(proforma \? null : rechnungNr\) \?\? a\.referenz \?\? '–'\)\}/)
    assert.match(r, /Exportauftrag \/ Export order: \$\{e\(a\.referenz \?\? '–'\)\}/)
  })
  test('Seite, Panel, Schema und Fremdschlüssel', () => {
    const p = quelle('src/app/(dashboard)/weinexport/[id]/page.tsx')
    assert.match(p, /const fk = await ladeExportFaktura\(supabase, tenantId, id\)/)
    assert.match(p, /<ExportRechnungPanel id=\{id\}/)
    const c = quelle('src/app/(dashboard)/weinexport/[id]/ExportRechnungPanel.tsx')
    assert.match(c, /await rueckfrage\(\{\s+titel: `Rechnung zum Exportauftrag \$\{referenz\} stellen\?`/)
    assert.doesNotMatch(c, /window\.confirm|\bconfirm\(/)
    assert.match(c, /finally \{\s+setLaeuft\(false\)/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['verkaufsposten_id', 'muster_ausgebucht_am']) assert.ok(schema.exportauftraege.includes(s), s)
    for (const s of ['steuerfall', 'kunde_uid', 'lieferland']) assert.ok(schema.verkaufsposten.includes(s), s)
    const fks = JSON.parse(quelle('scripts/fremdschluessel.json'))
    assert.ok(fks.some(f => f.n === 'exportauftraege_verkaufsposten_fkey' && f.t === 'exportauftraege' && f.z === 'verkaufsposten'))
  })
})
