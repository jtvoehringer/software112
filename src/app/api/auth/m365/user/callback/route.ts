import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, encryptPass } from '@/lib/m365/graph'
import { ereignisMelden } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state') ?? ''
  const error = searchParams.get('error')

  if (error) return NextResponse.redirect(new URL(`/nachrichten?fehler=${error}`, req.url))
  if (!code) return NextResponse.redirect(new URL('/nachrichten?fehler=no_code', req.url))

  // State parsen: Format tenantId:userId
  const [tenantId, userId] = state.split(':')
  if (!tenantId || !userId) {
    console.error('[m365/user/callback] Ungültiger State:', state)
    return NextResponse.redirect(new URL('/nachrichten?fehler=invalid_state', req.url))
  }
  const admin = createSupabaseAdminClient()

  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id, m365_client_secret_enc')
    .eq('tenant_id', tenantId).maybeSingle()
  const c = cfg as R | null
  if (!c) return NextResponse.redirect(new URL('/nachrichten?fehler=tenant_not_found', req.url))

  try {
    const { decryptPass } = await import('@/lib/email/crypto')
    const clientSecret = decryptPass(c.m365_client_secret_enc)
    const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
    const proto = req.headers.get('x-forwarded-proto') ?? 'https'
    const redirectUri = `${proto}://${host}/api/auth/m365/user/callback`

    const tokens = await exchangeCodeForTokens('common', c.m365_client_id, clientSecret, code, redirectUri)

    // Mailbox-E-Mail ermitteln
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const me = await meRes.json() as R
    const emailAddress = me.mail ?? me.userPrincipalName ?? ''
    const anzeigename  = me.displayName ?? emailAddress

    // Per-User Verbindung speichern (UPSERT)
    { const { error: e } = await (admin.from('user_email_connections') as any).upsert({
      tenant_id:              tenantId,
      user_id:                userId,
      email_address:          emailAddress,
      anzeigename,
      m365_aktiv:             true,
      m365_access_token_enc:  encryptPass(tokens.access_token),
      m365_refresh_token_enc: encryptPass(tokens.refresh_token),
      m365_token_expires_at:  new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      aktualisiert_am:        new Date().toISOString(),
    }, { onConflict: 'tenant_id,user_id' })
      if (e) void ereignisMelden({ art: 'db', quelle: 'callback/user_email_connections', meldung: e.message }) }

    return NextResponse.redirect(new URL('/nachrichten?verbunden=1', req.url))
  } catch (err) {
    console.error('[m365/user/callback] Fehler:', String(err))
    return NextResponse.redirect(new URL(`/nachrichten?fehler=${encodeURIComponent(String(err))}`, req.url))
  }
}
