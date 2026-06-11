import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import WeingartenBaum, { type WRow, type GSTRow } from './WeingartenBaum'
import { fmtHa } from '@/lib/format'

export const metadata: Metadata = { title: 'Weingarten – software:112' }

export default async function WeingartenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // Weingärten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await (supabase.from('weingarten') as any)
    .select('id, name, ried, rebsorte, flaeche_ha, bewirtschaftung, aktiv')
    .order('ried', { nullsFirst: false })
    .order('name')
  const weingaerten = (rawW ?? []) as WRow[]

  // Grundstücke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await (supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, rebsorte, flaeche_ha, spritzbar, katastralgemeinde')
    .order('gst_nr')
  const grundstuecke = (rawG ?? []) as GSTRow[]

  const aktive   = weingaerten.filter(w => w.aktiv)
  // Ha-Summe: bevorzuge Grundstücks-Summe falls vorhanden
  const gstHaMap = new Map<string, number>()
  for (const g of grundstuecke) {
    gstHaMap.set(g.weingarten_id, (gstHaMap.get(g.weingarten_id) ?? 0) + (g.flaeche_ha ?? 0))
  }
  const gesamtHa = aktive.reduce((s, w) => {
    return s + (gstHaMap.get(w.id) ?? w.flaeche_ha ?? 0)
  }, 0)
  const lagen = new Set(aktive.map(w => w.ried).filter(Boolean)).size

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weingarten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Rieden & Weingarten-Stammdaten</p>
        </div>
        {writeOk && (
          <Link
            href="/weingarten/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            <span>＋</span> Neuer Weingarten
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{lagen}</p>
          <p className="text-xs text-s112-muted mt-1">Riede / Lagen</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{aktive.length}</p>
          <p className="text-xs text-s112-muted mt-1">Weingärten</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{grundstuecke.length}</p>
          <p className="text-xs text-s112-muted mt-1">Grundstücke</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{fmtHa(gesamtHa, 2)}</p>
          <p className="text-xs text-s112-muted mt-1">Hektar gesamt</p>
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
          <p className="text-4xl mb-4">🌿</p>
          <p className="text-gray-700 font-medium">Noch keine Weingärten angelegt</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihren ersten Weingarten an</p>
          {writeOk && (
            <Link
              href="/weingarten/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              ＋ Erster Weingarten
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
