import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { lokalerTag, wienJetzt } from '@/lib/datum/wien'
import { jahrgangAusEingabe, vorgeschlagenerJahrgang } from '@/lib/wein/lesen'
import NeueLeseForm, { type VorhandenerJahrgang } from './NeueLeseForm'

export const metadata: Metadata = { title: 'Neue Lese' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// KAN-129: „Neue Lese“ statt „Neuer Jahrgang“ – den Jahrgang legt die Aktion bei Bedarf mit an
export default async function NeueLesePage({ searchParams }: { searchParams: Promise<{ jahrgang?: string }> }) {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'rieden')) redirect('/erntemeldung')
  const { jahrgang: jahrgangParam } = await searchParams

  // im Jänner und Februar der Vorjahrgang (Eiswein), sonst das laufende Jahr; ?jahrgang= aus der Jahrgangsseite
  const vorschlag = jahrgangAusEingabe(jahrgangParam) ?? vorgeschlagenerJahrgang(lokalerTag(wienJetzt()))

  // bestehende Jahrgänge mit ihren Lesen – das Formular zeigt, welche Nummer die neue Lese bekommt
  const membership = await getCurrentMembership()
  const supabase = await createSupabaseServerClient()
  const { data: rawJ } = membership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase.from('weinjahrgaenge') as any)
        .select('id, jahrgang, lesen(lfd_nr)').eq('tenant_id', membership.tenantId)
    : { data: [] }
  const vorhandene: VorhandenerJahrgang[] = ((rawJ ?? []) as AR[]).map(j => ({
    id: j.id, jahrgang: j.jahrgang,
    lesen: ((j.lesen ?? []) as AR[]).map(l => l.lfd_nr as number).sort((a, b) => a - b),
  }))

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/erntemeldung" className="hover:text-s112-blue-700 transition-colors">Lese</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neue Lese</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Neue Lese</h1>
        <p className="text-sm text-s112-muted mt-0.5">
          Lese im Jahrgang anlegen (z. B. Hauptlese, Eiswein) – den Jahrgang legt software:112 bei Bedarf mit an
        </p>
      </div>
      <div className="card">
        <NeueLeseForm vorschlag={vorschlag} vorhandene={vorhandene} />
      </div>
    </div>
  )
}
