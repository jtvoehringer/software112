'use server'

// Weinshop-Anbindung (KAN-460, 15.11.2026): Einstellungen und Verbindungstest für den EIGENEN, aktiven Betrieb.
// Entscheidung Jörgen 15.11.2026 (Plan KAN-460, Punkt 2): Die WooCommerce-Schlüssel pflegt die Betriebsleitung selbst –
// sie legt sie in ihrem WordPress an. Der Ziel-Betrieb kommt nur aus der aktiven Mitgliedschaft, nie vom Client.
// Geheimnisse (shop_woo_api_key, shop_woo_secret) liest und schreibt nur die Service-Role (KAN-135), verschlüsselt;
// an den Browser geht nur die Maske. In diesem Teil wird nichts in den Shop geschrieben.

import { revalidatePath } from 'next/cache'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { hatModul, modulAusMeldung } from '@/lib/auth/modul'
import { geheimFeld, geheimLesen } from '@/lib/email/geheimnis'
import { dbFehlerText } from '@/lib/fehler'
import { shopUrlFehler, shopUrlNormalisiert } from '@/lib/shop/url'
import { wooVerbindungTesten, wooVerbindungText } from '@/lib/shop/woocommerce'

const SHOP_RESERVE_MAX = 100_000

type DbFehler = { message?: string; code?: string } | null
/** Die zwei Zugriffe dieser Datei auf tenant_einstellungen (Service-Role) – eng typisiert statt any */
type EinstellungenTabelle = {
  upsert(werte: Record<string, unknown>, optionen: { onConflict: string }): PromiseLike<{ error: DbFehler }>
  select(spalten: string): { eq(spalte: string, wert: string): { maybeSingle(): PromiseLike<{ data: Record<string, string | null> | null; error: DbFehler }> } }
}
const adminClient = () => createSupabaseAdminClient() as unknown as { from(tabelle: 'tenant_einstellungen'): EinstellungenTabelle }

type Ergebnis = { success: true; text?: string } | { error: string; feld?: 'shop_url' | 'shop_bestandsreserve' | 'schluessel' }

async function shopKontext(): Promise<{ tenantId: string } | { error: string }> {
  const membership = await getCurrentMembership()
  // KAN-30: Seite aus einem anderen Betrieb? (vor den Rechten, sonst gelten die des neuen Betriebs)
  const betriebGewechselt = await seitenBetriebFehler(membership?.tenantId)
  if (betriebGewechselt) return { error: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { error: aboGesperrt }
  if (!membership || !canAdmin(membership.role)) return { error: 'Keine Berechtigung – die Shop-Anbindung richtet die Betriebsleitung ein.' }
  if (!(await hatModul('modul_shop'))) return { error: modulAusMeldung('modul_shop') }
  return { tenantId: membership.tenantId }
}

export async function saveShopEinstellungen(formData: FormData): Promise<Ergebnis> {
  const auth = await shopKontext()
  if ('error' in auth) return { error: auth.error }

  const urlRoh = String(formData.get('shop_url') ?? '').trim()
  const urlFehler = shopUrlFehler(urlRoh)
  if (urlFehler) return { error: urlFehler, feld: 'shop_url' }

  const reserveRoh = String(formData.get('shop_bestandsreserve') ?? '').trim()
  if (!/^\d{1,6}$/.test(reserveRoh || '0') || Number(reserveRoh || '0') > SHOP_RESERVE_MAX) {
    return { error: `Die Bestandsreserve ist eine ganze Zahl von 0 bis ${SHOP_RESERVE_MAX}.`, feld: 'shop_bestandsreserve' }
  }

  const { error } = await adminClient().from('tenant_einstellungen').upsert({
    tenant_id:                auth.tenantId,
    shop_url:                 urlRoh ? shopUrlNormalisiert(urlRoh) : null,
    shop_bestandsreserve:     Number(reserveRoh || '0'),
    shop_bestand_uebertragen: formData.get('shop_bestand_uebertragen') === 'true',
    // Maske (= unverändert) lässt das Feld weg, leer = löschen, sonst verschlüsselt
    ...geheimFeld('shop_woo_api_key', formData.get('shop_woo_api_key')),
    ...geheimFeld('shop_woo_secret', formData.get('shop_woo_secret')),
    aktualisiert_am:          new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) return { error: dbFehlerText(error, 'Shop-Einstellungen konnten nicht gespeichert werden') }

  revalidatePath('/weinhandel/shop')
  return { success: true }
}

/** Verbindungstest mit den GESPEICHERTEN Zugangsdaten – liest ein Produkt, schreibt nichts */
export async function shopVerbindungTesten(): Promise<Ergebnis> {
  const auth = await shopKontext()
  if ('error' in auth) return { error: auth.error }

  const { data, error } = await adminClient().from('tenant_einstellungen')
    .select('shop_url, shop_woo_api_key, shop_woo_secret').eq('tenant_id', auth.tenantId).maybeSingle()
  if (error) return { error: dbFehlerText(error, 'Shop-Einstellungen konnten nicht geladen werden') }
  if (!data?.shop_url) return { error: 'Bitte zuerst die Shop-Adresse speichern.', feld: 'shop_url' }
  if (!data.shop_woo_api_key || !data.shop_woo_secret) return { error: 'Bitte zuerst Consumer Key und Consumer Secret speichern.', feld: 'schluessel' }

  let key: string | null, secret: string | null
  try {
    key = geheimLesen(data.shop_woo_api_key)
    secret = geheimLesen(data.shop_woo_secret)
  } catch {
    return { error: 'Die gespeicherten Schlüssel sind nicht lesbar – bitte neu eingeben und speichern.', feld: 'schluessel' }
  }
  const r = await wooVerbindungTesten({ url: data.shop_url, key: key ?? '', secret: secret ?? '' })
  if (!r.ok) return { error: r.meldung, feld: r.art === 'adresse' || r.art === 'weiterleitung' || r.art === 'nicht_erreichbar' || r.art === 'kein_woocommerce' ? 'shop_url' : r.art === 'schluessel' || r.art === 'recht' ? 'schluessel' : undefined }
  return { success: true, text: wooVerbindungText(r.daten.produkte) }
}
