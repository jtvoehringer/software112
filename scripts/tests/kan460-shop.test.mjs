// KAN-460 (15.11.2026): Weinshop-Anbindung S1a – Paket-Modul modul_shop, Einstellungen, Verbindungstest.
// Geprüft wird: Adressprüfung (nur https, keine internen Ziele), WooCommerce-Client gegen eine Attrappe (Entscheidung
// Jörgen 15.11.2026: Testshop erst zur Abnahme, KAN-464), Rechte und Modul vor jedem Datenbankzugriff, Schlüssel nie
// im Klartext oder im Browser, Verdrahtung des Moduls (Navigation, Mandantenverwaltung, Migration).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shopUrlFehler, shopUrlNormalisiert, istInterneAdresse } from '../../src/lib/shop/url.ts'
import { wooVerbindungTesten, wooVerbindungText } from '../../src/lib/shop/woocommerce.ts'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-460: Shop-Adresse', () => {
  test('gültige Adressen, einheitliche Form', () => {
    for (const [roh, soll] of [
      ['https://www.mein-weingut.at', 'https://www.mein-weingut.at'],
      ['  https://Weingut-Beispiel.AT/  ', 'https://weingut-beispiel.at'],
      ['https://beispiel.at/wein/', 'https://beispiel.at/wein'],
      ['https://beispiel.at:443', 'https://beispiel.at'],
    ]) {
      assert.equal(shopUrlFehler(roh), null, roh)
      assert.equal(shopUrlNormalisiert(roh), soll, roh)
    }
    assert.equal(shopUrlFehler(''), null, 'leer = keine Adresse')
    assert.equal(shopUrlNormalisiert(''), null)
  })
  test('abgelehnt: kein https, Zugangsdaten, Port, IP-Adressen, interne Namen, Zusätze', () => {
    for (const [roh, muster] of [
      ['http://beispiel.at', /https:\/\//],
      ['beispiel.at', /https:\/\//],
      ['ftp://beispiel.at', /https:\/\//],
      ['https://benutzer:geheim@beispiel.at', /Benutzernamen/],
      ['https://beispiel.at:8443', /Port/],
      ['https://192.168.0.1', /IP-Adresse/],
      ['https://127.0.0.1', /IP-Adresse/],
      ['https://[::1]', /IP-Adresse/],
      ['https://2130706433', /IP-Adresse/],
      ['https://0x7f.0.0.1', /IP-Adresse|ungültig/],
      ['https://localhost', /IP-Adresse|öffentlich/],
      ['https://intranet', /IP-Adresse/],
      ['https://shop.local', /öffentlich/],
      ['https://db.internal', /öffentlich/],
      ['https://beispiel.at/?x=1', /ohne/],
      ['https://beispiel.at/#a', /ohne/],
      ['https://beispiel.at/wp-json/wc/v3', /wp-json/],
      ['https://bei spiel.at', /Leerzeichen/],
      ['https://' + 'a'.repeat(300) + '.at', /zu lang/],
    ]) {
      assert.match(shopUrlFehler(roh) ?? '', muster, roh)
      assert.equal(shopUrlNormalisiert(roh), null, roh)
    }
  })
  test('aufgelöste Adressen: privat, Loopback, Link-Local und Abbildungen gelten als intern', () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0',
      '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:7f00:1',
      '64:ff9b::10.0.0.1', '2001:db8::1', 'kein-ip']) {
      assert.equal(istInterneAdresse(ip), true, ip)
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2a01:4f8::1', '2606:4700:4700::1111', '::ffff:93.184.216.34']) {
      assert.equal(istInterneAdresse(ip), false, ip)
    }
  })
})

