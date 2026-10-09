// STABILITAET.md Punkt „Bibliotheken unter 70 % Abdeckung“, zweite Runde (09.10.2026), nach Risiko:
//   lib/behoerden/zugriff.ts (wer welche Behördenmeldung abrufen darf), lib/sumup/webhook.ts (signierte Webhook-URL),
//   lib/email/geheimnis.ts (API-Keys verschlüsselt, Maske), lib/behoerden/besondereKonten.ts (Stoffkonto-Meldung).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, hatFilter } from './buchung-attrappe.mjs'

const SCHLUESSEL = 'test-schluessel-mit-mindestens-32-zeichen-lang'
const altV2 = process.env.EMAIL_CRYPT_SECRET_V2
process.env.EMAIL_CRYPT_SECRET_V2 = SCHLUESSEL

hooksRegistrieren()
const zg = hooksMoeglich ? await laden('lib/behoerden/zugriff.ts') : null
const wh = hooksMoeglich ? await laden('lib/sumup/webhook.ts') : null
const gh = hooksMoeglich ? await laden('lib/email/geheimnis.ts') : null
const bk = hooksMoeglich ? await laden('lib/behoerden/besondereKonten.ts') : null
const sk = hooksMoeglich ? await laden('lib/kellerbuch/stoffkonto.ts') : null

after(() => { if (altV2 === undefined) delete process.env.EMAIL_CRYPT_SECRET_V2; else process.env.EMAIL_CRYPT_SECRET_V2 = altV2 })

const T = 't1'
const mitglied = (role, schreibmodule = []) => ({ tenantId: T, role, schreibmodule })
const MODULE_AUS = { modul_ea: false, modul_sumup: false, modul_export: false, modul_controlling: false }
const MODULE_AN = { modul_ea: true, modul_sumup: true, modul_export: true, modul_controlling: true }

