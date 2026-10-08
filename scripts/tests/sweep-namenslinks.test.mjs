// Sweep „Name statt Details-Knopf“ (07.10.2026, Wunsch Jörgen): In Listen und Tabellen führt der
// Name bzw. die Nummer des Objekts selbst zur Detailseite (Produktname, Charge, Rechnungsnummer,
// Jahrgang …). Eigene reine Navigations-Knöpfe wie „Details →“, „Öffnen“ oder ein nacktes „→“
// entfallen. Knöpfe mit eigener Aktion (Bearbeiten, Stornieren, Bewegungen →, Drucken …) bleiben.
//
// Aufruf:  npm run -s test:csv   bzw. node --test scripts/tests/sweep-namenslinks.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = rel => readFileSync(path.join(ROOT, rel), 'utf8')

const DASHBOARD = path.join(ROOT, 'src', 'app', '(dashboard)')

function tsxDateien(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...tsxDateien(p))
    else if (e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

// <Link …>Details →</Link>, <a …>Öffnen</a>, <Link …>→</Link> usw. – der ganze sichtbare Text
// ist ein generisches Navigationswort ohne Namen des Objekts.
const GENERISCHER_LINK = /<(Link|a)\b[^>]*>\s*(?:(?:Details|Detail|Öffnen|Ansehen|Anzeigen|Beleg)\s*(?:→)?|→\s*(?:Beleg\s+)?(?:ansehen|öffnen|anzeigen)|→)\s*<\/\1>/g

// Bewusste Ausnahmen: 'pfad/relativ/zu/(dashboard)' → Begründung (≥ 15 Zeichen). Derzeit keine.
const AUSNAHMEN = {}

describe('Sweep Namenslinks: Rückverfolgung › Füllungen', () => {
  const src = lies('src/app/(dashboard)/kellerbuch/rueckverfolgung/page.tsx')
  // Ausschnitt der Treffertabelle (von der Kopfzeile „Produktname“ bis zum Tabellenende)
  const start = src.indexOf('>Produktname</th>')
  const tabelle = src.slice(start, src.indexOf('</table>', start))

  test('Treffertabelle gefunden', () => {
    assert.ok(start > 0, 'Kopfzeile „Produktname“ fehlt')
  })
  test('Produktname ist ein Link auf die Detailansicht der Füllung', () => {
    assert.match(tabelle,
      /<Link href=\{`\/kellerbuch\/rueckverfolgung\?fuellung_id=\$\{f\.id\}`\}[^>]*>\s*\{f\.name \|\| 'Füllung ohne Namen'\}\s*<\/Link>/)
  })
  test('kein „Details →“-Knopf und keine leere Knopf-Spalte mehr', () => {
    assert.doesNotMatch(tabelle, /Details/)
    assert.doesNotMatch(tabelle, /<th className="px-3 py-2 print:hidden" \/>/)
  })
})

describe('Sweep Namenslinks: weitere Listen', () => {
  test('Weinausbau: Chargenname ist Link, kein Details-Knopf', () => {
    const src = lies('src/app/(dashboard)/kellerbuch/weinausbau/page.tsx')
    assert.match(src, /<Link href=\{`\/kellerbuch\/weinausbau\/\$\{w\.id\}`\}[^>]*>\s*\{w\.name \|\| 'Charge ohne Namen'\}/)
    assert.doesNotMatch(src, /Details →/)
  })
  test('Verkäufe: Rechnungsnummer ist Link, kein Details-Knopf', () => {
    const src = lies('src/app/(dashboard)/weinhandel/verkauf/page.tsx')
    // KAN-103: nicht berechnete Lieferscheine zeigen ihre Lieferscheinnummer als Link
    assert.match(src, /<Link href=\{`\/weinhandel\/verkauf\/\$\{p\.id\}`\}[^>]*>\s*\{p\.rechnungsnummer \?\? p\.lieferscheinnummer \?\? 'ohne Belegnr\.'\}/)
    assert.doesNotMatch(src, /Details →/)
  })
  test('Jahrgänge (Lese): Jahreszahl ist Link, kein „Öffnen“-Knopf', () => {
    const src = lies('src/app/(dashboard)/erntemeldung/JahrgaengeClient.tsx')
    assert.match(src, /<Link href=\{`\/erntemeldung\/\$\{j\.id\}`\} aria-label=\{`Jahrgang \$\{j\.jahrgang\}`\}/)
    assert.doesNotMatch(src, />\s*Öffnen\s*<\/Link>/)
  })
  test('Firma/Kontakt › Verkäufe: Belegnummer ist Link statt „Beleg →“/„→“', () => {
    for (const datei of ['crm/firmen/[id]/FirmaDetailClient.tsx', 'crm/kontakte/[id]/KontaktDetailClient.tsx']) {
      const src = lies(`src/app/(dashboard)/${datei}`)
      assert.match(src, /<Link href=\{`\/weinhandel\/verkauf\/\$\{v\.id\}`\}[^>]*>\s*\{v\.rechnungsnummer \?\? 'ohne Belegnr\.'\}/, datei)
    }
  })
})

describe('Sweep Namenslinks: Nachtrag (Rückmeldung Jörgen 07.10.2026)', () => {
  test('Bericht Weinbücher: Chargenname ist Link aufs Weinbuch, kein „Weinbuch →“', () => {
    const src = lies('src/app/(dashboard)/reports/ReportsClient.tsx')
    assert.match(src, /<Link href=\{`\/kellerbuch\/weinausbau\/\$\{c\.id\}\/buch`\}[^>]*>\s*\{c\.name \|\| 'Charge ohne Namen'\}/)
    assert.doesNotMatch(src, />\s*Weinbuch →\s*<\/Link>/)
  })
  test('Aktivitäten-Zeitleiste (Firma/Kontakt): Betreff ist Link zum Verkauf, kein „→ Beleg ansehen“', () => {
    for (const datei of ['crm/firmen/[id]/FirmaDetailClient.tsx', 'crm/kontakte/[id]/KontaktDetailClient.tsx']) {
      const src = lies(`src/app/(dashboard)/${datei}`)
      assert.match(src, /<Link href=\{`\/weinhandel\/verkauf\/\$\{postenId\}`\}[^>]*>\{a\.betreff \|\| 'Verkauf'\}<\/Link>/, datei)
      assert.doesNotMatch(src, /Beleg ansehen/, datei)
    }
  })
  test('Zukauf: Rechnungsnummer ist echter Link in der klickbaren Zeile', () => {
    const src = lies('src/app/(dashboard)/weinhandel/zukauf/page.tsx')
    assert.match(src, /<Link href=\{`\/weinhandel\/zukauf\/\$\{p\.id\}\/edit`\}[^>]*>\s*\{p\.eingangsrechnungsnummer \|\| 'ohne Rechnungsnr\.'\}/)
    assert.match(src, /<ClickableTableRow key=\{p\.id\} href=\{`\/weinhandel\/zukauf\/\$\{p\.id\}\/edit`\}/)
  })
})

describe('Sweep Namenslinks: Regel für die ganze App', () => {
  test('kein reiner Navigations-Link „Details →“/„Öffnen“/„→“ in src/app/(dashboard)', () => {
    const funde = []
    for (const datei of tsxDateien(DASHBOARD)) {
      const rel = path.relative(DASHBOARD, datei).split(path.sep).join('/')
      if (AUSNAHMEN[rel]) continue
      const src = readFileSync(datei, 'utf8')
      for (const m of src.matchAll(GENERISCHER_LINK)) {
        const zeile = src.slice(0, m.index).split('\n').length
        funde.push(`${rel}:${zeile}  ${m[0].replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }
    assert.deepEqual(funde, [], 'Den Namen des Objekts zum Link machen statt eines eigenen Details-Knopfs:\n' + funde.join('\n'))
  })
  test('Ausnahmen sind begründet', () => {
    for (const [pfad, grund] of Object.entries(AUSNAHMEN)) {
      assert.ok(typeof grund === 'string' && grund.length >= 15, `Ausnahme ${pfad} ohne Begründung`)
    }
  })
  test('Regel erkennt die alten Muster (Selbsttest)', () => {
    const proben = [
      '<Link href="/x" className="a">\n  Details →\n</Link>',
      '<a href="/x" className="a">→</a>',
      '<Link href="/x">Öffnen</Link>',
      '<a href="/x" className="a">Beleg →</a>',
      '<a href="/x" className="a">\n  → Beleg ansehen\n</a>',
    ]
    for (const p of proben) assert.equal([...p.matchAll(GENERISCHER_LINK)].length, 1, p)
    const erlaubt = [
      '<Link href="/x">Bewegungen →</Link>',
      '<Link href="/x">alle Details →</Link>',
      '<Link href="/x" className="a">{f.name}</Link>',
    ]
    for (const p of erlaubt) assert.equal([...p.matchAll(GENERISCHER_LINK)].length, 0, p)
  })
})
