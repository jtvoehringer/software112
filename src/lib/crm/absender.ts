// ── Absender-Erkennung für Nachrichten (E-Mail → Lead, 15.9.2026) ────────────
// Ordnet eine Absenderadresse einem Kontakt oder einer Firma des Betriebs zu:
//   1. exakte E-Mail (klein geschrieben) auf kontakte.email bzw. firmen.email
//   2. Domain-Treffer auf firmen.email / firmen.website / E-Mails der
//      Ansprechpersonen (nur bei Firmendomains, nicht bei gmx/gmail & Co.)
// Leads zählen als bekannt (istLead = true, damit die Oberfläche „Lead“ zeigt).
// Systemadressen (noreply, newsletter, mailer-daemon …), eigene Postfächer und
// die Ignorier-Liste (email_lead_ignoriert, Migration 202) bekommen keinen
// Lead-Vorschlag. Wird vom Nachrichten-Endpoint (Einzelmail) und von der
// Nachrichtenliste (Markierung „neu“) gemeinsam genutzt.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AbsenderTreffer = {
  typ: 'kontakt' | 'firma'
  id: string
  name: string
  accountnummer: string | null
  istLead: boolean
  ueber: 'email' | 'domain'
}

export type AbsenderStatus = 'kontakt' | 'firma' | 'lead' | 'unbekannt' | 'ignoriert' | 'system' | 'eigen'

/** Freemail-/Provider-Domains: kein Domain-Matching, nur exakte Adresse */
export const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'gmx.at', 'gmx.de', 'gmx.net', 'gmx.ch', 'web.de', 'yahoo.com', 'yahoo.de', 'yahoo.at',
  'hotmail.com', 'hotmail.de', 'hotmail.at', 'outlook.com', 'outlook.de', 'outlook.at', 'live.com', 'live.de', 'live.at', 'msn.com',
  'aon.at', 'a1.net', 'chello.at', 'kabsi.at', 'drei.at', 'tmo.at', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  't-online.de', 'freenet.de', 'posteo.de', 'mail.com', 'email.com', 'aol.com', 'bluewin.ch', 'sunrise.ch', 'liwest.at', 'inode.at', 'utanet.at',
])

const SYSTEM_MUSTER = /^(no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|postmaster|newsletter|news|notification[s]?|alert[s]?|bounce[s]?|automail|auto-?mailer|support|info@.*\.(microsoft|google|apple|amazon|paypal|stripe|vercel|supabase)\.)/i

export function normEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export function domainVon(email: string | null | undefined): string | null {
  const e = normEmail(email)
  const at = e.lastIndexOf('@')
  if (at < 0) return null
  return e.slice(at + 1)
}

