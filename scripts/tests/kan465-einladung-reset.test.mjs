// KAN-465 (Befund 16.11.2026, UAT-Testkonten): Ein doppelt bzw. vom Mailprogramm vorab abgerufener Einladungslink endete
// mit „Ungültiger Einladungslink.“ ohne Ausweg; ein Passwort-Link in einem anderen Fenster scheiterte still und führte in
// die Sitzung eines anderen Kontos. Geprüft: Link-Arten, Meldungen mit Ausweg, fremde Sitzung, Benutzerverwaltung.
// Den Callback prüft kan257-weiterleitung.test.mjs.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authLinkAus, linkFehlerText, linkFehltText, fremdeSitzungText, zielFuerTokenHash, OTP_TYPEN, PASSWORT_OFFEN } from '../../src/lib/auth/authLink.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-465: Link aus der Adresse', () => {
  test('Token-Hash (neue Vorlagen): Art aus „type“; unbekannte Art wird nicht geraten', () => {
    assert.deepEqual(authLinkAus('?token_hash=abc&type=invite', ''), { art: 'token_hash', tokenHash: 'abc', typ: 'invite' })
    assert.deepEqual(authLinkAus('token_hash=abc&type=recovery', ''), { art: 'token_hash', tokenHash: 'abc', typ: 'recovery' })
    assert.deepEqual(authLinkAus('?token_hash=abc&type=boese', ''), { art: 'fehler', code: 'link_unbekannt', beschreibung: null })
    assert.deepEqual(authLinkAus('?token_hash=abc', ''), { art: 'fehler', code: 'link_unbekannt', beschreibung: null })
    assert.ok(OTP_TYPEN.includes('invite') && OTP_TYPEN.includes('recovery'))
  })
  test('bisherige Wege bleiben: Code (PKCE) und Sitzung im Fragment', () => {
    assert.deepEqual(authLinkAus('?code=xyz', ''), { art: 'code', code: 'xyz' })
    assert.deepEqual(authLinkAus('', '#access_token=a&refresh_token=r&type=invite'), { art: 'hash', accessToken: 'a', refreshToken: 'r' })
    assert.deepEqual(authLinkAus('', '#access_token=a'), { art: 'hash', accessToken: 'a', refreshToken: '' })
    assert.deepEqual(authLinkAus('', ''), { art: 'keiner' })
  })
  test('Fehler von Supabase (Fragment oder Abfrage) geht vor – der zweite Abruf eines verbrauchten Links', () => {
    assert.deepEqual(authLinkAus('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
      { art: 'fehler', code: 'otp_expired', beschreibung: 'Email link is invalid or has expired' })
    assert.deepEqual(authLinkAus('?error=access_denied&code=xyz', ''), { art: 'fehler', code: 'access_denied', beschreibung: null })
    assert.equal(authLinkAus('?token_hash=abc&type=invite', '#error=access_denied').art, 'fehler')
  })
})

