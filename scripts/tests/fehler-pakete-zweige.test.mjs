// Abdeckung der offenen Zweige (STABILITAET.md, Lücke 5; KAN-247, 09.10.2026):
//  - lib/fehler.ts (56 % Branches): fehlerText mit digest/maskierter Next-Meldung/Text, dbFehlerText je Fehlercode
//  - lib/pakete.ts (60 % Branches, 29 % Funktionen): Stripe-Preis-ID → Paket (auch Alt-Preise), stripe_plan → Paket
//    (auch alte Slugs), Beschriftungen – daran hängt nach dem Stripe-Start, welche Module ein Betrieb bekommt.
//
// Aufruf:  npm run -s test:csv

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AktionsFehler, fehlerText, dbFehlerText, LESE_WAEHLEN_MELDUNG, PAKETMODUL_AUS_MELDUNG } from '../../src/lib/fehler.ts'
import { paketPriceId, paketFromPriceId, paketAusPlan, paketLabel, preisText, istPaketKey, PAKETE, PAKET_REIHENFOLGE } from '../../src/lib/pakete.ts'

describe('fehlerText', () => {
  test('AktionsFehler: Meldung über digest – auch wenn Next.js die message maskiert', () => {
    const e = new AktionsFehler('Speichern fehlgeschlagen: Grund fehlt')
    e.message = 'An error occurred in the Server Components render. The specific message is omitted'
    assert.equal(fehlerText(e), 'Speichern fehlgeschlagen: Grund fehlt')
  })
  test('maskierte Next-Meldung ohne digest → Ersatztext, nie die Maske', () => {
    const e = new Error('An error occurred in the Server Components render. …')
    assert.equal(fehlerText(e), 'Unerwarteter Fehler – bitte erneut versuchen.')
    assert.equal(fehlerText(e, 'Speichern fehlgeschlagen'), 'Speichern fehlgeschlagen')
  })
  test('Text, leere Meldung, Nicht-Fehler', () => {
    assert.equal(fehlerText('Netzwerkfehler'), 'Netzwerkfehler')
    assert.equal(fehlerText({ message: '   ' }, 'Ersatz'), 'Ersatz')
    assert.equal(fehlerText(null, 'Ersatz'), 'Ersatz')
    assert.equal(fehlerText('  ', 'Ersatz'), 'Ersatz')
    assert.equal(fehlerText(42, 'Ersatz'), 'Ersatz')
  })
  test('englische RLS-Meldung wird übersetzt', () => {
    assert.doesNotMatch(fehlerText(new Error('new row violates row-level security policy for table "kontakte"')), /row-level security/)
  })
})

describe('dbFehlerText', () => {
  test('ohne Fehler: mit bzw. ohne Kontext', () => {
    assert.equal(dbFehlerText(null), 'Unbekannter Datenbankfehler')
    assert.equal(dbFehlerText(undefined, 'Speichern'), 'Speichern: unbekannter Fehler')
  })
  test('23514: Prüfregel mit Tabelle; RAISE-Text unverändert; ohne Text mit Kontext', () => {
    const t = dbFehlerText({ code: '23514', message: 'new row for relation "lagen" violates check constraint "xyz_check"' })
    assert.match(t, /Prüfregel der Datenbank \(„xyz_check“ auf „lagen“\)/)
    assert.equal(dbFehlerText({ code: '23514', message: 'Die Menge übersteigt den Bestand.' }), 'Die Menge übersteigt den Bestand.')
    assert.equal(dbFehlerText({ code: '23514', message: '' }, 'Buchen'), 'Buchen: Die Eingabe verletzt eine Prüfregel der Datenbank.')
  })
  test('23502 mit HINT lese_waehlen, 42501 mit HINT paketmodul_aus', () => {
    assert.equal(dbFehlerText({ code: '23502', message: 'null value', hint: 'lese_waehlen' }), LESE_WAEHLEN_MELDUNG)
    assert.equal(dbFehlerText({ code: '42501', message: 'x', hint: 'paketmodul_aus' }), PAKETMODUL_AUS_MELDUNG)
  })
  test('23503: Löschen gesperrt bzw. Verweis fehlt; ohne erkennbaren Text Ersatz', () => {
    const loeschen = dbFehlerText({ code: '23503', message: 'update or delete on table "foo" violates foreign key constraint "bar_fk" on table "baz"' })
    assert.match(loeschen, /„foo“ kann nicht gelöscht oder geändert werden: Der Datensatz wird noch von „baz“ verwendet/)
    const einfuegen = dbFehlerText({ code: '23503', message: 'insert or update on table "foo" violates foreign key constraint "bar_fk"' })
    assert.match(einfuegen, /verknüpfte Datensatz existiert nicht \(mehr\)/)
    assert.equal(dbFehlerText({ code: '23503', message: '' }, 'Löschen'), 'Löschen: Der Datensatz wird noch von anderen Buchungen verwendet.')
  })
  test('PGRST202: Funktion nicht gefunden – mit und ohne Funktionsnamen', () => {
    assert.match(dbFehlerText({ code: 'PGRST202', message: 'Could not find the function public.s112_x(p_a) in the schema cache' }, 'Buchen'),
      /^Buchen: Datenbankfunktion „public\.s112_x“ mit diesen Parametern nicht gefunden/)
    assert.match(dbFehlerText({ code: 'PGRST202', message: 'nichts' }), /^Datenbankfunktion mit diesen Parametern/)
  })
  test('eigene deutsche Meldungen (P0001, 42501 …) unverändert, sonst mit Kontext', () => {
    assert.equal(dbFehlerText({ code: 'P0001', message: 'Zeitraum ist gesperrt.' }, 'Buchen'), 'Zeitraum ist gesperrt.')
    assert.equal(dbFehlerText({ code: '55000', message: 'Objekt in Benutzung' }, 'X'), 'Objekt in Benutzung')
    assert.equal(dbFehlerText({ code: 'XX000', message: 'kaputt' }, 'Buchen'), 'Buchen: kaputt')
    assert.equal(dbFehlerText({ code: 'XX000' }, 'Buchen'), 'Buchen: unbekannter Datenbankfehler')
    assert.equal(dbFehlerText('roher Text'), 'roher Text')
  })
})

