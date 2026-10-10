import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { alle } from '@/lib/supabase/alle'
import { wienHeute } from '@/lib/csv'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import ProduktionForm from '../ProduktionForm'
import { produktionBuchen } from '../actions'

export const metadata: Metadata = { title: 'Neue Produktion' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-119 (08.10.2026): Assistent „Neue Produktion“ in drei Schritten (Art → Eingänge → neue Charge und Gebinde).
// ?quelle=<charge> belegt die erste Quelle vor (Knopf „Produktion“ auf der Charge).
export default async function NeueProduktionPage({ searchParams }: { searchParams: Promise<{ quelle?: string }> }) {
  const { quelle } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const darf = !!membership && canWrite(membership, 'kellerbuch') && !(await schreibSperre(membership))

  const kopf = (
    <div className="flex items-center gap-2 text-sm text-s112-muted">
      <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
      <span>/</span>
      <Link href="/kellerbuch/produktion" className="hover:text-s112-blue-700 transition-colors">Produktion</Link>
      <span>/</span>
      <span className="text-s112-text-2">Neu</span>
    </div>
  )
  if (!darf) {
    return (
      <div className="max-w-4xl space-y-6">
        {kopf}
        <p className="card p-4 text-sm text-s112-muted">Nur lesend – für eine Produktion fehlt das Schreibrecht im Kellerbuch bzw. der Nur-Lesen-Modus ist aktiv.</p>
      </div>
    )
  }

  const [chargenRes, gebinde, mittelRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, weinart, erzeugnis, behaelter_id, behaelter:behaelter_id(name)')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).gt('menge_liter', 0.01).order('name').order('id')),
    ladeBehaelter(supabase, tenantId, { alsZiel: true }),
    // alle-ausnahme: Stammdaten-Auswahl der aktiven Stoffe des Stoffkontos, wenige je Betrieb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kellermittel') as any).select('id, name, einheit').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id').limit(200),
  ])
  const chargen = ((chargenRes.data ?? []) as R[]).map(c => ({
    id: String(c.id), name: String(c.name ?? 'Charge'), menge: Number(c.menge_liter) || 0, weinart: c.weinart ?? null,
    erzeugnis: c.erzeugnis ?? null, gebinde: (c.behaelter as R | null)?.name ?? null,
  }))
  // Ziel-Gebinde: nutzbar und ohne aktive Charge (die neue Charge braucht ein leeres Gebinde)
  const belegt = new Set(((chargenRes.data ?? []) as R[]).map(c => c.behaelter_id).filter(Boolean))
  const leer = gebinde.filter(b => !belegt.has(b.id) && (Number(b.eigen_liter) || 0) + (Number(b.fremd_liter) || 0) <= 0.01)
    .map(b => ({ id: b.id, name: b.anzeigeName, volumen: b.volumen_liter ?? null }))
  const mittel = ((mittelRes.data ?? []) as R[]).map(m => ({ id: String(m.id), name: String(m.name), einheit: String(m.einheit) }))

  return (
    <div className="max-w-4xl space-y-6">
      {kopf}
      <div>
        <h1 className="text-xl font-semibold text-s112-text">Neue Produktion</h1>
        <p className="text-sm text-s112-muted mt-1">
          Aus einer oder mehreren Chargen entsteht eine neue Charge mit eigenem Erzeugnis. Die Quellen buchen „Abgang durch
          Verarbeitung“, die neue Charge „Zugang durch Produktion“; Zutaten aus dem Stoffkonto werden dort als Verwendung gebucht.
        </p>
      </div>
      <ProduktionForm chargen={chargen} gebinde={leer} mittel={mittel} heute={wienHeute()} quelle={quelle ?? null}
        buchen={produktionBuchen} />
    </div>
  )
}
