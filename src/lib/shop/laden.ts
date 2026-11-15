// Weinshop-Anbindung (KAN-461): Laden für Zuordnung und Übertragung – nur serverseitig.
//   * shopZugangLaden: Adresse und Schlüssel des Betriebs (Service-Role, entschlüsselt) – nie an den Browser geben
//   * ladeFuellungenUndZuordnungen: Füllungen des Betriebs (aktiv, nicht storniert) und gespeicherte Zuordnungen,
//     vollständig über alle() (PostgREST liefert sonst höchstens 1.000 Zeilen)
import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { alle } from '@/lib/supabase/alle'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { geheimLesen } from '@/lib/email/geheimnis'
import type { WooZugang } from '@/lib/shop/woocommerce'
import type { FuellungKurz } from '@/lib/shop/zuordnung'

export type ShopZugang = { ok: true; zugang: WooZugang } | { ok: false; meldung: string; feld?: 'shop_url' | 'schluessel' }

type EinstellungenTabelle = {
  select(spalten: string): { eq(spalte: string, wert: string): { maybeSingle(): PromiseLike<{ data: Record<string, string | null> | null; error: { message?: string } | null }> } }
}

/** Zugangsdaten des Betriebs; wirft bei einem Datenbankfehler, meldet fehlende bzw. unlesbare Daten als Ergebnis */
export async function shopZugangLaden(tenantId: string): Promise<ShopZugang> {
  const admin = createSupabaseAdminClient() as unknown as { from(tabelle: 'tenant_einstellungen'): EinstellungenTabelle }
  const { data, error } = await admin.from('tenant_einstellungen')
    .select('shop_url, shop_woo_api_key, shop_woo_secret').eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Shop-Einstellungen konnten nicht geladen werden'))
  if (!data?.shop_url) return { ok: false, meldung: 'Bitte zuerst die Shop-Adresse speichern.', feld: 'shop_url' }
  if (!data.shop_woo_api_key || !data.shop_woo_secret) return { ok: false, meldung: 'Bitte zuerst Consumer Key und Consumer Secret speichern.', feld: 'schluessel' }
  try {
    return { ok: true, zugang: { url: data.shop_url, key: geheimLesen(data.shop_woo_api_key) ?? '', secret: geheimLesen(data.shop_woo_secret) ?? '' } }
  } catch {
    return { ok: false, meldung: 'Die gespeicherten Schlüssel sind nicht lesbar – bitte neu eingeben und speichern.', feld: 'schluessel' }
  }
}

export type GespeicherteZuordnung = {
  id: string
  fuellung_id: string
  woo_produkt_id: number
  woo_name: string | null
  woo_sku: string | null
  sku_geschrieben_am: string | null
}

/** Füllungen (aktiv, nicht storniert) und Zuordnungen des Betriebs – vollständig; wirft bei einem Datenbankfehler */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeFuellungenUndZuordnungen(supabase: any, tenantId: string): Promise<{ fuellungen: FuellungKurz[]; zuordnungen: GespeicherteZuordnung[] }> {
  const [f, z] = await Promise.all([
    alle<Record<string, unknown>>(supabase.from('fuellungen')
      .select('id, name, jahrgang, rebsorte, zusatzbezeichnung, chargennummer')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null)
      .order('jahrgang', { ascending: false, nullsFirst: false }).order('name').order('id')),
    alle<Record<string, unknown>>(supabase.from('shop_zuordnungen')
      .select('id, fuellung_id, woo_produkt_id, woo_name, woo_sku, sku_geschrieben_am')
      .eq('tenant_id', tenantId).order('woo_produkt_id').order('id')),
  ])
  if (f.error) throw new AktionsFehler(dbFehlerText(f.error, 'Füllungen konnten nicht geladen werden'))
  if (z.error) throw new AktionsFehler(dbFehlerText(z.error, 'Zuordnungen konnten nicht geladen werden'))
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return {
    fuellungen: f.data.map(r => ({
      id: String(r.id), name: String(r.name ?? ''), jahrgang: r.jahrgang === null || r.jahrgang === undefined ? null : Number(r.jahrgang),
      rebsorte: text(r.rebsorte), zusatzbezeichnung: text(r.zusatzbezeichnung), chargennummer: text(r.chargennummer),
    })),
    zuordnungen: z.data.map(r => ({
      id: String(r.id), fuellung_id: String(r.fuellung_id), woo_produkt_id: Number(r.woo_produkt_id),
      woo_name: text(r.woo_name), woo_sku: text(r.woo_sku), sku_geschrieben_am: text(r.sku_geschrieben_am),
    })),
  }
}
