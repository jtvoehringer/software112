// STABILITAET.md Punkt „Bibliotheken unter 70 % Abdeckung“, zweite Runde (09.10.2026):
//   lib/system/ereignis.ts (Fehlerprotokoll, darf nie werfen), lib/behoerden/flaechenverzeichnis.ts (Lader),
//   lib/behoerden/abgabe.ts (Snapshot einer abgegebenen Meldung = dieselbe CSV wie die Route),
//   lib/brevo/api.ts (Absender, Schlüssel, Fehler – fetch ist eine Attrappe, kein Netz).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, hatFilter } from './buchung-attrappe.mjs'

hooksRegistrieren()
const ev = hooksMoeglich ? await laden('lib/system/ereignis.ts') : null
const fv = hooksMoeglich ? await laden('lib/behoerden/flaechenverzeichnis.ts') : null
const abg = hooksMoeglich ? await laden('lib/behoerden/abgabe.ts') : null
const brevo = hooksMoeglich ? await laden('lib/brevo/api.ts') : null

const T = '11111111-1111-4111-8111-111111111111'
const stumm = async f => { const o = console.error; const log = []; console.error = (...a) => log.push(a.join(' ')); try { await f(); return log } finally { console.error = o } }

describe('Systemereignisse (lib/system/ereignis.ts)', nurMitHooks, () => {
  afterEach(() => { globalThis.__adminFake = null })

  test('melden: Meldung aus dem S112-Digest, Next-Digest gespeichert, Längen begrenzt, nur gültige UUIDs', async () => {
    const db = datenbank({ system_ereignisse: [] })
    globalThis.__adminFake = db
    await ev.ereignisMelden({ art: 'server', quelle: 'q'.repeat(400), meldung: 'An error occurred in the Server Components render', digest: 'S112|Charge nicht gefunden', tenantId: T, userId: 'kein-uuid' })
    await ev.ereignisMelden({ art: 'client', quelle: '/x', meldung: '', digest: '12345678', details: { a: 1 } })
    await ev.ereignisMelden({ art: 'cron', quelle: '/c', meldung: 'm'.repeat(3000) })
    const [a, b, c] = db.tabellen.system_ereignisse
    assert.deepEqual([a.meldung, a.digest, a.quelle.length, a.tenant_id, a.user_id], ['Charge nicht gefunden', null, 300, T, null])
    assert.deepEqual([b.meldung, b.digest, b.details], ['Fehler ohne Meldung', '12345678', { a: 1 }])
    assert.equal(c.meldung.length, 2000)
  })

  test('melden wirft nie (Datenbankfehler, fehlender Client)', async () => {
    globalThis.__adminFake = datenbank({ system_ereignisse: [] }, { vorher: () => ({ error: { message: 'voll' } }) })
    const log = await stumm(() => ev.ereignisMelden({ art: 'db', quelle: 'x', meldung: 'y' }))
    assert.match(log.join('\n'), /\[system\] ereignis: voll/)
    globalThis.__adminFake = null
    await stumm(() => ev.ereignisMelden({ art: 'db', quelle: 'x', meldung: 'y' }))
  })

  test('laden ab Zeitpunkt (neueste zuerst), bei Fehler leer; bereinigen löscht nur älter als 30 Tage', async () => {
    const jetzt = Date.now()
    const iso = tage => new Date(jetzt - tage * 86400000).toISOString()
    const db = datenbank({ system_ereignisse: [
      { id: 1, erstellt_am: iso(40), art: 'server' }, { id: 2, erstellt_am: iso(2), art: 'server' }, { id: 3, erstellt_am: iso(1), art: 'client' },
    ] })
    globalThis.__adminFake = db
    assert.deepEqual((await ev.ereignisseLaden(new Date(jetzt - 7 * 86400000))).map(z => z.id), [3, 2])
    assert.equal(await ev.ereignisseBereinigen(), 1)
    assert.deepEqual(db.tabellen.system_ereignisse.map(z => z.id), [2, 3])
    globalThis.__adminFake = datenbank({ system_ereignisse: [] }, { vorher: () => ({ error: { message: 'x' } }) })
    await stumm(async () => {
      assert.deepEqual(await ev.ereignisseLaden(new Date()), [])
      assert.equal(await ev.ereignisseBereinigen(), 0)
    })
    globalThis.__adminFake = null
    assert.equal(await ev.ereignisseBereinigen(), 0, 'ohne Client: 0 statt Ausnahme')
  })
})

