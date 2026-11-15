// Weinshop-Anbindung (KAN-463): Warteschlange abarbeiten – nur serverseitig, mit der Service-Role (Cron bzw. „jetzt
// übertragen“ nach geprüfter Berechtigung). Ruft den Shop auf; Speichervorgänge der App tun das nie.
//
// Je Eintrag: Menge bzw. Weindaten JETZT rechnen (letzter Stand), an den Shop schreiben, Stand an der Zuordnung
// vermerken. Erfolg entfernt den Eintrag – aber nur, wenn seit dem Lesen keine neue Änderung eingereiht wurde
// (eingereiht_am unverändert). Fehler zählt den Versuch hoch und plant den nächsten (warteschlangeRegeln.ts).
// Einträge ohne Zuordnung, ohne Modul bzw. Schalter oder ohne Füllung werden ohne Übertragung entfernt.
import 'server-only'
import { dbFehlerText, fehlerText, AktionsFehler } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import { shopZugangLaden } from '@/lib/shop/laden'
import { wooBestandSchreiben, wooMetaSchreiben, wooProduktLesen, type WooZugang } from '@/lib/shop/woocommerce'
import { ladeElabelKatalog, ladeWeindaten } from '@/lib/shop/weindatenLaden'
import { weindatenMeta, weindatenPruefsumme } from '@/lib/shop/weindaten'
import { LAUF_BUDGET_MS, MAX_VERSUCHE, WARTESCHLANGE_JE_LAUF, leererLauf, naechsterVersuch, type Lauf, type WarteArt } from '@/lib/shop/warteschlangeRegeln'
import type { KatalogEintrag } from '@/lib/elabel/katalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
type Eintrag = { id: string; tenant_id: string; fuellung_id: string; art: WarteArt; eingereiht_am: string; versuche: number }

export type AbarbeitenOptionen = {
  jetztMs?: number
  budgetMs?: number
  /** nur diesen einen Eintrag – unabhängig von Fälligkeit und Versuchen („jetzt übertragen“) */
  nur?: { tenantId: string; fuellungId: string; art: WarteArt }
}

/** Ergebnis eines Eintrags: null = übertragen, 'entfernt' = ohne Übertragung entfernt, sonst die Fehlermeldung */
type Ergebnis = { art: 'ok'; stand: R } | { art: 'entfernt' } | { art: 'fehler'; meldung: string }

async function uebertrage(admin: R, e: Eintrag, produktId: number, zugang: WooZugang, katalog: () => Promise<KatalogEintrag[]>): Promise<Ergebnis> {
  const jetzt = new Date().toISOString()
  if (e.art === 'bestand') {
    const { data: menge, error } = await admin.rpc('s112_shop_bestand', { p_fuellung_id: e.fuellung_id })
    if (error) return { art: 'fehler', meldung: dbFehlerText(error, 'Die Menge konnte nicht berechnet werden') }
    if (menge === null || menge === undefined) return { art: 'entfernt' }   // Füllung gibt es nicht mehr
    const produkt = await wooProduktLesen(zugang, produktId)
    if (!produkt.ok) return { art: 'fehler', meldung: produkt.meldung }
    if (produkt.daten.typ && produkt.daten.typ !== 'simple') {
      return { art: 'fehler', meldung: `Das Produkt ist im Shop vom Typ „${produkt.daten.typ}“ – der Bestand wird nur für einfache Produkte übertragen.` }
    }
    const r = await wooBestandSchreiben(zugang, produktId, Number(menge))
    if (!r.ok) return { art: 'fehler', meldung: r.meldung }
    return { art: 'ok', stand: { bestand_menge: r.daten.menge, bestand_am: jetzt, bestand_fehler: null, aktualisiert_am: jetzt } }
  }
  const d = await ladeWeindaten(admin, e.tenant_id, e.fuellung_id, await katalog())
  if (!d) return { art: 'entfernt' }
  const r = await wooMetaSchreiben(zugang, produktId, weindatenMeta(d, heuteWien()))
  if (!r.ok) return { art: 'fehler', meldung: r.meldung }
  return { art: 'ok', stand: { weindaten_am: jetzt, weindaten_pruefsumme: weindatenPruefsumme(d), weindaten_fehler: null, aktualisiert_am: jetzt } }
}

/**
 * Arbeitet fällige Einträge ab. Wirft nur, wenn schon das Lesen der Warteschlange scheitert – Fehler je Eintrag stehen
 * im Ergebnis und am Eintrag.
 */
