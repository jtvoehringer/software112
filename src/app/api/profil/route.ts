import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET() {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  // id = auth.users.id (PK ist direkt die Auth-User-ID)
  const { data } = await (s.from('profiles') as any).select('*').eq('id', user.id).maybeSingle()
  return NextResponse.json({ profil: data ?? null })
}

export async function POST(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  const body = await req.json() as R
  const now  = new Date().toISOString()

  // Prüfen ob Profil bereits existiert
  const { data: existing } = await (s.from('profiles') as any)
    .select('id').eq('id', user.id).maybeSingle()

  let error: any
  if (existing) {
    ;({ error } = await (s.from('profiles') as any)
      .update({ full_name: body.full_name || null, telefon: body.telefon || null, updated_at: now })
      .eq('id', user.id))
  } else {
    ;({ error } = await (s.from('profiles') as any)
      .insert({ id: user.id, full_name: body.full_name || null, telefon: body.telefon || null, updated_at: now }))
  }
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
