import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET() {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ note: null })

  // Neueste aktive Release Note holen
  const { data: notes } = await (s.from('release_notes') as any)
    .select('*').eq('aktiv', true).order('veroeffentlicht_am', { ascending: false }).limit(1)
  const note = (notes ?? [])[0] as R | undefined
  if (!note) return NextResponse.json({ note: null })

  // Schon gesehen?
  const { data: gesehen } = await (s.from('release_notes_gesehen') as any)
    .select('id').eq('user_id', user.id).eq('release_note_id', note.id).maybeSingle()
  if (gesehen) return NextResponse.json({ note: null }) // bereits gesehen

  return NextResponse.json({ note })
}

export async function POST(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })
  const { release_note_id } = await req.json() as R
  { const { error: e } = await (s.from('release_notes_gesehen') as any).upsert(
    { user_id: user.id, release_note_id },
    { onConflict: 'user_id,release_note_id' }
  )
    if (e) console.error('[release-notes] release_notes_gesehen:', e.message) }
  return NextResponse.json({ ok: true })
}
