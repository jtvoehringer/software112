// KAN-236 (08.10.2026) – Support: Rückruf anfordern. Telefonnummer (Pflicht), Erreichbarkeit und Anliegen (optional);
// die Anfrage geht als Anfragetyp „Rückruf“ mit Priorität Highest an SUP (Kunde, Organisation, Rate-Limit wie
// „Problem melden“).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as a from '../../src/lib/support/anfrage.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-236: Rückruf anfordern', () => {
  test('telefonNormalisieren: übliche Schreibweisen ja, Text und zu kurz/lang nein', () => {
    assert.equal(a.telefonNormalisieren(' +43 664  1234567 '), '+43 664 1234567')
    assert.equal(a.telefonNormalisieren('0664/123 45 67'), '0664/123 45 67')
    assert.equal(a.telefonNormalisieren('(02742) 12-34-56'), '(02742) 12-34-56')
    for (const nein of ['', '12345', 'ruf mich an', '+43 664 123x', '1'.repeat(21), null, 664]) assert.equal(a.telefonNormalisieren(nein), null, String(nein))
  })
  test('rueckrufFehler und Text', () => {
    assert.match(a.rueckrufFehler({ telefon: 'abc' }) ?? '', /gültige Telefonnummer/)
    assert.equal(a.rueckrufFehler({ telefon: '+43 664 1234567' }), null)
    assert.match(a.rueckrufFehler({ telefon: '+43 664 1234567', anliegen: 'x'.repeat(a.MAX_RUECKRUF_TEXT + 1) }) ?? '', /Anliegen: höchstens/)
    assert.match(a.rueckrufFehler({ telefon: '+43 664 1234567', zeitfenster: 5 }) ?? '', /Erreichbarkeit: ungültige/)
    assert.deepEqual(a.rueckrufText({ telefon: '+43 664 1234567', zeitfenster: ' ab 14 Uhr ', anliegen: '' }), {
      betreff: 'Rückruf erbeten: +43 664 1234567',
      text: 'Bitte um Rückruf unter +43 664 1234567.\nAm besten erreichbar: ab 14 Uhr',
    })
    assert.equal(a.RUECKRUF_ANFRAGETYP, 'Rückruf')
    assert.equal(a.RUECKRUF_PRIORITAET, 'Highest')
  })
  test('Route: Anfragetyp Rückruf, Priorität Highest, Prüfungen wie Problem melden', () => {
    const r = quelle('src/app/api/support/rueckruf/route.ts')
    assert.match(r, /const zweiFaktor = await pruefeZweiFaktor\(\)\n\s+if \(zweiFaktor\) return zweiFaktor/)
    assert.match(r, /seitenBetriebKonflikt\(k\.membership\.tenantId\)/)
    assert.match(r, /anfragetypId: await anfragetypId\(RUECKRUF_ANFRAGETYP\)/)
    assert.match(r, /prioritaet: RUECKRUF_PRIORITAET/)
    assert.match(r, /const limit = rateLimitFehler\(await anfragenImFenster\(accountId\)\)/)
    assert.match(r, /const organisationId = await organisationZuordnen\(k\.betriebName, accountId\)/)
  })
  test('Support-Seite zeigt die Karte nur mit Anbindung', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/support/page.tsx'), /\{jsmKonfiguriert\(\) && <RueckrufAnfordern \/>\}/)
    assert.match(quelle('src/app/(dashboard)/hilfe/support/RueckrufAnfordern.tsx'), /<input type="tel" autoComplete="tel"/)
  })
})
