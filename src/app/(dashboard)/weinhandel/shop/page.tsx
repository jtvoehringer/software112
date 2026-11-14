import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { requireModul } from '@/lib/auth/modul'
import { requireLesen } from '@/lib/auth/lesen'
import { schreibSperre } from '@/lib/auth/sperren'
import { geheimMaskiert } from '@/lib/email/geheimnis'
import ShopEinstellungen from './ShopEinstellungen'

export const metadata: Metadata = { title: 'Shop-Anbindung' }
export const dynamic = 'force-dynamic'

export type ShopDaten = {
  shop_url: string | null
  shop_bestandsreserve: number
  shop_bestand_uebertragen: boolean
  /** nur die Maske („hinterlegt“) – der Schlüssel selbst geht nie an den Browser (KAN-135) */
  shop_woo_api_key: string | null
  shop_woo_secret: string | null
}

// KAN-460: Zusatzmodul Weinshop-Anbindung (WooCommerce) – Zugangsdaten und Verbindungstest, nur Betriebsleitung
export default async function ShopPage() {
  await requireLesen('lager')   // KAN-456: Lesebereich je Profil (die Seite selbst ist zusätzlich nur für die Betriebsleitung)
  await requireModul('modul_shop')
  const membership = await getCurrentMembership()
  if (!membership || !canAdmin(membership.role)) redirect('/dashboard')

  // Service-Role: tenant_einstellungen hat für Benutzer nur Spaltenrechte, die Schlüssel gar keine (KAN-135)
  const admin = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = geladen(await (admin.from('tenant_einstellungen') as any)
    .select('shop_url, shop_bestandsreserve, shop_bestand_uebertragen, shop_woo_api_key, shop_woo_secret')
    .eq('tenant_id', membership.tenantId).maybeSingle(), 'Shop-Einstellungen') as Record<string, unknown> | null

  const daten: ShopDaten = {
    shop_url: typeof s?.shop_url === 'string' ? s.shop_url : null,
    shop_bestandsreserve: Number(s?.shop_bestandsreserve ?? 0) || 0,
    shop_bestand_uebertragen: s?.shop_bestand_uebertragen === true,
    shop_woo_api_key: geheimMaskiert(s?.shop_woo_api_key as string | null | undefined),
    shop_woo_secret: geheimMaskiert(s?.shop_woo_secret as string | null | undefined),
  }
  const nurLesen = (await schreibSperre(membership)) !== null

  return <ShopEinstellungen daten={daten} nurLesen={nurLesen} />
}
