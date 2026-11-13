// KAN-456 (13.11.2026): Rollen/Rechte R4, Teil 1 – Navigation, Befehlspalette und Seiten-Guards je Profil.
// Befund: Datenbank und Routen sperren je Profil (KAN-454/455), die Oberfläche zeigte aber weiter jeden Menüpunkt –
// ein Mitarbeiter mit Profil wäre auf leeren Listen oder Fehlerseiten gelandet. Neu: eine Liste Seite → Lesebereich
// (seitenBereich.ts) für Navigation, Befehlspalette und Guards; gesperrte Seiten leiten auf die Übersicht mit Hinweis.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LESEBEREICHE, lesbareBereiche, KEIN_LESERECHT_TEXT } from '../../src/lib/auth/lesebereiche.ts'
import { SEITEN_BEREICH, seitenBereich, seitenRegel } from '../../src/lib/navigation/seitenBereich.ts'

const require = createRequire(import.meta.url)
const { pruefe, regelnAus, seiten, adresse, guardFuer } = require('../check-lesebereich-seiten.js')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const BASIS = path.join(WURZEL, 'src', 'app', '(dashboard)')
const lies = rel => (existsSync(path.join(BASIS, rel)) ? readFileSync(path.join(BASIS, rel), 'utf8') : null)
const NAV = quelle('src/lib/navigation/index.ts')
/** Einträge der Navigation aus dem Quelltext: [{ gruppe, href }] */
function navEintraege() {
  const liste = []
  let gruppe = null
  for (const z of NAV.split('\n')) {
    const g = /^ {4}key: '([a-z_]+)', label: /.exec(z)
    if (g) gruppe = g[1]
    const h = /^ {6}\{ href: '([^']+)'/.exec(z)
    if (h && gruppe) liste.push({ gruppe, href: h[1] })
  }
  return liste
}
const EINTRAEGE = navEintraege()
const sichtbar = profil => {
  const lesbar = lesbareBereiche({ role: 'winzer', profil })
  return EINTRAEGE.filter(e => lesbar.includes(seitenBereich(e.href))).map(e => e.href)
}

describe('KAN-456: Lesebereich je Seite', () => {
  test('längster Pfad gewinnt; Abfrage und Schrägstrich am Ende zählen nicht', () => {
    assert.equal(seitenBereich('/weinhandel'), 'lager')
    assert.equal(seitenBereich('/weinhandel/verkauf/neu?kunde=1'), 'verkauf')
    assert.equal(seitenBereich('/weinhandel/fuellungen/abc/edit/'), 'lager')
    assert.equal(seitenBereich('/behandlungen/neu'), 'massnahmen')
    assert.equal(seitenBereich('/behandlungen/lager'), 'betriebsmittel')
    assert.equal(seitenBereich('/controlling/bmd'), 'ea')
    assert.equal(seitenBereich('/dashboard'), 'allgemein')
    assert.equal(seitenBereich('/dashboard/kellerbuch'), 'keller')
    assert.deepEqual(seitenRegel('/weinhandelx'), null)   // kein Treffer auf einen Pfad-Anfang ohne Schrägstrich
  })
  test('ohne Regel: für jedes Profil gesperrt', () => {
    assert.equal(seitenBereich('/gibt-es-nicht'), 'verwaltung')
  })
  test('jede Regel nennt einen bekannten Bereich; kein Pfad doppelt', () => {
    for (const [p, b] of SEITEN_BEREICH) assert.ok(LESEBEREICHE.includes(b), p)
    assert.equal(new Set(SEITEN_BEREICH.map(r => r[0])).size, SEITEN_BEREICH.length)
  })
  test('der Wächter liest dieselben Regeln aus dem Quelltext', () => {
    assert.deepEqual(regelnAus(quelle('src/lib/navigation/seitenBereich.ts')), SEITEN_BEREICH.map(r => [...r]))
  })
})

