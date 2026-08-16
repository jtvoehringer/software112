import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, encryptPass } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state') ?? ''
  const error = searchParams.get('error')

  // tenantId zuerst aus dem state parsen, damit JEDE Rückleitung (Erfolg wie
  // Fehler) auf die konkrete Mandanten-Detailseite geht statt auf die
  // allgemeine Liste, die m365_ok/m365_error ohnehin nicht auswertet.
  const [tenantId] = state.split(':')
  const zurueck = tenantId ? `/admin/mandanten/${tenantId}` : '/admin/mandanten'

  if (error) return NextResponse.redirect(new URL(`${zurueck}?m365_error=${error}`, req.url))
  if (!code) return NextResponse.redirect(new URL(`${zurueck}?m365_error=no_code`, req.url))

  const admin = createSupabaseAdminClient()

  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id, m365_client_secret_enc')
    .eq('tenant_id', tenantId).maybeSingle()
  const c = cfg as R | null
  if (!c) return NextResponse.redirect(new URL(`${zurueck}?m365_error=tenant_not_found`, req.url))

  try {
    const { decryptPass } = await import('@/lib/email/crypto')
    const clientSecret  = decryptPass(c.m365_client_secret_enc)
    const redirectUri   = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'}/api/auth/m365/callback`
    const tokens        = await exchangeCodeForTokens(c.m365_tenant_id, c.m365_client_id, clientSecret, code, redirectUri)

    // Mailbox-E-Mail via Graph ermitteln
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const me = await meRes.json() as R
    const userEmail = me.mail ?? me.userPrincipalName ?? ''

    await (admin.from('tenant_einstellungen') as any).update({
      m365_modul_aktiv:       true,
      m365_access_token_enc:  encryptPass(tokens.access_token),
      m365_refresh_token_enc: encryptPass(tokens.refresh_token),
      m365_token_expires_at:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      m365_user_email:        userEmail,
    }).eq('tenant_id', tenantId)

    return NextResponse.redirect(new URL(`${zurueck}?m365_ok=1`, req.url))
  } catch (err) {
    return NextResponse.redirect(new URL(`${zurueck}?m365_error=${encodeURIComponent(String(err))}`, req.url))
  }
}
