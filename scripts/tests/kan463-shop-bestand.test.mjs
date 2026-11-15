// KAN-463 (15.11.2026): Weinshop-Anbindung S1d – Bestand an WooCommerce übertragen.
// Geprüft wird: Regeln der Warteschlange (Wiederholung), WooCommerce-Client (PUT nur manage_stock/stock_quantity),
// Abarbeitung (letzter Stand, Erfolg/Fehler/Entfernen, neue Änderung während der Übertragung bleibt stehen, Zeitgrenze),
// Aktion „Bestand jetzt übertragen“ (Rechte, Schalter), Cron-Route und Zeitpläne, Migration und Register.
// Die Datenbankseite (Trigger, Mengenrechnung) prüft DB-Test 99_shop_warteschlange gegen Staging.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { naechsterVersuch, laufText, leererLauf, MAX_VERSUCHE, WARTESCHLANGE_JE_LAUF } from '../../src/lib/shop/warteschlangeRegeln.ts'
import { wooBestandSchreiben } from '../../src/lib/shop/woocommerce.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid } from './buchung-attrappe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-463: Regeln der Warteschlange', () => {
  test('Wiederholung nach 10 min, 30 min, 1 h, 3 h, danach alle 6 h', () => {
    const t0 = Date.UTC(2026, 10, 15, 8, 0, 0)
    const min = n => (naechsterVersuch(n, t0).getTime() - t0) / 60_000
    assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 0, -3].map(min), [10, 30, 60, 180, 360, 360, 360, 10, 10])
    assert.equal(MAX_VERSUCHE, 10)
    assert.equal(WARTESCHLANGE_JE_LAUF, 100)
  })
  test('Kurztext für den Systembericht', () => {
    assert.equal(laufText({ ...leererLauf(), geholt: 5, uebertragen: 3, fehler: 1, entfernt: 1 }), 'Shop-Warteschlange: 5 fällig, 3 übertragen, 1 Fehler, 1 entfernt')
    assert.equal(laufText({ ...leererLauf(), geholt: 2, uebertragen: 1, offen: 1 }), 'Shop-Warteschlange: 2 fällig, 1 übertragen, 1 offen (Zeit)')
  })
})

describe('KAN-463: WooCommerce-Client – Bestand schreiben (Attrappe)', () => {
  const zugang = { url: 'https://www.beispiel.at', key: 'ck', secret: 'cs' }
  const aufloesen = async () => ['93.184.216.34']
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  test('PUT nur mit manage_stock und stock_quantity; die Antwort muss die Menge bestätigen', async () => {
    const rufe = []
    const r = await wooBestandSchreiben(zugang, 42, 84, { aufloesen, fetch: async (url, init) => { rufe.push({ url, init }); return json(200, { id: 42, manage_stock: true, stock_quantity: 84 }) } })
    assert.deepEqual(r, { ok: true, daten: { menge: 84 } })
    assert.equal(rufe[0].url, 'https://www.beispiel.at/wp-json/wc/v3/products/42')
    assert.equal(rufe[0].init.method, 'PUT')
    assert.deepEqual(JSON.parse(rufe[0].init.body), { manage_stock: true, stock_quantity: 84 })
    assert.deepEqual(await wooBestandSchreiben(zugang, 42, 0, { aufloesen, fetch: async () => json(200, { id: 42, stock_quantity: 0 }) }), { ok: true, daten: { menge: 0 } })
  })
  test('ungültige Menge ohne Aufruf; Ablehnungen und abweichende Antwort als Fehler', async () => {
    let n = 0
    const zaehlen = async () => { n++; return json(200, {}) }
    for (const menge of [-1, 1.5, NaN, Infinity]) assert.equal((await wooBestandSchreiben(zugang, 42, menge, { aufloesen, fetch: zaehlen })).ok, false, String(menge))
    assert.equal((await wooBestandSchreiben(zugang, 0, 5, { aufloesen, fetch: zaehlen })).art, 'produkt_fehlt')
    assert.equal(n, 0)
    const fall = async antwort => (await wooBestandSchreiben(zugang, 42, 84, { aufloesen, fetch: async () => antwort })).art
    assert.equal(await fall(json(200, { id: 42, stock_quantity: 80 })), 'antwort')
    assert.equal(await fall(json(200, { id: 42, stock_quantity: null })), 'antwort')
    assert.equal(await fall(json(403, { code: 'woocommerce_rest_cannot_edit' })), 'schreibrecht')
    assert.equal(await fall(json(404, { code: 'woocommerce_rest_product_invalid_id' })), 'produkt_fehlt')
  })
})

