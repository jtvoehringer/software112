import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// POST /api/crm/aktivitaet/[id]/dokument – Datei hochladen
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: aktivitaetId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })

  // Prüfen ob Aktivität zu diesem Tenant gehört
  const { data: akt } = await (supabase.from('aktivitaeten') as any)
    .select('id').eq('id', aktivitaetId).eq('tenant_id', tenantId).single()
  if (!akt) return NextResponse.json({ error: 'Aktivität nicht gefunden' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Keine Datei' }, { status: 400 })

  const MAX_BYTES = 15 * 1024 * 1024
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Datei zu groß (max 15 MB)' }, { status: 413 })

  const ext = file.name.split('.').pop() ?? ''
  const storagePfad = `${tenantId}/${aktivitaetId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const { error: uploadErr } = await supabase.storage
    .from('aktivitaet-dokumente')
    .upload(storagePfad, file, { contentType: file.type, upsert: false })
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { data: dok, error: dbErr } = await (supabase.from('aktivitaet_dokumente') as any)
    .insert({
      tenant_id:     tenantId,
      aktivitaet_id: aktivitaetId,
      dateiname:     file.name,
      dateityp:      file.type || `application/${ext}`,
      groesse_bytes: file.size,
      storage_pfad:  storagePfad,
      erstellt_von:  user.id,
    })
    .select('id, dateiname, dateityp, groesse_bytes, erstellt_am')
    .single()

  if (dbErr) {
    // Storage-Datei rückgängig machen
    await supabase.storage.from('aktivitaet-dokumente').remove([storagePfad])
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  return NextResponse.json(dok, { status: 201 })
}

// GET /api/crm/aktivitaet/[id]/dokument – Dokumentenliste
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: aktivitaetId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })

  const { data } = await (supabase.from('aktivitaet_dokumente') as any)
    .select('id, dateiname, dateityp, groesse_bytes, erstellt_am')
    .eq('aktivitaet_id', aktivitaetId)
    .eq('tenant_id', tenantId)
    .order('erstellt_am', { ascending: true })

  return NextResponse.json(data ?? [])
}
