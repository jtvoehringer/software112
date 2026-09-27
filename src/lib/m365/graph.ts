import { decryptPass, encryptPass } from '@/lib/email/crypto'
import { ereignisMelden } from '@/lib/system/ereignis'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// Delegierte Berechtigungen (18.9.2026: geteilte Mailbox lieferte 403
// ErrorAccessDenied trotz Vollzugriff): für /users/<geteilte Mailbox>/… braucht
// Graph zusätzlich die *.Shared-Scopes - Mail.ReadWrite allein gilt nur für
// das eigene Postfach (/me). Die App-Registrierung in Entra muss diese
// Berechtigungen ebenfalls führen, danach „Trennen & neu verbinden“.
export const M365_SCOPE = 'offline_access Mail.ReadWrite Mail.ReadWrite.Shared Mail.Send Mail.Send.Shared Calendars.Read'
// Erweiterung (22.9.2026): Termine aus dem CRM in Outlook anlegen (Einladung an Kollegen).
// Wird nur angefordert, wenn tenant_einstellungen.m365_kalender_schreiben gesetzt ist –
// die Entra-App muss Calendars.ReadWrite führen, sonst scheitert die Anmeldung.
export const M365_SCOPE_KALENDER = `${M365_SCOPE} Calendars.ReadWrite`

/** Scope für einen Betrieb: erweitert, wenn der Kalender-Schreibschalter gesetzt ist */
export function m365ScopeFuer(tenantCfg: R | null | undefined): string {
  return tenantCfg?.m365_kalender_schreiben ? M365_SCOPE_KALENDER : M365_SCOPE
}

/** Hat die Benutzer-Verbindung das Schreibrecht auf den Kalender erhalten? */
export function hatKalenderSchreibrecht(userCfg: R | null | undefined): boolean {
  return typeof userCfg?.m365_scope === 'string' && userCfg.m365_scope.includes('Calendars.ReadWrite')
}

export function m365AuthUrl(tenantId: string, clientId: string, redirectUri: string, state: string, scope: string = M365_SCOPE): string {
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope,
    state,
    response_mode: 'query',
  })
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
}

export async function exchangeCodeForTokens(
  tenantId: string, clientId: string, clientSecret: string,
  code: string, redirectUri: string, scope: string = M365_SCOPE
): Promise<{ access_token: string; refresh_token: string; expires_in: number; scope?: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      code, redirect_uri: redirectUri, grant_type: 'authorization_code',
      scope,
    }),
  })
  if (!res.ok) throw new Error(`Token-Austausch fehlgeschlagen: ${await res.text()}`)
  return res.json()
}

export async function refreshAccessToken(
  tenantId: string, clientId: string, clientSecret: string, refreshToken: string, scope: string = M365_SCOPE
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
      scope,
    }),
  })
  if (!res.ok) throw new Error(`Token-Refresh fehlgeschlagen: ${await res.text()}`)
  return res.json()
}

export async function graphGet(accessToken: string, path: string): Promise<R> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Graph GET ${path} fehlgeschlagen: ${res.status}`)
  return res.json()
}

export async function graphPost(accessToken: string, path: string, body: unknown): Promise<R | null> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Graph POST ${path} fehlgeschlagen: ${res.status} ${await res.text()}`)
  return (res.status === 202 || res.status === 204) ? null : res.json()
}

