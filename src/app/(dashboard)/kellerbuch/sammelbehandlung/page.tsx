/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { nurBelegendeChargen } from '@/lib/kellerbuch/leereGebinde'
import { heuteWien } from '@/lib/datum/wien'
import { rund } from '@/lib/zahl/runden'
import { BrotkrumenLink } from '@/components/ui/Link'
import SammelClient, { type SammelChargeZeile, type Sammlung } from './SammelClient'

export const metadata: Metadata = { title: 'Sammelmaßnahme' }
export const dynamic = 'force-dynamic'

type R = Record<string, any>

// KAN-413 (11.11.2026): Sammelmaßnahme – dieselbe Kellerbehandlung für mehrere Gebinde, Menge anteilig nach Litern.
export default async function SammelbehandlungPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [chargenRes, typenRes, stoffeRes, sammelRes] = await Promise.all([
    alle(nurBelegendeChargen(tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, behaelter_id, behaelter:behaelter_id(id, name)')))
      .not('behaelter_id', 'is', null)
      .gt('menge_liter', 0)
      .order('name').order('id')),
    tf((supabase.from('keller_behandlungstypen') as any).select('id, name, einheit_standard, pn_wirkung')).order('sort_order').order('name').order('id'),
    tf((supabase.from('kellermittel') as any).select('id, name, einheit')).eq('aktiv', true).order('name').order('id'),
    // storno-sichtbar: die Liste der letzten Sammelmaßnahmen zeigt auch stornierte, gekennzeichnet und ohne Aktion
    tf((supabase.from('keller_behandlungen') as any)
      .select('id, sammel_id, datum, typ_name_snapshot, menge, einheit, storniert_am, created_at, behaelter:behaelter_id(name)'))
      .not('sammel_id', 'is', null)
      .order('datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(400),
  ])
  const chargenRaw = geladen(chargenRes, 'Chargen') as R[]
  const typen = geladen(typenRes, 'Behandlungstypen') as R[]
  const stoffe = geladen(stoffeRes, 'Stoffe') as R[]
  const sammelRaw = geladen(sammelRes, 'Sammelmaßnahmen') as R[]

  const chargen: SammelChargeZeile[] = chargenRaw.map(w => ({
    id: String(w.id),
    name: (w.name as string | null) ?? '–',
    jahrgang: (w.jahrgang as number | null) ?? null,
    rebsorte: (w.rebsorte as string | null) ?? null,
    liter: Number(w.menge_liter) || 0,
    behaelterId: String((w.behaelter as R | null)?.id ?? w.behaelter_id),
    behaelterName: ((w.behaelter as R | null)?.name as string | undefined) ?? '?',
  })).sort((a, b) => a.behaelterName.localeCompare(b.behaelterName, 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de'))

  // Letzte Sammelmaßnahmen: je sammel_id eine Zeile (die Abfrage ist nach Datum und Erfassung absteigend sortiert)
  const jeSammel = new Map<string, Sammlung>()
  for (const b of sammelRaw) {
    const id = String(b.sammel_id)
    let s = jeSammel.get(id)
    if (!s) {
      s = { id, datum: String(b.datum ?? '').slice(0, 10), typ: (b.typ_name_snapshot as string | null) ?? '–', einheit: (b.einheit as string | null) ?? null,
            menge: 0, anzahl: 0, storniert: 0, gebinde: [] }
      jeSammel.set(id, s)
    }
    s.anzahl++
    if (b.storniert_am) s.storniert++
    else s.menge = rund(s.menge + (Number(b.menge) || 0), 3)
    const g = (b.behaelter as R | null)?.name as string | undefined
    if (g) s.gebinde.push(g)
  }
  const sammlungen = [...jeSammel.values()].slice(0, 20)

  return (
    <div className="space-y-6">
      <div>
        <nav aria-label="Brotkrumen" className="text-xs text-s112-muted mb-1">
          <BrotkrumenLink href="/kellerbuch">Kellerbuch</BrotkrumenLink> <span aria-hidden="true">›</span> Sammelmaßnahmen
        </nav>
        <h1 className="text-xl font-semibold text-s112-text">Sammelmaßnahme</h1>
        <p className="text-sm text-s112-muted mt-1 max-w-3xl">
          Dieselbe Kellerbehandlung für mehrere Gebinde auf einmal, zum Beispiel Schwefeln. Die Menge wird nach Litern auf die
          gewählten Gebinde aufgeteilt; im Kellerbuch entsteht je Gebinde eine eigene Behandlung.
        </p>
      </div>
      <SammelClient chargen={chargen} typen={typen.map(t => ({ id: String(t.id), name: String(t.name ?? ''), einheit: (t.einheit_standard as string | null) ?? null, pnWirkung: (t.pn_wirkung as string | null) ?? null }))}
        stoffe={stoffe.map(s => ({ id: String(s.id), name: String(s.name ?? ''), einheit: String(s.einheit ?? '') }))}
        sammlungen={sammlungen} heute={heuteWien()} writeOk={writeOk} />
    </div>
  )
}
