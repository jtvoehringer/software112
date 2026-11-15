// KAN-461 (15.11.2026): Weinshop-Anbindung S1b – Zuordnung Füllung ↔ WooCommerce-Produkt.
// Geprüft wird: Vorschlagslogik (SKU, Name + Jahrgang, nur eindeutige Treffer) an den öffentlichen Produkttiteln des
// Pilot-Shops, SKU-Form, WooCommerce-Client gegen eine Attrappe (Produkte seitenweise, SKU schreiben), Server Actions
// (Rechte vor jedem Zugriff, 1:1, nie eine vorhandene SKU überschreiben, Shop-Fehler als Hinweis), Migration und Register.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { skuFuerFuellung, vorschlaege, aehnlichkeit, woerter, jahreIm, fuellungText } from '../../src/lib/shop/zuordnung.ts'
import { wooProdukteLaden, wooSkuSchreiben, wooProduktLesen, WOO_MAX_SEITEN } from '../../src/lib/shop/woocommerce.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid } from './buchung-attrappe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const f = (n, name, jahrgang, rebsorte = null, zusatz = null, charge = null) => ({ id: uuid(n), name, jahrgang, rebsorte, zusatzbezeichnung: zusatz, chargennummer: charge })

// Öffentliche Produkttitel des Pilot-Shops (15.11.2026)
const TITEL = ['frizzanté rosé', 'querfeldein gemischter satz 2025', 'querfeldein rosé 2025', 'querfeldein rot 2023',
  'gumpoldskirchen zierfandler-rotgipfler 2025 thermenregion dac', 'gumpoldskirchen zierfandler 2025 thermenregion dac',
  'gumpoldskirchen rotgipfler 2025 thermenregion dac', 'gumpoldskirchen pinot noir 2024', 'gumpoldskirchen sankt laurent bio 2024',
  'ried modler 1ötw zierfandler 2022', 'ried wiege 1ötw zierfandler 2024', 'ried laim 1ötw rotgipfler 2023', 'ried student 1ötw rotgipfler 2024',
  'ried glas sankt laurent 2020', 'ried satzing st. laurent 2019']
const PRODUKTE = TITEL.map((name, i) => ({ id: 100 + i, name, sku: null }))

describe('KAN-461: SKU und Textbausteine', () => {
  test('SKU: S112-<Chargennummer>, ohne Chargennummer die ersten 8 Zeichen der Füllungs-ID', () => {
    assert.equal(skuFuerFuellung({ id: uuid(1), chargennummer: 'L-2025-0042' }), 'S112-L-2025-0042')
    assert.equal(skuFuerFuellung({ id: uuid(1), chargennummer: '  L 25/7 ä ' }), 'S112-L-25/7')
    assert.equal(skuFuerFuellung({ id: 'abcdef12-3456-4000-8000-000000000001', chargennummer: null }), 'S112-ABCDEF12')
    assert.equal(skuFuerFuellung({ id: 'abcdef12-3456-4000-8000-000000000001', chargennummer: ' ?? ' }), 'S112-ABCDEF12')
    assert.ok(skuFuerFuellung({ id: uuid(1), chargennummer: 'x'.repeat(300) }).length <= 100)
  })
  test('Wörter ohne Füllwörter und Jahreszahlen, Umlaute aufgelöst; Jahrgänge aus dem Titel', () => {
    assert.deepEqual(woerter('Gumpoldskirchen Zierfandler-Rotgipfler 2025 Thermenregion DAC bio'), ['gumpoldskirchen', 'zierfandler', 'rotgipfler', 'thermenregion'])
    assert.deepEqual(woerter('Frizzanté Rosé'), ['frizzante', 'rose'])
    assert.deepEqual(woerter('Grüner Veltliner'), ['gruener', 'veltliner'])
    assert.deepEqual(jahreIm('ried glas sankt laurent 2020'), [2020])
    assert.deepEqual(jahreIm('artikel 12345 und 1899'), [])
    assert.equal(fuellungText({ name: 'Zierfandler', jahrgang: 2025, chargennummer: 'L-1' }), 'Zierfandler 2025 · L-1')
    assert.equal(fuellungText({ name: 'Frizzante', jahrgang: null, chargennummer: null }), 'Frizzante')
  })
})

