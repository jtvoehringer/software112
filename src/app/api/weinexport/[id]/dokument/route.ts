import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { dokument_art } = await req.json()
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  // Sicherstellen, dass der Exportauftrag tatsächlich zum aktiven Tenant gehört,
  // bevor überhaupt ein Dokument dafür angelegt wird (IDOR-Schutz).
  const { data: auftrag } = await (supabase.from('exportauftraege') as any)
    .select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!auftrag) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const { data, error } = await (supabase.from('export_dokumente') as any)
    .insert({ exportauftrag_id: id, dokument_art, status: 'ausstehend' })
    .select().single()
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, status, ausgestellt_am } = await req.json()
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  // Zwei-Schritt-Prüfung: export_dokumente hat keine eigene tenant_id-Spalte,
  // daher zuerst das zugehörige exportauftrag_id auflösen und darüber prüfen,
  // ob der Exportauftrag zum aktiven Tenant gehört (IDOR-Schutz), bevor wir updaten.
  const { data: dok } = await (supabase.from('export_dokumente') as any)
    .select('id, exportauftrag_id').eq('id', id).maybeSingle()
  if (!dok) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const { data: auftrag } = await (supabase.from('exportauftraege') as any)
    .select('id').eq('id', (dok as R).exportauftrag_id).eq('tenant_id', tenantId).maybeSingle()
  if (!auftrag) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const update: Record<string,unknown> = { status }
  if (ausgestellt_am) update.ausgestellt_am = ausgestellt_am
  if (status === 'ausgestellt' && !ausgestellt_am) update.ausgestellt_am = new Date().toISOString().split('T')[0]
  const { error } = await (supabase.from('export_dokumente') as any).update(update).eq('id', id)
  if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
