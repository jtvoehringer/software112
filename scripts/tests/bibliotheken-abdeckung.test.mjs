// STABILITAET.md Punkt „Bibliotheken unter 70 % Abdeckung“ (09.10.2026):
//   lib/svs/berechnung.ts (SVS-Beiträge, bisher keine Funktion getestet), lib/ea/betriebsbeginn.ts,
//   lib/email/crypto.ts (Zugangsdaten v1/v2) und ladeErnteSperren aus lib/behandlungen/ernteSperre.ts.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank, hatFilter } from './buchung-attrappe.mjs'

hooksRegistrieren()
const svs = hooksMoeglich ? await laden('lib/svs/berechnung.ts') : null
const bb = hooksMoeglich ? await laden('lib/ea/betriebsbeginn.ts') : null

// Erfundene, leicht nachrechenbare Sätze – nicht die echten SVS-Werte (die kommen aus svs_parameter)
const P = {
  jahr: 2026, staffel: [{ bis: 10000, prozent: 10 }, { bis: null, prozent: 20 }],
  satz_pv: 22.8, satz_kv: 7.65, satz_uv: 1.9, satz_bh: 0.4, satz_kv_zusatz: 3.4,
  min_bg_kv_pv: 600, min_bg_uv: 1000, hoechst_bg: 7000,
}

describe('SVS-Beiträge (lib/svs/berechnung.ts)', nurMitHooks, () => {
  test('Zurechnungsfaktor je Art; jede Art hat eine Beschriftung', () => {
    assert.deepEqual(['eigen', 'pacht_fremd', 'pacht_angehoerige', 'verpachtet', 'keine'].map(svs.zurechnungsfaktor), [1, 2 / 3, 1, -1, 0])
    assert.deepEqual(Object.keys(svs.ZURECHNUNG_LABEL).sort(), ['eigen', 'keine', 'pacht_angehoerige', 'pacht_fremd', 'verpachtet'])
  })

  test('Einheitswerte: Fremdpacht zu 2/3, Angehörige voll, Verpachtetes abgezogen, ohne Angabe = Eigentum', () => {
    const s = svs.summiereEinheitswerte([
      { einheitswert: 9000, svs_zurechnung: 'eigen' },
      { einheitswert: 1000, svs_zurechnung: null },            // ohne Zurechnung = Eigentum
      { einheitswert: 3000, svs_zurechnung: 'pacht_fremd' },
      { einheitswert: 1000, svs_zurechnung: 'pacht_angehoerige' },
      { einheitswert: 500, svs_zurechnung: 'verpachtet' },
      { einheitswert: 99999, svs_zurechnung: 'keine' },        // zählt nicht, auch nicht als „ohne Wert“
      { einheitswert: null, svs_zurechnung: 'eigen' },
      { einheitswert: 0, svs_zurechnung: 'pacht_fremd' },
    ])
    assert.deepEqual([s.eigen, s.pachtFremd, s.pachtAngehoerige, s.verpachtet, s.ohneWert], [10000, 3000, 1000, 500, 2])
    assert.ok(Math.abs(s.massgebend - 12500) < 1e-9, String(s.massgebend))
    assert.equal(svs.summiereEinheitswerte([{ einheitswert: 100, svs_zurechnung: 'eigen' }, { einheitswert: 900, svs_zurechnung: 'verpachtet' }]).massgebend, 0, 'nie unter 0')
  })

  test('Versicherungswert gestaffelt: jede Stufe nur mit ihrem Anteil; negativ = 0; offene letzte Stufe', () => {
    assert.equal(svs.versicherungswert(15000, P.staffel), 2000)        // 10000 × 10 % + 5000 × 20 %
    assert.equal(svs.versicherungswert(8000, P.staffel), 800)
    assert.equal(svs.versicherungswert(-5, P.staffel), 0)
    assert.equal(svs.versicherungswert(30000, [{ bis: 10000, prozent: 10 }]), 1000, 'über der letzten begrenzten Stufe zählt nichts')
    assert.equal(svs.versicherungswert(333, [{ bis: null, prozent: 3.3333 }]), 11.1, 'auf Cent gerundet')
  })

  test('Beiträge: Sätze je Zweig, Mindest- und Höchstgrundlage, eigene UV-Mindestgrundlage, KV-Zusatz für Angehörige', () => {
    const b = svs.beitraege(2000, P)
    assert.deepEqual([b.beitragsgrundlage, b.bgUv, b.pv, b.kv, b.uv, b.bh, b.kvZusatz, b.monat, b.jahr, b.begrenzt], [2000, 2000, 456, 153, 38, 8, 0, 655, 7860, null])
    assert.equal(svs.beitraege(2000, P, true).kvZusatz, 68)
    assert.equal(svs.beitraege(2000, P, true).monat, 723)
    const min = svs.beitraege(100, P)
    assert.deepEqual([min.beitragsgrundlage, min.bgUv, min.uv, min.monat, min.begrenzt], [600, 1000, 19, 204.1, 'min'])
    const max = svs.beitraege(9000, P)
    assert.deepEqual([max.beitragsgrundlage, max.bgUv, max.monat, max.begrenzt], [7000, 7000, 2292.5, 'max'])
  })

  test('Option: (Einkünfte + bezahlte KV/PV) / 12, nie negativ', () => {
    assert.equal(svs.optionsGrundlage(12000, 2400), 1200)
    assert.equal(svs.optionsGrundlage(-50000, 0), 0)
  })

  test('Vergleich Pauschal ↔ Option: bezahlte KV/PV aus den Pauschalbeiträgen, Ersparnis = Pauschal − Option', () => {
    const gst = [{ einheitswert: 15000, svs_zurechnung: 'eigen' }]
    const ohne = svs.vergleiche(gst, P, { einkuenfteJahr: null })
    assert.deepEqual([ohne.versicherungswert, ohne.pauschal.monat, ohne.option, ohne.optionEinkuenfte, ohne.ersparnisOptionJahr], [2000, 655, null, null, null])
    const mit = svs.vergleiche(gst, P, { einkuenfteJahr: 12000 })
    // bezahlt = (456 + 153) × 12 = 7308 → Grundlage (12000 + 7308) / 12 = 1609
    assert.equal(mit.option.beitragsgrundlage, 1609)
    assert.equal(mit.optionEinkuenfte, 12000)
    assert.equal(mit.ersparnisOptionJahr, Math.round((mit.pauschal.jahr - mit.option.jahr) * 100) / 100)
    assert.ok(mit.ersparnisOptionJahr > 0)
    assert.equal(svs.vergleiche(gst, P, { einkuenfteJahr: 0 }).option.beitragsgrundlage, 609, 'Einkünfte 0 ist eine Angabe, keine fehlende')
  })
})