describe('KAN-461: Vorschläge', () => {
  test('gleicher Jahrgang ist Pflicht; ohne Jahrgang nur Titel ohne Jahr', () => {
    assert.equal(aehnlichkeit({ name: 'querfeldein rot 2023' }, f(1, 'Querfeldein Rot', 2024)), 0)
    assert.ok(aehnlichkeit({ name: 'querfeldein rot 2023' }, f(1, 'Querfeldein Rot', 2023)) > 0.9)
    assert.equal(aehnlichkeit({ name: 'querfeldein rot 2023' }, f(1, 'Querfeldein Rot', null)), 0)
    assert.ok(aehnlichkeit({ name: 'frizzanté rosé' }, f(1, 'Frizzante Rosé', null)) > 0.9)
    assert.equal(aehnlichkeit({ name: 'frizzanté rosé' }, f(1, 'Frizzante Rosé', 2025)), 0)
  })
  test('Pilot-Shop: eindeutige Weine werden vorgeschlagen, ähnliche Titel nicht verwechselt', () => {
    const fuellungen = [
      f(1, 'Querfeldein Gemischter Satz', 2025), f(2, 'Querfeldein Rosé', 2025), f(3, 'Querfeldein Rot', 2023),
      f(4, 'Gumpoldskirchen Zierfandler', 2025, 'Zierfandler'), f(5, 'Gumpoldskirchen Rotgipfler', 2025, 'Rotgipfler'),
      f(6, 'Gumpoldskirchen Zierfandler-Rotgipfler', 2025), f(7, 'Ried Modler Zierfandler', 2022, 'Zierfandler'),
      f(8, 'Ried Wiege Zierfandler', 2024, 'Zierfandler'), f(9, 'Frizzante Rosé', null), f(10, 'Querfeldein Rot', 2022),
    ]
    const v = new Map(vorschlaege(PRODUKTE, fuellungen, []).map(x => [x.produktId, x.fuellungId]))
    const titelZu = n => TITEL[[...v.entries()].find(([, fid]) => fid === uuid(n))?.[0] - 100]
    assert.equal(titelZu(1), 'querfeldein gemischter satz 2025')
    assert.equal(titelZu(2), 'querfeldein rosé 2025')
    assert.equal(titelZu(3), 'querfeldein rot 2023')
    assert.equal(titelZu(4), 'gumpoldskirchen zierfandler 2025 thermenregion dac')
    assert.equal(titelZu(5), 'gumpoldskirchen rotgipfler 2025 thermenregion dac')
    assert.equal(titelZu(6), 'gumpoldskirchen zierfandler-rotgipfler 2025 thermenregion dac')
    assert.equal(titelZu(7), 'ried modler 1ötw zierfandler 2022')
    assert.equal(titelZu(8), 'ried wiege 1ötw zierfandler 2024')
    assert.equal(titelZu(9), 'frizzanté rosé')
    assert.equal(titelZu(10), undefined, 'Jahrgang 2022 gibt es im Shop nicht')
    assert.ok([...v.values()].every((x, i, a) => a.indexOf(x) === i), 'keine Füllung zweimal')
  })
  test('Gleichstand → kein Vorschlag; zugeordnete Produkte und Füllungen bleiben außen vor', () => {
    const zwei = [f(1, 'Querfeldein Rot', 2023, null, null, 'A'), f(2, 'Querfeldein Rot', 2023, null, null, 'B')]
    assert.deepEqual(vorschlaege(PRODUKTE, zwei, []), [])
    const eine = [f(1, 'Querfeldein Rot', 2023)]
    assert.equal(vorschlaege(PRODUKTE, eine, []).length, 1)
    assert.deepEqual(vorschlaege(PRODUKTE, eine, [{ fuellung_id: uuid(1), woo_produkt_id: 999 }]), [])
    assert.deepEqual(vorschlaege(PRODUKTE, eine, [{ fuellung_id: uuid(77), woo_produkt_id: 103 }]), [])
  })
  test('SKU geht vor Name: eigene SKU oder Chargennummer; mehrdeutige SKU zählt nicht', () => {
    const fuellungen = [f(1, 'Ganz anderer Name', 2019, null, null, 'L-77'), f(2, 'Querfeldein Rot', 2023)]
    const produkte = [{ id: 1, name: 'querfeldein rot 2023', sku: 'S112-L-77' }, { id: 2, name: 'irgendwas 2019', sku: 'l-77' }]
    assert.deepEqual(vorschlaege([produkte[0]], fuellungen, []), [{ produktId: 1, fuellungId: uuid(1), grund: 'sku' }])
    assert.deepEqual(vorschlaege([produkte[1]], fuellungen, []), [{ produktId: 2, fuellungId: uuid(1), grund: 'sku' }])
    const doppelt = [f(1, 'A', 2020, null, null, 'L-77'), f(2, 'B', 2021, null, null, 'L-77')]
    assert.deepEqual(vorschlaege([{ id: 1, name: 'x', sku: 'L-77' }], doppelt, []), [])
  })
})

