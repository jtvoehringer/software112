// STABILITAET.md Punkt „Bibliotheken unter 70 % Abdeckung“, zweite Runde (09.10.2026):
//   lib/benachrichtigungen/server.ts (Glocke + E-Mail, @Erwähnungen), lib/crm/absender.ts (Absender-Erkennung im
//   Postfach: Kontakt/Firma/Lead/eigen/System), lib/crm/email.ts (E-Mail-Felder im Formular).
// Der Brevo-Versand ist eine Attrappe (lib/brevo/api), geprüft wird nur, wer welche Mail bekommt.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

DOPPEL['@/lib/brevo/api'] = 'data:text/javascript,' + encodeURIComponent(`
  export const sendEmail = async m => {
    if (globalThis.__brevoFehler?.(m)) throw new Error('Brevo kaputt')
    ;(globalThis.__mails ??= []).push(m)
  }`)
hooksRegistrieren()
const bn = hooksMoeglich ? await laden('lib/benachrichtigungen/server.ts') : null
const ab = hooksMoeglich ? await laden('lib/crm/absender.ts') : null
const em = hooksMoeglich ? await laden('lib/crm/email.ts') : null

const T = 't1'
const MITGLIEDER = [
  { user_id: 'u1', name: 'Jörgen Vöhringer', email: 'jv@example.at', benachrichtigung_email: true },
  { user_id: 'u2', name: 'Hannes Muster', email: 'hm@example.at', benachrichtigung_email: true },
  { user_id: 'u3', name: 'Karin Keller', email: 'kk@example.at', benachrichtigung_email: false },   // E-Mail abgeschaltet
  { user_id: 'u4', name: 'Paul <Admin>', email: null, benachrichtigung_email: true },
]

describe('@Erwähnungen', nurMitHooks, () => {
  const M = [{ id: 'u1', name: 'Jörgen Vöhringer' }, { id: 'u2', name: 'Hannes Muster' }, { id: 'u5', name: 'Hannes' }]
  test('Vorname oder voller Name, Groß/klein egal, nicht in E-Mail-Adressen, nur ganze Wörter', () => {
    assert.deepEqual(bn.findeErwaehnungen('Bitte @jörgen vöhringer anrufen', M), ['u1'])
    assert.deepEqual(bn.findeErwaehnungen('@Jörgen, schau', M), ['u1'])
    assert.deepEqual(bn.findeErwaehnungen('Mail an info@jörgen.at', M), [])
    assert.deepEqual(bn.findeErwaehnungen('@Jörgenx', M), [])
    assert.deepEqual(bn.findeErwaehnungen('ohne Klammeraffe Jörgen', M), [])
    assert.deepEqual(bn.findeErwaehnungen(null, M), [])
    assert.deepEqual(bn.findeErwaehnungen('@hannes', M).sort(), ['u2', 'u5'], 'Vorname passt zu beiden')
  })
  test('neue Erwähnungen: wer schon im alten Text stand, wird nicht erneut benachrichtigt', () => {
    assert.deepEqual(bn.neueErwaehnungen('@Jörgen und @Hannes Muster', '@Jörgen', M.slice(0, 2)), ['u2'])
    assert.deepEqual(bn.neueErwaehnungen('@Jörgen', '@Jörgen', M), [])
  })
})

