import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import UmziehenClient from './UmziehenClient'

export const metadata: Metadata = { title: 'Umziehen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function UmziehenPage({ searchParams }: { searchParams: Promise<{ neu?: string }> }) {
  const sp = await searchParams
  const initialShowForm = sp?.neu === '1'
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
  // beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
  // Daten eines anderen Betriebs als des gerade ausgewählten angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: waRaw },
    bhRows,
    { data: umzugRaw },
  ] = await Promise.all([
    // Aktive Chargen mit Behälter-Info (für Quellen-Auflösung)
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, qualitaetsstufe, status, behaelter_id, behaelter:behaelter_id(id, name, volumen_liter)')
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
      .not('behaelter_id', 'is', null)
      .gt('menge_liter', 0)
      .order('name')),

    // Alle aktiven Behälter als Ziele - eigene + freigegebene (Kellergemeinschaft),
    // ohne fremd belegte (Migration 203)
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),

    // Umzug-Protokoll
    tf((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, umzug_typ, notizen, von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name)), nach_behaelter:nach_behaelter_id(name)')
      .order('datum', { ascending: false })
      .order('id', { ascending: false })
      .limit(50)),
  ])

  // Behälter-mit-Charge-Mapping für Quell-Picker
  // Ein Behälter kann theoretisch mehrere Chargen haben → wir nehmen alle aktiven
  const behaelterMitChargen: {
    behaelter_id: string
    behaelter_name: string
    charge_id: string
    charge_name: string
    jahrgang: number | null
    rebsorte: string | null
    menge_liter: number
  }[] = ((waRaw ?? []) as R[]).map(w => ({
    behaelter_id:   (w.behaelter as R | null)?.id ?? w.behaelter_id,
    behaelter_name: (w.behaelter as R | null)?.name ?? '?',
    charge_id:      w.id,
    charge_name:    w.name,
    jahrgang:       w.jahrgang ?? null,
    rebsorte:       w.rebsorte ?? null,
    menge_liter:    parseFloat(w.menge_liter) || 0,
  }))

  const behaelter: { id: string; name: string; kapazitaet_liter: number | null }[] =
    bhRows.map(b => ({
      id:              b.id,
      name:            b.anzeigeName,
      kapazitaet_liter: b.volumen_liter ?? null,
    }))

  const umzuege: { id: string; von_name: string; nach_name: string; menge_liter: number; schwund_liter: number; datum: string; notizen: string | null; umzug_typ?: string }[] =
    ((umzugRaw ?? []) as R[]).map(u => {
      const vonCharge = u.von_weinausbau as R | null
      const vonTank   = (vonCharge?.behaelter as R | null)?.name ?? null
      const vonLabel  = vonTank ? `${vonTank} (${vonCharge?.name ?? '?'})` : (vonCharge?.name ?? '–')
      return {
        id:            u.id,
        datum:         u.datum,
        von_name:      vonLabel,
        nach_name:     (u.nach_behaelter as R | null)?.name ?? '–',
        menge_liter:   u.menge_liter,
        schwund_liter: u.schwund_liter ?? 0,
        notizen:       u.notizen ?? null,
        umzug_typ:     u.umzug_typ ?? 'normal',
      }
    })

  return (
    <div>
      <UmziehenClient
        behaelterMitChargen={behaelterMitChargen}
        behaelter={behaelter}
        umzuege={umzuege}
        writeOk={writeOk}
        initialShowForm={initialShowForm}
      />
    </div>
  )
}
