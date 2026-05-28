// ── Brevo REST API Helper ─────────────────────────────────────────────────────
// Docs: https://developers.brevo.com/reference

const BREVO_BASE = 'https://api.brevo.com/v3'

function headers() {
  const key = process.env.BREVO_API_KEY
  if (!key) throw new Error('BREVO_API_KEY nicht konfiguriert')
  return {
    'accept':       'application/json',
    'content-type': 'application/json',
    'api-key':      key,
  }
}

// ── Transaktions-E-Mail senden ────────────────────────────────────────────────

export async function sendEmail({
  to, subject, htmlContent, textContent,
}: {
  to: { email: string; name?: string }
  subject: string
  htmlContent: string
  textContent?: string
}) {
  const res = await fetch(`${BREVO_BASE}/smtp/email`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      sender:      { name: 'Weingut Gebeshuber', email: process.env.BREVO_SENDER_EMAIL ?? 'noreply@weingut-gebeshuber.at' },
      to:          [to],
      subject,
      htmlContent,
      textContent: textContent ?? subject,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Brevo E-Mail-Fehler: ${err}`)
  }
  return res.json()
}

// ── Kontakt in Brevo anlegen / aktualisieren ──────────────────────────────────

export async function upsertContact({
  email, vorname, nachname, listIds, attributes,
}: {
  email: string
  vorname?: string | null
  nachname?: string | null
  listIds?: number[]
  attributes?: Record<string, string | boolean | number>
}) {
  const res = await fetch(`${BREVO_BASE}/contacts`, {
    method: 'POST',
    headers: headers(),
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
    throw new Error(`Brevo Kontakt-Fehler: ${err}`)
  }
}

// ── Kontakt aus Liste entfernen (Opt-out) ─────────────────────────────────────

export async function removeFromList(email: string, listId: number) {
  const res = await fetch(`${BREVO_BASE}/contacts/lists/${listId}/contacts/remove`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ emails: [email] }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Brevo Opt-out-Fehler: ${err}`)
  }
}
