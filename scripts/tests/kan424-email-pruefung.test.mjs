// KAN-424 (12.11.2026): E-Mail-Adressen der Kontakte prüfen – Regeln und Verdrahtung.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOMAIN_TIPPFEHLER, EMAIL_AUFFAELLIG, EMAIL_LAUF_MENGE, EMAIL_WIEDER_TAGE, domainVon, emailAuffaellig, emailBestaetigbar, emailPruefText,
  pruefeDomain, pruefeSchreibweise, ruecklaeuferAus, wiederZuPruefenVor,
} from '../../src/lib/crm/emailPruefung.ts'
import { filterAusParams, paramsAusFilter } from '../../src/lib/crm/liste.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const fehler = code => Object.assign(new Error(code), { code })

describe('KAN-424: Schreibweise', () => {
  test('gültige Adressen sind unauffällig, leere ebenso', () => {
    for (const a of ['franz@weingut-mayer.at', 'office@gmail.com', 'a.b+c@gmx.net', '', null, undefined]) assert.equal(pruefeSchreibweise(a), null, String(a))
  })
  test('falsch geschrieben bzw. Tippfehler bekannter Domains', () => {
    assert.equal(pruefeSchreibweise('franz@').status, 'schreibweise')
    assert.equal(pruefeSchreibweise('franz mayer@gmx.at').status, 'schreibweise')
    const t = pruefeSchreibweise('Franz@Gmial.com')
    assert.equal(t.status, 'schreibweise')
    assert.match(t.hinweis, /gmail\.com/)
    assert.match(pruefeSchreibweise('x@gmx.att').hinweis, /gmx\.at\?/)
    // jede Korrektur ist selbst kein Tippfehler-Eintrag
    for (const [falsch, richtig] of Object.entries(DOMAIN_TIPPFEHLER)) assert.equal(DOMAIN_TIPPFEHLER[richtig], undefined, `${falsch} → ${richtig}`)
  })
  test('Domain aus der Adresse', () => {
    assert.equal(domainVon(' Franz@Weingut-Mayer.AT '), 'weingut-mayer.at')
    assert.equal(domainVon('ohne-at'), null)
    assert.equal(domainVon('x@'), null)
    assert.equal(domainVon(null), null)
  })
})

describe('KAN-424: Domain', () => {
  const dns = (mx, a) => ({ mx: async () => { if (mx instanceof Error) throw mx; return mx }, a: async () => { if (a instanceof Error) throw a; return a } })
  test('MX vorhanden → ok; kein MX, aber A-Eintrag → ok', async () => {
    assert.equal(await pruefeDomain('x.at', dns(1, 0)), 'ok')
    assert.equal(await pruefeDomain('x.at', dns(0, 1)), 'ok')
    assert.equal(await pruefeDomain('x.at', dns(fehler('ENODATA'), 2)), 'ok')
  })
  test('Domain gibt es nicht → ungültig', async () => {
    assert.equal(await pruefeDomain('x.at', dns(fehler('ENOTFOUND'), fehler('ENOTFOUND'))), 'ungueltig')
    assert.equal(await pruefeDomain('x.at', dns(fehler('ENODATA'), fehler('ENODATA'))), 'ungueltig')
    assert.equal(await pruefeDomain('x.at', dns(0, 0)), 'ungueltig')
  })
  test('Netzfehler heißt „unbekannt“, nie „ungültig“', async () => {
    assert.equal(await pruefeDomain('x.at', dns(fehler('ETIMEOUT'), 1)), 'unbekannt')
    assert.equal(await pruefeDomain('x.at', dns(fehler('ESERVFAIL'), fehler('ENOTFOUND'))), 'unbekannt')
    assert.equal(await pruefeDomain('x.at', dns(fehler('ENOTFOUND'), fehler('ECONNREFUSED'))), 'unbekannt')
    assert.equal(await pruefeDomain('x.at', dns(new Error('ohne Code'), 1)), 'unbekannt')
  })
})

