// Sweep 6 (07.10.2026) – Kellerplan: KAN-106 Tastatur und Nur-Lesen-Modus, KAN-114 Tank auf Tank ziehen
// (leer = Umzug, gleicher Wein = Zusammenführung, anderer Wein = Verschnitt). Entscheidungen Jörgen 06.10.2026:
// Modusumschalter ja, Standardmenge = ganzer Inhalt, gleiche Sorte nicht als Verschnitt.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)/kellerbuch/kellerplan/[id]'

const charge = (id, x = {}) => ({
  id, name: id, menge_liter: 500, jahrgang: 2025, rebsorte: 'Grüner Veltliner', weinart: 'weiss',
  qualitaetsstufe: 'qualitaetswein', zusatzbezeichnung: null, erzeugnis: null, herkunft_code: 'weinviertel', ...x,
})
const gebinde = (id, x = {}) => ({ id, name: `Tank ${id}`, volumen_liter: 2000, gesperrt: false, fremd_betrieb: null, fuellung: 0, ...x })

describe('KAN-114: Bewertung des Ziels', nurMitHooks, () => {
  const k = () => laden('lib/keller/kellerplanZiehen.ts')
  test('leer = Umzug, gleicher Wein = Zusammenführen, anderer Wein = Verschnitt', async () => {
    const { bewerteZiel } = await k()
    const q = charge('GV')
    const basis = { quelle: q, quellGebinde: gebinde('A', { fuellung: 500 }), menge: 500 }
    assert.equal(bewerteZiel({ ...basis, ziel: gebinde('B'), zielChargen: [] }).art, 'umzug')
    const gleich = bewerteZiel({ ...basis, ziel: gebinde('B', { fuellung: 800 }), zielChargen: [charge('GV2', { menge_liter: 800 })] })
    assert.equal(gleich.art, 'zusammenfuehren')   // Entscheidung: gleiche Sorte nicht als Verschnitt
    assert.equal(gleich.zielCharge.id, 'GV2')
    const v = bewerteZiel({ ...basis, ziel: gebinde('B', { fuellung: 800 }), zielChargen: [charge('RI', { rebsorte: 'Riesling', menge_liter: 800 })] })
    assert.equal(v.art, 'verschnitt')
    assert.match(v.text, /Verschnitt in „RI“ \(abweichend: Rebsorte\)/)
    assert.equal(v.rotWeiss, false)
  })
  test('Rot auf Weiß: Verschnitt mit Hinweis (KAN-193), nicht gesperrt', async () => {
    const { bewerteZiel } = await k()
    const r = bewerteZiel({ quelle: charge('ZW', { rebsorte: 'Zweigelt', weinart: 'rot' }), quellGebinde: gebinde('A'), menge: 500,
      ziel: gebinde('B', { fuellung: 800 }), zielChargen: [charge('GV', { menge_liter: 800 })] })
    assert.equal(r.art, 'verschnitt')
    assert.equal(r.rotWeiss, true)
    assert.match(r.text, /Rot\/Weiß: Abstufung auf Wein \(aus Österreich\)/)
  })
  test('gesperrt: gleiches Gebinde, fremd belegt, kein Wein, Kapazität', async () => {
    const { bewerteZiel } = await k()
    const q = charge('GV')
    const A = gebinde('A', { fuellung: 500 })
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: A, ziel: A, zielChargen: [], menge: 500 }).art, 'gesperrt')
    assert.match(bewerteZiel({ quelle: q, quellGebinde: A, ziel: gebinde('B', { gesperrt: true, fremd_betrieb: 'Weingut X' }), zielChargen: [], menge: 500 }).text,
      /durch Weingut X belegt/)
    assert.match(bewerteZiel({ quelle: null, quellGebinde: A, ziel: gebinde('B'), zielChargen: [], menge: 500 }).text, /kein eigener Wein/)
    const voll = bewerteZiel({ quelle: q, quellGebinde: A, ziel: gebinde('B', { volumen_liter: 1000, fuellung: 700 }), zielChargen: [charge('GV2')], menge: 500 })
    assert.equal(voll.art, 'gesperrt')
    assert.match(voll.text, /fasst nur noch 300 L/)
    // ohne Volumen keine Kapazitätsprüfung
    assert.equal(bewerteZiel({ quelle: q, quellGebinde: A, ziel: gebinde('B', { volumen_liter: null }), zielChargen: [], menge: 500 }).art, 'umzug')
  })
  test('Zeiger über einem Kreis: nächster Mittelpunkt, nicht die Quelle, freie Fläche = null', async () => {
    const { gebindeUnterZeiger } = await k()
    const kreise = [{ id: 'A', cx: 50, cy: 50, r: 20 }, { id: 'B', cx: 80, cy: 50, r: 20 }]
    assert.equal(gebindeUnterZeiger({ x: 75, y: 50 }, kreise, null), 'B')
    assert.equal(gebindeUnterZeiger({ x: 60, y: 50 }, kreise, null), 'A')
    assert.equal(gebindeUnterZeiger({ x: 50, y: 50 }, kreise, 'A'), null)
    assert.equal(gebindeUnterZeiger({ x: 200, y: 200 }, kreise, null), null)
  })
})

