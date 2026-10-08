// KAN-105 Teil B (2) (08.10.2026) – E-Mail-Versand/PDF der Sammelrechnung: Die Versand-Route lädt bei einer Rechnung über
// mehrere Lieferscheine die Positionen aller Lieferscheine (je Lieferschein eine Zwischenzeile „Lieferschein LS-… vom …“,
// Lieferzeitraum im Kopf); die Rechnungsseite bietet den Versand an.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-105 Teil B (2): Versand der Sammelrechnung', () => {
  test('Route: alle Lieferscheine der Rechnung, Zwischenzeile je Lieferschein, Lieferzeitraum', () => {
    const r = quelle('src/app/api/weinhandel/verkauf/[id]/send/route.ts')
    assert.match(r, /\.eq\('tenant_id', tenantId\)\.eq\('rechnung_id', rechnung\.id\)\.order\('datum'\)\.order\('id'\)/)
    assert.match(r, /abschnitt: `Lieferschein \$\{l\.lieferscheinnummer \?\? ''\} vom \$\{datumDe\(l\.datum\)\}`/)
    assert.match(r, /: \(posten\.positionen \?\? \[\]\) as R\[\]/)
    assert.match(r, /lieferzeitraum,\n/)
  })
  test('PDF: Zwischenzeile nur beim Wechsel des Lieferscheins, Lieferzeitraum optional', () => {
    const p = quelle('src/lib/pdf/verkaufRechnungPdf.tsx')
    assert.match(p, /\{pos\.abschnitt && pos\.abschnitt !== positionen\[i - 1\]\?\.abschnitt && \(/)
    assert.match(p, /\{rechnung\.lieferzeitraum && <Text style=\{styles\.metaText\}>Lieferzeitraum: \{rechnung\.lieferzeitraum\}<\/Text>\}/)
  })
  test('Rechnungsseite: Versand-Panel (nur nicht storniert, Schreibrecht Warenwirtschaft)', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx')
    assert.match(s, /\{!r\.storniert && membership && canWrite\(membership, 'warenwirtschaft'\) && r\.verkaufsposten_ids\.length > 0 && \(/)
    assert.match(s, /<RechnungVersandPanel verkaufId=\{r\.verkaufsposten_ids\[0\]\}/)
  })
})
