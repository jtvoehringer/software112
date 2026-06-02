import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { an, betreff, text, kontakt_id, firma_id } = body
    if (!an || !betreff) return NextResponse.json({ fehler: 'E-Mail und Betreff erforderlich' }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const { data: membership } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
    const tenantId = (membership as R | null)?.tenant_id
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
      .select('m365_modul_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, m365_tenant_id, m365_client_id, m365_client_secret_enc, m365_user_email, tenant_id, email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
      .eq('tenant_id', tenantId).maybeSingle()
    const c = cfg as R | null

    // M365 hat Vorrang
    if (c?.m365_modul_aktiv && c?.m365_access_token_enc) {
      const forward = await fetch(new URL('/api/m365/send', req.url).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
        body: JSON.stringify(body),
      })
      return forward
    }

    // Fallback: SMTP
    if (c?.email_modul_aktiv && c?.email_smtp_host) {
      const forward = await fetch(new URL('/api/email/send', req.url).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
        body: JSON.stringify(body),
      })
      return forward
    }

    return NextResponse.json({ fehler: 'Kein E-Mail-Modul aktiv (M365 oder SMTP konfigurieren)' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