// ── Abarbeitung und Aktion ───────────────────────────────────────────────────────────────────────────────────────────
const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const seitenBetriebFehler = async () => globalThis.__betriebFehler ?? null')
DOPPEL['@/lib/auth/sperren'] = modul('export const schreibSperreFehler = async () => globalThis.__sperreFehler ?? null')
DOPPEL['@/lib/auth/modul'] = modul('export const hatModul = async f => (globalThis.__module ?? []).includes(f); export const modulAusMeldung = f => "Modul aus: " + f')
DOPPEL['@/lib/shop/laden'] = modul('export const shopZugangLaden = async t => globalThis.__zugang?.[t] ?? globalThis.__zugang?.alle')
DOPPEL['@/lib/shop/woocommerce'] = modul(`
  const ruf = (art, id, wert) => { (globalThis.__woo ??= []).push([art, id, wert]) }
  export const wooProduktLesen = async (z, id) => { ruf('lesen', id); return globalThis.__produkt?.[id] ?? { ok: true, daten: { id, name: 'P' + id, sku: null, status: 'publish', typ: 'simple' } } }
  export const wooBestandSchreiben = async (z, id, menge) => { ruf('bestand', id, menge); if (globalThis.__waehrend) await globalThis.__waehrend(id); return globalThis.__bestandErgebnis?.[id] ?? { ok: true, daten: { menge } } }
  export const wooMetaSchreiben = async (z, id, felder) => { ruf('meta', id, felder.length); return globalThis.__metaErgebnis?.[id] ?? { ok: true, daten: { felder: felder.length } } }
  export const wooSkuSchreiben = async () => ({ ok: false, art: 'antwort', meldung: 'nicht erwartet' })`)
DOPPEL['@/lib/shop/weindatenLaden'] = modul(`
  export const ladeElabelKatalog = async () => { globalThis.__katalogRufe = (globalThis.__katalogRufe ?? 0) + 1; return [] }
  export const ladeWeindaten = async (db, tenant, fuellung) => globalThis.__weindaten?.[fuellung] ?? null`)
DOPPEL['@/lib/datum/wien'] = modul("export const heuteWien = () => '2026-11-15'")
hooksRegistrieren()
const ws = hooksMoeglich ? await laden('lib/shop/warteschlange.ts') : null
const actions = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/shop/zuordnung/actions.ts') : null

const T = uuid(900), T2 = uuid(901), F1 = uuid(1), F2 = uuid(2), F3 = uuid(3)
const JETZT = Date.UTC(2026, 10, 15, 8, 0, 0)
const frueher = new Date(JETZT - 60_000).toISOString()
const WEIN = { jahrgang: 2025, rebsorte: 'Zierfandler', ried: null, herkunft: null, qualitaet: null, alkoholVol: 12.5, restzuckerGl: null, saeureGl: null, allergene: [], energieKj: null, energieKcal: null, elabelUrl: null }
const eintrag = (n, fuellung, art = 'bestand', mehr = {}) => ({ id: uuid(700 + n), tenant_id: T, fuellung_id: fuellung, art, eingereiht_am: frueher, versuche: 0, naechster_versuch_am: frueher, letzter_fehler: null, ...mehr })
const zuordnung = (produkt, fuellung, mehr = {}) => ({ id: uuid(500 + produkt), tenant_id: T, woo_produkt_id: produkt, fuellung_id: fuellung, bestand_menge: null, bestand_am: null, bestand_fehler: null,
  weindaten_am: null, weindaten_pruefsumme: null, weindaten_fehler: null, ...mehr })
const einst = (tenant = T, mehr = {}) => ({ tenant_id: tenant, modul_shop: true, shop_bestand_uebertragen: true, ...mehr })