describe('Zugriff auf Behördenmeldungen (lib/behoerden/zugriff.ts)', nurMitHooks, () => {
  test('benötigte Module: Auswertungen brauchen Controlling, ein gesetztes Modul zusätzlich, nie doppelt', () => {
    assert.deepEqual(zg.benoetigteModule({ zugriff: 'mitglied' }), [])
    assert.deepEqual(zg.benoetigteModule({ zugriff: 'mitglied', modul: 'modul_export' }), ['modul_export'])
    assert.deepEqual(zg.benoetigteModule({ zugriff: 'auswertungen', modul: 'modul_controlling' }), ['modul_controlling'])
    assert.deepEqual(zg.benoetigteModule({ zugriff: 'auswertungen', modul: 'modul_ea' }), ['modul_controlling', 'modul_ea'])
  })

  test('fehlendes Modul sperrt vor jeder Rolle – auch den Super-Admin', () => {
    assert.match(zg.zugriffsFehler({ zugriff: 'mitglied', modul: 'modul_export' }, mitglied('system_admin'), MODULE_AUS), /„Weinexport“ ist für diesen Betrieb nicht freigeschaltet/)
    assert.match(zg.zugriffsFehler({ zugriff: 'auswertungen' }, mitglied('tenant_admin'), MODULE_AUS), /„Controlling“/)
    assert.equal(zg.zugriffsFehler({ zugriff: 'mitglied', modul: 'modul_export' }, mitglied('leser'), { ...MODULE_AUS, modul_export: true }), null)
  })

  test('Pflichtmeldungen (betriebsleitung): Admin, Manager, Mitarbeiter immer; Leser nur mit Controlling', () => {
    const e = { zugriff: 'betriebsleitung' }
    for (const r of ['system_admin', 'tenant_admin', 'winzer']) assert.equal(zg.zugriffsFehler(e, mitglied(r), MODULE_AUS), null, r)
    assert.match(zg.zugriffsFehler(e, mitglied('leser'), MODULE_AUS), /Leser nur mit Modul „Controlling“/)
    assert.equal(zg.zugriffsFehler(e, mitglied('leser'), { ...MODULE_AUS, modul_controlling: true }), null)
  })

  test('Auswertungen, Schreiben, Verwaltung', () => {
    const ausw = { zugriff: 'auswertungen' }
    assert.match(zg.zugriffsFehler(ausw, mitglied('winzer', ['crm']), MODULE_AN), /Controlling & Frag dein Weingut/)
    assert.equal(zg.zugriffsFehler(ausw, mitglied('winzer', ['auswertungen']), MODULE_AN), null)
    const schreiben = { zugriff: 'schreiben', schreibModul: 'kellerbuch' }
    assert.match(zg.zugriffsFehler(schreiben, mitglied('winzer', ['crm']), MODULE_AN), /Bearbeitungsrecht/)
    assert.equal(zg.zugriffsFehler(schreiben, mitglied('winzer', ['kellerbuch']), MODULE_AN), null)
    assert.match(zg.zugriffsFehler(schreiben, mitglied('leser'), MODULE_AN), /Bearbeitungsrecht/)
    const verw = { zugriff: 'verwaltung' }
    assert.match(zg.zugriffsFehler(verw, mitglied('winzer', ['kellerbuch', 'crm']), MODULE_AN), /nur Betriebs-Manager und Super-Admins/)
    for (const r of ['system_admin', 'tenant_admin']) assert.equal(zg.zugriffsFehler(verw, mitglied(r), MODULE_AN), null, r)
  })

  test('Betrieb und Module laden: nur true zählt, Texte getrimmt, nur der eigene Betrieb; Fehler wirft', async () => {
    const db = datenbank({ tenant_einstellungen: [
      { tenant_id: T, betrieb_name: '  Weingut Test ', betrieb_betriebsnummer: '   ', modul_ea: true, modul_sumup: 'true', modul_export: null, modul_controlling: true },
      { tenant_id: 'anderer', betrieb_name: 'Fremd', modul_ea: true },
    ] })
    assert.deepEqual(await zg.betriebUndModuleLaden(db, T), {
      betrieb: { name: 'Weingut Test', betriebsnummer: null },
      module: { modul_ea: true, modul_sumup: false, modul_export: false, modul_controlling: true },
    })
    assert.ok(db.aufrufe.every(a => hatFilter(a, 'eq', 'tenant_id', T)))
    assert.deepEqual(await zg.betriebUndModuleLaden(datenbank({ tenant_einstellungen: [] }), 'neu'), { betrieb: { name: null, betriebsnummer: null }, module: MODULE_AUS })
    await assert.rejects(zg.betriebUndModuleLaden(datenbank({ tenant_einstellungen: [] }, { vorher: () => ({ error: { message: 'weg' } }) }), T), /Betriebseinstellungen konnten nicht geladen werden: weg/)
  })

  test('erlaubte Meldungen der aktiven Mitgliedschaft: ohne Mitgliedschaft keine, Leser ohne Controlling weniger als der Manager', async () => {
    const { KATALOG_LISTE } = await laden('lib/behoerden/katalog.ts')
    globalThis.__serverFake = datenbank({ tenant_einstellungen: [{ tenant_id: T, modul_ea: false, modul_sumup: false, modul_export: false, modul_controlling: false }] })
    try {
      globalThis.__membership = null
      assert.deepEqual(await zg.erlaubteMeldungen(), [])
      globalThis.__membership = mitglied('tenant_admin')
      const manager = await zg.erlaubteMeldungen()
      globalThis.__membership = mitglied('leser')
      const leser = await zg.erlaubteMeldungen()
      assert.ok(manager.length > 0 && leser.length < manager.length, `${leser.length} < ${manager.length}`)
      assert.ok(leser.every(e => e.zugriff === 'mitglied' && !e.modul), 'Leser ohne Controlling: nur Meldungen für alle Mitglieder ohne Modul')
      const ohneModul = KATALOG_LISTE.filter(e => zg.benoetigteModule(e).length === 0 && e.zugriff !== 'verwaltung' && e.zugriff !== 'schreiben')
      assert.ok(ohneModul.every(e => manager.includes(e)), 'Manager sieht alle Pflicht- und Mitgliedermeldungen ohne Modul')
    } finally { globalThis.__membership = null; globalThis.__serverFake = null }
  })
})

