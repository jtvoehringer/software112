import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { ladeAngebotFormular } from '@/lib/auftrag/angebotFormular'
import { angebotOffen } from '@/lib/auftrag/angebot'
import AngebotForm from '../../AngebotForm'

export const metadata: Metadata = { title: 'Angebot bearbeiten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const zahlText = (v: unknown) => (v === null || v === undefined ? '' : String(Number(v)))

// KAN-418 Teil 4: Angebot bearbeiten – nur solange es offen ist (das prüft auch die Datenbank, s112_angebot_aendern)
export default async function AngebotBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  if (!canWrite(membership, 'warenwirtschaft')) redirect(`/weinhandel/angebote/${id}`)
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = geladen(await (supabase.from('auftraege') as any)
    .select('id, nummer, datum, status, gueltig_bis, notizen, kontakt_id, firma_id, storniert_am')
    .eq('id', id).eq('tenant_id', tenantId).eq('art', 'angebot').maybeSingle(), 'Angebot') as R | null
  if (!a) redirect('/weinhandel/angebote')
  if (!angebotOffen(a as { status: string; storniert_am: string | null })) redirect(`/weinhandel/angebote/${id}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positionen = (geladen(await alle<R>((supabase.from('auftrag_positionen') as any)
    .select('id, fuellung_id, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz')
    .eq('tenant_id', tenantId).eq('auftrag_id', id).order('erstellt_am').order('id')), 'Positionen') ?? []) as R[]
  const daten = await ladeAngebotFormular(supabase, tenantId, positionen.map(p => p.fuellung_id as string))
  const heute = heuteWien()

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/angebote" className="hover:text-s112-blue-700">Angebote</Link>
        <span>/</span>
        <Link href={`/weinhandel/angebote/${id}`} className="hover:text-s112-blue-700">{a.nummer}</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">Bearbeiten</span>
      </nav>
      <h1 className="text-2xl font-semibold text-s112-text">Angebot {a.nummer} bearbeiten</h1>
      <AngebotForm fuellungen={daten.fuellungen} heute={heute} gueltigBis={a.gueltig_bis ?? heute}
        ustStandard={daten.ustStandard} crmSchreiben={canWrite(membership, 'crm')}
        vorgabe={{
          id, nummer: String(a.nummer),
          kunde: a.firma_id ? `firma:${a.firma_id}` : `kontakt:${a.kontakt_id}`,
          datum: String(a.datum), gueltig_bis: String(a.gueltig_bis ?? heute), notizen: String(a.notizen ?? ''),
          zeilen: positionen.map(p => ({
            fuellung_id: String(p.fuellung_id), menge: String(p.menge),
            preis_brutto: zahlText(p.preis_brutto), rabatt_pct: zahlText(p.rabatt_pct) || '0',
            sonderrabatt_pct: zahlText(p.sonderrabatt_pct) || '0', ust_satz: zahlText(p.ust_satz) || String(daten.ustStandard),
          })),
        }} />
    </div>
  )
}
