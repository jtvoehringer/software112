// KAN-456 (13.11.2026): Rollen/Rechte R4, Teil 2 – Dashboard je Profil.
// Befund: Die Übersicht lud für jeden Benutzer alle Kacheln; ein Mitarbeiter mit Profil hätte leere bzw. halbe
// Kacheln (0 Liter im Keller, 0 € offene Posten) und Schnellzugriffe in gesperrte Bereiche gesehen. Neu: Ein Widget
// gibt es nur mit Leserecht auf alle seine Datenquellen; Schnellaktionen und Schnellzugriff nur in lesbare Bereiche.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LESEBEREICHE, lesbareBereiche } from '../../src/lib/auth/lesebereiche.ts'
import { seitenBereich } from '../../src/lib/navigation/seitenBereich.ts'
import { WIDGETS, STANDARD_LAYOUT, QUELLEN_BEREICH, sichtbareWidgets, editorEintraege, benoetigteQuellen, widgetVerfuegbar } from '../../src/lib/dashboard/widgets.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const K = { modulEa: true, schnellaktionen: true, modulWeingarten: true }
const fuer = profil => ({ ...K, lesbar: lesbareBereiche({ role: 'winzer', profil }) })
const ids = (layout, k) => sichtbareWidgets(layout, k).map(w => w.def.id)
const ALLE = WIDGETS.map(w => ({ id: w.id }))

describe('KAN-456: Widgets je Lesebereich', () => {
  test('jede Datenquelle hat einen bekannten Bereich – nie „allgemein“', () => {
    const quellen = [...new Set(WIDGETS.flatMap(w => w.quellen))].sort()
    assert.deepEqual(Object.keys(QUELLEN_BEREICH).sort(), quellen)
    for (const b of Object.values(QUELLEN_BEREICH)) assert.ok(LESEBEREICHE.includes(b) && b !== 'allgemein', b)
  })
  test('ohne Profil bzw. ohne Angabe: wie bisher alle Widgets', () => {
    assert.deepEqual(ids(ALLE, K), WIDGETS.map(w => w.id))
    for (const role of ['system_admin', 'tenant_admin', 'winzer', 'leser']) {
      assert.deepEqual(ids(STANDARD_LAYOUT, { ...K, lesbar: lesbareBereiche({ role }) }), ids(STANDARD_LAYOUT, K), role)
    }
  })
  test('Extern: Schnellaktionen, Support, Schnellzugriff und – zuschaltbar – die Wartefristen je Ried', () => {
    assert.deepEqual(ids(STANDARD_LAYOUT, fuer('extern')), ['schnellaktionen', 'support-anfragen', 'schnellzugriff'])
    assert.deepEqual(ids(ALLE, fuer('extern')), ['schnellaktionen', 'support-anfragen', 'schnellzugriff', 'wartefristen'])
  })
  test('Vertrieb: Flaschenlager, offene Posten, Aufgaben & Termine, Verkaufs-Widgets, Meldefristen – nichts aus Keller, Rieden, Finanzen', () => {
    assert.deepEqual(ids(STANDARD_LAYOUT, fuer('vertrieb')), ['schnellaktionen', 'flaschenlager', 'offene-posten', 'aufgaben-termine', 'support-anfragen', 'schnellzugriff'])
    assert.deepEqual(ids(ALLE, fuer('vertrieb')).filter(i => !ids(STANDARD_LAYOUT, fuer('vertrieb')).includes(i)),
      ['umsatz-trend', 'top-kunden', 'ueberfaellige-rechnungen', 'meldefristen'])
    for (const i of ['kellerbestand', 'finanzen', 'morgenbericht', 'offene-aufgaben', 'naechste-schritte', 'gaerkontrolle', 'wartefristen']) assert.ok(!ids(ALLE, fuer('vertrieb')).includes(i), i)
  })
  test('Widgets mit Quellen aus mehreren Bereichen brauchen alle (keine halben Kacheln)', () => {
    const def = WIDGETS.find(w => w.id === 'offene-aufgaben')
    assert.deepEqual([...def.quellen], ['keller', 'fristen', 'checklisten'])
    assert.equal(widgetVerfuegbar(def, { ...K, lesbar: ['allgemein', 'betrieb'] }), false)
    assert.equal(widgetVerfuegbar(def, { ...K, lesbar: ['allgemein', 'betrieb', 'keller'] }), true)
  })
  test('geladen werden nur Quellen lesbarer Bereiche', () => {
    for (const profil of ['extern', 'vertrieb']) {
      const k = fuer(profil)
      for (const q of benoetigteQuellen(sichtbareWidgets(ALLE, k))) assert.ok(k.lesbar.includes(QUELLEN_BEREICH[q]), `${profil}: ${q}`)
    }
    assert.deepEqual([...benoetigteQuellen(sichtbareWidgets(STANDARD_LAYOUT, fuer('extern')))], [])
  })
  test('„Dashboard anpassen“ bietet nur verfügbare Widgets an; ein gespeichertes Layout mit gesperrten Widgets zeigt sie nicht', () => {
    const editor = editorEintraege(null, fuer('extern'))
    assert.deepEqual(editor.filter(e => e.verfuegbar).map(e => e.id).sort(), ['schnellaktionen', 'schnellzugriff', 'support-anfragen', 'wartefristen'])
    assert.ok(editor.filter(e => !e.an).every(e => e.verfuegbar), 'ausgeblendete, nicht verfügbare Widgets werden nicht angeboten')
    assert.deepEqual(ids([{ id: 'kellerbestand' }, { id: 'finanzen' }, { id: 'schnellzugriff' }], fuer('extern')), ['schnellzugriff'])
  })
  test('die eigene Regel eines Widgets gilt weiter (Modul E&A, Weingarten-Modul)', () => {
    assert.ok(!ids(ALLE, { ...K, modulEa: false }).includes('finanzen'))
    assert.ok(!ids(ALLE, { ...fuer('extern'), modulWeingarten: false }).includes('wartefristen'))
  })
})

