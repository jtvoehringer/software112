// UAT-Paket „A Druck“ (22.10.2026): KAN-345 Transportbescheinigung druckt leer, KAN-344 Rechnung auf 2 Seiten
// (App-Fußzeile mitgedruckt), KAN-366 Sammelliste Transportbescheinigungen ohne Alkohol/°KMW, KAN-367 Druck der
// Prüfnummernanträge und Wächter „Seite mit Behördenmeldung hat einen Druckknopf“ (check-behoerden-csv.js, Regel 7).
//
// Aufruf:  npm run -s test:csv   bzw.  node --experimental-strip-types --test scripts/tests/uat-a-druck.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks, createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const SRC = path.join(ROOT, 'src')

function tsDatei(basis) {
  for (const k of [basis, `${basis}.ts`, `${basis}.tsx`, path.join(basis, 'index.ts')]) {
    if (existsSync(k) && !k.endsWith(path.sep) && path.extname(k)) return k
  }
  return null
}

registerHooks({
  resolve(spezifizierer, kontext, weiter) {
    if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
    if (spezifizierer.startsWith('@/')) {
      const datei = tsDatei(path.join(SRC, spezifizierer.slice(2)))
      if (datei) return { url: pathToFileURL(datei).href, shortCircuit: true }
    }
    if ((spezifizierer.startsWith('./') || spezifizierer.startsWith('../')) && kontext.parentURL?.startsWith('file:') && !path.extname(spezifizierer)) {
      const datei = tsDatei(path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer))
      if (datei) return { url: pathToFileURL(datei).href, shortCircuit: true }
    }
    return weiter(spezifizierer, kontext)
  },
})

const tb = await import('../../src/lib/behoerden/transportbescheinigung.ts')
const tbm = await import('../../src/lib/behoerden/tbMostgewicht.ts')

const require = createRequire(import.meta.url)
const WAECHTER = path.join(ROOT, 'scripts', 'check-behoerden-csv.js')
const { druckknopfBefund, importPfade, ohneKommentare } = require(WAECHTER)

const quelle = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

function dateien(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? dateien(p) : /\.(tsx?|jsx?|css|mjs)$/.test(e.name) ? [p] : []
  })
}

/** Kopfzeilen (<th>-Texte) einer Tabelle im Quelltext, ohne leere Spalten */
const kopfzeilen = (text) => [...text.matchAll(/<th\b[^>]*>([^<{]*)<\/th>/g)].map(m => m[1].trim()).filter(Boolean)

describe('KAN-345: Transportbescheinigung druckt', () => {
  test('kein „#__next“ im ganzen src/ (gibt es im App Router nicht – die Druckregel blendete alles aus)', () => {
    const treffer = dateien(SRC).filter(f => readFileSync(f, 'utf8').includes('#__next')).map(f => path.relative(ROOT, f))
    assert.deepEqual(treffer, [])
  })

  test('TB-Formular blendet im Druck nur die Bedienelemente aus', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx')
    const druck = /@media print \{([\s\S]*?)\n\s*\}\n/.exec(s)?.[1] ?? ''
    assert.match(druck, /\.no-print \{ display: none !important; \}/)
    assert.doesNotMatch(druck, /body\s*>/, 'keine Regel auf body > * – sie traf das ganze Formular')
  })

  // Nachtrag UAT 23.10.2026: Druck und PDF brachen auf zwei Seiten um (Unterschriften auf Seite 2), der Assistent-Knopf
  // druckte mit
  test('eine Seite A4 quer: @page fest, Rand über @page statt Innenabstand, Unterschriften nicht getrennt', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx')
    const druck = /@media print \{([\s\S]*?)\n\s*\}\n/.exec(s)?.[1] ?? ''
    assert.match(druck, /@page \{ size: A4 landscape; margin: 8mm 10mm; \}/)
    assert.match(druck, /#tb-formular \{ margin: 0; border: none; padding: 0; font-size: 9pt; \}/)
    assert.match(s, /id="tb-formular"/)
    assert.match(s, /className="[^"]*\bprint:space-y-2\b[^"]*" id="tb-formular"/)
    assert.match(s, /\{\/\* Unterschriften[^\n]*\*\/\}\n\s*<div className="[^"]*\bbreak-inside-avoid\b/)
    assert.equal((s.match(/h-10 print:h-8 border-b/g) ?? []).length, 2, 'beide Unterschriftszeilen kompakter')
  })

  test('Assistent-Knopf (bot:112) wird nirgends mitgedruckt', () => {
    const w = quelle('src/components/assistent/AssistentWidget.tsx')
    assert.match(w, /<div className="fixed bottom-5 right-5[^"]*\bprint:hidden\b[^"]*" data-print="hide">/)
  })
})

