// KAN-333/KAN-334 (13.10.2026) – „Zurück“ auf jedem Formular; nach „Speichern“ im selben Bereich bleiben statt zur
// vorherigen Seite (Dashboard, Kellerplan, Strg K) zu springen. Beim Bearbeiten auf einer Detailseite: dort bleiben.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const require = createRequire(import.meta.url)
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const z = () => laden('lib/navigation/zurueck.ts')

// Ausschnitt der echten Navigation (src/lib/navigation/index.ts)
const BEREICHE = [
  { key: 'uebersicht', hrefs: ['/dashboard', '/dashboard/kellerbuch', '/dashboard/weingarten'] },
  { key: 'rieden', hrefs: ['/weingarten', '/behandlungen', '/erntemeldung', '/behandlungen/lager'] },
  { key: 'kellerbuch', hrefs: ['/kellerbuch', '/kellerbuch/kellerplan', '/weinhandel/zukauf', '/dac'] },
  { key: 'warenwirtschaft', hrefs: ['/weinhandel', '/weinhandel/verkauf', '/weinhandel/offene-posten'] },
  { key: 'ea', hrefs: ['/buchhaltung', '/weinhandel/offene-posten'] },
  { key: 'crm', hrefs: ['/crm', '/crm/kontakte'] },
]

describe('KAN-334: Bereich eines Pfads', nurMitHooks, () => {
  test('längster passender Navigationspfad, Unterseiten gehören dazu', async () => {
    const { bereichVon } = await z()
    assert.equal(bereichVon(BEREICHE, '/kellerbuch/weinausbau/abc'), 'kellerbuch')
    assert.equal(bereichVon(BEREICHE, '/kellerbuch/kellerplan/1?x=1'), 'kellerbuch')
    assert.equal(bereichVon(BEREICHE, '/weinhandel/zukauf/neu'), 'kellerbuch')      // länger als /weinhandel
    assert.equal(bereichVon(BEREICHE, '/weinhandel/fuellungen/neu'), 'warenwirtschaft')
    assert.equal(bereichVon(BEREICHE, '/dac/7'), 'kellerbuch')
    assert.equal(bereichVon(BEREICHE, '/behandlungen/neu'), 'rieden')
    assert.equal(bereichVon(BEREICHE, '/dashboard'), 'uebersicht')
    assert.equal(bereichVon(BEREICHE, '/dashboard/weingarten'), 'uebersicht')
    // gleich lang in zwei Bereichen: der erste
    assert.equal(bereichVon(BEREICHE, '/weinhandel/offene-posten'), 'warenwirtschaft')
    // kein Präfix-Treffer über Wortgrenzen
    assert.equal(bereichVon(BEREICHE, '/dachboden'), null)
    assert.equal(bereichVon(BEREICHE, '/profil'), null)
  })
})