describe('KAN-424: Rückläufer und Kennzeichen', () => {
  test('nur harte Rückläufer aus der Brevo-Sperrliste, klein geschrieben, ohne Doppelte', () => {
    assert.deepEqual(ruecklaeuferAus([
      { email: 'A@x.at', reason: { code: 'hardBounce' } }, { email: 'a@x.at', reason: { code: 'hardBounce' } },
      { email: 'b@x.at', reason: { code: 'unsubscribedViaEmail' } }, { email: 'c@x.at', reason: { code: 'adminBlocked' } },
      { email: 'kein-at', reason: { code: 'hardBounce' } }, { reason: { code: 'hardBounce' } }, null,
    ]), ['a@x.at'])
    assert.deepEqual(ruecklaeuferAus(null), [])
    assert.deepEqual(ruecklaeuferAus({ contacts: [] }), [])
  })
  test('auffällig, bestätigbar, Text', () => {
    assert.deepEqual([...EMAIL_AUFFAELLIG], ['schreibweise', 'domain', 'ruecklaeufer'])
    for (const s of EMAIL_AUFFAELLIG) assert.equal(emailAuffaellig({ email_pruefung: s }), true, s)
    for (const s of ['bestaetigt', null, undefined, '']) assert.equal(emailAuffaellig({ email_pruefung: s }), false, String(s))
    assert.equal(emailBestaetigbar({ email_pruefung: 'schreibweise' }), true)
    assert.equal(emailBestaetigbar({ email_pruefung: 'domain' }), true)
    assert.equal(emailBestaetigbar({ email_pruefung: 'ruecklaeufer' }), false)   // Nachweis – fällt nur mit neuer Adresse weg
    assert.equal(emailPruefText({ email_pruefung: 'domain', email_pruef_hinweis: null }), 'Die Domain nimmt keine E-Mails an.')
    assert.equal(emailPruefText({ email_pruefung: 'schreibweise', email_pruef_hinweis: 'Eigener Hinweis' }), 'Eigener Hinweis')
    assert.equal(emailPruefText({ email_pruefung: 'bestaetigt', email_pruef_hinweis: 'x' }), '')
  })
  test('Wiederholung frühestens nach 90 Tagen, 300 Kontakte je Betrieb und Lauf', () => {
    assert.equal(EMAIL_WIEDER_TAGE, 90)
    assert.equal(EMAIL_LAUF_MENGE, 300)
    assert.equal(wiederZuPruefenVor(new Date('2026-11-12T03:00:00Z')), '2026-08-14T03:00:00.000Z')
  })
  test('Listenfilter ?emailpruefen=1 nur für Kontakte', () => {
    assert.equal(filterAusParams({ emailpruefen: '1' }, 'kontakt').emailPruefen, true)
    assert.equal(filterAusParams({ emailpruefen: '1' }, 'firma').emailPruefen, false)
    assert.equal(paramsAusFilter(filterAusParams({ emailpruefen: '1' }, 'kontakt')), '?emailpruefen=1')
    assert.match(quelle('src/lib/crm/liste.ts'), /if \(f\.emailPruefen\) q = q\.in\('email_pruefung', \['schreibweise', 'domain', 'ruecklaeufer'\]\)/)
  })
})

