import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET() {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  const { data } = await (s.from('profiles') as any).select('*').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ profil: data ?? null })
}

export async function POST(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  const body = await req.json() as R
  const { error } = await (s.from('profiles') as any).upsert({
    user_id: user.id,
    full_name: body.full_name || null,
    telefon:   body.telefon   || null,
    aktualisiert_am: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
