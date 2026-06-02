import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('exportauftraege') as any)
    .update(body).eq('id', params.id)
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