describe('KAN-456: Navigation je Profil', () => {
  test('die Navigation ist vollständig gelesen und jeder Eintrag hat eine Regel', () => {
    assert.ok(EINTRAEGE.length >= 80, `nur ${EINTRAEGE.length} Einträge`)
    for (const e of EINTRAEGE) assert.ok(seitenRegel(e.href), e.href)
  })
  test('ohne Profil: jede Rolle sieht jeden Eintrag wie bisher (Filter greift nicht)', () => {
    for (const role of ['system_admin', 'tenant_admin', 'winzer', 'leser']) {
      const lesbar = lesbareBereiche({ role })
      assert.deepEqual(lesbar, [...LESEBEREICHE], role)
      assert.equal(EINTRAEGE.filter(e => lesbar.includes(seitenBereich(e.href))).length, EINTRAEGE.length, role)
    }
  })
  test('Extern: Übersicht, Weingarten-Sicht, Rieden, Rebsorten, Maßnahmen – und das Allgemeine', () => {
    assert.deepEqual(sichtbar('extern').filter(h => !/^\/(hilfe|profil|admin|betrieb)\b/.test(h)),
      ['/dashboard', '/dashboard/weingarten', '/weingarten/uebersicht', '/weingarten', '/weingarten/rebsorten', '/behandlungen'])
    for (const h of ['/behandlungen/lager', '/erntemeldung', '/reports/behandlungsprotokoll', '/weingarten/rueckverfolgung', '/kellerbuch', '/crm', '/nachrichten',
      '/weinhandel/verkauf', '/buchhaltung', '/ki', '/dashboard/journal', '/dashboard/morgenbericht']) assert.ok(!sichtbar('extern').includes(h), h)
  })
  test('Vertrieb: Warenwirtschaft, CRM, Controlling, KI – nicht Rieden, Kellerbuch, E&A', () => {
    const v = sichtbar('vertrieb')
    for (const h of ['/dashboard', '/dashboard/verkauf', '/dashboard/fristen', '/weinhandel', '/weinhandel/verkauf', '/weinhandel/angebote',
      '/weinhandel/auftraege', '/weinhandel/offene-posten', '/weinhandel/zukauf', '/weinexport', '/crm', '/nachrichten', '/crm/kontakte', '/reports',
      '/controlling/kostenrechnung', '/controlling/fristen', '/ki']) assert.ok(v.includes(h), h)
    for (const h of ['/weingarten', '/behandlungen', '/erntemeldung', '/kellerbuch', '/kellerbuch/pressungen', '/dac', '/buchhaltung', '/konten', '/controlling/bmd',
      '/dashboard/kellerbuch', '/dashboard/weingarten', '/dashboard/journal', '/dashboard/morgenbericht', '/reports/weinbuecher-sammlung', '/reports/ama']) assert.ok(!v.includes(h), h)
  })
  test('buildNav filtert nach dem Lesebereich der Seite – nur wenn lesbare Bereiche übergeben sind', () => {
    assert.match(NAV, /if \(ctx\.lesbar && !ctx\.lesbar\.includes\(seitenBereich\(it\.href\)\)\) return false/)
    assert.match(quelle('src/app/(dashboard)/layout.tsx'), /lesbar=\{lesbareBereiche\(membership\)\}/)
    assert.match(quelle('src/components/layout/AppShell.tsx'), /auswertungenSichtbar,\n {4}lesbar,\n {2}\}\), \[lesbar, role,/)
  })
  test('Befehlspalette: Aktionen mit Ziel in einem gesperrten Bereich entfallen', () => {
    const p = quelle('src/components/CommandPalette.tsx')
    assert.match(p, /statischAlle\.filter\(e => e\.gruppe !== 'Aktionen' \|\| !e\.href \|\| !lesbar \|\| lesbar\.includes\(seitenBereich\(e\.href\)\)\)/)
    assert.match(quelle('src/components/layout/AppShell.tsx'), /<CommandPalette [^>]*lesbar=\{lesbar\}/)
    const ziele = [...p.matchAll(/gruppe: 'Aktionen'(?: as const)?, label: '[^']+',\s+icon: \w+,\s+href: '([^']+)'/g)].map(m => m[1])
    assert.ok(ziele.length >= 10, `nur ${ziele.length} Aktionen gelesen`)
    const extern = lesbareBereiche({ role: 'winzer', profil: 'extern' })
    assert.deepEqual(ziele.filter(z => extern.includes(seitenBereich(z))), ['/behandlungen/neu', '/weingarten/neu'])
  })
})

