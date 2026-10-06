import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { LESE_ARTEN, LESE_ART_LABEL, leseTitel } from '@/lib/wein/lesen'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type SearchResult = {
  id: string
  kategorie: 'kontakt' | 'firma' | 'fuellung' | 'verkauf' | 'kellerbuch' | 'weingarten' | 'grundstueck' | 'jahrgang'
  titel: string
  untertitel?: string
  href: string
}

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

  const supabase = await createSupabaseServerClient()
  const results: SearchResult[] = []

  // ── Kontakte ────────────────────────────────────────────────────────────
  const { data: kontakte } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname, email, segment, accountnummer')
    .or(`vorname.ilike.%${q}%,nachname.ilike.%${q}%,email.ilike.%${q}%,accountnummer.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .limit(5)

  ;(kontakte as R[] ?? []).forEach((k: R) => {
    results.push({
      id:          k.id,
      kategorie:   'kontakt',
      titel:       `${k.vorname ?? ''} ${k.nachname ?? ''}`.trim() || k.email,
      untertitel:  [k.accountnummer, k.segment, k.email].filter(Boolean).join(' · '),
      href:        `/crm/kontakte/${k.id}`,
    })
  })

  // ── Firmen ──────────────────────────────────────────────────────────────
  const { data: firmen } = await (supabase.from('firmen') as any)
    .select('id, name, email, segment, accountnummer')
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,accountnummer.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .limit(5)

  ;(firmen as R[] ?? []).forEach((f: R) => {
    results.push({
      id:         f.id,
      kategorie:  'firma',
      titel:      f.name,
      untertitel: [f.accountnummer, f.segment, f.email].filter(Boolean).join(' · '),
      href:       `/crm/firmen/${f.id}`,
    })
  })

  // ── Füllungen (Warenlager) ───────────────────────────────────────────────
  const { data: fuellungen } = await (supabase.from('fuellungen') as any)
    .select('id, name, jahrgang, rebsorte, chargennummer')
    .or(`name.ilike.%${q}%,chargennummer.ilike.%${q}%,rebsorte.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .limit(5)

  ;(fuellungen as R[] ?? []).forEach((f: R) => {
    results.push({
      id:         f.id,
      kategorie:  'fuellung',
      titel:      f.name ?? f.chargennummer,
      untertitel: [f.jahrgang, f.rebsorte, f.chargennummer].filter(Boolean).join(' · '),
      href:       `/weinhandel/fuellungen/${f.id}/edit`,   // es gibt keine Detailseite, nur Bearbeiten
    })
  })

  // ── Verkaufsposten ───────────────────────────────────────────────────────
  const { data: verkauf } = await (supabase.from('verkaufsposten') as any)
    .select('id, rechnungsnummer, datum, bezahlt, storniert')
    .ilike('rechnungsnummer', `%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .limit(5)

  ;(verkauf as R[] ?? []).forEach((v: R) => {
    const status = v.storniert ? 'storniert' : v.bezahlt ? 'bezahlt' : 'offen'
    results.push({
      id:         v.id,
      kategorie:  'verkauf',
      titel:      v.rechnungsnummer ?? `Beleg ${v.id.slice(0, 8)}`,
      untertitel: [v.datum ? new Date(v.datum).toLocaleDateString('de-AT') : null, status].filter(Boolean).join(' · '),
      href:       `/weinhandel/verkauf/${v.id}`,
    })
  })

  // ── Weingärten ──────────────────────────────────────────────────────────
  const { data: weingaerten } = await (supabase.from('weingarten') as any)
    .select('id, name, ried, rebsorte')
    .or(`name.ilike.%${q}%,ried.ilike.%${q}%,rebsorte.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .limit(5)

  ;(weingaerten as R[] ?? []).forEach((w: R) => {
    results.push({
      id:         w.id,
      kategorie:  'weingarten',
      titel:      w.name,
      untertitel: [w.ried, w.rebsorte].filter(Boolean).join(' · '),
      href:       `/weingarten/${w.id}`,
    })
  })

  // ── Grundstücke (GST) ──────────────────────────────────────────────────────
  const { data: grundstuecke } = await (supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, rebsorte, katastralgemeinde, weingarten:weingarten_id(name)')
    .or(`gst_nr.ilike.%${q}%,rebsorte.ilike.%${q}%,katastralgemeinde.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('nutzart', 'WI')
    .limit(5)

  ;(grundstuecke as R[] ?? []).forEach((g: R) => {
    results.push({
      id:         g.id,
      kategorie:  'grundstueck',
      titel:      `GST ${g.gst_nr}`,
      untertitel: [g.rebsorte, (g.weingarten as R | null)?.name, g.katastralgemeinde].filter(Boolean).join(' · '),
      href:       `/weingarten/${g.weingarten_id}`,
    })
  })

  // ── Jahrgänge (Erntemeldung) ─────────────────────────────────────────────
  const { data: jahrgaenge } = await (supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang, qualitaet_gesamt, abgeschlossen, lesen(lfd_nr, art, bezeichnung)')
    .or(`jahrgang::text.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .limit(5)

  ;(jahrgaenge as R[] ?? []).forEach((j: R) => {
    results.push({
      id:         j.id,
      kategorie:  'jahrgang',
      titel:      `Jahrgang ${j.jahrgang}`,
      // KAN-129: die Lesen des Jahrgangs
      untertitel: [
        ((j.lesen ?? []) as R[]).length > 1
          ? ((j.lesen ?? []) as R[]).slice().sort((a, b) => a.lfd_nr - b.lfd_nr).map(l => leseTitel(j.jahrgang, l as { lfd_nr: number; art: string; bezeichnung: string | null })).join(', ')
          : null,
        j.qualitaet_gesamt, j.abgeschlossen ? 'Abgeschlossen' : null,
      ].filter(Boolean).join(' · '),
      href:       `/erntemeldung/${j.id}`,
    })
  })

  // ── Lesen nach Art (z. B. „Eiswein“) – direkt zum Reiter der Lese (KAN-129) ──
  const qKlein = q.toLowerCase()
  const arten = LESE_ARTEN.filter(a => LESE_ART_LABEL[a].toLowerCase().includes(qKlein))
  if (arten.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lesenTreffer } = await (supabase.from('lesen') as any)
      .select('id, jahrgang_id, lfd_nr, art, bezeichnung, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)')
      .in('art', arten)
      .eq('tenant_id', tenantId)
      .limit(5)
    ;(lesenTreffer as R[] ?? []).forEach((l: R) => {
      const jahr = Number((l.jahrgang as R | null)?.jahrgang)
      results.push({
        id:         l.id,
        kategorie:  'jahrgang',
        titel:      `Lese ${leseTitel(jahr, { lfd_nr: l.lfd_nr, art: l.art, bezeichnung: l.bezeichnung ?? null })}`,
        href:       `/erntemeldung/${l.jahrgang_id}?lese=${l.lfd_nr}`,
      })
    })
  }

  // ── Kellerbuch (Weinausbau-Chargen) ──────────────────────────────────────
  const { data: chargen } = await (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, qualitaetsstufe, zusatzbezeichnung, erzeugnis, status')
    .or(`name.ilike.%${q}%,rebsorte.ilike.%${q}%,jahrgang::text.ilike.%${q}%`)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .limit(5)

  ;(chargen as R[] ?? []).forEach((c: R) => {
    results.push({
      id:         c.id,
      kategorie:  'kellerbuch',
      titel:      c.name ?? `${c.jahrgang} ${c.rebsorte}`,
      untertitel: [c.jahrgang, c.rebsorte, qualitaetAnzeigeOderNull(c), c.status].filter(Boolean).join(' · '),
      href:       `/kellerbuch`,
    })
  })

  return NextResponse.json({ results })
}
