import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })
  const { error } = await (supabase.from('exportauftraege') as any)
    .update(body).eq('id', id).eq('tenant_id', tenantId)
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
