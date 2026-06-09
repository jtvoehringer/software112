import { createSupabaseServerClient } from '@/lib/supabase/server'
import SonstigeArtikelClient from './SonstigeArtikelClient'

export const dynamic = 'force-dynamic'

export default async function SonstigeArtikelPage() {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('sonstige_artikel') as any)
    .select('id, name, einheit, default_preis, aktiv, erstellt_am')
    .order('name')

  return (
    <div className="space-y-6 max-w-2xl">
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
