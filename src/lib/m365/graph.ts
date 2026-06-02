import { decryptPass, encryptPass } from '@/lib/email/crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export function m365AuthUrl(tenantId: string, clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'offline_access Mail.Read Mail.Send',
    state,
    response_mode: 'query',
  })
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
}

export async function exchangeCodeForTokens(
  tenantId: string, clientId: string, clientSecret: string,
  code: string, redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      code, redirect_uri: redirectUri, grant_type: 'authorization_code',
      scope: 'offline_access Mail.Read Mail.Send',
    }),
  })
  if (!res.ok) throw new Error(`Token-Austausch fehlgeschlagen: ${await res.text()}`)
  return res.json()
}

export async function refreshAccessToken(
  tenantId: string, clientId: string, clientSecret: string, refreshToken: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
      scope: 'offline_access Mail.Read Mail.Send',
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
  await (admin.from('tenant_einstellungen') as any).update({
    m365_access_token_enc:  encryptPass(tokens.access_token),
    ...(tokens.refresh_token ? { m365_refresh_token_enc: encryptPass(tokens.refresh_token) } : {}),
    m365_token_expires_at:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('tenant_id', cfg.tenant_id)

  return tokens.access_token
}

export { encryptPass, decryptPass }
