import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
export const dynamic = 'force-dynamic'

// Erlaubte Werte laut Schema (Migration 043) – alles andere wird mit 400 abgelehnt
const DOKUMENT_ARTEN  = ['v1v2', 'eur1', 'cmr', 'certificate_of_origin', 'phytosanitaer', 'lieferschein', 'rechnung']
const DOKUMENT_STATUS = ['ausstehend', 'beantragt', 'ausgestellt', 'nicht_erforderlich']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Nur echte Kalenderdaten im Format YYYY-MM-DD (kein 2026-02-30, keine Uhrzeit). */
function istDatum(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })
  const konflikt = await seitenBetriebKonflikt(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft'))
    return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const dokument_art = body?.dokument_art
  if (typeof dokument_art !== 'string' || !DOKUMENT_ARTEN.includes(dokument_art))
    return NextResponse.json({ fehler: 'Ungültige Dokumentart' }, { status: 400 })

  // Sicherstellen, dass der Exportauftrag tatsächlich zum aktiven Tenant gehört,
  // bevor überhaupt ein Dokument dafür angelegt wird (IDOR-Schutz).
  const { data: auftrag } = await (supabase.from('exportauftraege') as any)
    .select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!auftrag) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const { data, error } = await (supabase.from('export_dokumente') as any)
    .insert({ exportauftrag_id: id, dokument_art, status: 'ausstehend' })
    .select().single()
  if (error?.code === '23505')   // UNIQUE(exportauftrag_id, dokument_art)
    return NextResponse.json({ fehler: 'Dieses Dokument ist bereits vorhanden' }, { status: 409 })
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id: auftragId } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })
  const konflikt = await seitenBetriebKonflikt(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft'))
    return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const { id: dokId, status, ausgestellt_am } = body ?? {}
  if (typeof dokId !== 'string' || !UUID.test(dokId))
    return NextResponse.json({ fehler: 'Ungültige Dokument-ID' }, { status: 400 })
  if (typeof status !== 'string' || !DOKUMENT_STATUS.includes(status))
    return NextResponse.json({ fehler: 'Ungültiger Status' }, { status: 400 })
  if (ausgestellt_am != null && ausgestellt_am !== '' && !istDatum(ausgestellt_am))
    return NextResponse.json({ fehler: 'Ungültiges Ausstellungsdatum (erwartet JJJJ-MM-TT)' }, { status: 400 })

  // export_dokumente hat keine eigene tenant_id-Spalte: zuerst prüfen, ob der Exportauftrag
  // aus der URL zum aktiven Tenant gehört (IDOR-Schutz) …
  const { data: auftrag } = await (supabase.from('exportauftraege') as any)
    .select('id').eq('id', auftragId).eq('tenant_id', tenantId).maybeSingle()
  if (!auftrag) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const update: Record<string, unknown> = { status }
  if (ausgestellt_am) update.ausgestellt_am = ausgestellt_am
  if (status === 'ausgestellt' && !ausgestellt_am) update.ausgestellt_am = new Date().toISOString().split('T')[0]

  // … und das Update selbst auf genau diesen Auftrag einschränken – ein Dokument eines
  // anderen Auftrags trifft dann keine Zeile.
  const { data: getroffen, error } = await (supabase.from('export_dokumente') as any)
    .update(update).eq('id', dokId).eq('exportauftrag_id', auftragId).select('id')
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  if (!getroffen?.length) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
