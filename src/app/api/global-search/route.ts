import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type SearchResult = {
  id: string
  kategorie: 'kontakt' | 'firma' | 'fuellung' | 'verkauf' | 'kellerbuch'
  titel: string
  untertitel?: string
  href: string
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const supabase = await createSupabaseServerClient()
  const results: SearchResult[] = []

  // ── Kontakte ────────────────────────────────────────────────────────────
  const { data: kontakte } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname, email, segment, kundennummer')
    .or(`vorname.ilike.%${q}%,nachname.ilike.%${q}%,email.ilike.%${q}%,kundennummer.ilike.%${q}%`)
    .eq('aktiv', true)
    .limit(5)

  ;(kontakte as R[] ?? []).forEach((k: R) => {
    results.push({
      id:          k.id,
      kategorie:   'kontakt',
      titel:       `${k.vorname ?? ''} ${k.nachname ?? ''}`.trim() || k.email,
      untertitel:  [k.kundennummer, k.segment, k.email].filter(Boolean).join(' · '),
      href:        `/crm/kontakte/${k.id}`,
    })
  })

  // ── Firmen ──────────────────────────────────────────────────────────────
  const { data: firmen } = await (supabase.from('firmen') as any)
    .select('id, name, email, segment, kundennummer')
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,kundennummer.ilike.%${q}%`)
    .eq('aktiv', true)
    .limit(5)

  ;(firmen as R[] ?? []).forEach((f: R) => {
    results.push({
      id:         f.id,
      kategorie:  'firma',
      titel:      f.name,
      untertitel: [f.kundennummer, f.segment, f.email].filter(Boolean).join(' · '),
      href:       `/crm/firmen/${f.id}`,
    })
  })

  // ── Füllungen (Warenlager) ───────────────────────────────────────────────
  const { data: fuellungen } = await (supabase.from('fuellungen') as any)
    .select('id, name, jahrgang, rebsorte, chargennummer')
    .or(`name.ilike.%${q}%,chargennummer.ilike.%${q}%,rebsorte.ilike.%${q}%`)
    .eq('aktiv', true)
    .limit(5)

  ;(fuellungen as R[] ?? []).forEach((f: R) => {
    results.push({
      id:         f.id,
      kategorie:  'fuellung',
      titel:      f.name ?? f.chargennummer,
      untertitel: [f.jahrgang, f.rebsorte, f.chargennummer].filter(Boolean).join(' · '),
      href:       `/weinhandel/fuellungen/${f.id}`,
    })
  })

  // ── Verkaufsposten ───────────────────────────────────────────────────────
  const { data: verkauf } = await (supabase.from('verkaufsposten') as any)
    .select('id, rechnungsnummer, datum, bezahlt, storniert')
    .ilike('rechnungsnummer', `%${q}%`)
    .eq('aktiv', true)
    .limit(5)

  ;(verkauf as R[] ?? []).forEach((v: R) => {
    const status = v.storniert ? 'storniert' : v.bezahlt ? 'bezahlt' : 'offen'
    results.push({
      id:         v.id,
      kategorie:  'verkauf',
      titel:      v.rechnungsnummer ?? `Beleg ${v.id.slice(0, 8)}`,
      untertitel: [v.datum ? new Date(v.datum).toLocaleDateString('de-AT') : null, status].filter(Boolean).join(' · '),
      href:       `/verkauf/${v.id}`,
    })
  })

  // ── Kellerbuch (Weinausbau-Chargen) ──────────────────────────────────────
  const { data: chargen } = await (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, qualitaetsstufe, status')
    .or(`name.ilike.%${q}%,rebsorte.ilike.%${q}%,jahrgang::text.ilike.%${q}%`)
    .eq('aktiv', true)
    .limit(5)

  ;(chargen as R[] ?? []).forEach((c: R) => {
    results.push({
      id:         c.id,
      kategorie:  'kellerbuch',
      titel:      c.name ?? `${c.jahrgang} ${c.rebsorte}`,
      untertitel: [c.jahrgang, c.rebsorte, c.qualitaetsstufe, c.status].filter(Boolean).join(' · '),
      href:       `/kellerbuch`,
    })
  })

  return NextResponse.json({ results })
}
