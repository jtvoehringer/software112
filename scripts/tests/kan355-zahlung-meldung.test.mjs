// KAN-355 (22.10.2026) – Zahlung mit Datum in einem abgeschlossenen Monat: Die Datenbank lehnt richtig ab (Trigger
// a_ea_periodensperre, 42501), aber createZahlung warf, und die Formulare (Verkaufsseite: reines <form action>, Offene
// Posten: ohne catch) führten auf die Fehlerseite – „Zur Meldung“ im Pop-up ging ins Leere. Jetzt: erwartbare Ablehnungen
// als { error }, gemeinsames Client-Formular ZahlungErfassen mit Meldung (role="alert"), Eingaben bleiben stehen;
// MeldungsPopup sucht einen ersetzten Meldungskasten neu; ist keiner mehr da, schließt sich der Hinweis (KAN-359 Nachtrag).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['@/lib/auth/seitenBetrieb'] = modul('export const pruefeSeitenBetrieb = async () => {}; export const seitenBetriebFehler = async () => null')
DOPPEL['@/lib/auth/sperren'] = modul('export const pruefeSchreibzugriff = async () => {}; export const schreibSperreFehler = async () => null')
DOPPEL['@/lib/auth/modul'] = modul('export const pruefeModul = async () => {}; export const hatModul = async () => true')
DOPPEL['next/navigation'] = modul("export const redirect = u => { throw Object.assign(new Error('NEXT_REDIRECT'), { ziel: u }) }")
hooksRegistrieren()

const quelle = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const verkauf = hooksMoeglich ? await laden('app/(dashboard)/weinhandel/verkauf/actions.ts') : null
const fehler = hooksMoeglich ? await laden('lib/fehler.ts') : null
const meldungen = hooksMoeglich ? await laden('lib/ui/meldungen.ts') : null

const T = '00000000-0000-4000-8000-000000000001'
const V = '00000000-0000-4000-8000-0000000000b1'
const SPERRE = 'Buchung mit Datum 15.09.2026 nicht möglich: Der Monat 09/2026 ist abgeschlossen. Bitte ein Datum im offenen Zeitraum wählen.'
const fd = (f = {}) => { const d = new FormData(); for (const [k, w] of Object.entries(f)) d.set(k, w); return d }
const zahlungsDb = (dbFehler) => {
  const d = datenbank({ zahlungen: [] }, {
    vorher: e => (e.tabelle === 'zahlungen' && e.art === 'insert' && dbFehler ? { error: dbFehler } : null),
  })
  globalThis.__serverFake = d
  return d
}

beforeEach(() => { globalThis.__membership = { tenantId: T, role: 'tenant_admin', schreibmodule: null } })

describe('KAN-355: createZahlung gibt erwartbare Ablehnungen zurück', nurMitHooks, () => {
  test('Periodensperre (42501) → { error } mit der Meldung der Datenbank, kein Wurf', async () => {
    zahlungsDb({ code: '42501', message: SPERRE })
    const r = await verkauf.createZahlung(V, fd({ betrag: '120,50', art: 'bank', datum: '2026-09-15' }))
    assert.deepEqual(r, { error: SPERRE })
  })
  test('ungültiger Betrag → { error } vor jedem Schreiben', async () => {
    const d = zahlungsDb(null)
    const r = await verkauf.createZahlung(V, fd({ betrag: '0', art: 'bar', datum: '2026-10-01' }))
    assert.match(r.error, /Ungültiger Betrag/)
    assert.equal(d.aufrufe.filter(a => a.art === 'insert').length, 0)
  })
  test('unerwarteter Datenbankfehler wird weiter geworfen (Systemprotokoll)', async () => {
    zahlungsDb({ code: 'XX000', message: 'interner Fehler' })
    await assert.rejects(() => verkauf.createZahlung(V, fd({ betrag: '10', art: 'bar', datum: '2026-10-01' })), /interner Fehler/)
  })
  test('erwarteteDbAblehnung: Sperren, Prüfregeln und eigene Meldungen ja, Unbekanntes nein', () => {
    for (const code of ['42501', '23514', '23503', '22023', 'P0001', 'P0002', '55000']) assert.equal(fehler.erwarteteDbAblehnung({ code }), true, code)
    for (const e of [{ code: 'XX000' }, { code: '08006' }, {}, null, 'text']) assert.equal(fehler.erwarteteDbAblehnung(e), false, JSON.stringify(e))
  })
})