describe('KAN-460: WooCommerce-Client (Attrappe)', () => {
  const zugang = { url: 'https://www.beispiel.at', key: 'ck_test', secret: 'cs_test' }
  const oeffentlich = async () => ['93.184.216.34']
  const antwort = (status, body, kopf = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json', ...kopf },
  })

  test('Erfolg: genau ein lesender Aufruf mit Basic Auth, ohne Weiterleitung, mit Zeitlimit', async () => {
    const rufe = []
    const r = await wooVerbindungTesten(zugang, {
      aufloesen: oeffentlich,
      fetch: async (url, init) => { rufe.push({ url, init }); return antwort(200, [{ id: 7 }], { 'x-wp-total': '15' })() },
    })
    assert.deepEqual(r, { ok: true, daten: { produkte: 15 } })
    assert.equal(rufe.length, 1)
    assert.equal(rufe[0].url, 'https://www.beispiel.at/wp-json/wc/v3/products?per_page=1&_fields=id')
    assert.equal(rufe[0].init.method, 'GET')
    assert.equal(rufe[0].init.redirect, 'manual')
    assert.ok(rufe[0].init.signal, 'Zeitlimit gesetzt')
    assert.equal(rufe[0].init.headers.Authorization, 'Basic ' + Buffer.from('ck_test:cs_test').toString('base64'))
    assert.equal(wooVerbindungText(15), 'Verbindung steht – 15 Produkte im Shop.')
    assert.equal(wooVerbindungText(1), 'Verbindung steht – 1 Produkt im Shop.')
    assert.equal(wooVerbindungText(null), 'Verbindung steht.')
  })
  test('Fehler werden übersetzt, nie geworfen', async () => {
    const fall = async (fetchFn, aufloesen = oeffentlich) => wooVerbindungTesten(zugang, { aufloesen, fetch: fetchFn })
    assert.equal((await fall(antwort(401, { code: 'woocommerce_rest_cannot_view' }))).art, 'schluessel')
    assert.equal((await fall(antwort(403, {}))).art, 'recht')
    assert.equal((await fall(antwort(404, '<html>'))).art, 'kein_woocommerce')
    assert.equal((await fall(antwort(200, '<html>Wartung</html>'))).art, 'kein_woocommerce')
    assert.equal((await fall(antwort(200, { kein: 'array' }))).art, 'kein_woocommerce')
    assert.equal((await fall(antwort(301, '', { location: 'https://169.254.169.254/' }))).art, 'weiterleitung')
    const r500 = await fall(antwort(500, {}))
    assert.equal(r500.art, 'antwort'); assert.match(r500.meldung, /HTTP 500/)
    assert.equal((await fall(async () => { throw new TypeError('fetch failed') })).art, 'nicht_erreichbar')
    assert.equal((await fall(async () => { throw Object.assign(new Error('zu spät'), { name: 'TimeoutError' }) })).art, 'zeit')
    assert.equal((await fall(antwort(200, []), async () => { throw new Error('ENOTFOUND') })).art, 'nicht_erreichbar')
    assert.equal((await fall(antwort(200, []), async () => [])).art, 'nicht_erreichbar')
  })
  test('kein Aufruf, wenn die Adresse ungültig ist, intern auflöst oder der Schlüssel fehlt', async () => {
    let n = 0
    const zaehlen = async () => { n++; return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) }
    assert.equal((await wooVerbindungTesten({ ...zugang, url: 'http://www.beispiel.at' }, { aufloesen: oeffentlich, fetch: zaehlen })).art, 'adresse')
    assert.equal((await wooVerbindungTesten(zugang, { aufloesen: async () => ['93.184.216.34', '10.0.0.8'], fetch: zaehlen })).art, 'adresse')
    assert.equal((await wooVerbindungTesten(zugang, { aufloesen: async () => ['::1'], fetch: zaehlen })).art, 'adresse')
    assert.equal((await wooVerbindungTesten({ ...zugang, secret: ' ' }, { aufloesen: oeffentlich, fetch: zaehlen })).art, 'schluessel')
    assert.equal(n, 0)
  })
})

// ── Server Actions: Rechte, Modul, Geheimnisse ───────────────────────────────────────────────────────────────────────
const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const seitenBetriebFehler = async () => globalThis.__betriebFehler ?? null')
DOPPEL['@/lib/auth/sperren'] = modul('export const schreibSperreFehler = async () => globalThis.__sperreFehler ?? null')
DOPPEL['@/lib/auth/modul'] = modul('export const hatModul = async f => (globalThis.__module ?? []).includes(f); export const modulAusMeldung = f => "Modul aus: " + f')
DOPPEL['@/lib/email/geheimnis'] = modul(`
  export const GEHEIM_MASKE = '__hinterlegt__'
  export const geheimLesen = w => { if (w === 'kaputt') throw new Error('x'); return w ? String(w).replace(/^enc:/, '') : null }
  export const geheimFeld = (spalte, roh) => {
    if (roh === null) return {}
    const s = String(roh).trim()
    if (s === GEHEIM_MASKE) return {}
    return { [spalte]: s ? 'enc:' + s : null }
  }`)
DOPPEL['@/lib/shop/woocommerce'] = modul(`
  export const wooVerbindungTesten = async z => { (globalThis.__wooRufe ??= []).push(z); return globalThis.__wooErgebnis }
  export const wooVerbindungText = n => 'Verbindung steht – ' + n`)