describe('KAN-465: Meldungen mit Ausweg', () => {
  test('verbrauchter bzw. abgelaufener Einladungslink: sagt, was los ist und was zu tun ist – nie nur „ungültig“', () => {
    for (const u of ['otp_expired', 'One-time token not found', 'Email link is invalid or has expired', null, '']) {
      const t = linkFehlerText('einladung', u)
      assert.match(t, /bereits verwendet oder ist abgelaufen/)
      assert.match(t, /Link zum Festlegen des Passworts anfordern/)
      assert.match(t, /neue Einladung/)
    }
    assert.match(linkFehlerText('passwort', 'otp_expired'), /bereits verwendet oder ist abgelaufen\. Bitte unten einen neuen Link anfordern\./)
  })
  test('anderer Browser (PKCE), zu viele Versuche, fehlender Link', () => {
    assert.match(linkFehlerText('passwort', 'invalid request: both auth code and code verifier should be non-empty'), /nur in dem Browser, in dem er angefordert wurde/)
    assert.match(linkFehlerText('einladung', 'flow_state_not_found'), /nur in dem Browser/)
    assert.match(linkFehlerText('passwort', 'over_email_send_rate_limit'), /Zu viele Versuche/)
    assert.match(linkFehltText('einladung'), /fehlt der Einladungslink/)
    assert.match(linkFehltText('passwort'), /fehlt der Link aus der E-Mail/)
    // Meldungen von Supabase werden nie durchgereicht
    assert.ok(!linkFehlerText('passwort', 'ganz neuer Fehler XYZ').includes('XYZ'))
  })
  test('fremde Sitzung: Hinweis nur, wenn jemand angemeldet ist', () => {
    assert.match(fremdeSitzungText('karin@example.at'), /als karin@example\.at angemeldet\. Beim Fortfahren wirst du dort abgemeldet/)
    assert.equal(fremdeSitzungText(null), null)
    assert.equal(fremdeSitzungText('  '), null)
  })
  test('Ziel eines Token-Hash: Passwortseite für „recovery“, sonst die Einladungsseite', () => {
    assert.equal(zielFuerTokenHash('recovery'), '/auth/update-password')
    assert.equal(zielFuerTokenHash('invite'), '/auth/invite')
    assert.equal(zielFuerTokenHash(null), '/auth/invite')
    assert.equal(zielFuerTokenHash('https://boese.example'), '/auth/invite')
  })
})