export async function warteschlangeAbarbeiten(admin: R, o: AbarbeitenOptionen = {}): Promise<Lauf> {
  const start = Date.now()
  const jetztMs = o.jetztMs ?? start
  const budget = o.budgetMs ?? LAUF_BUDGET_MS
  const lauf = leererLauf()

  // tenant-isolation-ignore: Cron über alle Betriebe (Service-Role); „nur“ filtert auf den geprüften Betrieb
  let abfrage = admin.from('shop_warteschlange').select('id, tenant_id, fuellung_id, art, eingereiht_am, versuche')
  if (o.nur) abfrage = abfrage.eq('tenant_id', o.nur.tenantId).eq('fuellung_id', o.nur.fuellungId).eq('art', o.nur.art)
  else abfrage = abfrage.lte('naechster_versuch_am', new Date(jetztMs).toISOString()).lt('versuche', MAX_VERSUCHE)
  const { data, error } = await abfrage.order('naechster_versuch_am').order('id').limit(WARTESCHLANGE_JE_LAUF)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Die Shop-Warteschlange konnte nicht gelesen werden'))
  const eintraege = (data ?? []) as Eintrag[]
  lauf.geholt = eintraege.length
  if (eintraege.length === 0) return lauf

  let katalogCache: KatalogEintrag[] | null = null
  const katalog = async () => (katalogCache ??= await ladeElabelKatalog(admin))

  const entfernen = async (e: Eintrag, nurUnveraendert: boolean) => {
    // loeschen-ohne-pruefung: 0 Zeilen heißt, dass inzwischen eine neue Änderung eingereiht wurde – der Eintrag bleibt dann stehen
    let q = admin.from('shop_warteschlange').delete().eq('id', e.id).eq('tenant_id', e.tenant_id)
    if (nurUnveraendert) q = q.eq('eingereiht_am', e.eingereiht_am)
    const { error: de } = await q.select('id')
    if (de) console.error('[shop/warteschlange] Eintrag nicht entfernt:', de.message)
  }
  const fehlschlag = async (e: Eintrag, meldung: string, produktBekannt: boolean) => {
    lauf.fehler++
    if (lauf.meldungen.length < 5) lauf.meldungen.push(meldung)
    const text = meldung.slice(0, 500)
    // aenderung-ohne-pruefung: Service-Role; 0 Zeilen = Eintrag inzwischen entfernt (Zuordnung gelöst) – in Ordnung
    const { error: ue } = await admin.from('shop_warteschlange')
      .update({ versuche: e.versuche + 1, naechster_versuch_am: naechsterVersuch(e.versuche + 1, Date.now()).toISOString(), letzter_fehler: text })
      .eq('id', e.id).eq('tenant_id', e.tenant_id).eq('eingereiht_am', e.eingereiht_am).select('id')
    if (ue) console.error('[shop/warteschlange] Fehlversuch nicht vermerkt:', ue.message)
    if (!produktBekannt) return
    // aenderung-ohne-pruefung: Service-Role; Stand der Zuordnung, 0 Zeilen = Zuordnung inzwischen gelöst
    const { error: ze } = await admin.from('shop_zuordnungen')
      .update(e.art === 'bestand' ? { bestand_fehler: text } : { weindaten_fehler: text })
      .eq('tenant_id', e.tenant_id).eq('fuellung_id', e.fuellung_id).select('id')
    if (ze) console.error('[shop/warteschlange] Fehler nicht an der Zuordnung vermerkt:', ze.message)
  }

  const jeBetrieb = new Map<string, Eintrag[]>()
  for (const e of eintraege) jeBetrieb.set(e.tenant_id, [...(jeBetrieb.get(e.tenant_id) ?? []), e])

  let begonnen = 0
  for (const [tenantId, liste] of jeBetrieb) {
    if (Date.now() - start > budget) break
    let einst: R | null = null
    let zugang: Awaited<ReturnType<typeof shopZugangLaden>> | null = null
    const produkte = new Map<string, number>()
    let betriebFehler: string | null = null
    try {
      const { data: e1, error: ee } = await admin.from('tenant_einstellungen')
        .select('modul_shop, shop_bestand_uebertragen').eq('tenant_id', tenantId).maybeSingle()
      if (ee) throw new AktionsFehler(dbFehlerText(ee, 'Einstellungen konnten nicht geladen werden'))
      einst = e1 as R | null
      // alle-ausnahme: höchstens WARTESCHLANGE_JE_LAUF Füllungen dieses Laufs, je Betrieb 1:1 zugeordnet
      const { data: zz, error: ze } = await admin.from('shop_zuordnungen')
        .select('fuellung_id, woo_produkt_id').eq('tenant_id', tenantId).in('fuellung_id', [...new Set(liste.map(e => e.fuellung_id))]).limit(WARTESCHLANGE_JE_LAUF)
      if (ze) throw new AktionsFehler(dbFehlerText(ze, 'Zuordnungen konnten nicht geladen werden'))
      for (const z of (zz ?? []) as R[]) produkte.set(String(z.fuellung_id), Number(z.woo_produkt_id))
      if (einst?.modul_shop) zugang = await shopZugangLaden(tenantId)
    } catch (err) {
      betriebFehler = fehlerText(err)
    }

    for (const e of liste) {
      if (Date.now() - start > budget) break
      begonnen++
      if (betriebFehler) { await fehlschlag(e, betriebFehler, false); continue }
      const produktId = produkte.get(e.fuellung_id)
      // Zuordnung gelöst, Modul aus oder (für den Bestand) Schalter aus → nichts zu übertragen
      if (!produktId || !einst?.modul_shop || (e.art === 'bestand' && !einst.shop_bestand_uebertragen)) {
        await entfernen(e, false); lauf.entfernt++; continue
      }
      if (!zugang?.ok) { await fehlschlag(e, zugang?.meldung ?? 'Die Zugangsdaten des Shops fehlen.', true); continue }
      let ergebnis: Ergebnis
      try {
        ergebnis = await uebertrage(admin, e, produktId, zugang.zugang, katalog)
      } catch (err) {
        ergebnis = { art: 'fehler', meldung: fehlerText(err) }
      }
      if (ergebnis.art === 'entfernt') { await entfernen(e, false); lauf.entfernt++; continue }
      if (ergebnis.art === 'fehler') { await fehlschlag(e, ergebnis.meldung, true); continue }
      // aenderung-ohne-pruefung: Service-Role; 0 Zeilen = Zuordnung inzwischen gelöst – der Shop hat den Stand trotzdem
      const { error: se } = await admin.from('shop_zuordnungen').update(ergebnis.stand)
        .eq('tenant_id', e.tenant_id).eq('fuellung_id', e.fuellung_id).select('id')
      if (se) { await fehlschlag(e, dbFehlerText(se, 'Übertragen, aber der Stand konnte nicht gespeichert werden'), false); continue }
      await entfernen(e, true)
      lauf.uebertragen++
    }
  }
  lauf.offen = eintraege.length - begonnen
  return lauf
}
