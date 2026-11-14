// KAN-453 G3a (14.11.2026): Gutschrift per Mail versenden, Versandvermerk, Eintrag in der CRM-Historie.
// Befund: Die Gutschrift (KAN-419) gab es nur als Druckansicht – kein PDF, kein Versand, und in der Historie des Kunden
// stand nichts von ihr. Neu: PDF „Gutschrift – Rechnungskorrektur zu Rechnung …“ über dieselbe Route und denselben
// Mail-Helfer wie der Stornobeleg; Aktivität beim Kunden beim Ausstellen und beim Versand.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gutschriftPdfInhalt, gutschriftAktivitaetBetreff } from '../../src/lib/verkauf/gutschriftPdf.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

const zeile = (name, menge, preis, rest = {}) => ({ position_id: name, lieferscheinnummer: 'LS-1', typ: 'flasche', name, menge, einheit: 'Stk',
  preis_brutto: preis, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 20, frei: false, ruecknahme: false, ...rest })
const gutschrift = zeilen => ({ art: 'gutschrift', rechnungsnummer: 'GS-2026-0001', datum: '2026-11-14', notizen: 'Zwei Flaschen beschädigt',
  gutschrift_positionen: zeilen, gutschrift_zu: { id: 'r1', rechnungsnummer: 'RE-2026-0007', datum: '2026-11-10' } })