describe('KAN-465: Seiten', () => {
  test('Einladung: eingelöst wird erst mit dem Knopf (verifyOtp), fremde Sitzung vorher beendet, Ausweg bei Fehler', () => {
    const p = quelle('src/app/auth/invite/page.tsx')
    assert.ok(p.includes('await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.typ })'))
    const klick = p.slice(p.indexOf('async function annehmen()'))
    assert.ok(klick.indexOf("signOut({ scope: 'local' })") < klick.indexOf('verifyOtp('), 'erst abmelden, dann einlösen')
    assert.ok(!p.slice(0, p.indexOf('async function annehmen()')).includes('verifyOtp('), 'beim Laden der Seite wird nichts eingelöst')
    assert.ok(p.includes("setError(linkFehlerText('einladung', l.code ?? l.beschreibung))"), '#error=… wird ausgewertet')
    assert.ok(p.includes('<Link href="/login/reset"') && !p.includes('Ungültiger Einladungslink.'))
    assert.ok(p.includes('} finally {\n      setLoading(false)'))
  })
  test('Passwort festlegen: Link per Klick, fremde Sitzung angezeigt, ohne Sitzung Meldung statt Formular, Kennzeichen gelöscht', () => {
    const p = quelle('src/app/auth/update-password/page.tsx')
    assert.ok(p.includes("else if (l.art === 'token_hash' || l.art === 'code' || l.art === 'hash') setStand('link')"))
    assert.ok(p.includes("if (konto) await supabase.auth.signOut({ scope: 'local' })"))
    assert.ok(p.includes("window.history.replaceState(null, '', '/auth/update-password')"), 'eingelöster Link verschwindet aus der Adresse')
    assert.ok(p.includes('Du bist nicht angemeldet. Bitte den Link aus der E-Mail öffnen oder unten einen neuen anfordern.'))
    assert.ok(p.includes('Das Passwort dieses Kontos wurde nicht geändert.'))
    assert.ok(p.includes('Konto: <strong>{konto}</strong>'), 'zeigt, für welches Konto das Passwort gilt')
    assert.ok(p.includes('const gemerkt = await passwortFestgelegt()'))
    assert.ok(!/kuenftig|koennen/.test(p), 'Umlaute')
    const a = quelle('src/app/auth/update-password/actions.ts')
    assert.ok(a.includes('const { data: { user } } = await supabase.auth.getUser()') && a.includes('updateUserById(user.id,'), 'nur das eigene Konto, ID aus der geprüften Sitzung')
    assert.ok(!/export async function passwortFestgelegt\([a-zA-Z]/.test(a), 'kein Parameter für das Ziel-Konto')
  })
  test('Fehlerseite: ohne Anmeldung erreichbar, bleibt bei offener Sitzung stehen und nennt das angemeldete Konto', () => {
    assert.ok(quelle('src/proxy.ts').includes("'/auth/update-password', '/auth/fehler',"))
    const f = quelle('src/app/auth/fehler/page.tsx')
    assert.ok(f.includes('An diesem Konto wurde nichts geändert'))
    assert.ok(f.includes('<h1 ') && f.includes("export const metadata: Metadata = { title: 'Link nicht gültig' }"))
    assert.ok(!quelle('src/app/auth/callback/route.ts').includes('redirect(`${origin}/login'), 'der Callback leitet nie mehr auf die Anmeldeseite')
  })
})

describe('KAN-465: Benutzerverwaltung', () => {
  const a = quelle('src/app/(dashboard)/benutzer/actions.ts')
  const fn = a.slice(a.indexOf('export async function sendePasswortLinkAnMitglied'), a.indexOf('/** Rollenänderung */'))
  test('„Passwort-Link senden“: Betrieb der Seite, Schreibsperre, Benutzerverwaltungsrecht, Mitglied des EIGENEN Betriebs', () => {
    const i = s => { const n = fn.indexOf(s); assert.ok(n > 0, s); return n }
    const betrieb = i('seitenBetriebFehler(membership?.tenantId)'), sperre = i('schreibSperreFehler(membership)'), recht = i('canManageUsers(membership.role)')
    const mitglied = i(".eq('tenant_id', membership.tenantId).eq('user_id', userId).maybeSingle()"), senden = i('await sendePasswortLink(admin,')
    assert.ok(betrieb < sperre && sperre < recht && recht < mitglied && mitglied < senden)
    assert.ok(fn.includes("if (!target) return { error: 'Benutzer ist kein Mitglied dieses Betriebs.' }"))
    assert.ok(fn.includes("(target as R).role === 'system_admin' && membership.role !== 'system_admin'"), 'Plattform-Konten nur durch die Plattform')
    assert.ok(fn.includes('if (!user.email_confirmed_at)'), 'unbestätigtes Konto: Einladung erneut senden')
    assert.ok(!/return \{[^}]*(link|url|token)/i.test(fn), 'Link bzw. Token gehen nie an den Browser der Betriebsleitung')
  })
  test('Kennzeichen „Passwort noch nicht festgelegt“: bei Einladung gesetzt, in der Liste angezeigt', () => {
    assert.equal(PASSWORT_OFFEN, 's112_passwort_offen')
    const e = quelle('src/lib/auth/einladung.ts')
    assert.ok(e.includes('await merkePasswortOffen(admin, data.user)'))
    assert.ok(e.includes('app_metadata: { ...(user.app_metadata ?? {}), [PASSWORT_OFFEN]: true }'), 'app_metadata – vom Benutzer nicht selbst änderbar')
    assert.ok(a.includes('await merkePasswortOffen(admin, user)   // KAN-465'), 'auch bei „Einladung erneut senden“')
    assert.ok(a.includes('passwortOffen: passwortOffen.has(m.user_id),'))
    const c = quelle('src/app/(dashboard)/benutzer/BenutzerClient.tsx')
    assert.ok(c.includes('{m.confirmed && m.passwortOffen && ('))
    assert.ok(c.includes('Passwort-Link senden') && c.includes('await sendePasswortLinkAnMitglied(m.user_id)'))
  })
  test('Passwort-Link: Token-Hash auf die Passwortseite der App (Einlösen erst per Klick); ohne System-Mail die Mail von Supabase', () => {
    const e = quelle('src/lib/auth/einladung.ts')
    assert.ok(e.includes("admin.auth.admin.generateLink({ type: 'recovery', email: p.email })"))
    assert.ok(e.includes('return `${APP_URL}/auth/update-password?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`'))
    assert.ok(e.includes("admin.auth.resetPasswordForEmail(p.email, { redirectTo: `${APP_URL}/auth/callback?next=/auth/update-password&type=recovery` })"))
  })
})
