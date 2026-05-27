import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import UmziehenClient from './UmziehenClient'
import type { WeinausbauItem, BehaelterItem, UmzugItem } from './UmziehenClient'

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

  const chargen: WeinausbauItem[] = ((waRaw ?? []) as R[]).map(w => ({
    id:              w.id,
    name:            w.name,
    jahrgang:        w.jahrgang ?? null,
    rebsorte:        w.rebsorte ?? null,
    menge_liter:     w.menge_liter ?? null,
    qualitaetsstufe: w.qualitaetsstufe ?? null,
    behaelter_id:    w.behaelter_id ?? null,
    behaelter_name:  (w.behaelter as R | null)?.name ?? null,
    status:          w.status,
  }))

  const behaelter: BehaelterItem[] = ((bhRaw ?? []) as R[]).map(b => ({
    id:           b.id,
    name:         b.name,
    volumen_liter: b.volumen_liter ?? null,
  }))

  const umzuege: UmzugItem[] = ((umzugRaw ?? []) as R[]).map(u => ({
    id:               u.id,
    datum:            u.datum,
    von_name:         (u.von_weinausbau as R | null)?.name ?? '–',
    nach_name:        (u.nach_behaelter as R | null)?.name ?? '–',
    menge_liter:      u.menge_liter,
    schwund_liter:    u.schwund_liter ?? 0,
    verschnitt:       u.verschnitt ?? false,
    qualitaet_vorher: u.qualitaet_vorher ?? null,
    qualitaet_nachher:u.qualitaet_nachher ?? null,
    notizen:          u.notizen ?? null,
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Umziehen</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Umziehen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Chargen zwischen Behältern bewegen · Schwund · Verschnitt-Prüfung</p>
        </div>
        <span className="text-sm text-s112-muted">{chargen.length} Chargen aktiv</span>
      </div>

      <UmziehenClient
        chargen={chargen}
        behaelter={behaelter}
        umzuege={umzuege}
        writeOk={writeOk}
      />
    </div>
  )
}
