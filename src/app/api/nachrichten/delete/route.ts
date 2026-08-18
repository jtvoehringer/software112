import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })
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
    const token = await getValidUserAccessToken(uc as R, tc as R, supabase, tenantId, user?.id ?? '')

    // In "Gelöschte Elemente" verschieben (nicht endgültig löschen)
    const mailboxBase = getMailboxBase(uc as R, mailbox)
    const moveRes = await fetch(`${mailboxBase}/messages/${id}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: 'deleteditems' }),
    })
    if (!moveRes.ok) {
      const errBody = await moveRes.json().catch(() => ({}))
      const msg = (errBody as R)?.error?.message ?? moveRes.statusText
      return NextResponse.json({ fehler: `Graph API Fehler ${moveRes.status}: ${msg}` }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) { return NextResponse.json({ fehler: String(err) }, { status: 500 }) }
}