describe('KAN-334: Ziel nach dem Speichern nur im selben Bereich', nurMitHooks, () => {
  test('Dashboard, Strg K aus einem anderen Bereich, fremder Bereich → Liste des Bereichs', async () => {
    const { zielImBereich } = await z()
    // Maßnahme über die Schnellaktion des Dashboards
    assert.equal(zielImBereich(BEREICHE, '/dashboard', '/behandlungen/neu', '/behandlungen'), '/behandlungen')
    // Verkauf über Strg K, geöffnet im Kellerbuch
    assert.equal(zielImBereich(BEREICHE, '/kellerbuch/kellerplan/1', '/weinhandel/verkauf/neu', '/weinhandel/verkauf'), '/weinhandel/verkauf')
    // Füllung aus der Charge ohne zurueck-Parameter → Warenlager (mit Parameter gilt die Charge, siehe unten)
    assert.equal(zielImBereich(BEREICHE, '/kellerbuch/weinausbau/a', '/weinhandel/fuellungen/neu', '/weinhandel'), '/weinhandel')
    // ohne Verlauf
    assert.equal(zielImBereich(BEREICHE, null, '/behandlungen/neu', '/behandlungen'), '/behandlungen')
  })
  test('Herkunft im selben Bereich bleibt Ziel', async () => {
    const { zielImBereich } = await z()
    assert.equal(zielImBereich(BEREICHE, '/weingarten/7', '/behandlungen/neu', '/behandlungen'), '/weingarten/7')
    assert.equal(zielImBereich(BEREICHE, '/kellerbuch/weinausbau/a', '/kellerbuch/lohnversektung/neu', '/kellerbuch/lohnversektung'), '/kellerbuch/weinausbau/a')
    assert.equal(zielImBereich(BEREICHE, '/dac/3', '/kellerbuch/weinausbau/a/analysen/neu', '/kellerbuch/weinausbau/a/analysen'), '/dac/3')
    assert.equal(zielImBereich(BEREICHE, '/behandlungen?jahr=2026', '/behandlungen/neu', '/behandlungen'), '/behandlungen?jahr=2026')
  })
  test('Formular ohne eigenen Bereich: Bereich des Standardziels', async () => {
    const { zielImBereich } = await z()
    assert.equal(zielImBereich(BEREICHE, '/crm/kontakte/1', '/sonderseite/neu', '/crm/kontakte'), '/crm/kontakte/1')
    assert.equal(zielImBereich(BEREICHE, '/dashboard', '/sonderseite/neu', '/crm/kontakte'), '/crm/kontakte')
  })
  test('Browser: zurueck-Parameter gilt immer, Verlauf nur im Bereich; hierBleiben bleibt auf der Seite', () => {
    const s = quelle('src/lib/navigation/zurueckBrowser.ts')
    assert.match(s, /export function zielNachSpeichern[\s\S]*?if \(q\) return q[\s\S]*?zielImBereich\(bereichsPfade\(\), vorherigeSeite\(leseVerlauf\(\), aktuelleSeite\(\)\)/)
    assert.match(s, /export function zielNachVorgang[\s\S]*?zielNachAbschluss\(zielNachSpeichern\(standard\)/)
    assert.match(s, /export function hierBleiben[\s\S]*?zielNachAbschluss\(aktuelleSeite\(\)/)
    // Abbrechen bleibt „dorthin, woher man kam“, das Rückkehr-Feld für Server Actions folgt der Bereichsregel
    const a = quelle('src/components/navigation/Abbrechen.tsx')
    assert.match(a, /router\.push\(zurueckZiel\(standard\)\)/)
    assert.match(a, /setWert\(zielNachSpeichern\(standard\)\)/)
    assert.match(quelle('src/lib/navigation/index.ts'), /export function bereichsPfade\(\)/)
  })
})

describe('KAN-334: Bearbeiten auf Detailseiten bleibt auf der Seite', () => {
  test('Charge, Ried, Behälter, DAC, Anlage, Umziehen-Widget, Mandant', () => {
    // KAN-335/336: ohne Next.js-Scroll (scrollIntoView verschob Rahmen bzw. Dokument)
    assert.match(quelle('src/components/kellerbuch/WeinausbauForm.tsx'), /router\.replace\(hierBleiben\(\), \{ scroll: false \}\)/)
    assert.doesNotMatch(quelle('src/components/kellerbuch/WeinausbauForm.tsx'), /zielNachVorgang\(/)
    for (const [datei, bedingung] of [
      ['src/components/weingarten/WeingartenForm.tsx', 'weingarten'],
      ['src/components/kellerbuch/BehaelterForm.tsx', 'behaelter'],
      ['src/components/dac/DacForm.tsx', 'dac'],
    ]) assert.match(quelle(datei), new RegExp(`if \\(${bedingung}\\) \\{ router\\.replace\\(hierBleiben\\(\\), \\{ scroll: false \\}\\); setSaving\\(false\\) \\}`), datei)
    assert.match(quelle(`${D}/buchhaltung/anlagen/AnlageForm.tsx`), /if \(form\.id\) router\.replace\(hierBleiben\(\), \{ scroll: false \}\)/)
    const u = quelle('src/components/kellerbuch/UmziehenWidget.tsx')
    assert.doesNotMatch(u, /zielNachVorgang/)
    assert.match(u, /setErfolg\(gebucht\)\n\s+router\.refresh\(\)/)
    const m = quelle(`${D}/admin/mandanten/[id]/MandantDetailClient.tsx`)
    assert.doesNotMatch(m, /router\.push\('\/admin\/mandanten'\)/)
  })
  test('feste Ziele folgen der Regel; Füllung aus dem Kellerbuch kommt zurück', () => {
    assert.match(quelle(`${D}/kellerbuch/weinausbau/[id]/analysen/neu/page.tsx`), /router\.push\(zielNachVorgang\(`\/kellerbuch\/weinausbau\/\$\{weinausbauId\}\/analysen`/)
    assert.match(quelle(`${D}/kellerbuch/lohnversektung/neu/VersandForm.tsx`), /router\.push\(zielNachVorgang\('\/kellerbuch\/lohnversektung'/)
    assert.match(quelle(`${D}/kellerbuch/weinausbau/[id]/page.tsx`), /mitZurueck\(`\/weinhandel\/fuellungen\/neu\?charge=\$\{weinausbau\.id\}`, `\/kellerbuch\/weinausbau\/\$\{weinausbau\.id\}`\)/)
    assert.match(quelle(`${D}/kellerbuch/gebinde/page.tsx`), /mitZurueck\(`\/weinhandel\/fuellungen\/neu\?charge=/)
    assert.match(quelle(`${D}/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx`), /mitZurueck\(`\/weinhandel\/fuellungen\/neu\?charge=/)
  })
})

describe('KAN-333: „Zurück“ bzw. „Abbrechen“ auf den Formularen', () => {
  test('bisher fehlende Stellen', () => {
    for (const datei of [
      `${D}/admin/import/ImportClient.tsx`, `${D}/betrieb/einstellungen/EinstellungenClient.tsx`,
      `${D}/kellerbuch/lohnversektung/neu/VersandForm.tsx`, `${D}/kellerbuch/produktion/ProduktionForm.tsx`,
      `${D}/kellerbuch/weinausbau/[id]/verarbeiten/VerarbeitenForm.tsx`, `${D}/kellerbuch/weinausbau/[id]/zugang/ZugangForm.tsx`,
      `${D}/dac/[id]/antrag/PNAFormular.tsx`, `${D}/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx`,
      `${D}/weingarten/import-gis/ImportGisClient.tsx`,
      // vorher fest verdrahtete Links
      `${D}/erntemeldung/neu/NeueLeseForm.tsx`, `${D}/weinexport/neu/WeinexportFormClient.tsx`,
      `${D}/kellerbuch/weinausbau/[id]/analysen/neu/page.tsx`, `${D}/lagen/[id]/page.tsx`,
    ]) assert.match(quelle(datei), /<AbbrechenKnopf\b/, datei)
  })
})

describe('KAN-333/334: Wächter check-zurueck', () => {
  const w = require('../check-zurueck.js')
  test('ZURUECK: Formular ohne Abbrechen wird gemeldet, mit Knopf, ohne Formular oder mit Ausnahme nicht', () => {
    assert.equal(w.pruefeZurueck(['export default function P() { return <form onSubmit={x}><button type="submit">Speichern</button></form> }']), true)
    assert.equal(w.pruefeZurueck(['<form onSubmit={x}>', '<AbbrechenKnopf standard="/a" />']), false)
    assert.equal(w.pruefeZurueck(['<form>', "router.push(zurueckZiel('/a'))"]), false)
    assert.equal(w.pruefeZurueck(["redirect('/kellerbuch')"]), false)
    assert.equal(w.pruefeZurueck(['<form>', '// zurueck-ausnahme: Assistent hat eigene Schritt-Navigation']), false)
    assert.equal(w.pruefeZurueck(['<form>', '// zurueck-ausnahme: kurz']), true)
  })
  test('BLEIBEN: zielNachVorgang ohne hierBleiben auf einer Detailseite', () => {
    assert.equal(w.pruefeBleiben("router.push(zielNachVorgang('/a', 'gespeichert'))"), true)
    assert.equal(w.pruefeBleiben("if (x) router.replace(hierBleiben()); else router.push(zielNachVorgang('/a'))"), false)
    assert.equal(w.pruefeBleiben('router.refresh()'), false)
  })
  test('Seitenarten', () => {
    assert.equal(w.istFormularSeite('src/app/(dashboard)/behandlungen/neu/page.tsx'), true)
    assert.equal(w.istFormularSeite('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/page.tsx'), true)
    assert.equal(w.istFormularSeite('src/app/(dashboard)/behandlungen/page.tsx'), false)
    assert.equal(w.istDetailSeite('src/app/(dashboard)/dac/[id]/page.tsx'), true)
    assert.equal(w.istDetailSeite('src/app/(dashboard)/dac/[id]/antrag/page.tsx'), false)
  })
  test('im prebuild verdrahtet', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-zurueck\.js/)
  })
})
