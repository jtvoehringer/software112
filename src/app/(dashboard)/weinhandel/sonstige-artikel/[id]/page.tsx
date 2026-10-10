// KAN-115 (07.10.2026): Sonstiges Produkt – Art, Lagerstand führen, Liter je Stück und Lagerkonto (Anfangsbestand,
// Zugang, Verarbeitung aus der Charge, Verkauf, Inventur, Storno). Außerhalb von Weinbuch und Bestandsmeldung.
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership, getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import { alle } from '@/lib/supabase/alle'
import { wienHeute } from '@/lib/csv'
import ProduktLagerClient, { type ProduktZeile } from './ProduktLagerClient'
import type { ProduktBewegung } from '@/lib/warenwirtschaft/sonstigeProdukte'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function ProduktPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) notFound()
  const role = await getCurrentUserRole()
  const nurLesen = !!(await schreibSperre(membership))
  const writeOk = canWrite(role, 'warenwirtschaft') && !nurLesen

  const artikel = geladen(await (supabase.from('sonstige_artikel') as unknown as AR)
    .select('id, name, einheit, default_preis, aktiv, art, bestand_fuehren, liter_je_stk')
    .eq('id', id).eq('tenant_id', membership.tenantId).maybeSingle(), 'Produkte')
  if (!artikel) notFound()

  const { data: bewegungen, error } = await alle<ProduktBewegung & AR>((supabase.from('sonstige_artikel_bewegungen') as unknown as AR)
    .select('id, datum, art, menge, storno_von_id, notizen, erstellt_von_name, erstellt_am, keller_verarbeitung_id, verkaufsposten_id, verkaufsposten:verkaufsposten_id(rechnungsnummer), verarbeitung:keller_verarbeitung_id(weinausbau_id, weinausbau:weinausbau_id(name))')
    .eq('tenant_id', membership.tenantId).eq('artikel_id', id).order('datum').order('id'))

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-blue-700 transition-colors">Weinhandel</Link>
        <span>/</span>
        <Link href="/weinhandel/sonstige-artikel" className="hover:text-s112-blue-700 transition-colors">Sonstiges-Produkte</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{(artikel as AR).name}</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-s112-text">{(artikel as AR).name}</h1>
        <p className="text-sm text-s112-muted mt-1">
          Traubensaft, Essig und Destillat sind kein Wein: ihr Lager steht außerhalb von Weinbuch und Bestandsmeldung. Zugänge aus
          dem Keller entstehen über „Verarbeiten“ an der Charge.
        </p>
      </div>
      {error
        ? <p role="alert" className="card text-sm text-s112-err-fg">Lagerbewegungen konnten nicht geladen werden: {String((error as AR).message ?? '')}</p>
        : <ProduktLagerClient artikel={artikel as ProduktZeile} bewegungen={(bewegungen ?? []) as (ProduktBewegung & AR)[]} writeOk={writeOk} heute={wienHeute()} />}
    </div>
  )
}