hooksRegistrieren()
const actions = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/shop/actions.ts') : null
const navigation = hooksMoeglich ? await laden('lib/navigation/index.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const fd = (f = {}) => { const d = new FormData(); for (const [k, w] of Object.entries(f)) d.set(k, w); return d }
function adminFake(zeile = null, fehler = null) {
  const rufe = []
  globalThis.__adminFake = {
    from: tabelle => ({
      upsert: (werte, optionen) => { rufe.push({ tabelle, art: 'upsert', werte, optionen }); return Promise.resolve({ error: fehler }) },
      select: spalten => ({ eq: (spalte, wert) => ({ maybeSingle: async () => { rufe.push({ tabelle, art: 'select', spalten, spalte, wert }); return { data: zeile, error: fehler } } }) }),
    }),
  }
  return rufe
}
const gueltig = { shop_url: 'https://www.beispiel.at/', shop_bestandsreserve: '12', shop_bestand_uebertragen: 'true', shop_woo_api_key: 'ck_neu', shop_woo_secret: 'cs_neu' }

describe('KAN-460: Server Actions der Shop-Anbindung', nurMitHooks, () => {
  beforeEach(() => {
    globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
    globalThis.__module = ['modul_shop']
    globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
    globalThis.__wooRufe = []; globalThis.__wooErgebnis = { ok: true, daten: { produkte: 15 } }
  })

  test('abgelehnt vor jedem Datenbankzugriff: anderer Betrieb, Nur-Lesen, Mitarbeiter, Leser, Modul aus', async () => {
    const faelle = [
      [() => { globalThis.__betriebFehler = 'Betrieb gewechselt' }, /Betrieb gewechselt/],
      [() => { globalThis.__sperreFehler = 'Nur-Lesen-Modus' }, /Nur-Lesen/],
      [() => { globalThis.__membership = { tenantId: T, role: 'winzer', schreibmodule: ['warenwirtschaft'] } }, /Betriebsleitung/],
      [() => { globalThis.__membership = { tenantId: T, role: 'leser', schreibmodule: [] } }, /Betriebsleitung/],
      [() => { globalThis.__membership = null }, /Betriebsleitung/],
      [() => { globalThis.__module = ['modul_ea', 'modul_sumup'] }, /Modul aus: modul_shop/],
    ]
    for (const [einstellen, muster] of faelle) {
      globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: [] }
      globalThis.__module = ['modul_shop']; globalThis.__betriebFehler = null; globalThis.__sperreFehler = null
      einstellen()
      const rufe = adminFake()
      assert.match((await actions.saveShopEinstellungen(fd(gueltig))).error ?? '', muster)
      assert.match((await actions.shopVerbindungTesten()).error ?? '', muster)
      assert.equal(rufe.length, 0, String(muster))
      assert.equal(globalThis.__wooRufe.length, 0, String(muster))
    }
  })

  test('Speichern: eigener Betrieb aus der Mitgliedschaft, Adresse normalisiert, Schlüssel verschlüsselt', async () => {
    const rufe = adminFake()
    assert.deepEqual(await actions.saveShopEinstellungen(fd({ ...gueltig, tenant_id: 'fremd' })), { success: true })
    assert.equal(rufe.length, 1)
    const { werte, optionen, tabelle } = rufe[0]
    assert.equal(tabelle, 'tenant_einstellungen')
    assert.deepEqual(optionen, { onConflict: 'tenant_id' })
    assert.equal(werte.tenant_id, T)
    assert.equal(werte.shop_url, 'https://www.beispiel.at')
    assert.equal(werte.shop_bestandsreserve, 12)
    assert.equal(werte.shop_bestand_uebertragen, true)
    assert.equal(werte.shop_woo_api_key, 'enc:ck_neu')
    assert.equal(werte.shop_woo_secret, 'enc:cs_neu')
    assert.ok(!('modul_shop' in werte), 'den Schalter setzt nur der Plattform-Admin')
  })
  test('Speichern: Maske lässt die Schlüssel unverändert, leer löscht sie', async () => {
    let rufe = adminFake()
    await actions.saveShopEinstellungen(fd({ ...gueltig, shop_woo_api_key: '__hinterlegt__', shop_woo_secret: '__hinterlegt__' }))
    assert.ok(!('shop_woo_api_key' in rufe[0].werte) && !('shop_woo_secret' in rufe[0].werte))
    rufe = adminFake()
    await actions.saveShopEinstellungen(fd({ ...gueltig, shop_url: '', shop_bestandsreserve: '', shop_bestand_uebertragen: 'false', shop_woo_api_key: '', shop_woo_secret: '' }))
    assert.deepEqual({ ...rufe[0].werte, aktualisiert_am: null }, {
      tenant_id: T, shop_url: null, shop_bestandsreserve: 0, shop_bestand_uebertragen: false, shop_woo_api_key: null, shop_woo_secret: null, aktualisiert_am: null,
    })
  })
  test('Speichern: ungültige Eingaben mit Feld, nichts geschrieben; Datenbankfehler wird gemeldet', async () => {
    for (const [aenderung, feld] of [
      [{ shop_url: 'http://www.beispiel.at' }, 'shop_url'], [{ shop_url: 'https://192.168.0.1' }, 'shop_url'],
      [{ shop_bestandsreserve: '-1' }, 'shop_bestandsreserve'], [{ shop_bestandsreserve: '1,5' }, 'shop_bestandsreserve'],
      [{ shop_bestandsreserve: '100001' }, 'shop_bestandsreserve'], [{ shop_bestandsreserve: 'viel' }, 'shop_bestandsreserve'],
    ]) {
      const rufe = adminFake()
      const r = await actions.saveShopEinstellungen(fd({ ...gueltig, ...aenderung }))
      assert.equal(r.feld, feld, JSON.stringify(aenderung)); assert.ok(r.error)
      assert.equal(rufe.length, 0)
    }
    adminFake(null, { message: 'kaputt', code: 'XX000' })
    assert.ok((await actions.saveShopEinstellungen(fd(gueltig))).error)
  })

  test('Verbindungstest: gespeicherte Daten des eigenen Betriebs, entschlüsselt an den Client', async () => {
    const rufe = adminFake({ shop_url: 'https://www.beispiel.at', shop_woo_api_key: 'enc:ck_a', shop_woo_secret: 'enc:cs_b' })
    assert.deepEqual(await actions.shopVerbindungTesten(), { success: true, text: 'Verbindung steht – 15' })
    assert.deepEqual(rufe.map(r => [r.art, r.spalte, r.wert]), [['select', 'tenant_id', T]])
    assert.deepEqual(globalThis.__wooRufe, [{ url: 'https://www.beispiel.at', key: 'ck_a', secret: 'cs_b' }])
  })
  test('Verbindungstest: fehlende Daten, unlesbare Schlüssel, Ablehnung des Shops, Lesefehler', async () => {
    adminFake(null)
    assert.equal((await actions.shopVerbindungTesten()).feld, 'shop_url')
    adminFake({ shop_url: 'https://www.beispiel.at', shop_woo_api_key: null, shop_woo_secret: 'enc:x' })
    assert.equal((await actions.shopVerbindungTesten()).feld, 'schluessel')
    adminFake({ shop_url: 'https://www.beispiel.at', shop_woo_api_key: 'kaputt', shop_woo_secret: 'enc:x' })
    assert.match((await actions.shopVerbindungTesten()).error, /nicht lesbar/)
    assert.equal(globalThis.__wooRufe.length, 0)
    adminFake({ shop_url: 'https://www.beispiel.at', shop_woo_api_key: 'enc:a', shop_woo_secret: 'enc:b' })
    globalThis.__wooErgebnis = { ok: false, art: 'schluessel', meldung: 'Schlüssel abgelehnt' }
    assert.deepEqual(await actions.shopVerbindungTesten(), { error: 'Schlüssel abgelehnt', feld: 'schluessel' })
    globalThis.__wooErgebnis = { ok: false, art: 'kein_woocommerce', meldung: 'keine API' }
    assert.equal((await actions.shopVerbindungTesten()).feld, 'shop_url')
    adminFake(null, { message: 'kaputt', code: 'XX000' })
    assert.ok((await actions.shopVerbindungTesten()).error)
    assert.equal(globalThis.__wooRufe.length, 2, 'bei einem Lesefehler kein Aufruf des Shops')
  })
})

