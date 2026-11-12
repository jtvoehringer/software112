import 'server-only'

// ── Jira Service Management: HTTP-Anbindung (KAN-230 Phase 2, 08.10.2026) ────────────────────────────────
//
// Zugang nur serverseitig über JSM_API_EMAIL / JSM_API_TOKEN (Vercel, Production + Preview; Konto mit
// Agent-Rechten in SUP). Ohne beide Variablen ist die Anbindung aus – die Support-Seite zeigt dann nur
// den E-Mail-Kontakt (jsmKonfiguriert()). Das Token geht nie an den Browser.
//
// Ablauf beim Anlegen: Kunde (E-Mail des Benutzers) anlegen bzw. finden → dem Service Desk hinzufügen
// (Kanalzugriff „Eingeschränkt“) → Organisation = Betrieb anlegen bzw. finden und Kunde aufnehmen →
// Anfrage im Namen des Kunden anlegen (raiseOnBehalfOf) → optional Screenshot anhängen → Priorität
// aus der Dringlichkeit setzen (nicht im Kundenformular, deshalb nachträglich als Agent).

import { JSM_SERVICEDESK_ID, JSM_SITE, antwortKommentar, beschreibungOhneKontext, jqlString, kommentarZerlegen, portalLink, RATE_LIMIT } from './anfrage'
import { darfSehen, tenantAusBeschreibung, ticketAus, type SupportTicket, type TicketZugriff } from './tickets'

// KAN-438: Feld-IDs der Service-Desk-Felder (je Site verschieden, deshalb überschreibbar; Vorgaben wie in der Hohenstein Suite)
const FELD_SLA = (process.env.JSM_FELD_SLA ?? '').trim() || 'customfield_10107'                // „Time to resolution“
const FELD_ANFRAGETYP = (process.env.JSM_FELD_ANFRAGETYP ?? '').trim() || 'customfield_10010'  // „Request Type“

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export class JsmFehler extends Error {
  constructor(message: string, readonly status: number = 502) { super(message) }
}

function zugang(): { email: string; token: string } | null {
  const email = (process.env.JSM_API_EMAIL ?? '').trim()
  const token = (process.env.JSM_API_TOKEN ?? '').trim()
  return email && token ? { email, token } : null
}

export function jsmKonfiguriert(): boolean {
  return zugang() !== null
}

async function jsm(pfad: string, init: RequestInit & { roh?: boolean } = {}): Promise<Response> {
  const z = zugang()
  if (!z) throw new JsmFehler('Die Support-Anbindung ist nicht eingerichtet.', 503)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Basic ${Buffer.from(`${z.email}:${z.token}`).toString('base64')}`)
  headers.set('Accept', 'application/json')
  headers.set('X-ExperimentalApi', 'opt-in')
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${JSM_SITE}${pfad}`, { ...init, headers, signal: AbortSignal.timeout(20000), cache: 'no-store' })
}

async function json(pfad: string, init: RequestInit = {}, kontext: string): Promise<R> {
  const r = await jsm(pfad, init)
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error(`[jsm] ${kontext}: HTTP ${r.status} ${text.slice(0, 500)}`)
    throw new JsmFehler(`Support-System nicht erreichbar (${kontext}, HTTP ${r.status}).`)
  }
  return r.status === 204 ? {} : ((await r.json()) as R)
}

// ── Kunde ────────────────────────────────────────────────────────────────────────────────────────────────

export async function kontoZurEmail(email: string): Promise<string | null> {
  const gleich = (u: R) => String(u.emailAddress ?? '').toLowerCase() === email.toLowerCase()
  const liste = await json(`/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=10`, {}, 'Benutzersuche') as unknown as R[]
  const treffer = (Array.isArray(liste) ? liste : []).find(gleich) ?? (Array.isArray(liste) && liste.length === 1 ? liste[0] : null)
  if (treffer?.accountId) return treffer.accountId as string
  // Portal-Kunden findet die Benutzersuche nicht immer – dann die Kunden des Service Desks durchsuchen
  const kunden = await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/customer?query=${encodeURIComponent(email)}&limit=10`, {}, 'Kundensuche')
  const k = ((kunden.values ?? []) as R[]).find(gleich) ?? (((kunden.values ?? []) as R[]).length === 1 ? (kunden.values as R[])[0] : null)
  return (k?.accountId as string | undefined) ?? null
}

/** accountId des Kunden; legt ihn bei Bedarf an und nimmt ihn in den Service Desk auf */
export async function kundeSicherstellen(email: string, anzeigename: string): Promise<string> {
  let accountId = await kontoZurEmail(email)
  if (!accountId) {
    const r = await jsm('/rest/servicedeskapi/customer', { method: 'POST', body: JSON.stringify({ email, displayName: anzeigename || email }) })
    if (r.ok) accountId = ((await r.json()) as R).accountId as string
    else accountId = await kontoZurEmail(email)   // parallel angelegt / schon vorhanden
    if (!accountId) throw new JsmFehler('Ihr Support-Konto konnte nicht angelegt werden.')
  }
  await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/customer`, { method: 'POST', body: JSON.stringify({ accountIds: [accountId] }) }, 'Kunde zuordnen')
  return accountId
}

