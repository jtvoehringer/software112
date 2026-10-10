// ── Supabase-Auth-Meldungen auf Deutsch (Sweep 100, 10.10.2026) ─────────────────────────────────────────────
//
// Anmeldung, Passwort zurücksetzen, Zwei-Faktor und Einladungen zeigten englische Meldungen von Supabase Auth
// („For security purposes, you can only request this after 45 seconds.“, „Email not confirmed“, „Invalid TOTP code
// entered“, „A user with this email address has already been registered“) – nur einzelne Stellen übersetzten selbst
// und uneinheitlich (error.message === 'Invalid login credentials', message.includes('Invalid')).
// Erkennung zuerst über den Fehlercode (AuthApiError.code, auth-js ErrorCode), dann über den Meldungstext.
// Unbekanntes bleibt unverändert. Ohne Importe – client- und serversicher, node:test lädt die Datei direkt.

type AuthFehler = { code?: unknown; message?: unknown; status?: unknown } | null | undefined

const NACH_CODE: Record<string, string> = {
  invalid_credentials: 'E-Mail oder Passwort falsch.',
  email_not_confirmed: 'Die E-Mail-Adresse ist noch nicht bestätigt – bitte den Link in der Einladungs- bzw. Bestätigungs-E-Mail öffnen.',
  user_banned: 'Dieses Konto ist gesperrt. Bitte an die Betriebsleitung wenden.',
  user_not_found: 'Zu dieser E-Mail-Adresse gibt es kein Konto.',
  email_exists: 'Zu dieser E-Mail-Adresse gibt es bereits ein Konto.',
  user_already_exists: 'Zu dieser E-Mail-Adresse gibt es bereits ein Konto.',
  email_address_invalid: 'Die E-Mail-Adresse ist ungültig.',
  over_email_send_rate_limit: 'Es wurden gerade zu viele E-Mails verschickt – bitte in ein paar Minuten erneut versuchen.',
  over_request_rate_limit: 'Zu viele Versuche in kurzer Zeit – bitte kurz warten und erneut versuchen.',
  mfa_verification_failed: 'Der Code stimmt nicht – bitte den aktuellen Code aus der App eingeben.',
  mfa_challenge_expired: 'Der Code ist abgelaufen – bitte den aktuellen Code aus der App eingeben.',
  mfa_factor_not_found: 'Der zweite Faktor wurde nicht gefunden – bitte die Seite neu laden.',
  mfa_verified_factor_exists: 'Es ist bereits ein zweiter Faktor eingerichtet.',
  otp_expired: 'Der Link ist abgelaufen oder wurde schon verwendet – bitte einen neuen anfordern.',
  flow_state_expired: 'Der Link ist abgelaufen – bitte einen neuen anfordern.',
  flow_state_not_found: 'Der Link ist ungültig oder wurde schon verwendet – bitte einen neuen anfordern.',
  bad_code_verifier: 'Der Link wurde in einem anderen Browser geöffnet – bitte im selben Browser öffnen oder einen neuen anfordern.',
  session_not_found: 'Die Sitzung ist abgelaufen – bitte neu anmelden.',
  session_expired: 'Die Sitzung ist abgelaufen – bitte neu anmelden.',
  refresh_token_not_found: 'Die Sitzung ist abgelaufen – bitte neu anmelden.',
  reauthentication_needed: 'Bitte zur Bestätigung erneut anmelden.',
  same_password: 'Das neue Passwort muss sich vom bisherigen unterscheiden.',
  weak_password: 'Das Passwort ist zu schwach: mindestens 12 Zeichen, Buchstaben und Ziffern.',
  signup_disabled: 'Die Registrierung ist derzeit nicht möglich.',
}

const NACH_TEXT: [RegExp, (m: RegExpExecArray) => string][] = [
  [/you can only request this after (\d+) seconds?/i, m => `Aus Sicherheitsgründen erst in ${m[1]} Sekunden wieder möglich – bitte kurz warten.`],
  [/invalid login credentials/i, () => NACH_CODE.invalid_credentials],
  [/email not confirmed/i, () => NACH_CODE.email_not_confirmed],
  [/invalid (totp|mfa) code|invalid code entered/i, () => NACH_CODE.mfa_verification_failed],
  [/(already been registered|user already registered|already exists)/i, () => NACH_CODE.email_exists],
  [/token has expired or is invalid|email link is invalid or has expired/i, () => NACH_CODE.otp_expired],
  [/rate limit exceeded|too many requests/i, () => NACH_CODE.over_request_rate_limit],
  [/auth session missing/i, () => NACH_CODE.session_not_found],
  [/unable to validate email address|invalid email/i, () => NACH_CODE.email_address_invalid],
  [/new password should be different/i, () => NACH_CODE.same_password],
  [/user not found/i, () => NACH_CODE.user_not_found],
  [/failed to fetch|networkerror|load failed/i, () => 'Keine Verbindung zum Anmeldedienst – bitte die Internetverbindung prüfen und erneut versuchen.'],
]

/** Deutsche Meldung für einen Fehler von Supabase Auth (Anmeldung, Passwort, Zwei-Faktor, Einladung) */
export function authFehlerText(err: AuthFehler | string, ersatz = 'Anmeldedienst nicht erreichbar – bitte erneut versuchen.'): string {
  const e = typeof err === 'string' ? { message: err } : err
  const code = typeof e?.code === 'string' ? e.code : ''
  const message = typeof e?.message === 'string' ? e.message.trim() : ''
  if (code && NACH_CODE[code]) {
    // Wartezeit steht nur im Text – genauer als die allgemeine Meldung zum Code
    const warten = /you can only request this after (\d+) seconds?/i.exec(message)
    return warten ? NACH_TEXT[0][1](warten) : NACH_CODE[code]
  }
  for (const [re, text] of NACH_TEXT) {
    const m = re.exec(message)
    if (m) return text(m)
  }
  return message || ersatz
}
