import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import KellerAuswertungenClient from './KellerAuswertungenClient'

export const metadata: Metadata = { title: 'Keller-Auswertungen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KellerAuswertungenPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const thisYear    = new Date().getFullYear()
  const jahresStart = `${thisYear}-01-01`

  const [
    { data: behaelterRaw },
    { data: chargenRaw },
    { data: behandlungenRaw },
    { data: umzuegeRaw },
    { data: fuellungenRaw },
  ] = await Promise.all([
    tf((supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv')
      .eq('aktiv', true).order('name')),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand')
      .order('jahrgang', { ascending: false })),
    tf((supabase.from('keller_behandlungen') as any)
      .select('id, datum, menge, einheit, behaelter_id, behaelter:behaelter_id(name), typ:typ_id(name)')
      .gte('datum', jahresStart).order('datum', { ascending: false })),
    tf((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, notizen, von_behaelter:von_behaelter_id(name), nach_behaelter:nach_behaelter_id(name), von_weinausbau:von_weinausbau_id(name)')
      .gte('datum', jahresStart).not('zeilen_typ', 'eq', 'ziel')
      .order('datum', { ascending: false }).limit(100)),
    tf((supabase.from('fuellungen') as any)
      .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt')
      .gte('datum', jahresStart).order('datum', { ascending: false })),
  ])

  const behaelter    = (behaelterRaw    ?? []) as R[]
  const chargen      = (chargenRaw      ?? []) as R[]
  const behandlungen = (behandlungenRaw ?? []) as R[]
  const umzuege      = (umzuegeRaw      ?? []) as R[]
  const fuellungen   = (fuellungenRaw   ?? []) as R[]

  const aktiveChargen = chargen.filter((c: R) => c.aktiv && c.status !== 'abgeschlossen')

  // Liter pro Behaelter
  const literByBehaelterMap = new Map<string, number>()
  for (const c of aktiveChargen) {
    if (c.behaelter_id) {
      literByBehaelterMap.set(c.behaelter_id, (literByBehaelterMap.get(c.behaelter_id) ?? 0) + (parseFloat(c.menge_liter) || 0))
    }
  }
  const literByBehaelter = Object.fromEntries(literByBehaelterMap)

  const gesamtLiter      = aktiveChargen.reduce((s: number, c: R) => s + (parseFloat(c.menge_liter) || 0), 0)
  const gesamtKapazitaet = behaelter.reduce((s: number, b: R) => s + (parseFloat(b.volumen_liter) || 0), 0)
  const gesamtAuslastung = gesamtKapazitaet > 0 ? Math.min(100, (gesamtLiter / gesamtKapazitaet) * 100) : 0
  const schwundGesamt    = umzuege.reduce((s: number, u: R) => s + (parseFloat(u.schwund_liter) || 0), 0)
  const abgefuelltLiter  = fuellungen.reduce((s: number, f: R) => s + (parseFloat(f.menge_liter_gefuellt) || 0), 0)

  // Behandlungen nach Typ
  const behandlungTypMap = new Map<string, number>()
  for (const b of behandlungen) {
    const typ = (b.typ as R | null)?.name ?? 'Unbekannt'
    behandlungTypMap.set(typ, (behandlungTypMap.get(typ) ?? 0) + 1)
  }

  return (
    <KellerAuswertungenClient
      behaelter={behaelter}
      aktiveChargen={aktiveChargen}
      behandlungen={behandlungen}
      umzuege={umzuege}
      literByBehaelter={literByBehaelter}
      gesamtLiter={gesamtLiter}
      gesamtKapazitaet={gesamtKapazitaet}
      gesamtAuslastung={gesamtAuslastung}
      schwundGesamt={schwundGesamt}
      abgefuelltLiter={abgefuelltLiter}
      behandlungTypMap={Array.from(behandlungTypMap.entries())}
      thisYear={thisYear}
    />
  )
}
