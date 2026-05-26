import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import NeueBehandlungForm from './NeueBehandlungForm'

export const metadata: Metadata = { title: 'Neue Behandlung – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type PSM = {
  id: string; name: string; handelsname: string | null
  kategorie: string | null; wartezeit_tage: number | null
  aufwandmenge_einheit?: string | null; oeko_zugelassen: boolean
}
export type WeingartenOption = {
  id: string; name: string; ried: string | null; lage_id: string | null; lage_name: string | null
  spritzbar: boolean  // false wenn alle Grundstücke nicht spritzbar
}

export default async function NeueBehandlungPage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/behandlungen')

  const supabase = await createSupabaseServerClient()

  // PSM laden (global + eigene)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSM } = await (supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wartezeit_tage, oeko_zugelassen')
    .eq('aktiv', true)
    .order('name')
  const psm = (rawPSM ?? []) as PSM[]

  // Aktive Weingärten mit Lage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await (supabase.from('weingarten') as any)
    .select('id, name, ried, lage_id, lagen:lage_id(name)')
    .eq('aktiv', true)
    .order('name')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawWeingarten = (rawW ?? []) as any[]

  // Grundstücke laden um spritzbar zu bestimmen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await (supabase.from('grundstuecke') as any)
    .select('weingarten_id, status')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grundstuecke = (rawG ?? []) as any[]

  // Spritzbarkeit je Weingarten berechnen
  const gstByWG = new Map<string, string[]>()
  for (const g of grundstuecke) {
    const arr = gstByWG.get(g.weingarten_id) ?? []
    arr.push(g.status)
    gstByWG.set(g.weingarten_id, arr)
  }

  const weingaerten: WeingartenOption[] = rawWeingarten.map((w: AR) => {
    const stati = gstByWG.get(w.id) ?? []
    // Spritzbar wenn: keine GST vorhanden ODER mindestens ein aktives GST
    const spritzbar = stati.length === 0 || stati.some(s => s === 'aktiv')
    return {
      id: w.id,
      name: w.name,
      ried: w.ried ?? null,
      lage_id: w.lage_id ?? null,
      lage_name: w.lagen?.name ?? null,
      spritzbar,
    }
  })

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <a href="/behandlungen" className="hover:text-s112-teal transition-colors">Behandlungen</a>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neue Behandlung</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Neue Behandlung erfassen</h1>
      <NeueBehandlungForm psm={psm} weingaerten={weingaerten} />
    </div>
  )
}