describe('KAN-355: Formulare zeigen die Meldung statt der Fehlerseite', () => {
  test('ZahlungErfassen: Ergebnis ausgewertet, Meldung mit role="alert", Eingaben nur nach Erfolg geleert, Ladezustand mit finally', () => {
    const z = quelle('src/components/handel/ZahlungErfassen.tsx')
    assert.match(z, /^'use client'/)
    assert.match(z, /const r = await createZahlung\(verkaufspostenId, fd\)/)
    assert.match(z, /if \('error' in r\) \{\s*\/\/[^\n]*\n\s*setFehler\(r\.error\)\s*return/)
    assert.match(z, /<p role="alert"/)
    assert.match(z, /catch \(err\) \{[\s\S]*?setFehler\(fehlerText\(err/)
    assert.match(z, /\} finally \{\s*setSpeichern\(false\)/)
    assert.ok(z.indexOf('form.reset()') > z.indexOf("if ('error' in r)"), 'Formular erst nach Erfolg leeren')
    assert.match(z, /<form onSubmit=\{absenden\}/)
    assert.doesNotMatch(z, /<form action=/)
  })
  test('Verkaufsseite und Offene Posten nutzen ZahlungErfassen, kein reines <form action> mit createZahlung mehr', () => {
    const seite = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx')
    assert.match(seite, /<ZahlungErfassen verkaufspostenId=\{id\} \/>/)
    assert.doesNotMatch(seite, /createZahlung/)
    const op = quelle('src/app/(dashboard)/weinhandel/offene-posten/OffenePostenClient.tsx')
    assert.match(op, /<ZahlungErfassen\s+verkaufspostenId=\{p\.id\}/)
    assert.doesNotMatch(op, /createZahlung/)
  })
  test('createZahlung: Signatur mit Rückgabe, Sperre über erwarteteDbAblehnung', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
    assert.match(a, /\): Promise<\{ error: string \} \| \{ ok: true \}> \{\n  'use server'/)
    assert.match(a, /if \(erwarteteDbAblehnung\(error\)\) return \{ error: dbFehlerText\(error, 'Zahlung konnte nicht gespeichert werden'\) \}/)
  })
})

describe('KAN-355: „Zur Meldung“ im Pop-up', nurMitHooks, () => {
  const p = { art: 'fehler', text: 'Buchung mit Datum 15.09.2026 nicht möglich' }
  test('gemerktes Element im DOM → es selbst', () => {
    const k = [{ el: 'neu', art: 'fehler', text: p.text, angezeigt: true }]
    assert.equal(meldungen.meldungsZiel({ el: 'alt', verbunden: true }, k, p), 'alt')
  })
  test('ersetztes Element → dieselbe Meldung neu gefunden, sonst die erste angezeigte Fehlermeldung', () => {
    const k = [
      { el: 'ok', art: 'ok', text: 'Gespeichert', angezeigt: true },
      { el: 'versteckt', art: 'fehler', text: p.text, angezeigt: false },
      { el: 'anderer', art: 'fehler', text: 'Bitte ein Datum wählen', angezeigt: true },
      { el: 'gleich', art: 'fehler', text: `  ${p.text}\n`, angezeigt: true },
    ]
    assert.equal(meldungen.meldungsZiel({ el: 'alt', verbunden: false }, k, p), 'gleich')
    assert.equal(meldungen.meldungsZiel(null, k.slice(0, 3), p), 'anderer')
  })
  test('keine Meldung mehr da → null (Hinweis veraltet, schließt sich)', () => {
    assert.equal(meldungen.meldungsZiel({ el: 'alt', verbunden: false }, [{ el: 'ok', art: 'ok', text: 'x', angezeigt: true }], p), null)
  })
  test('MeldungsPopup prüft isConnected, springt nur mit Ziel und schließt den Hinweis in jedem Fall', () => {
    const m = quelle('src/components/MeldungsPopup.tsx')
    assert.match(m, /verbunden: gemerkt\.isConnected/)
    assert.match(m, /if \(ziel\) ziel\.scrollIntoView\([^)]*\)\n\s*schliessen\(p\.id\)/)
    assert.doesNotMatch(m, /if \(!ziel\) return/, 'KAN-359 Nachtrag: „Zur Meldung“ ohne Ziel darf nicht still stehen bleiben')
    assert.doesNotMatch(m, /p\.ziel\.deref\(\)\?\.scrollIntoView/)
  })
})
