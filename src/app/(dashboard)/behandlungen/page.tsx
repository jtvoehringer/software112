import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import BehandlungenClient from './BehandlungenClient'

export const metadata: Metadata = { title: 'Behandlungen – software:112' }

export type Behandlung = {
  id: string
  datum: string
  weingarten_id: string | null
  weingarten_name: string | null
  weingarten_ried: string | null
  psm_name: string | null
  psm_wartezeit: number | null
  aufwandmenge: number | null
  aufwandmenge_einheit: string | null
  bbch_stadium: string | null
  witterung: string | null
  ernte_fruehesteins: string | null
  notizen: string | null
}

export default async function BehandlungenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // Behandlungen mit JOIN auf weingarten + psm
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawB } = await (supabase.from('behandlungen') as any)
    .select(`
      id, datum, weingarten_id, aufwandmenge, aufwandmenge_einheit,
      bbch_stadium, witterung, ernte_fruehesteins, notizen,
      weingarten:weingarten_id ( name, ried ),
      psm:psm_id ( name, wartezeit_tage )
    `)
    .order('datum', { ascending: false })
    .limit(200)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const behandlungen: Behandlung[] = ((rawB ?? []) as any[]).map((b: any) => ({
    id:                   b.id,
    datum:                b.datum,
    weingarten_id:        b.weingarten_id,
    weingarten_name:      b.weingarten?.name ?? null,
    weingarten_ried:      b.weingarten?.ried ?? null,
    psm_name:             b.psm?.name ?? null,
    psm_wartezeit:        b.psm?.wartezeit_tage ?? null,
    aufwandmenge:         b.aufwandmenge,
    aufwandmenge_einheit: b.aufwandmenge_einheit,
    bbch_stadium:         b.bbch_stadium,
    witterung:            b.witterung,
    ernte_fruehesteins:   b.ernte_fruehesteins,
    notizen:              b.notizen,
  }))

  // Stats
  const heute = new Date().toISOString().split('T')[0]
  const letzten30 = behandlungen.filter(b => b.datum >= new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]).length
  const offeneWartezeiten = behandlungen.filter(b => b.ernte_fruehesteins && b.ernte_fruehesteins > heute).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Behandlungen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Pflanzenschutz-Protokoll</p>
        </div>
        {writeOk && (
          <Link
            href="/behandlungen/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            <span>＋</span> Neue Behandlung
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{behandlungen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Behandlungen gesamt</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{letzten30}</p>
          <p className="text-xs text-s112-muted mt-1">Letzte 30 Tage</p>
        </div>
        <div className="card text-center">
          <p className={`text-3xl font-bold ${offeneWartezeiten > 0 ? 'text-amber-500' : 'text-s112-teal'}`}>
            {offeneWartezeiten}
          </p>
          <p className="text-xs text-s112-muted mt-1">Offene Wartezeiten</p>
        </div>
      </div>

      <BehandlungenClient behandlungen={behandlungen} adminOk={adminOk} />
    </div>
  )
}