describe('KAN-456: Übersicht und Schnellzugriffe', () => {
  test('die Übersicht gibt die lesbaren Bereiche an Widgets und Editor weiter', () => {
    assert.match(quelle('src/app/(dashboard)/dashboard/page.tsx'), /modulWeingarten: einst\.modulWeingarten, lesbar: ctx\.lesbar \}/)
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.match(d, /lesbar: lesbareBereiche\(membership\)/)
  })
  test('Cron-Kontext des Morgenberichts liest alle Bereiche (Service-Role, kein Benutzer)', () => {
    assert.match(quelle('src/lib/morgenbericht/erstellen.ts'), /role: 'system_admin', lesbar: \[\.\.\.LESEBEREICHE\]/)
  })
  const s = quelle('src/app/(dashboard)/dashboard/_widgets/schnell.tsx')
  const ziele = block => [...block.matchAll(/href: '([^'?]+)/g)].map(m => m[1])
  test('Schnellaktionen (Handy) und Schnellzugriff: nur Ziele in lesbaren Bereichen', () => {
    assert.match(s, /\.filter\(a => canWrite\(ctx\.role, a\.modul\)\)\n\s+\.filter\(a => ctx\.lesbar\.includes\(seitenBereich\(a\.href\)\)\)/)
    assert.match(s, /\]\.filter\(item => ctx\.lesbar\.includes\(seitenBereich\(item\.href\)\)\)/)
    assert.match(s, /if \(schnellzugriff\.length === 0\) return null/)
  })
  test('Extern bleibt „Maßnahme“; Vertrieb „Verkauf“, „Aktivität“ und „Offene Posten“', () => {
    const alle = [...new Set(ziele(s))]
    assert.ok(alle.length >= 7, `nur ${alle.length} Ziele gelesen`)
    const fuerProfil = profil => alle.filter(h => lesbareBereiche({ role: 'winzer', profil }).includes(seitenBereich(h)))
    assert.deepEqual(fuerProfil('extern'), ['/behandlungen/neu'])
    assert.deepEqual(fuerProfil('vertrieb').sort(), ['/crm', '/weinhandel/offene-posten', '/weinhandel/verkauf/neu'])
  })
})
