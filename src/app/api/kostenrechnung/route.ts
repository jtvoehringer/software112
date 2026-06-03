import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function getTId(s: any): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await (s.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

async function saveWgSplit(s: any, eintragsId: string, wgSplit: R[], betrag: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Alte Splits löschen
  await (s.from('kosteneintrag_weingaerten') as any).delete().eq('kosteneintrag_id', eintragsId)
  if (!wgSplit || wgSplit.length === 0) return
  // Neue Splits einfügen
  const gleichmaessig = wgSplit.every((w: R) => !w.anteil_pct)
  const records = wgSplit.map((w: R, i: number) => {
    const pct = gleichmaessig ? Math.round(10000 / wgSplit.length) / 100 : (w.anteil_pct ?? 0)
    return {
      kosteneintrag_id: eintragsId,
      weingarten_id:    w.weingarten_id,
      anteil_pct:       pct,
      betrag_anteil:    Math.round(betrag * pct / 100 * 100) / 100,
    }
  })
  await (s.from('kosteneintrag_weingaerten') as any).insert(records)
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
    // WG-Splits nachladen
    const ids = (data ?? []).map((e: R) => e.id)
    let splits: R[] = []
    if (ids.length > 0) {
      const { data: sd } = await (s.from('kosteneintrag_weingaerten') as any)
        .select('kosteneintrag_id, weingarten_id, anteil_pct, betrag_anteil, wg:weingarten_id(name)')
        .in('kosteneintrag_id', ids)
      splits = sd ?? []
    }
    const eintraege = (data ?? []).map((e: R) => ({
      ...e,
      wg_splits: splits.filter((sp: R) => sp.kosteneintrag_id === e.id),
    }))
    return NextResponse.json({ eintraege })
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
    const { data: ke } = await (s.from('kosteneintraege') as any)
      .select('id, betrag, periode, objekt_typ, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`)
    const ids = (ke ?? []).map((e: R) => e.id)
    let splits: R[] = []
    if (ids.length > 0) {
      const { data: sd } = await (s.from('kosteneintrag_weingaerten') as any)
        .select('kosteneintrag_id, betrag_anteil, wg:weingarten_id(name)').in('kosteneintrag_id', ids)
      splits = sd ?? []
    }
    return NextResponse.json({ eintraege: ke ?? [], splits, jahr })
  }
  // Kostenstelle anlegen/bearbeiten/löschen
  if (b.action === 'ks_save') {
    if (b.id) {
      await (s.from('kostenstellen') as any).update({ name: b.name, kuerzel: b.kuerzel||null, beschreibung: b.beschreibung||null }).eq('id', b.id).eq('tenant_id', t)
    } else {
      await (s.from('kostenstellen') as any).insert({ tenant_id: t, name: b.name, kuerzel: b.kuerzel||null, beschreibung: b.beschreibung||null })
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'ks_delete') {
    await (s.from('kostenstellen') as any).update({ aktiv: false }).eq('id', b.id).eq('tenant_id', t)
    return NextResponse.json({ ok: true })
  }
  // Kostenart anlegen/bearbeiten/löschen
  if (b.action === 'ka_save') {
    if (b.id) {
      await (s.from('kostenarten') as any).update({ name: b.name, kuerzel: b.kuerzel||null, kategorie: b.kategorie||null }).eq('id', b.id).eq('tenant_id', t)
    } else {
      await (s.from('kostenarten') as any).insert({ tenant_id: t, name: b.name, kuerzel: b.kuerzel||null, kategorie: b.kategorie||null })
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'ka_delete') {
    await (s.from('kostenarten') as any).update({ aktiv: false }).eq('id', b.id).eq('tenant_id', t)
    return NextResponse.json({ ok: true })
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
    weingarten_id: null, // immer null – Splits in Junction-Tabelle
    behaelter_id: b.behaelter_id ?? null,
  }

  if (b.action === 'eintrag') {
    const { data, error } = await (s.from('kosteneintraege') as any).insert({ tenant_id: t, ...fields }).select().single()
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    if (b.wg_split?.length > 0) await saveWgSplit(s, (data as R).id, b.wg_split, b.betrag)
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'aktualisieren') {
    const { error } = await (s.from('kosteneintraege') as any).update(fields).eq('id', b.id).eq('tenant_id', t)
    if (error) return NextResponse.json({ fehler: error.message }, { status: 500 })
    if (b.wg_split !== undefined) await saveWgSplit(s, b.id, b.wg_split ?? [], b.betrag)
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'loeschen') {
    await (s.from('kosteneintraege') as any).delete().eq('id', b.id).eq('tenant_id', t)
    return NextResponse.json({ ok: true })
  }
  // Kostenstelle anlegen/bearbeiten/löschen
  if (b.action === 'ks_save') {
    if (b.id) {
      await (s.from('kostenstellen') as any).update({ name: b.name, kuerzel: b.kuerzel||null, beschreibung: b.beschreibung||null }).eq('id', b.id).eq('tenant_id', t)
    } else {
      await (s.from('kostenstellen') as any).insert({ tenant_id: t, name: b.name, kuerzel: b.kuerzel||null, beschreibung: b.beschreibung||null })
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'ks_delete') {
    await (s.from('kostenstellen') as any).update({ aktiv: false }).eq('id', b.id).eq('tenant_id', t)
    return NextResponse.json({ ok: true })
  }
  // Kostenart anlegen/bearbeiten/löschen
  if (b.action === 'ka_save') {
    if (b.id) {
      await (s.from('kostenarten') as any).update({ name: b.name, kuerzel: b.kuerzel||null, kategorie: b.kategorie||null }).eq('id', b.id).eq('tenant_id', t)
    } else {
      await (s.from('kostenarten') as any).insert({ tenant_id: t, name: b.name, kuerzel: b.kuerzel||null, kategorie: b.kategorie||null })
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'ka_delete') {
    await (s.from('kostenarten') as any).update({ aktiv: false }).eq('id', b.id).eq('tenant_id', t)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}
