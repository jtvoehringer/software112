// Sweep 15 (07.10.2026) – Entscheidungen Jörgen vom 07.10.2026:
//  KAN-223: Betriebsmittel-Einkauf mit E/A-Ausgabe auch für Doppik-Betriebe (nur Modul E&A nötig)
//  KAN-205: Lese, Traubenzeilen der Pressung und Traubenverkauf in der Kellerbuch-Periodensperre („ganz gesperrt“)
//  KAN-130: Kellerkette mischt das Mostgewicht litergewichtet (Lese/Pressung bleiben kg)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 22 (Doppik darf), DB-Test 63 (Lese-Sperre).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_sweep15_entscheidungen.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/sweep15_entscheidungen.sql')
}
const { mischen } = await import('../../src/lib/wein/mostgewicht.ts')

describe('KAN-130: litergewichtet in der Kellerkette', () => {
  test('Liter direkt: je 500 L 14 und 22 °KMW = 18,00 °KMW / 88,8 °Oe; kg unverändert', () => {
    assert.deepEqual(mischen([{ menge: 500, kmw: 14 }, { menge: 500, kmw: 22 }], 'l'), { kmw: 18, oechsle: 88.8, einheit: 'kmw' })
    assert.deepEqual(mischen([{ menge: 300, kmw: 18.4 }, { menge: 100, kmw: 20 }], 'l'), mischen([{ menge: 300, kmw: 18.4 }, { menge: 100, kmw: 20 }], 'kg'))
  })
  test('Demo-Funktion ohne Dichte, Regel in CLAUDE.md und KI-Hinweis', () => {
    const m = migration()
    assert.match(m, /v_f := p_brutto\[v_i\];/)
    assert.match(m, /v_f := coalesce\(v_a_menge, 0\);/)
    assert.doesNotMatch(m, /4\.54 \+ 0\.022 \* v_von\.kmw/)
    assert.match(quelle('CLAUDE.md'), /Kellerkette \(Umzug, Verschnitt, Zusammenführen\) nach Litern/)
    assert.match(quelle('src/app/api/ki-abfrage/route.ts'), /Lese\/Pressung nach kg, Keller nach Litern/)
  })
})

describe('KAN-223: Doppik-Betriebe buchen Betriebsmittel-Einkauf mit E/A-Ausgabe', () => {
  test('RPC nur noch modul_ea, Seite ebenso', () => {
    const m = migration()
    assert.match(m, /WHERE te\.tenant_id = p_tenant_id AND te\.modul_ea\) THEN/)
    assert.doesNotMatch(m, /te\.buchhaltungsart = 'ea'/)
    const p = quelle('src/app/(dashboard)/behandlungen/lager/page.tsx')
    assert.match(p, /const einkaufSperre = !\(einst as AR \| null\)\?\.modul_ea\n/)
    assert.doesNotMatch(p, /buchhaltungsart !== 'ea'/)
  })
})

describe('KAN-205: Lese in der Kellerbuch-Periodensperre', () => {
  test('Datumsquelle „eigen“ und Trigger an Lese, Traubenzeilen, Traubenverkauf (samt Mostgewicht)', () => {
    const m = migration()
    assert.match(m, /ELSIF v_quelle\[1\] = 'eigen' THEN/)
    assert.match(m, /ON public\.ernte_parzellen FOR EACH ROW\n\s+EXECUTE FUNCTION public\.s112_kellerbuch_periodensperre\('eigen:ernte_datum:weinjahrgaenge:jahrgang_id',\n\s+'[^']*klosterneuburger,oechsle,mostgewicht_einheit'\)/)
    assert.match(m, /ON public\.pressung_weingaerten FOR EACH ROW\n\s+EXECUTE FUNCTION public\.s112_kellerbuch_periodensperre\('kopf:pressungen:pressung_id'/)
    assert.match(m, /ON public\.traubenverkauf FOR EACH ROW\n\s+EXECUTE FUNCTION public\.s112_kellerbuch_periodensperre\('datum'/)
    // Storno-Spalten zählen nicht (Storno bleibt möglich)
    assert.doesNotMatch(m.slice(m.indexOf('-- B. KAN-205: Trigger')), /storniert_am/)
  })
})
