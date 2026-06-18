
type ErtragHistorie = {
  jahrgang: number
  menge_kg: number
  datum: string | null
}
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
  weinart: string | null; trauben_verkauf: boolean; trauben_herkunft_code: string | null
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
    .select('id, name, ried, lage_id, rebsorte, flaeche_ha, pflanzjahr, bewirtschaftung, weinart, notizen, aktiv, trauben_verkauf, trauben_herkunft_code')
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

  // Historische Ertragsdaten aus ernte_parzellen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawErtrag } = await (supabase.from('ernte_parzellen') as any)
    .select('menge_kg, ernte_datum, weinjahrgaenge!jahrgang_id(jahrgang)')
    .eq('weingarten_id', id)
    .not('menge_kg', 'is', null)
    .order('ernte_datum', { ascending: false })
  const ertragHistorie: ErtragHistorie[] = ((rawErtrag ?? []) as AR[])
    .filter((r: AR) => r.weinjahrgaenge?.jahrgang)
    .map((r: AR) => ({
      jahrgang: r.weinjahrgaenge.jahrgang as number,
      menge_kg: r.menge_kg as number,
      datum: r.ernte_datum as string | null,
    }))

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

      {/* Historische Ertragsdaten */}
      {ertragHistorie.length > 0 && (
        <div className="card mt-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Ertragshistorie</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Jahrgang</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Ernte-Datum</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Menge (kg)</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">kg/ha</th>
              </tr>
            </thead>
            <tbody>
              {ertragHistorie.map((e, i) => (
                <tr key={i} className="border-b border-s112-border/40 hover:bg-s112-bg/50">
                  <td className="px-3 py-2 font-semibold text-gray-800">{e.jahrgang}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {e.datum ? new Date(e.datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800">
                    {e.menge_kg.toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600">
                    {weingarten.flaeche_ha
                      ? (e.menge_kg / weingarten.flaeche_ha).toLocaleString('de-AT', { maximumFractionDigits: 0 })
                      : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
