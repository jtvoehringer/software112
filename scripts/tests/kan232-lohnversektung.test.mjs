// KAN-232 (08.10.2026) – Lohnversektung: Versand (bleibt eigener Bestand, Gebinde frei), Rückkehr als Füllung mit
// lohnversektung_id (Grundwein-Anteil, letzte Lieferung = Rest, kein Schwund), Buchungsarten LNSKT/LNSKT_ZU in Katalog,
// BSM und Bewegungsbuch. DB-Seite: DB-Test 73.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as lv from '../../src/lib/kellerbuch/lohnversektung.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-232: Lohnversektung', () => {
  test('Stand: unterwegs, teilweise, abgeschlossen, storniert', () => {
    assert.equal(lv.lohnversektungStand({ storniertAm: null, abgeschlossenAm: null, literZurueck: 0 }), 'unterwegs')
    assert.equal(lv.lohnversektungStand({ storniertAm: null, abgeschlossenAm: null, literZurueck: 140 }), 'teilweise')
    assert.equal(lv.lohnversektungStand({ storniertAm: null, abgeschlossenAm: '2026-10-08', literZurueck: 300 }), 'abgeschlossen')
    assert.equal(lv.lohnversektungStand({ storniertAm: '2026-10-08T10:00:00Z', abgeschlossenAm: null, literZurueck: 0 }), 'storniert')
    assert.equal(lv.STAND_TEXT.unterwegs, 'beim Versekter')
  })
  test('versandFehler und Rückkehr-Pfad', () => {
    const ok = { weinausbauId: 'c', firmaId: 'f', datum: '2026-10-08', heute: '2026-10-08' }
    assert.equal(lv.versandFehler(ok), null)
    assert.match(lv.versandFehler({ ...ok, weinausbauId: '' }) ?? '', /Grundwein-Charge/)
    assert.match(lv.versandFehler({ ...ok, firmaId: '' }) ?? '', /Sektkellerei/)
    assert.match(lv.versandFehler({ ...ok, datum: '2026-10-09' }) ?? '', /Zukunft/)
    assert.match(lv.versandFehler({ ...ok, datum: '8.10.2026' }) ?? '', /gültiges/)
    assert.equal(lv.rueckkehrPfad('a b'), '/weinhandel/fuellungen/neu?lohnversektung=a%20b')
  })

  test('Katalog und BSM: LNSKT (ab) und LNSKT_ZU (zu), Rückkehr im Bewegungsbuch und bei den Flaschen', () => {
    const k = quelle('src/lib/katalog/bki.ts')
    assert.match(k, /\{ code: 'LNSKT', bezeichnung: 'Abgang zur Lohnversektung', richtung: 'ab', einheit: 'l', bsm: true, bsmCode: null \}/)
    assert.match(k, /\{ code: 'LNSKT_ZU', bezeichnung: 'Zugang aus Lohnversektung', richtung: 'zu', einheit: 'l', bsm: true, bsmCode: null \}/)
    const b = quelle('src/lib/behoerden/bsm.ts')
    assert.match(b, /case 'lohnversektung': return 'LNSKT'/)
    assert.match(b, /k\.lohnversektung && k\.mitCharge \? 'LNSKT_ZU'/)
    assert.match(b, /lohnversektung: !!f\.lohnversektung_id \}\)/)
    const bb = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.match(bb, /art: f\.lohnversektung_id \? 'lohnversektung' : 'abfuellung'/)
    assert.equal((bb.match(/lohnversektung_id/g) ?? []).length >= 4, true)
    assert.match(quelle('supabase/entwurf/kan232_lohnversektung.sql'), /VALUES \('LNSKT', 'Abgang zur Lohnversektung', 'ab', 'l', true, NULL, 27\),\n\s+\('LNSKT_ZU', 'Zugang aus Lohnversektung', 'zu', 'l', true, NULL, 28\);/)
  })

  test('Füllung: Lohnversektung prüfen, letzte Lieferung = Rest, kein Schwund, Kennzeichen', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    assert.match(a, /if \(l\.weinausbau_id !== weinausbauId\) throw new AktionsFehler\('Die Rückkehr muss aus der versandten Grundwein-Charge gebucht werden\.'\)/)
    assert.match(a, /if \(lohnversektungId && letzteLieferung\) mengeGefuellt = r2\(verfuegbar\)/)
    assert.match(a, /const abschliessen = !lohnversektungId && formData\.get\('abschliessen'\) === 'true'/)
    assert.match(a, /lohnversektung_id: {4}lohnversektungId,/)
    const c = quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx')
    assert.match(c, /<input type="hidden" name="lohnversektung_id" value=\{lohnversektung\.id\} \/>/)
    assert.match(c, /const ueberabfuellung = !lohnversektung && schwund !== null/)
    assert.match(c, /\{!lohnversektung && schwund !== null && schwund >= 0\.01 && \(/)
  })
  test('Versand und Storno über die RPCs, mit Betrieb der Seite und Schreibsperre', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/lohnversektung/actions.ts')
    assert.match(a, /await pruefeSeitenBetrieb\(m\.tenantId\)/)
    assert.match(a, /await pruefeSchreibzugriff\(m\)/)
    assert.match(a, /rpc\('s112_lohnversektung_versenden'/)
    assert.match(a, /rpc\('s112_lohnversektung_stornieren'/)
  })
})
