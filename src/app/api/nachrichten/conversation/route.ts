import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const conversationId = req.nextUrl.searchParams.get('id')
    if (!conversationId) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })
    const mailbox = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const { data: { user } } = await supabase.auth.getUser()

    const [{ data: uc }, { data: tc }] = await Promise.all([
      (supabase.from('user_email_connections') as any).select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any).select('m365_tenant_id,m365_client_id,m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    const token = await getValidUserAccessToken(uc as R, tc as R, supabase, tenantId, user?.id ?? '')

    const mailboxBase = getMailboxBase(uc as R, mailbox)

    // Alle Nachrichten dieser Conversation laden (alle Ordner). Kein $orderby:
    // Graph lehnt $filter auf conversationId zusammen mit $orderby ab
    // (ErrorInvalidUrlQuery / "restriction or sort order is too complex" →
    // bisher 502 bei jedem Öffnen, 17.9.2026); sortiert wird unten.
    const params = new URLSearchParams({
      '$filter':  `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
      '$select':  'id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,conversationId',
      '$top':     '20',
    })
    const res = await fetch(
      `${mailboxBase}/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json() as R
    if (!res.ok || data.error) {
      const code = (data as R)?.error?.code
      const msg = (data as R)?.error?.message ?? res.statusText
      console.error('[nachrichten] Thread:', res.status, code, msg)
      return NextResponse.json({ fehler: `Thread konnte nicht geladen werden (Graph API ${res.status}${code ? ' ' + code : ''}): ${msg}` }, { status: 502 })
    }
    const sortiert = ((data.value ?? []) as R[]).slice().sort((a, b) =>
      String(a.receivedDateTime ?? a.sentDateTime ?? '').localeCompare(String(b.receivedDateTime ?? b.sentDateTime ?? '')))
    const messages = sortiert.map((m: R) => ({
      id: m.id,
      betreff: m.subject ?? '(kein Betreff)',
      von: m.from?.emailAddress?.address ?? '',
      vonName: m.from?.emailAddress?.name ?? '',
      an: (m.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', '),
      datum: m.receivedDateTime ?? m.sentDateTime,
      gelesen: m.isRead ?? false,
      vorschau: m.bodyPreview?.slice(0, 150) ?? '',
      conversationId: m.conversationId ?? null,
      quelle: 'm365',
    }))
    return NextResponse.json({ messages })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
