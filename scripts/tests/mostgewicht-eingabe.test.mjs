// KAN-128 Teil A, S3/S4 (26.09.2026): Mostgewicht-Eingabe, Formular und bevorzugte Einheit
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/mostgewicht-eingabe.test.mjs
//          (Node ≥ 22.6, ohne Datenbank; läuft auch über npm run test:csv)
//
// (1) mostgewichtAusGespeichert(): gespeicherte Werte ohne Neuberechnung
// (2) mostgewichtAusFormular(): versteckte Felder der Komponente → beide Werte (Server Action)
// (3) mostgewichtSpalten(): Löschen = beide Spalten NULL
// (4) Zustand der Eingabe-Komponente (lib/wein/mostgewichtEingabe.ts): gekoppelte Felder,
//     Öffnen und Speichern ohne Änderung, Stufenwechsel beim Überschreiben eines ≈-Werts,
//     Grenzfall-Hinweis, Leeren = gelöscht
// (5) Verdrahtung (Quelltext): Einstellungen-Action, Layout-Cache, AppShell, Komponente
//
// Auflösung der endungslosen Importe ('./mostgewicht', '../weinqualitaet'): ernte.aufloesung.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const { ausMessung, format } = await import('../../src/lib/wein/mostgewicht.ts')
const { mostgewichtAusGespeichert, mostgewichtAusFormular, mostgewichtSpalten } = await import('../../src/lib/wein/mostgewichtFormular.ts')
const E = await import('../../src/lib/wein/mostgewichtEingabe.ts')
const { eingabeStart, eingabeAendern, eingabeStufe, stufenwechsel, grenzfall, versteckteWerte, feldReihenfolge, feldText } = E

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/** Formular, wie es die Komponente absendet (versteckte Felder) */
function formular(z, name = 'mg', altesFeld) {
  const fd = new FormData()
  const v = versteckteWerte(z)
  fd.set(`${name}_wert`, v.wert)
  fd.set(`${name}_einheit`, v.einheit)
  if (altesFeld) fd.set(altesFeld, v.kmw)
  return fd
}

/** Öffnen → ohne Änderung speichern → Werte, die die Action schreibt */
function oeffnenUndSpeichern(gespeichert, bevorzugt) {
  const r = mostgewichtAusFormular(formular(eingabeStart(gespeichert, bevorzugt)), 'mg')
  assert.equal(r.ok, true, JSON.stringify(gespeichert))
  return r.wert
}

function raster(von, bis, stellen) {
  const f = 10 ** stellen
  const werte = []
  for (let i = Math.round(von * f); i <= Math.round(bis * f); i++) werte.push(i / f)
  return werte
}

// ── (1) gespeicherte Werte ──────────────────────────────────────────────────

describe('mostgewichtAusGespeichert()', () => {
  test('beide Werte wie gespeichert, auch als Text aus der Datenbank', () => {
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: 17.4, oechsle: 85.7, einheit: 'kmw' }), { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' })
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: '17.09', oechsle: '84.0', einheit: 'oechsle' }), { kmw: 17.09, oechsle: 84, einheit: 'oechsle' })
  })

  test('nichts neu rechnen: abweichender gespeicherter °Oe bleibt (Musterhof-Demo round(KMW × 4,8))', () => {
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: 17, oechsle: 81.6, einheit: 'kmw' }), { kmw: 17, oechsle: 81.6, einheit: 'kmw' })
  })

  test('fehlender Wert aus dem Messwert, Einheit ohne Angabe: °KMW (Zeilen vor Migration A)', () => {
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: 17.4 }), { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' })
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: 17.4, oechsle: null, einheit: null }), { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' })
    assert.deepEqual(mostgewichtAusGespeichert({ oechsle: 84 }), { kmw: 17.09, oechsle: 84, einheit: 'oechsle' })
  })

  test('Einheit ohne Wert fällt auf die andere zurück (wie der Trigger)', () => {
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: 17, oechsle: null, einheit: 'oechsle' }), { kmw: 17, oechsle: 83.5, einheit: 'kmw' })
    assert.deepEqual(mostgewichtAusGespeichert({ kmw: null, oechsle: 94.2, einheit: 'kmw' }), { kmw: 19, oechsle: 94.2, einheit: 'oechsle' })
  })

  test('ohne Mostgewicht → null', () => {
    for (const g of [null, undefined, {}, { kmw: null, oechsle: null, einheit: 'kmw' }, { kmw: '', oechsle: ' ' }, { kmw: 'abc' }]) {
      assert.equal(mostgewichtAusGespeichert(g), null, JSON.stringify(g))
    }
  })

  test('Altbestand außerhalb des Eingabebereichs wird trotzdem angezeigt', () => {
    const m = mostgewichtAusGespeichert({ kmw: 65 })
    assert.equal(m.kmw, 65)
    assert.equal(m.einheit, 'kmw')
    assert.ok(m.oechsle > 360)
  })
})

