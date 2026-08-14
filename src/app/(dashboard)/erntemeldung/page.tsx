import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import JahrgaengeClient from './JahrgaengeClient'

export const metadata: Metadata = { title: 'Lese – software:112' }

export type Jahrgang = {
  id: string; jahrgang: number; ernte_beginn: string | null; ernte_ende: string | null
  qualitaet_gesamt: string | null; ama_gemeldet: boolean; ama_meldedatum: string | null
  abgeschlossen: boolean; notizen: string | null
  parzellen_count: number; gesamtmenge_kg: number; avg_kmw: number | null
  ama_status: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function ErntemeldungPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawJ } = await (supabase.from('weinjahrgaenge') as any)
    .select(`id, jahrgang, ernte_beginn, ernte_ende, qualitaet_gesamt,
             ama_gemeldet, ama_meldedatum, abgeschlossen, notizen`)
    .eq('tenant_id', tenantId)
    .order('jahrgang', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawP } = await (supabase.from('ernte_parzellen') as any)
    .select('jahrgang_id, menge_kg, klosterneuburger')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawA } = await (supabase.from('ama_erntemeldungen') as any)
    .select('jahrgang_id, status')
    .eq('tenant_id', tenantId)

  const parzellenByJG = new Map<string, { count: number; kg: number; kmwSum: number; kmwCount: number }>()
  for (const p of (rawP ?? []) as AR[]) {
    const curr = parzellenByJG.get(p.jahrgang_id) ?? { count: 0, kg: 0, kmwSum: 0, kmwCount: 0 }
    curr.count++
    curr.kg += p.menge_kg ?? 0
    if (p.klosterneuburger != null) { curr.kmwSum += p.klosterneuburger; curr.kmwCount++ }
    parzellenByJG.set(p.jahrgang_id, curr)
  }

  const amaByJG = new Map<string, string>()
  for (const a of (rawA ?? []) as AR[]) amaByJG.set(a.jahrgang_id, a.status)

  const jahrgaenge: Jahrgang[] = ((rawJ ?? []) as AR[]).map(j => ({
    id:               j.id,
    jahrgang:         j.jahrgang,
    ernte_beginn:     j.ernte_beginn,
    ernte_ende:       j.ernte_ende,
    qualitaet_gesamt: j.qualitaet_gesamt,
    ama_gemeldet:     j.ama_gemeldet,
    ama_meldedatum:   j.ama_meldedatum,
    abgeschlossen:    j.abgeschlossen,
    notizen:          j.notizen,
    parzellen_count:  parzellenByJG.get(j.id)?.count ?? 0,
    gesamtmenge_kg:   parzellenByJG.get(j.id)?.kg ?? 0,
    avg_kmw:          (() => { const d = parzellenByJG.get(j.id); return d && d.kmwCount > 0 ? d.kmwSum / d.kmwCount : null })(),
    ama_status:       amaByJG.get(j.id) ?? null,
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/weingarten" className="hover:text-s112-teal transition-colors">Rieden</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Lese</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lese</h1>
          <p className="text-sm text-s112-muted mt-0.5">Jahrgänge, Lesedaten & AMA-Meldung</p>
        </div>
        {writeOk && (
          <Link href="/erntemeldung/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            <span>＋</span> Neuer Jahrgang
          </Link>
        )}
      </div>

      <JahrgaengeClient jahrgaenge={jahrgaenge} writeOk={writeOk} adminOk={adminOk} />
    </div>
  )
}
