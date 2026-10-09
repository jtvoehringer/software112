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

describe('KAN-261: Betriebsart – Pflicht nur für Weinproduzenten', () => {
  test('Weinhändler: leer ist erlaubt (wert = null), eine vorhandene Nummer wird wie bisher geprüft', () => {
    for (const v of ['', '   ', null, undefined]) {
      assert.deepEqual(bnr.weinbauBetriebsnummerPruefen(v, 'weinhaendler'), { ok: true, wert: null }, String(v))
    }
    assert.deepEqual(bnr.weinbauBetriebsnummerPruefen(' 448 9781 ', 'weinhaendler'), { ok: true, wert: '4489781' })
    assert.equal(bnr.weinbauBetriebsnummerPruefen('AT4489781', 'weinhaendler').ok, false)
  })

  test('Weinproduzent und unbekannte Betriebsart: weiterhin Pflicht', () => {
    for (const art of ['weinproduzent', undefined, null, 'quatsch']) {
      const r = bnr.weinbauBetriebsnummerPruefen('', art)
      assert.equal(r.ok, false, String(art))
      assert.match(r.fehler, /Pflichtfeld/)
    }
  })

  test('nur Nullen sind keine Betriebsnummer (Spaetrot hatte „0“ als Platzhalter)', () => {
    for (const art of ['weinproduzent', 'weinhaendler']) {
      for (const v of ['0', '000', ' 0 0 ']) {
        const r = bnr.weinbauBetriebsnummerPruefen(v, art)
        assert.equal(r.ok, false, `${art}: ${v}`)
        assert.match(r.fehler, /keine Weinbau-Betriebsnummer/)
      }
    }
    assert.match(bnr.weinbauBetriebsnummerPruefen('0', 'weinhaendler').fehler, /leer lassen/)
    assert.equal(bnr.weinbauBetriebsnummerPruefen('0123', 'weinproduzent').ok, true, 'führende Null mit Ziffer ≠ 0 bleibt gültig')
  })

  test('Fehlt-Hinweis, Pflicht und Zweck je Betriebsart', () => {
    assert.equal(bnr.weinbauBetriebsnummerFehlt(null, 'weinhaendler'), false)
    assert.equal(bnr.weinbauBetriebsnummerFehlt(null, 'weinproduzent'), true)
    assert.equal(bnr.betriebsnummerPflicht('weinhaendler'), false)
    assert.equal(bnr.betriebsnummerPflicht('weinproduzent'), true)
    assert.equal(bnr.betriebsartAus('weinhaendler'), 'weinhaendler')
    assert.equal(bnr.betriebsartAus('irgendwas'), 'weinproduzent')
    assert.match(bnr.betriebsnummerZweck('weinhaendler'), /falls vorhanden/)
    assert.match(bnr.betriebsnummerZweck('weinproduzent'), /Pflichtfeld/)
  })
})

describe('Verdrahtung', () => {
  test('beide Speicher-Actions prüfen mit der Betriebsart vor dem Schreiben und speichern den bereinigten Wert', () => {
    const e = quelle('src/app/(dashboard)/betrieb/einstellungen/actions.ts')
    assert.match(e, /\.select\('betriebsart'\)\.eq\('tenant_id', auth\.tenantId\)\.maybeSingle\(\)/)
    assert.match(e, /if \(artErr\) return/)
    assert.match(e, /weinbauBetriebsnummerPruefen\(formData\.get\('betrieb_betriebsnummer'\), artZeile\?\.betriebsart\)/)
    const m = quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts')
    assert.match(m, /const betriebsart = betriebsartAus\(formData\.get\('betriebsart'\)\)/)
    assert.match(m, /weinbauBetriebsnummerPruefen\(formData\.get\('betrieb_betriebsnummer'\), betriebsart\)/)
    assert.match(m, /\r?\n\s+betriebsart,\r?\n/)
    for (const s of [e, m]) {
      assert.match(s, /betrieb_betriebsnummer:\s+betriebsnummer\.wert/)
      assert.doesNotMatch(s, /formData\.get\('betrieb_betriebsnummer'\) as string\) \|\| null/)
    }
  })

  test('beide Formulare nutzen BetriebsnummerFeld – Betriebsart nur in der Mandantenverwaltung wählbar', () => {
    const e = quelle('src/app/(dashboard)/betrieb/einstellungen/EinstellungenClient.tsx')
    assert.match(e, /<BetriebsnummerFeld betriebsart=\{daten\.betriebsart\}[^>]*waehlbar=\{false\}/)
    const m = quelle('src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx')
    assert.match(m, /<BetriebsnummerFeld betriebsart=\{settings\.betriebsart\}[\s\S]{0,120}waehlbar inputClassName/)
    const k = quelle('src/components/BetriebsnummerFeld.tsx')
    assert.match(k, /required=\{pflicht\}/)
    assert.match(k, /name="betriebsart"/)
    assert.match(k, /'Weinbau-Betriebsnummer \*' : 'Weinbau-Betriebsnummer \(falls vorhanden\)'/)
    assert.match(k, /pattern=\{BETRIEBSNUMMER_MUSTER\}/)
  })

  test('Morgenbericht, BKI-Betriebsdaten und Transportbescheinigung richten sich nach der Betriebsart', () => {
    const mb = quelle('src/lib/morgenbericht/pruefungen.ts')
    assert.match(mb, /select\('betrieb_betriebsnummer, betriebsart'\)/)
    assert.match(mb, /weinbauBetriebsnummerFehlt\(\(stamm as R \| null\)\?\.betrieb_betriebsnummer, \(stamm as R \| null\)\?\.betriebsart\)/)
    const bki = quelle('src/lib/behoerden/bki-stammdaten.ts')
    assert.match(bki, /betrieb_betriebsnummer, betriebsart, betrieb_rechtsform/)
    assert.match(bki, /e\.betriebsart === 'weinhaendler'/)
    const tb = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/actions.ts')
    assert.match(tb, /versenderOhneBetriebsnummer: !betriebsnummerPflicht\(\(art as R \| null\)\?\.betriebsart\)/)
    assert.match(tb, /if \(artErr\) throw new AktionsFehler/)
  })

  test('Mandantenverwaltung zeigt Aktionsfehler lesbar an (fehlerText statt maskierter err.message)', () => {
    const s = quelle('src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx')
    assert.match(s, /import \{ fehlerText \} from '@\/lib\/fehler'/)
    assert.doesNotMatch(s, /err instanceof Error \? err\.message/)
  })
})