describe('KAN-463: Warteschlange abarbeiten', nurMitHooks, () => {
  let db
  const mit = (tabellen, mengen = {}) => {
    db = datenbank({ shop_warteschlange: [], shop_zuordnungen: [], tenant_einstellungen: [einst()], ...tabellen },
      { rpc: (name, args) => (name === 's112_shop_bestand' ? { data: mengen[args.p_fuellung_id] ?? null, error: mengen.fehler ?? null } : { data: null, error: { message: 'unbekannt' } }) })
    return db
  }
  const schlange = () => db.tabellen.shop_warteschlange
  const z = produkt => db.tabellen.shop_zuordnungen.find(x => x.woo_produkt_id === produkt)
  beforeEach(() => {
    globalThis.__zugang = { alle: { ok: true, zugang: { url: 'https://www.beispiel.at', key: 'ck', secret: 'cs' } } }
    globalThis.__woo = []; globalThis.__produkt = {}; globalThis.__bestandErgebnis = {}; globalThis.__metaErgebnis = {}
    globalThis.__weindaten = { [F2]: WEIN }; globalThis.__waehrend = null; globalThis.__katalogRufe = 0
  })

  test('Bestand: Menge jetzt gerechnet, an den Shop gemeldet, Stand an der Zuordnung, Eintrag entfernt', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1)], shop_zuordnungen: [zuordnung(42, F1, { bestand_fehler: 'alt' })] }, { [F1]: 84 })
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.deepEqual({ ...lauf }, { geholt: 1, uebertragen: 1, fehler: 0, entfernt: 0, offen: 0, meldungen: [] })
    assert.deepEqual(globalThis.__woo, [['lesen', 42, undefined], ['bestand', 42, 84]])
    assert.equal(z(42).bestand_menge, 84); assert.ok(z(42).bestand_am); assert.equal(z(42).bestand_fehler, null)
    assert.equal(schlange().length, 0)
    assert.ok(db.aufrufe.some(a => a.tabelle === 'rpc:s112_shop_bestand' && a.werte.p_fuellung_id === F1))
  })
  test('Weindaten in derselben Warteschlange: Meta-Felder, Prüfsumme gespeichert; Katalog einmal je Lauf', async () => {
    mit({ shop_warteschlange: [eintrag(1, F2, 'weindaten'), eintrag(2, F1)], shop_zuordnungen: [zuordnung(43, F2), zuordnung(42, F1)] }, { [F1]: 7 })
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.equal(lauf.uebertragen, 2)
    assert.deepEqual(globalThis.__woo.filter(r => r[0] === 'meta').map(r => r[1]), [43])
    assert.match(z(43).weindaten_pruefsumme, /^[0-9a-f]{32}$/); assert.ok(z(43).weindaten_am)
    assert.equal(z(42).bestand_menge, 7)
    assert.equal(globalThis.__katalogRufe, 1)
  })
  test('Fehler des Shops: Versuch gezählt, nächster Versuch geplant, Meldung an Eintrag und Zuordnung; voriger Stand bleibt', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1, 'bestand', { versuche: 2 })], shop_zuordnungen: [zuordnung(42, F1, { bestand_menge: 50, bestand_am: '2026-11-14T08:00:00.000Z' })] }, { [F1]: 84 })
    globalThis.__bestandErgebnis = { 42: { ok: false, art: 'schreibrecht', meldung: 'Der Schlüssel darf im Shop nicht schreiben.' } }
    const vor = Date.now()
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.deepEqual([lauf.uebertragen, lauf.fehler, lauf.meldungen], [0, 1, ['Der Schlüssel darf im Shop nicht schreiben.']])
    const [e] = schlange()
    assert.equal(e.versuche, 3); assert.equal(e.letzter_fehler, 'Der Schlüssel darf im Shop nicht schreiben.')
    const abstandMin = (new Date(e.naechster_versuch_am).getTime() - vor) / 60_000
    assert.ok(abstandMin > 59 && abstandMin < 61, `dritter Fehlversuch → 1 h (${abstandMin})`)
    assert.equal(z(42).bestand_fehler, 'Der Schlüssel darf im Shop nicht schreiben.')
    assert.equal(z(42).bestand_menge, 50); assert.equal(z(42).bestand_am, '2026-11-14T08:00:00.000Z')
  })
  test('nicht fällig oder zu viele Versuche: bleibt liegen, kein Aufruf des Shops', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1, 'bestand', { naechster_versuch_am: new Date(JETZT + 60_000).toISOString() }), eintrag(2, F2, 'bestand', { versuche: 10 })],
      shop_zuordnungen: [zuordnung(42, F1), zuordnung(43, F2)] }, { [F1]: 1, [F2]: 1 })
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.equal(lauf.geholt, 0); assert.equal(schlange().length, 2); assert.equal(globalThis.__woo.length, 0)
  })
  test('ohne Übertragung entfernt: Zuordnung gelöst, Modul aus, Schalter aus (nur Bestand), Füllung fehlt', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1)], shop_zuordnungen: [] }, { [F1]: 5 })
    assert.deepEqual([(await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })).entfernt, schlange().length], [1, 0])
    mit({ shop_warteschlange: [eintrag(1, F1), eintrag(2, F2, 'weindaten')], shop_zuordnungen: [zuordnung(42, F1), zuordnung(43, F2)], tenant_einstellungen: [einst(T, { modul_shop: false })] }, { [F1]: 5 })
    assert.deepEqual([(await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })).entfernt, schlange().length], [2, 0])
    mit({ shop_warteschlange: [eintrag(1, F1), eintrag(2, F2, 'weindaten')], shop_zuordnungen: [zuordnung(42, F1), zuordnung(43, F2)], tenant_einstellungen: [einst(T, { shop_bestand_uebertragen: false })] }, { [F1]: 5 })
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.deepEqual([lauf.entfernt, lauf.uebertragen, schlange().length], [1, 1, 0])
    mit({ shop_warteschlange: [eintrag(1, F3)], shop_zuordnungen: [zuordnung(44, F3)] }, {})
    assert.deepEqual([(await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })).entfernt, schlange().length], [1, 0])
    assert.equal(globalThis.__woo.length, 1, 'nur die Weindaten des dritten Falls gingen an den Shop')
  })
  test('neue Änderung während der Übertragung: der Eintrag bleibt für den nächsten Lauf stehen', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1)], shop_zuordnungen: [zuordnung(42, F1)] }, { [F1]: 84 })
    globalThis.__waehrend = async () => { schlange()[0].eingereiht_am = new Date(JETZT).toISOString() }   // Trigger hat neu eingereiht
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.equal(lauf.uebertragen, 1)
    assert.equal(schlange().length, 1, 'nicht entfernt – die neuere Änderung wird beim nächsten Lauf übertragen')
    assert.equal(z(42).bestand_menge, 84)
  })
  test('Produkt mit Varianten: kein Schreiben, Fehler an der Zuordnung', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1)], shop_zuordnungen: [zuordnung(42, F1)] }, { [F1]: 84 })
    globalThis.__produkt = { 42: { ok: true, daten: { id: 42, name: 'Kiste', sku: null, status: 'publish', typ: 'variable' } } }
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.equal(lauf.fehler, 1); assert.match(z(42).bestand_fehler, /Typ „variable“/)
    assert.ok(!globalThis.__woo.some(r => r[0] === 'bestand'))
  })
  test('je Betrieb getrennt: fehlende Zugangsdaten eines Betriebs halten den anderen nicht auf', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1), { ...eintrag(2, F2), tenant_id: T2 }],
      shop_zuordnungen: [zuordnung(42, F1), { ...zuordnung(43, F2), id: uuid(777), tenant_id: T2 }], tenant_einstellungen: [einst(T), einst(T2)] }, { [F1]: 5, [F2]: 9 })
    globalThis.__zugang = { [T]: { ok: false, meldung: 'Bitte zuerst die Shop-Adresse speichern.' }, [T2]: { ok: true, zugang: {} } }
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT })
    assert.deepEqual([lauf.geholt, lauf.uebertragen, lauf.fehler], [2, 1, 1])
    assert.equal(z(42).bestand_fehler, 'Bitte zuerst die Shop-Adresse speichern.')
    assert.equal(z(43).bestand_menge, 9)
    assert.deepEqual(globalThis.__woo.filter(r => r[0] === 'bestand'), [['bestand', 43, 9]])
  })
  test('Zeitgrenze: nicht begonnene Einträge bleiben offen; Lesefehler der Warteschlange wirft', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1), eintrag(2, F2)], shop_zuordnungen: [zuordnung(42, F1), zuordnung(43, F2)] }, { [F1]: 1, [F2]: 2 })
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT, budgetMs: -1 })
    assert.deepEqual([lauf.geholt, lauf.uebertragen, lauf.offen, schlange().length], [2, 0, 2, 2])
    const kaputt = datenbank({ shop_warteschlange: [] }, { vorher: () => ({ error: { message: 'weg' } }) })
    await assert.rejects(ws.warteschlangeAbarbeiten(kaputt, { jetztMs: JETZT }), /Shop-Warteschlange konnte nicht gelesen werden/)
  })
  test('„nur“: genau dieser Eintrag, auch wenn er noch nicht fällig ist', async () => {
    mit({ shop_warteschlange: [eintrag(1, F1, 'bestand', { naechster_versuch_am: new Date(JETZT + 3_600_000).toISOString(), versuche: 10 }), eintrag(2, F2)],
      shop_zuordnungen: [zuordnung(42, F1), zuordnung(43, F2)] }, { [F1]: 11, [F2]: 22 })
    const lauf = await ws.warteschlangeAbarbeiten(db, { jetztMs: JETZT, nur: { tenantId: T, fuellungId: F1, art: 'bestand' } })
    assert.deepEqual([lauf.geholt, lauf.uebertragen], [1, 1])
    assert.equal(z(42).bestand_menge, 11); assert.equal(z(43).bestand_menge, null)
    assert.deepEqual(schlange().map(e => e.fuellung_id), [F2])
  })
})

