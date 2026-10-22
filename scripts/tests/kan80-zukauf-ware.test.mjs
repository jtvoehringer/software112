// KAN-80 Nachtrag (02.10.2026, Entscheidungen Jörgen): Ware eines Zukaufs mit Qualitätsstufe und Herkunfts-Code (BKI)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan80-zukauf-ware.test.mjs
//          (läuft auch über npm run test:csv)
//
// Geprüft: Pflichtfelder im Bereich Ware (Prüfnummer seit 02.10.2026 nie Pflicht), Herkunft nur als Code bzw.
// eigenes Weinbaugebiet, Altwerte (Freitext) in Anzeige und Vorbelegung, Weitergabe von Stufe und Herkunft an die
// Charge, Pressung aus Zukauf-Trauben: Herkunft und Qualität als Minimum (Regeln wie Weinabstufung).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const w = await import('../../src/lib/zukauf/ware.ts')
const { minHerkunft } = await import('../../src/lib/herkunft.ts')
const { abstufungFehler, abstufungsOptionen } = await import('../../src/lib/wein/qualitaet.ts')

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const WEIN = {
  art: 'wein', weinart: 'weiss', rebsorte: 'Grüner Veltliner', jahrgang: 2025, qualitaetsstufe: 'landwein',
  herkunft: 'weinland', mostgewicht: false, alkohol: 12.5, pruefnummer: null,
}
const TRAUBEN = {
  art: 'trauben', weinart: 'rot', rebsorte: 'Zweigelt', jahrgang: 2026, qualitaetsstufe: 'qualitaetswein',
  herkunft: 'kamptal_gebietswein', mostgewicht: true, alkohol: null, pruefnummer: null,
}

describe('Pflichtfelder im Bereich Ware', () => {
  test('vollständige Ware: kein Fehler (Wein, Most, Trauben)', () => {
    assert.equal(w.zukaufWareFehler(WEIN, []), null)
    assert.equal(w.zukaufWareFehler(TRAUBEN, []), null)
    assert.equal(w.zukaufWareFehler({ ...TRAUBEN, art: 'most' }, []), null)
  })
  test('fehlende Felder werden gemeinsam genannt', () => {
    const f = w.zukaufWareFehler({ ...TRAUBEN, weinart: 'unbekannt', rebsorte: ' ', jahrgang: null, qualitaetsstufe: null, herkunft: '', mostgewicht: false }, [])
    for (const feld of ['Weinart', 'Rebsorte(n)', 'Jahrgang', 'Qualitätsstufe', 'Herkunfts-Code (BKI)', 'Mostgewicht']) assert.match(f, new RegExp(feld.replace(/[()]/g, '\\$&')))
  })
  test('Alkoholgehalt bei Wein Pflicht, bei Trauben nicht', () => {
    assert.match(w.zukaufWareFehler({ ...WEIN, alkohol: null }, []), /Alkoholgehalt/)
    assert.equal(w.zukaufWareFehler({ ...TRAUBEN, alkohol: null }, []), null)
  })
  test('Mostgewicht bei Trauben und Most Pflicht, bei Wein nicht', () => {
    assert.match(w.zukaufWareFehler({ ...TRAUBEN, mostgewicht: false }, []), /Mostgewicht/)
    assert.match(w.zukaufWareFehler({ ...TRAUBEN, art: 'most', mostgewicht: false }, []), /Mostgewicht/)
    assert.equal(w.zukaufWareFehler({ ...WEIN, mostgewicht: false }, []), null)
  })
  test('Jahrgang außerhalb 1900–2100 abgelehnt', () => {
    assert.match(w.zukaufWareFehler({ ...WEIN, jahrgang: 1800 }, []), /1900 und 2100/)
  })
})