describe('SumUp-Webhook-URL (lib/sumup/webhook.ts)', nurMitHooks, () => {
  const TEN = '11111111-1111-4111-8111-111111111111'
  const CO = '22222222-2222-4222-8222-222222222222'
  const params = url => new URL(url).searchParams

  test('signierte URL wird angenommen; Basis mit oder ohne Schrägstrich', () => {
    const url = wh.sumupWebhookUrl('https://app.example.at/', TEN, CO)
    assert.match(url, /^https:\/\/app\.example\.at\/api\/sumup\/webhook\?tenant_id=/)
    assert.equal(url, wh.sumupWebhookUrl('https://app.example.at', TEN, CO))
    assert.deepEqual(wh.pruefeSumupWebhook(params(url)), { tenantId: TEN, checkoutId: CO })
  })

  test('jede Abweichung wird abgelehnt: anderer Betrieb, anderer Checkout, veränderte/fehlende/kürzere Signatur, keine UUID', () => {
    const p = params(wh.sumupWebhookUrl('https://x.at', TEN, CO))
    const mit = (k, v) => { const q = new URLSearchParams(p); if (v === null) q.delete(k); else q.set(k, v); return q }
    const andere = '33333333-3333-4333-8333-333333333333'
    assert.equal(wh.pruefeSumupWebhook(mit('tenant_id', andere)), null)
    assert.equal(wh.pruefeSumupWebhook(mit('checkout', andere)), null)
    const sig = p.get('sig')
    assert.equal(wh.pruefeSumupWebhook(mit('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1))), null)
    assert.equal(wh.pruefeSumupWebhook(mit('sig', sig.slice(1))), null)
    assert.equal(wh.pruefeSumupWebhook(mit('sig', null)), null)
    assert.equal(wh.pruefeSumupWebhook(mit('tenant_id', 'kein-uuid')), null)
    assert.equal(wh.pruefeSumupWebhook(new URLSearchParams()), null)
  })

  test('anderer Schlüssel → alte URLs ungültig', () => {
    const url = wh.sumupWebhookUrl('https://x.at', TEN, CO)
    process.env.EMAIL_CRYPT_SECRET_V2 = SCHLUESSEL + '-neu'
    try { assert.equal(wh.pruefeSumupWebhook(params(url)), null) } finally { process.env.EMAIL_CRYPT_SECRET_V2 = SCHLUESSEL }
  })
})

describe('Geheimnisse in den Einstellungen (lib/email/geheimnis.ts)', nurMitHooks, () => {
  test('lesen: leer → null, Altbestand im Klartext unverändert, v2 entschlüsselt', () => {
    assert.equal(gh.geheimLesen(null), null)
    assert.equal(gh.geheimLesen(''), null)
    assert.equal(gh.geheimLesen('klartext-key'), 'klartext-key')
    const enc = gh.geheimSpeichern('xkeysib-123')
    assert.match(enc, /^v2:/)
    assert.equal(gh.geheimLesen(enc), 'xkeysib-123')
  })

  test('Maske an den Browser, nie der Wert', () => {
    assert.equal(gh.geheimMaskiert('v2:abc'), gh.GEHEIM_MASKE)
    assert.equal(gh.geheimMaskiert(null), null)
    assert.equal(gh.geheimMaskiert(''), null)
  })

  test('speichern: Maske/fehlendes Feld = unverändert, leer = löschen, sonst getrimmt verschlüsselt', () => {
    assert.equal(gh.geheimSpeichern(null), undefined)
    assert.equal(gh.geheimSpeichern(gh.GEHEIM_MASKE), undefined)
    assert.equal(gh.geheimSpeichern(`  ${gh.GEHEIM_MASKE} `), undefined)
    assert.equal(gh.geheimSpeichern('   '), null)
    assert.equal(gh.geheimLesen(gh.geheimSpeichern('  sup_sk_1  ')), 'sup_sk_1')
  })

  test('geheimFeld: unverändert lässt die Spalte weg (nie „unverändert“ → löschen)', () => {
    assert.deepEqual(gh.geheimFeld('brevo_api_key', gh.GEHEIM_MASKE), {})
    assert.deepEqual(gh.geheimFeld('brevo_api_key', null), {})
    assert.deepEqual(gh.geheimFeld('brevo_api_key', ''), { brevo_api_key: null })
    const f = gh.geheimFeld('brevo_api_key', 'neu')
    assert.deepEqual(Object.keys(f), ['brevo_api_key'])
    assert.equal(gh.geheimLesen(f.brevo_api_key), 'neu')
  })
})

describe('Besondere Konten (lib/behoerden/besondereKonten.ts)', nurMitHooks, () => {
  const daten = () => ({
    kellermittel: [
      { id: 'k1', tenant_id: T, name: 'Schwefel', einheit: 'g', aktiv: true },
      { id: 'k2', tenant_id: T, name: 'Bentonit', einheit: 'kg', aktiv: false },   // ohne Buchung → keine Zeile
      { id: 'k3', tenant_id: T, name: 'Ascorbinsäure', einheit: 'g', aktiv: true },
      { id: 'kf', tenant_id: 'anderer', name: 'Fremd', einheit: 'g', aktiv: true },
    ],
    kellermittel_buchungen: [
      { id: 'b1', tenant_id: T, kellermittel_id: 'k1', datum: '2025-06-01', art: 'zugang', menge: '10', erstellt_am: '2025-06-01T08:00:00Z', lieferant: 'Lager AG', beleg: '0815', weinausbau: null, behaelter: null },
      { id: 'b2', tenant_id: T, kellermittel_id: 'k1', datum: '2025-09-01', art: 'verwendung', menge: -3, erstellt_am: '2025-09-01T08:00:00Z', weinausbau: { name: 'GV 2025' }, behaelter: { name: 'Tank 4' } },
      { id: 'b3', tenant_id: T, kellermittel_id: 'k1', datum: '2025-09-02', art: 'storno', menge: 3, storno_von_id: 'b2', erstellt_am: '2025-09-02T08:00:00Z', weinausbau: null, behaelter: null },
      { id: 'b4', tenant_id: T, kellermittel_id: 'k1', datum: '2026-08-05', art: 'zugang', menge: 99, erstellt_am: null, weinausbau: null, behaelter: null },   // nach dem Wirtschaftsjahr
      { id: 'b5', tenant_id: T, kellermittel_id: 'k3', datum: '2026-01-10', art: 'verwendung', menge: -2, erstellt_am: null, weinausbau: null, behaelter: null },
      { id: 'bf', tenant_id: 'anderer', kellermittel_id: 'kf', datum: '2025-09-01', art: 'zugang', menge: 5, weinausbau: null, behaelter: null },
    ],
  })

  test('Weinwirtschaftsjahr 2025/26: Übertrag, Buchungen mit Saldo, Storno gekennzeichnet, spätere Buchungen und fremde Betriebe nicht', async () => {
    const r = await bk.ladeBesondereKonten(datenbank(daten()), T, 2025)
    const zeilen = r.zeilen.map(z => [z.stoff, z.datum, z.art, z.menge, z.saldo, z.charge, z.behaelter, z.storniert])
    assert.deepEqual(zeilen, [
      ['Ascorbinsäure', '2025-08-01', 'Übertrag', 0, 0, null, null, false],
      ['Ascorbinsäure', '2026-01-10', sk.KONTO_ART_LABEL.verwendung, -2, -2, null, null, false],
      ['Schwefel', '2025-08-01', 'Übertrag', 10, 10, null, null, false],
      ['Schwefel', '2025-09-01', sk.KONTO_ART_LABEL.verwendung, -3, 7, 'GV 2025', 'Tank 4', true],
      ['Schwefel', '2025-09-02', sk.KONTO_ART_LABEL.storno, 3, 10, null, null, false],
    ])
    assert.deepEqual(r.warnungen, ['Ascorbinsäure: Negativer Bestand ab 10.01.2026 – Zugang oder Anfangsbestand fehlt.'])
  })

  test('Stoffe alphabetisch, Buchungen je Stoff; Fehler werfen', async () => {
    assert.deepEqual((await bk.ladeStoffe(datenbank(daten()), T)).map(s => [s.name, s.aktiv]), [['Ascorbinsäure', true], ['Bentonit', false], ['Schwefel', true]])
    const nurK1 = await bk.ladeKontoBuchungen(datenbank(daten()), T, 'k1')
    assert.deepEqual(nurK1.map(b => [b.id, b.menge, b.lieferant]), [['b1', 10, 'Lager AG'], ['b2', -3, null], ['b3', 3, null], ['b4', 99, null]])
    const kaputt = tab => datenbank(daten(), { vorher: e => (e.tabelle === tab ? { error: { message: 'x' } } : null) })
    await assert.rejects(bk.ladeBesondereKonten(kaputt('kellermittel'), T, 2025), /Stoffe konnten nicht geladen werden \(x\)/)
    await assert.rejects(bk.ladeBesondereKonten(kaputt('kellermittel_buchungen'), T, 2025), /Buchungen konnten nicht geladen werden \(x\)/)
  })

  test('CSV-Spalten: Menge und Saldo mit 3 Stellen, Beleg und Los als Code', () => {
    const k = Object.fromEntries(bk.SPALTEN_BESONDERE_KONTEN.map(s => [s.kopf, s]))
    assert.deepEqual([k.Menge.stellen, k.Saldo.stellen, k.Beleg.typ, k.Los.typ, k.Storniert.typ], [3, 3, 'code', 'code', 'janein'])
  })
})
