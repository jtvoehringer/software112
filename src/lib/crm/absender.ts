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

import { alle } from '@/lib/supabase/alle'

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
  kontakte: Map<string, AbsenderTreffer>          // email (Standard + weitere, Migration 211) → Kontakt
  firmen: Map<string, AbsenderTreffer>            // email → Firma
  firmenDomains: Map<string, AbsenderTreffer>     // domain → Firma
  ignoriert: Set<string>                          // email
  eigene: Set<string>                             // eigene Postfächer (email)
  eigeneDomains: Set<string>
  namen: Map<string, (AbsenderTreffer & { email: string | null })[]>  // normalisierter Name → Kontakte/Firmen (Hinweis „bereits unter anderer Adresse“)
}

/** Name für den Vergleich: klein, ohne Akzente/Satzzeichen, Wörter sortiert („Vöhringer Jörgen“ = „jörgen vöhringer“) */
export function normName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(w => w.length > 1).sort().join(' ')
}

/**
 * Index über alle Kontakte/Firmen des Betriebs aufbauen (drei kleine Abfragen).
 * `eigeneAdressen`: verbundenes Postfach, geteilte Mailbox usw.
 */
// Rohdaten je Betrieb kurz zwischenspeichern (18.9.2026): der Index wird bei
// jeder Nachrichtenliste und jedem Öffnen einer Mail gebaut; mit 8.300 Kontakten
// sind das neun 1.000er-Blöcke. 60 s Cache je Serverinstanz reichen, damit das
// Blättern im Postfach nicht jedes Mal den ganzen Bestand lädt.
const rohCache = new Map<string, { stamp: number; kRaw: R[]; fRaw: R[]; iRaw: R[] }>()
const ROH_CACHE_MS = 60 * 1000
export function absenderIndexVerwerfen(tenantId?: string) { if (tenantId) rohCache.delete(tenantId); else rohCache.clear() }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAbsenderIndex(client: any, tenantId: string, eigeneAdressen: (string | null | undefined)[] = []): Promise<AbsenderIndex> {
  // WICHTIG: alle() statt direktem await - PostgREST liefert höchstens 1.000
  // Zeilen. Fehlerbild 18.9.2026: Kontakt AN-15538 (judi_liu@hotmail.com) war im
  // CRM, die Erkennung fand ihn nicht, weil er jenseits der ersten 1.000 Zeilen
  // lag - jede Mail von ihm wurde erneut als Lead vorgeschlagen.
  let roh = rohCache.get(tenantId)
  if (!roh || Date.now() - roh.stamp > ROH_CACHE_MS) {
    const [{ data: kRaw, error: kErr }, { data: fRaw, error: fErr }, { data: iRaw, error: iErr }] = await Promise.all([
      alle((client.from('kontakte') as any).select('id, vorname, nachname, email, email_weitere, accountnummer, is_lead, firma_id').eq('tenant_id', tenantId).eq('aktiv', true).order('id')),
      alle((client.from('firmen') as any).select('id, name, email, email_weitere, website, accountnummer, is_lead').eq('tenant_id', tenantId).eq('aktiv', true).order('id')),
      alle((client.from('email_lead_ignoriert') as any).select('email').eq('tenant_id', tenantId).order('email')),
    ])
    // KAN-254: sonst würde ein leerer Index 60 s zwischengespeichert – jeder Absender „unbekannt“, Lead-Vorschläge für Kunden
    const ladeFehler = kErr ?? fErr ?? iErr
    if (ladeFehler) throw new Error(`Kontakte/Firmen für die Absender-Erkennung konnten nicht geladen werden: ${ladeFehler.message}`)
    roh = { stamp: Date.now(), kRaw: (kRaw ?? []) as R[], fRaw: (fRaw ?? []) as R[], iRaw: (iRaw ?? []) as R[] }
    rohCache.set(tenantId, roh)
  }
  const { kRaw, fRaw, iRaw } = roh
  const idx: AbsenderIndex = { kontakte: new Map(), firmen: new Map(), firmenDomains: new Map(), ignoriert: new Set(), eigene: new Set(), eigeneDomains: new Set(), namen: new Map() }
  const merkeName = (name: string, t: AbsenderTreffer, email: string | null) => {
    const n = normName(name); if (!n) return
    const l = idx.namen.get(n) ?? []; l.push({ ...t, email }); idx.namen.set(n, l)
  }

  const firmenById = new Map<string, AbsenderTreffer>()
  for (const f of (fRaw ?? []) as R[]) {
    const t: AbsenderTreffer = { typ: 'firma', id: f.id, name: f.name, accountnummer: f.accountnummer ?? null, istLead: !!f.is_lead, ueber: 'email' }
    firmenById.set(f.id, t)
    const e = normEmail(f.email)
    if (e) idx.firmen.set(e, t)
    for (const w of ((f.email_weitere ?? []) as string[])) { const we = normEmail(w); if (we && !idx.firmen.has(we)) idx.firmen.set(we, t) }
    merkeName(f.name, t, e || null)
    for (const d of [domainVon(f.email), domainAusWebsite(f.website)]) {
      if (d && !FREEMAIL_DOMAINS.has(d) && !idx.firmenDomains.has(d)) idx.firmenDomains.set(d, { ...t, ueber: 'domain' })
    }
  }
  for (const k of (kRaw ?? []) as R[]) {
    const t: AbsenderTreffer = { typ: 'kontakt', id: k.id, name: [k.vorname, k.nachname].filter(Boolean).join(' ') || '(ohne Namen)', accountnummer: k.accountnummer ?? null, istLead: !!k.is_lead, ueber: 'email' }
    const e = normEmail(k.email)
    merkeName(t.name, t, e || null)
    const adressen = [e, ...((k.email_weitere ?? []) as string[]).map(normEmail)].filter(Boolean)
    for (const a of adressen) {
      if (!idx.kontakte.has(a)) idx.kontakte.set(a, t)
      // Ansprechperson einer Firma: deren Domain zählt für die Firma
      const d = domainVon(a)
      if (k.firma_id && d && !FREEMAIL_DOMAINS.has(d) && !idx.firmenDomains.has(d)) {
        const f = firmenById.get(k.firma_id)
        if (f) idx.firmenDomains.set(d, { ...f, ueber: 'domain' })
      }
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

/**
 * Unbekannte Adresse, aber der Anzeigename passt zu einem bestehenden Kontakt
 * oder einer Firma (Rückmeldung 18.9.2026: „wenn ein bestehender Lead/Kunde mit
 * einer anderen E-Mail hereinkommt, darauf hinweisen“). Liefert die Treffer,
 * damit die Oberfläche das Hinzufügen der Adresse anbieten kann.
 */
export function findeNamensgleiche(idx: AbsenderIndex, name: string | null | undefined): (AbsenderTreffer & { email: string | null })[] {
  const n = normName(name)
  if (!n || n.split(' ').length < 2) return []   // ein einzelnes Wort ist zu unspezifisch
  return idx.namen.get(n) ?? []
}
