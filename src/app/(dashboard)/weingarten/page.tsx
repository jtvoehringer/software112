import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import WeingartenBaum, { type WRow, type GSTRow } from './WeingartenBaum'
import WeingartenCsvExportButton from './WeingartenCsvExportButton'
import { fmtHa } from '@/lib/format'

export const metadata: Metadata = { title: 'Rieden – software:112' }

export default async function WeingartenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Weingärten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await tf((supabase.from('weingarten') as any)
    .select('id, name, ried, rebsorte, weinart, flaeche_ha, bewirtschaftung, aktiv, ama_feldnummer, codes, interne_bezeichnung'))
    .order('ried', { nullsFirst: false })
    .order('name')
  const weingaerten = (rawW ?? []) as WRow[]

  // Grundstücke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await tf((supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, rebsorte, flaeche_ha, flaeche_ha_kataster, spritzbar, katastralgemeinde, status, nutzart, ama_feldnummer'))
    .order('gst_nr')
  const grundstuecke = (rawG ?? []) as GSTRow[]

  const aktive = weingaerten.filter(w => w.aktiv)
  // Ha-Summe AMA: Grundstücks-Summe falls vorhanden, sonst Weingarten-Fläche
  const gstHaMap = new Map<string, number>()
  for (const g of grundstuecke) {
    gstHaMap.set(g.weingarten_id, (gstHaMap.get(g.weingarten_id) ?? 0) + (g.flaeche_ha ?? 0))
  }
  const gesamtHaAma = aktive.reduce((s, w) => {
    return s + (gstHaMap.get(w.id) ?? w.flaeche_ha ?? 0)
  }, 0)

  const gstKatasterMap = new Map<string, number>()
  for (const g of grundstuecke) {
    if (g.flaeche_ha_kataster) gstKatasterMap.set(g.weingarten_id, (gstKatasterMap.get(g.weingarten_id) ?? 0) + g.flaeche_ha_kataster)
  }
  const gesamtHaKataster = aktive.reduce((s, w) => s + (gstKatasterMap.get(w.id) ?? 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rieden</h1>
          <p className="text-sm text-s112-muted mt-0.5">Rieden & Grundstücke</p>
        </div>
        <div className="flex items-center gap-3">
          {weingaerten.length > 0 && (
            <WeingartenCsvExportButton weingaerten={weingaerten} grundstuecke={grundstuecke} />
          )}
          {writeOk && (
            <Link
              href="/weingarten/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              Neue Ried
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{aktive.length}</p>
          <p className="text-xs text-s112-muted mt-1">Rieden</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{grundstuecke.length}</p>
          <p className="text-xs text-s112-muted mt-1">Grundstücke</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{fmtHa(gesamtHaAma)}</p>
          <p className="text-xs text-s112-muted mt-1 leading-tight">GST-Fläche<br />lt. AMA</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{gesamtHaKataster > 0 ? fmtHa(gesamtHaKataster) : '–'}</p>
          <p className="text-xs text-s112-muted mt-1 leading-tight">GST-Fläche<br />lt. Kataster</p>
        </div>
      </div>

      {/* Baum */}
      {weingaerten.length > 0 ? (
        <WeingartenBaum
          weingaerten={weingaerten}
          grundstuecke={grundstuecke}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      ) : (
        <div className="card text-center py-16">
          <p className="text-gray-700 font-medium">Noch keine Rieden angelegt</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihre erste Ried an</p>
          {writeOk && (
            <Link
              href="/weingarten/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              Erste Ried anlegen
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
