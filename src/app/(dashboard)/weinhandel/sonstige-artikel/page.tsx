import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import Link from '@/components/ui/Link'
import SonstigeArtikelClient from './SonstigeArtikelClient'
import { alle } from '@/lib/supabase/alle'
import { rund } from '@/lib/zahl/runden'

export const dynamic = 'force-dynamic'

export default async function SonstigeArtikelPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query
  const { data } = await tf((supabase.from('sonstige_artikel') as any)
    .select('id, name, einheit, default_preis, aktiv, erstellt_am, art, bestand_fuehren')
    .order('name'))
  // KAN-115: Lagerstand je Produkt (Summe der Bewegungen)
  const { data: bew } = tenantId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await alle<{ artikel_id: string; menge: number | string }>((supabase.from('sonstige_artikel_bewegungen') as any)
        .select('artikel_id, menge').eq('tenant_id', tenantId).order('id'))
    : { data: [] as { artikel_id: string; menge: number | string }[] }
  const lager: Record<string, number> = {}
  for (const b of bew ?? []) lager[b.artikel_id] = rund(((lager[b.artikel_id] ?? 0) + (Number(b.menge) || 0)), 3)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-blue-700 transition-colors">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Sonstiges-Produkte</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-s112-text">Sonstiges-Produkte</h1>
        <p className="text-sm text-s112-muted mt-1">
          Häufig verkaufte Sonstiges-Positionen – werden beim Erstellen eines Verkaufs zur Auswahl angeboten. Traubensaft, Essig und
          Destillat mit Lagerstand: Produkt öffnen, „Lagerstand führen“ setzen; Zugänge entstehen beim Verarbeiten einer Charge.
        </p>
      </div>
      <SonstigeArtikelClient initialArtikel={data ?? []} lager={lager} />
    </div>
  )
}
