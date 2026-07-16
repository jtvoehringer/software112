import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import NeueBehandlungForm from './NeueBehandlungForm'

export const metadata: Metadata = { title: 'Neue Maßnahme – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type PSM = {
  id: string; name: string; handelsname: string | null
  kategorie: string | null; wartezeit_tage: number | null
  oeko_zugelassen: boolean; cu_gehalt_pct: number | null
}
export type WeingartenOption = {
  id: string; name: string; ried: string | null; lage_id: string | null; lage_name: string | null
  spritzbar: boolean       // false wenn alle Grundstücke nicht spritzbar
  gst_ha_aktiv: number     // Summe flaeche_ha aktiver Grundstücke (für anteilige Berechnung)
}

export default async function NeueBehandlungPage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/behandlungen')

  const supabase = await createSupabaseServerClient()

  // PSM laden (global + eigene) — inkl. cu_gehalt_pct
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSM } = await (supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wartezeit_tage, oeko_zugelassen, cu_gehalt_pct')
    .eq('aktiv', true)
    .order('name')
  const psm: PSM[] = ((rawPSM ?? []) as AR[]).map(p => ({
    id:             p.id,
    name:           p.name,
    handelsname:    p.handelsname ?? null,
    kategorie:      p.kategorie ?? null,
    wartezeit_tage: p.wartezeit_tage ?? null,
    oeko_zugelassen: p.oeko_zugelassen ?? false,
    cu_gehalt_pct:  p.cu_gehalt_pct ?? null,
  }))

  // Aktive Weingärten mit Lage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await (supabase.from('weingarten') as any)
    .select('id, name, ried, lage_id, lagen:lage_id(name)')
    .eq('aktiv', true)
    .order('name')

  // Grundstücke laden: status + flaeche_ha
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await (supabase.from('grundstuecke') as any)
    .select('weingarten_id, status, flaeche_ha')

  // Flächensumme und Spritzbarkeit je Weingarten berechnen
  const gstByWG = new Map<string, { status: string; ha: number }[]>()
  for (const g of ((rawG ?? []) as AR[])) {
    const arr = gstByWG.get(g.weingarten_id) ?? []
    arr.push({ status: g.status, ha: g.flaeche_ha ?? 0 })
    gstByWG.set(g.weingarten_id, arr)
  }

  const weingaerten: WeingartenOption[] = ((rawW ?? []) as AR[]).map(w => {
    const gsts = gstByWG.get(w.id) ?? []
    const spritzbar = gsts.length === 0 || gsts.some(g => g.status === 'aktiv')
    const gst_ha_aktiv = gsts.filter(g => g.status === 'aktiv').reduce((s, g) => s + g.ha, 0)
    return {
      id:           w.id,
      name:         w.name,
      ried:         w.ried ?? null,
      lage_id:      w.lage_id ?? null,
      lage_name:    w.lagen?.name ?? null,
      spritzbar,
      gst_ha_aktiv,
    }
  })

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <a href="/behandlungen" className="hover:text-s112-teal transition-colors">Maßnahmen</a>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neue Maßnahme</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Neue Maßnahme erfassen</h1>
      <NeueBehandlungForm psm={psm} weingaerten={weingaerten} />
    </div>
  )
}