describe('Betriebsbeginn der E/A-Rechnung (lib/ea/betriebsbeginn.ts)', nurMitHooks, () => {
  test('Monat nur „vor Beginn“, wenn er vollständig davor endet; ohne bzw. ungültiger Beginn = keine Einschränkung', () => {
    assert.equal(bb.monatVorBeginn(2026, 1, '2026-02-01'), true)
    assert.equal(bb.monatVorBeginn(2026, 2, '2026-02-15'), false, 'Beginnmonat selbst zählt')
    assert.equal(bb.monatVorBeginn(2026, 3, '2026-02-15'), false)
    assert.equal(bb.monatVorBeginn(2025, 12, '2026-01-01'), true, 'Jahreswechsel')
    assert.equal(bb.monatVorBeginn(2026, 1, null), false)
    assert.equal(bb.monatVorBeginn(2026, 1, undefined), false)
    assert.equal(bb.monatVorBeginn(2026, 1, 'kein Datum'), false)
  })

  test('UVA-Perioden: Quartal = drei Monate, Monat = einer; Periode nur vor Beginn, wenn ihr letzter Monat davor endet', () => {
    assert.deepEqual(bb.monateDerPeriode('Q1'), [1, 2, 3])
    assert.deepEqual(bb.monateDerPeriode('Q4'), [10, 11, 12])
    assert.deepEqual(bb.monateDerPeriode('05'), [5])
    assert.equal(bb.periodeVorBeginn(2026, 'Q1', '2026-04-01'), true)
    assert.equal(bb.periodeVorBeginn(2026, 'Q1', '2026-03-15'), false, 'Beginn im März – Q1 braucht eine UVA')
    assert.equal(bb.periodeVorBeginn(2026, '02', '2026-03-01'), true)
    assert.equal(bb.periodeVorBeginn(2026, 'Q2', null), false)
  })
})