describe('KAN-463: Aktion „Bestand jetzt übertragen“', nurMitHooks, () => {
  let db
  const mit = (tabellen, mengen = {}) => {
    db = datenbank({ shop_warteschlange: [], shop_zuordnungen: [zuordnung(42, F1)], tenant_einstellungen: [einst()], ...tabellen },
      { rpc: (name, args) => ({ data: mengen[args.p_fuellung_id] ?? null, error: null }) })
    // die Attrappe kennt kein upsert: wie ON CONFLICT (tenant_id, fuellung_id, art) nachgebildet
    const from = db.from.bind(db)
    db.from = t => {
      const q = from(t)
      q.upsert = async werte => {
        const liste = db.tabellen[t]
        const i = liste.findIndex(x => x.tenant_id === werte.tenant_id && x.fuellung_id === werte.fuellung_id && x.art === werte.art)
        if (i >= 0) liste[i] = { ...liste[i], ...werte }; else liste.push({ id: uuid(800 + liste.length), ...werte })
        return { error: null }
      }
      return q
    }
    globalThis.__serverFake = db; globalThis.__adminFake = db
    return db
  }
  beforeEach(() => {
    globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
    globalThis.__module = ['modul_shop']; globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
    globalThis.__zugang = { alle: { ok: true, zugang: {} } }
    globalThis.__woo = []; globalThis.__produkt = {}; globalThis.__bestandErgebnis = {}; globalThis.__waehrend = null
  })
  test('abgelehnt vor jedem Zugriff: Mitarbeiter, Modul aus, Nur-Lesen', async () => {
    for (const [einstellen, muster] of [
      [() => { globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] } }, /Betriebsleitung/],
      [() => { globalThis.__module = [] }, /Modul aus: modul_shop/],
      [() => { globalThis.__sperreFehler = 'Nur-Lesen-Modus' }, /Nur-Lesen/],
    ]) {
      globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }; globalThis.__module = ['modul_shop']; globalThis.__sperreFehler = null
      einstellen(); mit({}, { [F1]: 5 })
      assert.match((await actions.shopBestandJetzt(42)).error ?? '', muster)
      assert.equal(db.aufrufe.length, 0); assert.equal(globalThis.__woo.length, 0)
    }
  })
  test('eingereiht und sofort übertragen; Schalter aus, fehlende Zuordnung und Ablehnung des Shops als Fehler', async () => {
    mit({}, { [F1]: 84 })
    assert.deepEqual(await actions.shopBestandJetzt(42), { success: true, menge: 84 })
    assert.equal(db.tabellen.shop_warteschlange.length, 0)
    assert.deepEqual(globalThis.__woo.filter(r => r[0] === 'bestand'), [['bestand', 42, 84]])

    mit({ tenant_einstellungen: [einst(T, { shop_bestand_uebertragen: false })] }, { [F1]: 84 })
    assert.match((await actions.shopBestandJetzt(42)).error, /Bestandsübertragung ist ausgeschaltet/)
    assert.equal(db.tabellen.shop_warteschlange.length, 0)

    mit({}, { [F1]: 84 })
    assert.match((await actions.shopBestandJetzt(99)).error, /keine Zuordnung/)

    mit({}, { [F1]: 84 })
    globalThis.__bestandErgebnis = { 42: { ok: false, art: 'nicht_erreichbar', meldung: 'Der Shop ist nicht erreichbar.' } }
    assert.deepEqual(await actions.shopBestandJetzt(42), { error: 'Der Shop ist nicht erreichbar.' })
    assert.equal(db.tabellen.shop_warteschlange.length, 1, 'bleibt für den Cron eingereiht')
    assert.equal(db.tabellen.shop_warteschlange[0].versuche, 1)
  })
})

