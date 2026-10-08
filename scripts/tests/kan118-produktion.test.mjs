// KAN-118 (08.10.2026) – Produktion: aus Quell-Chargen und Zutaten entsteht eine neue Charge mit eigenem Erzeugnis
// (Perlweinspritzer/Weinmischgetränk = weinhaltiges Getränk ≥ 50 % Wein, Perlwein, Schaumwein/Sekt, PetNat).
// Journal: Quelle AB_VERAR, Ziel ZU_PROD (neue Buchungsart, Entscheidung Jörgen 08.10.2026).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 66 (RPC-Regeln, Journal, Stoffkonto, Genealogie, Storno).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  ERZEUGNIS_JE_ART, produktionEingaenge, produktionFehler, weinanteil, zielMenge, zutatenFuer,
} from '../../src/lib/kellerbuch/produktion.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan118_produktion.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan118_produktion.sql')
}

const basis = { name: 'Spritzer 2026', behaelterId: 'b1', datum: '2026-10-08', heute: '2026-10-08' }
const gv = { weinausbauId: 'w1', menge: 600, bestand: 600, weinart: 'weiss', name: 'GV' }

describe('KAN-118: Regeln wie die RPC', () => {
  test('Perlweinspritzer: 600 L Wein + 400 L Wasser = 1.000 L, 60 % Wein, in Ordnung', () => {
    const zut = [{ art: 'wasser', menge: 400, einheit: 'l' }, { art: 'co2', menge: 2, einheit: 'kg' }]
    assert.deepEqual(zielMenge([gv], zut), { wein: 600, zusatz: 400, ziel: 1000 })
    assert.equal(weinanteil(600, 400), 60)
    assert.deepEqual(produktionFehler({ ...basis, art: 'spritzer', wein: [gv], zutaten: zut }), [])
  })
  test('unter 50 % Wein wird abgelehnt (genau 50 % geht)', () => {
    const f = produktionFehler({ ...basis, art: 'spritzer', wein: [{ ...gv, menge: 300 }], zutaten: [{ art: 'wasser', menge: 400, einheit: 'l' }] })
    assert.ok(f.some(x => /mindestens 50 % Wein/.test(x)))
    assert.deepEqual(produktionFehler({ ...basis, art: 'mischgetraenk', wein: [{ ...gv, menge: 400 }], zutaten: [{ art: 'saft', menge: 400, einheit: 'l' }] }), [])
  })
  test('Weinart-Sperre, Bestand, doppelte Quelle', () => {
    const rot = { weinausbauId: 'w2', menge: 100, bestand: 300, weinart: 'rot', name: 'ZW' }
    assert.ok(produktionFehler({ ...basis, art: 'perlwein', wein: [gv, rot], zutaten: [] }).some(x => /Weinarten/.test(x)))
    assert.ok(produktionFehler({ ...basis, art: 'perlwein', wein: [{ ...gv, menge: 700 }], zutaten: [] }).some(x => /Bestand/.test(x)))
    assert.ok(produktionFehler({ ...basis, art: 'perlwein', wein: [gv, gv], zutaten: [] }).some(x => /doppelt/.test(x)))
  })
  test('Zutaten je Art: Wasser nur bei Spritzer/Mischgetränk, kein CO₂ bei PetNat', () => {
    assert.ok(!zutatenFuer('perlwein').includes('wasser'))
    assert.ok(zutatenFuer('spritzer').includes('wasser'))
    assert.ok(!zutatenFuer('petnat').includes('co2'))
    assert.ok(produktionFehler({ ...basis, art: 'petnat', wein: [gv], zutaten: [{ art: 'co2', menge: 1, einheit: 'kg' }] }).some(x => /PetNat/.test(x)))
    assert.ok(produktionFehler({ ...basis, art: 'perlwein', wein: [gv], zutaten: [{ art: 'wasser', menge: 1, einheit: 'l' }] }).some(x => /Wasser/.test(x)))
  })
  test('Erzeugnis je Art; Schaumwein auch Sekt g.U.; falsches Erzeugnis abgelehnt', () => {
    assert.deepEqual(ERZEUGNIS_JE_ART.schaumwein, ['SCHAUMW', 'SEKTGU'])
    assert.deepEqual(ERZEUGNIS_JE_ART.petnat, ['PETNAT'])
    assert.ok(produktionFehler({ ...basis, art: 'perlwein', erzeugnis: 'SEKTGU', wein: [gv], zutaten: [] }).some(x => /Erzeugnis/.test(x)))
  })
  test('Datum in der Zukunft, fehlendes Gebinde', () => {
    const f = produktionFehler({ ...basis, behaelterId: '', datum: '2026-10-09', art: 'perlwein', wein: [gv], zutaten: [] })
    assert.ok(f.some(x => /Zukunft/.test(x)))
    assert.ok(f.some(x => /Gebinde/.test(x)))
  })
  test('Eingänge für die RPC', () => {
    assert.deepEqual(produktionEingaenge([gv], [{ art: 'co2', menge: 2, einheit: 'kg', kellermittelId: 'k1' }]), [
      { art: 'wein', weinausbau_id: 'w1', menge: 600 },
      { art: 'co2', menge: 2, einheit: 'kg', kellermittel_id: 'k1', bezeichnung: null },
    ])
  })
})

