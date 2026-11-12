import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { ladeReservierungen, ladeReservierungTage } from '@/lib/auftrag/laden'
import { reserviertBisVorschlag, verfuegbar } from '@/lib/auftrag/regeln'
import { auftragIdAus } from '@/lib/auftrag/lieferung'
import { angebotOffen } from '@/lib/auftrag/angebot'
import AuftragForm from './AuftragForm'

export const metadata: Metadata = { title: 'Neuer Auftrag' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function AuftragNeuPage({ searchParams }: { searchParams: Promise<{ angebot?: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  if (!canWrite(membership, 'warenwirtschaft')) redirect('/weinhandel/auftraege')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [fRes, reserviert, fristTage] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, flaschengroesse_ml, bestand_flaschen')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).gt('bestand_flaschen', 0).order('name').order('id')),
    ladeReservierungen(supabase, tenantId),
    ladeReservierungTage(supabase, tenantId),   // KAN-418 Teil 5: Standardfrist des Betriebs
  ])
  const fuellungen = ((geladen(fRes, 'Füllungen') ?? []) as R[]).map(f => ({
    id: f.id as string,
    name: [f.name, f.jahrgang, f.flaschengroesse_ml ? `${f.flaschengroesse_ml} ml` : null].filter(Boolean).join(' · '),
    bestand: Number(f.bestand_flaschen) || 0,
    reserviert: reserviert.get(f.id) ?? 0,
    verfuegbar: verfuegbar(f.bestand_flaschen, reserviert.get(f.id)),
  }))
  const heute = heuteWien()

  // KAN-418 Teil 4: „In Auftrag übernehmen“ – Kunde und Positionen des offenen Angebots vorbelegen (Mengen änderbar);
  // erst das Speichern des Auftrags prüft den Bestand, reserviert und setzt das Angebot auf „angenommen“.
  const angebotId = auftragIdAus((await searchParams).angebot)
  let angebot: { id: string; nummer: string; kunde: string; zeilen: { fuellung_id: string; menge: string }[] } | null = null
  let angebotHinweis: string | null = null
  if (angebotId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const an = geladen(await (supabase.from('auftraege') as any)
      .select('id, nummer, status, storniert_am, kontakt_id, firma_id').eq('id', angebotId).eq('tenant_id', tenantId).eq('art', 'angebot').maybeSingle(), 'Angebot') as R | null
    if (!an) angebotHinweis = 'Das Angebot wurde nicht gefunden.'
    else if (!angebotOffen(an as { status: string; storniert_am: string | null })) angebotHinweis = `Das Angebot ${an.nummer} ist nicht mehr offen und lässt sich nicht übernehmen.`
    else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = (geladen(await alle<R>((supabase.from('auftrag_positionen') as any)
        .select('id, fuellung_id, menge').eq('tenant_id', tenantId).eq('auftrag_id', angebotId).order('erstellt_am').order('id')), 'Positionen des Angebots') ?? []) as R[]
      angebot = {
        id: String(an.id), nummer: String(an.nummer),
        kunde: an.firma_id ? `firma:${an.firma_id}` : `kontakt:${an.kontakt_id}`,
        zeilen: pos.map(p => ({ fuellung_id: String(p.fuellung_id), menge: String(p.menge) })),
      }
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/auftraege" className="hover:text-s112-blue-700">Aufträge</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">Neuer Auftrag</span>
      </nav>
      <h1 className="text-2xl font-semibold text-s112-text">Neuer Auftrag</h1>
      {angebotHinweis && <div role="alert" className="bg-s112-warn-bg border border-s112-warn/30 text-sm text-s112-warn-fg rounded-xl px-4 py-3">{angebotHinweis}</div>}
      <AuftragForm fuellungen={fuellungen} heute={heute} reserviertBis={reserviertBisVorschlag(heute, fristTage)} crmSchreiben={canWrite(membership, 'crm')}
        angebot={angebot ?? undefined} />
    </div>
  )
}