const riedDaten = () => ({
  weingarten: [
    { id: 'w1', tenant_id: T, name: 'Kirchberg', ried: 'Ried Kirchberg', rebsorte: 'Grüner Veltliner', weinart: 'weiss', flaeche_ha: '1.234567', bewirtschaftung: 'bio', aktiv: true, ama_feldnummer: 12, codes: null, interne_bezeichnung: null, pflanzjahr: '1998', zentrum_lat: '48.1', zentrum_lon: 'x' },
    { id: 'w2', tenant_id: T, name: 'Ohne Grundstück', ried: null, rebsorte: null, flaeche_ha: null, aktiv: false, pflanzjahr: 1998.5 },
    { id: 'wf', tenant_id: 'anderer', name: 'Fremd', ried: 'Fremd', aktiv: true },
  ],
  grundstuecke: [
    { id: 'g1', tenant_id: T, weingarten_id: 'w1', gst_nr: '12/3', flaeche_ha: 0.45678, flaeche_ha_kataster: '', spritzbar: null, nutzart: 'WI', lse_stueckzahl: '3', aktiv: null, deaktiviert_am: null, katastralgemeinde: '16110' },
    { id: 'g2', tenant_id: T, weingarten_id: 'w1', gst_nr: '7', flaeche_ha: 0.1, spritzbar: false, nutzart: 'A', aktiv: false, deaktiviert_am: '2026-03-01' },
  ],
})

describe('Flächenverzeichnis: Lader (lib/behoerden/flaechenverzeichnis.ts)', nurMitHooks, () => {
  test('Stammdaten: Zahlen und Texte bereinigt, Ried mit Name, Defaults spritzbar/aktiv, nur der eigene Betrieb', async () => {
    const db = datenbank(riedDaten())
    const { weingaerten, grundstuecke } = await fv.ladeRiedenStammdaten(db, T)
    assert.deepEqual(weingaerten.map(w => w.id), ['w1', 'w2'], 'leere Ried zuletzt, fremde nicht')
    const [w1, w2] = weingaerten
    assert.deepEqual([w1.flaeche_ha, w1.ama_feldnummer, w1.pflanzjahr, w1.zentrum_lat, w1.zentrum_lon, w1.aktiv], [1.2346, '12', 1998, 48.1, null, true])
    assert.deepEqual([w2.pflanzjahr, w2.aktiv, w2.flaeche_ha], [null, false, null], 'Pflanzjahr nur ganzzahlig')
    const g1 = grundstuecke.find(g => g.id === 'g1')
    assert.deepEqual([g1.flaeche_ha, g1.flaeche_ha_kataster, g1.spritzbar, g1.aktiv, g1.lse_stueckzahl], [0.4568, null, true, true, 3])
    assert.ok(db.aufrufe.every(a => hatFilter(a, 'eq', 'tenant_id', T)))
  })

  test('Verzeichnis: Nutzung als Klartext aus der Nutzart-Liste; Datenbankfehler werfen', async () => {
    const r = await fv.ladeFlaechenverzeichnis(datenbank(riedDaten()), T)
    const nutzung = Object.fromEntries(r.zeilen.filter(z => z.gstNr).map(z => [z.gstNr, z.nutzung]))
    assert.deepEqual(nutzung, { '12/3': 'Wein', 7: 'Grünbrache' })
    for (const [tab, meldung] of [['weingarten', /Rieden konnten nicht geladen werden: x/], ['grundstuecke', /Grundstücke konnten nicht geladen werden: x/]]) {
      await assert.rejects(fv.ladeRiedenStammdaten(datenbank(riedDaten(), { vorher: e => (e.tabelle === tab ? { error: { message: 'x' } } : null) }), T), meldung)
    }
  })
})

describe('Abgabe-Snapshot (lib/behoerden/abgabe.ts)', nurMitHooks, () => {
  const ctx = db => ({ supabase: db, tenantId: T, membership: { tenantId: T, role: 'tenant_admin', schreibmodule: [] } })
  const mitBetrieb = () => ({ ...riedDaten(), tenant_einstellungen: [{ tenant_id: T, betrieb_name: 'Weingut Test', betrieb_betriebsnummer: '1234567' }] })

  test('dieselbe CSV wie die Route: Ladefunktion, Spalten, Profil, Dateiname; Snapshot ist reines JSON', async () => {
    const s = await abg.abgabeErzeugen(ctx(datenbank(mitBetrieb())), 'flaechenverzeichnis', {})
    const { meldungFinden } = await laden('lib/behoerden/register.ts')
    const { csvDatei, PROFIL_EXCEL_AT } = await laden('lib/csv/index.ts')
    const m = meldungFinden('flaechenverzeichnis')
    const direkt = await m.laden({ ...ctx(datenbank(mitBetrieb())), betrieb: { name: 'Weingut Test', betriebsnummer: '1234567' } }, m.parameter(new URLSearchParams()))
    assert.equal(s.csv, csvDatei(direkt.zeilen, m.spalten, PROFIL_EXCEL_AT).text)
    assert.equal(s.profil, PROFIL_EXCEL_AT.name)
    assert.equal(s.meldung, 'flaechenverzeichnis')
    assert.equal(s.zeilen.length, direkt.zeilen.length)
    assert.deepEqual(s.spalten.map(x => x.kopf), m.spalten.map(x => x.kopf))
    assert.match(s.dateiname, /\.csv$/)
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
  })

  test('unbekannte Meldung und Parameterfehler werfen', async () => {
    await assert.rejects(abg.abgabeErzeugen(ctx(datenbank(mitBetrieb())), 'gibt-es-nicht', {}), /Unbekannte Behördenmeldung „gibt-es-nicht“/)
    const { MELDUNGEN, meldungFinden } = await laden('lib/behoerden/register.ts')
    const { istParameterFehler } = await laden('lib/behoerden/typen.ts')
    // eine Meldung mit Pflichtparameter: leerer Aufruf liefert einen Parameterfehler
    const ids = Object.keys(MELDUNGEN)
    const mitPflicht = ids.find(id => istParameterFehler(meldungFinden(id).parameter(new URLSearchParams())))
    assert.ok(mitPflicht, 'mindestens eine Meldung mit Pflichtparameter')
    await assert.rejects(abg.abgabeErzeugen(ctx(datenbank(mitBetrieb())), mitPflicht, {}))
  })
})

