// KAN-435 D2 (13.11.2026): Weinexport D – Verbrauchsteuer-Angaben an Exportauftrag und Betrieb.
// Befund (KAN-417): Am Auftrag gab es nur ARC-Nummer und EMCS-Status, im Betrieb keine Verbrauchsteuernummer – die
// frühere e-AD-Datei schrieb an deren Stelle die UID. Neu, alles freiwillig: Verfahren, MVV-Code, Nummer des
// Begleitdokuments, Verbrauchsteuernummer des Empfängers (Auftrag) und des Betriebs (Einstellungen).
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VST_VERFAHREN, VST_VERFAHREN_HINWEIS, istVstVerfahren, vstVerfahrenLabel, vstNummerBereinigt, vstNummerFehler,
  verbrauchsteuerFehler, verbrauchsteuerWerte, vstVerfahrenHinweis,
} from '../../src/lib/export/verbrauchsteuer.ts'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

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

hooksRegistrieren()

describe('KAN-435 D2: Regeln', () => {
  test('Verfahren: zwei Werte, sonst nichts', () => {
    assert.deepEqual(Object.keys(VST_VERFAHREN), ['aussetzung', 'freier_verkehr'])
    assert.equal(istVstVerfahren('aussetzung'), true)
    assert.equal(istVstVerfahren('toString'), false)
    assert.equal(istVstVerfahren(''), false)
    assert.equal(vstVerfahrenLabel('freier_verkehr'), 'Steuerrechtlich freier Verkehr')
    assert.equal(vstVerfahrenLabel(null), '')
  })
  test('Verbrauchsteuernummer: Leerzeichen weg, Großbuchstaben; nur Buchstaben und Ziffern, höchstens 20', () => {
    assert.equal(vstNummerBereinigt(' at 1234 5678 901 '), 'AT12345678901')
    assert.equal(vstNummerFehler('AT 12345678901', 'des Betriebs'), null)
    assert.equal(vstNummerFehler('', 'des Betriebs'), null)
    assert.equal(vstNummerFehler(null, 'des Betriebs'), null)
    assert.match(vstNummerFehler('AT-123/45', 'des Empfängers'), /des Empfängers darf nur Buchstaben und Ziffern/)
    assert.match(vstNummerFehler('A'.repeat(21), 'des Betriebs'), /höchstens 20 Zeichen/)
    assert.match(vstNummerFehler(42, 'des Betriebs'), /ungültig/)
  })
  test('Eingabeprüfung nur für übergebene Felder; Grenzen wie die CHECKs', () => {
    assert.equal(verbrauchsteuerFehler({}), null)
    assert.equal(verbrauchsteuerFehler({ verbrauchsteuer_verfahren: null, mvv_code: null, begleitdokument_nr: '', empfaenger_verbrauchsteuernr: null }), null)
    assert.equal(verbrauchsteuerFehler({ verbrauchsteuer_verfahren: 'aussetzung', mvv_code: 'AT-MVV-2026-000123', begleitdokument_nr: 'BD 17/2026', empfaenger_verbrauchsteuernr: 'DE12345678901' }), null)
    assert.match(verbrauchsteuerFehler({ verbrauchsteuer_verfahren: 'irgendwas' }), /gültiges Verbrauchsteuerverfahren/)
    assert.match(verbrauchsteuerFehler({ mvv_code: 'X'.repeat(41) }), /MVV-Code darf höchstens 40/)
    assert.match(verbrauchsteuerFehler({ begleitdokument_nr: 'X'.repeat(41) }), /Nummer des Begleitdokuments darf höchstens 40/)
    assert.match(verbrauchsteuerFehler({ mvv_code: 12 }), /MVV-Code ist ungültig/)
    assert.match(verbrauchsteuerFehler({ empfaenger_verbrauchsteuernr: 'DE 12 34!' }), /des Empfängers/)
  })
  test('Werte für die Datenbank: leer → null, Nummer bereinigt, nichts außer den übergebenen Feldern', () => {
    assert.deepEqual(verbrauchsteuerWerte({ verbrauchsteuer_verfahren: '', mvv_code: '  ', begleitdokument_nr: ' BD 1 ', empfaenger_verbrauchsteuernr: 'de 123' }),
      { verbrauchsteuer_verfahren: null, mvv_code: null, begleitdokument_nr: 'BD 1', empfaenger_verbrauchsteuernr: 'DE123' })
    assert.deepEqual(verbrauchsteuerWerte({ mvv_code: 'M1' }), { mvv_code: 'M1' })
    assert.deepEqual(verbrauchsteuerWerte({}), {})
  })
  test('Hinweis nur beim EU-Auftrag ohne Verfahren; storniert, Drittland und Inland ohne Hinweis', () => {
    assert.equal(vstVerfahrenHinweis({}, 'eu'), VST_VERFAHREN_HINWEIS)
    assert.equal(vstVerfahrenHinweis({ verbrauchsteuer_verfahren: 'freier_verkehr' }, 'eu'), null)
    assert.equal(vstVerfahrenHinweis({ storniert_am: '2026-11-13T10:00:00Z' }, 'eu'), null)
    assert.equal(vstVerfahrenHinweis({}, 'drittland'), null)
    assert.equal(vstVerfahrenHinweis({}, 'inland'), null)
    assert.equal(vstVerfahrenHinweis({}, null), null)
  })
})