/** Organisation = Betrieb; Kunde wird Mitglied. Liefert die Organisations-ID (für das Feld „Organizations“
 *  der Anfrage). Fehler hier sind nicht kritisch (nur fürs Teilen im Betrieb) → null. */
export async function organisationZuordnen(betriebName: string, accountId: string): Promise<number | null> {
  try {
    const vorhanden = await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/organization?limit=200`, {}, 'Organisationen')
    let org = ((vorhanden.values ?? []) as R[]).find(o => o.name === betriebName)
    if (!org) {
      org = await json('/rest/servicedeskapi/organization', { method: 'POST', body: JSON.stringify({ name: betriebName }) }, 'Organisation anlegen')
      await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/organization`, { method: 'POST', body: JSON.stringify({ organizationId: Number(org.id) }) }, 'Organisation zuordnen')
    }
    await json(`/rest/servicedeskapi/organization/${org.id}/user`, { method: 'POST', body: JSON.stringify({ accountIds: [accountId] }) }, 'Organisation Mitglied')
    return Number(org.id)
  } catch (e) {
    console.error('[jsm] Organisation nicht zugeordnet:', (e as Error).message)
    return null
  }
}

/** Feld-ID des JSM-Felds „Organizations“ (je Site verschieden, deshalb nachgeschlagen) */
async function organisationsFeldId(): Promise<string | null> {
  const felder = await json('/rest/api/3/field', {}, 'Felder') as unknown as R[]
  const f = (Array.isArray(felder) ? felder : []).find(x => x.schema?.custom === 'com.atlassian.servicedesk:sd-customer-organizations')
  return (f?.id as string | undefined) ?? null
}

// ── Anfrage ──────────────────────────────────────────────────────────────────────────────────────────────

export async function anfragetypId(name: string): Promise<string> {
  const d = await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/requesttype?limit=100`, {}, 'Anfragetypen')
  const t = ((d.values ?? []) as R[]).find(x => x.name === name)
  if (!t) throw new JsmFehler(`Anfragetyp „${name}“ fehlt im Support-System.`)
  return String(t.id)
}

/** Anfragen des Kunden im Rate-Limit-Fenster */
export async function anfragenImFenster(accountId: string): Promise<number> {
  const d = await json('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql: `project = SUP AND reporter = ${jqlString(accountId)} AND created >= -${RATE_LIMIT.minuten}m`, fields: ['key'], maxResults: 20 }),
  }, 'Rate-Limit')
  return ((d.issues ?? []) as R[]).length
}

export type NeueAnfrage = {
  accountId: string
  anfragetypId: string
  betreff: string
  beschreibung: string
  prioritaet: string
  organisationId: number | null
  screenshot: { datei: Blob; name: string } | null
}

export async function anfrageAnlegen(a: NeueAnfrage): Promise<{ key: string; link: string; hinweise: string[] }> {
  const angelegt = await json('/rest/servicedeskapi/request', {
    method: 'POST',
    body: JSON.stringify({
      serviceDeskId: JSM_SERVICEDESK_ID,
      requestTypeId: a.anfragetypId,
      raiseOnBehalfOf: a.accountId,
      requestFieldValues: { summary: a.betreff, description: a.beschreibung },
    }),
  }, 'Anfrage anlegen')
  const key = String(angelegt.issueKey)
  const hinweise: string[] = []

  if (a.screenshot) {
    try {
      const fd = new FormData()
      fd.append('file', a.screenshot.datei, a.screenshot.name)
      const tmp = await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/attachTemporaryFile`, {
        method: 'POST', body: fd, headers: { 'X-Atlassian-Token': 'no-check' },
      }, 'Screenshot hochladen')
      const ids = ((tmp.temporaryAttachments ?? []) as R[]).map(t => t.temporaryAttachmentId)
      await json(`/rest/servicedeskapi/request/${encodeURIComponent(key)}/attachment`, {
        method: 'POST', body: JSON.stringify({ temporaryAttachmentIds: ids, public: true }),
      }, 'Screenshot anhängen')
    } catch (e) {
      console.error('[jsm] Screenshot nicht angehängt:', (e as Error).message)
      hinweise.push('Der Screenshot konnte nicht angehängt werden – bitte im Portal nachreichen.')
    }
  }

  // Priorität und Organisation (Betrieb) setzt der Agent nachträglich – beide stehen nicht im Kundenformular
  try {
    const fields: R = { priority: { name: a.prioritaet } }
    const orgFeld = a.organisationId != null ? await organisationsFeldId() : null
    if (orgFeld) fields[orgFeld] = [a.organisationId]
    await json(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ fields }) }, 'Priorität/Organisation')
  } catch (e) {
    console.error('[jsm] Priorität/Organisation nicht gesetzt:', (e as Error).message)
    try {   // Organisation scheitert z. B., wenn das Feld nicht auf dem Bearbeiten-Screen liegt – Priorität trotzdem setzen
      await json(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ fields: { priority: { name: a.prioritaet } } }) }, 'Priorität')
    } catch (e2) {
      console.error('[jsm] Priorität nicht gesetzt:', (e2 as Error).message)
    }
  }

  return { key, link: portalLink(key), hinweise }
}