describe('KAN-461: WooCommerce-Client – Produkte lesen, SKU schreiben (Attrappe)', () => {
  const zugang = { url: 'https://www.beispiel.at', key: 'ck', secret: 'cs' }
  const aufloesen = async () => ['93.184.216.34']
  const json = (status, body, kopf = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...kopf } })
  const seite = (von, n) => Array.from({ length: n }, (_, i) => ({ id: von + i, name: ` Wein ${von + i} `, sku: i % 2 ? '' : `A${von + i}`, status: 'publish', type: 'simple' }))

  test('seitenweise je 100 nach der Seitenzahl im Kopf; Felder bereinigt', async () => {
    const urls = []
    const r = await wooProdukteLaden(zugang, { aufloesen, fetch: async url => {
      urls.push(url)
      const nr = Number(new URL(url).searchParams.get('page'))
      return json(200, nr === 1 ? seite(1, 100) : nr === 2 ? seite(101, 100) : seite(201, 15), { 'x-wp-totalpages': '3', 'x-wp-total': '215' })
    } })
    assert.equal(r.ok, true)
    assert.equal(r.daten.produkte.length, 215)
    assert.equal(r.daten.abgeschnitten, false)
    assert.deepEqual(r.daten.produkte[0], { id: 1, name: 'Wein 1', sku: 'A1', status: 'publish', typ: 'simple' })
    assert.equal(r.daten.produkte[1].sku, null)
    assert.equal(urls.length, 3)
    assert.match(urls[1], /\/wp-json\/wc\/v3\/products\?per_page=100&page=2&orderby=id&order=asc&_fields=id,name,sku,status,type$/)
  })
  test('ohne Seitenzahl im Kopf: weiterlesen, solange die Seite voll ist; Obergrenze 1.000 mit Kennzeichen', async () => {
    let n = 0
    const kurz = await wooProdukteLaden(zugang, { aufloesen, fetch: async () => { n++; return json(200, n === 1 ? seite(1, 100) : seite(101, 3)) } })
    assert.deepEqual([kurz.daten.produkte.length, kurz.daten.abgeschnitten, n], [103, false, 2])
    n = 0
    const viel = await wooProdukteLaden(zugang, { aufloesen, fetch: async () => { n++; return json(200, seite(n * 1000, 100), { 'x-wp-totalpages': '14' }) } })
    assert.deepEqual([viel.daten.produkte.length, viel.daten.abgeschnitten, n], [WOO_MAX_SEITEN * 100, true, WOO_MAX_SEITEN])
  })
  test('Fehler einer Folgeseite = Fehler des Ganzen (keine Teilmenge)', async () => {
    let n = 0
    const r = await wooProdukteLaden(zugang, { aufloesen, fetch: async () => { n++; return n === 1 ? json(200, seite(1, 100), { 'x-wp-totalpages': '2' }) : json(500, {}) } })
    assert.equal(r.ok, false); assert.equal(r.art, 'antwort')
  })
  test('SKU schreiben: PUT nur mit dem Feld sku; Ablehnungen des Shops übersetzt', async () => {
    const rufe = []
    const ok = await wooSkuSchreiben(zugang, 42, 'S112-L-1', { aufloesen, fetch: async (url, init) => { rufe.push({ url, init }); return json(200, { id: 42, sku: 'S112-L-1' }) } })
    assert.deepEqual(ok, { ok: true, daten: { sku: 'S112-L-1' } })
    assert.equal(rufe[0].url, 'https://www.beispiel.at/wp-json/wc/v3/products/42')
    assert.equal(rufe[0].init.method, 'PUT')
    assert.deepEqual(JSON.parse(rufe[0].init.body), { sku: 'S112-L-1' })
    assert.equal(rufe[0].init.headers['Content-Type'], 'application/json')
    const fall = async antwort => (await wooSkuSchreiben(zugang, 42, 'S112-L-1', { aufloesen, fetch: async () => antwort })).art
    assert.equal(await fall(json(401, { code: 'woocommerce_rest_cannot_edit' })), 'schreibrecht')
    assert.equal(await fall(json(403, { code: 'woocommerce_rest_cannot_edit' })), 'schreibrecht')
    assert.equal(await fall(json(401, { code: 'woocommerce_rest_authentication_error' })), 'schluessel')
    assert.equal(await fall(json(400, { code: 'product_invalid_sku' })), 'sku_vergeben')
    assert.equal(await fall(json(404, { code: 'woocommerce_rest_product_invalid_id' })), 'produkt_fehlt')
    assert.equal(await fall(json(200, { id: 42, sku: '' })), 'antwort')
    assert.equal((await wooSkuSchreiben(zugang, 0, 'x', { aufloesen, fetch: async () => { throw new Error('kein Aufruf erwartet') } })).art, 'produkt_fehlt')
  })
  test('ein Produkt lesen: aktuelle SKU; 404 = Produkt fehlt', async () => {
    const r = await wooProduktLesen(zugang, 42, { aufloesen, fetch: async () => json(200, { id: 42, name: 'Rot 2023', sku: 'ALT-1', status: 'publish', type: 'simple' }) })
    assert.deepEqual(r.daten, { id: 42, name: 'Rot 2023', sku: 'ALT-1', status: 'publish', typ: 'simple' })
    assert.equal((await wooProduktLesen(zugang, 42, { aufloesen, fetch: async () => json(404, { code: 'x' }) })).art, 'produkt_fehlt')
    assert.equal((await wooProduktLesen(zugang, 42, { aufloesen, fetch: async () => json(200, { id: 43, name: 'x' }) })).art, 'produkt_fehlt')
  })
})

