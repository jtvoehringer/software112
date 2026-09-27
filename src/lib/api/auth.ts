/**
 * Gemeinsame Auth-Utilities für API-Routen
 * Verhindert Code-Duplikation und stellt konsistente Sicherheitschecks sicher
 */
import { getValidUserAccessToken } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const USER_EMAIL_CONN_SELECT =
  'm365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, ' +
  'imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email'

/**
 * Aktive Tenant-ID des eingeloggten Users (Cookie-validiert gegen echte Memberships,
 * mit Fallback auf erste Membership, falls kein/kein gültiges Cookie gesetzt ist).
 * Delegiert bewusst an die kanonische getCurrentMembership() statt die Query hier zu
 * duplizieren (siehe Kommentar dort) – vermeidet eine zweite, unabhängige
 * "irgendeine Mitgliedschaft"-Fallback-Logik. NIEMALS aus Request-Body lesen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTenantId(supabase: any): Promise<string | null> {
  const membership = await getCurrentMembership()
  return membership?.tenantId ?? null
}

/**
 * mailboxBase URL ermitteln (eigene Mailbox oder Shared Mailbox)
 */
export function getMailboxBase(uc: R | null): string {
  const monitored = (uc as R | null)?.monitored_email
  return monitored
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(monitored)}`
    : 'https://graph.microsoft.com/v1.0/me'
}

/**
 * M365-Token für User laden
 */
export async function getM365Token(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  adminClient: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  tenantId: string,
  userId: string
): Promise<{ uc: R | null; token: string | null }> {
  const [{ data: uc }, { data: tc }] = await Promise.all([
    (adminClient.from('user_email_connections') as any)
      .select(USER_EMAIL_CONN_SELECT).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    (adminClient.from('tenant_einstellungen') as any)
      .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (!(uc as R | null)?.m365_aktiv || !(uc as R | null)?.m365_access_token_enc)
    return { uc: uc as R | null, token: null }
  try {
    const token = await getValidUserAccessToken(uc as R, tc as R, adminClient, tenantId, userId)
    return { uc: uc as R | null, token }
  } catch {
    return { uc: uc as R | null, token: null }
  }
}
