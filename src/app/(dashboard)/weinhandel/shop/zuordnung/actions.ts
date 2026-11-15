'use server'

// Weinshop-Anbindung (KAN-461, 15.11.2026): Zuordnung Füllung ↔ Shop-Produkt für den EIGENEN, aktiven Betrieb.
// Schreiben darf nur die Betriebsleitung (wie die Datenbank: Policies shop_zuordnungen_*, Paket-Modul modul_shop).
// Einziger Schreibzugriff auf den Shop: die Artikelnummer (SKU) eines Produkts, und nur, wenn dort noch keine steht.
// Scheitert der Shop, bleibt die Zuordnung gespeichert und die Meldung des Shops wird als Hinweis zurückgegeben.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { hatModul, modulAusMeldung } from '@/lib/auth/modul'
import { dbFehlerText, fehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { shopZugangLaden } from '@/lib/shop/laden'
import { wooProduktLesen, wooSkuSchreiben } from '@/lib/shop/woocommerce'
import { skuFuerFuellung } from '@/lib/shop/zuordnung'

type Ergebnis = { success: true; hinweis?: string } | { error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SAMMEL = 200

type DbFehler = { message?: string; code?: string } | null
type Zeile = Record<string, string | number | boolean | null>
type Kette<T> = PromiseLike<{ data: T; error: DbFehler }>
type Filter<T> = { eq(spalte: string, wert: string | number): Filter<T>; maybeSingle(): Kette<Zeile | null>; select(spalten: string): Kette<T> }
/** Die Zugriffe dieser Datei (Benutzer-Client, RLS gilt) – eng typisiert statt any */
type Db = {
  from(tabelle: 'fuellungen' | 'shop_zuordnungen'): {
    select(spalten: string): Filter<Zeile[]>
    insert(werte: Zeile): { select(spalten: string): Kette<Zeile[]> }
    update(werte: Zeile): Filter<Zeile[]>
    delete(): Filter<Zeile[]>
  }
}

async function zuordnungKontext(): Promise<{ tenantId: string; db: Db } | { error: string }> {
  const membership = await getCurrentMembership()
  // KAN-30: Seite aus einem anderen Betrieb? (vor den Rechten, sonst gelten die des neuen Betriebs)
  const betriebGewechselt = await seitenBetriebFehler(membership?.tenantId)
  if (betriebGewechselt) return { error: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { error: aboGesperrt }
  if (!membership || !canAdmin(membership.role)) return { error: 'Keine Berechtigung – die Shop-Anbindung richtet die Betriebsleitung ein.' }
  if (!(await hatModul('modul_shop'))) return { error: modulAusMeldung('modul_shop') }
  return { tenantId: membership.tenantId, db: (await createSupabaseServerClient()) as unknown as Db }
}

const produktNr = (roh: unknown): number | null => {
  const n = typeof roh === 'number' ? roh : Number(String(roh ?? '').trim())
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** SKU im Shop nachziehen: nur, wenn das Produkt dort noch keine hat. Gibt einen Hinweis zurück, wenn der Shop ablehnt. */
async function skuNachziehen(db: Db, tenantId: string, produktId: number, fuellung: { id: string; chargennummer: string | null }): Promise<string | undefined> {
  const zugang = await shopZugangLaden(tenantId)
  if (!zugang.ok) return `Zuordnung gespeichert, die Artikelnummer wurde nicht in den Shop geschrieben: ${zugang.meldung}`
  const produkt = await wooProduktLesen(zugang.zugang, produktId)
  if (!produkt.ok) return `Zuordnung gespeichert, die Artikelnummer wurde nicht in den Shop geschrieben: ${produkt.meldung}`

  let sku = produkt.daten.sku
  let geschrieben: string | null = null
  let hinweis: string | undefined
  if (!sku) {
    const r = await wooSkuSchreiben(zugang.zugang, produktId, skuFuerFuellung(fuellung))
    if (r.ok) { sku = r.daten.sku; geschrieben = new Date().toISOString() }
    else hinweis = `Zuordnung gespeichert, die Artikelnummer wurde nicht in den Shop geschrieben: ${r.meldung}`
  }
  // Momentaufnahme von Name und SKU (die Seite zeigt sie auch, wenn der Shop gerade nicht antwortet)
  const { data, error } = await db.from('shop_zuordnungen')
    .update({ woo_name: produkt.daten.name, woo_sku: sku, ...(geschrieben ? { sku_geschrieben_am: geschrieben } : {}), aktualisiert_am: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('woo_produkt_id', produktId).select('id')
  if (error) return `Zuordnung gespeichert, Name und Artikelnummer konnten nicht vermerkt werden: ${dbFehlerText(error)}`
  if (data.length === 0) return 'Zuordnung gespeichert, Name und Artikelnummer konnten nicht vermerkt werden.'
  return hinweis
}

async function zuordnenIntern(k: { tenantId: string; db: Db }, produktRoh: unknown, fuellungRoh: unknown, nameRoh?: unknown): Promise<Ergebnis> {
  const produktId = produktNr(produktRoh)
  const fuellungId = typeof fuellungRoh === 'string' ? fuellungRoh.trim() : ''
  if (!produktId) return { error: 'Das Shop-Produkt ist ungültig.' }
  if (!UUID.test(fuellungId)) return { error: 'Bitte eine Füllung wählen.' }

  // Füllung des eigenen Betriebs, aktiv und nicht storniert
  const { data: fuellung, error: fe } = await k.db.from('fuellungen')
    .select('id, chargennummer, aktiv, storniert_am').eq('tenant_id', k.tenantId).eq('id', fuellungId).maybeSingle()
  if (fe) return { error: dbFehlerText(fe, 'Die Füllung konnte nicht geladen werden') }
  if (!fuellung || fuellung.aktiv !== true || fuellung.storniert_am) return { error: 'Die Füllung gibt es nicht mehr oder sie ist storniert bzw. inaktiv.' }

  const { data: vorhanden, error: ve } = await k.db.from('shop_zuordnungen')
    .select('id, fuellung_id').eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).maybeSingle()
  if (ve) return { error: dbFehlerText(ve, 'Die Zuordnung konnte nicht geladen werden') }

  const name = typeof nameRoh === 'string' && nameRoh.trim() ? nameRoh.trim().slice(0, 300) : null
  const jetzt = new Date().toISOString()
  const schreiben = vorhanden
    // umhängen (z. B. neuer Jahrgang): dieselbe Zeile, neue Füllung
    ? await k.db.from('shop_zuordnungen').update({ fuellung_id: fuellungId, aktualisiert_am: jetzt })
        .eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).select('id')
    : await k.db.from('shop_zuordnungen').insert({ tenant_id: k.tenantId, fuellung_id: fuellungId, woo_produkt_id: produktId, woo_name: name }).select('id')
  if (schreiben.error) {
    if (schreiben.error.code === '23505') return { error: 'Diese Füllung ist schon einem anderen Shop-Produkt zugeordnet.' }
    return { error: dbFehlerText(schreiben.error, 'Die Zuordnung konnte nicht gespeichert werden') }
  }
  if (schreiben.data.length === 0) return { error: NICHT_GESPEICHERT }

  let hinweis: string | undefined
  try {
    hinweis = await skuNachziehen(k.db, k.tenantId, produktId, { id: fuellungId, chargennummer: fuellung.chargennummer === null ? null : String(fuellung.chargennummer) })
  } catch (e) {
    hinweis = `Zuordnung gespeichert, die Artikelnummer wurde nicht in den Shop geschrieben: ${fehlerText(e)}`
  }
  return hinweis ? { success: true, hinweis } : { success: true }
}

/** Produkt einer Füllung zuordnen bzw. auf eine andere Füllung umhängen */
export async function shopZuordnen(produktId: number, fuellungId: string, produktName?: string): Promise<Ergebnis> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  const r = await zuordnenIntern(k, produktId, fuellungId, produktName)
  revalidatePath('/weinhandel/shop/zuordnung')
  return r
}

/** Mehrere bestätigte Vorschläge in einem Schritt übernehmen */
export async function shopVorschlaegeUebernehmen(liste: { produktId: number; fuellungId: string; produktName?: string }[]): Promise<{ success: true; uebernommen: number; fehler: string[]; hinweise: string[] } | { error: string }> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  if (!Array.isArray(liste) || liste.length === 0) return { error: 'Es gibt keine Vorschläge zu übernehmen.' }
  if (liste.length > MAX_SAMMEL) return { error: `Bitte höchstens ${MAX_SAMMEL} Vorschläge auf einmal übernehmen.` }
  let uebernommen = 0
  const fehler: string[] = [], hinweise: string[] = []
  for (const v of liste) {
    const r = await zuordnenIntern(k, v?.produktId, v?.fuellungId, v?.produktName)
    if ('error' in r) fehler.push(r.error)
    else { uebernommen++; if (r.hinweis && !hinweise.includes(r.hinweis)) hinweise.push(r.hinweis) }
  }
  revalidatePath('/weinhandel/shop/zuordnung')
  return { success: true, uebernommen, fehler: [...new Set(fehler)], hinweise }
}

/** Zuordnung lösen – die Artikelnummer im Shop bleibt stehen */
export async function shopZuordnungLoesen(produktRoh: number): Promise<Ergebnis> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  const produktId = produktNr(produktRoh)
  if (!produktId) return { error: 'Das Shop-Produkt ist ungültig.' }
  const { data, error } = await k.db.from('shop_zuordnungen').delete()
    .eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).select('id')
  if (error) return { error: dbFehlerText(error, 'Die Zuordnung konnte nicht gelöst werden') }
  if (data.length === 0) return { error: NICHT_GESPEICHERT }
  revalidatePath('/weinhandel/shop/zuordnung')
  return { success: true }
}