export type MeineAnfrage = { key: string; betreff: string; status: string; erledigt: boolean; erstellt: string; link: string }

/** Anfragen, die der Benutzer gemeldet hat (neueste zuerst, höchstens 20) */
export async function meineAnfragen(email: string): Promise<MeineAnfrage[]> {
  const accountId = await kontoZurEmail(email)
  if (!accountId) return []
  const d = await json('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql: `project = SUP AND reporter = ${jqlString(accountId)} ORDER BY created DESC`, fields: ['summary', 'status', 'created'], maxResults: 20 }),
  }, 'Meine Anfragen')
  return ((d.issues ?? []) as R[]).map(i => ({
    key: String(i.key),
    betreff: String(i.fields?.summary ?? ''),
    status: String(i.fields?.status?.name ?? ''),
    erledigt: i.fields?.status?.statusCategory?.key === 'done',
    erstellt: String(i.fields?.created ?? ''),
    link: portalLink(String(i.key)),
  }))
}

// ── KAN-438: alle Anfragen der Betriebe des Benutzers ─────────────────────────────────────────────────────────

/** Wer fragt (Konto in Jira, Betriebe id → Name) und unter welchen JSM-Organisationen seine Betriebe laufen */
export type SupportZugriff = TicketZugriff & { organisationen: readonly string[] }

const TICKET_FELDER = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter', 'created', 'duedate', 'resolutiondate', 'description', FELD_SLA, FELD_ANFRAGETYP]
const TICKETS_MAX = 300

/**
 * Anfragen, die der Benutzer sehen darf (neueste zuerst, höchstens 300): die eigenen und alle Anfragen seiner Betriebe.
 * Jira sucht grob (Melder bzw. Organisation); was davon gezeigt wird, entscheidet danach `darfSehen` über die
 * Mandanten-ID in der Beschreibung – der Name der Organisation allein gibt nie Zugriff.
 */
