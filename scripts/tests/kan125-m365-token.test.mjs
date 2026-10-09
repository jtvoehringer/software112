// KAN-125 (08.10.2026): Token-Refresh von Microsoft 365 – Fehler eingestuft (neu verbinden / App / vorübergehend),
// markierte Verbindungen fragen Microsoft nicht mehr und zählen nicht täglich als Fehler, Refresh immer mit
// offline_access und dem gespeicherten Scope, /nachrichten mit Hinweis statt rohem JSON, Präfix nie leer.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as tf from '../../src/lib/m365/tokenFehler.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const AADSTS65001 = JSON.stringify({ error: 'invalid_grant', error_description: "AADSTS65001: The user or administrator has not consented to use the application with ID '39488d98-…' named 'Software112'.", suberror: 'consent_required' })

describe('KAN-125: Einstufung der Token-Fehler', () => {
  test('invalid_grant (65001 consent_required, abgelaufen) → neu verbinden', () => {
    assert.deepEqual(tf.tokenFehlerEinstufen(400, AADSTS65001), { art: 'neu_verbinden', code: 'AADSTS65001' })
    assert.deepEqual(tf.tokenFehlerEinstufen(400, JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired due to inactivity.' })), { art: 'neu_verbinden', code: 'AADSTS700082' })
    assert.equal(tf.tokenFehlerEinstufen(400, JSON.stringify({ error: 'interaction_required' })).art, 'neu_verbinden')
  })

  test('invalid_client → App des Betriebs; 5xx, Drosselung, kein JSON → vorübergehend', () => {
    assert.deepEqual(tf.tokenFehlerEinstufen(401, JSON.stringify({ error: 'invalid_client', error_description: 'AADSTS7000222: The provided client secret keys are expired.' })), { art: 'app', code: 'AADSTS7000222' })
    assert.deepEqual(tf.tokenFehlerEinstufen(503, '<html>Service Unavailable</html>'), { art: 'voruebergehend', code: 'HTTP 503' })
    assert.equal(tf.tokenFehlerEinstufen(429, JSON.stringify({ error: 'temporarily_unavailable' })).art, 'voruebergehend')
  })

  test('Fehlertext deutsch, mit Code, ohne rohes JSON', () => {
    const e = tf.tokenFehler(400, AADSTS65001)
    assert.ok(e instanceof tf.M365TokenFehler)
    assert.equal(e.art, 'neu_verbinden')
    assert.equal(e.message, `${tf.NEU_VERBINDEN_TEXT} (AADSTS65001)`)
    assert.doesNotMatch(e.message, /\{|invalid_grant|39488d98/)
  })

  test('Vermerk „Neu verbinden nötig“ und Erkennung', () => {
    const v = tf.neuVerbindenVermerk('AADSTS65001', new Date('2026-10-08T05:00:12Z'))
    assert.equal(v, 'Neu verbinden nötig seit 2026-10-08T05:00 (AADSTS65001)')
    assert.equal(tf.istNeuVerbinden(v), true)
    assert.equal(tf.istNeuVerbinden('2026-10-08T05:00 · 3 geprüft · 2 neu'), false)
    assert.equal(tf.istNeuVerbinden(null), false)
  })

  test('Refresh-Scope: gespeicherter Scope, sonst Basis – immer mit offline_access', () => {
    const basis = 'offline_access Mail.ReadWrite Mail.Send'
    // so liefert Microsoft den Scope zurück (ohne offline_access) – ohne Ergänzung käme kein neuer Refresh-Token
    assert.equal(tf.refreshScope('Calendars.Read email Mail.ReadWrite openid profile', basis), 'offline_access Calendars.Read email Mail.ReadWrite openid profile')
    assert.equal(tf.refreshScope(null, basis), basis)
    assert.equal(tf.refreshScope('  ', basis), basis)
    assert.equal(tf.refreshScope('Mail.Send OFFLINE_ACCESS', basis), 'Mail.Send OFFLINE_ACCESS')
  })

  test('Bezeichnung der Verbindung nie leer', () => {
    assert.equal(tf.verbindungName({ email_address: '', anzeigename: '', monitored_email: 'office@weingut.at', user_id: 'u1' }), 'office@weingut.at')
    assert.equal(tf.verbindungName({ email_address: '', anzeigename: 'Johannes', user_id: 'u1' }), 'Johannes')
    assert.equal(tf.verbindungName({ email_address: '', user_id: 'u1' }), 'u1')
    assert.equal(tf.verbindungName({}), 'Postfach ohne Bezeichnung')
  })
})

describe('KAN-125: Verdrahtung', () => {
  test('graph.ts: eingestufter Fehler, Markierung entfernt die Tokens, Scope gespeichert, Betriebs-Verbindung gemeldet', () => {
    const g = quelle('src/lib/m365/graph.ts')
    assert.match(g, /if \(!res\.ok\) throw tokenFehler\(res\.status, await res\.text\(\)\)/)
    assert.doesNotMatch(g, /Token-Refresh fehlgeschlagen: \$\{await res\.text\(\)\}/)
    assert.match(g, /m365_access_token_enc: null, m365_refresh_token_enc: null, m365_token_expires_at: null,\n\s+email_spiegel_info: neuVerbindenVermerk\(e\.code, new Date\(\)\)/)
    assert.match(g, /refreshScope\(gespeichert, M365_SCOPE\)/)
    assert.match(g, /\.\.\.\(tokens\.scope \? \{ m365_scope: tokens\.scope \} : \{\}\)/)
    assert.match(g, /if \(istNeuVerbinden\(userCfg\.email_spiegel_info\)\) throw new M365TokenFehler\('neu_verbinden'/)
    assert.match(g, /quelle: 'm365\/betrieb'/)
  })

  test('Spiegelung: markierte zählen als neuVerbinden, nicht als Fehler; Präfix über verbindungName', () => {
    const s = quelle('src/lib/email/spiegel.ts')
    assert.match(s, /if \(!v\.m365_access_token_enc && istNeuVerbinden\(v\.email_spiegel_info\)\) erg\.neuVerbinden\.push/)
    assert.match(s, /if \(e instanceof M365TokenFehler && e\.art === 'neu_verbinden'\) erg\.neuVerbinden\.push\(verbindungName\(uc\)\)/)
    assert.doesNotMatch(s, /uc\.email_address \?\? uc\.user_id/)
    assert.match(quelle('src/app/api/cron/taeglich/route.ts'), /emailSpiegel\.neuVerbinden\.length \? ` \(\$\{emailSpiegel\.neuVerbinden\.length\} neu zu verbinden\)`/)
  })

  test('Oberfläche: Nachrichten mit „Neu verbinden“ und „Trennen“, Kalender-Hinweis, Callback setzt den Vermerk zurück', () => {
    const l = quelle('src/app/api/nachrichten/list/route.ts')
    assert.match(l, /return NextResponse\.json\(\{ fehler: NEU_VERBINDEN_TEXT, neuVerbinden: true \}, \{ status: 409 \}\)/)
    const n = quelle('src/app/(dashboard)/nachrichten/NachrichtenClient.tsx')
    assert.match(n, /\{neuVerbinden \? 'Neu verbinden' : 'Mit Microsoft 365 verbinden'\}/)
    assert.match(n, /await fetch\('\/api\/nachrichten\/disconnect', \{ method: 'POST' \}\)[\s\S]{0,700}\n\s+Trennen\n/)   // Sweep 82: Fehlerprüfung dazwischen
    assert.match(quelle('src/app/(dashboard)/crm/CRMUebersichtClient.tsx'), /setOutlookNeuVerbinden\(json\.neuVerbinden \?/)
    const c = quelle('src/app/api/auth/m365/user/callback/route.ts')
    assert.match(c, /\.update\(\{ email_spiegel_info: null \}\)\n\s+\.eq\('tenant_id', tenantId\)\.eq\('user_id', userId\)\.like\('email_spiegel_info', 'Neu verbinden nötig%'\)/)
    assert.match(c, /const me = \(meRes\.ok \? await meRes\.json\(\) : \{\}\) as R/)
    assert.doesNotMatch(quelle('src/app/api/m365/subscribe/route.ts'), /catch \{ \/\* weiter \*\/ \}/)
  })
})