/** Domain aus einer Website-Angabe (https://www.weingut-x.at/… → weingut-x.at) */
export function domainAusWebsite(website: string | null | undefined): string | null {
  if (!website) return null
  let w = website.trim().toLowerCase()
  w = w.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  w = w.split(/[/?#]/)[0]
  return w.includes('.') ? w : null
}

/** Automatische Absender (Newsletter, Systemmails) - kein Lead-Vorschlag */
export function istSystemAbsender(email: string | null | undefined, name?: string | null): boolean {
  const e = normEmail(email)
  if (!e) return true
  if (SYSTEM_MUSTER.test(e)) return true
  if (/(unsubscribe|abmelden)/i.test(name ?? '')) return true
  return false
}

export type AbsenderIndex = {
  kontakte: Map<string, AbsenderTreffer>          // email → Kontakt
  firmen: Map<string, AbsenderTreffer>            // email → Firma
  firmenDomains: Map<string, AbsenderTreffer>     // domain → Firma
  ignoriert: Set<string>                          // email
  eigene: Set<string>                             // eigene Postfächer (email)
  eigeneDomains: Set<string>
}

/**
 * Index über alle Kontakte/Firmen des Betriebs aufbauen (drei kleine Abfragen).
 * `eigeneAdressen`: verbundenes Postfach, geteilte Mailbox usw.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAbsenderIndex(client: any, tenantId: string, eigeneAdressen: (string | null | undefined)[] = []): Promise<AbsenderIndex> {
  const [{ data: kRaw }, { data: fRaw }, { data: iRaw }] = await Promise.all([
    (client.from('kontakte') as any).select('id, vorname, nachname, email, accountnummer, is_lead, firma_id').eq('tenant_id', tenantId).not('email', 'is', null),
    (client.from('firmen') as any).select('id, name, email, website, accountnummer, is_lead').eq('tenant_id', tenantId),
    (client.from('email_lead_ignoriert') as any).select('email').eq('tenant_id', tenantId),
  ])
  const idx: AbsenderIndex = { kontakte: new Map(), firmen: new Map(), firmenDomains: new Map(), ignoriert: new Set(), eigene: new Set(), eigeneDomains: new Set() }

  const firmenById = new Map<string, AbsenderTreffer>()
  for (const f of (fRaw ?? []) as R[]) {
    const t: AbsenderTreffer = { typ: 'firma', id: f.id, name: f.name, accountnummer: f.accountnummer ?? null, istLead: !!f.is_lead, ueber: 'email' }
    firmenById.set(f.id, t)
    const e = normEmail(f.email)
    if (e) idx.firmen.set(e, t)
    for (const d of [domainVon(f.email), domainAusWebsite(f.website)]) {
      if (d && !FREEMAIL_DOMAINS.has(d) && !idx.firmenDomains.has(d)) idx.firmenDomains.set(d, { ...t, ueber: 'domain' })
    }
  }
  for (const k of (kRaw ?? []) as R[]) {
    const e = normEmail(k.email)
    if (!e) continue
    idx.kontakte.set(e, { typ: 'kontakt', id: k.id, name: [k.vorname, k.nachname].filter(Boolean).join(' ') || '(ohne Namen)', accountnummer: k.accountnummer ?? null, istLead: !!k.is_lead, ueber: 'email' })
    // Ansprechperson einer Firma: deren Domain zählt für die Firma
    const d = domainVon(e)
    if (k.firma_id && d && !FREEMAIL_DOMAINS.has(d) && !idx.firmenDomains.has(d)) {
      const f = firmenById.get(k.firma_id)
      if (f) idx.firmenDomains.set(d, { ...f, ueber: 'domain' })
    }
  }
  for (const i of (iRaw ?? []) as R[]) { const e = normEmail(i.email); if (e) idx.ignoriert.add(e) }
  for (const a of eigeneAdressen) {
    const e = normEmail(a)
    if (!e) continue
    idx.eigene.add(e)
    const d = domainVon(e)
    if (d && !FREEMAIL_DOMAINS.has(d)) idx.eigeneDomains.add(d)
  }
  return idx
}

/** Treffer für eine Adresse (exakt vor Domain) */
export function findeAbsender(idx: AbsenderIndex, email: string | null | undefined): AbsenderTreffer | null {
  const e = normEmail(email)
  if (!e) return null
  const k = idx.kontakte.get(e); if (k) return k
  const f = idx.firmen.get(e); if (f) return f
  const d = domainVon(e)
  if (d && !FREEMAIL_DOMAINS.has(d)) { const fd = idx.firmenDomains.get(d); if (fd) return fd }
  return null
}

/** Status für die Oberfläche: bekannt (kontakt/firma/lead) oder warum kein Lead-Vorschlag */
export function absenderStatus(idx: AbsenderIndex, email: string | null | undefined, name?: string | null): { status: AbsenderStatus; treffer: AbsenderTreffer | null } {
  const e = normEmail(email)
  const treffer = findeAbsender(idx, e)
  if (treffer) return { status: treffer.istLead ? 'lead' : treffer.typ, treffer }
  if (!e) return { status: 'system', treffer: null }
  if (idx.eigene.has(e) || (domainVon(e) && idx.eigeneDomains.has(domainVon(e)!))) return { status: 'eigen', treffer: null }
  if (idx.ignoriert.has(e)) return { status: 'ignoriert', treffer: null }
  if (istSystemAbsender(e, name)) return { status: 'system', treffer: null }
  return { status: 'unbekannt', treffer: null }
}
