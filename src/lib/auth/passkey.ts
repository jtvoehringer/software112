// ── Anmeldung per Passkey (Fingerabdruck, Gesicht, Windows Hello) – KAN-287, 10.10.2026 ─────────────────────────────
//
// Supabase Auth „Passkeys“ (Beta, im Projekt unter Authentication → Passkeys eingeschaltet; WebAuthn als zweiter Faktor
// ist im Dashboard nicht freischaltbar): Ein Passkey ersetzt Passwort und – sofern die Sitzung die Stufe aal2 erreicht –
// den Code. Eingerichtet wird er im Profil (Zwei-Faktor-Seite), angemeldet auf der Login-Seite.
// API (auth-js ≥ 2.116, Client mit auth.experimental.passkey): auth.registerPasskey(), auth.signInWithPasskey(),
// auth.passkey.list()/delete().
// Isomorph (node:test).

export type PasskeyEintrag = { id: string; friendly_name?: string | null; created_at: string; last_used_at?: string | null }

/** Kann dieser Browser Passkeys (WebAuthn)? */
export function passkeyMoeglich(w: unknown = typeof window === 'undefined' ? undefined : window): boolean {
  return !!w && typeof (w as { PublicKeyCredential?: unknown }).PublicKeyCredential !== 'undefined'
}

/** Anzeigename des Passkeys: Gerät aus dem User-Agent und Datum */
export function passkeyName(userAgent: string, datum: string): string {
  const ua = userAgent || ''
  const geraet = /iPhone/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) ? 'iPad' : /Android/i.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Gerät'
  return `Passkey ${geraet} ${datum}`
}

/** Fehler beim Einrichten bzw. Anmelden in Klartext */
export function passkeyFehlerText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? ''
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? '')
  if (name === 'NotAllowedError' || /not allowed|abort|cancel|timed out/i.test(msg)) return 'Abgebrochen oder Zeit abgelaufen – bitte erneut versuchen.'
  if (/passkey.*(disabled|not enabled)|feature.*disabled/i.test(msg)) return 'Passkeys sind für software:112 noch nicht freigeschaltet – bitte mit Passwort anmelden.'
  if (name === 'InvalidStateError' || /already registered|excluded/i.test(msg)) return 'Für dieses Gerät ist bereits ein Passkey eingerichtet.'
  if (/no.*credential|not found|unknown credential/i.test(msg)) return 'Für dieses Konto ist auf diesem Gerät kein Passkey eingerichtet – bitte mit Passwort anmelden und den Passkey im Profil einrichten.'
  return msg || 'Passkey konnte nicht verwendet werden.'
}

/** KAN-399: Basis-Anmeldung, die den Passkey nach dem Sprung von einer Betriebs-Subdomain gleich startet */
export const PASSKEY_START_PFAD = '/login?passkey=1'

/** Soll die Login-Seite den Passkey gleich starten? (Parameter passkey=1 aus PASSKEY_START_PFAD) */
export function passkeyAutomatisch(suche: string): boolean {
  return new URLSearchParams(suche).get('passkey') === '1'
}
