import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WeingartenForm from '@/components/weingarten/WeingartenForm'
import GrundstueckePanel, { type GST } from '../GrundstueckePanel'
import { updateWeingarten } from '../actions'

export const metadata: Metadata = { title: 'Weingarten bearbeiten – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

interface Props {
  params: Promise<{ id: string }>
}

type WeingartenRow = {
  id: string; name: string; ried: string | null; lage_id: string | null
  rebsorte: string | null; flaeche_ha: number | null; pflanzjahr: number | null
  bewirtschaftung: string | null; notizen: string | null; aktiv: boolean
}

export default async function WeingartenEditPage({ params }: Props) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // Weingarten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase.from('weingarten') as any)
    .select('id, name, ried, lage_id, rebsorte, flaeche_ha, pflanzjahr, bewirtschaftung, notizen, aktiv')
    .eq('id', id)
    .limit(1)
  const weingarten = ((rows as WeingartenRow[] | null)?.[0]) ?? null
  if (!weingarten) notFound()

  // Lagen für Dropdown
  let lagen: { id: string; name: string }[] = []
  if (membership?.tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lagenData } = await (supabase.from('lagen') as any)
      .select('id, name')
      .eq('tenant_id', membership.tenantId)
      .order('name')
    lagen = ((lagenData ?? []) as AR[]).map(l => ({ id: l.id as string, name: l.name as string }))
  }

  // Grundstücke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await (supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, katastralgemeinde, einlagezahl, rebsorte, pflanzjahr, flaeche_ha, status, notizen')
    .eq('weingarten_id', id)
    .order('gst_nr')
  const grundstuecke = (rawG ?? []) as GST[]

  const action = updateWeingarten.bind(null, id)

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-teal transition-colors">Weingarten</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{weingarten.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{weingarten.name}</h1>
        {!weingarten.aktiv && (
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-full font-medium">
            Inaktiv
          </span>
        )}
      </div>

      {/* Stammdaten-Formular */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Stammdaten</h2>
        <WeingartenForm weingarten={weingarten} action={action} lagen={lagen} />
      </div>

      {/* Grundstücke */}
      <div className="card">
        <GrundstueckePanel
          weingartenId={id}
          grundstuecke={grundstuecke}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      </div>
    </div>
  )
}
