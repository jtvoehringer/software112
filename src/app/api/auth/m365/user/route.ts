import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { m365AuthUrl } from '@/lib/m365/graph'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const admin = createSupabaseAdminClient()
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (membership as R | null)?.tenant_id
  if (!tenantId) return NextResponse.redirect(new URL('/dashboard', req.url))

  // Azure-App-Credentials aus tenant_einstellungen (geteilt von allen Usern des Mandanten)
  const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
    .select('m365_tenant_id, m365_client_id').eq('tenant_id', tenantId).maybeSingle()
  const c = cfg as R | null
  if (!c?.m365_tenant_id || !c?.m365_client_id)
    return NextResponse.redirect(new URL('/nachrichten?fehler=m365_not_configured', req.url))

  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'software112.icp-consultants.at'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const redirectUri = `${proto}://${host}/api/auth/m365/user/callback`
  // State mit HMAC signieren (verhindert CSRF auf OAuth-Callback)
  const statePayload = `${tenantId}:${user.id}:${Date.now()}`
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'fallback'
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(statePayload))
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('')
  const state = `${statePayload}.${sigHex}`

  // 'common' erlaubt Login aus JEDEM Microsoft-Tenant (multi-tenant App)
  return NextResponse.redirect(m365AuthUrl('common', c.m365_client_id, redirectUri, state))
}
