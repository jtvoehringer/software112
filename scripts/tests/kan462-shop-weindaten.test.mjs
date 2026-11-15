// KAN-462 (15.11.2026): Weinshop-Anbindung S1c – Weindaten an WooCommerce übertragen.
// Geprüft wird: Meta-Felder (nur s112_*, fehlende Werte leer statt 0), fertiger Block (maskiert, ohne Skripte),
// Prüfsumme und Stand, Ried-Regel, WooCommerce-Client (PUT nur meta_data), Server Actions (Rechte, letzter Stand,
// Fehler je Produkt), gemeinsame Spalten mit der öffentlichen E-Label-Seite, Migration.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { weindatenMeta, weindatenHtml, weindatenPruefsumme, weindatenStand, weindatenZeilen, einzigeRied, htmlMaskiert, META_HTML, META_STAND } from '../../src/lib/shop/weindaten.ts'
import { wooMetaSchreiben } from '../../src/lib/shop/woocommerce.ts'
import { ELABEL_INHALT_SPALTEN, ELABEL_FUELLUNG_SPALTEN, ELABEL_KATALOG_SPALTEN } from '../../src/lib/elabel/spalten.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, uuid } from './buchung-attrappe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

const VOLL = { jahrgang: 2025, rebsorte: 'Zierfandler', ried: 'Modler', herkunft: 'Thermenregion', qualitaet: 'Qualitätswein DAC',
  alkoholVol: 12.5, restzuckerGl: 1.2, saeureGl: 5.4, allergene: ['Sulfite'], energieKj: 301, energieKcal: 72, elabelUrl: 'https://e.beispiel.at/ABCDEFGH23' }
const LEER = { jahrgang: null, rebsorte: null, ried: null, herkunft: null, qualitaet: null, alkoholVol: null, restzuckerGl: null, saeureGl: null,
  allergene: [], energieKj: null, energieKcal: null, elabelUrl: null }

