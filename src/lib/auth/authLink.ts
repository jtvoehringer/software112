// ── Einladungs- und Passwort-Links auswerten (KAN-465) ──────────────────────────────────────────────────────────────
//
// Befund 16.11.2026 (UAT-Testkonten): Ein doppelt bzw. vom Mailprogramm vorab abgerufener Einladungslink endete mit
// „Ungültiger Einladungslink.“ ohne Ausweg; ein Passwort-Link in einem anderen Fenster scheiterte still und führte in
// die Sitzung eines anderen, noch angemeldeten Kontos.
//
// Seit KAN-465 kennt die App drei Link-Arten:
//   token_hash  ?token_hash=…&type=invite|recovery|…  – neue E-Mail-Vorlagen und „Passwort-Link senden“. Wird erst beim
//               Klick auf unserer Seite eingelöst (verifyOtp, POST): Ein Vorab-Abruf durch Mailprogramm oder Virenscanner
//               verbraucht nichts, der Link geht in jedem Fenster und auf jedem Gerät.
//   code        ?code=…  – bisheriger PKCE-Weg; nur in dem Browser einlösbar, der ihn angefordert hat.
//   hash        #access_token=…&refresh_token=…  – bisheriger Weg der Einladung (Sitzung im Fragment).
// Dazu der Fehlerfall, den Supabase im Fragment bzw. in der Abfrage zurückgibt (#error=access_denied&error_code=otp_expired).
// Isomorph und ohne '@/'-Importe (node:test).

export type LinkZweck = 'einladung' | 'passwort'

/** Arten, die verifyOtp für einen Token-Hash aus einer E-Mail annimmt */
export const OTP_TYPEN = ['invite', 'recovery', 'signup', 'email', 'magiclink'] as const
export type OtpTyp = typeof OTP_TYPEN[number]

export type AuthLink =
  | { art: 'token_hash'; tokenHash: string; typ: OtpTyp }
  | { art: 'code'; code: string }
  | { art: 'hash'; accessToken: string; refreshToken: string }
  | { art: 'fehler'; code: string | null; beschreibung: string | null }
  | { art: 'keiner' }

const istOtpTyp = (t: string | null): t is OtpTyp => !!t && (OTP_TYPEN as readonly string[]).includes(t)

/**
 * Link aus Abfrage (?…) und Fragment (#…) der Adresse. Ein Fehler von Supabase geht vor – der Link ist dann verbraucht
 * oder abgelaufen, auch wenn sonst noch Parameter in der Adresse stehen.
 */
export function authLinkAus(search: string, hash: string): AuthLink {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const fehler = h.get('error') ?? q.get('error')
  if (fehler) {
    return { art: 'fehler', code: h.get('error_code') ?? q.get('error_code') ?? fehler, beschreibung: h.get('error_description') ?? q.get('error_description') }
  }
  const tokenHash = (q.get('token_hash') ?? '').trim()
  if (tokenHash) {
    const typ = q.get('type')
    // unbekannte Art: nicht raten – ein Token der falschen Art einzulösen scheitert und verbraucht nichts, sagt dem Benutzer aber nichts
    return istOtpTyp(typ) ? { art: 'token_hash', tokenHash, typ } : { art: 'fehler', code: 'link_unbekannt', beschreibung: null }
  }
  const code = (q.get('code') ?? '').trim()
  if (code) return { art: 'code', code }
  const accessToken = h.get('access_token')
  if (accessToken) return { art: 'hash', accessToken, refreshToken: h.get('refresh_token') ?? '' }
  return { art: 'keiner' }
}

const VERBRAUCHT = /otp_expired|expired|invalid|not found|access_denied|flow_state|code verifier|both auth code/i

/**
 * Meldung für einen gescheiterten Link – sagt, was los ist und was zu tun ist. `ursache` ist der Fehlercode bzw. die
 * Meldung von Supabase (nie an den Benutzer durchgereicht).
 */
export function linkFehlerText(zweck: LinkZweck, ursache?: string | null): string {
  const u = ursache ?? ''
  if (/rate limit|too many|over_email_send_rate_limit|429/i.test(u)) {
    return 'Zu viele Versuche in kurzer Zeit. Bitte ein paar Minuten warten und es dann noch einmal versuchen.'
  }
  if (/code verifier|flow_state|both auth code/i.test(u)) {
    return 'Dieser Link funktioniert nur in dem Browser, in dem er angefordert wurde. Bitte den Link dort öffnen oder unten einen neuen Link anfordern.'
  }
  if (zweck === 'einladung') {
    return VERBRAUCHT.test(u) || !u
      ? 'Dieser Einladungslink wurde bereits verwendet oder ist abgelaufen. Ist dein Konto schon aktiviert, kannst du unten einen Link zum Festlegen des Passworts anfordern – sonst bitte deinen Betrieb um eine neue Einladung.'
      : 'Der Einladungslink konnte nicht eingelöst werden. Bitte unten einen Link zum Festlegen des Passworts anfordern oder deinen Betrieb um eine neue Einladung bitten.'
  }
  return VERBRAUCHT.test(u) || !u
    ? 'Dieser Link wurde bereits verwendet oder ist abgelaufen. Bitte unten einen neuen Link anfordern.'
    : 'Der Link konnte nicht eingelöst werden. Bitte unten einen neuen Link anfordern.'
}

/** Meldung, wenn die Adresse gar keinen Link enthält (z. B. abgeschnittene Adresse aus der Mail) */
export function linkFehltText(zweck: LinkZweck): string {
  return zweck === 'einladung'
    ? 'In der Adresse fehlt der Einladungslink. Bitte den Link aus der E-Mail vollständig öffnen – oder unten einen Link zum Festlegen des Passworts anfordern.'
    : 'In der Adresse fehlt der Link aus der E-Mail. Bitte den Link vollständig öffnen oder unten einen neuen anfordern.'
}

/**
 * Hinweis, wenn beim Öffnen eines Links schon ein Konto angemeldet ist: Der Link gehört womöglich zu einem anderen
 * Konto – nie still in der fremden Sitzung weiterarbeiten.
 */
export function fremdeSitzungText(angemeldetAls: string | null | undefined): string | null {
  const wer = (angemeldetAls ?? '').trim()
  if (!wer) return null
  return `Du bist in diesem Browser als ${wer} angemeldet. Beim Fortfahren wirst du dort abgemeldet – der Link gilt für das Konto, an das die E-Mail ging.`
}

/** Ziel von /auth/callback für einen Token-Hash: die Seite, auf der er per Klick eingelöst wird (nie beim Abruf) */
export function zielFuerTokenHash(typ: string | null): '/auth/update-password' | '/auth/invite' {
  return typ === 'recovery' ? '/auth/update-password' : '/auth/invite'
}

/** Kennzeichen am Konto (app_metadata): eingeladen, Passwort noch nicht selbst festgelegt */
export const PASSWORT_OFFEN = 's112_passwort_offen'
