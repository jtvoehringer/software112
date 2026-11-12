import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { ladeReservierungen } from '@/lib/auftrag/laden'
import { reserviertBisVorschlag, verfuegbar } from '@/lib/auftrag/regeln'
import AuftragForm from './AuftragForm'

export const metadata: Metadata = { title: 'Neuer Auftrag' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function AuftragNeuPage() {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  if (!canWrite(membership, 'warenwirtschaft')) redirect('/weinhandel/auftraege')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [fRes, reserviert] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, flaschengroesse_ml, bestand_flaschen')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).gt('bestand_flaschen', 0).order('name').order('id')),
    ladeReservierungen(supabase, tenantId),
  ])
  const fuellungen = ((geladen(fRes, 'Füllungen') ?? []) as R[]).map(f => ({
    id: f.id as string,
    name: [f.name, f.jahrgang, f.flaschengroesse_ml ? `${f.flaschengroesse_ml} ml` : null].filter(Boolean).join(' · '),
    bestand: Number(f.bestand_flaschen) || 0,
    reserviert: reserviert.get(f.id) ?? 0,
    verfuegbar: verfuegbar(f.bestand_flaschen, reserviert.get(f.id)),
  }))
  const heute = heuteWien()

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/auftraege" className="hover:text-s112-blue-700">Aufträge</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">Neuer Auftrag</span>
      </nav>
      <h1 className="text-2xl font-semibold text-s112-text">Neuer Auftrag</h1>
      <AuftragForm fuellungen={fuellungen} heute={heute} reserviertBis={reserviertBisVorschlag(heute)} crmSchreiben={canWrite(membership, 'crm')} />
    </div>
  )
}
