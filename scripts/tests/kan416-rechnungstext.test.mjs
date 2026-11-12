// KAN-416 Punkt 1 (11.11.2026) – „Text auf Rechnung“ und „Interne Notiz“ am Lieferschein: nachträglich änderbar, der Text
// auf Rechnung nur, bis die Rechnung erstellt ist; er wird auf der Rechnung gedruckt (bei Sammelrechnungen je Lieferschein).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m = () => laden('lib/verkauf/rechnungstext.ts')

describe('KAN-416: Regeln', nurMitHooks, () => {
  test('Text säubern: Ränder weg, Zeilenenden vereinheitlicht, leer → null', async () => {
    const { textOderNull } = await m()
    assert.equal(textOderNull('  Bestellung 4711 \r\nfrei Haus  '), 'Bestellung 4711 \nfrei Haus')
    assert.equal(textOderNull('   '), null)
    assert.equal(textOderNull(null), null)
  })
  test('Längen: Text auf Rechnung bis 1.000, interne Notiz bis 2.000 Zeichen', async () => {
    const { rechnungstextFehler, notizFehler, RECHNUNGSTEXT_MAX, NOTIZ_MAX } = await m()
    assert.equal(rechnungstextFehler('x'.repeat(RECHNUNGSTEXT_MAX)), null)
    assert.match(rechnungstextFehler('x'.repeat(RECHNUNGSTEXT_MAX + 1)), /höchstens 1\.000 Zeichen haben \(derzeit 1001\)/)
    assert.equal(rechnungstextFehler(''), null)
    assert.equal(notizFehler('x'.repeat(NOTIZ_MAX)), null)
    assert.match(notizFehler('x'.repeat(NOTIZ_MAX + 1)), /höchstens 2\.000 Zeichen/)
  })
  test('änderbar nur ohne Rechnung und nie bei Storno', async () => {
    const { rechnungstextAenderbar } = await m()
    assert.equal(rechnungstextAenderbar({ rechnung_id: null }), true)
    assert.equal(rechnungstextAenderbar({ rechnung_id: 'r1' }), false)
    assert.equal(rechnungstextAenderbar({ rechnung_id: null, storniert: true }), false)
    assert.equal(rechnungstextAenderbar({ berechnet: true }), false)
  })
  test('Texte für die Rechnung: einzeln ohne Nummer, Sammelrechnung je Lieferschein mit Nummer, leere fallen weg', async () => {
    const { rechnungstexteFuerBeleg } = await m()
    assert.deepEqual(rechnungstexteFuerBeleg([{ lieferscheinnummer: 'LS-2026-0007', rechnungstext: ' Bestellung 4711 ' }]), ['Bestellung 4711'])
    assert.deepEqual(rechnungstexteFuerBeleg([{ lieferscheinnummer: 'LS-2026-0007', rechnungstext: null }]), [])
    assert.deepEqual(rechnungstexteFuerBeleg([
      { lieferscheinnummer: 'LS-2026-0007', rechnungstext: 'Bestellung 4711' },
      { lieferscheinnummer: 'LS-2026-0008', rechnungstext: '' },
      { lieferscheinnummer: 'LS-2026-0009', rechnungstext: 'Messe Wien' },
    ]), ['Lieferschein LS-2026-0007: Bestellung 4711', 'Lieferschein LS-2026-0009: Messe Wien'])
    assert.deepEqual(rechnungstexteFuerBeleg([]), [])
  })
})