describe('KAN-344: Rechnung auf einer Seite', () => {
  test('App-Fußzeile (Logo, Version) wird nicht gedruckt', () => {
    const s = quelle('src/components/layout/AppShell.tsx')
    const footer = /<footer\b[^>]*>/.exec(s)?.[0] ?? ''
    assert.match(footer, /data-print="hide"/)
    assert.match(footer, /\bprint:hidden\b/)
  })

  test('Druck: Innenabstand des Inhaltsrahmens in main entfällt', () => {
    const css = quelle('src/app/globals.css')
    const druck = css.slice(css.indexOf('@media print'))
    assert.match(druck, /main#inhalt > div \{[^}]*padding: 0 !important;/)
    assert.match(druck, /\[data-print="hide"\][\s\S]*?display: none !important/)
  })

  for (const datei of ['src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx', 'src/app/(dashboard)/weinhandel/rechnungen/[id]/page.tsx']) {
    test(`${datei}: im Druck kompakter (Logo kleiner, Fußblock nicht getrennt)`, () => {
      const s = quelle(datei)
      assert.match(s, /<img src=\{[^}]+\} alt="Logo" className="[^"]*\bprint:h-10\b/, 'Logo im Druck kleiner')
      assert.match(s, /className="[^"]*\bmt-8\b[^"]*\bprint:mt-4\b[^"]*\bbreak-inside-avoid\b/, 'Fußblock (Bank, Fußtext) bricht nicht um')
      assert.match(s, /\bprint:mb-4\b/, 'Abstände im Briefkopf kleiner')
    })
  }
})

describe('KAN-366: Sammelliste Transportbescheinigungen', () => {
  const SEITE = 'src/app/(dashboard)/weinhandel/transportbescheinigungen/page.tsx'
  // Spalte der Liste → Spalte der CSV (gleiche Ladefunktion, „gleiche Spalten wie die einzelne TB“)
  const LISTE_ZU_CSV = {
    Verkaufsdatum: 'Verkaufsdatum',
    Rechnung: 'Rechnungsnummer',
    'Empfänger': 'Empfänger Firmen- oder Familienname',
    Lieferung: 'Datum der Lieferung',
    'Pos.': 'Position',
    Menge: 'Menge (Liter/kg)',
    Art: 'Art (Rot/Weiß/Rosé)',
    'Traubensorte(n)': 'Traubensorte(n)',
    Jahrgang: 'Jahrgang',
    'Prüfnummer': 'Staatliche Prüfnummer',
    Angereichert: 'Angereichert',
    'Alkohol (% vol)': 'Alkohol (% vol)',
    '°KMW': 'Mostgewicht (°KMW)',
    Formularstand: 'Formularstand',
  }

  test('jede Kopfzeile der Liste ist eine Spalte der CSV', () => {
    const csv = new Set(tb.SPALTEN_TRANSPORTBESCHEINIGUNG.map(s => s.kopf))
    const liste = kopfzeilen(quelle(SEITE))
    assert.deepEqual(liste, Object.keys(LISTE_ZU_CSV), 'Reihenfolge und Umfang der Listenspalten')
    for (const k of liste) assert.ok(csv.has(LISTE_ZU_CSV[k]), `„${k}“ → „${LISTE_ZU_CSV[k]}“ fehlt in der CSV`)
  })

  test('Alkohol und °KMW stehen in Liste und CSV (Befund KAN-366)', () => {
    const csv = tb.SPALTEN_TRANSPORTBESCHEINIGUNG.map(s => s.kopf)
    assert.ok(csv.includes('Alkohol (% vol)') && csv.includes('Mostgewicht (°KMW)'))
    const s = quelle(SEITE)
    assert.match(s, /\{z\.alkohol \?\? '–'\}/)
    assert.match(s, /\{tbKmwFormblattWert\(z\.kmw\) \|\| '–'\}/)
  })

  test('Druck im Querformat über DruckFormatKnopf, eigener DruckKnopf entfernt', () => {
    const s = quelle(SEITE)
    assert.match(s, /<DruckFormatKnopf standard="quer" \/>/)
    assert.ok(!existsSync(path.join(ROOT, 'src/app/(dashboard)/weinhandel/transportbescheinigungen/DruckKnopf.tsx')))
  })

  test('°KMW wie im Formblatt: NN,N abgerundet, ohne Wert leer (Wein → „–“ in der Liste)', () => {
    assert.equal(tbm.tbKmwFormblattWert(17.09), '17', 'NN,N ohne Null-Nachkomma wie im Formblatt')
    assert.equal(tbm.tbKmwFormblattWert(18.96), '18,9', 'abgerundet, nie kaufmännisch')
    assert.equal(tbm.tbKmwFormblattWert(17.15), '17,1')
    assert.equal(tbm.tbKmwFormblattWert(null), '')
    assert.equal(tbm.tbKmwFormblattWert(undefined), '')
    assert.equal(tbm.tbKmwFormblattWert(Number.NaN), '')
  })

  test('Liste und einzelne TB zeigen denselben °KMW-Wert', () => {
    for (const p of [
      { alkohol_pct: '', kmw: '18,96', oechsle: '', mostgewicht_einheit: 'kmw' },
      { alkohol_pct: '', kmw: '', oechsle: '84', mostgewicht_einheit: 'oechsle' },
      { alkohol_pct: '18,5 °KMW', kmw: '' },   // Altformular
      { alkohol_pct: '12,5', kmw: '' },        // Wein
    ]) {
      assert.equal(tbm.tbKmwFormblattWert(tbm.tbPositionMostgewicht(p)?.kmw), tbm.tbKmwFormblatt(p), JSON.stringify(p))
    }
  })
})