describe('KAN-462: Meta-Felder und Block', () => {
  test('alle Felder mit dem Präfix s112_, Zahlen maschinenlesbar, Stand = Tag der Übertragung', () => {
    const m = weindatenMeta(VOLL, '2026-11-15')
    assert.ok(m.every(f => /^s112_[a-z0-9_]+$/.test(f.key) && typeof f.value === 'string'))
    assert.equal(new Set(m.map(f => f.key)).size, m.length)
    const wert = k => m.find(f => f.key === k).value
    assert.deepEqual(m.map(f => f.key), ['s112_jahrgang', 's112_rebsorte', 's112_ried', 's112_herkunft', 's112_qualitaet', 's112_alkohol_vol', 's112_restzucker_gl',
      's112_saeure_gl', 's112_allergene', 's112_energie_kj', 's112_energie_kcal', 's112_elabel_url', 's112_weindaten_html', 's112_stand'])
    assert.deepEqual([wert('s112_jahrgang'), wert('s112_alkohol_vol'), wert('s112_restzucker_gl'), wert('s112_allergene'), wert('s112_energie_kj'), wert('s112_stand')],
      ['2025', '12.5', '1.2', 'Sulfite', '301', '2026-11-15'])
    assert.equal(wert('s112_elabel_url'), 'https://e.beispiel.at/ABCDEFGH23')
  })
  test('fehlende Werte: Feld geleert, nie 0; echte 0 bleibt 0; Link nur mit https', () => {
    const m = weindatenMeta(LEER, '2026-11-15')
    assert.ok(m.filter(f => f.key !== META_STAND).every(f => f.value === ''), 'ohne Daten sind alle Felder leer – auch der Block')
    const null0 = weindatenMeta({ ...LEER, restzuckerGl: 0 }, '2026-11-15')
    assert.equal(null0.find(f => f.key === 's112_restzucker_gl').value, '0')
    assert.match(weindatenHtml({ ...LEER, restzuckerGl: 0 }), /Restzucker<\/th><td>0 g\/l/)
    assert.equal(weindatenMeta({ ...LEER, elabelUrl: 'javascript:alert(1)' }, 'x').find(f => f.key === 's112_elabel_url').value, '')
    assert.equal(weindatenHtml({ ...LEER, elabelUrl: 'http://unsicher.at/x' }), '')
  })
  test('Block: Dezimalkomma, nur vorhandene Zeilen, Allergene hervorgehoben, Link aufs E-Label', () => {
    const h = weindatenHtml(VOLL)
    assert.match(h, /^<div class="s112-weindaten"><table class="s112-weindaten-tabelle"><tbody>/)
    assert.match(h, /<th scope="row">Alkohol<\/th><td>12,5 % vol<\/td>/)
    assert.match(h, /<th scope="row">Brennwert je 100 ml<\/th><td>301 kJ \/ 72 kcal<\/td>/)
    assert.match(h, /Enthält <strong>Sulfite<\/strong>/)
    assert.match(h, /<a href="https:\/\/e\.beispiel\.at\/ABCDEFGH23" rel="noopener">Nährwerte und Zutaten<\/a>/)
    assert.deepEqual(weindatenZeilen({ ...LEER, jahrgang: 2024, energieKj: 300 }).map(z => z.name), ['Jahrgang'], 'Brennwert nur mit kJ und kcal')
  })
  test('Werte werden maskiert – kein HTML und kein Skript aus den Stammdaten', () => {
    const h = weindatenHtml({ ...LEER, rebsorte: '<script>alert(1)</script>', ried: 'Ried "A" & B', allergene: ['<b>Ei</b>'], elabelUrl: 'https://e.at/x"onmouseover="y' })
    assert.ok(!/<script|<b>|onmouseover="y/.test(h), h)
    assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(h, /Ried &quot;A&quot; &amp; B/)
    assert.equal(htmlMaskiert(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;')
  })
  test('Prüfsumme: 32 Hex-Zeichen, unabhängig vom Tag, ändert sich mit dem Inhalt; Stand daraus', () => {
    const p = weindatenPruefsumme(VOLL)
    assert.match(p, /^[0-9a-f]{32}$/)
    assert.equal(weindatenPruefsumme({ ...VOLL }), p)
    assert.notEqual(weindatenPruefsumme({ ...VOLL, alkoholVol: 13 }), p)
    assert.notEqual(weindatenPruefsumme({ ...VOLL, allergene: [] }), p)
    const z = (am, summe, fehler = null) => ({ weindaten_am: am, weindaten_pruefsumme: summe, weindaten_fehler: fehler })
    assert.equal(weindatenStand(z(null, null), p), 'nie')
    assert.equal(weindatenStand(z('2026-11-15T10:00:00Z', p), p), 'aktuell')
    assert.equal(weindatenStand(z('2026-11-15T10:00:00Z', p), weindatenPruefsumme({ ...VOLL, saeureGl: 6 })), 'geaendert')
    assert.equal(weindatenStand(z('2026-11-15T10:00:00Z', p), null), 'aktuell', 'ohne heutigen Inhalt nur der gespeicherte Stand')
    assert.equal(weindatenStand(z('2026-11-15T10:00:00Z', p, 'Shop nicht erreichbar'), p), 'fehler')
  })
  test('Ried nur, wenn die Füllung ganz aus einer Ried stammt', () => {
    assert.equal(einzigeRied([{ weingarten_name: 'Modler', anteil_pct: 60 }, { weingarten_name: ' Modler ', anteil_pct: 40 }]), 'Modler')
    assert.equal(einzigeRied([{ weingarten_name: 'Modler', anteil_pct: 85 }, { weingarten_name: 'Wiege', anteil_pct: 15 }]), null)
    assert.equal(einzigeRied([{ weingarten_name: 'Modler', anteil_pct: 90 }, { weingarten_name: null, anteil_pct: 10 }]), null)
    assert.equal(einzigeRied([{ weingarten_name: 'Modler', anteil_pct: 100 }, { weingarten_name: 'Wiege', anteil_pct: 0 }]), 'Modler')
    assert.equal(einzigeRied([]), null)
    assert.equal(einzigeRied([{ weingarten_name: null, anteil_pct: 100 }]), null)
  })
})

describe('KAN-462: WooCommerce-Client – Meta-Felder schreiben (Attrappe)', () => {
  const zugang = { url: 'https://www.beispiel.at', key: 'ck', secret: 'cs' }
  const aufloesen = async () => ['93.184.216.34']
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  test('PUT nur mit meta_data – kein Titel, kein Text, keine Attribute', async () => {
    const rufe = []
    const felder = weindatenMeta(VOLL, '2026-11-15')
    const r = await wooMetaSchreiben(zugang, 42, felder, { aufloesen, fetch: async (url, init) => { rufe.push({ url, init }); return json(200, { id: 42 }) } })
    assert.deepEqual(r, { ok: true, daten: { felder: 14 } })
    assert.equal(rufe[0].url, 'https://www.beispiel.at/wp-json/wc/v3/products/42')
    assert.equal(rufe[0].init.method, 'PUT')
    const body = JSON.parse(rufe[0].init.body)
    assert.deepEqual(Object.keys(body), ['meta_data'])
    assert.deepEqual(body.meta_data, felder)
  })
  test('fremde Feldnamen werden abgelehnt, bevor der Shop aufgerufen wird; Ablehnungen des Shops übersetzt', async () => {
    let n = 0
    const zaehlen = async () => { n++; return json(200, { id: 42 }) }
    for (const felder of [[{ key: 'name', value: 'x' }], [{ key: '_price', value: '1' }], [{ key: 's112_ok', value: 'x' }, { key: 'description', value: 'y' }],
      [{ key: 's112_GROSS', value: 'x' }], [{ key: 's112_zahl', value: 5 }], []]) {
      assert.equal((await wooMetaSchreiben(zugang, 42, felder, { aufloesen, fetch: zaehlen })).ok, false, JSON.stringify(felder))
    }
    assert.equal(n, 0)
    const fall = async antwort => (await wooMetaSchreiben(zugang, 42, [{ key: 's112_jahrgang', value: '2025' }], { aufloesen, fetch: async () => antwort })).art
    assert.equal(await fall(json(403, { code: 'woocommerce_rest_cannot_edit' })), 'schreibrecht')
    assert.equal(await fall(json(404, { code: 'woocommerce_rest_product_invalid_id' })), 'produkt_fehlt')
    assert.equal(await fall(json(200, { id: 43 })), 'antwort')
  })
})

// ── Server Actions ───────────────────────────────────────────────────────────────────────────────────────────────────
const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const seitenBetriebFehler = async () => globalThis.__betriebFehler ?? null')
DOPPEL['@/lib/auth/sperren'] = modul('export const schreibSperreFehler = async () => globalThis.__sperreFehler ?? null')
DOPPEL['@/lib/auth/modul'] = modul('export const hatModul = async f => (globalThis.__module ?? []).includes(f); export const modulAusMeldung = f => "Modul aus: " + f')
DOPPEL['@/lib/shop/laden'] = modul('export const shopZugangLaden = async () => globalThis.__zugang')
DOPPEL['@/lib/shop/woocommerce'] = modul(`
  export const wooProduktLesen = async () => ({ ok: false, art: 'antwort', meldung: 'nicht erwartet' })
  export const wooSkuSchreiben = async () => ({ ok: false, art: 'antwort', meldung: 'nicht erwartet' })
  export const wooMetaSchreiben = async (z, id, felder) => { (globalThis.__meta ??= []).push([id, felder]); const e = globalThis.__metaErgebnis?.[id]; return e ?? { ok: true, daten: { felder: felder.length } } }`)
DOPPEL['@/lib/shop/weindatenLaden'] = modul(`
  export const ladeElabelKatalog = async () => { globalThis.__katalogRufe = (globalThis.__katalogRufe ?? 0) + 1; return [] }
  export const ladeWeindaten = async (db, tenant, fuellung) => { (globalThis.__geladen ??= []).push([tenant, fuellung]); const d = globalThis.__weindaten[fuellung]; if (d instanceof Error) throw d; return d ?? null }`)
DOPPEL['@/lib/datum/wien'] = modul("export const heuteWien = () => '2026-11-15'")
// KAN-463: „Bestand jetzt übertragen“ liegt in derselben Aktionen-Datei – hier nicht geprüft (kan463-shop-bestand.test.mjs)
DOPPEL['@/lib/shop/warteschlange'] = modul('export const warteschlangeAbarbeiten = async () => ({ geholt: 0, uebertragen: 0, fehler: 0, entfernt: 0, offen: 0, meldungen: [] })')
hooksRegistrieren()
const actions = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/shop/zuordnung/actions.ts') : null

const T = uuid(900), F1 = uuid(1), F2 = uuid(2), F3 = uuid(3)
const zeile = (produkt, fuellung, mehr = {}) => ({ id: uuid(500 + produkt), tenant_id: T, woo_produkt_id: produkt, fuellung_id: fuellung,
  weindaten_am: null, weindaten_pruefsumme: null, weindaten_fehler: null, ...mehr })

describe('KAN-462: Server Actions der Weindaten', nurMitHooks, () => {
  let db
  const mit = zuordnungen => { db = datenbank({ shop_zuordnungen: zuordnungen }); globalThis.__serverFake = db; return db }
  const je = produkt => db.tabellen.shop_zuordnungen.find(z => z.woo_produkt_id === produkt && z.tenant_id === T)
  beforeEach(() => {
    globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
    globalThis.__module = ['modul_shop']
    globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
    globalThis.__zugang = { ok: true, zugang: { url: 'https://www.beispiel.at', key: 'ck', secret: 'cs' } }
    globalThis.__meta = []; globalThis.__geladen = []; globalThis.__metaErgebnis = {}; globalThis.__katalogRufe = 0
    globalThis.__weindaten = { [F1]: VOLL, [F2]: { ...VOLL, jahrgang: 2024 } }
  })

  test('abgelehnt vor jedem Zugriff: Mitarbeiter, Modul aus, Nur-Lesen, anderer Betrieb', async () => {
    for (const [einstellen, muster] of [
      [() => { globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] } }, /Betriebsleitung/],
      [() => { globalThis.__module = [] }, /Modul aus: modul_shop/],
      [() => { globalThis.__sperreFehler = 'Nur-Lesen-Modus' }, /Nur-Lesen/],
      [() => { globalThis.__betriebFehler = 'Betrieb gewechselt' }, /Betrieb gewechselt/],
    ]) {
      globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }; globalThis.__module = ['modul_shop']
      globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
      einstellen(); mit([zeile(42, F1)])
      assert.match((await actions.shopWeindatenUebertragen(42)).error ?? '', muster)
      assert.match((await actions.shopWeindatenAlle()).error ?? '', muster)
      assert.equal(db.aufrufe.length, 0); assert.equal(globalThis.__meta.length, 0)
    }
  })
  test('ein Produkt: Felder der Füllung des eigenen Betriebs, Stand mit Prüfsumme gespeichert, alter Fehler gelöscht', async () => {
    mit([zeile(42, F1, { weindaten_fehler: 'alt' }), { ...zeile(42, F2), id: uuid(777), tenant_id: uuid(901) }])
    assert.deepEqual(await actions.shopWeindatenUebertragen(42), { success: true })
    assert.deepEqual(globalThis.__geladen, [[T, F1]])
    assert.equal(globalThis.__meta.length, 1)
    assert.equal(globalThis.__meta[0][0], 42)
    assert.deepEqual(globalThis.__meta[0][1], weindatenMeta(VOLL, '2026-11-15'))
    assert.equal(je(42).weindaten_pruefsumme, weindatenPruefsumme(VOLL))
    assert.ok(je(42).weindaten_am); assert.equal(je(42).weindaten_fehler, null)
    assert.equal(db.tabellen.shop_zuordnungen.find(z => z.tenant_id !== T).weindaten_am, null, 'fremder Betrieb unberührt')
  })
  test('Shop lehnt ab: Fehler am Produkt gespeichert, der vorige Erfolg bleibt stehen', async () => {
    mit([zeile(42, F1, { weindaten_am: '2026-11-01T08:00:00Z', weindaten_pruefsumme: 'a'.repeat(32) })])
    globalThis.__metaErgebnis = { 42: { ok: false, art: 'schreibrecht', meldung: 'Der Schlüssel darf im Shop nicht schreiben.' } }
    assert.deepEqual(await actions.shopWeindatenUebertragen(42), { error: 'Der Schlüssel darf im Shop nicht schreiben.' })
    assert.equal(je(42).weindaten_fehler, 'Der Schlüssel darf im Shop nicht schreiben.')
    assert.equal(je(42).weindaten_am, '2026-11-01T08:00:00Z'); assert.equal(je(42).weindaten_pruefsumme, 'a'.repeat(32))
  })
  test('ohne Zuordnung, ohne Zugangsdaten, Füllung fehlt, Lesefehler: nichts in den Shop', async () => {
    mit([])
    assert.match((await actions.shopWeindatenUebertragen(42)).error, /keine Zuordnung/)
    mit([zeile(42, F1)])
    globalThis.__zugang = { ok: false, meldung: 'Bitte zuerst die Shop-Adresse speichern.' }
    assert.match((await actions.shopWeindatenUebertragen(42)).error, /Shop-Adresse/)
    globalThis.__zugang = { ok: true, zugang: {} }
    mit([zeile(42, F3)])
    assert.match((await actions.shopWeindatenUebertragen(42)).error, /Füllung gibt es nicht mehr/)
    globalThis.__weindaten[F3] = new Error('E-Label konnte nicht geladen werden')
    mit([zeile(42, F3)])
    assert.match((await actions.shopWeindatenUebertragen(42)).error, /nicht geladen/)
    assert.match(je(42).weindaten_fehler, /nicht geladen/)
    assert.equal(globalThis.__meta.length, 0)
  })
  test('alle: je Produkt eigenes Ergebnis, ein Fehler hält die übrigen nicht auf, Katalog einmal geladen', async () => {
    mit([zeile(41, F1), zeile(42, F3), zeile(43, F2)])
    const r = await actions.shopWeindatenAlle()
    assert.deepEqual({ ...r, ersterFehler: undefined }, { success: true, uebertragen: 2, fehler: 1, ersterFehler: undefined })
    assert.match(r.ersterFehler, /Füllung gibt es nicht mehr/)
    assert.deepEqual(globalThis.__meta.map(m => m[0]), [41, 43])
    assert.equal(globalThis.__katalogRufe, 1)
    assert.ok(je(41).weindaten_am && je(43).weindaten_am); assert.ok(je(42).weindaten_fehler)
    mit([])
    assert.match((await actions.shopWeindatenAlle()).error, /keine Zuordnungen/)
  })
})

