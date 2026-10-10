// ── Inhalt einer Anfrage sicher lesen (Sweep 103, 10.10.2026) ─────────────────────────────────────────────────
//
// req.json() bzw. req.formData() werfen bei leerem oder kaputtem Inhalt (abgebrochener Upload, falscher Content-Type,
// leerer Body). Stand der Aufruf außerhalb eines try, antwortete Next.js mit einer HTML-Fehlerseite (500) – der Client
// scheiterte dann an res.json() („Unexpected token <“) statt eine Meldung zu zeigen. Diese Helfer liefern null; die
// Route antwortet mit 400 und einer verständlichen Meldung (ungueltigeAnfrage).

type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const UNGUELTIGE_ANFRAGE = 'Die Anfrage konnte nicht gelesen werden (leerer oder ungültiger Inhalt) – bitte die Seite neu laden und erneut versuchen.'

/** JSON-Inhalt als Objekt – null bei leerem/kaputtem Inhalt oder wenn es kein Objekt ist */
export async function jsonBody<T extends R = R>(req: Request): Promise<T | null> {
  try {
    const b: unknown = await req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as T) : null
  } catch { return null }
}

/** Formularinhalt (multipart/form-data bzw. urlencoded) – null, wenn er nicht gelesen werden kann */
export async function formBody(req: Request): Promise<FormData | null> {
  try { return await req.formData() } catch { return null }
}

/** 400-Antwort mit der Meldung unter dem Schlüssel, den der Client der Route liest ('fehler' bzw. 'error') */
export function ungueltigeAnfrage(schluessel: 'fehler' | 'error' = 'fehler'): Response {
  return Response.json({ [schluessel]: UNGUELTIGE_ANFRAGE }, { status: 400 })
}
