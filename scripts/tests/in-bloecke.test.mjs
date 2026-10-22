// Regressionstests (05.10.2026): lange .in()-Listen in Blöcken (inBloecken aus src/lib/supabase/alle.ts).
// .in('spalte', liste) steht in der URL. Gemessen gegen Staging: 300 UUIDs (≈ 11 KB) gehen, 400 (≈ 15 KB) scheitern –
// supabase-js liefert nur einen Fehler, den viele Aufrufer verwerfen. Beispiel: Kontaktliste mit „mehr laden“ bis
// 1.000 Zeilen → Aktivitäten-Abfrage mit 1.000 IDs → keine Aktivitäten angezeigt.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bloecke, inBloecken, zaehleInBloecken, IN_BLOCK, IN_ZEICHEN } from '../../src/lib/supabase/alle.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const uuid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

test('bloecke: höchstens 100 Werte bzw. 4.000 Zeichen je Block, ohne Duplikate und Leerwerte', () => {
  const ids = Array.from({ length: 1000 }, (_, i) => uuid(i))
  const b = bloecke([...ids, ids[0], null, undefined, ''])
  assert.equal(IN_BLOCK, 100)
  assert.equal(b.length, 10)
  assert.ok(b.every(x => x.length <= IN_BLOCK && x.join(',').length <= IN_ZEICHEN))
  assert.deepEqual(b.flat(), ids)
  // Graph-Nachrichten-IDs (~150 Zeichen): nach Zeichen begrenzt
  const lang = Array.from({ length: 200 }, (_, i) => 'A'.repeat(148) + String(i).padStart(4, '0'))
  const bl = bloecke(lang)
  assert.ok(bl.length >= 8)
  assert.ok(bl.every(x => x.join(',').length <= IN_ZEICHEN))
  assert.deepEqual(bl.flat(), lang)
  assert.deepEqual(bloecke([]), [])
})

test('inBloecken: jede Anfrage mit höchstens 100 IDs, Ergebnisse vollständig, leere Liste ohne Anfrage', async () => {
  const ids = Array.from({ length: 1000 }, (_, i) => uuid(i))
  const groessen = []
  const r = await inBloecken(ids, async b => { groessen.push(b.length); return { data: b.map(id => ({ id })), error: null } })
  assert.equal(r.error, null)
  assert.equal(r.data.length, 1000)
  assert.deepEqual(new Set(r.data.map(x => x.id)), new Set(ids))
  assert.ok(groessen.every(g => g <= 100))
  let aufrufe = 0
  assert.deepEqual(await inBloecken([], async () => { aufrufe++; return { data: [], error: null } }), { data: [], error: null })
  assert.equal(aufrufe, 0)
})

test('inBloecken: Fehler eines Blocks kommt zurück (keine stille Teilmenge)', async () => {
  const ids = Array.from({ length: 350 }, (_, i) => uuid(i))
  const r = await inBloecken(ids, async b => (b.includes(uuid(250)) ? { data: null, error: { message: 'URI too long' } } : { data: b, error: null }))
  assert.deepEqual(r.error, { message: 'URI too long' })
})

test('zaehleInBloecken summiert die Zählungen, Fehler bricht ab', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => uuid(i))
  assert.deepEqual(await zaehleInBloecken(ids, async b => ({ count: b.length * 2, error: null })), { count: 500, error: null })
  const f = await zaehleInBloecken(ids, async b => (b.includes(uuid(150)) ? { count: null, error: { message: 'x' } } : { count: 1, error: null }))
  assert.deepEqual(f.error, { message: 'x' })
})

// ── Umgestellte Stellen: .in('<spalte>', …) steht in einem inBloecken/zaehleInBloecken-Rückruf ────────────────────
/** Liefert je .in('<spalte>', x) der Datei, ob x der Block-Parameter eines inBloecken-/zaehleInBloecken-Rückrufs ist */
function inAufrufe(text, spalte) {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  const besuche = n => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'in' &&
      n.arguments.length === 2 && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === spalte) {
      const arg = n.arguments[1]
      let tabelle = null
      for (let x = n.expression.expression; x && !tabelle;) {
        if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'from') tabelle = x.arguments[0]?.text ?? '?'
        x = ts.isCallExpression(x) || ts.isPropertyAccessExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x) ? x.expression : null
      }
      let ok = false
      for (let p = n.parent; p; p = p.parent) {
        // for (const block of bloecke(…)) … .in('x', block)
        if (ts.isForOfStatement(p) && ts.isIdentifier(arg) && ts.isCallExpression(p.expression) && ts.isIdentifier(p.expression.expression) &&
          p.expression.expression.text === 'bloecke' && p.initializer.getText().endsWith(arg.text)) { ok = true; break }
        if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parameters.length === 1 && ts.isIdentifier(arg) &&
          ts.isIdentifier(p.parameters[0].name) && p.parameters[0].name.text === arg.text && p.parent && ts.isCallExpression(p.parent) &&
          ts.isIdentifier(p.parent.expression) && /^(inBloecken|zaehleInBloecken|\w+InBloecken)$/.test(p.parent.expression.text)) { ok = true; break }
      }
      out.push({ zeile: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, ok, tabelle })
    }
    ts.forEachChild(n, besuche)
  }
  besuche(sf)
  return out
}

