import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, encryptPass } from '@/lib/m365/graph'
import { pruefeState, loescheNonceCookie, NONCE_COOKIE } from '@/lib/m365/state'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { schreibSperre } from '@/lib/auth/sperren'
import type { UserRole } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// zwei-faktor-ausnahme: OAuth-Rückkehr von Microsoft – signierter State + Einmal-Cookie + Abgleich mit dem Sitzungs-User; den State stellt nur /api/auth/m365 aus, das aal2 prüft
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state') ?? ''
  const error = searchParams.get('error')

  // State prüfen (Signatur, Ablauf, Einmal-Wert aus dem Cookie) und mit der angemeldeten
  // Sitzung abgleichen – sonst könnte ein fremdes Postfach untergeschoben werden (Befund S1)
  const geprueft = pruefeState(state, req.cookies.get(NONCE_COOKIE)?.value, 'betrieb')
  if (!geprueft) return loescheNonceCookie(NextResponse.redirect(new URL('/admin/mandanten?m365_error=invalid_state', req.url)))
  const tenantId = geprueft.tenantId
  const zurueck = `/admin/mandanten/${tenantId}`
  const { data: { user: sitzung } } = await (await createSupabaseServerClient()).auth.getUser()
  if (!sitzung || sitzung.id !== geprueft.userId)
    return loescheNonceCookie(NextResponse.redirect(new URL(`${zurueck}?m365_error=session_mismatch`, req.url)))

  if (error) return loescheNonceCookie(NextResponse.redirect(new URL(`${zurueck}?m365_error=${encodeURIComponent(error)}`, req.url)))
  if (!code) return loescheNonceCookie(NextResponse.redirect(new URL(`${zurueck}?m365_error=no_code`, req.url)))

  const admin = createSupabaseAdminClient()

  // KAN-5: Nur-Lesen-Modus des Betriebs aus dem State (nicht des gerade aktiven) – die Tokens
  // landen per Service-Role in tenant_einstellungen, die Datenbank-Sperre greift hier nicht
  const { data: mitglied } = await (admin.from('tenant_memberships') as any)
    .select('role').eq('tenant_id', tenantId).eq('user_id', sitzung.id).eq('aktiv', true).maybeSingle()
  if (await schreibSperre({ tenantId, role: ((mitglied as R | null)?.role ?? null) as UserRole | null }))
    return loescheNonceCookie(NextResponse.redirect(new URL(`${zurueck}?m365_error=nur_lesen`, req.url)))

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

    return loescheNonceCookie(NextResponse.redirect(new URL(`${zurueck}?m365_ok=1`, req.url)))
  } catch (err) {
    return loescheNonceCookie(NextResponse.redirect(new URL(`${zurueck}?m365_error=${encodeURIComponent(String(err))}`, req.url)))
  }
}
