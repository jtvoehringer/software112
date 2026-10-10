// Sweep 85 (10.10.2026): eine eingegebene 0 bleibt 0. parseFloat(…) || 13 bzw. parseInt(…) || null ersetzten auch die Zahl 0:
// Standard-USt 0 % (Kleinunternehmer) wurde 13 %, eine Verkaufsposition mit 0 % (Export) bekam beim Bearbeiten den
// Standardsatz, 0 Skontotage wurden 10, 0 Tage Wartezeit eines Pflanzenschutzmittels und 0 % Stickstoff eines PK-Düngers
// wurden „unbekannt“, ein Preis 0 (Muster) verschwand. Richtig: zahlAus/ganzzahlAus/zahlWert aus src/lib/format.ts mit ??.
// Wächter: scripts/check-null-vorgabe.js (prebuild, CI).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { zahlAus, ganzzahlAus, zahlWert } from '../../src/lib/format.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-null-vorgabe.js'))
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

describe('Helfer: 0 bleibt 0', () => {
  test('zahlAus: deutsche Schreibweise, leer → null, 0 → 0', () => {
    assert.deepEqual(['0', '0,0', '13', '1,5', '', null, 'abc', ' 1.250,50 '].map(zahlAus), [0, 0, 13, 1.5, null, null, null, 1250.5])
    assert.equal(zahlAus('0') ?? 13, 0, 'Vorgabe nur bei leer')
    assert.equal(zahlAus('') ?? 13, 13)
    assert.equal(parseFloat('0') || 13, 13, 'Gegenprobe: die alte Schreibweise verschluckte die 0')
  })

  test('ganzzahlAus schneidet ab wie parseInt; zahlWert liest numeric-Strings ohne Tausenderpunkt-Deutung', () => {
    assert.deepEqual(['0', '7', '3,9', '', 'x'].map(ganzzahlAus), [0, 7, 3, null, null])
    assert.deepEqual([0, '0.00', '13.00', '12.500', null, undefined, '', 'x'].map(zahlWert), [0, 0, 13, 12.5, null, null, null, null])
  })
})

describe('Wächter check-null-vorgabe', () => {
  test('meldet „|| Vorgabe“ hinter parseFloat/parseInt/Number, nicht „|| 0“, „?? x“ oder Number.isFinite', () => {
    assert.deepEqual(zeilen([
      "const a = parseFloat(dezimal(x)) || 13",
      "const b = parseInt(y) || null",
      "const c = Number(z) || 10",
      "const d = Number(z) || 0",
      "const e = parseFloat(x) || ''",
      "const f = zahlAus(x) ?? 13",
      "const g = Number.isFinite(n) || h",
      "const h = Number(a) || Number(b) || 0",
      "const i = Number(x)  ||  0.5",
      "if (a !== Number(m[1]) || b) {}",   // KAN-50: Vergleich, keine Vorgabe
      "if (a >= Number(m[1]) || b) {}",
      "const j = a + Number(z) || 3",
    ].join('\n')), [1, 2, 3, 8, 9, 12])
  })

  test('Ausnahme nur mit Begründung (≥ 15 Zeichen), auch als Block-Kommentar in JSX', () => {
    assert.deepEqual(zeilen('const p = Number(port) || 587   // null-vorgabe-ok: Port 0 ist ungültig'), [])
    assert.deepEqual(zeilen('onChange={e => set(parseInt(v) || 4 /* null-vorgabe-ok: Stellenzahl 1–8 gültig */)}'), [])
    assert.equal(pruefeText('const p = Number(port) || 587   // null-vorgabe-ok: kurz').funde[0].text.includes('Begründung'), true)
  })

  test('Repository ohne Funde', () => {
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    assert.ok(e.ausnahmen >= 40)
  })

  test('im prebuild verdrahtet', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-null-vorgabe\.js/)
  })
})

describe('Regression: die Fundstellen', () => {
  test('Verkauf bearbeiten: USt-Satz 0 der Position bleibt 0 % (nicht Standardsatz)', () => {
    assert.match(quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx'), /ust_satz: +\(zahlWert\(p\.ust_satz\) \?\? ustStandard\)/)
  })
  test('Standard-USt 0 % bleibt (Mandant, Verkaufs-Stammdaten, Assistent)', () => {
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts'), /ust_satz_standard: \(zahlAus\(formData\.get\('ust_satz_standard'\)\) \?\? 13\)/)
    assert.match(quelle('src/app/api/verkauf-stammdaten/route.ts'), /\(zahlWert\(\(einstellungen as any\)\?\.ust_satz_standard\) \?\? 13\)/)
    assert.match(quelle('src/lib/assistent/kontext.ts'), /\(zahlWert\(\(einstellungenRaw as R \| null\)\?\.ust_satz_standard\) \?\? 13\)/)
  })
  test('Skontotage 0, Wartezeit 0 Tage, Nährstoff 0 %, Preis 0', () => {
    assert.equal((quelle('src/app/(dashboard)/crm/actions.ts').match(/skonto_tage: +\(ganzzahlAus\(formData\.get\('skonto_tage'\)\) \?\? 10\)/g) ?? []).length, 4)
    const l = quelle('src/app/(dashboard)/behandlungen/lager/actions.ts')
    assert.equal((l.match(/wartezeit_tage: +ganzzahlAus\(fd\.get\('wartezeit_tage'\)\)/g) ?? []).length, 2)
    assert.match(l, /naehrstoff_n_pct: +zahlAus\(fd\.get\('naehrstoff_n_pct'\)\)/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/actions.ts'), /vk_preis_brutto: +zahlAus\(formData\.get\('vk_preis_brutto'\)\)/)
  })
})
