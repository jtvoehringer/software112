// KAN-181 (01.10.2026): Bedienung am Handy – Etappe 1: Mobilmenü, Kopfleiste, Einstieg „Lese erfassen“, Lese-Formular
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan181-mobil.test.mjs
//          (läuft auch über npm run test:csv)
//
// Quelltext-Prüfungen: die Darstellung selbst prüft die Abnahme am Gerät (375 px).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('Navigation am Handy', () => {
  test('Mobilmenü hängt an denselben Gruppen wie TabNav/Palette und öffnet über den Knopf der Kopfleiste', () => {
    const shell = quelle('src/components/layout/AppShell.tsx')
    assert.match(shell, /<MobileNav groups=\{groups\} \/>/)
    const topbar = quelle('src/components/layout/Topbar.tsx')
    assert.match(topbar, /md:hidden w-10 h-10/)
    assert.match(topbar, /dispatchEvent\(new Event\(MOBILNAV_EVENT\)\)/)
    assert.match(topbar, /aria-label="Menü öffnen"/)
    assert.match(topbar, /'pointerdown'/)
    const nav = quelle('src/components/layout/MobileNav.tsx')
    assert.match(nav, /export const MOBILNAV_EVENT = 's112:mobilnav'/)
    assert.match(nav, /min-h-\[44px\]/)
    assert.match(nav, /aria-label="Menü schließen"/)
  })
  test('TabNav: Zeile 1 (Bereiche) erst ab md, Zeile 2 bleibt', () => {
    const tab = quelle('src/components/layout/TabNav.tsx')
    assert.match(tab, /hidden md:flex gap-0\.5 overflow-x-auto/)
    assert.match(tab, /aria-label="Hauptnavigation"/)
  })
})

describe('Lese erfassen', () => {
  test('Einstieg /erntemeldung/erfassen: neuester Jahrgang des aktiven Betriebs, Formular offen', () => {
    const seite = quelle('src/app/(dashboard)/erntemeldung/erfassen/page.tsx')
    assert.match(seite, /\.eq\('tenant_id', membership\.tenantId\)/)
    assert.match(seite, /order\('jahrgang', \{ ascending: false \}\)/)
    assert.match(seite, /\?erfassen=1/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/page.tsx'), /erfassenOffen=\{erfassen === '1'\}/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx'), /useState\(!!erfassenOffen && writeOk\)/)
    assert.match(quelle('src/app/manifest.ts'), /url: '\/erntemeldung\/erfassen'/)
    assert.match(quelle('src/components/CommandPalette.tsx'), /label: 'Lesedaten erfassen',\s+icon: Wine,\s+href: '\/erntemeldung\/erfassen'/)
  })
  test('Formular: 16 px am Handy (kein iOS-Zoom), einspaltig, Lesedaten als Karten unter md', () => {
    const c = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
    assert.match(c, /const inputCls = '[^']*text-base sm:text-sm/)
    assert.match(c, /const zeileCls = '[^']*text-base sm:text-xs/)
    assert.match(c, /grid grid-cols-1 sm:grid-cols-2 gap-3/)
    assert.match(c, /<div className="md:hidden print:hidden space-y-2">/)
    assert.match(c, /hidden md:block print:block border border-s112-border rounded-xl overflow-x-auto/)
    assert.match(quelle('src/components/wein/MostgewichtEingabe.tsx'), /text-base sm:text-sm tabular-nums/)
  })
})

describe('Maßnahme erfassen (Etappe 2)', () => {
  const NEU = 'src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx'
  const EDIT = 'src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx'
  test('keine 14-px-Eingabefelder mehr am Handy (iOS-Zoom): Anlegen, Bearbeiten, Betriebsmittel', () => {
    for (const f of [NEU, EDIT, 'src/app/(dashboard)/behandlungen/neu/BetriebsmittelFeld.tsx']) {
      const q = quelle(f)
      assert.doesNotMatch(q, /px-3 py-2 text-sm focus:/, f)
      assert.match(q, /text-base sm:text-sm/, f)
    }
  })
  test('Speichern-Leiste bleibt am Handy unten sichtbar; Ried-Auswahl mit großen Häkchen', () => {
    for (const f of [NEU, EDIT]) assert.match(quelle(f), /max-sm:sticky max-sm:bottom-0/, f)
    const ried = quelle('src/app/(dashboard)/behandlungen/neu/RiedAuswahlListe.tsx')
    assert.equal((ried.match(/w-5 h-5 sm:w-auto sm:h-auto/g) ?? []).length, 3)
  })
})

describe('Kellerbuch (Etappe 3)', () => {
  const KB = 'src/app/(dashboard)/kellerbuch'
  const STICKY = [
    `${KB}/umziehen/UmziehenClient.tsx`,
    'src/components/kellerbuch/UmziehenWidget.tsx',
    'src/components/kellerbuch/UmziehenFormClient.tsx',
    `${KB}/behaelter/[id]/behandlungen/page.tsx`,
    `${KB}/weinausbau/[id]/analysen/neu/page.tsx`,
  ]
  const RASTER = [
    `${KB}/weinausbau/[id]/SchwundBuchenForm.tsx`,
    `${KB}/behaelter/[id]/bewegungen/page.tsx`,
  ]
  test('16 px am Handy in allen Kellerbuch-Formularen (kein iOS-Zoom)', () => {
    for (const f of [...STICKY, ...RASTER]) assert.match(quelle(f), /text-base sm:text-sm/, f)
    assert.match(quelle(`${KB}/umzug/[id]/edit/page.tsx`), /const inputCls = '[^']*text-base sm:text-sm/)
  })
  test('Speichern-Leiste bleibt am Handy unten sichtbar; Schwund-Formulare als Raster mit breitem Knopf', () => {
    for (const f of STICKY) assert.match(quelle(f), /max-sm:sticky max-sm:bottom-0/, f)
    for (const f of RASTER) {
      const q = quelle(f)
      assert.match(q, /grid grid-cols-2 gap-3 items-end sm:flex sm:flex-wrap/, f)
      assert.match(q, /col-span-2 sm:col-span-1 w-full sm:w-auto/, f)
    }
  })
  test('globale Feldklassen nur mit Handy-Zusatz', () => {
    const widget = quelle('src/components/kellerbuch/UmziehenWidget.tsx')
    assert.doesNotMatch(widget, /className="form-input"/)
    assert.match(widget, /scrollIntoView\(\{ block: 'start' \}\)/)
    assert.doesNotMatch(quelle(`${KB}/weinausbau/[id]/analysen/neu/page.tsx`), /className="form-input"/)
    const beh = quelle(`${KB}/behaelter/[id]/behandlungen/page.tsx`)
    assert.doesNotMatch(beh, /className="input"/)
    assert.equal((beh.match(/className="input /g) ?? []).length, (beh.match(/className="input [^"]*text-base sm:text-sm/g) ?? []).length)
  })
  test('Tabellen scrollen waagrecht statt zu quetschen', () => {
    assert.match(quelle(`${KB}/umziehen/UmziehenClient.tsx`), /card p-0 overflow-x-auto">\s*<table className="w-full min-w-\[640px\]/)
    assert.match(quelle(`${KB}/behaelter/[id]/behandlungen/page.tsx`), /card p-0 overflow-x-auto">\s*<table className="w-full min-w-\[600px\]/)
    assert.match(quelle(`${KB}/weinausbau/page.tsx`), /<div className="overflow-x-auto">\s*<table className="w-full min-w-\[640px\]/)
  })
})