// Entscheidung Jörgen 02.10.2026 (ersetzt KAN-80 Regel a „Pflicht ab Qualitätswein“): der Zukauf hat keine
// Prüfnummernpflicht – erst ein abzufüllender Wein wird zur Prüfnummer angemeldet.
describe('Staatliche Prüfnummer beim Zukauf: nie Pflicht', () => {
  test('bei keiner Stufe Pflicht, auch nicht bei Sekt/Perlwein oder Reserve & Co.', () => {
    assert.equal(w.pruefnummerPflicht, undefined, 'pruefnummerPflicht entfernt')
    for (const s of ['wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese', 'trockenbeerenauslese', 'eiswein', 'dac', 'sonstiges', 'reserve', 'sekt', 'perlwein']) {
      assert.equal(w.zukaufWareFehler({ ...WEIN, qualitaetsstufe: s, pruefnummer: null }, []), null, s)
    }
    assert.equal(w.zukaufWareFehler({ ...TRAUBEN, art: 'most', qualitaetsstufe: 'kabinett' }, []), null)
  })
  test('Formulare: Feld optional, ohne Pflichtkennzeichen', async () => {
    // KAN-225: die Beschriftung kommt aus pruefnummerLabel() – bei Fasswein für jede Stufe „(optional)“
    const { pruefnummerLabel } = await import('../../src/lib/zukauf/pruefnummerLabel.ts')
    for (const s of ['wein', 'landwein', 'qualitaetswein', 'dac', 'sekt', '']) assert.equal(pruefnummerLabel('wein', s), 'Staatl. Prüfnummer (optional)', s)
    for (const p of ['src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx', 'src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx']) {
      const f = quelle(p)
      assert.match(f, /\{pruefnummerLabel\(art, qualitaet/, p)
      assert.match(f, /required=\{istFlaschenArt\(art\) && /, p)   // Pflichtfeld nur bei Flaschenware
      assert.doesNotMatch(f, /pruefnummerPflicht/, p)
    }
    assert.doesNotMatch(quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts'), /pruefnummer:\s+f\.pruefnummer,\n\s+\}, \(\(eigene/)
  })
})

describe('Herkunfts-Code (BKI)', () => {
  test('Katalog-Code und eigenes Weinbaugebiet gültig, Freitext nicht', () => {
    assert.equal(w.herkunftCodeFehler('thermenregion_ortswein', []), null)
    assert.equal(w.herkunftCodeFehler('Neckenmarkt', ['Neckenmarkt']), null)
    assert.equal(w.herkunftCodeFehler('neckenmarkt', ['Neckenmarkt']), null)   // Groß-/Kleinschreibung egal
    assert.match(w.herkunftCodeFehler('Kamptal', []), /unbekannt/)
    assert.match(w.herkunftCodeFehler('', []), /wählen/)
    assert.match(w.zukaufWareFehler({ ...WEIN, herkunft: 'Wachau' }, []), /„Wachau“ ist unbekannt/)
  })
  test('Anzeige: bekannter Code → Bezeichnung, Altwert unverändert', () => {
    assert.equal(w.herkunftAnzeige('kamptal_gebietswein'), 'Kamptal DAC – Gebietswein')
    assert.equal(w.herkunftAnzeige('Neckenmarkt'), 'Neckenmarkt')
    assert.equal(w.herkunftAnzeige('constructor'), 'constructor')
    assert.equal(w.herkunftAnzeige(null), null)
  })
  test('Vorbelegung beim Bearbeiten: Code bleibt, eindeutiger Altwert wird Code, sonst leer', () => {
    assert.equal(w.herkunftVorbelegung('wlnoe', []), 'wlnoe')
    assert.equal(w.herkunftVorbelegung('Kamptal', []), 'kamptal_gebietswein')
    assert.equal(w.herkunftVorbelegung('Neckenmarkt', []), '')
    assert.equal(w.herkunftVorbelegung('neckenmarkt', ['Neckenmarkt']), 'Neckenmarkt')
    assert.equal(w.herkunftVorbelegung(null, []), '')
  })
})

describe('Pressung aus Zukauf-Trauben: Qualität und Herkunft als Minimum', () => {
  test('Obergrenze = niedrigste Stufe aus °KMW und Zukäufen', () => {
    assert.equal(w.pressungObergrenze('spaetlese', ['qualitaetswein']), 'qualitaetswein')
    assert.equal(w.pressungObergrenze('kabinett', ['auslese']), 'kabinett')
    assert.equal(w.pressungObergrenze('eiswein', ['eiswein']), 'eiswein')
    assert.equal(w.pressungObergrenze('kabinett', [null, undefined]), 'kabinett')   // Altbestand ohne Stufe zählt nicht
    assert.equal(w.pressungObergrenze('kabinett', []), 'kabinett')
  })
  test('Abstufungsprüfung mit Zukauf-Obergrenze: höher abgelehnt, Auswahl nur bis zur Obergrenze', () => {
    const grenze = w.pressungObergrenze('spaetlese', ['landwein'])
    assert.equal(grenze, 'landwein')
    assert.match(abstufungFehler('kabinett', grenze), /nur Abstufen/)
    assert.equal(abstufungFehler('wein', grenze), null)
    assert.deepEqual(abstufungsOptionen(grenze).map(o => o.value), ['landwein', 'wein'])
  })
  test('Herkunft: gemeinsamer Oberbegriff aus Lese- und Zukauf-Codes', () => {
    assert.equal(minHerkunft(['kremstal_riedenwein', 'kamptal_gebietswein']), 'wlnoe')
    assert.equal(minHerkunft(['thermenregion_ortswein', 'steiermark']), 'wein')
    assert.equal(minHerkunft(['kamptal_ortswein', 'Neckenmarkt']), 'kamptal_ortswein')   // eigenes Gebiet zählt nicht
  })
})

describe('Server Actions (Quelltext)', () => {
  const A = quelle('src/app/(dashboard)/weinhandel/zukauf/actions.ts')
  const rumpf = (start, ende) => A.slice(A.indexOf(start), A.indexOf(ende))
  test('createZukaufCharge schreibt Qualitätsstufe und Herkunfts-Code an die Charge', () => {
    const fn = rumpf('async function createZukaufCharge', 'async function chargeAendern')
    assert.match(fn, /herkunftCode: string \| null,/)
    assert.match(fn, /herkunft_code: herkunftCode \?\? null/)
    assert.match(fn, /\.\.\.qualitaetsSpalten\(qualitaet\),\r?\n\s+land_iso: landIso,/)   // KAN-186: Stufe, Zusatz, Erzeugnis, Ursprungsland
  })
  test('alle Aufrufe von createZukaufCharge geben die Herkunft des Zukaufs mit', () => {
    const aufrufe = A.split('await createZukaufCharge(').slice(1)
    assert.equal(aufrufe.length, 2)   // KAN-193: createZukauf über die RPC (zukaufChargeSpalten → chargeStammdaten mit herkunft_code)
    for (const a of aufrufe) assert.match(a, /^[^)]*f\.qualitaet, f\.herkunft,/)   // KAN-186: ganze Angabe
  })
  test('chargeStammdaten und Rückbau führen herkunft_code mit', () => {
    assert.match(rumpf('function chargeStammdaten', 'async function pruefeWare'), /herkunft_code:\s+f\.herkunft \?\? null/)
    assert.match(A, /herkunft_code: c\.herkunft_code/)
    assert.match(A, /weinart, herkunft_code, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, kmw, oechsle, mostgewicht_einheit'\)/)
  })
  test('pruefeWare prüft Pflicht und Herkunft gegen die eigenen Weinbaugebiete', () => {
    const fn = rumpf('async function pruefeWare', 'export async function createZukauf')
    assert.match(fn, /from\('weinbaugebiete_custom'\)/)
    assert.match(fn, /\.eq\('tenant_id', tenantId\)/)
    assert.match(fn, /zukaufWareFehler\(/)
    assert.match(fn, /jahrgang:\s+f\.jahrgangEingabe/)
    assert.match(fn, /if \(fehler\) throw new AktionsFehler\(fehler\)/)
  })
  test('createZukauf und updateZukauf prüfen die Ware vor dem ersten Schreibzugriff', () => {
    for (const [start, ende] of [['export async function createZukauf', 'export async function updateZukauf'], ['export async function updateZukauf', 'export async function deleteZukauf']]) {
      const fn = rumpf(start, ende)
      const pruefung = fn.indexOf('await pruefeWare(supabase, tenantId, f)')
      const schreiben = Math.min(...['.insert(', '.update(', 'createZukaufCharge(', 'chargeAendern(', 'bereinigCharge(', "'s112_zukauf_buchen'"].map(s => fn.indexOf(s)).filter(i => i >= 0))
      assert.ok(pruefung > 0 && pruefung < schreiben, start)
    }
  })
  test('Qualitätsstufe: Wein/Most gegen die Chargen-Liste, Trauben und Maische (KAN-41) gegen die Liste der Lese', () => {
    const fn = rumpf('function parseZukaufFormData', 'type ZukaufFormular')
    assert.match(fn, /if \(qualitaetUnzulaessig && !istTraubenArt\(art\)\) throw/)
    assert.match(fn, /if \(traubenQualitaetUnzulaessig && istTraubenArt\(art\)\) throw/)
  })
})

describe('Pressung (Quelltext)', () => {
  const E = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  const P = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
  test('Zukauf-Trauben: Stufe und Herkunft werden geladen', () => {
    assert.match(E, /\.select\('id, art, datum, qualitaetsstufe, herkunft'\)\.in\('id', zukaufIds\)/)   // KAN-41: mit Art (Trauben/Maische)
  })
  test('Abstufungsprüfung nutzt die Obergrenze samt Zukauf-Stufen', () => {
    // KAN-81: die Obergrenze steht in pressungGrenze (KMW bzw. Eiswein-Lese, Lese-Stufen, Zukauf-Stufen)
    assert.match(E, /const pressungGrenze = pressungObergrenze\(leseStufe\(/)
    assert.match(E, /\[leseGrenze, \.\.\.weingaerten\.map\(w => w\.zukauf_posten_id \? zukaufWare\.get\(w\.zukauf_posten_id\)\?\.qualitaetsstufe : null\)\]\)/)
    assert.match(E, /abstufungFehler\(qualitaetsstufeInput, pressungGrenze\)/)
  })
  test('Vorgaben der neuen Charge: Qualität als Minimum, Herkunft über Lese- und Zukauf-Codes', () => {
    const start = E.indexOf('async function chargenVorgabenErmitteln')
    const fn = E.slice(start, E.indexOf('\n}\n', start))
    assert.match(fn, /const qualitaet = pressungObergrenze\(/)
    assert.match(fn, /if \(w\.zukauf_posten_id\) return zukaufZeilen\[i\]\?\.herkunft \?\? null/)
    assert.match(fn, /herkunft = minHerkunft\(passendeCodes\)/)
    assert.match(E, /qualitaetsstufeInput \?\? pressungGrenze \}, zukaufWare\)/)
  })
  test('Vorschau im Pressungsformular begrenzt die Auswahl ebenso', () => {
    assert.match(P, /const obergrenze = pressungObergrenze\(obergrenzeAusKmw,/)
    assert.match(P, /zukaufTrauben\.find\(z => z\.id === r\.zukauf_posten_id\)\?\.qualitaetsstufe/)
    assert.match(P, /herkunftAnzeige\(z\.herkunft\)/)
  })
})

describe('Formulare (Quelltext)', () => {
  const NEU = quelle('src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx')
  const EDIT = quelle('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx')
  const EDIT_PAGE = quelle('src/app/(dashboard)/weinhandel/zukauf/[id]/edit/page.tsx')
  test('Herkunfts-Code über HerkunftCodeSelect wie am GST, kein Freitextfeld mehr', () => {
    for (const f of [NEU, EDIT]) {
      assert.match(f, /import HerkunftCodeSelect from '@\/components\/weinbaugebiete\/HerkunftCodeSelect'/)
      assert.match(f, /Herkunfts-Code \(BKI\) \*/)
      assert.match(f, /builtinOptions=\{HERKUNFT_OPTIONS\}/)
      assert.doesNotMatch(f, /aria-label="Herkunft"/)
      assert.match(f, /if \(!herkunft( && !merkmaleFest)?\) \{ setError\('Bitte den Herkunfts-Code \(BKI\) wählen\.'\); return \}/)   // KAN-351: bei festen Merkmalen gilt der gespeicherte Wert
    }
    assert.match(NEU, /ladeCustomWeinbaugebiete\(\)/)
    assert.match(EDIT_PAGE, /ladeCustomWeinbaugebiete\(\)/)
    assert.match(EDIT_PAGE, /herkunftVorbelegung\(z\.herkunft, customWeinbaugebiete\.map\(g => g\.name\)\)/)
  })
  test('alle Ware-Felder Pflicht, Prüfnummer optional', () => {
    for (const f of [NEU, EDIT]) {
      for (const label of ['Weinart \\*', 'Rebsorte\\(n\\) \\*', 'Jahrgang \\*', 'Qualitätsstufe \\*', 'Alkoholgehalt \\(%vol\\) \\*']) assert.match(f, new RegExp(label))
      assert.doesNotMatch(f, /aria-label="Staatl\. Prüfnummer"[^>]*required/)
      assert.doesNotMatch(f, /'unbekannt','Unbekannt'/)
      assert.match(f, /const qualitaetsListe = \(art: string\) => istTraubenArt\(art\) \? LESE_QUALITAETEN : QUALITAET_OPTS/)
      assert.match(f, /\{ value: 'maische', label: 'Maische' \}/)
    }
  })
})
