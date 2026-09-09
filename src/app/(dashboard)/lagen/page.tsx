import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import LagenClient from './LagenClient'

export const metadata: Metadata = { title: 'Rieden – software:112' }

export type Lage = {
  id: string; name: string; gemeinde: string | null
  weinbaugebiet: string | null; notizen: string | null
}
export type WeingartenRow = {
  id: string; name: string; lage_id: string | null; rebsorte: string | null; flaeche_ha: number | null
}

export default async function LagenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawL } = await (supabase.from('lagen') as any)
    .select('id, name, gemeinde, weinbaugebiet, notizen')
    .eq('tenant_id', membership?.tenantId ?? '')
    .order('name')
  const lagen = (rawL ?? []) as Lage[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await (supabase.from('weingarten') as any)
    .select('id, name, lage_id, rebsorte, flaeche_ha')
    .eq('tenant_id', membership?.tenantId ?? '')
    .eq('aktiv', true)
    .order('name')
  const weingaerten = (rawW ?? []) as WeingartenRow[]

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
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
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
