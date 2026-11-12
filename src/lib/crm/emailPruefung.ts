// ── E-Mail-Adressen der Kontakte prüfen (KAN-424, 12.11.2026) ────────────────────────────────────────────────────────
//
// Drei Prüfungen, alle ohne Zugriff auf fremde Postfächer (Entscheidung Jörgen 12.11.2026: A + B + D, keine
// Postfach-Probe per SMTP):
//   A  Schreibweise – das Muster aus lib/crm/email plus Tippfehler bekannter Domains („gmial.com“)
//   B  Domain       – nimmt die Domain E-Mails an (MX, ersatzweise A-Eintrag)? Ein Netzfehler heißt „nicht geprüft“,
//                     nie „ungültig“.
//   D  Rückläufer   – Adressen, die im Brevo-Konto des Betriebs hart zurückgekommen sind (reason.code hardBounce)
// Ergebnis ist nur ein Kennzeichen am Kontakt (kontakte.email_pruefung) – nichts wird automatisch geändert oder gelöscht.
// Isomorph, ohne '@/'-Importe (node:test) – der Lauf selbst steht in emailPruefungLauf.ts.

// @ts-expect-error TS5097 – node:test lädt ohne Bundler, deshalb mit Endung
import { EMAIL_RE } from './email.ts'

export type EmailPruefung = 'schreibweise' | 'domain' | 'ruecklaeufer' | 'bestaetigt'
/** Kennzeichen, die in Liste und Detail als „E-Mail prüfen“ erscheinen */
export const EMAIL_AUFFAELLIG: readonly EmailPruefung[] = ['schreibweise', 'domain', 'ruecklaeufer']

/** höchstens so viele Kontakte je Betrieb und Lauf */
export const EMAIL_LAUF_MENGE = 300
/** frühestens nach so vielen Tagen wird eine Adresse erneut geprüft */
export const EMAIL_WIEDER_TAGE = 90
export const EMAIL_HINWEIS_MAX = 200

/** Vertipper bekannter Domains → richtige Domain. Bewusst kurz und eindeutig: nur Schreibweisen, die es als
 *  Mail-Domain nicht gibt bzw. die praktisch immer ein Tippfehler sind. */
export const DOMAIN_TIPPFEHLER: Readonly<Record<string, string>> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gnail.com': 'gmail.com',
  'googlemail.con': 'googlemail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'icloud.con': 'icloud.com', 'iclud.com': 'icloud.com',
  'gmx.att': 'gmx.at', 'gmx.ta': 'gmx.at', 'gmx.nte': 'gmx.net', 'gmx.ent': 'gmx.net', 'gmx.dee': 'gmx.de',
  'aon.att': 'aon.at', 'aon.ta': 'aon.at', 'a1.ner': 'a1.net', 'chello.att': 'chello.at',
  'web.dee': 'web.de', 't-online.dee': 't-online.de',
}

export function domainVon(email: string | null | undefined): string | null {
  const t = (email ?? '').trim().toLowerCase()
  const i = t.lastIndexOf('@')
  return i > 0 && i < t.length - 1 ? t.slice(i + 1) : null
}

export type PruefErgebnis = { status: EmailPruefung; hinweis: string }

/** Prüfung A; null = unauffällig */
export function pruefeSchreibweise(email: string | null | undefined): PruefErgebnis | null {
  const t = (email ?? '').trim()
  if (!t) return null
  if (!EMAIL_RE.test(t)) return { status: 'schreibweise', hinweis: 'Die Adresse ist nicht richtig geschrieben.' }
  const d = domainVon(t)
  const richtig = d ? DOMAIN_TIPPFEHLER[d] : undefined
  return richtig ? { status: 'schreibweise', hinweis: `Vermutlich ein Tippfehler in der Domain (${richtig}?).` } : null
}

/** DNS-Abfragen des Laufs (im Test eine Attrappe); beide liefern die Anzahl der Einträge oder werfen mit `code` */
export type DnsAbfrage = { mx: (domain: string) => Promise<number>; a: (domain: string) => Promise<number> }
export type DomainUrteil = 'ok' | 'ungueltig' | 'unbekannt'

/** DNS-Fehler, die sicher „gibt es nicht“ bedeuten – alles andere (Zeitlimit, SERVFAIL, Netz) ist „unbekannt“ */
const GIBT_ES_NICHT = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN'])
const code = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '')

/** Prüfung B: MX-Eintrag, ersatzweise A-Eintrag (RFC 5321: ohne MX gilt die Adresse des Hosts) */
export async function pruefeDomain(domain: string, dns: DnsAbfrage): Promise<DomainUrteil> {
  let ohneMx = false
  try {
    if (await dns.mx(domain) > 0) return 'ok'
    ohneMx = true
  } catch (e) {
    if (!GIBT_ES_NICHT.has(code(e))) return 'unbekannt'
    ohneMx = true
  }
  if (!ohneMx) return 'unbekannt'
  try {
    return await dns.a(domain) > 0 ? 'ok' : 'ungueltig'
  } catch (e) {
    return GIBT_ES_NICHT.has(code(e)) ? 'ungueltig' : 'unbekannt'
  }
}

export const DOMAIN_HINWEIS = 'Die Domain nimmt keine E-Mails an.'
export const RUECKLAEUFER_HINWEIS = 'Eine E-Mail an diese Adresse kam als unzustellbar zurück (Newsletter-Konto).'

/** Prüfung D: Adressen mit hartem Rückläufer aus der Brevo-Antwort (GET /smtp/blockedContacts), klein geschrieben */
export function ruecklaeuferAus(contacts: unknown): string[] {
  if (!Array.isArray(contacts)) return []
  const aus = new Set<string>()
  for (const c of contacts) {
    const r = c as { email?: unknown; reason?: { code?: unknown } } | null
    if (r && r.reason?.code === 'hardBounce' && typeof r.email === 'string' && r.email.includes('@')) aus.add(r.email.trim().toLowerCase())
  }
  return [...aus]
}

/** Ist der Kontakt in Liste und Detail als „E-Mail prüfen“ zu kennzeichnen? */
export function emailAuffaellig(k: { email_pruefung?: string | null } | null | undefined): boolean {
  return !!k?.email_pruefung && (EMAIL_AUFFAELLIG as readonly string[]).includes(k.email_pruefung)
}

/** Lässt sich das Kennzeichen von Hand aufheben („Adresse ist in Ordnung“)? Ein Rückläufer ist ein Nachweis –
 *  er fällt erst mit einer geänderten Adresse weg. */
export function emailBestaetigbar(k: { email_pruefung?: string | null } | null | undefined): boolean {
  return k?.email_pruefung === 'schreibweise' || k?.email_pruefung === 'domain'
}

export function emailPruefText(k: { email_pruefung?: string | null; email_pruef_hinweis?: string | null }): string {
  if (!emailAuffaellig(k)) return ''
  return k.email_pruef_hinweis?.trim() || (k.email_pruefung === 'ruecklaeufer' ? RUECKLAEUFER_HINWEIS : k.email_pruefung === 'domain' ? DOMAIN_HINWEIS : 'Die Adresse ist auffällig.')
}

/** Ab wann eine Adresse wieder zu prüfen ist (ISO-Zeitpunkt): alles, was davor zuletzt geprüft wurde */
export function wiederZuPruefenVor(jetzt: Date): string {
  return new Date(jetzt.getTime() - EMAIL_WIEDER_TAGE * 24 * 60 * 60 * 1000).toISOString()
}