describe('KAN-456: Seiten-Guards', () => {
  const regeln = regelnAus(quelle('src/lib/navigation/seitenBereich.ts'))
  const verzeichnisse = seiten(BASIS)
  test('jede Seite hat eine Regel und – außerhalb von „allgemein“ – einen Guard mit genau ihrem Bereich', () => {
    assert.deepEqual(pruefe(regeln, verzeichnisse, lies, [...LESEBEREICHE]), [])
    assert.ok(verzeichnisse.length >= 175)
  })
  test('gemischte Verzeichnisse: Guard in der Seite selbst, Unterverzeichnisse mit eigenem Bereich', () => {
    assert.deepEqual(guardFuer('weinhandel', lies), { bereich: 'lager', ort: 'page.tsx' })
    assert.deepEqual(guardFuer('weinhandel/verkauf/neu', lies), { bereich: 'verkauf', ort: 'weinhandel/verkauf/layout.tsx' })
    assert.deepEqual(guardFuer('behandlungen/lager', lies), { bereich: 'betriebsmittel', ort: 'behandlungen/lager/layout.tsx' })
    assert.equal(guardFuer('behandlungen', lies).bereich, 'massnahmen')
    assert.equal(guardFuer('reports/(pflicht)/ama', lies).bereich, 'lese')
    assert.equal(guardFuer('dashboard', lies), null)   // Übersicht: allgemein
  })
  test('requireLesen: Umleitung auf die Übersicht mit Hinweis; ohne Mitgliedschaft entscheidet das Layout', () => {
    const g = quelle('src/lib/auth/lesen.ts')
    assert.match(g, /KEIN_LESERECHT_ZIEL = '\/dashboard\?kein_leserecht=1'/)
    assert.match(g, /if \(!membership\) return\n {2}if \(!canRead\(membership, bereich\)\) redirect\(KEIN_LESERECHT_ZIEL\)/)
    const d = quelle('src/app/(dashboard)/dashboard/page.tsx')
    assert.match(d, /keinLeserecht && <p role="status"[^>]*>\{KEIN_LESERECHT_TEXT\}<\/p>/)
    assert.match(KEIN_LESERECHT_TEXT, /fehlt dir das Leserecht/)
    assert.equal(seitenBereich('/dashboard?kein_leserecht=1'), 'allgemein', 'das Ziel der Umleitung ist für jedes Profil lesbar')
  })
  test('im Build eingehängt', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-lesebereich-seiten\.js/)
  })
})

describe('KAN-456: Wächter check-lesebereich-seiten', () => {
  const regeln = [['/crm', 'crm'], ['/dashboard', 'allgemein'], ['/weinhandel', 'lager'], ['/weinhandel/verkauf', 'verkauf']]
  const dateien = {
    'crm/layout.tsx': "await requireLesen('crm')",
    'crm/page.tsx': '', 'crm/kontakte/page.tsx': '', 'dashboard/page.tsx': '',
    'weinhandel/page.tsx': "await requireLesen('lager')",
    'weinhandel/verkauf/layout.tsx': "await requireLesen('verkauf')", 'weinhandel/verkauf/page.tsx': '',
  }
  const v = ['crm', 'crm/kontakte', 'dashboard', 'weinhandel', 'weinhandel/verkauf']
  const p = (r, d, verz = v) => pruefe(r, verz, rel => d[rel] ?? null, [...LESEBEREICHE]).join('|')
  test('richtiger Stand: kein Befund; Routen-Gruppen zählen nicht zur Adresse', () => {
    assert.equal(p(regeln, dateien), '')
    assert.equal(adresse('reports/(pflicht)/ama'), '/reports/ama')
    assert.equal(adresse(''), '/')
  })
  test('Seite ohne Regel, Seite ohne Guard, falscher Bereich', () => {
    assert.match(p(regeln, { ...dateien, 'neu/page.tsx': '' }, [...v, 'neu']), /\/neu: Seite ohne Regel/)
    assert.match(p(regeln, { ...dateien, 'crm/layout.tsx': '' }), /\/crm: Bereich „crm“ ohne Guard/)
    assert.match(p(regeln, { ...dateien, 'weinhandel/verkauf/layout.tsx': "await requireLesen('lager')" }), /\/weinhandel\/verkauf: Regel nennt „verkauf“, der Guard in weinhandel\/verkauf\/layout\.tsx prüft „lager“/)
  })
  test('Guard über einer allgemeinen Seite, unbekannter Bereich, verwaiste Regel', () => {
    assert.match(p(regeln, { ...dateien, 'dashboard/page.tsx': "await requireLesen('crm')" }), /\/dashboard: Bereich „allgemein“, aber Guard/)
    assert.match(p([...regeln, ['/x', 'kunden']], { ...dateien, 'x/page.tsx': '' }, [...v, 'x']), /Regel „\/x“: unbekannter Bereich „kunden“/)
    assert.match(p([...regeln, ['/weg', 'crm']], dateien), /Regel „\/weg“: keine Seite darunter/)
  })
})
