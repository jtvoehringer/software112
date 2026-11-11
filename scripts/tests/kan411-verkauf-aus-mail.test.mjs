// KAN-411 Teil 1 (11.11.2026) – Verkauf aus einer E-Mail: Knopf an der Mail, vorbelegter Kunde, Mailtext neben dem Formular,
// Bezug des Verkaufs zur Unterhaltung, vorbereitete Antwort an den Kunden. Ohne KI (Teil 2).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m = () => laden('lib/verkauf/ausMail.ts')
const K = '11111111-1111-4111-8111-111111111111'

describe('KAN-411: Regeln', nurMitHooks, () => {
  test('Ziel des Knopfs: Kunde, Mail und Postfach – die Mail-ID wird kodiert', async () => {
    const { verkaufAusMailPfad } = await m()
    assert.equal(verkaufAusMailPfad({ typ: 'kontakt', id: K }, 'AAMk=/+x', 'own'), `/weinhandel/verkauf/neu?kontakt=${K}&mail=AAMk%3D%2F%2Bx`)
    assert.equal(verkaufAusMailPfad({ typ: 'firma', id: K }, 'abc', 'shared'), `/weinhandel/verkauf/neu?firma=${K}&mail=abc&postfach=shared`)
    assert.equal(verkaufAusMailPfad(null, 'abc', 'own'), '/weinhandel/verkauf/neu?mail=abc')
    assert.equal(verkaufAusMailPfad({ typ: 'kontakt', id: 'keine-uuid' }, 'abc', 'own'), '/weinhandel/verkauf/neu?mail=abc')
  })
  test('Bezug aus der Adresszeile: hin und zurück; ohne Mail kein Bezug; fremde Werte fallen weg', async () => {
    const { verkaufAusMailPfad, mailBezugAusSuche } = await m()
    const pfad = verkaufAusMailPfad({ typ: 'firma', id: K }, 'AAMk=/+x', 'shared')
    assert.deepEqual(mailBezugAusSuche(pfad.slice(pfad.indexOf('?'))), { mailId: 'AAMk=/+x', postfach: 'shared', kunde: `firma:${K}` })
    assert.deepEqual(mailBezugAusSuche(`?kontakt=${K}&mail=abc`), { mailId: 'abc', postfach: 'own', kunde: `kontakt:${K}` })
    assert.equal(mailBezugAusSuche(`?kontakt=${K}`), null)
    assert.equal(mailBezugAusSuche(''), null)
    assert.deepEqual(mailBezugAusSuche('?kontakt=x%27%20or%201&mail=abc&postfach=sonst'), { mailId: 'abc', postfach: 'own', kunde: '' })
    assert.equal(mailBezugAusSuche('?mail=' + 'x'.repeat(501)), null)
  })
  test('Notiz-Vorschlag: Tag in Wien (nicht UTC), Betreff gekürzt', async () => {
    const { notizAusMail } = await m()
    assert.equal(notizAusMail('Bestellung  Zweigelt', '2026-11-10T23:30:00Z'), 'Bestellung per E-Mail vom 11.11.2026 („Bestellung Zweigelt“)')
    assert.equal(notizAusMail('', null), 'Bestellung per E-Mail')
    assert.equal(notizAusMail('x'.repeat(200), 'kein Datum'), `Bestellung per E-Mail („${'x'.repeat(120)}“)`)
  })
  test('Werte für den Verkauf: ohne Unterhaltung kein Bezug, Betreff höchstens 300 Zeichen', async () => {
    const { emailBezugWerte, EMAIL_BEZUG_MAX } = await m()
    assert.deepEqual(emailBezugWerte('AAQk123=', ' Bestellung \n Zweigelt '), { email_conversation_id: 'AAQk123=', email_betreff: 'Bestellung Zweigelt' })
    assert.deepEqual(emailBezugWerte(null, 'Betreff'), { email_conversation_id: null, email_betreff: null })
    assert.deepEqual(emailBezugWerte('  ', 'Betreff'), { email_conversation_id: null, email_betreff: null })
    assert.deepEqual(emailBezugWerte('x'.repeat(EMAIL_BEZUG_MAX + 1), 'Betreff'), { email_conversation_id: null, email_betreff: null })
    assert.equal(emailBezugWerte('c', 'b'.repeat(400)).email_betreff.length, EMAIL_BEZUG_MAX)
    assert.equal(emailBezugWerte('c', '').email_betreff, null)
  })
  test('Antwort-Entwurf: Positionen mit Menge und Einheit, Dezimalkomma, leere Zeilen fallen weg', async () => {
    const { antwortEntwurf } = await m()
    const t = antwortEntwurf([
      { menge: 6, einheit: 'Stk', name: ' Zweigelt 2024 · 0,75 l ' },
      { menge: 12.5, einheit: 'L', name: 'Grüner Veltliner' },
      { menge: 0, einheit: 'Stk', name: 'ohne Menge' },
      { menge: 3, einheit: 'Stk', name: '  ' },
    ])
    assert.equal(t, 'Guten Tag,\n\nvielen Dank für die Bestellung. Wir haben sie wie folgt erfasst:\n\n– 6 Stk Zweigelt 2024 · 0,75 l\n– 12,5 L Grüner Veltliner\n\nFreundliche Grüße')
    assert.match(antwortEntwurf([]), /erfasst:\n\n–\n\nFreundliche Grüße$/)
  })
  test('Entwurf aus dem Zwischenspeicher: nur vollständige Einträge, Postfach mit Vorgabe', async () => {
    const { entwurfAus } = await m()
    assert.deepEqual(entwurfAus(JSON.stringify({ mailId: 'abc', postfach: 'shared', text: 'Guten Tag' })), { mailId: 'abc', postfach: 'shared', text: 'Guten Tag' })
    assert.deepEqual(entwurfAus(JSON.stringify({ mailId: 'abc', text: 'x' })), { mailId: 'abc', postfach: 'own', text: 'x' })
    assert.equal(entwurfAus(JSON.stringify({ mailId: '', text: 'x' })), null)
    assert.equal(entwurfAus(JSON.stringify({ mailId: 'abc' })), null)
    assert.equal(entwurfAus('kein json'), null)
    assert.equal(entwurfAus('null'), null)
    assert.equal(entwurfAus(null), null)
  })
  test('Mailtext für die Anzeige: HTML wird zu Text, Skripte und Stile fallen weg', async () => {
    const { mailTextOhneHtml } = await m()
    assert.equal(mailTextOhneHtml('Hallo,\r\nbitte 6 Flaschen.', null), 'Hallo,\nbitte 6 Flaschen.')
    assert.equal(
      mailTextOhneHtml('', '<html><head><style>p{color:red}</style></head><body><p>Hallo,</p><div>bitte 6&nbsp;Flaschen &amp; 2 Kartons<br>Danke</div><script>alert(1)</script></body></html>'),
      'Hallo,\nbitte 6 Flaschen & 2 Kartons\nDanke')
    assert.equal(mailTextOhneHtml('<p>nur im Textfeld</p><p>zweite Zeile</p>', null), 'nur im Textfeld\nzweite Zeile')
    assert.equal(mailTextOhneHtml(null, null), '')
  })
})