/** Artikelnummer erneut in den Shop schreiben (z. B. nachdem der Schlüssel Schreibrecht bekommen hat) */
export async function shopSkuErneutSchreiben(produktRoh: number): Promise<Ergebnis> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  const produktId = produktNr(produktRoh)
  if (!produktId) return { error: 'Das Shop-Produkt ist ungültig.' }
  const { data: z, error: ze } = await k.db.from('shop_zuordnungen')
    .select('id, fuellung_id').eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).maybeSingle()
  if (ze) return { error: dbFehlerText(ze, 'Die Zuordnung konnte nicht geladen werden') }
  if (!z) return { error: 'Für dieses Produkt gibt es keine Zuordnung.' }
  const { data: f, error: fe } = await k.db.from('fuellungen')
    .select('id, chargennummer').eq('tenant_id', k.tenantId).eq('id', String(z.fuellung_id)).maybeSingle()
  if (fe) return { error: dbFehlerText(fe, 'Die Füllung konnte nicht geladen werden') }
  if (!f) return { error: 'Die Füllung gibt es nicht mehr.' }
  let hinweis: string | undefined
  try {
    hinweis = await skuNachziehen(k.db, k.tenantId, produktId, { id: String(f.id), chargennummer: f.chargennummer === null ? null : String(f.chargennummer) })
  } catch (e) {
    return { error: fehlerText(e) }
  }
  revalidatePath('/weinhandel/shop/zuordnung')
  return hinweis ? { error: hinweis.replace(/^Zuordnung gespeichert, d/, 'D') } : { success: true }
}
