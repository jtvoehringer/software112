import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import BehandlungEditForm from './BehandlungEditForm'
import type { BehandlungEdit, PSMOption } from './BehandlungEditForm'

export const metadata: Metadata = { title: 'Maßnahme bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function BehandlungEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()

  if (!canWrite(role)) redirect('/behandlungen')

  const [{ data: rawB }, { data: rawPsm }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('behandlungen') as any)
      .select(`
        id, datum, datum_bis, art, psm_id, aufwandmenge, aufwandmenge_einheit,
        menge_gesamt, menge_einheit, konzentration, wasseraufwand_l_ha,
        bbch_stadium, schaderreger, witterung, temperatur_c, notizen,
        weingarten:weingarten_id(name),
        psm:psm_id(wartezeit_tage)
      `)
      .eq('id', id)
      .single(),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('psm') as any)
      .select('id, name, handelsname, oeko_zugelassen, cu_gehalt_pct, wartezeit_tage')
      .eq('aktiv', true)
      .order('name'),
  ])

  if (!rawB) notFound()

  const b = rawB as AR
  const behandlung: BehandlungEdit = {
    id:                   b.id,
    datum:                b.datum,
    datum_bis:            b.datum_bis ?? null,
    art:                  b.art ?? 'spritzung',
    psm_id:               b.psm_id ?? null,
    aufwandmenge:         b.aufwandmenge ?? null,
    aufwandmenge_einheit: b.aufwandmenge_einheit ?? null,
    menge_gesamt:         b.menge_gesamt ?? null,
    menge_einheit:        b.menge_einheit ?? null,
    konzentration:        b.konzentration ?? null,
    wasseraufwand_l_ha:   b.wasseraufwand_l_ha ?? null,
    bbch_stadium:         b.bbch_stadium ?? null,
    schaderreger:         b.schaderreger ?? null,
    witterung:            b.witterung ?? null,
    temperatur_c:         b.temperatur_c ?? null,
    notizen:              b.notizen ?? null,
    wartezeit_tage:       b.psm?.wartezeit_tage ?? null,
    weingarten_name:      b.weingarten?.name ?? null,
  }

  const psm: PSMOption[] = ((rawPsm ?? []) as AR[]).map(p => ({
    id:              p.id,
    name:            p.name,
    handelsname:     p.handelsname ?? null,
    oeko_zugelassen: p.oeko_zugelassen ?? false,
    cu_gehalt_pct:   p.cu_gehalt_pct ?? null,
    wartezeit_tage:  p.wartezeit_tage ?? null,
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-teal transition-colors">Maßnahmen</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Bearbeiten</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Maßnahme bearbeiten</h1>
        <p className="text-sm text-s112-muted mt-0.5">Daten korrigieren oder ergänzen</p>
      </div>
      <BehandlungEditForm behandlung={behandlung} psm={psm} />
    </div>
  )
}
