import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { requireModul } from '@/lib/auth/modul'
import { requireLesen } from '@/lib/auth/lesen'
import { schreibSperre } from '@/lib/auth/sperren'
import { ladeFuellungenUndZuordnungen, shopZugangLaden } from '@/lib/shop/laden'
import { wooProdukteLaden, type WooProdukt } from '@/lib/shop/woocommerce'
import { ladeElabelKatalog, ladeWeindaten } from '@/lib/shop/weindatenLaden'
import { weindatenHtml, weindatenPruefsumme, weindatenStand, type WeindatenStand } from '@/lib/shop/weindaten'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import type { BestandAnzeige } from '@/lib/shop/warteschlangeRegeln'
import ZuordnungClient from './ZuordnungClient'

/** Je Produkt: Stand der Weindaten-Übertragung und Vorschau des Blocks (KAN-462) */
export type WeindatenAnzeige = { stand: WeindatenStand; am: string | null; fehler: string | null; html: string; ohneElabel: boolean }

const MAX_VORSCHAU = 80
const PARALLEL = 6

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

  // KAN-463: Stand der Bestandsübertragung je Produkt – letzter Stand der Zuordnung, dazu offene Einträge der Warteschlange
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('shop_bestand_uebertragen').eq('tenant_id', membership.tenantId).maybeSingle(), 'Shop-Einstellungen') as { shop_bestand_uebertragen?: boolean } | null
  const bestandAn = einst?.shop_bestand_uebertragen === true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wartend = await alle<{ fuellung_id: string; versuche: number }>((supabase.from('shop_warteschlange') as any)
    .select('fuellung_id, versuche').eq('tenant_id', membership.tenantId).eq('art', 'bestand').order('id'))
  if (wartend.error) throw new AktionsFehler(dbFehlerText(wartend.error, 'Die Shop-Warteschlange konnte nicht geladen werden'))
  const wartetJe = new Map(wartend.data.map(w => [w.fuellung_id, Number(w.versuche)]))
  const bestand: Record<number, BestandAnzeige> = {}
  for (const z of zuordnungen) {
    bestand[z.woo_produkt_id] = { menge: z.bestand_menge, am: z.bestand_am, fehler: z.bestand_fehler, wartet: wartetJe.has(z.fuellung_id), versuche: wartetJe.get(z.fuellung_id) ?? 0 }
  }

  // KAN-462: heutiger Inhalt je Zuordnung (für „geändert seit der Übertragung“ und die Vorschau) – in kleinen Bündeln,
  // bei sehr vielen Zuordnungen nur der gespeicherte Stand
  const weindaten: Record<number, WeindatenAnzeige> = {}
  const mitVorschau = zuordnungen.length <= MAX_VORSCHAU
  const katalog = mitVorschau && zuordnungen.length > 0 ? await ladeElabelKatalog(supabase) : []
  for (let i = 0; i < zuordnungen.length; i += PARALLEL) {
    await Promise.all(zuordnungen.slice(i, i + PARALLEL).map(async z => {
      const d = mitVorschau ? await ladeWeindaten(supabase, membership.tenantId, z.fuellung_id, katalog) : null
      weindaten[z.woo_produkt_id] = {
        stand: weindatenStand(z, d ? weindatenPruefsumme(d) : null),
        am: z.weindaten_am, fehler: z.weindaten_fehler,
        html: d ? weindatenHtml(d) : '', ohneElabel: !!d && !d.elabelUrl,
      }
    }))
  }

  return <ZuordnungClient produkte={produkte} fuellungen={fuellungen} zuordnungen={zuordnungen}
    shopFehler={shopFehler} abgeschnitten={abgeschnitten} nurLesen={nurLesen} weindaten={weindaten} bestand={bestand} bestandAn={bestandAn} />
}
