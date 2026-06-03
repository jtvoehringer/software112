import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function getTId(s: any): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await (s.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

export async function GET(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const t = await getTId(s)
  if (!t) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const a = req.nextUrl.searchParams.get('action')

  if (a === 'eintraege') {
    const { data } = await (s.from('kosteneintraege') as any)
      .select('id, datum, betrag, beschreibung, objekt_typ, periode, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).order('datum', { ascending: false }).limit(300)
    return NextResponse.json({ eintraege: data ?? [] })
  }
  if (a === 'kostenstellen') {
    const { data } = await (s.from('kostenstellen') as any).select('id, name, kuerzel').eq('tenant_id', t).eq('aktiv', true).order('name')
    return NextResponse.json({ kostenstellen: data ?? [] })
  }
  if (a === 'kostenarten') {
    const { data } = await (s.from('kostenarten') as any).select('id, name, kategorie').eq('tenant_id', t).eq('aktiv', true).order('name')
    return NextResponse.json({ kostenarten: data ?? [] })
  }
  if (a === 'weingaerten') {
    const { data } = await (s.from('weingarten') as any).select('id, name').eq('tenant_id', t).order('name')
    return NextResponse.json({ weingaerten: data ?? [] })
  }
  if (a === 'behaelter') {
    const { data } = await (s.from('behaelter') as any).select('id, name, typ').eq('tenant_id', t).eq('aktiv', true).order('name')
    return NextResponse.json({ behaelter: data ?? [] })
  }
  if (a === 'auswertung') {
    const jahr = req.nextUrl.searchParams.get('jahr') ?? new Date().getFullYear().toString()
    const { data } = await (s.from('kosteneintraege') as any)
      .select('betrag, periode, objekt_typ, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`)
    return NextResponse.json({ eintraege: data ?? [], jahr })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const t = await getTId(s)
  if (!t) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const b = await req.json() as R

  const fields = {
    kostenstelle_id: b.kostenstelle_id ?? null, kostenart_id: b.kostenart_id ?? null,
    datum: b.datum, betrag: b.betrag, beschreibung: b.beschreibung ?? null,
    periode: b.datum?.slice(0, 7) ?? null, objekt_typ: b.objekt_typ ?? null,
    weingarten_id: b.weingarten_id ?? null, behaelter_id: b.behaelter_id ?? null,
  }

  if (b.action === 'eintrag') {
    const { error } = await (s.from('kosteneintraege') as any).insert({ tenant_id: t, ...fields })
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'aktualisieren') {
    const { error } = await (s.from('kosteneintraege') as any).update(fields).eq('id', b.id).eq('tenant_id', t)
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'loeschen') {
    await (s.from('kosteneintraege') as any).delete().eq('id', b.id).eq('tenant_id', t)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}