describe('KAN-463: Cron, Oberfläche, Migration, Register', () => {
  test('Zeitpläne in vercel.json: alle 10 Minuten und täglicher Abgleich – kein GitHub-Zeitplan', () => {
    const crons = JSON.parse(quelle('vercel.json')).crons
    assert.deepEqual(crons.filter(c => c.path.startsWith('/api/cron/shop')), [
      { path: '/api/cron/shop', schedule: '*/10 * * * *' }, { path: '/api/cron/shop?abgleich=1', schedule: '25 4 * * *' }])
  })
  test('Cron-Route: nur mit Secret, Ausnahme begründet, Abgleich nur auf Wunsch, Ereignis nur bei Arbeit oder Fehler', () => {
    const r = quelle('src/app/api/cron/shop/route.ts')
    assert.match(r, /\/\/ zwei-faktor-ausnahme: nur mit Authorization: Bearer CRON_SECRET erreichbar/)
    assert.match(r, /if \(req\.headers\.get\('authorization'\) !== `Bearer \$\{cronSecret\}`\) return NextResponse\.json\(\{ fehler: 'Unauthorized' \}, \{ status: 401 \}\)/)
    assert.match(r, /if \(req\.nextUrl\.searchParams\.get\('abgleich'\) === '1'\)/)
    assert.match(r, /if \(lauf\.uebertragen > 0 \|\| lauf\.fehler > 0 \|\| lauf\.offen > 0 \|\| \(eingereiht \?\? 0\) > 0\)/)
    assert.match(r, /status: 500/)
    assert.equal((r.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? []).length, 1)
  })
  test('Abarbeitung: nur serverseitig, Erfolg entfernt nur den unveränderten Eintrag', () => {
    const w = quelle('src/lib/shop/warteschlange.ts')
    assert.match(w, /import 'server-only'/)
    assert.match(w, /if \(nurUnveraendert\) q = q\.eq\('eingereiht_am', e\.eingereiht_am\)/)
    assert.match(w, /\.lte\('naechster_versuch_am', new Date\(jetztMs\)\.toISOString\(\)\)\.lt\('versuche', MAX_VERSUCHE\)/)
    assert.match(w, /\.limit\(WARTESCHLANGE_JE_LAUF\)/)
  })
  test('Oberfläche: Spalte nur mit Schalter; Hinweis am Schalter (Entscheidung 1A)', () => {
    const client = quelle('src/app/(dashboard)/weinhandel/shop/zuordnung/ZuordnungClient.tsx')
    assert.match(client, /\{bestandAn && <th className="px-3 py-2 font-medium">Bestand im Shop<\/th>\}/)
    assert.match(client, /'Bestand jetzt übertragen'/)
    const hinweis = quelle('src/app/(dashboard)/weinhandel/shop/ShopEinstellungen.tsx')
    assert.match(hinweis, /Erst einschalten, wenn Shop-Bestellungen in software:112 ankommen oder zeitnah nachgebucht werden/)
  })
  test('Migration: Warteschlange nur lesbar, Funktionen nicht für Benutzer, Trigger an allen Bestandswegen', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(n => /_kan463_shop_warteschlange\.sql$/.test(n))
    const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan463_shop_warteschlange.sql')
    assert.ok(existsSync(pfad), 'Migration kan463_shop_warteschlange fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /REVOKE ALL ON public\.shop_warteschlange FROM PUBLIC, anon, authenticated;\nGRANT SELECT ON public\.shop_warteschlange TO authenticated;/)
    assert.match(sql, /UNIQUE \(tenant_id, fuellung_id, art\)/)
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.shop_warteschlange([^;]*);/g)]
    assert.ok(policies.every(p => / TO authenticated\b/.test(p[2])))
    assert.deepEqual(policies.map(p => p[1]).sort(), ['abo_schreibsperre_del', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'lesebereich', 'mitgliedschaft_aktiv', 'shop_warteschlange_select', 'zwei_faktor_aal'])
    const funktionen = [...sql.matchAll(/CREATE FUNCTION public\.(s112_shop_\w+)\(([^)]*)\)/g)].map(m => m[1])
    assert.equal(funktionen.length, 9)
    for (const f of funktionen) assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`), f)
    assert.equal((sql.match(/SECURITY DEFINER\nSET search_path = public/g) ?? []).length, 9)
    const trigger = [...sql.matchAll(/CREATE TRIGGER zz_shop_einreihen AFTER [^;]*?ON public\.(\w+)/g)].map(m => m[1]).sort()
    assert.deepEqual(trigger, ['auftraege', 'auftrag_positionen', 'elabels', 'fuellungen', 'shop_zuordnungen', 'tenant_einstellungen'])
    assert.match(sql, /GREATEST\(0,/)
    assert.match(sql, /e\.modul_shop AND \(p_art <> 'bestand' OR e\.shop_bestand_uebertragen\)/)
  })
  test('Register: Lesebereich, Schema, Fremdschlüssel, DB-Test-Sollwerte, Pilot-Abräumen', () => {
    assert.equal(JSON.parse(quelle('scripts/lesebereiche.json')).tabellen.shop_warteschlange, 'lager')
    const schema = JSON.parse(quelle('scripts/schema.json'))
    assert.deepEqual(schema.shop_warteschlange, ['id', 'tenant_id', 'fuellung_id', 'art', 'eingereiht_am', 'versuche', 'naechster_versuch_am', 'letzter_fehler'])
    assert.deepEqual(schema.shop_zuordnungen.slice(-3), ['bestand_menge', 'bestand_am', 'bestand_fehler'])
    assert.deepEqual(JSON.parse(quelle('scripts/fremdschluessel.json')).filter(x => x.t === 'shop_warteschlange').map(x => x.z).sort(), ['fuellungen', 'tenants'])
    const helfer = quelle('scripts/db-tests/_helfer.sql')
    assert.match(helfer, /\('shop_warteschlange',\s+'-',\s+'-',\s+'-'\)/)
    assert.match(helfer, /'s112_shop_einreihen\(p_tenant_id uuid, p_fuellung_id uuid, p_art text\)'/)
    const pilot = quelle('scripts/pilot-abraeumen.sql')
    assert.match(pilot, /\('shop_warteschlange', 'abräumen', NULL, NULL, 'tenant_id'\)/)
    assert.ok(pilot.indexOf('DELETE FROM public.shop_warteschlange WHERE tenant_id = v_t;') < pilot.indexOf('DELETE FROM public.shop_zuordnungen WHERE tenant_id = v_t;'))
    assert.ok(existsSync(path.join(WURZEL, 'scripts', 'db-tests', '99_shop_warteschlange.sql')))
  })
})
