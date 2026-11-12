// KAN-427/KAN-428 (12.11.2026): Jeder Bereich öffnet zuerst seine Übersicht – Navigation, Einstiegsseiten, Aufteilung
// der Sicht „Verkauf & CRM“.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aktiverBereichIndex, isActivePath } from '../../src/lib/navigation/aktiv.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)/'

// Bereiche samt Punkten (href, label) aus der Quelle der Navigation – index.ts selbst lädt node:test nicht (@/-Importe)
function bereiche() {
  const nav = quelle('src/lib/navigation/index.ts')
  const liste = nav.slice(nav.indexOf('const NAV: NavGroup[] = ['), nav.indexOf('// isActivePath und die exakt matchenden Pfade'))
  const aus = []
  for (const block of liste.split(/\n  \{\n/).slice(1)) {
    const key = block.match(/key: '([a-z]+)'/)?.[1]
    const items = [...block.matchAll(/^\s+\{ href: '([^']+)',\s+label: '([^']+)'/gm)].map(m => ({ href: m[1], label: m[2] }))
    if (key) aus.push({ key, items })
  }
  return aus
}
const NAV = bereiche()
const bereich = key => { const g = NAV.find(x => x.key === key); assert.ok(g, key); return g }

describe('KAN-427/428: erster Punkt je Bereich', () => {
  test('die Navigation wurde vollständig gelesen', () => {
    assert.deepEqual(NAV.map(g => g.key), ['uebersicht', 'rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'controlling', 'ki', 'system'])
  })
  test('Klick auf den Bereich (erster Punkt) öffnet die Übersicht des Bereichs', () => {
    const soll = {
      rieden:          ['/weingarten/uebersicht', 'Weingarten & Ernte'],
      kellerbuch:      ['/kellerbuch/uebersicht', 'Übersicht'],
      warenwirtschaft: ['/weinhandel/uebersicht', 'Übersicht'],
      crm:             ['/crm/uebersicht', 'Übersicht'],
      controlling:     ['/controlling/fristen', 'Meldungen & Fristen'],
    }
    for (const [key, [href, label]] of Object.entries(soll)) {
      assert.deepEqual([bereich(key).items[0].href, bereich(key).items[0].label], [href, label], key)
    }
  })
  test('die bisherigen ersten Punkte stehen an zweiter Stelle; Kellerbuch heißt dort „Gebinde & Chargen“', () => {
    assert.deepEqual(bereich('rieden').items[1], { href: '/weingarten', label: 'Rieden' })
    assert.deepEqual(bereich('kellerbuch').items[1], { href: '/kellerbuch', label: 'Gebinde & Chargen' })
    assert.deepEqual(bereich('warenwirtschaft').items[1], { href: '/weinhandel', label: 'Warenlager' })
    assert.deepEqual(bereich('crm').items[1], { href: '/nachrichten', label: 'E-Mail' })
    assert.deepEqual(bereich('controlling').items[1], { href: '/reports', label: 'Auswertungen' })
  })
  test('kein Bereich hat zwei Punkte mit demselben Namen oder derselben Adresse', () => {
    for (const g of NAV) {
      assert.equal(new Set(g.items.map(i => i.label)).size, g.items.length, `${g.key}: Namen`)
      assert.equal(new Set(g.items.map(i => i.href)).size, g.items.length, `${g.key}: Adressen`)
    }
  })
  test('Bereich „Übersicht“ unverändert: fünf Sichten, „Verkauf & CRM“ gemeinsam, „Meldungen & Fristen“ für alle', () => {
    assert.deepEqual(bereich('uebersicht').items.map(i => i.href),
      ['/dashboard', '/dashboard/kellerbuch', '/dashboard/verkauf', '/dashboard/weingarten', '/dashboard/fristen', '/dashboard/morgenbericht', '/dashboard/journal'])
    assert.equal(bereich('uebersicht').items[2].label, 'Verkauf & CRM')
  })
})

describe('KAN-427/428: markierter Bereich und Punkt', () => {
  const idx = key => NAV.findIndex(g => g.key === key)
  test('eigene Adresse je Bereich: geöffnet über den Bereich ist der Bereich markiert, über „Übersicht“ die Übersicht', () => {
    for (const [pfad, key] of [
      ['/weingarten/uebersicht', 'rieden'], ['/kellerbuch/uebersicht', 'kellerbuch'], ['/weinhandel/uebersicht', 'warenwirtschaft'],
      ['/crm/uebersicht', 'crm'], ['/controlling/fristen', 'controlling'],
      ['/dashboard/weingarten', 'uebersicht'], ['/dashboard/kellerbuch', 'uebersicht'], ['/dashboard/verkauf', 'uebersicht'], ['/dashboard/fristen', 'uebersicht'],
      ['/weingarten', 'rieden'], ['/kellerbuch', 'kellerbuch'], ['/weinhandel', 'warenwirtschaft'], ['/crm', 'crm'], ['/reports', 'controlling'],
    ]) assert.equal(aktiverBereichIndex(NAV, pfad), idx(key), pfad)
  })
  test('in der zweiten Zeile ist genau der Einstieg markiert, nicht zusätzlich die Liste dahinter', () => {
    // dieselbe Regel wie TabNav: aktiv, wenn kein längerer Geschwisterpunkt ebenfalls passt
    const markiert = (g, pfad) => g.items.filter(it => isActivePath(it.href, pfad)
      && !g.items.some(o => o !== it && o.href.length > it.href.length && isActivePath(o.href, pfad))).map(it => it.href)
    assert.deepEqual(markiert(bereich('rieden'), '/weingarten/uebersicht'), ['/weingarten/uebersicht'])
    assert.deepEqual(markiert(bereich('rieden'), '/weingarten'), ['/weingarten'])
    assert.deepEqual(markiert(bereich('kellerbuch'), '/kellerbuch/uebersicht'), ['/kellerbuch/uebersicht'])
    assert.deepEqual(markiert(bereich('kellerbuch'), '/kellerbuch'), ['/kellerbuch'])
    assert.deepEqual(markiert(bereich('warenwirtschaft'), '/weinhandel/uebersicht'), ['/weinhandel/uebersicht'])
    assert.deepEqual(markiert(bereich('crm'), '/crm/uebersicht'), ['/crm/uebersicht'])
    assert.deepEqual(markiert(bereich('crm'), '/crm'), ['/crm'])
  })
})

describe('KAN-427/428: Einstiegsseiten', () => {
  test('jede Adresse hat eine Seite mit eigenem Titel und zeigt die Dashboard-Sicht (kein zweiter Inhalt)', () => {
    for (const [seite, inhalt] of [
      ['weingarten/uebersicht/page.tsx', "from '@/app/(dashboard)/dashboard/weingarten/page'"],
      ['kellerbuch/uebersicht/page.tsx', "from '@/app/(dashboard)/dashboard/kellerbuch/page'"],
      ['controlling/fristen/page.tsx', "from '@/app/(dashboard)/dashboard/fristen/page'"],
      ['weinhandel/uebersicht/page.tsx', '<VerkaufCrmSicht teil="verkauf" />'],
      ['crm/uebersicht/page.tsx', '<VerkaufCrmSicht teil="crm"'],
    ]) {
      assert.ok(existsSync(path.join(WURZEL, D + seite)), seite)
      const s = quelle(D + seite)
      assert.ok(s.includes(inhalt), `${seite}: ${inhalt}`)
      assert.match(s, /export const metadata: Metadata = \{ title: '[^']+' \}/, seite)
      assert.ok(s.includes("export const dynamic = 'force-dynamic'"), seite)
    }
  })
  test('Controlling-Einstieg hinter dem Guard des Bereichs; die Sicht unter Übersicht bleibt ohne ihn', () => {
    const l = quelle(D + 'controlling/fristen/layout.tsx')
    assert.ok(l.includes("await requireModul('modul_controlling')") && l.includes('await requireAuswertungen()'))
    assert.ok(!existsSync(path.join(WURZEL, D + 'dashboard/fristen/layout.tsx')))
  })
  test('CRM-Einstieg: „Datenimport“ nur mit Schreibrecht CRM (Mitgliedschaft, nicht Rollenname)', () => {
    const s = quelle(D + 'crm/uebersicht/page.tsx')
    assert.ok(s.includes("crmImport={!!membership && canWrite(membership, 'crm')}"))
  })
})

describe('KAN-428: Aufteilung der Sicht „Verkauf & CRM“', () => {
  const s = quelle(D + 'dashboard/_shared/VerkaufCrmSicht.tsx')
  test('gemeinsame Seite unter Übersicht zeigt weiter beide Teile', () => {
    assert.ok(quelle(D + 'dashboard/verkauf/page.tsx').includes('<VerkaufCrmSicht teil="beide" />'))
    assert.ok(s.includes("const mitVerkauf = teil !== 'crm'") && s.includes("const mitCrm = teil !== 'verkauf'"))
  })
  test('Verkauf: Offene Rechnungen, Aufträge der Woche, Umsatz, Überfällige, Top-Kunden, Flaschenbestand', () => {
    for (const anker of [
      '{mitVerkauf && <Link href="/weinhandel/offene-posten"', '{mitVerkauf && <Link href="/weinhandel/verkauf"',
      '{mitVerkauf && <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">',
      '{mitVerkauf && <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">\n      <TopKundenKarte',
    ]) assert.ok(s.includes(anker), anker)
  })
  test('CRM: Leads, Meine Aktivitäten, Nächste Termine', () => {
    assert.ok(s.includes('{mitCrm && <div className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2">'))
    const untere = s.slice(s.indexOf('{mitCrm && <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">'), s.indexOf('{/* ── Top-Kunden'))
    assert.ok(untere.includes('Meine Aktivitäten') && untere.includes('Nächste Termine'))
  })
  test('Schnellzugriff: Verkauf → Neuer Verkauf und Offene Posten; CRM → Aktivität und Datenimport', () => {
    assert.match(s, /label: 'Neuer Verkauf',\s+zeigen: mitVerkauf \}/)
    assert.match(s, /label: 'Offene Posten',\s+zeigen: mitVerkauf \}/)
    assert.match(s, /label: 'Aktivität',\s+zeigen: mitCrm \}/)
    assert.match(s, /href: '\/crm\/import',\s+icon: Upload,\s+label: 'Datenimport',\s+zeigen: teil === 'crm' && crmImport \}/)
    assert.ok(s.includes('].filter(item => item.zeigen).map(item => ('))
  })
})
