import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { jsonBody, UNGUELTIGE_ANFRAGE } from '@/lib/api/body'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ note: null })

  // Neueste aktive Release Note holen
  const { data: notes, error: notesErr } = await (s.from('release_notes') as any)
    .select('*').eq('aktiv', true).order('veroeffentlicht_am', { ascending: false }).limit(1)
  if (notesErr) return NextResponse.json({ error: `Daten konnten nicht geladen werden: ${notesErr.message}` }, { status: 500 })
  const note = (notes ?? [])[0] as R | undefined
  if (!note) return NextResponse.json({ note: null })

  // Schon gesehen?
  // einzelabfrage-ohne-fehler: im Zweifel wird der Hinweis noch einmal gezeigt – harmlos
  const { data: gesehen } = await (s.from('release_notes_gesehen') as any)
    .select('id').eq('user_id', user.id).eq('release_note_id', note.id).maybeSingle()
  if (gesehen) return NextResponse.json({ note: null }) // bereits gesehen

  return NextResponse.json({ note })
}

// schreibsperre-ausnahme: markiert eine Release Note als gesehen (Lesestatus des Benutzers) – gehört zum Lesen
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })
  const body = await jsonBody(req)   // Sweep 103: leerer/kaputter Inhalt → 400 statt HTML-500
  if (!body) return NextResponse.json({ ok: false, fehler: UNGUELTIGE_ANFRAGE }, { status: 400 })
  const { release_note_id } = body
  { const { error: e } = await (s.from('release_notes_gesehen') as any).upsert(
    { user_id: user.id, release_note_id },
    { onConflict: 'user_id,release_note_id' }
  )
    if (e) void ereignisMelden({ art: 'db', quelle: 'release-notes/release_notes_gesehen', meldung: e.message }) }
  return NextResponse.json({ ok: true })
}
