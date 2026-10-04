import { createHash, randomBytes } from 'node:crypto'

// Double-Opt-in-Token der Newsletter-Anmeldung (KAN-159 BK4): Der Klartext steht nur im Bestätigungslink der
// E-Mail; in kontakte.newsletter_token_hash liegt ausschließlich der SHA-256-Hash. Mitglieder des Betriebs
// lesen die Spalte, können mit dem Hash aber keine Anmeldung im Namen des Kontakts bestätigen.

/** Neues zufälliges Token (64 Hex-Zeichen) für den Bestätigungslink. */
export function neuesNewsletterToken(): string {
  return randomBytes(32).toString('hex')
}

/** Format des Tokens im Link – alles andere ist ungültig. */
export function istNewsletterToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token)
}

/** Gespeicherter Wert zum Token: SHA-256 als Hex. */
export function newsletterTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
