import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken } from '@/lib/m365/graph'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  try {
    const conversationId = req.nextUrl.searchParams.get('id')
    if (!conversationId) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    const { data: { user } } = await supabase.auth.getUser()

    const [{ data: uc }, { data: tc }] = await Promise.all([
      (supabase.from('user_email_connections') as any).select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_user_email, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any).select('m365_tenant_id,m365_client_id,m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    const token = await getValidUserAccessToken(uc as R, tc as R, supabase)

    const mailboxBase = (uc as R).monitored_email
      ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent((uc as R).monitored_email)}`
      : 'https://graph.microsoft.com/v1.0/me'

    // Alle Nachrichten dieser Conversation laden (alle Ordner)
    const params = new URLSearchParams({
      '$filter':  `conversationId eq '${conversationId}'`,
      '$select':  'id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,conversationId',
      '$orderby': 'receivedDateTime asc',
      '$top':     '20',
    })
    const res = await fetch(
      `${mailboxBase}/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json() as R
    const messages = (data.value ?? []).map((m: R) => ({
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
