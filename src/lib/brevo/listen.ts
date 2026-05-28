// ── Brevo Listen-IDs je Segment ───────────────────────────────────────────────
// Diese IDs nach dem Anlegen der Listen in Brevo in .env.local eintragen.
// Fallback: 0 = kein Listeneintrag (Kontakt wird angelegt aber keiner Liste zugeordnet)

export function getListId(segment: string): number {
  const map: Record<string, string | undefined> = {
    privat:      process.env.BREVO_LIST_PRIVAT,
    gastronomie: process.env.BREVO_LIST_GASTRONOMIE,
    handel:      process.env.BREVO_LIST_HANDEL,
    export:      process.env.BREVO_LIST_EXPORT,
    grosshandel: process.env.BREVO_LIST_GROSSHANDEL,
  }
  const id = parseInt(map[segment] ?? '0')
  return isNaN(id) ? 0 : id
}

export function getListIds(segment: string): number[] {
  const id = getListId(segment)
  return id > 0 ? [id] : []
}
