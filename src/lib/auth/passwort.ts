// ── Passwortregeln (Sicherheit O4, 23.9.2026) ─────────────────────────────────
// Muss zur Einstellung in Supabase passen: Authentication › Sign In / Providers › Email
//   Minimum password length = 12, Password requirements = „Letters and digits“,
//   Prevent use of leaked passwords = an.
// Supabase prüft das bei updateUser/signUp selbst; admin.auth.admin.createUser (Selbstregistrierung)
// umgeht die Regeln – dort prüfen wir hier inkl. Abgleich mit Have I Been Pwned.

export const PASSWORT_MIN = 12

/** Deutsche Fehlermeldung oder null, wenn das Passwort die Regeln erfüllt. */
export function pruefePasswort(pw: string): string | null {
  if (pw.length < PASSWORT_MIN) return `Das Passwort braucht mindestens ${PASSWORT_MIN} Zeichen.`
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return 'Das Passwort braucht Buchstaben und mindestens eine Ziffer.'
  return null
}

/** Übersetzt Supabase-Fehler beim Passwortsetzen ins Deutsche. */
export function passwortFehlerText(err: { code?: string; message: string }): string {
  const m = err.message ?? ''
  if (/pwned|leak|known to be weak|easy to guess/i.test(m))
    return 'Dieses Passwort ist aus bekannt gewordenen Datenlecks bekannt. Bitte ein anderes wählen.'
  if (err.code === 'weak_password' || /at least \d+ characters|should contain/i.test(m))
    return `Das Passwort ist zu schwach: mindestens ${PASSWORT_MIN} Zeichen, Buchstaben und Ziffern.`
  if (/same.*password|different from the old/i.test(m))
    return 'Das neue Passwort muss sich vom bisherigen unterscheiden.'
  return m
}

/**
 * Abgleich mit Have I Been Pwned (k-Anonymität: nur die ersten 5 Zeichen des SHA-1-Hash
 * verlassen den Server). Nur serverseitig verwenden. Bei Netzfehlern „nicht geleakt“ (fail-open),
 * damit eine Störung bei HIBP keine Registrierung blockiert.
 */
export async function istPasswortGeleakt(pw: string): Promise<boolean> {
  try {
    const { createHash } = await import('crypto')
    const hash = createHash('sha1').update(pw, 'utf8').digest('hex').toUpperCase()
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    })
    if (!res.ok) return false
    const rest = hash.slice(5)
    return (await res.text()).split('\n').some(z => {
      const [suffix, anzahl] = z.trim().split(':')
      return suffix === rest && Number(anzahl) > 0
    })
  } catch {
    return false
  }
}
