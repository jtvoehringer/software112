// ── Zwei-Faktor per Passkey (Fingerabdruck, Gesicht, Windows Hello) – KAN-287, 10.10.2026 ─────────────────────────
//
// Supabase Auth MFA kennt neben TOTP den Faktor „webauthn“ (auth-js ≥ 2.7x, bei Supabase noch experimentell).
// Ein bestätigter Passkey ergibt wie der Code die Stufe aal2 – Proxy, API-Routen und die Datenbank (s112_aal_ok)
// prüfen weiter nur die Stufe im signierten Token. Voraussetzung: WebAuthn ist im Supabase-Projekt eingeschaltet
// (Authentication → Multi-Factor → WebAuthn). Ohne das scheitert das Einrichten mit einer verständlichen Meldung.
// Isomorph (node:test).

export type Faktor = { id: string; status: string; factor_type?: string; friendly_name?: string | null; created_at?: string }

type Faktorenliste = { all?: Faktor[] | null; totp?: Faktor[] | null; webauthn?: Faktor[] | null } | null | undefined

/** Bestätigte Faktoren nach Art: der Code (TOTP) und die Passkeys */
export function faktorenAufteilen(fl: Faktorenliste): { totp: Faktor | null; passkeys: Faktor[]; bestaetigt: Faktor[] } {
  const alle = (fl?.all ?? []).filter(f => f.status === 'verified')
  const totp = alle.find(f => f.factor_type === 'totp') ?? (fl?.totp ?? []).find(f => f.status === 'verified') ?? null
  const passkeys = alle.filter(f => f.factor_type === 'webauthn')
  for (const p of fl?.webauthn ?? []) if (p.status === 'verified' && !passkeys.some(x => x.id === p.id)) passkeys.push(p)
  return { totp, passkeys, bestaetigt: alle.length ? alle : [...(totp ? [totp] : []), ...passkeys] }
}

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

/** Fehler beim Einrichten bzw. Bestätigen in Klartext */
export function passkeyFehlerText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? ''
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? '')
  if (name === 'NotAllowedError' || /not allowed|abort|cancel/i.test(msg)) return 'Abgebrochen oder Zeit abgelaufen – bitte erneut versuchen.'
  if (/webauthn.*(disabled|not enabled|not supported)|mfa.*webauthn.*disabled|factor type.*not.*enabled/i.test(msg)) {
    return 'Passkeys sind für software:112 noch nicht freigeschaltet – bitte vorerst den Code aus der Authenticator-App verwenden.'
  }
  if (name === 'InvalidStateError') return 'Für dieses Gerät ist bereits ein Passkey eingerichtet.'
  return msg || 'Passkey konnte nicht verwendet werden.'
}
