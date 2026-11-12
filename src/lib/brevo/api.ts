// ── Brevo REST API Helper ─────────────────────────────────────────────────────
// Docs: https://developers.brevo.com/reference

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
const BREVO_BASE = 'https://api.brevo.com/v3'

/** Brevo-Zugang eines Betriebs (Newsletter je Betrieb, 23.9.2026). Ohne Angabe: Systemkonto aus der Umgebung
 *  (IC&P, nur System-Mails von software:112 – KAN-27, 06.10.2026). */
export type BrevoZugang = { apiKey: string; senderMail: string; senderName: string }

function headers(zugang?: BrevoZugang) {
  const key = zugang?.apiKey ?? process.env.BREVO_API_KEY
  if (!key) throw new AktionsFehler('BREVO_API_KEY nicht konfiguriert')
  return {
    'accept':       'application/json',
    'content-type': 'application/json',
    'api-key':      key,
  }
}

// ── Transaktions-E-Mail senden ────────────────────────────────────────────────

/** Absender der System-Mails (Vercel BREVO_SENDER_EMAIL, IC&P) – kein Rückfall auf die Adresse eines Betriebs (KAN-27) */
function systemAbsender(): string {
  const mail = process.env.BREVO_SENDER_EMAIL?.trim()
  if (!mail) throw new AktionsFehler('BREVO_SENDER_EMAIL nicht konfiguriert')
  return mail
}


export async function sendEmail({
  to, subject, htmlContent, textContent, senderName, zugang,
}: {
  to: { email: string; name?: string }
  subject: string
  htmlContent: string
  textContent?: string
  /** Absendername; Standard: der Name aus dem Zugang bzw. „software:112“ (System-Mails) */
  senderName?: string
  zugang?: BrevoZugang
}) {
  const res = await fetch(`${BREVO_BASE}/smtp/email`, {
    method: 'POST',
    headers: headers(zugang),
    body: JSON.stringify({
      sender:      zugang
        ? { name: senderName ?? zugang.senderName, email: zugang.senderMail }
        : { name: senderName ?? 'software:112', email: systemAbsender() },
      to:          [to],
      subject,
      htmlContent,
      textContent: textContent ?? subject,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new AktionsFehler(`Brevo E-Mail-Fehler: ${err}`)
  }
  return res.json()
}

// ── Kontakt in Brevo anlegen / aktualisieren ──────────────────────────────────

export async function upsertContact({
  email, vorname, nachname, listIds, attributes, zugang,
}: {
  email: string
  vorname?: string | null
  nachname?: string | null
  listIds?: number[]
  attributes?: Record<string, string | boolean | number>
  zugang?: BrevoZugang
}) {
  const res = await fetch(`${BREVO_BASE}/contacts`, {
    method: 'POST',
    headers: headers(zugang),
    body: JSON.stringify({
      email,
      updateEnabled: true,
      listIds:    listIds ?? [],
      attributes: {
        FIRSTNAME: vorname ?? '',
        LASTNAME:  nachname ?? '',
        ...attributes,
      },
    }),
  })
  // 204 = already exists and updated — both OK
  if (!res.ok && res.status !== 204) {
    const err = await res.text()
    throw new AktionsFehler(`Brevo Kontakt-Fehler: ${err}`)
  }
}

// ── Kontakt löschen (DSGVO, KAN-425) ──────────────────────────────────────────
// Entfernt den Kontakt samt Listen-Zugehörigkeit aus dem Brevo-Konto des Betriebs. 404 = dort nicht (mehr) vorhanden.

export async function deleteContact(email: string, zugang: BrevoZugang): Promise<void> {
  const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}?identifierType=email_id`, {
    method: 'DELETE',
    headers: headers(zugang),
  })
  if (!res.ok && res.status !== 404) {
    const err = await res.text()
    throw new AktionsFehler(`Brevo-Löschfehler: ${err}`)
  }
}

// ── Gesperrte Adressen (KAN-424) ──────────────────────────────────────────────
// GET /smtp/blockedContacts: Adressen, an die das Konto nicht mehr sendet, mit Grund (reason.code: hardBounce,
// unsubscribedViaEmail, adminBlocked …). Seitenweise, höchstens 100 je Abruf.

export async function blockedContacts(zugang: BrevoZugang, offset = 0): Promise<{ contacts: unknown[] }> {
  const res = await fetch(`${BREVO_BASE}/smtp/blockedContacts?limit=100&offset=${offset}`, { headers: headers(zugang) })
  if (!res.ok) {
    const err = await res.text()
    throw new AktionsFehler(`Brevo-Sperrliste: ${err}`)
  }
  const daten = await res.json() as { contacts?: unknown }
  return { contacts: Array.isArray(daten?.contacts) ? daten.contacts : [] }
}

// ── Kontakt aus Liste entfernen (Opt-out) ─────────────────────────────────────

export async function removeFromList(email: string, listId: number, zugang?: BrevoZugang) {
  const res = await fetch(`${BREVO_BASE}/contacts/lists/${listId}/contacts/remove`, {
    method: 'POST',
    headers: headers(zugang),
    body: JSON.stringify({ emails: [email] }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new AktionsFehler(`Brevo Opt-out-Fehler: ${err}`)
  }
}
