'use server'

// Weinshop-Anbindung (KAN-461, 15.11.2026): Zuordnung Füllung ↔ Shop-Produkt für den EIGENEN, aktiven Betrieb.
// Schreiben darf nur die Betriebsleitung (wie die Datenbank: Policies shop_zuordnungen_*, Paket-Modul modul_shop).
// Einziger Schreibzugriff auf den Shop: die Artikelnummer (SKU) eines Produkts, und nur, wenn dort noch keine steht.
// Scheitert der Shop, bleibt die Zuordnung gespeichert und die Meldung des Shops wird als Hinweis zurückgegeben.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { warteschlangeAbarbeiten } from '@/lib/shop/warteschlange'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { hatModul, modulAusMeldung } from '@/lib/auth/modul'
import { dbFehlerText, fehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { shopZugangLaden } from '@/lib/shop/laden'
import { wooMetaSchreiben, wooProduktLesen, wooSkuSchreiben, type WooZugang } from '@/lib/shop/woocommerce'
import { ladeElabelKatalog, ladeWeindaten } from '@/lib/shop/weindatenLaden'
import { weindatenMeta, weindatenPruefsumme } from '@/lib/shop/weindaten'
import type { KatalogEintrag } from '@/lib/elabel/katalog'
import { heuteWien } from '@/lib/datum/wien'
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

type Kontext = { tenantId: string; db: Db; /** derselbe Benutzer-Client, ungetypt – für die Ladefunktionen */ roh: unknown }

async function zuordnungKontext(): Promise<Kontext | { error: string }> {
  const membership = await getCurrentMembership()
  // KAN-30: Seite aus einem anderen Betrieb? (vor den Rechten, sonst gelten die des neuen Betriebs)
  const betriebGewechselt = await seitenBetriebFehler(membership?.tenantId)
  if (betriebGewechselt) return { error: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { error: aboGesperrt }
  if (!membership || !canAdmin(membership.role)) return { error: 'Keine Berechtigung – die Shop-Anbindung richtet die Betriebsleitung ein.' }
  if (!(await hatModul('modul_shop'))) return { error: modulAusMeldung('modul_shop') }
  const roh = await createSupabaseServerClient()
  return { tenantId: membership.tenantId, db: roh as unknown as Db, roh }
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

async function zuordnenIntern(k: Kontext, produktRoh: unknown, fuellungRoh: unknown, nameRoh?: unknown): Promise<Ergebnis> {
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

// ── Weindaten übertragen (KAN-462) ───────────────────────────────────────────────────────────────────────────────────
// Schreibt nur Meta-Felder mit dem Präfix s112_ (lib/shop/weindaten.ts). Der letzte Stand – übertragen am, Prüfsumme,
// Fehler – steht an der Zuordnung; ein Fehlversuch löscht den vorigen Erfolg nicht.

const MAX_WEINDATEN = 300

/** Überträgt die Weindaten einer Zuordnung; gibt die Fehlermeldung zurück (null = übertragen) */
async function weindatenFuer(k: Kontext, z: { woo_produkt_id: number; fuellung_id: string }, zugang: WooZugang, katalog: KatalogEintrag[]): Promise<string | null> {
  let meldung: string | null = null
  let pruefsumme: string | null = null
  try {
    const d = await ladeWeindaten(k.roh, k.tenantId, z.fuellung_id, katalog)
    if (!d) meldung = 'Die Füllung gibt es nicht mehr.'
    else {
      const r = await wooMetaSchreiben(zugang, z.woo_produkt_id, weindatenMeta(d, heuteWien()))
      if (r.ok) pruefsumme = weindatenPruefsumme(d)
      else meldung = r.meldung
    }
  } catch (e) {
    meldung = fehlerText(e)
  }
  const jetzt = new Date().toISOString()
  const { data, error } = await k.db.from('shop_zuordnungen')
    .update(meldung ? { weindaten_fehler: meldung.slice(0, 500), aktualisiert_am: jetzt } : { weindaten_am: jetzt, weindaten_pruefsumme: pruefsumme, weindaten_fehler: null, aktualisiert_am: jetzt })
    .eq('tenant_id', k.tenantId).eq('woo_produkt_id', z.woo_produkt_id).select('id')
  if (error) return meldung ?? `Übertragen, aber der Stand konnte nicht gespeichert werden: ${dbFehlerText(error)}`
  if (data.length === 0) return meldung ?? NICHT_GESPEICHERT
  return meldung
}

/** Weindaten eines zugeordneten Produkts in den Shop schreiben */
export async function shopWeindatenUebertragen(produktRoh: number): Promise<Ergebnis> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  const produktId = produktNr(produktRoh)
  if (!produktId) return { error: 'Das Shop-Produkt ist ungültig.' }
  const { data: z, error: ze } = await k.db.from('shop_zuordnungen')
    .select('id, fuellung_id, woo_produkt_id').eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).maybeSingle()
  if (ze) return { error: dbFehlerText(ze, 'Die Zuordnung konnte nicht geladen werden') }
  if (!z) return { error: 'Für dieses Produkt gibt es keine Zuordnung.' }
  try {
    const zugang = await shopZugangLaden(k.tenantId)
    if (!zugang.ok) return { error: zugang.meldung }
    const katalog = await ladeElabelKatalog(k.roh)
    const meldung = await weindatenFuer(k, { woo_produkt_id: produktId, fuellung_id: String(z.fuellung_id) }, zugang.zugang, katalog)
    revalidatePath('/weinhandel/shop/zuordnung')
    return meldung ? { error: meldung } : { success: true }
  } catch (e) {
    return { error: fehlerText(e) }
  }
}

/** Weindaten aller zugeordneten Produkte übertragen – je Produkt eigenes Ergebnis, ein Fehler hält die übrigen nicht auf */
export async function shopWeindatenAlle(): Promise<{ success: true; uebertragen: number; fehler: number; ersterFehler?: string } | { error: string }> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  // alle-ausnahme: je Betrieb höchstens so viele Zuordnungen wie Shop-Produkte, gedeckelt auf MAX_WEINDATEN + 1
  const { data: liste, error } = await (k.roh as { from(t: string): { select(s: string): { eq(c: string, v: string): { order(c: string): { limit(n: number): PromiseLike<{ data: Zeile[] | null; error: DbFehler }> } } } } })
    .from('shop_zuordnungen').select('id, fuellung_id, woo_produkt_id').eq('tenant_id', k.tenantId).order('woo_produkt_id').limit(MAX_WEINDATEN + 1)
  if (error) return { error: dbFehlerText(error, 'Die Zuordnungen konnten nicht geladen werden') }
  const zeilen = liste ?? []
  if (zeilen.length === 0) return { error: 'Es gibt noch keine Zuordnungen.' }
  if (zeilen.length > MAX_WEINDATEN) return { error: `Mehr als ${MAX_WEINDATEN} Zuordnungen – bitte einzeln übertragen.` }
  try {
    const zugang = await shopZugangLaden(k.tenantId)
    if (!zugang.ok) return { error: zugang.meldung }
    const katalog = await ladeElabelKatalog(k.roh)
    let uebertragen = 0, fehler = 0
    let ersterFehler: string | undefined
    for (const z of zeilen) {
      const meldung = await weindatenFuer(k, { woo_produkt_id: Number(z.woo_produkt_id), fuellung_id: String(z.fuellung_id) }, zugang.zugang, katalog)
      if (meldung) { fehler++; ersterFehler ??= meldung } else uebertragen++
    }
    revalidatePath('/weinhandel/shop/zuordnung')
    return { success: true, uebertragen, fehler, ...(ersterFehler ? { ersterFehler } : {}) }
  } catch (e) {
    return { error: fehlerText(e) }
  }
}

// ── Bestand jetzt übertragen (KAN-463) ───────────────────────────────────────────────────────────────────────────────
// Reiht die Füllung des Produkts ein und arbeitet genau diesen Eintrag sofort ab (Service-Role, nach den Prüfungen
// oben). Der regelmäßige Weg bleibt die Warteschlange mit dem Cron – das hier ist der Knopf für „gleich prüfen“.

export async function shopBestandJetzt(produktRoh: number): Promise<{ success: true; menge: number | null } | { error: string }> {
  const k = await zuordnungKontext()
  if ('error' in k) return { error: k.error }
  const produktId = produktNr(produktRoh)
  if (!produktId) return { error: 'Das Shop-Produkt ist ungültig.' }
  const { data: z, error: ze } = await k.db.from('shop_zuordnungen')
    .select('id, fuellung_id').eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).maybeSingle()
  if (ze) return { error: dbFehlerText(ze, 'Die Zuordnung konnte nicht geladen werden') }
  if (!z) return { error: 'Für dieses Produkt gibt es keine Zuordnung.' }
  const fuellungId = String(z.fuellung_id)

  type Admin = {
    from(t: 'tenant_einstellungen' | 'shop_warteschlange'): {
      select(s: string): Filter<Zeile[]>
      upsert(w: Zeile, o: { onConflict: string }): PromiseLike<{ error: DbFehler }>
    }
  }
  const admin = createSupabaseAdminClient()
  const a = admin as unknown as Admin
  const { data: einst, error: ee } = await a.from('tenant_einstellungen')
    .select('shop_bestand_uebertragen').eq('tenant_id', k.tenantId).maybeSingle()
  if (ee) return { error: dbFehlerText(ee, 'Die Einstellungen konnten nicht geladen werden') }
  if (einst?.shop_bestand_uebertragen !== true) return { error: 'Die Bestandsübertragung ist ausgeschaltet – einschalten unter Shop-Anbindung → Einstellungen.' }

  const jetzt = new Date().toISOString()
  const { error: ue } = await a.from('shop_warteschlange').upsert(
    { tenant_id: k.tenantId, fuellung_id: fuellungId, art: 'bestand', eingereiht_am: jetzt, versuche: 0, naechster_versuch_am: jetzt, letzter_fehler: null },
    { onConflict: 'tenant_id,fuellung_id,art' })
  if (ue) return { error: dbFehlerText(ue, 'Die Übertragung konnte nicht eingereiht werden') }
  try {
    const lauf = await warteschlangeAbarbeiten(admin, { nur: { tenantId: k.tenantId, fuellungId, art: 'bestand' } })
    revalidatePath('/weinhandel/shop/zuordnung')
    if (lauf.fehler > 0) return { error: lauf.meldungen[0] ?? 'Die Übertragung ist fehlgeschlagen.' }
    if (lauf.uebertragen === 0) return { error: 'Es wurde nichts übertragen – bitte die Seite neu laden.' }
    const { data: stand, error: se } = await k.db.from('shop_zuordnungen')
      .select('id, bestand_menge').eq('tenant_id', k.tenantId).eq('woo_produkt_id', produktId).maybeSingle()
    if (se) return { success: true, menge: null }
    return { success: true, menge: stand?.bestand_menge === null || stand?.bestand_menge === undefined ? null : Number(stand.bestand_menge) }
  } catch (e) {
    return { error: fehlerText(e) }
  }
}
