import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import PSMClient from './PSMClient'

export const metadata: Metadata = { title: 'Pflanzenschutzmittel – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type PSMEintrag = {
  id: string; name: string; handelsname: string | null
  kategorie: string | null; wirkstoff: string | null
  wirkstoffgehalt_pct: number | null; cu_gehalt_pct: number | null
  max_aufwand_kg_ha: number | null; max_anwendungen: number | null
  wartezeit_tage: number | null; oeko_zugelassen: boolean
  notizen: string | null
}

export default async function PflanzenschutzPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wirkstoff, wirkstoffgehalt_pct, cu_gehalt_pct, max_aufwand_kg_ha, max_anwendungen, wartezeit_tage, oeko_zugelassen, notizen')
    .eq('aktiv', true)
    .order('name')

  const psm: PSMEintrag[] = ((raw ?? []) as AR[]).map(p => ({
    id:                  p.id,
    name:                p.name,
    handelsname:         p.handelsname ?? null,
    kategorie:           p.kategorie ?? null,
    wirkstoff:           p.wirkstoff ?? null,
    wirkstoffgehalt_pct: p.wirkstoffgehalt_pct ?? null,
    cu_gehalt_pct:       p.cu_gehalt_pct ?? null,
    max_aufwand_kg_ha:   p.max_aufwand_kg_ha ?? null,
    max_anwendungen:     p.max_anwendungen ?? null,
    wartezeit_tage:      p.wartezeit_tage ?? null,
    oeko_zugelassen:     p.oeko_zugelassen ?? false,
    notizen:             p.notizen ?? null,
  }))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pflanzenschutzmittel</h1>
          <p className="text-sm text-s112-muted mt-0.5">Mittelstammdaten · Cu-Gehalt · Grenzwerte · Bio-Zulassung</p>
        </div>
        <span className="text-sm text-s112-muted">{psm.length} Mittel aktiv</span>
      </div>

      <PSMClient psm={psm} writeOk={writeOk} adminOk={adminOk} />
    </div>
  )
}