export async function betriebsAnfragen(z: SupportZugriff): Promise<SupportTicket[]> {
  const teile: string[] = []
  if (z.accountId) teile.push(`reporter = ${jqlString(z.accountId)}`)
  if (z.organisationen.length > 0) {
    // nur Organisationen nennen, die es in JSM gibt – ein unbekannter Name lässt die ganze Suche scheitern
    const vorhanden = await json(`/rest/servicedeskapi/servicedesk/${JSM_SERVICEDESK_ID}/organization?limit=200`, {}, 'Organisationen')
    const namen = new Set(((vorhanden.values ?? []) as R[]).map(o => String(o.name ?? '')))
    const bekannt = z.organisationen.filter(n => namen.has(n))
    if (bekannt.length > 0) teile.push(`organizations in (${bekannt.map(jqlString).join(', ')})`)
  }
  if (teile.length === 0) return []
  const tickets: SupportTicket[] = []
  let seite: string | undefined
  let geladen = 0
  do {
    const d = await json('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql: `project = SUP AND (${teile.join(' OR ')}) ORDER BY created DESC`, fields: TICKET_FELDER, maxResults: 100, ...(seite ? { nextPageToken: seite } : {}) }),
    }, 'Anfragen der Betriebe')
    const issues = (d.issues ?? []) as R[]
    geladen += issues.length
    for (const i of issues) {
      const t = ticketAus(i, z, { sla: FELD_SLA, anfragetyp: FELD_ANFRAGETYP })
      if (t) tickets.push(t)
    }
    seite = typeof d.nextPageToken === 'string' && d.nextPageToken && issues.length > 0 ? d.nextPageToken : undefined
  } while (seite && geladen < TICKETS_MAX)
  return tickets
}

/** Darf der Benutzer diese Anfrage sehen und beantworten? Dieselbe Regel wie in der Liste (eigene bzw. Mandanten-ID). */
export async function anfrageSichtbar(key: string, z: TicketZugriff): Promise<boolean> {
  const r = await jsm(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=reporter,description,project`)
  if (r.status === 404 || r.status === 403) return false
  if (!r.ok) throw new JsmFehler(`Support-System nicht erreichbar (Anfrage, HTTP ${r.status}).`)
  const f = (((await r.json()) as R).fields ?? {}) as R
  if (String(f.project?.key ?? '') !== 'SUP') return false
  return darfSehen({ melderAccountId: (f.reporter?.accountId as string | undefined) ?? null, tenantId: tenantAusBeschreibung(f.description) }, z)
}

// ── KAN-235: eine eigene Anfrage im Detail und Antworten ────────────────────────────────────────────────────

export type AnfrageDetail = {
  key: string
  betreff: string
  beschreibung: string
  status: string
  erledigt: boolean
  erstellt: string
  kommentare: { id: string; vonKunde: boolean; autor: string; text: string; am: string }[]
}

/**
 * Anfrage mit öffentlichen Kommentaren – nur, wenn der Benutzer sie sehen darf (eigene Anfrage bzw. Anfrage eines
 * seiner Betriebe, KAN-438); sonst null (→ 404). Interne Kommentare des Supports bleiben verborgen
 * (public=true, internal=false).
 */
export async function anfrageDetail(z: TicketZugriff, key: string): Promise<AnfrageDetail | null> {
  if (!(await anfrageSichtbar(key, z))) return null
  const r = await jsm(`/rest/servicedeskapi/request/${encodeURIComponent(key)}?expand=status`)
  if (r.status === 404 || r.status === 403) return null
  if (!r.ok) throw new JsmFehler(`Support-System nicht erreichbar (Anfrage, HTTP ${r.status}).`)
  const a = (await r.json()) as R
  const feld = (id: string) => ((a.requestFieldValues ?? []) as R[]).find(f => f.fieldId === id)?.value
  const k = await json(`/rest/servicedeskapi/request/${encodeURIComponent(key)}/comment?public=true&internal=false&limit=100`, {}, 'Kommentare')
  return {
    key,
    betreff: String(feld('summary') ?? ''),
    beschreibung: beschreibungOhneKontext(String(feld('description') ?? '')),
    status: String(a.currentStatus?.status ?? ''),
    erledigt: a.currentStatus?.statusCategory === 'DONE',
    erstellt: String(a.createdDate?.iso8601 ?? ''),
    kommentare: ((k.values ?? []) as R[]).filter(c => c.public !== false).map(c => {
      const z = kommentarZerlegen(String(c.body ?? ''))
      return {
        id: String(c.id),
        vonKunde: z.vonKunde,
        autor: z.vonKunde ? (z.name ?? 'Kunde') : 'Support',
        text: z.text,
        am: String(c.created?.iso8601 ?? ''),
      }
    }),
  }
}

/** Antwort als öffentlicher Kommentar – vorher wie anfrageDetail prüfen, ob der Benutzer die Anfrage sehen darf */
export async function antwortSenden(key: string, benutzer: string, text: string): Promise<void> {
  await json(`/rest/servicedeskapi/request/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body: antwortKommentar(benutzer, text), public: true }),
  }, 'Antwort')
}
