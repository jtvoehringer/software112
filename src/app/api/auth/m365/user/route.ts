import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { m365AuthUrl, m365ScopeFuer } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
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
  // Einfacher State: tenantId:userId (CSRF-Schutz durch kurzes Gültigkeitsfenster des Auth-Codes)
  const state = `${tenantId}:${user.id}`

  // 'common' erlaubt Login aus JEDEM Microsoft-Tenant (multi-tenant App)
  // Kalender-Schreibrecht nur anfordern, wenn der Betrieb es in Entra freigegeben hat (Migration 225)
  return NextResponse.redirect(m365AuthUrl('common', c.m365_client_id, redirectUri, state, m365ScopeFuer(c)))
}
