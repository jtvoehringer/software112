import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// GET /api/crm/aktivitaet/[id]/dokument/[dok_id] – Signed URL (Redirect)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; dok_id: string }> }
) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { dok_id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })

  const { data: dok } = await (supabase.from('aktivitaet_dokumente') as any)
    .select('storage_pfad, dateiname').eq('id', dok_id).eq('tenant_id', tenantId).single()
  if (!dok) return NextResponse.json({ error: 'Dokument nicht gefunden' }, { status: 404 })

  const { data: signed, error } = await supabase.storage
    .from('aktivitaet-dokumente')
    .createSignedUrl((dok as R).storage_pfad, 60)  // 60s gültig

  if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Signed URL Fehler' }, { status: 500 })

  return NextResponse.redirect(signed.signedUrl)
}

// DELETE /api/crm/aktivitaet/[id]/dokument/[dok_id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; dok_id: string }> }
) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { dok_id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: { session } } = await supabase.auth.getSession()

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt

  const { data: dok } = await (supabase.from('aktivitaet_dokumente') as any)
    .select('id, storage_pfad, tenant_id').eq('id', dok_id).eq('tenant_id', tenantId).single()
  if (!dok) return NextResponse.json({ error: 'Dokument nicht gefunden' }, { status: 404 })

  // DB-Eintrag löschen - explizit zusätzlich auf tenant_id gefiltert (die vorausgehende
  // Ownership-Prüfung oben stellt zwar sicher, dass das Dokument zum aktiven Mandanten
  // gehört, aber ohne .eq('tenant_id', ...) HIER würde ein Race zwischen Prüfung und
  // DELETE - so unwahrscheinlich er ist - theoretisch die Mandantengrenze umgehen können;
  // zudem macht das den DELETE-Aufruf für sich genommen konsistent mit allen anderen
  // mandantenbezogenen Schreibzugriffen in dieser App (siehe check-tenant-isolation.js).
  const { data: weg, error } = await (supabase.from('aktivitaet_dokumente') as any)
    .delete().eq('id', dok_id).eq('tenant_id', tenantId).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (((weg ?? []) as unknown[]).length === 0) return NextResponse.json({ error: 'Das Dokument wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.' }, { status: 403 })

  // KAN-243: Datei erst nach der Zeile entfernen – vorher war die Datei weg, auch wenn die RLS das Löschen der Zeile
  // still ablehnte (Dokument ohne Datei)
  await supabase.storage.from('aktivitaet-dokumente').remove([(dok as R).storage_pfad])

  return NextResponse.json({ ok: true })
}
