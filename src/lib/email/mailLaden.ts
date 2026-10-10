// ── Einzelne E-Mail serverseitig aus dem M365-Postfach laden (KAN-137, 26.9.2026) ──
// Für Server Actions, die eine Mail als CRM-Aktivität speichern (createLeadAusEmail):
// Inhalt und Kopfdaten kommen von Microsoft Graph, nicht aus dem Browser – sonst
// könnte ein Aufrufer beliebiges HTML als email_body_html einschleusen. Nutzt die
// Postfach-Verbindung des angemeldeten Benutzers im aktiven Betrieb (gleiche
// Abfrage wie /api/nachrichten/message). Liefert null, wenn kein M365-Postfach
// verbunden ist oder die Mail dort nicht (mehr) gefunden wird.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type GeladeneMail = {
  id: string
  conversationId: string | null
  betreff: string
  von: string | null
  vonName: string | null
  an: string | null
  datum: string | null
  bodyText: string
  bodyHtml: string | null
}

export async function ladeMailAusPostfach(
  tenantId: string, userId: string, mailId: string, mailbox: 'own' | 'shared' = 'own',
): Promise<GeladeneMail | null> {
  if (!mailId || !userId) return null
  // KAN-135: Zugangsdaten nur per Service-Role – eingeschränkt auf die eigene Zeile
  // (userId aus getUser() des Aufrufers, tenantId aus der Mitgliedschaft)
  const admin = createSupabaseAdminClient()
  const [{ data: cfg, error: cfgErr }, { data: tenantCfg, error: tenantCfgErr }] = await Promise.all([
    (admin.from('user_email_connections') as any)
      .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_scope, monitored_email, email_address')
      .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    (admin.from('tenant_einstellungen') as any)
      .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if ((cfgErr ?? tenantCfgErr)) throw new AktionsFehler(`Daten konnten nicht geladen werden: ${(cfgErr ?? tenantCfgErr).message}`)
  const c = cfg as R | null
  if (!c?.m365_aktiv || !c.m365_access_token_enc || !tenantCfg) return null

  const token = await getValidUserAccessToken(c, tenantCfg as R, admin, tenantId, userId)
  const base = getMailboxBase(c, mailbox)
  const res = await fetch(
    `${base}/messages/${encodeURIComponent(mailId)}?$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,body,conversationId`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return null
  const m = await res.json() as R
  const istHtml = m.body?.contentType === 'html'
  const inhalt = String(m.body?.content ?? '')
  return {
    id: String(m.id ?? mailId),
    conversationId: m.conversationId ?? null,
    betreff: m.subject ?? '(kein Betreff)',
    von: m.from?.emailAddress?.address ?? null,
    vonName: m.from?.emailAddress?.name ?? null,
    an: (m.toRecipients ?? []).map((r: R) => r.emailAddress?.address).filter(Boolean).join(', ') || null,
    datum: m.receivedDateTime ?? m.sentDateTime ?? null,
    bodyText: (istHtml ? inhalt.replace(/<[^>]*>/g, '') : inhalt).trim(),
    bodyHtml: istHtml ? inhalt : null,
  }
}