describe('Pakete: Stripe-Preis-IDs und Plan-Slugs', () => {
  const ENV = ['BASIS', 'STANDARD', 'PREMIUM', 'PROFESSIONAL', 'PROFESSIONAL_PLUS', 'ENTERPRISE'].map(k => `NEXT_PUBLIC_STRIPE_PRICE_${k}`)
  let vorher
  beforeEach(() => {
    vorher = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    for (const k of ENV) process.env[k] = 'price_' + k.slice('NEXT_PUBLIC_STRIPE_PRICE_'.length).toLowerCase()
  })
  afterEach(() => { for (const k of ENV) { if (vorher[k] === undefined) delete process.env[k]; else process.env[k] = vorher[k] } })

  test('Preis-ID je Paket und zurück', () => {
    for (const p of PAKET_REIHENFOLGE) {
      assert.equal(paketPriceId(p), `price_${p}`)
      assert.equal(paketFromPriceId(`price_${p}`), p)
    }
  })
  test('Alt-Preise: Professional → Standard, Professional+ und Enterprise → Premium; unbekannt bzw. leer → null', () => {
    assert.equal(paketFromPriceId('price_professional'), 'standard')
    assert.equal(paketFromPriceId('price_professional_plus'), 'premium')
    assert.equal(paketFromPriceId('price_enterprise'), 'premium')
    assert.equal(paketFromPriceId('price_fremd'), null)
    assert.equal(paketFromPriceId(''), null)
    assert.equal(paketFromPriceId(null), null)
  })
  test('ohne gesetzte Preis-IDs: nichts trifft – auch keine leere ID (sonst bekäme jedes Abo ohne Preis ein Paket)', () => {
    for (const k of ENV) delete process.env[k]
    assert.equal(paketPriceId('premium'), '')
    assert.equal(paketFromPriceId('price_premium'), null)
  })
  test('stripe_plan: Paket-Schlüssel, alte KI-Slugs, base/unbekannt', () => {
    assert.equal(paketAusPlan('standard'), 'standard')
    assert.equal(paketAusPlan('ki_basic'), 'standard')
    assert.equal(paketAusPlan('ki_standard'), 'premium')
    assert.equal(paketAusPlan('ki_unlimited'), 'premium')
    assert.equal(paketAusPlan('base'), null)
    assert.equal(paketAusPlan(undefined), null)
    assert.equal(istPaketKey('premium'), true)
    assert.equal(istPaketKey('Premium'), false)
  })
  test('Beschriftungen', () => {
    assert.equal(paketLabel('premium'), `software:112 ${PAKETE.premium.label}`)
    assert.equal(paketLabel('ki_basic'), `software:112 ${PAKETE.standard.label}`)
    assert.equal(paketLabel(null), 'Kein Paket')
    assert.equal(preisText(PAKETE.basis), `${PAKETE.basis.preisMonat} € / Monat`)
  })
})