describe('KAN-118: Datenbank und Verdrahtung', () => {
  test('Migration: ZU_PROD, RPCs mit Zugriff/Abo/Schreibrecht, 50-%-Regel, Weinart-Sperre, Journal, Storno-Bedingung', () => {
    const m = migration()
    assert.match(m, /VALUES \('ZU_PROD', 'Zugang durch Produktion', 'zu', 'l', true, NULL, 26\)/)
    assert.equal((m.match(/PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\)/g) ?? []).length, 2)
    assert.equal((m.match(/PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\)/g) ?? []).length, 2)
    assert.match(m, /IF v_art IN \('spritzer', 'mischgetraenk'\) AND v_wein \* 2 < v_wein \+ v_zusatz - 0\.005 THEN/)
    assert.match(m, /unterschiedliche Weinarten/)
    assert.match(m, /'code', 'AB_VERAR'/)
    assert.match(m, /'code', 'ZU_PROD'/)
    assert.match(m, /public\.s112_charge_hat_folgebuchung\(v_z\.id\)/)
    assert.match(m, /REVOKE INSERT, UPDATE, DELETE ON public\.produktionen, public\.produktion_eingaenge FROM authenticated/)
  })
  test('Bewegungsbuch und BSM kennen die Produktion; Katalog-Spiegel hat ZU_PROD', () => {
    const b = quelle('src/lib/behoerden/bsm.ts')
    assert.match(b, /case 'produktion_aus': return 'AB_VERAR'/)
    assert.match(b, /case 'produktion_ein': return 'ZU_PROD'/)
    const bb = quelle('src/lib/behoerden/bewegungsbuch.ts')
    assert.equal((bb.match(/\.from\('produktionen'\)/g) ?? []).length, 2)
    assert.equal((bb.match(/\.from\('produktion_eingaenge'\)/g) ?? []).length, 2)
    assert.match(quelle('src/lib/katalog/bki.ts'), /code: 'ZU_PROD'/)
  })
  test('Server Actions: Seiten-Betrieb, Abo-Sperre, Schreibrecht Kellerbuch, Buchung nur per RPC', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/produktion/actions.ts')
    for (const s of ['pruefeSeitenBetrieb(m.tenantId)', 'pruefeSchreibzugriff(m)', "canWrite(m, 'kellerbuch')", "rpc('s112_produktion_buchen'", "rpc('s112_produktion_stornieren'"]) {
      assert.ok(a.includes(s), s)
    }
    assert.doesNotMatch(a, /\.from\('produktionen'\)\.insert/)
  })
})