// ── Server Actions ───────────────────────────────────────────────────────────────────────────────────────────────────
const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const seitenBetriebFehler = async () => globalThis.__betriebFehler ?? null')
DOPPEL['@/lib/auth/sperren'] = modul('export const schreibSperreFehler = async () => globalThis.__sperreFehler ?? null')
DOPPEL['@/lib/auth/modul'] = modul('export const hatModul = async f => (globalThis.__module ?? []).includes(f); export const modulAusMeldung = f => "Modul aus: " + f')
DOPPEL['@/lib/shop/laden'] = modul('export const shopZugangLaden = async t => { (globalThis.__zugangRufe ??= []).push(t); return globalThis.__zugang }')
DOPPEL['@/lib/shop/woocommerce'] = modul(`
  export const wooProduktLesen = async (z, id) => { (globalThis.__woo ??= []).push(['lesen', id]); return globalThis.__produkt }
  export const wooSkuSchreiben = async (z, id, sku) => { (globalThis.__woo ??= []).push(['schreiben', id, sku]); return globalThis.__skuErgebnis ?? { ok: true, daten: { sku } } }`)
hooksRegistrieren()
const actions = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/shop/zuordnung/actions.ts') : null

const T = uuid(900), FREMD = uuid(901)
const F1 = uuid(1), F2 = uuid(2)
const tabellen = (zuordnungen = []) => ({
  fuellungen: [
    { id: F1, tenant_id: T, chargennummer: 'L-1', aktiv: true, storniert_am: null },
    { id: F2, tenant_id: T, chargennummer: null, aktiv: true, storniert_am: null },
    { id: uuid(3), tenant_id: T, chargennummer: 'L-3', aktiv: true, storniert_am: '2026-11-01T10:00:00Z' },
    { id: uuid(4), tenant_id: T, chargennummer: 'L-4', aktiv: false, storniert_am: null },
    { id: uuid(5), tenant_id: FREMD, chargennummer: 'L-5', aktiv: true, storniert_am: null },
  ],
  shop_zuordnungen: zuordnungen,
})
const zeile = (produkt, fuellung, mehr = {}) => ({ id: uuid(500 + produkt), tenant_id: T, woo_produkt_id: produkt, fuellung_id: fuellung, woo_name: null, woo_sku: null, sku_geschrieben_am: null, ...mehr })

