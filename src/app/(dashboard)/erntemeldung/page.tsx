import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import JahrgaengeClient from './JahrgaengeClient'
import type { Lese } from '@/lib/wein/lesen'

export const metadata: Metadata = { title: 'Lese – software:112' }

export type Jahrgang = {
  id: string; jahrgang: number
  qualitaet_gesamt: string | null; ama_gemeldet: boolean; ama_meldedatum: string | null
  abgeschlossen: boolean; notizen: string | null
  parzellen_count: number; gesamtmenge_kg: number; avg_kmw: number | null
  ama_status: string | null
  /** KAN-129: Lesen des Jahrgangs, nach Nummer */
  lesen: Lese[]
  // KAN-35: warum der Jahrgang nicht gelöscht werden kann (null = löschbar); dieselben
  // Regeln prüft deleteJahrgang serverseitig
  loeschsperre: string | null
}

const AMA_STATUS_GESPERRT: Record<string, string> = {
  eingereicht: 'eingereicht',
  bestaetigt:  'von der AMA bestätigt',
  abgelehnt:   'von der AMA abgelehnt',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function ErntemeldungPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawJ } = await (supabase.from('weinjahrgaenge') as any)
    .select(`id, jahrgang, qualitaet_gesamt,
             ama_gemeldet, ama_meldedatum, abgeschlossen, notizen,
             lesen(id, lfd_nr, art, bezeichnung, beginn, ende, notizen)`)
    .eq('tenant_id', tenantId)
    .order('jahrgang', { ascending: false })

  // ernte_parzellen hat keine tenant_id → über die Jahrgänge des aktiven Betriebs eingrenzen
  // (RLS allein liefert bei mehreren Mitgliedschaften auch fremde Betriebe)
  const jahrgangIds = ((rawJ ?? []) as AR[]).map(j => j.id as string)
  const [{ data: rawP }, { data: rawA }, { data: rawPress }, { data: rawTV }] = await Promise.all([
    jahrgangIds.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase.from('ernte_parzellen') as any)
          .select('jahrgang_id, menge_kg, klosterneuburger')
          .in('jahrgang_id', jahrgangIds)
      : Promise.resolve({ data: [] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ama_erntemeldungen') as any)
      .select('jahrgang_id, status')
      .eq('tenant_id', tenantId),
    // Löschsperre: Pressungen und Traubenverkäufe je Jahrgang
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressungen') as any)
      .select('jahrgang_id')
      .eq('tenant_id', tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any)
      .select('jahrgang_id')
      .eq('tenant_id', tenantId)
      .not('jahrgang_id', 'is', null),
  ])

  const zaehleJe = (zeilen: AR[] | null | undefined) => {
    const m = new Map<string, number>()
    for (const z of zeilen ?? []) if (z.jahrgang_id) m.set(z.jahrgang_id, (m.get(z.jahrgang_id) ?? 0) + 1)
    return m
  }
  const pressungenByJG = zaehleJe(rawPress as AR[] | null)
  const tvByJG = zaehleJe(rawTV as AR[] | null)

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
    qualitaet_gesamt: j.qualitaet_gesamt,
    ama_gemeldet:     j.ama_gemeldet,
    ama_meldedatum:   j.ama_meldedatum,
    abgeschlossen:    j.abgeschlossen,
    notizen:          j.notizen,
    parzellen_count:  parzellenByJG.get(j.id)?.count ?? 0,
    gesamtmenge_kg:   parzellenByJG.get(j.id)?.kg ?? 0,
    avg_kmw:          (() => { const d = parzellenByJG.get(j.id); return d && d.kmwCount > 0 ? d.kmwSum / d.kmwCount : null })(),
    ama_status:       amaByJG.get(j.id) ?? null,
    lesen:            ((j.lesen ?? []) as Lese[]).slice().sort((a, b) => a.lfd_nr - b.lfd_nr),
    loeschsperre:     (() => {
      const gruende: string[] = []
      const nP = pressungenByJG.get(j.id) ?? 0
      const nT = tvByJG.get(j.id) ?? 0
      const ama = amaByJG.get(j.id)
      if (nP > 0) gruende.push(`${nP} ${nP === 1 ? 'Pressung ist' : 'Pressungen sind'} erfasst (daraus sind Kellerbuch-Chargen entstanden)`)
      if (nT > 0) gruende.push(`${nT} ${nT === 1 ? 'Traubenverkauf ist' : 'Traubenverkäufe sind'} erfasst`)
      if (ama && AMA_STATUS_GESPERRT[ama]) gruende.push(`die AMA-Erntemeldung ist bereits ${AMA_STATUS_GESPERRT[ama]}`)
      // gleicher Text wie deleteJahrgang (erntemeldung/actions.ts) – inkl. Handlungsanweisung
      return gruende.length > 0
        ? `Der Jahrgang ${j.jahrgang} kann nicht gelöscht werden: ${gruende.join('; ')}. Der Jahrgang bleibt als Historie erhalten.`
          + (nP > 0 || nT > 0 ? ' Pressungen ohne Folgebuchungen und Traubenverkäufe lassen sich vorher einzeln in der Lese löschen.' : '')
        : null
    })(),
  }))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/weingarten" className="hover:text-s112-blue-700 transition-colors">Rieden</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Lese</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Lese</h1>
          <p className="text-sm text-s112-muted mt-0.5">Jahrgänge mit ihren Lesen, Lesedaten & AMA-Meldung</p>
        </div>
        {writeOk && (
          <Link href="/erntemeldung/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            <span>＋</span> Neue Lese
          </Link>
        )}
      </div>

      <JahrgaengeClient jahrgaenge={jahrgaenge} writeOk={writeOk} adminOk={adminOk} />
    </div>
  )
}
