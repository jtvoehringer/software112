import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import LagenClient from './LagenClient'
import { herkunftGebietTolerant } from '@/lib/herkunft'

export const metadata: Metadata = { title: 'Rieden – software:112' }

export type Lage = {
  id: string; name: string; gemeinde: string | null
  weinbaugebiet: string | null; notizen: string | null
  /** KAN-165: Weinbaugebiet(e) aus dem Herkunft-Code der Grundstücke (sonst der Ried) – maßgeblich vor dem alten Freitext */
  gebieteAbgeleitet: string[]
}
export type WeingartenRow = {
  id: string; name: string; lage_id: string | null; rebsorte: string | null; flaeche_ha: number | null
}

export default async function LagenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawL } = await (supabase.from('lagen') as any)
    .select('id, name, gemeinde, weinbaugebiet, notizen')
    .eq('tenant_id', membership?.tenantId ?? '')
    .order('name')
  const lagenRoh = (rawL ?? []) as Omit<Lage, 'gebieteAbgeleitet'>[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await (supabase.from('weingarten') as any)
    .select('id, name, lage_id, rebsorte, flaeche_ha, trauben_herkunft_code, grundstuecke(trauben_herkunft_code)')
    .eq('tenant_id', membership?.tenantId ?? '')
    .eq('aktiv', true)
    .order('name')
  const weingaerten = (rawW ?? []) as (WeingartenRow & { trauben_herkunft_code: string | null; grundstuecke: { trauben_herkunft_code: string | null }[] | null })[]
  // KAN-165: Gebiete je Lage aus den Codes der Grundstücke ihrer Rieden (Ried-Code, wenn das Grundstück keinen hat)
  const gebieteJeLage = new Map<string, Set<string>>()
  for (const w of weingaerten) {
    if (!w.lage_id) continue
    const codes = (w.grundstuecke ?? []).map(g => g.trauben_herkunft_code ?? w.trauben_herkunft_code)
    if (codes.length === 0) codes.push(w.trauben_herkunft_code)
    const set = gebieteJeLage.get(w.lage_id) ?? new Set<string>()
    for (const c of codes) { const g = herkunftGebietTolerant(c); if (g) set.add(g) }
    gebieteJeLage.set(w.lage_id, set)
  }
  const lagen: Lage[] = lagenRoh.map(l => ({ ...l, gebieteAbgeleitet: [...(gebieteJeLage.get(l.id) ?? [])].sort((a, b) => a.localeCompare(b, 'de')) }))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Rieden</h1>
          <p className="text-sm text-s112-muted mt-0.5">Rieden verwalten</p>
        </div>
        {writeOk && (
          <Link
            href="/lagen/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            <span>＋</span> Neue Ried
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{lagen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Lagen</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">
            {weingaerten.filter(w => w.lage_id).length}
          </p>
          <p className="text-xs text-s112-muted mt-1">Zugeordnete Weingärten</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">
            {weingaerten.filter(w => !w.lage_id).length}
          </p>
          <p className="text-xs text-s112-muted mt-1">Nicht zugeordnet</p>
        </div>
      </div>

      <LagenClient lagen={lagen} weingaerten={weingaerten} writeOk={writeOk} adminOk={adminOk} />
    </div>
  )
}