describe('KAN-461: Server Actions der Zuordnung', nurMitHooks, () => {
  let db
  const mit = (zuordnungen = [], eingriffe = {}) => { db = datenbank(tabellen(zuordnungen), eingriffe); globalThis.__serverFake = db; return db }
  beforeEach(() => {
    globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
    globalThis.__module = ['modul_shop']
    globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
    globalThis.__zugang = { ok: true, zugang: { url: 'https://www.beispiel.at', key: 'ck', secret: 'cs' } }
    globalThis.__zugangRufe = []; globalThis.__woo = []
    globalThis.__produkt = { ok: true, daten: { id: 42, name: 'Rot 2023 (Shop)', sku: null, status: 'publish', typ: 'simple' } }
    globalThis.__skuErgebnis = null
  })

  test('abgelehnt vor jedem Zugriff: anderer Betrieb, Nur-Lesen, Mitarbeiter, Leser, Modul aus', async () => {
    const faelle = [
      [() => { globalThis.__betriebFehler = 'Betrieb gewechselt' }, /Betrieb gewechselt/],
      [() => { globalThis.__sperreFehler = 'Nur-Lesen-Modus' }, /Nur-Lesen/],
      [() => { globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft', 'kellerbuch'] } }, /Betriebsleitung/],
      [() => { globalThis.__membership = { tenantId: T, role: 'leser', schreibmodule: [] } }, /Betriebsleitung/],
      [() => { globalThis.__module = ['modul_export'] }, /Modul aus: modul_shop/],
    ]
    for (const [einstellen, muster] of faelle) {
      globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
      globalThis.__module = ['modul_shop']; globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
      einstellen()
      mit([zeile(42, F1)])
      for (const aufruf of [() => actions.shopZuordnen(43, F2), () => actions.shopZuordnungLoesen(42), () => actions.shopSkuErneutSchreiben(42),
        () => actions.shopVorschlaegeUebernehmen([{ produktId: 43, fuellungId: F2 }])]) {
        assert.match((await aufruf()).error ?? '', muster)
      }
      assert.equal(db.aufrufe.length, 0, String(muster))
      assert.equal(globalThis.__woo.length, 0)
      assert.equal(db.tabellen.shop_zuordnungen.length, 1)
    }
  })

  test('Zuordnen: neue Zeile im eigenen Betrieb, SKU nur weil der Shop keine hat, Momentaufnahme aus dem Shop', async () => {
    mit()
    assert.deepEqual(await actions.shopZuordnen(42, F1, 'Titel vom Browser'), { success: true })
    const [z] = db.tabellen.shop_zuordnungen
    assert.equal(z.tenant_id, T); assert.equal(z.fuellung_id, F1); assert.equal(z.woo_produkt_id, 42)
    assert.equal(z.woo_name, 'Rot 2023 (Shop)', 'Name aus dem Shop, nicht vom Browser')
    assert.equal(z.woo_sku, 'S112-L-1')
    assert.ok(z.sku_geschrieben_am)
    assert.deepEqual(globalThis.__woo, [['lesen', 42], ['schreiben', 42, 'S112-L-1']])
    assert.deepEqual(globalThis.__zugangRufe, [T])
  })
  test('vorhandene SKU bleibt: kein Schreibzugriff auf den Shop, SKU nur gemerkt', async () => {
    mit()
    globalThis.__produkt = { ok: true, daten: { id: 42, name: 'Rot 2023', sku: 'ALT-7', status: 'publish', typ: 'simple' } }
    assert.deepEqual(await actions.shopZuordnen(42, F2), { success: true })
    assert.deepEqual(globalThis.__woo, [['lesen', 42]])
    const [z] = db.tabellen.shop_zuordnungen
    assert.equal(z.woo_sku, 'ALT-7'); assert.equal(z.sku_geschrieben_am ?? null, null)
  })
  test('Shop lehnt ab oder antwortet nicht: Zuordnung bleibt, Meldung als Hinweis', async () => {
    mit()
    globalThis.__skuErgebnis = { ok: false, art: 'schreibrecht', meldung: 'Der Schlüssel darf im Shop nicht schreiben.' }
    const r = await actions.shopZuordnen(42, F1)
    assert.equal(r.success, true); assert.match(r.hinweis, /Zuordnung gespeichert.*darf im Shop nicht schreiben/)
    assert.equal(db.tabellen.shop_zuordnungen.length, 1)
    assert.equal(db.tabellen.shop_zuordnungen[0].woo_sku ?? null, null)

    mit()
    globalThis.__produkt = { ok: false, art: 'nicht_erreichbar', meldung: 'Der Shop ist nicht erreichbar.' }
    const r2 = await actions.shopZuordnen(42, F1, 'Titel vom Browser')
    assert.match(r2.hinweis, /nicht erreichbar/)
    assert.equal(db.tabellen.shop_zuordnungen[0].woo_name, 'Titel vom Browser', 'ohne Shop bleibt der übergebene Name')

    mit()
    globalThis.__zugang = { ok: false, meldung: 'Bitte zuerst die Shop-Adresse speichern.' }
    assert.match((await actions.shopZuordnen(42, F1)).hinweis, /Shop-Adresse/)
    assert.equal(db.tabellen.shop_zuordnungen.length, 1)
  })
  test('Umhängen: dieselbe Zeile, neue Füllung; die SKU im Shop bleibt', async () => {
    mit([zeile(42, F1, { woo_sku: 'S112-L-1', sku_geschrieben_am: '2026-11-15T10:00:00Z' })])
    globalThis.__produkt = { ok: true, daten: { id: 42, name: 'Rot 2024', sku: 'S112-L-1', status: 'publish', typ: 'simple' } }
    assert.deepEqual(await actions.shopZuordnen(42, F2), { success: true })
    assert.equal(db.tabellen.shop_zuordnungen.length, 1)
    assert.equal(db.tabellen.shop_zuordnungen[0].fuellung_id, F2)
    assert.equal(db.tabellen.shop_zuordnungen[0].woo_sku, 'S112-L-1')
    assert.deepEqual(globalThis.__woo, [['lesen', 42]])
  })
  test('abgelehnt: fremde, stornierte, inaktive oder unbekannte Füllung, ungültige Eingaben, Füllung schon vergeben (23505)', async () => {
    for (const [produkt, fuellung, muster] of [
      [42, uuid(5), /gibt es nicht mehr/], [42, uuid(3), /storniert/], [42, uuid(4), /inaktiv/], [42, uuid(99), /gibt es nicht mehr/],
      [42, 'keine-uuid', /Füllung wählen/], [0, F1, /ungültig/], [-3, F1, /ungültig/], ['12abc', F1, /ungültig/],
    ]) {
      mit()
      assert.match((await actions.shopZuordnen(produkt, fuellung)).error ?? '', muster, `${produkt}/${fuellung}`)
      assert.equal(db.tabellen.shop_zuordnungen.length, 0)
      assert.equal(globalThis.__woo.length, 0)
    }
    mit([], { vorher: e => (e.tabelle === 'shop_zuordnungen' && e.art === 'insert' ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "shop_zuordnungen_fuellung_key"' } } : null) })
    assert.match((await actions.shopZuordnen(42, F1)).error, /schon einem anderen Shop-Produkt zugeordnet/)
    assert.equal(globalThis.__woo.length, 0)
  })
  test('Lösen: nur die eigene Zeile, 0 gelöschte Zeilen sind ein Fehler, kein Aufruf des Shops', async () => {
    mit([zeile(42, F1), { ...zeile(42, uuid(5)), id: uuid(777), tenant_id: FREMD }])
    assert.deepEqual(await actions.shopZuordnungLoesen(42), { success: true })
    assert.deepEqual(db.tabellen.shop_zuordnungen.map(z => z.tenant_id), [FREMD])
    assert.match((await actions.shopZuordnungLoesen(42)).error, /Nicht gespeichert/)
    assert.equal(db.tabellen.shop_zuordnungen.length, 1)
    assert.equal(globalThis.__woo.length, 0)
  })
  test('Vorschläge übernehmen: je Zeile wie Einzelzuordnung, Fehler und Hinweise gesammelt, Obergrenze', async () => {
    mit()
    const r = await actions.shopVorschlaegeUebernehmen([{ produktId: 42, fuellungId: F1 }, { produktId: 43, fuellungId: uuid(3) }, { produktId: 44, fuellungId: F2 }])
    assert.equal(r.uebernommen, 2)
    assert.equal(r.fehler.length, 1)
    assert.deepEqual(db.tabellen.shop_zuordnungen.map(z => z.woo_produkt_id).sort(), [42, 44])
    assert.match((await actions.shopVorschlaegeUebernehmen([])).error, /keine Vorschläge/)
    assert.match((await actions.shopVorschlaegeUebernehmen(Array.from({ length: 201 }, (_, i) => ({ produktId: i + 1, fuellungId: F1 })))).error, /höchstens 200/)
  })
  test('SKU erneut schreiben: nur bei bestehender Zuordnung; Ablehnung des Shops ist hier ein Fehler', async () => {
    mit()
    assert.match((await actions.shopSkuErneutSchreiben(42)).error, /keine Zuordnung/)
    mit([zeile(42, F2)])
    assert.deepEqual(await actions.shopSkuErneutSchreiben(42), { success: true })
    assert.match(db.tabellen.shop_zuordnungen[0].woo_sku, /^S112-[0-9A-F]{8}$/)
    mit([zeile(42, F1)])
    globalThis.__skuErgebnis = { ok: false, art: 'sku_vergeben', meldung: 'Diese Artikelnummer ist im Shop schon vergeben.' }
    assert.match((await actions.shopSkuErneutSchreiben(42)).error, /^Die Artikelnummer wurde nicht in den Shop geschrieben: .*schon vergeben/)
  })
})

describe('KAN-461: Seite, Migration und Register', () => {
  test('Seite: Lesebereich, Modul, nur Betriebsleitung; Shop-Fehler zeigt die gespeicherten Zuordnungen', () => {
    const seite = quelle('src/app/(dashboard)/weinhandel/shop/zuordnung/page.tsx')
    const i = s => { const n = seite.indexOf(s); assert.ok(n >= 0, s); return n }
    assert.ok(i("await requireLesen('lager')") < i("await requireModul('modul_shop')"))
    assert.ok(i("await requireModul('modul_shop')") < i("canAdmin(membership.role)) redirect('/dashboard')"))
    assert.match(seite, /else shopFehler = r\.meldung/)
    const client = quelle('src/app/(dashboard)/weinhandel/shop/zuordnung/ZuordnungClient.tsx')
    assert.match(client, /await rueckfrage\(\{ titel: 'Zuordnung lösen\?'/)
    assert.match(client, /finally \{\s*setLaeuft\(null\)/)
    assert.ok(!/from '@\/lib\/shop\/laden'/.test(client.replace(/import type [^\n]+\n/g, '')), 'laden.ts (Schlüssel) nur als Typ im Browser')
    const ladenTs = quelle('src/lib/shop/laden.ts')
    assert.match(ladenTs, /import 'server-only'/)
    assert.match(ladenTs, /\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)\.is\('storniert_am', null\)/)
    assert.equal((ladenTs.match(/alle</g) ?? []).length, 2, 'Füllungen und Zuordnungen vollständig über alle()')
  })
  test('Aktionen: Reihenfolge der Prüfungen; Schreiben mit Betriebsfilter und Zeilenprüfung', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/shop/zuordnung/actions.ts')
    const i = s => { const n = a.indexOf(s); assert.ok(n >= 0, s); return n }
    assert.ok(i('seitenBetriebFehler(membership?.tenantId)') < i('schreibSperreFehler(membership)'))
    assert.ok(i('schreibSperreFehler(membership)') < i('canAdmin(membership.role)'))
    assert.ok(i('canAdmin(membership.role)') < i("hatModul('modul_shop')"))
    assert.match(a, /\.delete\(\)\s+\.eq\('tenant_id', k\.tenantId\)\.eq\('woo_produkt_id', produktId\)\.select\('id'\)/)
    assert.match(a, /if \(data\.length === 0\) return \{ error: NICHT_GESPEICHERT \}/)
  })
  test('Migration: 1:1 je Betrieb, Kaskade von der Füllung, alle Policies, Fremdverweis-Trigger, Index', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(n => /_kan461_shop_zuordnungen\.sql$/.test(n))
    const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan461_shop_zuordnungen.sql')
    assert.ok(existsSync(pfad), 'Migration kan461_shop_zuordnungen fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /fuellung_id\s+uuid NOT NULL REFERENCES public\.fuellungen\(id\) ON DELETE CASCADE/)
    assert.match(sql, /UNIQUE \(tenant_id, woo_produkt_id\)/)
    assert.match(sql, /UNIQUE \(tenant_id, fuellung_id\)/)
    assert.match(sql, /CREATE INDEX shop_zuordnungen_fuellung_idx ON public\.shop_zuordnungen \(fuellung_id\)/)
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.shop_zuordnungen([^;]*);/g)]
    assert.ok(policies.every(p => / TO authenticated\b/.test(p[2])), 'jede Policy TO authenticated')
    assert.deepEqual(policies.map(p => p[1]).sort(), ['abo_schreibsperre_del', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'lesebereich',
      'mitgliedschaft_aktiv', 'paketmodul_del', 'paketmodul_ins', 'paketmodul_upd', 'shop_zuordnungen_delete', 'shop_zuordnungen_insert',
      'shop_zuordnungen_select', 'shop_zuordnungen_update', 'zwei_faktor_aal'])
    assert.equal((sql.match(/user_has_role_in_tenant\(tenant_id, ARRAY\['system_admin', 'tenant_admin'\]\)/g) ?? []).length, 4, 'Schreiben nur Betriebsleitung')
    assert.match(sql, /CREATE POLICY lesebereich ON public\.shop_zuordnungen AS RESTRICTIVE FOR ALL TO authenticated\n\s+USING \(NOT \(tenant_id IN \(SELECT public\.s112_lesegesperrte_tenants\('lager'\)\)\)\)\n\s+WITH CHECK/)
    assert.equal((sql.match(/s112_paketmodul_frei\(tenant_id, 'modul_shop'\)/g) ?? []).length, 4)
    assert.match(sql, /CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public\.shop_zuordnungen/)
    assert.match(sql, /REVOKE ALL ON public\.shop_zuordnungen FROM anon;/)
  })
  test('Register: Lesebereich, Schema, Fremdschlüssel, DB-Test-Sollwerte, Pilot-Abräumen', () => {
    assert.equal(JSON.parse(quelle('scripts/lesebereiche.json')).tabellen.shop_zuordnungen, 'lager')
    assert.deepEqual(JSON.parse(quelle('scripts/schema.json')).shop_zuordnungen,
      ['id', 'tenant_id', 'fuellung_id', 'woo_produkt_id', 'woo_name', 'woo_sku', 'sku_geschrieben_am', 'erstellt_am', 'erstellt_von', 'aktualisiert_am'])
    const fk = JSON.parse(quelle('scripts/fremdschluessel.json')).filter(x => x.t === 'shop_zuordnungen')
    assert.deepEqual(fk.map(x => `${x.s.join(',')}→${x.z}`).sort(), ['fuellung_id→fuellungen', 'tenant_id→tenants'])
    const helfer = quelle('scripts/db-tests/_helfer.sql')
    assert.match(helfer, /\('shop_zuordnungen',\s+'SA,TA',\s+'SA,TA',\s+'SA,TA'\)/)
    assert.match(helfer, /'kostenstellen', 'shop_zuordnungen', 'sumup_checkouts'/)
    const pilot = quelle('scripts/pilot-abraeumen.sql')
    assert.match(pilot, /\('shop_zuordnungen', 'abräumen', NULL, NULL, 'tenant_id'\)/)
    assert.ok(pilot.indexOf('DELETE FROM public.shop_zuordnungen WHERE tenant_id = v_t;') < pilot.indexOf('DELETE FROM public.fuellung_chargen WHERE tenant_id = v_t;'), 'vor den Füllungen')
    assert.equal((quelle('scripts/pilot-abraeumen-export.sql').match(/public\.shop_zuordnungen/g) ?? []).length, 3)
  })
})