// Gültigen Access-Token aus DB laden (ggf. refreshen)
export async function getValidAccessToken(cfg: R, admin: R): Promise<string> {
  if (!cfg.m365_access_token_enc || !cfg.m365_refresh_token_enc)
    throw new Error('M365 nicht verbunden – bitte OAuth2-Verbindung in den Admin-Einstellungen herstellen')

  const expiresAt = cfg.m365_token_expires_at ? new Date(cfg.m365_token_expires_at) : new Date(0)
  const needsRefresh = expiresAt.getTime() - Date.now() < 5 * 60 * 1000  // 5 min Puffer

  if (!needsRefresh) return decryptPass(cfg.m365_access_token_enc)

  // Token erneuern
  const clientSecret = decryptPass(cfg.m365_client_secret_enc)
  const refreshToken = decryptPass(cfg.m365_refresh_token_enc)
  const tokens = await refreshAccessToken(cfg.m365_tenant_id, cfg.m365_client_id, clientSecret, refreshToken)

  // In DB speichern
  { const { error: e } = await (admin.from('tenant_einstellungen') as any).update({
    m365_access_token_enc:  encryptPass(tokens.access_token),
    ...(tokens.refresh_token ? { m365_refresh_token_enc: encryptPass(tokens.refresh_token) } : {}),
    m365_token_expires_at:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('tenant_id', cfg.tenant_id)
    if (e) void ereignisMelden({ art: 'db', quelle: 'm365/tenant_einstellungen', meldung: e.message }) }

  return tokens.access_token
}


// Per-User Token: App-Credentials aus tenantCfg, User-Token aus userCfg
//
// tenantId/userId als eigene Parameter (statt aus userCfg.id): jeder bisherige Aufrufer
// selektiert user_email_connections OHNE 'id' in der select()-Liste (nur die m365_/imap_-
// Felder), d.h. userCfg.id war hier bereits vorher immer undefined und das .eq('id', ...)
// beim Update hat still KEINE Zeile getroffen - der aktualisierte Token wurde also nie
// gespeichert. Zusätzlich fehlte hier die für diese App sonst überall verbindliche
// tenant_id-Filterung (RLS allein reicht nicht, siehe check-tenant-isolation.js). Da jeder
// Aufrufer tenantId (aus getCurrentMembership()) und die User-Id ohnehin schon zur Hand hat
// (beides wird für die vorausgehende user_email_connections-Abfrage gebraucht), ist das
// Durchreichen hier der korrekte, minimal-invasive Fix für beide Probleme gleichzeitig.
//
// KAN-135: `admin` muss der Service-Role-Client sein – Benutzer haben auf
// user_email_connections weder UPDATE noch SELECT auf die Token-Spalten. tenantId
// kommt aus der Mitgliedschaft, userId aus getUser() (bzw. der Zeile beim Cron).
export async function getValidUserAccessToken(
  userCfg: R, tenantCfg: R, admin: R, tenantId: string, userId: string
): Promise<string> {
  if (!userCfg.m365_access_token_enc) throw new Error('Mailbox nicht verbunden')

  const expiresAt = userCfg.m365_token_expires_at ? new Date(userCfg.m365_token_expires_at) : new Date(0)
  const needsRefresh = expiresAt.getTime() - Date.now() < 5 * 60 * 1000

  if (!needsRefresh) return decryptPass(userCfg.m365_access_token_enc)

  // Token erneuern: App-Credentials aus tenant_einstellungen
  const clientSecret  = decryptPass(tenantCfg.m365_client_secret_enc)
  const refreshToken  = decryptPass(userCfg.m365_refresh_token_enc)
  // 'common' für multi-tenant: funktioniert für alle Microsoft-Tenants
  // Refresh mit genau dem Scope, den die Verbindung erhalten hat (Altverbindungen: Basis-Scope) –
  // ein größerer Scope als konsentiert würde den Refresh und damit das ganze Postfach blockieren.
  const tokens = await refreshAccessToken(
    'common', tenantCfg.m365_client_id, clientSecret, refreshToken,
    (userCfg.m365_scope as string | null) || M365_SCOPE
  )

  // Neuen Token in user_email_connections speichern - eindeutig über (tenant_id, user_id)
  // identifiziert (der Primärschlüssel 'id' steht hier wie erläutert nicht zur Verfügung).
  { const { error: e } = await (admin.from('user_email_connections') as any).update({
    m365_access_token_enc:  encryptPass(tokens.access_token),
    ...(tokens.refresh_token ? { m365_refresh_token_enc: encryptPass(tokens.refresh_token) } : {}),
    m365_token_expires_at:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    aktualisiert_am:        new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('user_id', userId)
    if (e) void ereignisMelden({ art: 'db', quelle: 'm365/user_email_connections', meldung: e.message }) }

  return tokens.access_token
}

// Basis-URL für Graph-Mailbox-Aufrufe (Nachrichten-Modul).
//
// Vorher wurde userCfg.monitored_email allein als globaler Schalter benutzt:
// war eine geteilte Mailbox hinterlegt, zeigten ALLE Ansichten (Ordner, Liste,
// Detail, Löschen) ausschließlich diese - die eigene Mailbox war dann gar
// nicht mehr erreichbar. Jetzt bestimmt der pro Request mitgegebene 'mailbox'-
// Parameter ('own' = Standard, 'shared'), welche Mailbox angefragt wird, damit
// beide additiv nebeneinander angezeigt werden können (s. NachrichtenClient.tsx
// activeMailbox). Fällt auf 'own' zurück, falls 'shared' angefragt wird, aber
// keine geteilte Mailbox hinterlegt ist.
export function getMailboxBase(userCfg: R, mailbox: 'own' | 'shared' = 'own'): string {
  const monitoredEmail = userCfg?.monitored_email as string | undefined
  if (mailbox === 'shared' && monitoredEmail) {
    return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(monitoredEmail)}`
  }
  return 'https://graph.microsoft.com/v1.0/me'
}

// ── Kalender: Termin anlegen (mit Einladung) und Frei/Belegt der Kollegen ───────
// Termin entsteht im Kalender des angemeldeten Benutzers; Kollegen stehen als
// Teilnehmer drauf und bekommen die Einladung von Outlook zugestellt – so landet
// der Termin ohne Zugriff auf fremde Kalender bei allen Beteiligten.

export const M365_ZEITZONE = 'W. Europe Standard Time'

export type KalenderTermin = {
  betreff: string
  /** YYYY-MM-DD */
  datum: string
  /** Enddatum (Ganztags, mehrtägig) – inklusive */
  bisDatum?: string | null
  ganztags: boolean
  /** HH:MM */
  von?: string | null
  bis?: string | null
  beschreibung?: string | null
  ort?: string | null
  teilnehmer: { email: string; name?: string | null }[]
}

export async function kalenderTerminAnlegen(accessToken: string, t: KalenderTermin): Promise<{ id: string; webLink: string | null }> {
  const start = t.ganztags ? `${t.datum}T00:00:00` : `${t.datum}T${t.von ?? '09:00'}:00`
  let end: string
  if (t.ganztags) {
    // Graph: Ganztags-Ende ist exklusiv (Folgetag 00:00)
    const e = new Date(`${t.bisDatum || t.datum}T00:00:00Z`); e.setUTCDate(e.getUTCDate() + 1)
    end = `${e.toISOString().slice(0, 10)}T00:00:00`
  } else {
    end = `${t.datum}T${t.bis ?? t.von ?? '10:00'}:00`
    if (end <= start) { const [h, m] = (t.von ?? '09:00').split(':').map(Number); end = `${t.datum}T${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00` }
  }
  const body = {
    subject: t.betreff,
    body: { contentType: 'text', content: (t.beschreibung ?? '') + '\n\n– angelegt in software:112' },
    start: { dateTime: start, timeZone: M365_ZEITZONE },
    end:   { dateTime: end,   timeZone: M365_ZEITZONE },
    isAllDay: t.ganztags,
    location: t.ort ? { displayName: t.ort } : undefined,
    attendees: t.teilnehmer.map(p => ({ emailAddress: { address: p.email, name: p.name ?? undefined }, type: 'required' })),
  }
  const res = await graphPost(accessToken, '/me/events', body)
  return { id: (res?.id as string) ?? '', webLink: (res?.webLink as string) ?? null }
}

export type FreiBelegt = { email: string; verfuegbar: boolean; belegt: { von: string; bis: string; status: string; betreff?: string | null }[]; fehler?: string }

/** Frei/Belegt-Zeiten (getSchedule) für bis zu 20 Adressen in einem Zeitraum – braucht nur Calendars.Read */
export async function kalenderFreiBelegt(accessToken: string, emails: string[], start: string, end: string): Promise<FreiBelegt[]> {
  if (emails.length === 0) return []
  const res = await fetch(`${GRAPH_BASE}/me/calendar/getSchedule`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: `outlook.timezone="${M365_ZEITZONE}"` },
    body: JSON.stringify({
      schedules: emails.slice(0, 20),
      startTime: { dateTime: start, timeZone: M365_ZEITZONE },
      endTime:   { dateTime: end,   timeZone: M365_ZEITZONE },
      availabilityViewInterval: 30,
    }),
  })
  if (!res.ok) throw new Error(`Graph getSchedule fehlgeschlagen: ${res.status} ${(await res.text()).slice(0, 300)}`)
  const data = await res.json() as R
  return ((data.value ?? []) as R[]).map(s => ({
    email: s.scheduleId as string,
    verfuegbar: !s.error,
    fehler: s.error?.message as string | undefined,
    belegt: ((s.scheduleItems ?? []) as R[])
      .filter(i => i.status !== 'free')
      .map(i => ({ von: String(i.start?.dateTime ?? '').slice(11, 16), bis: String(i.end?.dateTime ?? '').slice(11, 16), status: i.status as string, betreff: (i.subject as string | null) ?? null })),
  }))
}

export { encryptPass, decryptPass }
