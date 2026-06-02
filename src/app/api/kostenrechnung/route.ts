import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function getTenantId(supabase: any): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId(supabase)
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const action = req.nextUrl.searchParams.get('action')

  if (action === 'eintraege') {
    const { data } = await (supabase.from('kosteneintraege') as any)
      .select('id, datum, betrag, beschreibung, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name)')
      .eq('tenant_id', tenantId).order('datum', { ascending: false }).limit(200)
    return NextResponse.json({ eintraege: data ?? [] })
  }
  if (action === 'kostenstellen') {
    const { data } = await (supabase.from('kostenstellen') as any)
      .select('id, name, kuerzel').eq('tenant_id', tenantId).eq('aktiv', true).order('name')
    return NextResponse.json({ kostenstellen: data ?? [] })
  }
  if (action === 'kostenarten') {
    const { data } = await (supabase.from('kostenarten') as any)
      .select('id, name, kategorie').eq('tenant_id', tenantId).eq('aktiv', true).order('name')
    return NextResponse.json({ kostenarten: data ?? [] })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId(supabase)
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const body = await req.json() as R

  if (body.action === 'eintrag') {
    const { error } = await (supabase.from('kosteneintraege') as any).insert({
      tenant_id: tenantId, kostenstelle_id: body.kostenstelle_id ?? null,
      kostenart_id: body.kostenart_id ?? null, datum: body.datum, betrag: body.betrag,
      beschreibung: body.beschreibung ?? null,
      periode: body.datum?.slice(0, 7) ?? null,
    })
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}
