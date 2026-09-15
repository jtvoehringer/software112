// ── E-Mail → Lead: gemeinsame Typen und Text-Aufbereitung (15.9.2026) ─────────
// Genutzt von /api/nachrichten/lead-vorschlag (KI-Vorbelegung), dem Dialog im
// NachrichtenClient und createLeadAusEmail (crm/actions.ts).

export type LeadVorbelegung = {
  anrede: string | null
  vorname: string | null
  nachname: string | null
  firma: string | null
  position: string | null
  email: string | null
  telefon: string | null
  mobil: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  website: string | null
  segment: string | null
  anliegen: string | null
}

export const LEER: LeadVorbelegung = { anrede: null, vorname: null, nachname: null, firma: null, position: null, email: null, telefon: null, mobil: null, strasse: null, plz: null, ort: null, land: null, website: null, segment: null, anliegen: null }

/** HTML zu Text, Zitate/Antwortverläufe grob abschneiden, Länge begrenzen */
export function mailText(bodyText: string | null | undefined, bodyHtml: string | null | undefined): string {
  let t = bodyText && bodyText.trim() ? bodyText : (bodyHtml ?? '')
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
  // Antwortverlauf abschneiden (erste Trennlinie „Von: … Gesendet:“ / „On … wrote:“)
  const cut = t.search(/\n\s*(-{3,}\s*Ursprüngliche Nachricht|Von: .{1,120}\n\s*Gesendet:|From: .{1,120}\n\s*Sent:|Am .{1,120} schrieb .{1,80}:|On .{1,120} wrote:)/)
  if (cut > 40) t = t.slice(0, cut)
  if (t.length > 7000) t = t.slice(0, 2500) + '\n[…]\n' + t.slice(-4500)
  return t
}

