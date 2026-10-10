import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { wienHeute } from '@/lib/csv'
import VersandForm from './VersandForm'

export const metadata: Metadata = { title: 'Grundwein zur Lohnversektung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-232: Versand einer ganzen Grundwein-Charge zur Lohnversektung (Teilmenge vorher per Umzug in ein eigenes Gebinde)
export default async function LohnversektungNeuPage({ searchParams }: { searchParams: Promise<{ charge?: string }> }) {
  const { charge } = await searchParams
  const membership = await getCurrentMembership()
  if (!membership || !canWrite(membership, 'kellerbuch') || await schreibSperre(membership)) redirect('/kellerbuch/lohnversektung')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [chargenRawRes, offenRawRes, firmenRawRes] = await Promise.all([
    alle<R>((supabase.from('weinausbau') as R)
      .select('id, name, menge_liter, behaelter:behaelter_id(name)')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).gt('menge_liter', 0).not('behaelter_id', 'is', null)
      .order('name').order('id')),
    alle<R>((supabase.from('lohnversektungen') as R)
      .select('weinausbau_id').eq('tenant_id', tenantId).is('storniert_am', null).is('abgeschlossen_am', null).order('id')),
    alle<R>((supabase.from('firmen') as R)
      .select('id, name').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id')),
  ])
  const chargenRaw = geladen(chargenRawRes, 'Chargen')
  const offenRaw = geladen(offenRawRes, 'Lohnversektungen')
  const firmenRaw = geladen(firmenRawRes, 'Firmen')
  const offen = new Set(((offenRaw ?? []) as R[]).map(o => String(o.weinausbau_id)))
  const chargen = ((chargenRaw ?? []) as R[]).filter(c => !offen.has(String(c.id)))
    .map(c => ({ id: String(c.id), name: String(c.name ?? ''), liter: Number(c.menge_liter) || 0, gebinde: c.behaelter?.name ?? null }))
  const firmen = ((firmenRaw ?? []) as R[]).map(f => ({ id: String(f.id), name: String(f.name ?? '') }))

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <Link href="/kellerbuch/lohnversektung" className="hover:text-s112-blue-700 transition-colors">Lohnversektung</Link>
        <span>/</span>
        <span className="text-s112-text-2">Grundwein versenden</span>
      </div>
      <h1 className="text-xl font-semibold text-s112-text">Grundwein zur Lohnversektung versenden</h1>
      <p className="text-sm text-s112-muted">
        Die ganze Charge geht zum Versekter; sie bleibt eigener Bestand, ihr Gebinde wird frei. Soll nur ein Teil versendet
        werden, die Teilmenge vorher in ein eigenes Gebinde umziehen. Die Sektkellerei ist eine Firma im CRM.
      </p>
      <VersandForm chargen={chargen} firmen={firmen} heute={wienHeute()} vorauswahl={charge ?? null} />
    </div>
  )
}