describe('Verschlüsselung der Zugangsdaten (lib/email/crypto.ts)', nurMitHooks, () => {
  test('v1 (CBC) und v2 (GCM) lesbar, v2 bei gesetztem neuem Schlüssel, Manipulation fällt auf, Schlüssel-Prüfungen', async () => {
    const alt = { v1: process.env.EMAIL_CRYPT_SECRET, v2: process.env.EMAIL_CRYPT_SECRET_V2 }
    try {
      delete process.env.EMAIL_CRYPT_SECRET
      delete process.env.EMAIL_CRYPT_SECRET_V2
      const c = await laden('lib/email/crypto.ts')
      assert.equal(c.v2Aktiv(), false)
      assert.throws(() => c.encryptPass('x'), /EMAIL_CRYPT_SECRET fehlt/, 'kein Ersatzschlüssel im Quellcode')
      process.env.EMAIL_CRYPT_SECRET = 'kurz'
      assert.throws(() => c.encryptPass('x'), /zu kurz/)

      process.env.EMAIL_CRYPT_SECRET = 'alter-schluessel-1234567890'
      const v1 = c.encryptPass('Pässwort€')
      assert.match(v1, /^[0-9a-f]{32}:[0-9a-f]+$/)
      assert.equal(c.istV2(v1), false)
      assert.equal(c.decryptPass(v1), 'Pässwort€')
      assert.notEqual(c.encryptPass('Pässwort€'), v1, 'zufälliger IV')
      const hmacAlt = c.unterschluessel('oauth-state')

      process.env.EMAIL_CRYPT_SECRET_V2 = 'zu-kurz-fuer-v2'
      assert.throws(() => c.v2Aktiv(), /mind\. 32 Zeichen/)
      process.env.EMAIL_CRYPT_SECRET_V2 = 'neuer-schluessel-mit-mindestens-32-zeichen'
      assert.equal(c.v2Aktiv(), true)
      const v2 = c.encryptPass('Pässwort€')
      assert.match(v2, /^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/)
      assert.equal(c.istV2(v2), true)
      assert.equal(c.decryptPass(v2), 'Pässwort€')
      assert.equal(c.decryptPass(v1), 'Pässwort€', 'alte Werte bleiben lesbar')
      const teile = v2.split(':')
      teile[3] = (teile[3][0] === '0' ? '1' : '0') + teile[3].slice(1)
      assert.throws(() => c.decryptPass(teile.join(':')), 'GCM erkennt veränderte Daten')

      assert.equal(c.istV2(null), false)
      assert.equal(c.istV2(undefined), false)
      const hmacNeu = c.unterschluessel('oauth-state')
      assert.equal(hmacNeu.length, 32)
      assert.notDeepEqual(hmacNeu, hmacAlt, 'nimmt den neuen Schlüssel, sobald gesetzt')
      assert.notDeepEqual(c.unterschluessel('anderer-zweck'), hmacNeu)
      assert.deepEqual(c.unterschluessel('oauth-state'), hmacNeu)
    } finally {
      for (const [k, v] of [['EMAIL_CRYPT_SECRET', alt.v1], ['EMAIL_CRYPT_SECRET_V2', alt.v2]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v
      }
    }
  })
})

describe('Ernte-Sperre der Maßnahmen laden (ladeErnteSperren)', nurMitHooks, () => {
  const T = 't1'
  const jg = { tenant_id: T }
  const tabellen = () => ({
    ernte_parzellen: [
      { id: 'e1', weingarten_id: 'A', grundstueck_id: null, ernte_datum: '2026-09-20', storniert_am: null, jahrgang: jg },
      { id: 'e2', weingarten_id: 'A', grundstueck_id: null, ernte_datum: '2026-09-10', storniert_am: '2026-09-11', jahrgang: jg },  // storniert
      { id: 'e3', weingarten_id: null, grundstueck_id: 'gB', ernte_datum: '2026-10-01T00:00:00', storniert_am: null, jahrgang: jg },  // über das Grundstück
      { id: 'e4', weingarten_id: 'C', grundstueck_id: null, ernte_datum: '2026-09-01', storniert_am: null, jahrgang: { tenant_id: 'anderer' } },
      { id: 'e5', weingarten_id: 'C', grundstueck_id: null, ernte_datum: null, storniert_am: null, jahrgang: jg },  // ohne Datum
    ],
    grundstuecke: [{ id: 'gB', tenant_id: T, weingarten_id: 'B' }],
  })

  test('direkte Lese, Lese über ein Grundstück, stornierte und fremde Lesen zählen nicht', async () => {
    const { ladeErnteSperren } = await laden('lib/behandlungen/ernteSperre.ts')
    const db = datenbank(tabellen())
    const r = await ladeErnteSperren(db, T, [
      { id: 'm1', datum: '2026-07-01', rieden: ['A'] },
      { id: 'm2', datum: '2026-09-15', rieden: ['B'] },
      { id: 'm3', datum: '2026-07-01', rieden: ['C'] },
      { id: 'm4', datum: '2026-09-21', rieden: ['A'] },
      { id: 'm5', datum: null, rieden: ['A'] },
    ])
    assert.deepEqual([...r.entries()].sort(), [['m1', '2026-09-20'], ['m2', '2026-10-01']])
    assert.ok(db.aufrufe.filter(a => a.tabelle === 'ernte_parzellen').every(a => hatFilter(a, 'eq', 'jahrgang.tenant_id', T)))
    assert.ok(db.aufrufe.filter(a => a.tabelle === 'grundstuecke').every(a => hatFilter(a, 'eq', 'tenant_id', T)))
  })

  test('ohne Rieden mit Datum keine Abfrage; Datenbankfehler wirft (keine Teilmenge = „frei“)', async () => {
    const { ladeErnteSperren } = await laden('lib/behandlungen/ernteSperre.ts')
    const leer = datenbank(tabellen())
    assert.equal((await ladeErnteSperren(leer, T, [{ id: 'm', datum: null, rieden: ['A'] }])).size, 0)
    assert.equal(leer.aufrufe.length, 0)
    for (const [tab, nr, meldung] of [['ernte_parzellen', 1, /Lesen konnten nicht/], ['grundstuecke', 1, /Grundstücke konnten nicht/], ['ernte_parzellen', 2, /Lesen konnten nicht/]]) {
      let n = 0
      const db = datenbank(tabellen(), { vorher: e => (e.tabelle === tab && ++n === nr ? { error: { message: 'kaputt' } } : null) })
      await assert.rejects(ladeErnteSperren(db, T, [{ id: 'm1', datum: '2026-07-01', rieden: ['A', 'B'] }]), meldung)
    }
  })
})
