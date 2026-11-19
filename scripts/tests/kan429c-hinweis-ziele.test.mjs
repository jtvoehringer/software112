// KAN-429 Nebenbefund 2 (UAT 19.11.2026, Musterhof): Hinweise am Exportauftrag – „Eintragen“ sagte nicht, wo was.
//
// 1. „Alkohol fehlt … Eintragen“ führte auf die Charge, ohne zu sagen, dass dort eine Analyse zu erfassen ist.
// 2. „Schweiz: … kein Präferenzzoll … Eintragen“ führte zum Auftrag, obwohl es nichts einzutragen gibt.
// 3. „Leergewicht eintragen: <Füllung>“ nannte das Feld nicht und sprang nicht hin.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { grunddatenHinweise, ZIEL_AUFTRAG, ZIEL_BETRIEB } from '../../src/lib/export/grunddaten.ts'
import { rechnungHinweise, rechnungHinweiseMitZiel } from '../../src/lib/export/rechnungTexte.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-429 Nebenbefund 2: jeder Link der Hinweisliste nennt sein Ziel', () => {
  test('Hinweise des Auftrags und des Betriebs', () => {
    const h = grunddatenHinweise({ auftragId: 'a1', auftrag: { destination_land: 'CH' }, betrieb: {}, positionen: [], bearbeitbar: true })
    assert.ok(h.length >= 3)
    for (const x of h) assert.ok(x.href && x.ziel, x.text)
    assert.equal(h.find(x => /Versanddatum/.test(x.text)).ziel, ZIEL_AUFTRAG)
    assert.equal(h.find(x => /EORI/.test(x.text)).ziel, ZIEL_BETRIEB)
  })
  test('gesperrter Auftrag: ohne Link auch kein Ziel', () => {
    const h = grunddatenHinweise({ auftragId: 'a1', auftrag: { destination_land: 'CH' }, betrieb: {}, positionen: [], bearbeitbar: false })
    const v = h.find(x => /Versanddatum/.test(x.text))
    assert.deepEqual([v.href, v.ziel], [null, undefined])
  })
})

describe('KAN-429 Nebenbefund 2: Hinweise zur Rechnung – Link nur, wo sich etwas eintragen lässt', () => {
  const ohne = {}
  test('Fall aus dem UAT – Schweiz, kein Präferenzzoll: reiner Hinweis ohne Ziel', () => {
    const h = rechnungHinweiseMitZiel({ auftrag: { destination_land: 'CH', ursprungserklaerung: true }, betrieb: ohne, warenwert: 4000 })
    assert.equal(h.length, 1)
    assert.match(h[0].text, /^Schweiz: .*keinen Präferenzzoll/)
    assert.equal(h[0].ziel, null)
  })
  test('Abkommen nicht angekreuzt → Auftrag; Nummer des Betriebs fehlt → Betrieb; EU ohne UID → Auftrag', () => {
    assert.deepEqual(rechnungHinweiseMitZiel({ auftrag: { destination_land: 'GB' }, betrieb: ohne, warenwert: 100 }).map(x => x.ziel), ['auftrag'])
    assert.deepEqual(rechnungHinweiseMitZiel({ auftrag: { destination_land: 'GB', ursprungserklaerung: true }, betrieb: ohne, warenwert: 7000 }).map(x => x.ziel), ['betrieb'])
    assert.deepEqual(rechnungHinweiseMitZiel({ auftrag: { destination_land: 'DE' }, betrieb: ohne, warenwert: 100 }).map(x => x.ziel), ['auftrag'])
  })
  test('Japan (Kriterium von Hand): nichts einzutragen; die Texte bleiben dieselben wie bisher', () => {
    const e = { auftrag: { destination_land: 'JP', ursprungserklaerung: true }, betrieb: ohne, warenwert: 100 }
    assert.deepEqual(rechnungHinweiseMitZiel(e).map(x => x.ziel), [null])
    assert.deepEqual(rechnungHinweiseMitZiel(e).map(x => x.text), rechnungHinweise(e))
  })
})

describe('KAN-429 Nebenbefund 2: Einbau', () => {
  const d = quelle('src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx')
  test('Ansicht zeigt das Ziel statt „Eintragen“', () => {
    assert.ok(d.includes("→ {h.ziel ?? 'Zur Eingabe'}</Link>"))
    assert.ok(!d.includes('>Eintragen</Link>'))
  })
  test('Leergewicht: Feld benannt, Link springt zum Feld der Füllung', () => {
    assert.ok(d.includes('Leergewicht eintragen (Füllung bearbeiten, Feld „Leergewicht der Flasche (g)“):'))
    assert.ok(quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx').includes('<div id="leergewicht" className="scroll-mt-24">'))
  })
  test('Lader: Betrieb und Auftrag als Ziel, sonst kein Link', () => {
    const l = quelle('src/lib/behoerden/exportauftrag.ts')
    assert.ok(l.includes("ziel === 'betrieb' ? { text, href: '/betrieb/einstellungen', ziel: ZIEL_BETRIEB }"))
    assert.ok(l.includes(": { text, href: null }),"))
  })
})
