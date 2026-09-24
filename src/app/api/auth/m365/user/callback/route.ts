import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, encryptPass, m365ScopeFuer } from '@/lib/m365/graph'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeState, loescheNonceCookie, NONCE_COOKIE } from '@/lib/m365/state'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// zwei-faktor-ausnahme: OAuth-Rückkehr von Microsoft – signierter State + Einmal-Cookie + Abgleich mit dem Sitzungs-User; den State stellt nur /api/auth/m365/user aus, das aal2 prüft
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state') ?? ''
  const error = searchParams.get('error')

  // State prüfen (Signatur, Ablauf, Einmal-Wert aus dem Cookie) und mit der angemeldeten
  // Sitzung abgleichen – sonst könnte ein fremdes Postfach einem Konto untergeschoben
  // werden (Sicherheits-Welle 1, Befund S1)
  const geprueft = pruefeState(state, req.cookies.get(NONCE_COOKIE)?.value, 'benutzer')
  if (!geprueft) {
    console.error('[m365/user/callback] Ungültiger oder abgelaufener State')
    return loescheNonceCookie(NextResponse.redirect(new URL('/nachrichten?fehler=invalid_state', req.url)))
  }
  const { tenantId, userId } = geprueft
  const { data: { user: sitzung } } = await (await createSupabaseServerClient()).auth.getUser()
  if (!sitzung || sitzung.id !== userId)
    return loescheNonceCookie(NextResponse.redirect(new URL('/nachrichten?fehler=session_mismatch', req.url)))

  if (error) return loescheNonceCookie(NextResponse.redirect(new URL(`/nachrichten?fehler=${encodeURIComponent(error)}`, req.url)))
  if (!code) return loescheNonceCookie(NextResponse.redirect(new URL('/nachrichten?fehler=no_code', req.url)))
  const admin = createSupabaseAdminClient()

  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id, m365_client_secret_enc, m365_kalender_schreiben')
    .eq('tenant_id', tenantId).maybeSingle()
  const c = cfg as R | null
  if (!c) return NextResponse.redirect(new URL('/nachrichten?fehler=tenant_not_found', req.url))

  try {
    const { decryptPass } = await import('@/lib/email/crypto')
    const clientSecret = decryptPass(c.m365_client_secret_enc)
    const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
    const proto = req.headers.get('x-forwarded-proto') ?? 'https'
    const redirectUri = `${proto}://${host}/api/auth/m365/user/callback`

    const scope  = m365ScopeFuer(c)
    const tokens = await exchangeCodeForTokens('common', c.m365_client_id, clientSecret, code, redirectUri, scope)

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
      // tatsächlich erteilter Scope (Microsoft liefert ihn zurück; sonst der angeforderte)
      m365_scope:             (tokens.scope as string | undefined) || scope,
      aktualisiert_am:        new Date().toISOString(),
    }, { onConflict: 'tenant_id,user_id' })
      if (e) void ereignisMelden({ art: 'db', quelle: 'callback/user_email_connections', meldung: e.message }) }

    return loescheNonceCookie(NextResponse.redirect(new URL('/nachrichten?verbunden=1', req.url)))
  } catch (err) {
    console.error('[m365/user/callback] Fehler:', String(err))
    return loescheNonceCookie(NextResponse.redirect(new URL(`/nachrichten?fehler=${encodeURIComponent(String(err))}`, req.url)))
  }
}
