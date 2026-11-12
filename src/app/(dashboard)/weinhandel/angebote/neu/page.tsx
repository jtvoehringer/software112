import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { heuteWien } from '@/lib/datum/wien'
import { ladeAngebotFormular } from '@/lib/auftrag/angebotFormular'
import { tagPlus } from '@/lib/auftrag/regeln'
import AngebotForm from '../AngebotForm'

export const metadata: Metadata = { title: 'Neues Angebot' }
export const dynamic = 'force-dynamic'

// KAN-418 Teil 4: Angebot erfassen – nur mit Schreibrecht Warenwirtschaft
export default async function AngebotNeuPage() {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  if (!canWrite(membership, 'warenwirtschaft')) redirect('/weinhandel/angebote')
  const supabase = await createSupabaseServerClient()
  const daten = await ladeAngebotFormular(supabase, membership.tenantId)
  const heute = heuteWien()

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/angebote" className="hover:text-s112-blue-700">Angebote</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">Neues Angebot</span>
      </nav>
      <h1 className="text-2xl font-semibold text-s112-text">Neues Angebot</h1>
      <AngebotForm fuellungen={daten.fuellungen} heute={heute} gueltigBis={tagPlus(heute, daten.fristTage)}
        ustStandard={daten.ustStandard} crmSchreiben={canWrite(membership, 'crm')} />
    </div>
  )
}