// [Datei, Spalte, Fehlerbild ohne Blöcke]
const UMGESTELLT = [
  ['src/app/(dashboard)/crm/kontakte/page.tsx', 'kontakt_id', 'Kontaktliste ab ≈ 350 Zeilen ohne Aktivitäten und Pipeline'],
  ['src/app/(dashboard)/crm/firmen/page.tsx', 'firma_id', 'Firmenliste ab ≈ 350 Zeilen ohne Ansprechpersonen'],
  ['src/app/(dashboard)/crm/page.tsx', 'id', 'Blöcke zu 300 knapp an der URL-Grenze', ['profiles']],
  ['src/lib/email/spiegel.ts', 'email_id', '200 Graph-IDs (≈ 30 KB) – jede Mail galt als neu'],
  ['src/lib/verkauf/umsatz.ts', 'rechnung_id', 'Teilzahlungen fehlten bei vielen offenen Posten (KAN-105: je Rechnung; seit KAN-346 zentral)'],
  ['src/app/api/kostenrechnung/route.ts', 'kosteneintrag_id', 'Aufteilung auf Rieden fehlte'],
  ['src/app/(dashboard)/weinhandel/page.tsx', 'fuellung_id', 'Lösch-Sperre der Füllungen fehlte'],
  ['src/app/(dashboard)/dashboard/_shared/data.ts', 'weinausbau_id', 'letzte Analyse je Charge fehlte'],
  ['src/app/(dashboard)/dashboard/_shared/data.ts', 'behaelter_id', 'letzte Maßnahme je Behälter fehlte'],
  ['src/app/(dashboard)/weinhandel/traubenverkauf/page.tsx', 'zukauf_posten_id', 'verfügbare kg aus Zukauf falsch'],
  ['src/app/(dashboard)/weingarten/actions.ts', 'weingarten_id', 'Lösch-Sperre der Rieden scheiterte'],
  ['src/app/(dashboard)/weingarten/actions.ts', 'grundstueck_id', 'Lösch-Sperre der Grundstücke scheiterte'],
  ['src/app/api/export/bmd/route.ts', 'id', 'Markierung ab ≈ 350 Belegen scheiterte (Blöcke zu 500), Storno-Belegnummern fehlten'],
  // Wächter IN_OHNE_BLOECKE (05.10.2026): Listen, die mit der Zeit unbegrenzt wachsen
  ['src/app/(dashboard)/behandlungen/actions.ts', 'grundstueck_id', 'Maßnahme über alle Rieden: Abwählen hunderter Grundstücke scheiterte'],
  ['src/app/(dashboard)/erntemeldung/actions.ts', 'pressung_id', 'Lesemengen-/Verpressungs-Prüfung bei vielen Pressungen eines Jahrgangs'],
  ['src/app/(dashboard)/kellerbuch/behaelter/[id]/umzuege/page.tsx', 'umzug_batch_id', 'Umzüge eines Behälters über die Jahre'],
  ['src/lib/behoerden/bewegungsbuch.ts', 'umzug_batch_id', 'Bewegungsbuch eines Gebindes über die Jahre'],
  ['src/lib/behoerden/keller-auswertungen.ts', 'umzug_batch_id', 'Keller-Auswertung über einen langen Zeitraum'],
  ['src/lib/wein/leseBilanz.ts', 'pressung_id', 'kg-Bilanz je Lese bei vielen Pressungen'],
]

// ausser: Tabellen mit bewusst kurzer Liste (profiles = Benutzer des Betriebs)
for (const [datei, spalte, fehlerbild, ausser = []] of UMGESTELLT) {
  test(`${datei}: .in('${spalte}') in Blöcken (sonst: ${fehlerbild})`, () => {
    const text = readFileSync(path.join(WURZEL, datei), 'utf8')
    const aufrufe = inAufrufe(text, spalte).filter(a => !ausser.includes(a.tabelle))
    assert.ok(aufrufe.length > 0, `kein .in('${spalte}') gefunden`)
    for (const a of aufrufe) assert.ok(a.ok, `${datei}:${a.zeile} .in('${spalte}') ohne inBloecken`)
  })
}

test('BMD-Export: keine eigene Blockgröße mehr (vorher 500 IDs ≈ 18 KB URL), sondern bloecke() aus lib/supabase/alle', () => {
  const text = readFileSync(path.join(WURZEL, 'src/app/api/export/bmd/route.ts'), 'utf8')
  assert.doesNotMatch(text, /function bloecke/)
  assert.match(text, /import \{[^}]*\bbloecke\b[^}]*\} from '@\/lib\/supabase\/alle'/)
})