describe('KAN-416: Wege und Absicherung', () => {
  test('Server Action: Rechte, Storno abgelehnt, Text nur ohne Rechnung, Trefferprüfung', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    const f = a.slice(a.indexOf('export async function speichereVerkaufTexte'), a.indexOf('export async function deactivateVerkauf'))
    assert.ok(f.length > 200)
    assert.ok(f.indexOf('await getMembership()') < f.indexOf("canWrite(membership, 'warenwirtschaft')"))   // Seitenbetrieb/Schreibsperre vor dem Recht
    assert.match(f, /if \(alt\.storniert\) return \{ error:/)
    assert.match(f, /rechnungstextAenderbar\(\{ rechnung_id: alt\.rechnung_id as string \| null \}\)/)
    assert.match(f, /\.update\(werte\)\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.select\('id'\)/)
    assert.match(f, /NICHT_GESPEICHERT/)
    assert.match(a, /rechnungstext,\n/)   // createVerkauf speichert den Text
  })
  test('Formulare: neuer Verkauf mit beiden Feldern, Lieferschein mit nachträglichem Ändern', () => {
    const n = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
    assert.match(n, /aria-label="Text auf Rechnung"/)
    assert.match(n, /aria-label="Interne Notiz"/)
    assert.match(n, /formData\.set\('rechnungstext',\s+rechnungstext\)/)
    const d = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(d, /<LieferscheinTexte /)
    assert.match(d, /textAenderbar=\{rechnungstextAenderbar\(\{ rechnung_id: posten\.rechnung_id \?\? null, storniert: posten\.storniert \}\)\}/)
    const k = quelle('src/components/handel/LieferscheinTexte.tsx')
    assert.match(k, /disabled=\{!textAenderbar \|\| pending\}/)
    assert.match(k, /if \(textAenderbar\) fd\.set\('rechnungstext', t\)/)
  })
  test('Rechnung: PDF druckt die Texte je Lieferschein', () => {
    const r = quelle('src/app/api/weinhandel/verkauf/[id]/send/route.ts')
    assert.match(r, /\.select\(`id, lieferscheinnummer, datum, rechnungstext, positionen:verkauf_positionen\(/)
    assert.match(r, /rechnungstexte: rechnungstexteFuerBeleg\(lieferscheine\)/)
    const p = quelle('src/lib/pdf/verkaufRechnungPdf.tsx')
    assert.match(p, /\(props\.rechnungstexte \?\? \[\]\)\.map\(/)
    assert.ok(p.indexOf('props.rechnungstexte') < p.indexOf('{fusstext && <Text'), 'Texte vor dem Fußtext')
  })
  test('Migration: Spalte mit CHECK, Schutz-Trigger nur auf rechnungstext, Funktion nicht aufrufbar', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const datei = readdirSync(dir).find(x => /kan416_rechnungstext\.sql$/.test(x))
    const entwurf = new URL('../../supabase/entwurf/kan416_rechnungstext.sql', import.meta.url)
    if (!datei && !existsSync(entwurf)) return   // Entwurfsordner ist nicht eingecheckt
    const sql = (datei ? readFileSync(new URL(datei, dir), 'utf8') : readFileSync(entwurf, 'utf8')).replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN rechnungstext text\n\s+CONSTRAINT verkaufsposten_rechnungstext_chk CHECK \(rechnungstext IS NULL OR char_length\(rechnungstext\) <= 1000\)/)
    assert.match(sql, /SECURITY DEFINER\nSET search_path = public/)
    assert.match(sql, /IF OLD\.rechnung_id IS NOT NULL THEN\n\s+RAISE EXCEPTION[^;]*USING ERRCODE = '42501', HINT = 'rechnungstext'/)
    assert.match(sql, /BEFORE UPDATE OF rechnungstext ON public\.verkaufsposten/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_rechnungstext_schutz\(\) FROM PUBLIC, anon, authenticated;/)
  })
})

// UAT 12.11.2026 (Abnahme 4 und 6 nicht bestanden): Der Text stand nur im Mail-PDF. In der Druckansicht der Rechnung
// fehlte er – die Zeile dafür lag in der Kopfkarte, die im Druck ausgeblendet ist (no-print).
describe('KAN-416: Text auf Rechnung in den Druckansichten', () => {
  const verkauf = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
  const rechnung = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
  test('Rechnung eines Lieferscheins: Text unter den Positionen, nicht in der ausgeblendeten Kopfkarte', () => {
    const positionen = verkauf.slice(verkauf.indexOf('{/* Positionen-Tabelle'), verkauf.indexOf('{/* ── RECHNUNG-FOOTER'))
    assert.ok(positionen.includes('{isRechnung && rechnungstexteFuerBeleg([{ lieferscheinnummer: posten.lieferscheinnummer ?? null, rechnungstext: posten.rechnungstext ?? null }]).map('))
    // der Absatz ist weder nur am Bildschirm noch nur im Druck sichtbar
    const absatz = positionen.split('\n').find(z => z.includes('whitespace-pre-line'))
    assert.ok(absatz && !/no-print|print:hidden|print-only|hidden print:block/.test(absatz), absatz)
    const kopf = verkauf.slice(verkauf.indexOf('<div className="card p-5 no-print">'), verkauf.indexOf('{/* Positionen-Tabelle'))
    assert.ok(!kopf.includes('hidden print:block'), 'tote Druckzeile in der ausgeblendeten Kopfkarte')
  })
  test('Rechnungsseite (auch Sammelrechnung): lädt den Text je Lieferschein und druckt ihn, nicht beim Stornobeleg', () => {
    assert.ok(rechnung.includes("'id, lieferscheinnummer, datum, rechnungstext')}"))
    assert.ok(rechnung.includes('{!storno && rechnungstexteFuerBeleg(r.lieferscheine as'))
  })
  // Entscheidung Jörgen 12.11.2026 (Kommentar im Ticket): die Regel aus KAN-334 bleibt – auf der Detailseite bleiben,
  // aber mit sichtbarer Bestätigung (vorher wurde nur der Knopf blass)
  test('nach „Texte speichern“ bleibt die Seite stehen und bestätigt „Gespeichert.“', () => {
    const k = quelle('src/components/handel/LieferscheinTexte.tsx')
    assert.ok(k.includes('router.replace(hierBleiben(), { scroll: false })'))
    assert.ok(!k.includes('router.push('))
    assert.ok(k.indexOf('if (r && r.error) { setFehler(r.error); return }') < k.indexOf('router.replace(hierBleiben()'))
  })
})