describe('KAN-424: Verdrahtung', () => {
  test('Lauf: je Betrieb begrenzt, bestätigte und anonymisierte außen vor, schreibt nur die Prüf-Spalten', () => {
    const s = quelle('src/lib/crm/emailPruefungLauf.ts')
    assert.match(s, /\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)\.not\('email', 'is', null\)\.is\('anonymisiert_am', null\)/)
    assert.match(s, /\.or\('email_pruefung\.is\.null,email_pruefung\.in\.\(schreibweise,domain\)'\)/)
    assert.match(s, /\.order\('email_geprueft_am', \{ nullsFirst: true \}\)\.order\('id'\)\.limit\(EMAIL_LAUF_MENGE\)/)
    // keine Schreibstelle fasst die Adresse an
    for (const m of s.matchAll(/\.update\((\{[^}]*\}|werte)\)/g)) assert.doesNotMatch(m[1], /\bemail:/, m[1])
    assert.doesNotMatch(s, /\.delete\(/)
    assert.match(s, /else erg\.ungeklaert\+\+/)
    assert.match(s, /if \(betrieb\?\.zugang\) \{/)
    assert.match(s, /\.eq\('tenant_id', tenantId\)\.in\('email', block\)\.is\('anonymisiert_am', null\)/)
  })
  test('täglicher Lauf ruft die Prüfung mit festem Budget und zählt ihre Fehler', () => {
    const s = quelle('src/app/api/cron/taeglich/route.ts')
    assert.match(s, /const emailPruefung = await laufEmailPruefung\(admin, 60000\)/)
    assert.match(s, /journal\.fehler\.length \+ emailPruefung\.fehler\.length \+ emailSpiegel\.fehler\.length \+ mb\.alsFehler/)
    assert.ok(s.indexOf('laufEmailPruefung(admin') < s.indexOf('laufMorgenberichte('), 'vor den Morgenberichten')
  })
  test('Bestätigen: Recht CRM, nur Schreibweise/Domain, Trefferprüfung; Seite zeigt Kennzeichen und Knopf', () => {
    const a = quelle('src/app/(dashboard)/crm/actions.ts')
    const fn = a.slice(a.indexOf('export async function kontaktEmailBestaetigen('), a.indexOf('// ── Personendaten löschen'))
    assert.ok(fn.indexOf('await crmSchreibTenant()') < fn.indexOf('.update('))
    assert.match(fn, /\.eq\('id', id\)\.eq\('tenant_id', tenantId\)\.in\('email_pruefung', \['schreibweise', 'domain'\]\)\s*\.select\('id'\)/)
    assert.match(fn, /if \(!\(data as unknown\[\] \| null\)\?\.length\) return \{ error:/)
    const d = quelle('src/app/(dashboard)/crm/kontakte/[id]/KontaktDetailClient.tsx')
    assert.match(d, /\{emailAuffaellig\(kontakt\) && \(\s*<div role="status"/)
    assert.match(d, /\{writeOk && emailBestaetigbar\(kontakt\) && \(/)
    assert.match(quelle('src/app/(dashboard)/crm/kontakte/KontakteClient.tsx'), /checked=\{filter\.emailPruefen\} onChange=\{\(\) => setzeFilter\(\{ emailPruefen: !filter\.emailPruefen \}\)\}/)
  })
  test('Newsletter-Bestätigung hebt das Kennzeichen auf; Brevo-Sperrliste seitenweise', () => {
    assert.match(quelle('src/app/newsletter/actions.ts'), /newsletter_bestaetigt: true, newsletter_token_hash: null, aktualisiert_am: now, email_pruefung: 'bestaetigt', email_pruef_hinweis: null/)
    assert.match(quelle('src/lib/brevo/api.ts'), /smtp\/blockedContacts\?limit=100&offset=\$\{offset\}/)
  })
  test('Migration: drei Spalten mit CHECK, Trigger nur auf email, zwei Indizes', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(f => f.endsWith('_kan424_email_pruefung.sql'))
    const entwurf = path.join(WURZEL, 'supabase', 'entwurf', 'kan424_email_pruefung.sql')
    const pfad = datei ? path.join(ordner, datei) : entwurf   // Entwurfsordner ist nicht eingecheckt
    if (!existsSync(pfad)) return
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /email_pruefung IN \('schreibweise', 'domain', 'ruecklaeufer', 'bestaetigt'\)/)
    assert.match(sql, /CREATE TRIGGER b_email_pruefung_zuruecksetzen\s+BEFORE UPDATE OF email ON public\.kontakte/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_kontakt_email_pruefung_zuruecksetzen\(\) FROM PUBLIC, anon, authenticated;/)
    assert.match(sql, /SET search_path = public/)
    assert.equal((sql.match(/CREATE INDEX kontakte_email_pruefung/g) ?? []).length, 2)
  })
})