describe('KAN-367: Druck der Prüfnummernanträge', () => {
  const s = quelle('src/app/(dashboard)/dac/page.tsx')

  test('Druckknopf neben der CSV', () => {
    assert.match(s, /import DruckFormatKnopf from '@\/components\/DruckFormatKnopf'/)
    assert.match(s, /<DruckFormatKnopf klein \/>[\s\S]{0,40}\n\s*<CsvExportKnopf href=\{csvPfad\('dac-antraege'\)\}/)
  })

  test('Kennzahlen und Prüfbericht Altanträge nicht im Druck, Tabelle mit Status und „Status seit“', () => {
    assert.match(s, /\{\/\* Stats \*\/\}\n\s*<div className="grid grid-cols-3 gap-4 mb-6 print:hidden">/)
    assert.match(s, /<section className="[^"]*print:hidden">\n\s*<h2[^>]*>Prüfbericht Altanträge/)
    const koepfe = kopfzeilen(s)
    assert.ok(koepfe.includes('Status') && koepfe.includes('Status seit'), koepfe.join(' | '))
    assert.match(s, /a\.statusSeit \? new Date\(a\.statusSeit\)\.toLocaleDateString\('de-AT', \{ timeZone: 'Europe\/Vienna' \}\)/)
  })
})

describe('Wächter check-behoerden-csv: Seite mit Behördenmeldung hat einen Druckknopf', () => {
  const MARKER = '// behoerdenmeldung: beispiel\n'

  test('Druckknopf in der Seite', () => {
    for (const code of ['<DruckFormatKnopf />', '<PrintButton />', '<DruckKnopf />', 'onClick={() => window.print()}', 'druckeSeite(format)']) {
      assert.equal(druckknopfBefund(`${MARKER}export default function S() { return ${code} }`), 'ok', code)
    }
  })

  test('Druckknopf in einer direkt importierten Komponente', () => {
    assert.equal(druckknopfBefund(`${MARKER}import F from './F'`, ["'use client'\nexport default () => <button onClick={() => window.print()} />"]), 'ok')
  })

  test('ohne Druckknopf – auch wenn er nur im Kommentar steht – ist ein Fund', () => {
    assert.equal(druckknopfBefund(`${MARKER}<CsvExportKnopf href="/meldungen/beispiel/csv" />`), 'fehlt')
    assert.equal(druckknopfBefund(`${MARKER}// TODO: <DruckFormatKnopf /> ergänzen\n/* window.print() */\n<CsvExportKnopf />`), 'fehlt')
    assert.equal(ohneKommentare('a // b\nc /* d */ e'), 'a \nc  e')
  })

  test('Ausnahme nur mit Begründung', () => {
    assert.equal(druckknopfBefund(`${MARKER}// druckknopf-ausnahme: reine Importdatei für die BKI-Weindatenbank\n`), 'ausnahme')
    assert.equal(druckknopfBefund(`${MARKER}// druckknopf-ausnahme\n`), 'ausnahme_ohne_grund')
    assert.equal(druckknopfBefund(`${MARKER}// druckknopf-ausnahme: zu kurz\n`), 'ausnahme_ohne_grund')
  })

  test('Importe: nur Komponenten aus src/app und src/components, nicht src/lib', () => {
    const seite = path.join(ROOT, 'src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/page.tsx')
    const pfade = importPfade(readFileSync(seite, 'utf8'), seite).map(f => path.relative(ROOT, f).split(path.sep).join('/'))
    assert.ok(pfade.includes('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx'), pfade.join('\n'))
    assert.ok(pfade.every(p => !p.startsWith('src/lib/')))
  })

  test('alle Seiten mit Marker im Projekt: grün, Ausnahmen begründet', () => {
    const r = spawnSync(process.execPath, [WAECHTER], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /\d+ Seiten mit Marker, davon \d+ ohne Druckknopf \(begründet\)/)
    // Seiten, die mit diesem Paket einen Druckknopf bekommen haben, bleiben ohne Ausnahme
    for (const p of ['dac/page.tsx', 'buchhaltung/page.tsx', 'kellerbuch/bki-rv/page.tsx', 'weinexport/page.tsx',
      'buchhaltung/svs/page.tsx', 'weinexport/[id]/page.tsx', 'weinhandel/traubenverkauf/page.tsx']) {
      const f = path.join(ROOT, 'src/app/(dashboard)', p)
      const s = readFileSync(f, 'utf8')
      assert.equal(druckknopfBefund(s, importPfade(s, f).map(x => readFileSync(x, 'utf8'))), 'ok', p)
    }
  })
})
