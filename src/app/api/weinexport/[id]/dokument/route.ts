import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { dokument_art } = await req.json()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await (supabase.from('export_dokumente') as any)
    .insert({ exportauftrag_id: params.id, dokument_art, status: 'ausstehend' })
    .select().single()
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, status, ausgestellt_am } = await req.json()
  const supabase = await createSupabaseServerClient()
  const update: Record<string,unknown> = { status }
  if (ausgestellt_am) update.ausgestellt_am = ausgestellt_am
  if (status === 'ausgestellt' && !ausgestellt_am) update.ausgestellt_am = new Date().toISOString().split('T')[0]
  const { error } = await (supabase.from('export_dokumente') as any).update(update).eq('id', id)
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
