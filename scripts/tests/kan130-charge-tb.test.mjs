// KAN-130 Etappe 3 (02.10.2026): Mostgewicht an der manuellen Charge und in der Transportbescheinigung
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan130-charge-tb.test.mjs
//          (läuft auch über npm run test:csv; Node ≥ 22.15 wegen module.registerHooks)
//
// Entscheidung Jörgen 01.10.2026 (3): manuelle Charge mit optionalem Mostgewicht (°KMW/°Oe), leer erlaubt.
// Rechenregel 6: die Qualitätsstufe kommt nie aus dem Mostgewicht (eine DAC-Charge mit 20 °KMW bleibt 'dac').
// Rechenregel 9: eine in °Oe gemessene Most-Charge wird mit °Oe als Messwert vorbelegt.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HIER, '../../src')

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
const { mostgewichtAusFormular, mostgewichtSpalten } = await import('../../src/lib/wein/mostgewichtFormular.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Rumpf einer exportierten Funktion (bis zur nächsten Funktion auf oberster Ebene) */
function rumpf(text, name) {
  const start = text.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, `${name} nicht gefunden`)
  const rest = text.slice(start + 10)
  const ende = rest.search(/\n(export )?(async )?function /)
  return ende < 0 ? rest : rest.slice(0, ende)
}

const CFG = { betrieb_name: 'Weingut Muster', betrieb_strasse: 'Kellergasse 12', betrieb_plz: '2170', betrieb_ort: 'Poysdorf' }
const PN = { jeWeinausbau: {}, jeDacAntrag: {} }
const tank = (weinausbau) => ({ id: 'p', typ: 'tank', menge: 500, einheit: 'l', weinausbau })
const posten = (...positionen) => ({ id: 'v', datum: '2026-09-30', firma: { name: 'Kellerei' }, positionen })

// ── Manuelle Charge ─────────────────────────────────────────────────────────