describe('Benachrichtigung zustellen (sendeBenachrichtigung, benachrichtigeAktivitaet)', nurMitHooks, () => {
  let admin
  const altKey = process.env.BREVO_API_KEY, altUrl = process.env.NEXT_PUBLIC_APP_URL
  beforeEach(() => {
    globalThis.__mails = []
    globalThis.__brevoFehler = null
    process.env.BREVO_API_KEY = 'test'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.at/'
    admin = datenbank({ benachrichtigungen: [] }, { rpc: (name, args) => (name === 's112_mandant_mitglieder_mit_email' && args.p_tenant_id === T ? { data: MITGLIEDER, error: null } : { data: null, error: { message: 'x' } }) })
    globalThis.__adminFake = admin
  })
  afterEach(() => {
    globalThis.__adminFake = null
    for (const [k, v] of [['BREVO_API_KEY', altKey], ['NEXT_PUBLIC_APP_URL', altUrl]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })
  const zeilen = () => admin.tabellen.benachrichtigungen

  test('Auslöser und Doppelte fallen weg; Glocke für alle, Mail nur mit Adresse und eingeschalteter Mail; HTML maskiert, Link absolut', async () => {
    await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u1', 'u2', 'u2', 'u3', 'u4', ''], ausgeloestVon: 'u1', art: 'erwaehnung', titel: 'Erwähnung <b>X</b>', text: 'a & b', href: '/crm?aktivitaet=7' })
    assert.deepEqual(zeilen().map(z => z.empfaenger_id).sort(), ['u2', 'u3', 'u4'])
    assert.ok(zeilen().every(z => z.tenant_id === T && z.ausgeloest_von === 'u1' && z.href === '/crm?aktivitaet=7'))
    assert.deepEqual(globalThis.__mails.map(m => m.to.email), ['hm@example.at'])
    const m = globalThis.__mails[0]
    assert.equal(m.subject, '[software:112] Erwähnung <b>X</b>')
    assert.match(m.htmlContent, /<strong>Erwähnung &lt;b&gt;X&lt;\/b&gt;<\/strong> <span[^>]*>\(von Jörgen Vöhringer\)<\/span>/)
    assert.match(m.htmlContent, /a &amp; b/)
    assert.match(m.htmlContent, /href="https:\/\/app\.example\.at\/crm\?aktivitaet=7"/)
    assert.match(m.textContent, /^Hallo Hannes,/)
    assert.ok(zeilen().find(z => z.empfaenger_id === 'u2').email_gesendet_am, 'Versand an der Zeile vermerkt')
    assert.ok(!zeilen().find(z => z.empfaenger_id === 'u3').email_gesendet_am)
  })

  test('nur an sich selbst → nichts; nur Kanal App → keine Mail; ohne Brevo-Key → keine Mail', async () => {
    await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u1'], ausgeloestVon: 'u1', art: 'system', titel: 'x' })
    assert.equal(zeilen().length, 0)
    assert.equal(admin.aufrufe.length, 0)
    await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u2'], ausgeloestVon: null, art: 'system', titel: 'x', kanaele: ['app'] })
    assert.equal(zeilen().length, 1)
    assert.equal(globalThis.__mails.length, 0)
    delete process.env.BREVO_API_KEY
    await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u2'], ausgeloestVon: null, art: 'system', titel: 'x', kanaele: ['email'] })
    assert.equal(globalThis.__mails.length, 0)
    assert.equal(zeilen().length, 1, 'nur Kanal E-Mail legt keine Glocken-Zeile an')
  })

  test('wirft nie: Glocke scheitert → Mail trotzdem, ohne Vermerk; Brevo scheitert → still; Mitglieder nicht ladbar → keine Mail', async () => {
    const orig = console.error
    console.error = () => {}
    try {
      admin = datenbank({ benachrichtigungen: [] }, {
        rpc: () => ({ data: MITGLIEDER, error: null }),
        vorher: e => (e.tabelle === 'benachrichtigungen' ? { error: { message: 'RLS' } } : null),
      })
      globalThis.__adminFake = admin
      await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u2'], ausgeloestVon: null, art: 'system', titel: 'x' })
      assert.equal(globalThis.__mails.length, 1)
      assert.ok(!admin.aufrufe.some(a => a.art === 'update'), 'kein Vermerk ohne Zeile')

      globalThis.__brevoFehler = () => true
      await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u2'], ausgeloestVon: null, art: 'system', titel: 'x' })

      globalThis.__mails = []
      globalThis.__brevoFehler = null
      globalThis.__adminFake = datenbank({ benachrichtigungen: [] }, { rpc: () => { throw new Error('weg') } })
      await bn.sendeBenachrichtigung({ tenantId: T, empfaengerIds: ['u2'], ausgeloestVon: null, art: 'system', titel: 'x' })
      assert.equal(globalThis.__mails.length, 0)
    } finally { console.error = orig }
  })

  test('Aktivität: Zuweisung, „für alle“ und neue Erwähnungen – der gerade Zugewiesene bekommt keine zweite Meldung', async () => {
    const mitglieder = MITGLIEDER.map(m => ({ id: m.user_id, name: m.name }))
    await bn.benachrichtigeAktivitaet({
      tenantId: T, userId: 'u1', id: 'a9', betreff: 'Kunde anrufen', art: 'aufgabe', datum: '2026-10-12',
      beschreibung: 'Bitte @Hannes und @Karin', verantwortlichId: 'u2', fuerAlle: false, vorher: null, mitglieder,
    })
    const nachArt = art => zeilen().filter(z => z.art === art).map(z => z.empfaenger_id).sort()
    assert.deepEqual(nachArt('aufgabe_zugewiesen'), ['u2'])
    assert.deepEqual(nachArt('erwaehnung'), ['u3'])
    assert.equal(zeilen().find(z => z.art === 'aufgabe_zugewiesen').titel, 'Aufgabe zugewiesen: Kunde anrufen')
    assert.match(zeilen().find(z => z.art === 'aufgabe_zugewiesen').text, /^Bitte @Hannes und @Karin · 12\.10\.2026$/)

    admin.tabellen.benachrichtigungen = []
    await bn.benachrichtigeAktivitaet({
      tenantId: T, userId: 'u1', id: 'a9', betreff: 'Lese', art: 'termin', datum: null, beschreibung: 'Bitte @Hannes und @Karin',
      verantwortlichId: 'u2', fuerAlle: true, vorher: { verantwortlich_id: 'u2', fuer_alle: false, beschreibung: 'Bitte @Hannes und @Karin' }, mitglieder,
    })
    assert.deepEqual(nachArt('aufgabe_zugewiesen'), [], 'Verantwortlicher unverändert')
    assert.deepEqual(nachArt('erwaehnung'), [], 'Erwähnungen schon im alten Text')
    assert.deepEqual(nachArt('aufgabe_alle'), ['u2', 'u3', 'u4'])
    assert.equal(zeilen()[0].titel, 'Termin für alle: Lese')
    assert.equal(zeilen()[0].text, 'Bitte @Hannes und @Karin', 'ohne Datum nur die Beschreibung')
  })
})

describe('Absender-Erkennung im Postfach (lib/crm/absender.ts)', nurMitHooks, () => {
  test('Hilfen: Adresse, Domain, Website, Systemabsender, Name', () => {
    assert.equal(ab.normEmail('  Max@Weingut.AT '), 'max@weingut.at')
    assert.equal(ab.domainVon('a@b.at'), 'b.at')
    assert.equal(ab.domainVon('kein-at'), null)
    assert.equal(ab.domainAusWebsite('https://www.Weingut-X.at/shop?x=1'), 'weingut-x.at')
    assert.equal(ab.domainAusWebsite('localhost'), null)
    assert.equal(ab.domainAusWebsite(null), null)
    for (const e of ['noreply@x.at', 'no-reply@x.at', 'mailer-daemon@x.at', 'newsletter@shop.at', 'info@mail.microsoft.com', '']) assert.equal(ab.istSystemAbsender(e), true, e)
    assert.equal(ab.istSystemAbsender('max@weingut.at', 'Hier abmelden'), true)
    assert.equal(ab.istSystemAbsender('max@weingut.at', 'Max'), false)
    assert.equal(ab.normName('Vöhringer, Jörgen'), ab.normName('jörgen vöhringer'))
    assert.equal(ab.normName('A B'), '', 'einzelne Buchstaben zählen nicht')
  })

  const daten = () => ({
    kontakte: [
      { id: 'k1', tenant_id: T, aktiv: true, vorname: 'Max', nachname: 'Gast', email: 'Max@Gastro.at', email_weitere: ['max.privat@gmx.at'], accountnummer: 'AN-1', is_lead: false, firma_id: 'f1' },
      { id: 'k2', tenant_id: T, aktiv: true, vorname: 'Lea', nachname: 'Lead', email: 'lea@gmail.com', email_weitere: null, accountnummer: null, is_lead: true, firma_id: null },
      { id: 'k3', tenant_id: T, aktiv: true, vorname: 'Anna', nachname: 'Ansprech', email: 'anna@partner-weingut.at', email_weitere: [], accountnummer: null, is_lead: false, firma_id: 'f2' },
      { id: 'k4', tenant_id: T, aktiv: false, vorname: 'Alt', nachname: 'Inaktiv', email: 'alt@x.at', accountnummer: null, is_lead: false, firma_id: null },
      { id: 'kf', tenant_id: 'anderer', aktiv: true, vorname: 'Fremd', nachname: 'Kontakt', email: 'fremd@y.at', accountnummer: null, is_lead: false, firma_id: null },
    ],
    firmen: [
      { id: 'f1', tenant_id: T, aktiv: true, name: 'Gastro GmbH', email: 'office@gastro.at', email_weitere: ['buchhaltung@gastro.at'], website: 'https://www.gastro-online.at', accountnummer: 'FN-1', is_lead: false },
      { id: 'f2', tenant_id: T, aktiv: true, name: 'Partner Weingut', email: null, email_weitere: [], website: null, accountnummer: null, is_lead: false },
      { id: 'f3', tenant_id: T, aktiv: true, name: 'Freemail Firma', email: 'firma@gmail.com', email_weitere: [], website: null, accountnummer: null, is_lead: false },
    ],
    email_lead_ignoriert: [{ tenant_id: T, email: 'Spam@Werbung.at' }],
  })

  test('Index: exakte Adresse vor Domain, Freemail ohne Domain-Treffer, Firmen-Domain über Website und Ansprechperson, inaktive und fremde nicht', async () => {
    ab.absenderIndexVerwerfen()
    const idx = await ab.ladeAbsenderIndex(datenbank(daten()), T, ['ich@meinweingut.at', null, 'privat@gmail.com'])
    const s = e => { const r = ab.absenderStatus(idx, e); return [r.status, r.treffer?.id ?? null, r.treffer?.ueber ?? null] }
    assert.deepEqual(s('MAX@gastro.at'), ['kontakt', 'k1', 'email'])
    assert.deepEqual(s('max.privat@gmx.at'), ['kontakt', 'k1', 'email'])
    assert.deepEqual(s('buchhaltung@gastro.at'), ['firma', 'f1', 'email'])
    assert.deepEqual(s('neu@gastro.at'), ['firma', 'f1', 'domain'])
    assert.deepEqual(s('shop@gastro-online.at'), ['firma', 'f1', 'domain'])
    assert.deepEqual(s('chef@partner-weingut.at'), ['firma', 'f2', 'domain'], 'Domain der Ansprechperson zählt für die Firma')
    assert.deepEqual(s('lea@gmail.com'), ['lead', 'k2', 'email'])
    assert.deepEqual(s('wer@gmail.com'), ['unbekannt', null, null], 'Freemail: keine Domain-Zuordnung (auch nicht zu f3)')
    assert.deepEqual(s('alt@x.at'), ['unbekannt', null, null])
    assert.deepEqual(s('fremd@y.at'), ['unbekannt', null, null])
    assert.deepEqual(s('kollege@meinweingut.at'), ['eigen', null, null])
    assert.deepEqual(s('privat@gmail.com'), ['eigen', null, null])
    assert.deepEqual(s('spam@werbung.at'), ['ignoriert', null, null])
    assert.deepEqual(s('noreply@shop.at'), ['system', null, null])
    assert.deepEqual(s(''), ['system', null, null])
    assert.deepEqual(ab.findeNamensgleiche(idx, 'Gast Max').map(t => [t.id, t.email]), [['k1', 'max@gastro.at']])
    assert.deepEqual(ab.findeNamensgleiche(idx, 'Max'), [], 'ein Wort ist zu unspezifisch')
  })

  test('Rohdaten 60 s zwischengespeichert, verwerfen lädt neu', async () => {
    ab.absenderIndexVerwerfen()
    const db = datenbank(daten())
    await ab.ladeAbsenderIndex(db, T)
    const n = db.aufrufe.length
    await ab.ladeAbsenderIndex(db, T)
    assert.equal(db.aufrufe.length, n, 'zweiter Aufruf aus dem Zwischenspeicher')
    ab.absenderIndexVerwerfen(T)
    await ab.ladeAbsenderIndex(db, T)
    assert.equal(db.aufrufe.length, 2 * n)
  })
})

describe('E-Mail-Felder (lib/crm/email.ts)', nurMitHooks, () => {
  test('Adressen aus Text: „Name <adresse>“, Trenner, klein, ohne Doppelte', () => {
    assert.deepEqual(em.emailsAusText('Max <Max@A.at>, b@b.at; b@B.AT / c@c.at und d@d.at'), ['max@a.at', 'b@b.at', 'c@c.at', 'd@d.at'])
    assert.deepEqual(em.emailsAusText(null), [])
    assert.deepEqual(em.emailsAusText('keine adresse'), [])
  })
  test('Formular: erste Adresse Standard, Rest „weitere“; Fremdtext und kaputte Adressen mit Meldung', () => {
    assert.deepEqual(em.pruefeEmailFelder('a@a.at, b@b.at', 'c@c.at a@a.at'), { email: 'a@a.at', email_weitere: ['b@b.at', 'c@c.at'] })
    assert.deepEqual(em.pruefeEmailFelder('', ''), { email: null, email_weitere: [] })
    assert.match(em.pruefeEmailFelder('max aigner@aon.at', '').fehler, /„max aigner@aon\.at“ ist keine gültige/)
    assert.equal(em.pruefeEmailFelder('a@a.at und b@b.at', '').fehler, undefined, 'Füllwort „und“ ist erlaubt')
    assert.match(em.pruefeEmailFelder('a@a.at', 'ok@b.at, kaputt@x').fehler, /„kaputt@x“/)
  })
  test('einzelne Adresse: genau eine, sonst null', () => {
    assert.equal(em.einzelneEmail(' Max <Max@A.at> '), 'max@a.at')
    assert.equal(em.einzelneEmail('a@a.at b@b.at'), null)
    assert.equal(em.einzelneEmail(''), null)
  })
})