describe('KAN-411: Wege und Absicherung', () => {
  test('Mail-Ansicht: Knopf „Verkauf anlegen“ nur mit zugeordnetem Absender, Hinweis auf vorhandene Verkäufe', () => {
    const n = quelle('src/app/(dashboard)/nachrichten/NachrichtenClient.tsx')
    assert.match(n, /\{selected\.kontaktInfo && \([^\n]*\n\s+<Link href=\{verkaufAusMailPfad\(selected\.kontaktInfo, selected\.id, selected\.mailbox \?\? activeMailbox\)\}/)
    assert.match(n, /<ShoppingCart [^>]*\/> Verkauf anlegen/)
    assert.match(n, /Zu dieser Unterhaltung gibt es bereits/)
    assert.match(n, /href=\{'\/weinhandel\/verkauf\/' \+ v\.id\}/)
  })
  test('Antwort-Entwurf: aus dem Zwischenspeicher, einmalig, ins Verfassen-Fenster – kein Senden', () => {
    const n = quelle('src/app/(dashboard)/nachrichten/NachrichtenClient.tsx')
    const f = n.slice(n.indexOf('// KAN-411: Nach „Verkauf anlegen“'), n.indexOf('// Mailbox gewechselt'))
    assert.ok(f.length > 300)
    assert.match(f, /sessionStorage\.getItem\(ENTWURF_SCHLUESSEL\); sessionStorage\.removeItem\(ENTWURF_SCHLUESSEL\)/)
    assert.match(f, /setCompose\(true\)/)
    assert.match(f, /setText\(entwurf\.text\)/)
    assert.match(f, /mailbox: entwurf\.postfach/)
    assert.doesNotMatch(f, /\/api\/(m365|email)\/send/)
    assert.match(f, /if \(!res\.ok \|\| d\.fehler\)/)
  })
  test('Formular: Bezug aus der Adresszeile, Kunde über die Partnersuche-Logik, Mail als Text, Antwort nach dem Speichern', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx')
    assert.match(p, /mailBezugAusSuche\(window\.location\.search\)/)
    assert.match(p, /if \(loading\) return\n\s+const bezug = mailBezugAusSuche/)   // erst nach den Stammdaten
    assert.match(p, /onChange=\{kundeWaehlen\}/)
    assert.match(p, /if \(t\) kundeWaehlen\(b\.kunde, t\)/)
    assert.match(p, /<pre [^>]*>\{mail\.text\}<\/pre>/)
    assert.doesNotMatch(p, /dangerouslySetInnerHTML/)
    assert.match(p, /if \(mailBezug && mail\?\.conversationId\) \{[^}]*formData\.set\('email_conversation_id', mail\.conversationId\)/)
    const s = p.slice(p.indexOf('const r = await createVerkauf(formData)'), p.indexOf("router.push(zielNachVorgang('/weinhandel/verkauf', 'verkauf'))"))
    assert.match(s, /if \('error' in r\) \{\n\s+setError\(r\.error\)\n\s+return\n\s+\}\n\s+if \(mailBezug\) \{/)   // Entwurf nur nach Erfolg
    assert.match(s, /sessionStorage\.setItem\(ENTWURF_SCHLUESSEL, JSON\.stringify\(\{ mailId: mailBezug\.mailId, postfach: mailBezug\.postfach, text: antwortEntwurf\(posForServer\) \}\)\)/)
    assert.match(s, /router\.push\('\/nachrichten'\)/)
    assert.doesNotMatch(s, /nachrichten\?/)   // kein Mailtext und keine Kundendaten in der URL
  })
  test('Server Action: Bezug über emailBezugWerte in den Verkaufsposten', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(a, /const emailBezug\s+= emailBezugWerte\(formData\.get\('email_conversation_id'\), formData\.get\('email_betreff'\)\)/)
    assert.match(a, /rechnungstext,\n\s+\.\.\.emailBezug,\n/)
  })
  test('Mail-Route: Verkäufe der Unterhaltung im eigenen Betrieb, ohne stornierte, Lesefehler verhindert die Mail nicht', () => {
    const r = quelle('src/app/api/nachrichten/message/route.ts')
    assert.match(r, /\.eq\('tenant_id', tenantId\)\.eq\('email_conversation_id', String\(msg\.conversationId\)\)\.eq\('storniert', false\)/)
    // neueste zuerst: aufsteigend mit limit blieben die ältesten stehen
    assert.ok(r.includes(".order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false }).limit(10)"))
    assert.match(r, /if \(vkErr\) \{\n\s+verkaeufe = null\n\s+void ereignisMelden\(/)
  })
  test('Verkaufsdetail zeigt die Herkunft', () => {
    const d = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(d, /email_betreff, email_conversation_id,/)
    assert.match(d, /Aus einer E-Mail angelegt/)
  })
  test('Migration: zwei Spalten mit Längengrenze und Index je Betrieb', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const datei = readdirSync(dir).find(x => /kan411_verkauf_aus_mail\.sql$/.test(x))
    const entwurf = new URL('../../supabase/entwurf/kan411_verkauf_aus_mail.sql', import.meta.url)
    if (!datei && !existsSync(entwurf)) return   // Entwurfsordner ist nicht eingecheckt
    const sql = (datei ? readFileSync(new URL(datei, dir), 'utf8') : readFileSync(entwurf, 'utf8')).replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN email_conversation_id text\n\s+CONSTRAINT verkaufsposten_email_conversation_chk CHECK \(email_conversation_id IS NULL OR char_length\(email_conversation_id\) <= 300\)/)
    assert.match(sql, /ADD COLUMN email_betreff text\n\s+CONSTRAINT verkaufsposten_email_betreff_chk CHECK \(email_betreff IS NULL OR char_length\(email_betreff\) <= 300\)/)
    assert.match(sql, /CREATE INDEX verkaufsposten_email_conversation_idx\n\s+ON public\.verkaufsposten \(tenant_id, email_conversation_id\)\n\s+WHERE email_conversation_id IS NOT NULL;/)
  })
})