describe('KAN-106/KAN-114: Verdrahtung', () => {
  test('Seite: Nur-Lesen-Modus, alle Chargen je Gebinde mit Merkmalen', () => {
    const p = quelle(`${D}/page.tsx`)
    assert.match(p, /const nurLesen = canWrite\(role, 'kellerbuch'\) && !!\(await schreibSperre\(membership\)\)/)
    assert.match(p, /const writeOk  = canWrite\(role, 'kellerbuch'\) && !nurLesen/)
    assert.match(p, /weinart, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code'\)/)
    assert.match(p, /chargen=\{chargen\}/)
  })
  test('Editor: Tastatur, Modus, Plan-Funktionen nur im Plan-Modus, Ziehen nur mit Schreibrecht', () => {
    const e = quelle(`${D}/KellerplanEditor.tsx`)
    assert.match(e, /role="button"\n\s+tabIndex=\{0\}/)
    assert.match(e, /if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); setDialogBehaelterId\(behaelterId\) \}/)
    assert.match(e, /const planModus = writeOk && modus === 'plan'/)
    assert.match(e, /const ziehbar = \(id: string\) => writeOk && /)
    assert.match(e, /onDrop=\{planModus \? handleCanvasDrop : undefined\}/)
    assert.equal((e.match(/\{planModus && \(/g) ?? []).length >= 3, true)   // Entfernen, Größe, Liste „Nicht platziert“
    assert.match(e, /if \(!zielId\) return   \/\/ freie Fläche: abbrechen/)
    assert.match(e, /Umziehen bzw\. verschneiden nach …/)
  })
  test('Buchen: erst mit „Buchen“, über umziehen(), Rückfragen bestätigt, ganzer Inhalt als Standard', () => {
    const b = quelle(`${D}/KellerplanBuchen.tsx`)
    assert.match(b, /import \{ umziehen \} from '\.\.\/\.\.\/umziehen\/actions'/)
    assert.match(b, /useState\(quelle \? String\(quelle\.menge_liter\)/)
    // KAN-359: Rückfrage über den eigenen Dialog statt window.confirm
    assert.match(b, /if \(!\(await serverRueckfrage\(r\.bestaetigung\)\)\) return\n\s+fd\.set\('pn_bestaetigt', '1'\)\n\s+fd\.set\('rotweiss_bestaetigt', '1'\)/)
    assert.doesNotMatch(b, /window\.confirm/)
    assert.match(b, /disabled=\{pending \|\| bewertung\.art === 'gesperrt'\}/)
  })
})
