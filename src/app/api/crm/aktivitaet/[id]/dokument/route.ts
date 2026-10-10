import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { dbFehlerText } from '@/lib/fehler'
import { formBody, ungueltigeAnfrage } from '@/lib/api/body'

// POST /api/crm/aktivitaet/[id]/dokument – Datei hochladen
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id: aktivitaetId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  // KAN-245: wie RLS (modul_* auf aktivitaet_dokumente = CRM oder Warenwirtschaft) – vor Upload bzw. Löschen der Datei
  if (!membership || !(canWrite(membership, 'crm') || canWrite(membership, 'warenwirtschaft'))) {
    return NextResponse.json({ error: 'Keine Berechtigung für Dokumente – dafür ist die Freigabe CRM oder Warenwirtschaft nötig.' }, { status: 403 })
  }

  // Prüfen ob Aktivität zu diesem Tenant gehört
  const { data: akt, error: aktErr } = await (supabase.from('aktivitaeten') as any)
    .select('id').eq('id', aktivitaetId).eq('tenant_id', tenantId).single()
  if (aktErr && aktErr.code !== 'PGRST116') return NextResponse.json({ error: `Aktivität konnte nicht geladen werden: ${aktErr.message}` }, { status: 500 })
  if (!akt) return NextResponse.json({ error: 'Aktivität nicht gefunden' }, { status: 404 })

  const formData = await formBody(req)   // Sweep 103: leerer/kaputter Inhalt → 400 statt HTML-500
  if (!formData) return ungueltigeAnfrage('error')
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Keine Datei' }, { status: 400 })

  const MAX_BYTES = 15 * 1024 * 1024
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Datei zu groß (max 15 MB)' }, { status: 413 })

  const ext = file.name.split('.').pop() ?? ''
  const storagePfad = `${tenantId}/${aktivitaetId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const { error: uploadErr } = await supabase.storage
    .from('aktivitaet-dokumente')
    .upload(storagePfad, file, { contentType: file.type, upsert: false })
  if (uploadErr) return NextResponse.json({ error: dbFehlerText(uploadErr) }, { status: 500 })

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
    return NextResponse.json({ error: dbFehlerText(dbErr) }, { status: 500 })
  }

  return NextResponse.json(dok, { status: 201 })
}

// GET /api/crm/aktivitaet/[id]/dokument – Dokumentenliste
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id: aktivitaetId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })

  const { data, error: dataErr } = await (supabase.from('aktivitaet_dokumente') as any)
    .select('id, dateiname, dateityp, groesse_bytes, erstellt_am')
    .eq('aktivitaet_id', aktivitaetId)
    .eq('tenant_id', tenantId)
    .order('erstellt_am', { ascending: true })
  if (dataErr) return NextResponse.json({ error: `Daten konnten nicht geladen werden: ${dataErr.message}` }, { status: 500 })

  return NextResponse.json(data ?? [])
}