describe('KAN-460: Verdrahtung des Moduls', () => {
  const nav = (role, modul_shop) => navigation.buildNav({
    role, branding: { modul_ea: true, modul_sumup: true, modul_export: true, modul_controlling: true, modul_shop },
    isSandbox: false, sandboxAdminUnlock: false, auswertungenSichtbar: true,
  }).flatMap(g => g.items.map(i => i.href))

  test('Navigation: „Shop-Anbindung“ nur mit Modul und nur für die Betriebsleitung', nurMitHooks, () => {
    assert.ok(nav('tenant_admin', true).includes('/weinhandel/shop'))
    assert.ok(nav('system_admin', true).includes('/weinhandel/shop'))
    assert.ok(!nav('tenant_admin', false).includes('/weinhandel/shop'))
    assert.ok(!nav('winzer', true).includes('/weinhandel/shop'))
    assert.ok(!nav('leser', true).includes('/weinhandel/shop'))
  })
  test('Seite: Modul-Guard, nur Betriebsleitung, Schlüssel nur maskiert', () => {
    const seite = quelle('src/app/(dashboard)/weinhandel/shop/page.tsx')
    assert.match(seite, /await requireModul\('modul_shop'\)/)
    assert.match(seite, /canAdmin\(membership\.role\)\) redirect\('\/dashboard'\)/)
    assert.match(seite, /\.eq\('tenant_id', membership\.tenantId\)/)
    assert.match(seite, /shop_woo_api_key: geheimMaskiert\(/)
    assert.match(seite, /shop_woo_secret: geheimMaskiert\(/)
    const formular = quelle('src/app/(dashboard)/weinhandel/shop/ShopEinstellungen.tsx')
    assert.ok(!/woocommerce'|geheimLesen|supabase/.test(formular), 'das Formular lädt weder den Client der Shop-API noch Geheimnisse')
    assert.match(formular, /finally \{\s*setSpeichert\(false\)/)
    assert.match(formular, /finally \{\s*setTestet\(false\)/)
  })
  test('Aktionen: Betrieb der Seite und Schreibsperre vor den Rechten, Modul geprüft', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/shop/actions.ts')
    const i = s => { const n = a.indexOf(s); assert.ok(n >= 0, s); return n }
    assert.ok(i('seitenBetriebFehler(membership?.tenantId)') < i('schreibSperreFehler(membership)'))
    assert.ok(i('schreibSperreFehler(membership)') < i('canAdmin(membership.role)'))
    assert.ok(i('canAdmin(membership.role)') < i("hatModul('modul_shop')"))
    assert.ok(!/geheimSpeichern\([^)]*\)\s*\?\?\s*null/.test(a), 'nie geheimSpeichern(…) ?? null')
  })
  test('Mandantenverwaltung, Kopf und Schlüsseltausch kennen das Modul bzw. die Geheimnisse', () => {
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts'), /\.\.\.schalter\('modul_shop'\)/)
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx'), /fd\.set\('modul_shop',\s+shop \? 'true' : 'false'\)/)
    assert.match(quelle('src/lib/tenant/kopf.ts'), /KOPF_SPALTEN = '[^']*\bmodul_shop\b/)
    assert.match(quelle('src/app/(dashboard)/admin/system/schluessel-actions.ts'), /'shop_woo_api_key', 'shop_woo_secret'\], klartext: true/)
    assert.ok(!/shop_woo_/.test(quelle('src/lib/tenant/kopf.ts')), 'Geheimnisse nie im gecachten Kopf')
  })
  test('Migration: Geheimnisse ohne GRANT, Schalter in s112_paketmodul_frei, Modul überall aus', () => {
    const ordner = path.join(WURZEL, 'supabase', 'migrations')
    const datei = readdirSync(ordner).find(n => /_kan460_modul_shop\.sql$/.test(n))
    const entwurf = path.join(WURZEL, 'supabase', 'entwurf', 'kan460_modul_shop.sql')
    const pfad = datei ? path.join(ordner, datei) : entwurf
    assert.ok(existsSync(pfad), 'Migration kan460_modul_shop fehlt (migrations/ bzw. entwurf/)')
    const sql = readFileSync(pfad, 'utf8').replace(/\r\n/g, '\n')
    const grant = /GRANT SELECT \(([^)]*)\) ON public\.tenant_einstellungen TO authenticated, anon;/.exec(sql)
    assert.ok(grant)
    assert.deepEqual(grant[1].split(',').map(s => s.trim()).sort(), ['modul_shop', 'shop_bestand_uebertragen', 'shop_bestandsreserve', 'shop_url'])
    assert.equal((sql.match(/GRANT (SELECT|UPDATE|INSERT)/g) ?? []).length, 1, 'kein weiterer GRANT auf Spalten')
    assert.match(sql, /WHEN 'modul_shop'\s+THEN e\.modul_shop/)
    assert.match(sql, /modul_shop\s+boolean NOT NULL DEFAULT false/)
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.s112_paketmodul_frei\(uuid, text\) FROM PUBLIC, anon;/)
    const helfer = quelle('scripts/db-tests/_helfer.sql')
    assert.match(helfer, /'tenant_einstellungen\.shop_woo_api_key', 'tenant_einstellungen\.shop_woo_secret'/)
  })
})
