import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { requireModul } from '@/lib/auth/modul'
import { requireLesen } from '@/lib/auth/lesen'
import { schreibSperre } from '@/lib/auth/sperren'
import { ladeFuellungenUndZuordnungen, shopZugangLaden } from '@/lib/shop/laden'
import { wooProdukteLaden, type WooProdukt } from '@/lib/shop/woocommerce'
import ZuordnungClient from './ZuordnungClient'

export const metadata: Metadata = { title: 'Shop-Anbindung – Zuordnung' }
export const dynamic = 'force-dynamic'

// KAN-461: Zuordnung Füllung ↔ Shop-Produkt. Die Produktliste kommt live aus dem Shop (kein Zwischenspeicher);
// antwortet er nicht, zeigt die Seite die gespeicherten Zuordnungen und die Meldung.
export default async function ShopZuordnungPage() {
  await requireLesen('lager')   // KAN-456: Lesebereich je Profil
  await requireModul('modul_shop')
  const membership = await getCurrentMembership()
  if (!membership || !canAdmin(membership.role)) redirect('/dashboard')

  const supabase = await createSupabaseServerClient()
  const { fuellungen, zuordnungen } = await ladeFuellungenUndZuordnungen(supabase, membership.tenantId)

  let produkte: WooProdukt[] = []
  let shopFehler: string | null = null
  let abgeschnitten = false
  const zugang = await shopZugangLaden(membership.tenantId)
  if (!zugang.ok) shopFehler = zugang.meldung
  else {
    const r = await wooProdukteLaden(zugang.zugang)
    if (r.ok) { produkte = r.daten.produkte; abgeschnitten = r.daten.abgeschnitten }
    else shopFehler = r.meldung
  }
  const nurLesen = (await schreibSperre(membership)) !== null

  return <ZuordnungClient produkte={produkte} fuellungen={fuellungen} zuordnungen={zuordnungen}
    shopFehler={shopFehler} abgeschnitten={abgeschnitten} nurLesen={nurLesen} />
}