describe('KAN-453: Gutschrift als PDF (gutschriftPdfInhalt)', () => {
  test('eigene Zeilen negativ, Summen und Steuer wie die Seite, Bezug auf die Rechnung und Grund', () => {
    const i = gutschriftPdfInhalt(gutschrift([zeile('Grüner Veltliner', 2, 12), zeile('Saft', 1, 11.3, { ust_satz: 13, typ: 'sonstiges' })]))
    assert.equal(i.nummer, 'GS-2026-0001')
    assert.deepEqual(i.bezug, { zuNummer: 'RE-2026-0007', zuDatumIso: '2026-11-10', grund: 'Zwei Flaschen beschädigt' })
    assert.deepEqual(i.positionen.map(p => [p.name, p.menge, p.summe]), [['Grüner Veltliner', -2, -24], ['Saft', -1, -11.3]])
    assert.equal(i.gesamt, -35.3)
    // Netto je Steuersatz wie rechnungSummen() (ungerundet weitergereicht, das PDF rundet bei der Ausgabe)
    assert.deepEqual(Object.fromEntries(Object.entries(i.ustGruppen).map(([s, n]) => [s, Math.round(n * 100) / 100])), { 13: -10, 20: -20 })   // runden-ok: Vergleich im Test auf Cent
    assert.equal(Math.round(i.gesamtNetto * 100), -3000)
    assert.equal(i.positionen[0].abschnitt, null)   // ein Lieferschein: keine Zwischenzeile
  })
  test('Vermerke je Zeile: Ware zurückgenommen (KAN-452), Tankverkauf; Rabatt der Position', () => {
    const i = gutschriftPdfInhalt(gutschrift([
      zeile('Wein', 2, 10, { ruecknahme: true }), zeile('Tankwein', 5, 2, { typ: 'tank', einheit: 'L' }),
      zeile('Kiste', 1, 100, { rabatt_pct: 10, sonderrabatt_pct: 5 })]))
    assert.deepEqual(i.positionen.map(p => p.sub), ['Ware zurückgenommen', 'Tankverkauf', null])
    assert.equal(i.positionen[2].rabattPct, 15)
    assert.equal(Math.round(i.positionen[2].summe * 100), -8550)
  })
  test('mehrere Lieferscheine: Zwischenzeile; freie Zeile (Preisnachlass) „Ohne Lieferschein“', () => {
    const i = gutschriftPdfInhalt(gutschrift([zeile('A', 1, 5), zeile('B', 1, 5, { lieferscheinnummer: 'LS-2' }),
      zeile('Preisnachlass', 1, 3, { position_id: null, lieferscheinnummer: null, typ: 'sonstiges', frei: true })]))
    assert.deepEqual(i.positionen.map(p => p.abschnitt), ['Lieferschein LS-1', 'Lieferschein LS-2', 'Ohne Lieferschein'])
  })
  test('nur Gutschriften mit Rechnung', () => {
    assert.throws(() => gutschriftPdfInhalt({ art: 'storno' }), /Keine Gutschrift/)
    assert.throws(() => gutschriftPdfInhalt({ art: 'gutschrift', gutschrift_positionen: [], gutschrift_zu: null }), /ohne Rechnung/)
  })
  test('PDF-Layout: Titel, Rechnungskorrektur, Gutschriftbetrag, Grund, kein Zahlungsteil', () => {
    const s = quelle('src/lib/pdf/verkaufRechnungPdf.tsx')
    assert.match(s, /\{gutschrift && <Text style=\{styles\.metaText\}>Rechnungskorrektur zu Rechnung \{gutschrift\.zuNummer\} vom \{fmtDate\(gutschrift\.zuDatumIso\)\}<\/Text>\}/)
    assert.match(s, /\{gutschrift \? 'Gutschriftbetrag brutto' : storno \? 'Stornobetrag brutto' : 'Gesamt brutto'\}/)
    assert.match(s, /Diese Gutschrift berichtigt die Rechnung \{gutschrift\.zuNummer\} vom \{fmtDate\(gutschrift\.zuDatumIso\)\}\./)
    assert.match(s, /\{gutschrift\.grund && <Text style=\{styles\.paymentP\}>Grund: \{gutschrift\.grund\}<\/Text>\}/)
    assert.match(s, /\{gutschrift \? \(\n[\s\S]*?\) : storno \? \(/)
  })
})

describe('KAN-453: Versand der Gutschrift', () => {
  const r = quelle('src/app/api/weinhandel/rechnungen/[id]/send/route.ts')
  test('dieselbe Route wie der Stornobeleg: Prüfungen vor dem Versand, nur Stornobeleg und Gutschrift, nur aktive Belege', () => {
    assert.match(r, /if \(art !== 'storno' && art !== 'gutschrift'\) \{\n\s+return NextResponse\.json\(\{ error: 'Hier werden nur Stornobelege und Gutschriften versendet/)
    assert.match(r, /if \(\(roh as R\)\.aktiv === false\) return NextResponse\.json\(\{ error: 'Der Beleg ist nicht mehr aktiv\.' \}, \{ status: 400 \}\)/)
    assert.match(r, /const gs = art === 'gutschrift' \? gutschriftPdfInhalt\(beleg\) : null\n\s+const sto = gs \? null : stornobelegPdfInhalt\(beleg\)/)
    assert.ok(r.indexOf("canWrite(membership, 'warenwirtschaft')") < r.indexOf('gutschriftPdfInhalt(beleg)'))
    assert.ok(r.indexOf('pruefeZweiFaktor()') < r.indexOf('schreibSperreKonflikt(membership)'))
  })
  test('PDF, Betreff, Dateiname und Aktivität nennen die Gutschrift; Versand nur über den Helfer; Vermerk am Beleg', () => {
    assert.match(r, /storno: sto\?\.storno \?\? null,\n\s+gutschrift: gs\?\.bezug \?\? null,/)
    assert.match(r, /const subject = `\$\{wort\} \$\{inhalt\.nummer\} zu Rechnung \$\{bezug\.zuNummer\} von \$\{bName\}`/)
    assert.match(r, /anbei erhalten Sie die Gutschrift \$\{inhalt\.nummer\} \(Rechnungskorrektur\) zu unserer Rechnung \$\{bezug\.zuNummer\}\./)
    assert.match(r, /dateiname: `\$\{wort\}-\$\{inhalt\.nummer \|\| id\}\.pdf`/)
    assert.equal([...r.matchAll(/belegPerMailSenden\(\{/g)].length, 1)
    assert.doesNotMatch(r, /nodemailer|getValidUserAccessToken/)
    assert.match(r, /\.update\(\{ rechnung_versendet_am: sentAt, rechnung_versendet_an: recipient \}\)\n\s+\.eq\('id', id\)\.eq\('tenant_id', tenantId\)/)
    assert.match(r, /beschreibung: `\$\{wort\} \$\{inhalt\.nummer\} per E-Mail an \$\{recipient\} versendet`/)
  })
  test('Seite der Gutschrift bietet den Versand an – nur mit Schreibrecht Warenwirtschaft', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(p, /\{gutschrift && membership && canWrite\(membership, 'warenwirtschaft'\) && \(\n\s+<div className="no-print">\n\s+<RechnungVersandPanel pfad=\{`\/api\/weinhandel\/rechnungen\/\$\{r\.id\}\/send`\} titel="Gutschrift"/)
  })
})

describe('KAN-453: Eintrag in der CRM-Historie beim Ausstellen (Entscheidung 2A)', () => {
  test('Betreff nennt Nummer, Betrag (negativ, kaufmännisch) und die Rechnung', () => {
    assert.equal(gutschriftAktivitaetBetreff('GS-2026-0001', 20, 'RE-2026-0007'), 'Gutschrift GS-2026-0001 · −20,00 € zu Rechnung RE-2026-0007')
    assert.equal(gutschriftAktivitaetBetreff('GS-2026-0002', 1.005, null), 'Gutschrift GS-2026-0002 · −1,01 €')
  })
  test('nach der Buchung, mit dem Kunden der Gutschrift; ein Fehler lässt die Gutschrift stehen und wird gemeldet', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(a, /await gutschriftInHistorie\(supabase, tenantId, String\(data\)\)\n\s+return \{ gutschriftId: String\(data\) \}/)
    const h = a.slice(a.indexOf('async function gutschriftInHistorie('), a.indexOf('// KAN-356: Verkauf samt Rechnung stornieren'))
    assert.match(h, /\.eq\('id', gutschriftId\)\.eq\('tenant_id', tenantId\)\.eq\('art', 'gutschrift'\)\.maybeSingle\(\)/)
    assert.match(h, /if \(gErr\) \{ melden\(gErr\.message\); return \}/)
    assert.match(h, /if \(!g \|\| \(!g\.kontakt_id && !g\.firma_id\)\) return/)
    assert.match(h, /art: 'verkauf',\n\s+betreff: gutschriftAktivitaetBetreff\(/)
    assert.match(h, /const melden = \(meldung: string\) => \{ void ereignisMelden\(\{ art: 'db', quelle: 'gutschrift\/aktivitaeten', meldung \}\) \}/)
    assert.match(h, /if \(error\) melden\(error\.message\)/)
    assert.doesNotMatch(h, /throw /)
  })
})
