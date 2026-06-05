import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import UmziehenClient from './UmziehenClient'

export const metadata: Metadata = { title: 'Umziehen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function UmziehenPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [
    { data: waRaw },
    { data: bhRaw },
    { data: umzugRaw },
  ] = await Promise.all([
    // Aktive Chargen mit Behälter-Name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, qualitaetsstufe, status, behaelter_id, behaelter:behaelter_id(name)')
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
      .order('name'),

    // Alle aktiven Behälter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('behaelter') as any)
      .select('id, name, volumen_liter')
      .eq('aktiv', true)
      .order('name'),

    // Umzug-Protokoll mit Join-Namen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, verschnitt, qualitaet_vorher, qualitaet_nachher, notizen, von_weinausbau:von_weinausbau_id(name), nach_behaelter:nach_behaelter_id(name)')
      .order('datum', { ascending: false })
      .order('erstellt_am', { ascending: false })
      .limit(50),
  ])

  const chargen: { id: string; name: string; jahrgang: number | null; menge_liter: number | null; behaelter_name: string | null }[] = ((waRaw ?? []) as R[]).map(w => ({
    id:              w.id,
    name:            w.name,
    jahrgang:        w.jahrgang ?? null,
    menge_liter:     w.menge_liter ?? null,
    behaelter_name:  (w.behaelter as R | null)?.name ?? null,
  }))

  const behaelter: { id: string; name: string; kapazitaet_liter: number | null }[] = ((bhRaw ?? []) as R[]).map(b => ({
    id:           b.id,
    name:         b.name,
    kapazitaet_liter: b.volumen_liter ?? null,
  }))

  const umzuege: { id: string; von_name: string; nach_name: string; menge_liter: number; schwund_liter: number; datum: string; notizen: string | null }[] = ((umzugRaw ?? []) as R[]).map(u => ({
    id:               u.id,
    datum:            u.datum,
    von_name:         (u.von_weinausbau as R | null)?.name ?? '–',
    nach_name:        (u.nach_behaelter as R | null)?.name ?? '–',
    menge_liter:      u.menge_liter,
    schwund_liter:    u.schwund_liter ?? 0,
    notizen:          u.notizen ?? null,
  }))

  return (
    <div>
      <UmziehenClient
        chargen={chargen}
        behaelter={behaelter}
        umzuege={umzuege}
        writeOk={writeOk}
      />
    </div>
  )
}