describe('Manuelle Charge: optionales Mostgewicht', () => {
  test('84 °Oe → oechsle 84,0, °KMW 17,09, Einheit oechsle (Variante B)', () => {
    const fd = new FormData()
    fd.set('mostgewicht_wert', '84')
    fd.set('mostgewicht_einheit', 'oechsle')
    const e = mostgewichtAusFormular(fd, 'mostgewicht')
    assert.equal(e.ok, true)
    assert.equal(e.uebermittelt, true)
    assert.deepEqual(mostgewichtSpalten(e.wert, 'kmw'), { kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
  })
  test('leer erlaubt: beide Spalten NULL; ohne Feld bleibt das Gespeicherte (uebermittelt false)', () => {
    const fd = new FormData()
    fd.set('mostgewicht_wert', '')
    fd.set('mostgewicht_einheit', 'kmw')
    const leer = mostgewichtAusFormular(fd, 'mostgewicht')
    assert.deepEqual(mostgewichtSpalten(leer.wert, 'kmw'), { kmw: null, oechsle: null, mostgewicht_einheit: 'kmw' })
    assert.equal(mostgewichtAusFormular(new FormData(), 'mostgewicht').uebermittelt, false)
  })

  const actions = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
  test('createWeinausbau schreibt Messwert und Einheit', () => {
    const r = rumpf(actions, 'createWeinausbau')
    assert.match(r, /mostgewichtAusFormular\(formData, 'mostgewicht'\)/)
    assert.match(r, /if \(!mostgewicht\.ok\) throw new AktionsFehler\(mostgewicht\.fehler\)/)
    assert.match(r, /\.\.\.mostgewichtSpalten\(mostgewicht\.wert, 'kmw'\)/)
  })
  test('updateWeinausbau schreibt nur bei uebermittelt; Qualitätsstufe nur aus dem Formular (DAC bleibt DAC)', () => {
    const r = rumpf(actions, 'updateWeinausbau')
    assert.match(r, /mostgewicht\.uebermittelt \? mostgewichtSpalten\(mostgewicht\.wert, 'kmw'\) : \{\}/)
    assert.match(r, /\.\.\.qualitaetsSpalten\(chargenQualitaetAusFormular\(formData\)\)/)   // KAN-186: samt Zusatz/Erzeugnis
    assert.doesNotMatch(r, /kmwZuQualitaet|stufeAusKmw|mostgewicht\.wert\?*\.kmw/)
    // Fehler vor dem Schreiben (die Prüfung steht vor dem update())
    assert.ok(r.indexOf('!mostgewicht.ok') < r.indexOf(".update(payload)"))
  })
  test('Formular zeigt die Eingabe mit dem gespeicherten Wert; Seite lädt kmw, oechsle, mostgewicht_einheit', () => {
    const form = quelle('src/components/kellerbuch/WeinausbauForm.tsx')
    assert.match(form, /<MostgewichtEingabe[\s\S]*?name="mostgewicht"[\s\S]*?startwert=\{weinausbau \? \{ kmw: weinausbau\.kmw, oechsle: weinausbau\.oechsle, einheit: weinausbau\.mostgewicht_einheit \} : null\}/)
    const seite = quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx')
    assert.match(seite, /einstandspreis_pro_liter, kmw, oechsle, mostgewicht_einheit, behaelter:behaelter_id\(name\)/)
  })
})

// ── Transportbescheinigung ──────────────────────────────────────────────────

describe('Transportbescheinigung: Vorbelegung', () => {
  test('Most-Charge in °Oe gemessen → °Oe als Messwert, nicht der umgerechnete °KMW', () => {
    const [p] = tb.tbVorbelegung(posten(tank({ id: 'w', rebsorte: 'Zweigelt', status: 'gaerung', kmw: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })), CFG, PN, '2026-10-02', []).positionen
    assert.equal(p.mostgewicht_einheit, 'oechsle')
    assert.equal(p.oechsle, '84')
    assert.equal(p.kmw, '17,09')
    assert.equal(p.alkohol_pct, '17 °KMW')                          // Formblatt: °KMW auf 1 Stelle abgerundet
    assert.deepEqual(tbm.tbPositionMostgewicht(p), { kmw: 17.09, oechsle: 84, einheit: 'oechsle' })
  })
  test('Most-Charge in °KMW (Status Ernte) → °KMW als Messwert, °Oe dazu', () => {
    const [p] = tb.tbVorbelegung(posten(tank({ id: 'w', status: 'ernte', kmw: 18.97, oechsle: 94, mostgewicht_einheit: 'kmw' })), CFG, PN, '2026-10-02', []).positionen
    assert.deepEqual([p.kmw, p.oechsle, p.mostgewicht_einheit, p.alkohol_pct], ['18,97', '94', 'kmw', '18,9 °KMW'])
  })
  test('Wein (Status Ausbau) und Charge ohne Mostgewicht: nichts vorbelegt', () => {
    const [a, b] = tb.tbVorbelegung(posten(
      tank({ id: 'w1', status: 'ausbau', kmw: 18, oechsle: 88.5, mostgewicht_einheit: 'kmw' }),
      tank({ id: 'w2', status: 'gaerung', kmw: null, oechsle: null, mostgewicht_einheit: 'kmw' }),
    ), CFG, PN, '2026-10-02', []).positionen
    for (const p of [a, b]) assert.deepEqual([p.kmw, p.oechsle, p.mostgewicht_einheit, p.alkohol_pct], ['', '', '', ''])
  })
  test('Trauben: Messwert und Einheit der Lieferung (bisher nur °KMW auf 1 Stelle)', () => {
    const [p] = tb.tbVorbelegung(posten({ id: 'q', typ: 'trauben', menge: 100, traubenverkauf: { id: 't', datum: '2026-09-10', kmw_grad: 18.97, oechsle: 94, mostgewicht_einheit: 'oechsle', grundstueck: { rebsorte: 'Zweigelt' } } }), CFG, PN, '2026-10-02', []).positionen
    assert.deepEqual([p.kmw, p.oechsle, p.mostgewicht_einheit, p.alkohol_pct], ['18,97', '94', 'oechsle', '18,9 °KMW'])
  })
  test('Abfrage lädt Status und Mostgewicht der Charge sowie °Oe und Einheit der Lieferung', () => {
    const src = quelle('src/lib/behoerden/transportbescheinigung.ts')
    assert.match(src, /weinausbau:weinausbau\([^)]*status, kmw, oechsle, mostgewicht_einheit\)/)
    assert.match(src, /traubenverkauf:traubenverkauf\([^)]*kmw_grad, oechsle, mostgewicht_einheit/)
  })
})

describe('Transportbescheinigung: gespeicherte Formulare', () => {
  test('Altformular: °KMW aus „Alkohol % vol / °KMW“, wenn kmw fehlt', () => {
    assert.deepEqual(tbm.tbPositionMostgewicht({ alkohol_pct: '18,5 °KMW' }), { kmw: 18.5, oechsle: 91.5, einheit: 'kmw' })
    assert.deepEqual(tbm.tbPositionMostgewicht({ alkohol_pct: '18.5 KMW', kmw: '' }), { kmw: 18.5, oechsle: 91.5, einheit: 'kmw' })
    assert.equal(tbm.tbPositionMostgewicht({ alkohol_pct: '84 °Oe' })?.einheit, 'oechsle')
    assert.equal(tbm.tbPositionMostgewicht({ alkohol_pct: '12,5 % vol' }), null)
    assert.equal(tbm.tbPositionMostgewicht({ alkohol_pct: '' }), null)
  })
  test('Altformular mit kmw (Trauben bis 02.10.2026): kmw gilt, Einheit °KMW', () => {
    assert.deepEqual(tbm.tbPositionMostgewicht({ kmw: '18,9', alkohol_pct: '18,9 °KMW' }), { kmw: 18.9, oechsle: 93.7, einheit: 'kmw' })
  })
  test('positionLeer prüft das Mostgewicht mit: Position nur mit Mostgewicht wird ausgegeben', () => {
    const leer = { ...tb.TB_LEERE_POSITION }
    assert.equal(tb.positionLeer(leer), true)
    assert.equal(tb.positionLeer({ ...leer, kmw: '17,09' }), false)
    assert.equal(tb.positionLeer({ ...leer, oechsle: '84' }), false)
    const w = []
    const zeilen = tb.tbZeilen({ positionen: [leer, { ...leer, oechsle: '84', kmw: '17,09', mostgewicht_einheit: 'oechsle' }] },
      { verkaufspostenId: 'v', rechnungsnummer: null, verkaufsdatum: null, gespeichert: true, gespeichertAm: null, einheitStandard: 'l' }, w)
    assert.deepEqual(zeilen.map(z => z.position), [2])
  })
})

describe('Transportbescheinigung: Eingabe im Formular', () => {
  const m84 = { kmw: 17.09, oechsle: 84, einheit: 'oechsle' }
  const leer = { alkohol_pct: '', kmw: '', oechsle: '', mostgewicht_einheit: '' }
  test('neues Mostgewicht: Messwert, Einheit und Formblatt-Text', () => {
    assert.deepEqual(tbm.tbPositionMitMostgewicht(leer, m84), { alkohol_pct: '17 °KMW', kmw: '17,09', oechsle: '84', mostgewicht_einheit: 'oechsle' })
  })
  test('ein eigener Text in „Alkohol % vol / °KMW“ bleibt stehen, der automatische zieht mit', () => {
    assert.equal(tbm.tbPositionMitMostgewicht({ ...leer, alkohol_pct: '12,5 % vol' }, m84).alkohol_pct, '12,5 % vol')
    const vorher = tbm.tbPositionMitMostgewicht(leer, { kmw: 18.5, oechsle: 91.5, einheit: 'kmw' })
    assert.equal(tbm.tbPositionMitMostgewicht(vorher, m84).alkohol_pct, '17 °KMW')
    // Altformular nur mit Text: zieht ebenfalls mit
    assert.equal(tbm.tbPositionMitMostgewicht({ ...leer, alkohol_pct: '18,5 °KMW' }, m84).alkohol_pct, '17 °KMW')
  })
  test('Löschen leert Messwert, Einheit und den automatischen Text', () => {
    const vorher = tbm.tbPositionMitMostgewicht(leer, m84)
    assert.deepEqual(tbm.tbPositionMitMostgewicht(vorher, null), leer)
  })
  test('TBFormular nutzt MostgewichtEingabe je Position mit festem Startwert und sperrt Speichern bei Fehlern', () => {
    const src = quelle('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx')
    assert.match(src, /<MostgewichtEingabe[\s\S]*?startwert=\{zeile\.start\}/)
    assert.match(src, /tbPositionMitMostgewicht\(pos\[i\], wert\)/)
    assert.match(src, /disabled=\{pending \|\| !!mgFehlerText\}/)
  })
})
