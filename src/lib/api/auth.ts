/**
 * Gemeinsame Auth-Utilities für API-Routen
 * Verhindert Code-Duplikation und stellt konsistente Sicherheitschecks sicher
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getValidUserAccessToken } from '@/lib/m365/graph'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const USER_EMAIL_CONN_SELECT =
  'm365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, ' +
  'm365_user_email, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email'

/**
 * Tenant-ID aus der Session laden (NIEMALS aus Request-Body)
 */
export async function getTenantId(supabase: SupabaseClient): Promise<string | null> {
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  return (membership as R | null)?.tenant_id ?? null
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
  supabase: SupabaseClient,
  adminClient: SupabaseClient,
  tenantId: string,
  userId: string
): Promise<{ uc: R | null; token: string | null }> {
  const [{ data: uc }, { data: tc }] = await Promise.all([
    (supabase.from('user_email_connections') as any)
      .select(USER_EMAIL_CONN_SELECT).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    (adminClient.from('tenant_einstellungen') as any)
      .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (!(uc as R | null)?.m365_aktiv || !(uc as R | null)?.m365_access_token_enc)
    return { uc: uc as R | null, token: null }
  try {
    const token = await getValidUserAccessToken(uc as R, tc as R, supabase)
    return { uc: uc as R | null, token }
  } catch {
    return { uc: uc as R | null, token: null }
  }
}