describe('KAN-462: gemeinsame Quelle mit dem E-Label, Seite, Migration', () => {
  test('öffentliche E-Label-Seite und Shop lesen dieselben Spalten', () => {
    const seite = quelle('src/app/e/[code]/page.tsx')
    assert.match(seite, /const SPALTEN = `id, umleitung_auf, tenant_id, fuellung_id, \$\{ELABEL_INHALT_SPALTEN\}`/)
    assert.match(seite, /\.select\(ELABEL_FUELLUNG_SPALTEN\)/)
    assert.match(seite, /\.select\(ELABEL_KATALOG_SPALTEN\)/)
    const lader = quelle('src/lib/shop/weindatenLaden.ts')
    assert.match(lader, /import 'server-only'/)
    assert.match(lader, /\$\{ELABEL_FUELLUNG_SPALTEN\}, anbaugebiet/)
    assert.match(lader, /code, restzucker_gl, gesamtsaeure_gl, \$\{ELABEL_INHALT_SPALTEN\}/)
    assert.match(lader, /\.eq\('tenant_id', tenantId\)\.eq\('fuellung_id', fuellungId\)\.eq\('status', 'freigegeben'\)/)
    assert.match(lader, /allergeneDerListe\(/)
    // die Spalten selbst: unverändert gegenüber dem Stand vor KAN-462
    assert.equal(ELABEL_INHALT_SPALTEN, 'zutaten_ids, alkohol_vol, energie_kj, energie_kcal, fett_g, fett_gesaettigt_g, kohlenhydrate_g, zucker_g, eiweiss_g, salz_g')
    assert.equal(ELABEL_FUELLUNG_SPALTEN, 'name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, sekt_stufe, flaschengroesse_ml')
    assert.equal(ELABEL_KATALOG_SPALTEN, 'id, kategorie, name_de, name_en, e_nummer, allergen, sortierung')
  })
  test('Seite: Vorschau aus dem eigenen, maskierten Block; Datum in Wiener Zeit', () => {
    const client = quelle('src/app/(dashboard)/weinhandel/shop/zuordnung/ZuordnungClient.tsx')
    assert.match(client, /dangerouslySetInnerHTML=\{\{ __html: w\.html \}\}/)
    assert.equal((client.match(/dangerouslySetInnerHTML/g) ?? []).length, 1)
    assert.match(client, /timeZone: 'Europe\/Vienna'/)
    const seite = quelle('src/app/(dashboard)/weinhandel/shop/zuordnung/page.tsx')
    assert.match(seite, /html: d \? weindatenHtml\(d\) : ''/)
    assert.match(seite, /weindatenStand\(z, d \? weindatenPruefsumme\(d\) : null\)/)
  })
  test('Migration: drei Spalten für den letzten Stand, keine neuen Rechte', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(n => /_kan462_shop_weindaten_stand\.sql$/.test(n))
    const pfad = datei ? path.join(ordner, datei) : path.join(WURZEL, 'supabase', 'entwurf', 'kan462_shop_weindaten_stand.sql')
    assert.ok(existsSync(pfad), 'Migration kan462_shop_weindaten_stand fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    assert.match(sql, /ADD COLUMN weindaten_am\s+timestamptz,/)
    assert.match(sql, /weindaten_pruefsumme ~ '\^\[0-9a-f\]\{32\}\$'/)
    assert.match(sql, /char_length\(weindaten_fehler\) BETWEEN 1 AND 500/)
    assert.ok(!/GRANT|CREATE POLICY|DROP POLICY/.test(sql))
    assert.deepEqual(JSON.parse(quelle('scripts/schema.json')).shop_zuordnungen.slice(10, 13), ['weindaten_am', 'weindaten_pruefsumme', 'weindaten_fehler'])
    assert.match(META_HTML, /^s112_/)
  })
})
