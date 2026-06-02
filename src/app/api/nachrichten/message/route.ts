import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: cfg }, { data: tenantCfg }] = await Promise.all([
      (supabase.from('user_email_connections') as any)
        .select('*').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    const c = cfg as R | null

    if (c?.m365_aktiv && c?.m365_access_token_enc) {
      const token = await getValidUserAccessToken(c, tenantCfg as R, supabase)
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,conversationId,isRead`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return NextResponse.json({ fehler: 'E-Mail nicht gefunden' }, { status: 404 })
      const msg = await res.json() as R

      // Als gelesen markieren
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      }).catch(() => {})

      // Kontakt-Matching für Anzeige
      const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() ?? ''
      let kontaktInfo = null
      if (fromEmail) {
        const { data: k } = await (supabase.from('kontakte') as any)
          .select('id, vorname, nachname, kundennummer').eq('email', fromEmail).maybeSingle()
        const { data: f } = await (supabase.from('firmen') as any)
          .select('id, name, kundennummer').eq('email', fromEmail).maybeSingle()
        if (k) kontaktInfo = { typ: 'kontakt', id: (k as R).id, name: [(k as R).vorname, (k as R).nachname].filter(Boolean).join(' '), kundennummer: (k as R).kundennummer }
        else if (f) kontaktInfo = { typ: 'firma', id: (f as R).id, name: (f as R).name, kundennummer: (f as R).kundennummer }
      }

      return NextResponse.json({
        id: msg.id,
        betreff: msg.subject ?? '(kein Betreff)',
        von: msg.from?.emailAddress?.address ?? '',
        vonName: msg.from?.emailAddress?.name ?? '',
        an: (msg.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', '),
        datum: msg.receivedDateTime ?? msg.sentDateTime,
        bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : null,
        bodyText: msg.body?.contentType === 'text' ? msg.body.content : msg.body?.content ?? '',
        conversationId: msg.conversationId,
        kontaktInfo,
      })
    }
    return NextResponse.json({ fehler: 'Mailbox nicht verbunden' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
