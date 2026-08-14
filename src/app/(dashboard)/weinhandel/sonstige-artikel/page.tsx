import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import Link from 'next/link'
import SonstigeArtikelClient from './SonstigeArtikelClient'

export const dynamic = 'force-dynamic'

export default async function SonstigeArtikelPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query
  const { data } = await tf((supabase.from('sonstige_artikel') as any)
    .select('id, name, einheit, default_preis, aktiv, erstellt_am')
    .order('name'))

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-teal transition-colors">Weinhandel</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Sonstiges-Produkte</span>
      </div>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Sonstiges-Produkte</h1>
        <p className="text-sm text-s112-muted mt-1">
          Häufig verkaufte Sonstiges-Positionen – werden beim Erstellen eines Verkaufs zur Auswahl angeboten.
        </p>
      </div>
      <SonstigeArtikelClient initialArtikel={data ?? []} />
    </div>
  )
}
