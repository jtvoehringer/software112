import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { m365AuthUrl } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (membership as R | null)?.tenant_id
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id').eq('tenant_id', tenantId).maybeSingle()
  const c = cfg as R | null
  if (!c?.m365_tenant_id || !c?.m365_client_id)
    return NextResponse.redirect(new URL('/admin/mandanten', req.url))

  // Host aus dem Request ableiten → funktioniert für localhost UND Production
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const redirectUri = `${proto}://${host}/api/auth/m365/callback`
  const state = `${tenantId}:${user.id}`
  const authUrl = m365AuthUrl(c.m365_tenant_id, c.m365_client_id, redirectUri, state)

  return NextResponse.redirect(authUrl)
}