describe('KAN-435 D2: Datenblatt mit den neuen Angaben', nurMitHooks, () => {
  test('Verbrauchsteuernummern, Verfahren, MVV-Code und Nummer des Begleitdokuments in Kopf und CSV', async () => {
    const { datenblattKopf, SPALTEN_EMCS_DATENBLATT } = await laden('lib/behoerden/emcsDatenblatt.ts')
    const kopf = datenblattKopf(
      { referenz: 'EX-1', verbrauchsteuer_verfahren: 'aussetzung', mvv_code: 'MVV-1', begleitdokument_nr: 'BD-1', empfaenger_verbrauchsteuernr: 'DE12345678901', kunde_uid: 'DE123456789' },
      { betrieb_uid: 'ATU12345678', betrieb_verbrauchsteuernr: 'AT12345678901' }, 'EU · B2B')
    assert.equal(kopf.versenderVerbrauchsteuernr, 'AT12345678901')
    assert.notEqual(kopf.versenderVerbrauchsteuernr, kopf.versenderUid, 'die UID steht nicht mehr an der Stelle der Verbrauchsteuernummer')
    assert.equal(kopf.empfaengerVerbrauchsteuernr, 'DE12345678901')
    assert.equal(kopf.verfahren, 'Unter Steueraussetzung (e-VD in EMCS)')
    assert.equal(kopf.mvvCode, 'MVV-1')
    assert.equal(kopf.begleitdokumentNr, 'BD-1')
    const koepfe = SPALTEN_EMCS_DATENBLATT.map(s => s.kopf)
    for (const k of ['Verbrauchsteuernummer Versender', 'Verbrauchsteuernummer Empfänger', 'Verbrauchsteuerverfahren', 'MVV-Code', 'Begleitdokument-Nr.']) assert.ok(koepfe.includes(k), k)
    // ohne Angaben: leer, kein Platzhalter
    const leer = datenblattKopf({ referenz: 'EX-2' }, { betrieb_uid: 'ATU12345678' }, null)
    assert.equal(leer.versenderVerbrauchsteuernr, null)
    assert.equal(leer.verfahren, null)
  })
  test('„fehlt noch“: die Nummern nur bei einem EU-Auftrag', () => {
    const l = quelle('src/lib/behoerden/emcsDatenblatt.ts')
    assert.match(l, /if \(erg\.grunddaten\.lieferfall\.gebiet === 'eu'\) \{\n\s+if \(!kopf\.versenderVerbrauchsteuernr\) fehlt\.push\('Verbrauchsteuernummer des Betriebs fehlt/)
    assert.match(l, /\.select\('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, betrieb_verbrauchsteuernr'\)/)
  })
})

describe('KAN-435 D2: Verdrahtung', () => {
  test('PATCH: Felder in der Positivliste, geprüft, nur bereinigte Werte', () => {
    const r = quelle('src/app/api/weinexport/[id]/route.ts')
    assert.match(r, /'laender_belege',\n  'verbrauchsteuer_verfahren', 'mvv_code', 'begleitdokument_nr', 'empfaenger_verbrauchsteuernr'\] as const/)
    assert.match(r, /const vf = verbrauchsteuerFehler\(vst\)\n\s+if \(vf\) return fehler\(vf, 400\)\n\s+Object\.assign\(update, verbrauchsteuerWerte\(vst\)\)/)
    assert.match(r, /\.update\(update\)\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.select\('id'\)/)
  })
  test('Kasten am Auftrag: dieselbe Prüfung wie der Server, Ladezustand im finally, gesperrt nach Abschluss bzw. Storno', () => {
    const p = quelle('src/app/(dashboard)/weinexport/[id]/EmcsPanel.tsx')
    assert.match(p, /const f = verbrauchsteuerFehler\(eingabe\)\n\s+if \(f\) \{ setFehler\(f\); return \}/)
    assert.match(p, /\} finally \{\n\s+setSaving\(false\)/)
    assert.match(p, /if \(!res\.ok\) \{ setFehler\(/)
    assert.match(p, /\{aenderbar && \(\n\s+<button type="button"/)
    assert.doesNotMatch(p, /text-white/)
    const c = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
    assert.match(c, /aenderbar=\{darfSchreiben && status !== 'abgeschlossen' && !auftrag\.storniert_am\} \/>/)
  })
  test('Hinweisliste und CSV der Auftragsliste', () => {
    const e = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.match(e, /\.\.\.\[vstVerfahrenHinweis\(auftrag, lieferfall\(auftrag\)\.gebiet\)\]\.filter\(/)
    assert.match(e, /\{ kopf: 'Verbrauchsteuerverfahren', typ: 'text', wert: z => z\.vstVerfahren \},\n\s+\{ kopf: 'MVV-Code', typ: 'code', wert: z => z\.mvvCode \},\n\s+\{ kopf: 'Begleitdokument-Nr\.', typ: 'code', wert: z => z\.begleitdokumentNr \},/)
    assert.match(e, /laender_belege, verbrauchsteuer_verfahren, mvv_code, begleitdokument_nr, kontakte\(/)
  })
  test('Betriebseinstellungen: Feld, Prüfung vor dem Speichern, Schreiben per Service-Role (kein Spaltenrecht zum Ändern)', () => {
    const a = quelle('src/app/(dashboard)/betrieb/einstellungen/actions.ts')
    assert.match(a, /const vstFehler = vstNummerFehler\(formData\.get\('betrieb_verbrauchsteuernr'\), 'des Betriebs'\)\n\s+if \(vstFehler\) return \{ error: vstFehler \}/)
    assert.match(a, /betrieb_verbrauchsteuernr: vstNummerBereinigt\(formData\.get\('betrieb_verbrauchsteuernr'\)\) \|\| null,/)
    assert.match(quelle('src/app/(dashboard)/betrieb/einstellungen/EinstellungenClient.tsx'), /name="betrieb_verbrauchsteuernr"/)
    assert.match(quelle('src/app/(dashboard)/betrieb/einstellungen/page.tsx'), /betrieb_ea_bewilligung, betrieb_verbrauchsteuernr, kleiner_weinerzeuger,/)
  })
  test('altes Muster druckt die Nummer des Begleitdokuments – über escHtml', () => {
    assert.match(quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts'), /Begleitdokument-Nr\.<\/div><div class="value">\$\{e\(a\.begleitdokument_nr \?\? ''\)\}&nbsp;<\/div>/)
  })
  test('Migration: Spalten mit Grenzen, Leserecht ohne Schreibrecht, Sperrliste, Schutz nach „Abgeschlossen“, Trigger-Spalten', () => {
    const m = migration('kan435a_export_verbrauchsteuer')
    assert.match(m, /CHECK \(verbrauchsteuer_verfahren IS NULL OR verbrauchsteuer_verfahren IN \('aussetzung', 'freier_verkehr'\)\)/)
    for (const [s, max] of [['mvv_code', 40], ['begleitdokument_nr', 40], ['empfaenger_verbrauchsteuernr', 20], ['betrieb_verbrauchsteuernr', 20]]) {
      assert.ok(m.includes(`CHECK (${s} IS NULL OR char_length(${s}) BETWEEN 1 AND ${max})`), s)
    }
    assert.match(m, /GRANT SELECT \(betrieb_verbrauchsteuernr\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    assert.doesNotMatch(m, /GRANT UPDATE/)
    assert.match(m, /laender_belege,verbrauchsteuer_verfahren,mvv_code,begleitdokument_nr,empfaenger_verbrauchsteuernr',/)
    assert.match(m, /Angaben zu Verbrauchsteuer und Begleitdokument lassen sich nicht mehr ändern/)
    assert.match(m, /Ankerstelle nicht genau einmal gefunden/)
    assert.match(m, /laender_belege,\n\s+verbrauchsteuer_verfahren, mvv_code, begleitdokument_nr, empfaenger_verbrauchsteuernr ON public\.exportauftraege/)
    const schema = JSON.parse(quelle('scripts/schema.json'))
    for (const s of ['verbrauchsteuer_verfahren', 'mvv_code', 'begleitdokument_nr', 'empfaenger_verbrauchsteuernr']) assert.ok(schema.exportauftraege.includes(s), s)
    assert.ok(schema.tenant_einstellungen.includes('betrieb_verbrauchsteuernr'))
  })
  test('DB-Test 06 prüft Ändern, Grenzen und die Sperre nach „Abgeschlossen“ (mit Mutation)', () => {
    const t = quelle('scripts/db-tests/06_export_workflow.sql')
    for (const n of ["'verbrauchsteuer'", "'verbrauchsteuer_verfahren_falsch'", "'verbrauchsteuer_zu_lang'", "'verbrauchsteuer_gesperrt'"]) assert.ok(t.includes(`s112_erwarte(${n},`), n)
    assert.match(t, /@mutation verbrauchsteuer_nach_abschluss: .* \| rot: verbrauchsteuer_gesperrt/)
  })
  test('Handbuch nennt den Kasten und die Betriebseinstellung', () => {
    const h = quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(h, /Kasten „Verbrauchsteuer und Begleitdokument“/)
    assert.match(h, /Verbrauchsteuernummer \(ATV\/SEED\) hinterlegst du unter Betrieb › Einstellungen/)
  })
})
