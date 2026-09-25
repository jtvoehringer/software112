// Weinbau-Betriebsnummer als Pflichtfeld (25.09.2026)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/betriebsnummer.test.mjs
//          (läuft auch über npm run test:csv)
//
// Geprüft: weinbauBetriebsnummerPruefen()/weinbauBetriebsnummerFehlt() in src/lib/betrieb/betriebsnummer.ts
// sowie die Verdrahtung in beiden Speicher-Actions und beiden Formularen (Quelltext-Prüfung).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bnr = await import('../../src/lib/betrieb/betriebsnummer.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('weinbauBetriebsnummerPruefen()', () => {
  test('gültige Nummer bleibt, Leerzeichen werden entfernt', () => {
    assert.deepEqual(bnr.weinbauBetriebsnummerPruefen('4489781'), { ok: true, wert: '4489781' })
    assert.deepEqual(bnr.weinbauBetriebsnummerPruefen(' 448 9781 '), { ok: true, wert: '4489781' })
    assert.deepEqual(bnr.weinbauBetriebsnummerPruefen(1234567), { ok: true, wert: '1234567' })
  })

  test('leer, null oder nur Leerzeichen → Pflichtfeld-Fehler', () => {
    for (const v of ['', '   ', null, undefined]) {
      const r = bnr.weinbauBetriebsnummerPruefen(v)
      assert.equal(r.ok, false, String(v))
      assert.match(r.fehler, /Pflichtfeld/)
    }
  })

  test('Buchstaben, Trennzeichen oder Datei-Objekte → nur Ziffern erlaubt', () => {
    for (const v of ['AT4489781', '448-9781', '4489781.0', { name: 'x' }]) {
      const r = bnr.weinbauBetriebsnummerPruefen(v)
      assert.equal(r.ok, false, String(v))
    }
    assert.match(bnr.weinbauBetriebsnummerPruefen('448-9781').fehler, /nur Ziffern/)
  })

  test('höchstens 10 Stellen (int(10) der BKI-Schnittstelle)', () => {
    assert.equal(bnr.weinbauBetriebsnummerPruefen('1234567890').ok, true)
    const r = bnr.weinbauBetriebsnummerPruefen('12345678901')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /höchstens 10 Stellen/)
  })

  test('pattern-Attribut ist deckungsgleich mit der Prüfung (Browser: v-Flag)', () => {
    // Nach dem Muster würde der Browser das Absenden zulassen – dann muss auch der Server annehmen
    // (sonst landet z. B. eine 11-stellige Nummer erst als Serverfehler beim Benutzer).
    const re = new RegExp(`^(?:${bnr.BETRIEBSNUMMER_MUSTER})$`, 'v')
    const faelle = ['4489781', '448 9781', ' 448 9781 ', '1234567890', '1 2 3 4 5 6 7 8 9 0', '12345678901',
      '1234567890 1', 'AT4489781', '448-9781', '4489781.0', '', '   ', '0', '１２３']
    for (const f of faelle) assert.equal(re.test(f), bnr.weinbauBetriebsnummerPruefen(f).ok, JSON.stringify(f))
  })

  test('weinbauBetriebsnummerFehlt()', () => {
    assert.equal(bnr.weinbauBetriebsnummerFehlt(null), true)
    assert.equal(bnr.weinbauBetriebsnummerFehlt('  '), true)
    assert.equal(bnr.weinbauBetriebsnummerFehlt('4489781'), false)
  })
})

describe('Verdrahtung', () => {
  test('beide Speicher-Actions prüfen vor dem Schreiben und speichern den bereinigten Wert', () => {
    for (const p of ['src/app/(dashboard)/betrieb/einstellungen/actions.ts', 'src/app/(dashboard)/admin/mandanten/[id]/actions.ts']) {
      const s = quelle(p)
      assert.match(s, /weinbauBetriebsnummerPruefen\(formData\.get\('betrieb_betriebsnummer'\)\)/, p)
      assert.match(s, /betrieb_betriebsnummer:\s+betriebsnummer\.wert/, p)
      assert.doesNotMatch(s, /formData\.get\('betrieb_betriebsnummer'\) as string\) \|\| null/, p)
    }
  })

  test('beide Formulare markieren das Feld als Pflichtfeld', () => {
    for (const p of ['src/app/(dashboard)/betrieb/einstellungen/EinstellungenClient.tsx', 'src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx']) {
      const s = quelle(p)
      assert.match(s, /Weinbau-Betriebsnummer \*/, p)
      assert.match(s, /name="betrieb_betriebsnummer"[^>]*required/, p)
    }
  })

  test('Mandantenverwaltung zeigt Aktionsfehler lesbar an (fehlerText statt maskierter err.message)', () => {
    const s = quelle('src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx')
    assert.match(s, /import \{ fehlerText \} from '@\/lib\/fehler'/)
    assert.doesNotMatch(s, /err instanceof Error \? err\.message/)
  })
})
