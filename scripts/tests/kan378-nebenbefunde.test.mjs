// KAN-378 Nebenbefunde aus der Abnahme (23.10.2026, Musterhof):
//  1. Warenlager: Storno-Sperre einer Füllung mit sichtbarem Grund; Verkaufs-Bestandszeilen sperren nicht zusätzlich;
//     Beträge brechen nicht um
//  2. „Weinhandel“ → „Warenwirtschaft“ in sichtbaren Texten; Unterseiten (Füllung bearbeiten) markieren den Bereich
//     Warenwirtschaft statt Übersicht
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fuellungStornoSperre, fuellungStornoSperren } from '../../src/lib/handel/fuellungStornoSperre.ts'
import { aktiverBereichIndex, isActivePath } from '../../src/lib/navigation/aktiv.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const quelle = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('Befund 1: Storno-Sperre einer Füllung', () => {
  test('nur Verkaufs-Bestandszeilen (verkauf/verkauf_storno) und kein offener Verkauf → stornierbar (Regression Musterhof „GV 1 l“)', () => {
    const sperren = fuellungStornoSperren(
      [{ id: 'f1', zukauf_posten_id: null }],
      [],
      [{ fuellung_id: 'f1', art: 'verkauf' }, { fuellung_id: 'f1', art: 'verkauf_storno' }],
    )
    assert.equal(sperren.has('f1'), false)
  })

  test('Verkäufe: Anzahl je Verkaufsposten, Flaschen summiert, Handlungsanweisung', () => {
    const sperren = fuellungStornoSperren(
      [{ id: 'f1' }],
      [
        { fuellung_id: 'f1', verkaufsposten_id: 'v1', menge: 12 },
        { fuellung_id: 'f1', verkaufsposten_id: 'v1', menge: 6 },
        { fuellung_id: 'f1', verkaufsposten_id: 'v2', menge: 1000 },
      ],
      [{ fuellung_id: 'f1', art: 'verkauf' }],
    )
    assert.equal(sperren.get('f1'),
      'Nicht stornierbar: 2 Verkäufe (1.018 Flaschen) gebucht – zuerst die Verkäufe stornieren (Warenwirtschaft › Verkauf).')
  })

  test('ein Verkauf und eine Inventur: Einzahl und Zusatz', () => {
    const t = fuellungStornoSperre({ zukauf: false, verkaeufe: 1, flaschenVerkauft: 1, bewegungen: 1 })
    assert.equal(t, 'Nicht stornierbar: 1 Verkauf (1 Flasche) gebucht – zuerst den Verkauf stornieren (Warenwirtschaft › Verkauf). Außerdem gibt es 1 Bestandsbuchung.')
  })

  test('nur Bestandsbuchungen (Inventur, Bruch …) sperren mit Hinweis auf „Bestand korrigieren“', () => {
    const sperren = fuellungStornoSperren([{ id: 'f1' }], [], [{ fuellung_id: 'f1', art: 'inventur' }, { fuellung_id: 'f1', art: 'bruch' }])
    assert.match(sperren.get('f1'), /^Nicht stornierbar: 2 Bestandsbuchungen .*„Bestand korrigieren“/)
  })

  test('Handelsware aus einem Flaschenzukauf: Storno über den Zukauf im Kellerbuch (Vorrang)', () => {
    const sperren = fuellungStornoSperren([{ id: 'f1', zukauf_posten_id: 'z1' }], [{ fuellung_id: 'f1', verkaufsposten_id: 'v1', menge: 1 }], [])
    assert.match(sperren.get('f1'), /Flaschenzukauf – bitte den Zukauf stornieren \(Kellerbuch › Zukauf\)/)
  })

  test('ohne Folgebuchungen keine Sperre', () => {
    assert.equal(fuellungStornoSperren([{ id: 'f1' }], [], []).size, 0)
    assert.equal(fuellungStornoSperre({ zukauf: false, verkaeufe: 0, flaschenVerkauft: 0, bewegungen: 0 }), null)
  })

  test('Warenlager lädt Bestandsbuchungen ohne Verkaufszeilen und nutzt die gemeinsame Regel', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/page.tsx')
    assert.match(s, /fuellungStornoSperren\(fuellungen, \(vkRaw/)
    assert.match(s, /\.not\('art', 'in', `\(\$\{VERKAUFS_BEWEGUNGEN\.join\(','\)\}\)`\)/)
    assert.match(s, /select\('fuellung_id, verkaufsposten_id, menge, verkaufsposten!inner\(storniert\)'\)/)
    // dieselbe Zählung wie die Server Action (folgebuchungenDerFuellung)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/folgebuchungen.ts'), /\.not\('art', 'in', '\(verkauf,verkauf_storno\)'\)/)
  })

  test('gesperrter Mistkübel ist bedienbar und zeigt den Grund (nicht nur Tooltip)', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/FuellungLoeschen.tsx')
    const gesperrt = s.slice(s.indexOf('function GesperrtKnopf'))
    assert.doesNotMatch(gesperrt, /\sdisabled[\s>]/, 'ein disabled-Knopf bekommt weder Klick noch Fokus')
    assert.match(gesperrt, /aria-disabled="true"/)
    assert.match(gesperrt, /title=\{grund\}/)
    assert.match(gesperrt, /aria-label=\{`Stornieren nicht möglich/)
    assert.match(gesperrt, /onClick=\{umschalten\}/)
    assert.match(gesperrt, /role="status"[\s\S]*\{grund\}/)
    assert.match(gesperrt, /e\.key === 'Escape'/)
  })

  test('Beträge im Warenlager brechen nicht um (€ und Zahl in einer Zeile)', () => {
    const s = quelle('src/app/(dashboard)/weinhandel/page.tsx')
    const zellen = [...s.matchAll(/<td className="([^"]*)">\s*\{[^}]*?\n?\s*\? fmtEur\(/g)].map(m => m[1])
    assert.ok(zellen.length >= 7, `zu wenige Betragszellen gefunden: ${zellen.length}`)
    for (const k of zellen) assert.match(k, /whitespace-nowrap/, `Betragszelle ohne whitespace-nowrap: ${k}`)
  })
})

describe('Befund 2: Bereich heißt Warenwirtschaft', () => {
  const BEREICHE = [
    { key: 'uebersicht', items: [{ href: '/dashboard' }] },
    { key: 'kellerbuch', items: [{ href: '/kellerbuch' }, { href: '/weinhandel/zukauf' }, { href: '/kellerbuch/journal' }] },
    { key: 'warenwirtschaft', items: [{ href: '/weinhandel' }, { href: '/weinhandel/verkauf' }] },
    { key: 'crm', items: [{ href: '/crm' }, { href: '/crm/kontakte' }] },
  ]
  const bereich = p => BEREICHE[aktiverBereichIndex(BEREICHE, p)].key

  test('Füllung bearbeiten (und andere Unterseiten von /weinhandel) gehören zur Warenwirtschaft, nicht zur Übersicht', () => {
    assert.equal(bereich('/weinhandel/fuellungen/abc/edit'), 'warenwirtschaft')
    assert.equal(bereich('/weinhandel/fuellungen/neu'), 'warenwirtschaft')
    assert.equal(bereich('/kellerbuch/weinausbau/abc'), 'kellerbuch')
  })

  test('direkte Treffer bleiben vorrangig, exakte Pfade matchen weiter nur exakt', () => {
    assert.equal(bereich('/weinhandel'), 'warenwirtschaft')
    assert.equal(bereich('/weinhandel/zukauf/neu'), 'kellerbuch')
    assert.equal(bereich('/weinhandel/verkauf/123'), 'warenwirtschaft')
    assert.equal(bereich('/crm/kontakte/1'), 'crm')
    assert.equal(bereich('/weinhandelx'), 'uebersicht')
    assert.equal(bereich('/unbekannt'), 'uebersicht')
    assert.equal(isActivePath('/weinhandel', '/weinhandel/fuellungen/x/edit'), false)
  })

  test('activeGroup nutzt die gemeinsame Regel', () => {
    assert.match(quelle('src/lib/navigation/index.ts'), /return groups\[aktiverBereichIndex\(groups, pathname\)\]/)
  })

  test('kein sichtbares „Weinhandel“ mehr in Brotkrümeln und Pfadangaben', () => {
    const treffer = []
    const lauf = dir => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) { lauf(rel); continue }
        if (!/\.tsx?$/.test(e.name)) continue
        const s = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        if (/>Weinhandel</.test(s) || /Weinhandel ›/.test(s) || /Weinhandel > /.test(s) || /bereich: 'Weinhandel'/.test(s)) treffer.push(rel)
      }
    }
    lauf('src')
    assert.deepEqual(treffer, [])
  })
})

// KAN-378 Nebenbefund 3 (UAT 24.10.2026): „Füllung bearbeiten“ aus dem Warenlager abgeschnitten, Strg+F5 half.
// Die sr-only-Datei-Felder unter „Hochladen“ (absolut positioniert) bezogen sich auf das Dokument, ragten aus <main>
// heraus und machten das Dokument scrollbar (html overflow-hidden) – Next.js schob es beim Navigieren hoch.
test('App-Rahmen und <main> sind Bezugsrahmen für absolut positionierte Elemente', () => {
  const s = fs.readFileSync(path.join(ROOT, 'src/components/layout/AppShell.tsx'), 'utf8')
  assert.match(s, /<div className="h-screen supports-\[height:100dvh\]:h-dvh relative flex flex-col overflow-clip /)
  assert.match(s, /<main id="inhalt" data-app-rahmen tabIndex=\{-1\} className="relative flex-1 min-w-0 overflow-x-auto overflow-y-auto/)
})

test('Scroll-Sperre des Dokuments nur mit App-Rahmen – Barrierefreiheit und Newsletter scrollen', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8')
  assert.doesNotMatch(css, /html:has\(main#inhalt\)/)
  assert.match(css, /html:has\(main#inhalt\[data-app-rahmen\]\) body \{/)
  for (const f of ['src/app/barrierefreiheit/page.tsx', 'src/app/newsletter/NewsletterRahmen.tsx'])
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /data-app-rahmen/, f)
})
