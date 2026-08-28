import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// GET /auth/betrieb?tenant_id=… – aktiven Betrieb setzen und weiterleiten.
// Cookies dürfen in Next nur in Server Actions oder Route Handlern geschrieben
// werden; /betrieb-waehlen leitet bei genau einem Betrieb hierher um, statt das
// Cookie beim Rendern zu setzen (Fix für „Cookies can only be modified …").
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tenantId = searchParams.get('tenant_id')

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !tenantId) return NextResponse.redirect(`${origin}/login`)

  // Sicherheit: nur eigene, aktive Mitgliedschaften
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('tenant_id', tenantId).eq('user_id', user.id).eq('aktiv', true)
    .limit(1).maybeSingle()
  if (!(data as R | null)?.tenant_id) return NextResponse.redirect(`${origin}/betrieb-waehlen`)

  await setActiveTenantCookie(tenantId)
  return NextResponse.redirect(`${origin}/dashboard`)
}
