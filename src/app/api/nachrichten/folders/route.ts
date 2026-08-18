import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  try {
    const mailbox = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: uc }, { data: tc }] = await Promise.all([
      (supabase.from('user_email_connections') as any).select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any).select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    if (!(uc as R | null)?.m365_aktiv) return NextResponse.json({ fehler: 'Mailbox nicht verbunden' }, { status: 400 })

    const token = await getValidUserAccessToken(uc as R, tc as R, supabase, tenantId, user?.id ?? '')
    const mailboxBase = getMailboxBase(uc as R, mailbox)
    const res = await fetch(
      `${mailboxBase}/mailFolders?$select=id,displayName,unreadItemCount,totalItemCount&$top=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json() as R
    const folders = ((data.value ?? []) as R[]).map((f: R) => ({
      id: f.id, name: f.displayName, unread: f.unreadItemCount ?? 0, total: f.totalItemCount ?? 0,
    }))
    return NextResponse.json({ folders })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}