describe('Brevo-API (lib/brevo/api.ts)', nurMitHooks, () => {
  const alt = { key: process.env.BREVO_API_KEY, mail: process.env.BREVO_SENDER_EMAIL, fetch: globalThis.fetch }
  let aufrufe
  const fetchMit = (status, body = '{}') => { aufrufe = []; globalThis.fetch = async (url, init) => { aufrufe.push({ url, init, body: JSON.parse(init.body) }); return new Response(status === 204 ? null : body, { status }) } }
  afterEach(() => {
    globalThis.fetch = alt.fetch
    for (const [k, v] of [['BREVO_API_KEY', alt.key], ['BREVO_SENDER_EMAIL', alt.mail]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })

  test('System-Mail: Schlüssel und Absender aus der Umgebung, Text = Betreff ohne Textteil', async () => {
    process.env.BREVO_API_KEY = 'sys-key'; process.env.BREVO_SENDER_EMAIL = ' system@icp.at '
    fetchMit(201, '{"messageId":"m1"}')
    assert.deepEqual(await brevo.sendEmail({ to: { email: 'a@b.at' }, subject: 'Hallo', htmlContent: '<p>x</p>' }), { messageId: 'm1' })
    assert.equal(aufrufe[0].url, 'https://api.brevo.com/v3/smtp/email')
    assert.equal(aufrufe[0].init.headers['api-key'], 'sys-key')
    assert.deepEqual(aufrufe[0].body.sender, { name: 'software:112', email: 'system@icp.at' })
    assert.equal(aufrufe[0].body.textContent, 'Hallo')
  })

  test('Mail eines Betriebs: dessen Schlüssel und Absender, nie die System-Adresse', async () => {
    delete process.env.BREVO_API_KEY; delete process.env.BREVO_SENDER_EMAIL
    fetchMit(201)
    const zugang = { apiKey: 'betrieb-key', senderMail: 'office@weingut.at', senderName: 'Weingut X' }
    await brevo.sendEmail({ to: { email: 'a@b.at' }, subject: 'S', htmlContent: 'h', textContent: 't', zugang })
    assert.equal(aufrufe[0].init.headers['api-key'], 'betrieb-key')
    assert.deepEqual(aufrufe[0].body.sender, { name: 'Weingut X', email: 'office@weingut.at' })
    assert.equal(aufrufe[0].body.textContent, 't')
  })

  test('fehlender Schlüssel bzw. Absender, Brevo-Fehler mit Antworttext', async () => {
    delete process.env.BREVO_API_KEY
    fetchMit(201)
    await assert.rejects(brevo.sendEmail({ to: { email: 'a@b.at' }, subject: 'S', htmlContent: 'h' }), /BREVO_API_KEY nicht konfiguriert/)
    process.env.BREVO_API_KEY = 'k'; delete process.env.BREVO_SENDER_EMAIL
    await assert.rejects(brevo.sendEmail({ to: { email: 'a@b.at' }, subject: 'S', htmlContent: 'h' }), /BREVO_SENDER_EMAIL nicht konfiguriert/)
    process.env.BREVO_SENDER_EMAIL = 's@icp.at'
    fetchMit(400, 'invalid email')
    await assert.rejects(brevo.sendEmail({ to: { email: 'x' }, subject: 'S', htmlContent: 'h' }), /Brevo E-Mail-Fehler: invalid email/)
  })

  test('Kontakt anlegen/aktualisieren (204 ist ok) und aus Liste entfernen', async () => {
    process.env.BREVO_API_KEY = 'k'
    fetchMit(204)
    await brevo.upsertContact({ email: 'a@b.at', vorname: 'Max', listIds: [3], attributes: { KUNDE: true } })
    assert.deepEqual(aufrufe[0].body, { email: 'a@b.at', updateEnabled: true, listIds: [3], attributes: { FIRSTNAME: 'Max', LASTNAME: '', KUNDE: true } })
    fetchMit(400, 'kaputt')
    await assert.rejects(brevo.upsertContact({ email: 'a@b.at' }), /Brevo Kontakt-Fehler: kaputt/)
    fetchMit(204)
    await brevo.removeFromList('a@b.at', 7)
    assert.equal(aufrufe[0].url, 'https://api.brevo.com/v3/contacts/lists/7/contacts/remove')
    assert.deepEqual(aufrufe[0].body, { emails: ['a@b.at'] })
    fetchMit(404, 'Liste fehlt')
    await assert.rejects(brevo.removeFromList('a@b.at', 7), /Brevo Opt-out-Fehler: Liste fehlt/)
  })
})
