import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { m365AuthUrl, m365ScopeFuer } from '@/lib/m365/graph'
import { erzeugeStateWert, setzeNonceCookie } from '@/lib/m365/state'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const admin = createSupabaseAdminClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.redirect(new URL('/dashboard', req.url))

  // Azure-App-Credentials aus tenant_einstellungen (geteilt von allen Usern des Mandanten)
  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id, m365_kalender_schreiben').eq('tenant_id', tenantId).maybeSingle()
  const c = cfg as R | null
  if (!c?.m365_tenant_id || !c?.m365_client_id)
    return NextResponse.redirect(new URL('/nachrichten?fehler=m365_not_configured', req.url))

  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const redirectUri = `${proto}://${host}/api/auth/m365/user/callback`
  // Signierter State + Einmal-Wert im Cookie (Sicherheits-Welle 1, Befund S1)
  const { state, nonce } = erzeugeStateWert({ tenantId, userId: user.id, zweck: 'benutzer' })

  // 'common' erlaubt Login aus JEDEM Microsoft-Tenant (multi-tenant App)
  // Kalender-Schreibrecht nur anfordern, wenn der Betrieb es in Entra freigegeben hat (Migration 225)
  return setzeNonceCookie(NextResponse.redirect(m365AuthUrl('common', c.m365_client_id, redirectUri, state, m365ScopeFuer(c))), nonce)
}
