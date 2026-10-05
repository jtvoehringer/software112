import { ladeBehaelter } from '@/lib/keller/behaelter'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { kostenAufteilung } from '@/lib/wein/massnahmeAnteile'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function getTId(): Promise<string | null> {
  const membership = await getCurrentMembership()
  return membership?.tenantId ?? null
}

async function saveWgSplit(s: any, eintragsId: string, wgSplit: R[], betrag: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Alte Splits löschen
  { const { error: e } = await (s.from('kosteneintrag_weingaerten') as any).delete().eq('kosteneintrag_id', eintragsId)
    if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kosteneintrag_weingaerten', meldung: e.message }) }
  if (!wgSplit || wgSplit.length === 0) return
  // Neue Splits einfügen – KAN-132: Restausgleich (Σ betrag_anteil = Betrag, Σ anteil_pct = 100,00; bisher
  // gleichmäßig bei 3 Rieden 99,99 %); ohne Prozentangaben gleichmäßig
  const gleichmaessig = wgSplit.every((w: R) => !w.anteil_pct)
  const records = kostenAufteilung(Number(betrag) || 0, wgSplit.map((w: R) => ({ weingartenId: String(w.weingarten_id), gewicht: gleichmaessig ? 1 : Number(w.anteil_pct) || 0 })))
    .map(a => ({ kosteneintrag_id: eintragsId, weingarten_id: a.weingartenId, anteil_pct: a.anteil_pct, betrag_anteil: a.betrag_anteil }))
  { const { error: e } = await (s.from('kosteneintrag_weingaerten') as any).insert(records)
    if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kosteneintrag_weingaerten', meldung: e.message }) }
}

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const t = await getTId()
  if (!t) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const a = req.nextUrl.searchParams.get('action')

  if (a === 'eintraege') {
    const { data } = await (s.from('kosteneintraege') as any)
      .select('id, datum, betrag, beschreibung, objekt_typ, periode, transaktions_nr, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).order('datum', { ascending: false }).limit(300)
    // WG-Splits nachladen
    const ids = (data ?? []).map((e: R) => e.id)
    let splits: R[] = []
    if (ids.length > 0) {
      // alle(): 300 Einträge mit je mehreren Rieden können über 1.000 Aufteilungszeilen haben
      const { data: sd } = await alle<R>((s.from('kosteneintrag_weingaerten') as any)
        .select('kosteneintrag_id, weingarten_id, anteil_pct, betrag_anteil, wg:weingarten_id(name)')
        .in('kosteneintrag_id', ids)
        .order('id'))
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
    // eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203)
    const rows = await ladeBehaelter(s, t, { nurAktiv: true })
    return NextResponse.json({ behaelter: rows.map(b => ({ id: b.id, name: b.anzeigeName, typ: b.typ })) })
  }
  if (a === 'auswertung') {
    const jahr = req.nextUrl.searchParams.get('jahr') ?? new Date().getFullYear().toString()
    // alle(): Jahresauswertung über alle Kosteneinträge, nicht nur die ersten 1.000
    const { data: ke } = await alle<R>((s.from('kosteneintraege') as any)
      .select('id, betrag, periode, objekt_typ, kostenstelle:kostenstelle_id(name), kostenart:kostenart_id(name), wg:weingarten_id(name), behaelter:behaelter_id(name)')
      .eq('tenant_id', t).gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`).order('id'))
    const ids = (ke ?? []).map((e: R) => e.id)
    let splits: R[] = []
    if (ids.length > 0) {
      const { data: sd } = await alle<R>((s.from('kosteneintrag_weingaerten') as any)
        .select('kosteneintrag_id, anteil_pct, betrag_anteil, wg:weingarten_id(name, lagen:lage_id(name))').in('kosteneintrag_id', ids).order('id'))
      splits = sd ?? []
    }
    return NextResponse.json({ eintraege: ke ?? [], splits, jahr })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const s = await createSupabaseServerClient()
  const t = await getTId()
  if (!t) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const konflikt = await seitenBetriebKonflikt(t)   // KAN-30: Seite aus einem anderen Betrieb? (Transaktionsnummer)
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(await getCurrentMembership())   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  const b = await req.json() as R

  const fields = {
    kostenstelle_id: b.kostenstelle_id ?? null, kostenart_id: b.kostenart_id ?? null,
    datum: b.datum, betrag: b.betrag, beschreibung: b.beschreibung ?? null,
    periode: b.datum?.slice(0, 7) ?? null, objekt_typ: b.objekt_typ ?? null,
    weingarten_id: null, // immer null – Splits in Junction-Tabelle
    behaelter_id: b.behaelter_id ?? null,
  }

  if (b.action === 'eintrag') {
    const { data: txnKe } = await (s.rpc as any)('get_next_transaktionsnr', { p_tenant_id: t, p_typ: 'kosteneintrag' })
    const { data, error } = await (s.from('kosteneintraege') as any).insert({ tenant_id: t, transaktions_nr: txnKe ?? null, ...fields }).select().single()
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
    { const { error: e } = await (s.from('kosteneintraege') as any).delete().eq('id', b.id).eq('tenant_id', t)
      if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kosteneintraege', meldung: e.message }) }
    return NextResponse.json({ ok: true })
  }
  // Kostenstelle anlegen/bearbeiten/löschen
  if (b.action === 'ks_save') {
    if (b.id) {
      { const { error: e } = await (s.from('kostenstellen') as any).update({ name: b.name, kuerzel: b.kuerzel||null, beschreibung: b.beschreibung||null }).eq('id', b.id).eq('tenant_id', t)
        if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kostenstellen', meldung: e.message }) }
    } else {
      { const { error: e } = await (s.from('kostenstellen') as any).insert({ tenant_id: t, name: b.name, kuerzel: b.kuerzel||null, beschreibung: b.beschreibung||null })
        if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kostenstellen', meldung: e.message }) }
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'ks_delete') {
    { const { error: e } = await (s.from('kostenstellen') as any).update({ aktiv: false }).eq('id', b.id).eq('tenant_id', t)
      if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kostenstellen', meldung: e.message }) }
    return NextResponse.json({ ok: true })
  }
  // Kostenart anlegen/bearbeiten/löschen
  if (b.action === 'ka_save') {
    if (b.id) {
      { const { error: e } = await (s.from('kostenarten') as any).update({ name: b.name, kuerzel: b.kuerzel||null, kategorie: b.kategorie||null }).eq('id', b.id).eq('tenant_id', t)
        if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kostenarten', meldung: e.message }) }
    } else {
      { const { error: e } = await (s.from('kostenarten') as any).insert({ tenant_id: t, name: b.name, kuerzel: b.kuerzel||null, kategorie: b.kategorie||null })
        if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kostenarten', meldung: e.message }) }
    }
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'ka_delete') {
    { const { error: e } = await (s.from('kostenarten') as any).update({ aktiv: false }).eq('id', b.id).eq('tenant_id', t)
      if (e) void ereignisMelden({ art: 'db', quelle: 'kostenrechnung/kostenarten', meldung: e.message }) }
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ fehler: 'Unbekannte Aktion' }, { status: 400 })
}
