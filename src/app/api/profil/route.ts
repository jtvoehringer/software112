import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  // id = auth.users.id (PK ist direkt die Auth-User-ID)
  const { data, error } = await (s.from('profiles') as any).select('*').eq('id', user.id).maybeSingle()
  if (error) return NextResponse.json({ fehler: `Profil konnte nicht geladen werden: ${error.message}` }, { status: 500 })
  return NextResponse.json({ profil: data ?? null })
}

// schreibsperre-ausnahme: eigenes Benutzerprofil (Name) – kein Betriebsdatum, bleibt im Nur-Lesen-Modus änderbar
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
  const body = await req.json() as R
  const now  = new Date().toISOString()

  // full_name wird seit 7.8.2026 NICHT mehr hier vom Benutzer selbst
  // gepflegt, sondern zentral vom Administrator unter Admin > Mandant >
  // Benutzer (updateMemberNameAdmin) - bewusst nicht aus body uebernommen,
  // selbst falls ein Client es trotzdem mitschickt.

  // Prüfen ob Profil bereits existiert
  const { data: existing, error: existingErr } = await (s.from('profiles') as any)
    .select('id').eq('id', user.id).maybeSingle()
  // KAN-252: sonst „kein Profil“ → Anlegen statt Ändern
  if (existingErr) return NextResponse.json({ fehler: `Profil konnte nicht geladen werden: ${existingErr.message}` }, { status: 500 })

  // benachrichtigung_email (Migration 224): E-Mail bei Aufgabenzuweisung/@Erwähnung – nur übernehmen, wenn mitgeschickt
  const werte: R = { telefon: body.telefon || null, updated_at: now }
  if (typeof body.benachrichtigung_email === 'boolean') werte.benachrichtigung_email = body.benachrichtigung_email

  let error: any
  if (existing) {
    // KAN-248: eigenes Profil – 0 Zeilen hieße, die Zeile ist zwischen Lesen und Speichern verschwunden
    let geaendert: unknown[] | null = null
    ;({ data: geaendert, error } = await (s.from('profiles') as any).update(werte).eq('id', user.id).select('id'))
    if (!error && !geaendert?.length) return NextResponse.json({ fehler: 'Profil nicht gespeichert – bitte die Seite neu laden.' }, { status: 404 })
  } else {
    ;({ error } = await (s.from('profiles') as any).insert({ id: user.id, ...werte }))
  }
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