// ── (2) Formular → Server Action ────────────────────────────────────────────

describe('mostgewichtAusFormular()', () => {
  const fd = (felder) => { const f = new FormData(); for (const [k, v] of Object.entries(felder)) f.set(k, v); return f }

  test('°Oe gemessen: 84 → 84,0 °Oe, 17,09 °KMW, Einheit oechsle (Akzeptanzkriterium)', () => {
    const r = mostgewichtAusFormular(fd({ mg_wert: '84', mg_einheit: 'oechsle' }), 'mg')
    assert.deepEqual(r, { ok: true, wert: { kmw: 17.09, oechsle: 84, einheit: 'oechsle' }, uebermittelt: true })
    assert.equal(format(r.wert, 'oechsle'), '84,0 °Oe · ≈ 17,09 °KMW')
  })

  test('83,5 °Oe eingebbar (= 17,00 °KMW), 83,55 abgelehnt', () => {
    assert.deepEqual(mostgewichtAusFormular(fd({ mg_wert: '83,5', mg_einheit: 'oechsle' }), 'mg').wert, { kmw: 17, oechsle: 83.5, einheit: 'oechsle' })
    const r = mostgewichtAusFormular(fd({ mg_wert: '83,55', mg_einheit: 'oechsle' }), 'mg')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /höchstens einer Nachkommastelle/)
  })

  test('°KMW gemessen: 17,4 → 85,7 °Oe', () => {
    assert.deepEqual(mostgewichtAusFormular(fd({ mg_wert: '17,4', mg_einheit: 'kmw' }), 'mg').wert, { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' })
  })

  test('leer = gelöscht, fehlendes Feld = nicht übermittelt', () => {
    assert.deepEqual(mostgewichtAusFormular(fd({ mg_wert: '  ', mg_einheit: 'oechsle' }), 'mg'), { ok: true, wert: null, uebermittelt: true })
    assert.deepEqual(mostgewichtAusFormular(fd({ mg_wert: '', mg_einheit: 'x' }), 'mg'), { ok: true, wert: null, uebermittelt: true })
    assert.deepEqual(mostgewichtAusFormular(fd({ anderes: '1' }), 'mg'), { ok: true, wert: null, uebermittelt: false })
  })

  test('altes Feld als °KMW, solange das Formular noch nicht umgestellt ist', () => {
    assert.deepEqual(mostgewichtAusFormular(fd({ klosterneuburger: '17,4' }), 'mg', { altesFeld: 'klosterneuburger' }).wert, { kmw: 17.4, oechsle: 85.7, einheit: 'kmw' })
    assert.deepEqual(mostgewichtAusFormular(fd({ klosterneuburger: '' }), 'mg', { altesFeld: 'klosterneuburger' }), { ok: true, wert: null, uebermittelt: true })
    // neue Felder haben Vorrang vor dem alten
    const r = mostgewichtAusFormular(fd({ mg_wert: '84', mg_einheit: 'oechsle', klosterneuburger: '17.09' }), 'mg', { altesFeld: 'klosterneuburger' })
    assert.equal(r.wert.einheit, 'oechsle')
  })

  test('ungültig: Einheit fehlt, Bereich, Text, Datei – Fehler mit Bezeichnung', () => {
    const faelle = [
      [{ mg_wert: '84' }, /°KMW oder °Oe/],
      [{ mg_wert: '84', mg_einheit: 'brix' }, /°KMW oder °Oe/],
      [{ mg_wert: '61', mg_einheit: 'kmw' }, /zwischen 0 und 60 °KMW/],
      [{ mg_wert: '360,1', mg_einheit: 'oechsle' }, /zwischen 0 und 360 °Oe/],
      [{ mg_wert: '-3', mg_einheit: 'kmw' }, /nicht negativ/],
      [{ mg_wert: '17,4 KMW', mg_einheit: 'kmw' }, /als Zahl/],
      [{ mg_wert: '17,456', mg_einheit: 'kmw' }, /höchstens 2 Nachkommastellen/],
    ]
    for (const [felder, muster] of faelle) {
      const r = mostgewichtAusFormular(fd(felder), 'mg', { bezeichnung: 'GST 123/4' })
      assert.equal(r.ok, false, JSON.stringify(felder))
      assert.match(r.fehler, /^GST 123\/4: /)
      assert.match(r.fehler, muster, JSON.stringify(felder))
    }
    const f = new FormData()
    f.set('mg_wert', new Blob(['84']), 'x.txt')
    f.set('mg_einheit', 'oechsle')
    assert.equal(mostgewichtAusFormular(f, 'mg').ok, false)
  })
})

// ── (3) Spalten ─────────────────────────────────────────────────────────────

describe('mostgewichtSpalten()', () => {
  test('beide Werte und die Einheit, °KMW-Spalte je Tabelle', () => {
    assert.deepEqual(mostgewichtSpalten(ausMessung(84, 'oechsle'), 'klosterneuburger'), { klosterneuburger: 17.09, oechsle: 84, mostgewicht_einheit: 'oechsle' })
    assert.deepEqual(mostgewichtSpalten(ausMessung(17.4, 'kmw'), 'kmw_grad'), { kmw_grad: 17.4, oechsle: 85.7, mostgewicht_einheit: 'kmw' })
  })

  test('Löschen: beide Spalten NULL in einem Schreibvorgang, Einheit kmw (NOT NULL)', () => {
    assert.deepEqual(mostgewichtSpalten(null, 'kmw'), { kmw: null, oechsle: null, mostgewicht_einheit: 'kmw' })
  })
})

// ── (4) Eingabe-Komponente ──────────────────────────────────────────────────

describe('Eingabe: Start ohne Neuberechnung', () => {
  test('gespeicherter Messwert wie gespeichert, das andere Feld mit voller Genauigkeit', () => {
    const z = eingabeStart({ kmw: 16.99, oechsle: 83.5, einheit: 'kmw' }, 'oechsle')
    assert.equal(z.gemessen, 'kmw')
    assert.deepEqual(z.text, { kmw: '16,99', oechsle: '83,5' })
    assert.equal(z.bearbeitet, false)
    assert.deepEqual(eingabeStart({ kmw: 17.09, oechsle: 84, einheit: 'oechsle' }, 'kmw').text, { kmw: '17,09', oechsle: '84' })
    assert.deepEqual(eingabeStart({ kmw: 17.4, oechsle: 85.7, einheit: 'kmw' }, 'kmw').text, { kmw: '17,4', oechsle: '85,7' })
    assert.deepEqual(eingabeStart({ kmw: 17, oechsle: 83.5, einheit: 'kmw' }, 'kmw').text, { kmw: '17,0', oechsle: '83,5' })
    // abweichender gespeicherter °Oe wird gezeigt, nicht neu gerechnet
    assert.equal(eingabeStart({ kmw: 17, oechsle: 81.6, einheit: 'kmw' }, 'kmw').text.oechsle, '81,6')
  })

  test('ohne Wert: leere Felder, gemessen = bevorzugte Einheit, Reihenfolge bevorzugt zuerst', () => {
    const z = eingabeStart(null, 'oechsle')
    assert.deepEqual(z.text, { kmw: '', oechsle: '' })
    assert.equal(z.gemessen, 'oechsle')
    assert.equal(z.wert, null)
    assert.deepEqual(versteckteWerte(z), { wert: '', einheit: 'oechsle', kmw: '' })
    assert.deepEqual(feldReihenfolge('oechsle'), ['oechsle', 'kmw'])
    assert.deepEqual(feldReihenfolge('kmw'), ['kmw', 'oechsle'])
  })

  test('Öffnen und Speichern ohne Änderung ändert nichts (73 °Oe, 94,2 °Oe, 14,9 °KMW)', () => {
    for (const [wert, einheit] of [[73, 'oechsle'], [94.2, 'oechsle'], [14.9, 'kmw'], [83.5, 'oechsle'], [16.99, 'kmw']]) {
      const gespeichert = ausMessung(wert, einheit)
      for (const bevorzugt of ['kmw', 'oechsle']) {
        assert.deepEqual(oeffnenUndSpeichern(gespeichert, bevorzugt), gespeichert, `${wert} ${einheit}, bevorzugt ${bevorzugt}`)
      }
    }
    assert.equal(ausMessung(73, 'oechsle').kmw, 14.99)
  })

  test('Öffnen und Speichern ohne Änderung: ganzes Raster 50,0–250,0 °Oe und 10,00–40,00 °KMW', () => {
    for (const oe of raster(50, 250, 1)) {
      const g = ausMessung(oe, 'oechsle')
      assert.deepEqual(oeffnenUndSpeichern(g, 'kmw'), g, `${oe} °Oe`)
    }
    for (const k of raster(10, 40, 2)) {
      const g = ausMessung(k, 'kmw')
      assert.deepEqual(oeffnenUndSpeichern(g, 'oechsle'), g, `${k} °KMW`)
    }
  })

  test('altes Feld trägt beim Öffnen den gespeicherten °KMW', () => {
    const z = eingabeStart({ kmw: 17.09, oechsle: 84, einheit: 'oechsle' }, 'kmw')
    assert.equal(formular(z, 'mg', 'klosterneuburger').get('klosterneuburger'), '17.09')
  })
})

describe('Eingabe: gekoppelte Felder', () => {
  test('°Oe eingeben → °KMW umgerechnet, °Oe gemessen', () => {
    const z = eingabeAendern(eingabeStart(null, 'oechsle'), 'oechsle', '84')
    assert.deepEqual(z.wert, { kmw: 17.09, oechsle: 84, einheit: 'oechsle' })
    assert.deepEqual(z.text, { oechsle: '84', kmw: '17,09' })
    assert.equal(z.gemessen, 'oechsle')
    assert.deepEqual(versteckteWerte(z), { wert: '84', einheit: 'oechsle', kmw: '17.09' })
  })

  test('°KMW eingeben → ≈ °Oe mit einer Stelle', () => {
    const z = eingabeAendern(eingabeStart(null, 'kmw'), 'kmw', '17,4')
    assert.deepEqual(z.text, { kmw: '17,4', oechsle: '85,7' })
    assert.equal(feldText('oechsle', ausMessung(17.4, 'kmw')), '85,7')
    assert.equal(feldText('oechsle', ausMessung(17.8, 'kmw')), '87,8')
  })

  test('das zuletzt bearbeitete Feld ist gemessen – auch der überschriebene ≈-Wert', () => {
    let z = eingabeStart({ kmw: 17.4, oechsle: 85.7, einheit: 'kmw' }, 'kmw')
    z = eingabeAendern(z, 'oechsle', '86')
    assert.equal(z.gemessen, 'oechsle')
    assert.deepEqual(versteckteWerte(z), { wert: '86', einheit: 'oechsle', kmw: String(ausMessung(86, 'oechsle').kmw) })
    z = eingabeAendern(z, 'kmw', '17,5')
    assert.equal(z.gemessen, 'kmw')
    assert.equal(z.text.oechsle, feldText('oechsle', ausMessung(17.5, 'kmw')))
  })

  test('Leeren = gelöscht: beide Felder leer, Action setzt beide Spalten NULL (auch über das ≈-Feld)', () => {
    for (const feld of ['oechsle', 'kmw']) {
      const z = eingabeAendern(eingabeStart({ kmw: 17.09, oechsle: 84, einheit: 'oechsle' }, 'kmw'), feld, '')
      assert.deepEqual(z.text, { kmw: '', oechsle: '' })
      assert.equal(z.wert, null)
      assert.equal(z.fehler, null)
      const r = mostgewichtAusFormular(formular(z, 'mg', 'klosterneuburger'), 'mg')
      assert.deepEqual(r, { ok: true, wert: null, uebermittelt: true })
      assert.deepEqual(mostgewichtSpalten(r.wert, 'klosterneuburger'), { klosterneuburger: null, oechsle: null, mostgewicht_einheit: 'kmw' })
    }
  })

  test('ungültige Eingabe: Fehler, anderes Feld leer, die Action lehnt den Rohwert ab', () => {
    const z = eingabeAendern(eingabeStart(null, 'oechsle'), 'oechsle', '83,55')
    assert.equal(z.wert, null)
    assert.match(z.fehler, /höchstens einer Nachkommastelle/)
    assert.equal(z.text.kmw, '')
    assert.deepEqual(versteckteWerte(z), { wert: '83,55', einheit: 'oechsle', kmw: '' })
    assert.equal(mostgewichtAusFormular(formular(z), 'mg').ok, false)
    // Zwischenstand beim Tippen ist gültig
    assert.equal(eingabeAendern(eingabeStart(null, 'oechsle'), 'oechsle', '83,').wert.oechsle, 83)
  })
})

describe('Eingabe: Stufenwechsel und Grenzfall', () => {
  test('Überschriebenes ≈ 83,5 °Oe (aus 16,99 °KMW) zeigt Qualitätswein → Kabinett', () => {
    const start = eingabeStart({ kmw: 16.99, oechsle: 83.5, einheit: 'kmw' }, 'kmw')
    assert.equal(eingabeStufe(start), 'qualitaetswein')
    assert.equal(start.text.oechsle, '83,5')
    assert.equal(stufenwechsel(start), null)
    // Feld leeren und neu tippen, wie im Browser
    let z = start
    for (const t of ['', '8', '83', '83,', '83,5']) z = eingabeAendern(z, 'oechsle', t)
    assert.deepEqual(z.wert, { kmw: 17, oechsle: 83.5, einheit: 'oechsle' })
    assert.equal(eingabeStufe(z), 'kabinett')
    const w = stufenwechsel(z)
    assert.equal(w.von, 'qualitaetswein')
    assert.equal(w.nach, 'kabinett')
    assert.deepEqual(w.vorher, { kmw: 16.99, oechsle: 83.5, einheit: 'kmw' })
  })

  test('kein Stufenwechsel ohne Einheitenwechsel oder bei gleicher Stufe', () => {
    let z = eingabeStart({ kmw: 16.99, oechsle: 83.5, einheit: 'kmw' }, 'kmw')
    z = eingabeAendern(z, 'kmw', '17,0')           // Messwert selbst geändert
    assert.equal(stufenwechsel(z), null)
    z = eingabeStart({ kmw: 17.4, oechsle: 85.7, einheit: 'kmw' }, 'kmw')
    z = eingabeAendern(z, 'oechsle', '86')          // ≈-Wert überschrieben, Kabinett bleibt
    assert.equal(stufenwechsel(z), null)
    z = eingabeAendern(eingabeStart(null, 'kmw'), 'oechsle', '83,5')  // neu, ohne vorherigen Wert
    assert.equal(stufenwechsel(z), null)
  })

  test('Stufenwechsel bleibt beim Weitertippen im neuen Feld sichtbar', () => {
    let z = eingabeStart({ kmw: 18.99, oechsle: 94.1, einheit: 'kmw' }, 'kmw')
    assert.equal(eingabeStufe(z), 'kabinett')
    z = eingabeAendern(z, 'oechsle', '94,')
    z = eingabeAendern(z, 'oechsle', '94,2')
    assert.deepEqual(stufenwechsel(z), { von: 'kabinett', nach: 'spaetlese', vorher: { kmw: 18.99, oechsle: 94.1, einheit: 'kmw' } })
  })

  test('Grenzfall ±0,2 °KMW an den Stufenschwellen, Mostwäger-Hinweis ab Prädikatswein', () => {
    assert.deepEqual(grenzfall(ausMessung(83.5, 'oechsle')), { schwelleKmw: 17, schwelleOechsle: 83.5, stufe: 'kabinett', praedikatswein: false })
    assert.deepEqual(grenzfall(ausMessung(94.2, 'oechsle')), { schwelleKmw: 19, schwelleOechsle: 94.2, stufe: 'spaetlese', praedikatswein: true })
    assert.deepEqual(grenzfall(ausMessung(105, 'oechsle')), { schwelleKmw: 21, schwelleOechsle: 105, stufe: 'auslese', praedikatswein: true })
    assert.equal(grenzfall(ausMessung(156, 'oechsle')).stufe, 'trockenbeerenauslese')
    assert.equal(grenzfall(ausMessung(16.8, 'kmw')).schwelleKmw, 17)
    assert.equal(grenzfall(ausMessung(17.2, 'kmw')).schwelleKmw, 17)
    assert.equal(grenzfall(ausMessung(16.79, 'kmw')), null)
    assert.equal(grenzfall(ausMessung(18.5, 'kmw')), null)
    assert.equal(grenzfall(null), null)
    assert.deepEqual([...E.STUFEN_SCHWELLEN_KMW], [14, 15, 17, 19, 21, 25, 30])
  })
})

// ── (5) Verdrahtung ─────────────────────────────────────────────────────────

describe('Verdrahtung (Quelltext)', () => {
  test('Einstellungen: eigene Action mit requireOwnTenant, Wertprüfung und Cache-Invalidierung', () => {
    const a = quelle('src/app/(dashboard)/betrieb/einstellungen/actions.ts')
    const fn = a.slice(a.indexOf('export async function saveKellerwirtschaftOwn'), a.indexOf('// ── bawb.at'))
    assert.match(fn, /await requireOwnTenant\(\)/)
    assert.match(fn, /istMostgewichtEinheit\(einheit\)/)
    assert.match(fn, /createSupabaseAdminClient\(\)/)
    assert.match(fn, /mostgewicht_einheit:\s*einheit/)
    assert.match(fn, /tenantKopfInvalidieren\(auth\.tenantId\)/)
    // requireOwnTenant: Seitenbetrieb und Schreibsperre vor canAdmin
    const r = a.slice(a.indexOf('async function requireOwnTenant'), a.indexOf('// ── Branding'))
    assert.ok(r.indexOf('seitenBetriebFehler') < r.indexOf('canAdmin'))
    assert.ok(r.indexOf('schreibSperreFehler') < r.indexOf('canAdmin'))
    const c = quelle('src/app/(dashboard)/betrieb/einstellungen/EinstellungenClient.tsx')
    assert.match(c, /saveKellerwirtschaftOwn\(fd\)/)
    assert.match(c, /name="mostgewicht_einheit"/)
  })

  test('Layout-Cache liest die Einheit, AppShell stellt sie bereit', () => {
    assert.match(quelle('src/lib/tenant/kopf.ts'), /KOPF_SPALTEN = '[^']*\bmostgewicht_einheit\b/)
    assert.match(quelle('src/app/(dashboard)/layout.tsx'), /mostgewichtEinheit=\{mostgewichtEinheit\}/)
    assert.match(quelle('src/components/layout/AppShell.tsx'), /<MostgewichtEinheitProvider einheit=\{mostgewichtEinheit\}>/)
  })

  test('Komponente: versteckte Felder <name>_wert, <name>_einheit und das alte Feld', () => {
    const k = quelle('src/components/wein/MostgewichtEingabe.tsx')
    assert.match(k, /name=\{`\$\{name\}_wert`\}/)
    assert.match(k, /name=\{`\$\{name\}_einheit`\}/)
    assert.match(k, /name=\{altesFeld\} value=\{versteckt\.kmw\}/)
    assert.match(k, /setCustomValidity/)
    assert.doesNotMatch(k, /lib\/auth\/roles/)   // server-only
  })
})
