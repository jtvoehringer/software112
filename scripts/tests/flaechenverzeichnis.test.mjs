// Tests Gruppe „Flächen“: Flächenverzeichnis (Rieden & Grundstücke) und der Listen-Wrapper
// lib/utils/csv.ts (Reports, Keller-Auswertungen, Import-Duplikate, KI) – ohne Datenbank.
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//            --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/flaechenverzeichnis.test.mjs
//          (bzw. alle Testdateien: … --test scripts/tests/)
//
// Die geprüften Module importieren über den Alias '@/…' und ohne Dateiendung. Ein kleiner
// Resolve-Hook (node:module registerHooks, Node ≥ 22.15) bildet das auf src/ ab – keine
// zusätzliche Abhängigkeit. Die Ladefunktion selbst (lib/behoerden/flaechenverzeichnis.ts,
// Datenbank + 'server-only') wird hier nicht geladen, nur die rechnende Hälfte.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const SRC = path.join(ROOT, 'src')
const BOM = String.fromCharCode(0xfeff)

function datei(basis) {
  for (const k of [basis, `${basis}.ts`, `${basis}.tsx`, path.join(basis, 'index.ts')]) {
    if (existsSync(k) && statSync(k).isFile()) return pathToFileURL(k).href
  }
  return null
}

const HOOKS = typeof nodeModule.registerHooks === 'function'
if (HOOKS) {
  nodeModule.registerHooks({
    resolve(spec, ctx, weiter) {
      if (spec.startsWith('@/')) {
        const url = datei(path.join(SRC, spec.slice(2)))
        if (url) return weiter(url, ctx)
      }
      if ((spec.startsWith('./') || spec.startsWith('../')) && !path.extname(spec) && ctx.parentURL?.startsWith('file:')) {
        const url = datei(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec))
        if (url) return weiter(url, ctx)
      }
      return weiter(spec, ctx)
    },
  })
}

const OHNE_HOOKS = HOOKS ? false : 'node:module registerHooks fehlt (Node ≥ 22.15 nötig)'

const zeilenMod = HOOKS ? await import('../../src/lib/behoerden/flaechenverzeichnis-zeilen.ts') : null
const csvMod = HOOKS ? await import('../../src/lib/csv/index.ts') : null
const utilsMod = HOOKS ? await import('../../src/lib/utils/csv.ts') : null
const katalogMod = HOOKS ? await import('../../src/lib/behoerden/katalog/flaechen.ts') : null

// ── Beispieldaten (realistisch, mit Randfällen) ───────────────────────────────

const ried = (x) => ({
  id: 'w?', name: 'Weingarten', ried: null, rebsorte: null, weinart: 'unbekannt', flaeche_ha: null,
  bewirtschaftung: null, aktiv: true, ama_feldnummer: null, codes: null, interne_bezeichnung: null,
  pflanzjahr: null, zentrum_lat: null, zentrum_lon: null, ...x,
})
const gst = (x) => ({
  id: 'g?', weingarten_id: 'w1', gst_nr: '1', rebsorte: null, flaeche_ha: null, flaeche_ha_kataster: null,
  spritzbar: true, katastralgemeinde: null, kg_bezeichnung: null, einlagezahl: null, nutzart: 'WI',
  lse_stueckzahl: null, ama_feldnummer: null, pflanzjahr: null, unterlagsrebe: null, rechtsverhaeltnis: null,
  weinart: null, bewirtschaftung: null, ...x,
})

const WEINGAERTEN = [
  ried({ id: 'w1', name: 'Kirchberg Nord', ried: 'Kirchberg', ama_feldnummer: '12', codes: 'EOP', interne_bezeichnung: 'Hausweingarten', bewirtschaftung: 'konventionell' }),
  ried({ id: 'w2', name: 'Alte Parzelle', ried: '=HYPERLINK("http://x")', aktiv: false, rebsorte: 'Zweigelt', weinart: 'rot', flaeche_ha: 1234.5, pflanzjahr: 1998 }),
  ried({ id: 'w3', name: 'Brunnfeld', ried: 'Brunnfeld', aktiv: true }),
]
const GRUNDSTUECKE = [
  // absichtlich unsortiert: 10 kommt nach 9 (numerisch)
  gst({ id: 'g2', weingarten_id: 'w1', gst_nr: '10', katastralgemeinde: '04023', kg_bezeichnung: null, rebsorte: 'Grüner Veltliner', weinart: 'weiss', flaeche_ha: 0.12345, flaeche_ha_kataster: 0.1234, pflanzjahr: 2004, unterlagsrebe: 'Kober 5BB', rechtsverhaeltnis: 'pacht', einlagezahl: '0815', ama_feldnummer: '3' }),
  gst({ id: 'g1', weingarten_id: 'w1', gst_nr: '9', katastralgemeinde: '12105', kg_bezeichnung: 'Meine KG', rebsorte: 'Rotgipfler', weinart: 'unbekannt', bewirtschaftung: 'biodynamisch', flaeche_ha: 1.005, rechtsverhaeltnis: 'eigentum' }),
  gst({ id: 'g3', weingarten_id: 'w3', gst_nr: '77/2', katastralgemeinde: null, nutzart: 'LSE', lse_stueckzahl: 5, flaeche_ha: 0.01 }),
  gst({ id: 'g4', weingarten_id: 'w3', gst_nr: '78', katastralgemeinde: '12105', nutzart: 'A', lse_stueckzahl: 9, rebsorte: 'Fantasiesorte' }),
  // Grundstück ohne sichtbaren Weingarten-Datensatz
  gst({ id: 'g5', weingarten_id: 'wX', gst_nr: '500', katastralgemeinde: '12105', flaeche_ha: 0.5 }),
]
const NUTZUNG = { WI: 'Wein', A: 'Grünbrache', LSE: 'LSE Bäume / Büsche' }
const nutzungLabel = n => NUTZUNG[n] ?? null

// ── Flächenverzeichnis: Zeilen ────────────────────────────────────────────────

describe('Flächenverzeichnis – Zeilen (flaechenZeilen)', { skip: OHNE_HOOKS }, () => {
  test('eine Zeile je Grundstück, GST-Nr. numerisch sortiert, Weingarten ohne GST mit eigener Zeile, Waisen am Ende', () => {
    const { zeilen } = zeilenMod.flaechenZeilen(WEINGAERTEN, GRUNDSTUECKE, nutzungLabel)
    assert.deepEqual(zeilen.map(z => [z.ried, z.gstNr]), [
      ['Kirchberg', '9'], ['Kirchberg', '10'],
      ['=HYPERLINK("http://x")', null],
      ['Brunnfeld', '77/2'], ['Brunnfeld', '78'],
      [null, '500'],
    ])
  })

  test('Werte je Grundstück mit Rückfall auf den Weingarten (Weinart, Bewirtschaftung)', () => {
    const { zeilen } = zeilenMod.flaechenZeilen(WEINGAERTEN, GRUNDSTUECKE, nutzungLabel)
    const [g9, g10, w2, lse, brache, waise] = zeilen
    // GST 9: KG-Name aus der Spalte, Weinart unbekannt → Weingarten (unbekannt) → leer, eigene Bewirtschaftung
    assert.equal(g9.katastralgemeinde, 'Meine KG')
    assert.equal(g9.weinart, null)
    assert.equal(g9.bewirtschaftung, 'biodynamisch')
    assert.equal(g9.rechtsverhaeltnis, 'Eigentum')
    assert.equal(g9.flaecheAmaHa, 1.005)
    // GST 10: KG-Name aus der Katastralgemeinden-Liste, Weinart vom Grundstück, Bewirtschaftung vom Weingarten
    assert.equal(g10.kgNr, '04023')
    assert.equal(typeof g10.katastralgemeinde, 'string')
    assert.ok(g10.katastralgemeinde.length > 0, 'KG-Bezeichnung aus lib/wein/katastralgemeinden')
    assert.equal(g10.weinart, 'Weiß')
    assert.equal(g10.bewirtschaftung, 'konventionell')
    assert.equal(g10.kuerzel, 'GV')
    assert.equal(g10.einlagezahl, '0815')
    assert.equal(g10.amaSchlag, '3')
    assert.equal(g10.amaFeldstueck, '12')
    assert.equal(g10.codes, 'EOP')
    assert.equal(g10.interneBezeichnung, 'Hausweingarten')
    assert.equal(g10.pflanzjahr, 2004)
    assert.equal(g10.unterlagsrebe, 'Kober 5BB')
    assert.equal(g10.rechtsverhaeltnis, 'Pacht')
    assert.equal(g10.flaecheAmaHa, 0.1235, 'kaufmännisch auf 4 Stellen gerundet')
    assert.equal(g10.flaecheKatasterHa, 0.1234)
    assert.equal(g10.nutzung, 'Wein')
    assert.equal(g10.aktiv, true)
    // Weingarten ohne Grundstück: Felder der Ried-Ebene, GST-Spalten leer, Fläche lt. AMA vom Weingarten
    assert.equal(w2.rebsorte, 'Zweigelt')
    assert.equal(w2.weinart, 'Rot')
    assert.equal(w2.flaecheAmaHa, 1234.5)
    assert.equal(w2.flaecheKatasterHa, null)
    assert.equal(w2.kgNr, null)
    assert.equal(w2.pflanzjahr, 1998)
    assert.equal(w2.aktiv, false)
    // LSE-Stückzahl nur bei Nutzart LSE
    assert.equal(lse.lseStueck, 5)
    assert.equal(lse.nutzung, 'LSE Bäume / Büsche')
    assert.equal(brache.lseStueck, null)
    // Waise: ohne Ried-Angaben, Aktiv leer
    assert.equal(waise.ried, null)
    assert.equal(waise.aktiv, null)
  })

  test('Hinweise: Waisen, fehlende KG-Nr. (nur aktive), Rebsorten ohne amtliches Kürzel', () => {
    const { warnungen } = zeilenMod.flaechenZeilen(WEINGAERTEN, GRUNDSTUECKE, nutzungLabel)
    assert.equal(warnungen.length, 3)
    assert.match(warnungen[0], /^1 Grundstück ist keiner Ried zugeordnet .*GST 500/)
    assert.match(warnungen[1], /^1 aktive Grundstück ohne KG-Nr\..*GST 77\/2 \(Brunnfeld\)/)
    assert.match(warnungen[2], /Kein amtliches BKI-Kürzel für die Rebsorte Fantasiesorte/)
  })

  test('keine Daten → keine Zeilen, keine Hinweise (Leermeldung = nur Kopfzeile)', () => {
    const r = zeilenMod.flaechenZeilen([], [], nutzungLabel)
    assert.deepEqual(r, { zeilen: [], warnungen: [] })
    const t = csvMod.csvText(r.zeilen, zeilenMod.SPALTEN_FLAECHENVERZEICHNIS)
    assert.equal(t.split('\r\n').length, 2)
    assert.ok(t.startsWith(BOM + 'Ried / Lage;'))
    assert.ok(t.endsWith('Aktiv\r\n'))
  })
})

// ── Flächenverzeichnis: CSV ───────────────────────────────────────────────────

describe('Flächenverzeichnis – CSV (PROFIL_EXCEL_AT)', { skip: OHNE_HOOKS }, () => {
  const KOPF = 'Ried / Lage;Interne Bezeichnung;AMA-Feldstücknr.;Codes;KG-Nr.;Katastralgemeinde;GST-Nr;Einlagezahl (EZ);AMA-Schlagnr.;Rebsorte;BKI-Kürzel;Nutzart;Nutzung;LSE (Stk.);Weinart;Bewirtschaftung;Pflanzjahr;Unterlagsrebe;Rechtsverhältnis;GST-Fläche lt. Kataster (ha);GST-Fläche lt. AMA (ha);Aktiv'

  test('Kopfzeile, Hektar mit 4 Stellen ohne Tausenderpunkt, Codes unverändert, Formelschutz, CRLF', () => {
    const { zeilen } = zeilenMod.flaechenZeilen(WEINGAERTEN, GRUNDSTUECKE, nutzungLabel)
    const r = csvMod.csvDatei(zeilen, zeilenMod.SPALTEN_FLAECHENVERZEICHNIS)
    assert.deepEqual(r.warnungen, [])
    assert.equal(r.zeilen, 6)
    const linien = r.text.split('\r\n')
    assert.equal(linien[0], BOM + KOPF)
    assert.equal(linien.at(-1), '', 'CRLF auch nach der letzten Zeile')
    assert.equal(linien[1], 'Kirchberg;Hausweingarten;12;EOP;12105;Meine KG;9;;;Rotgipfler;RG;WI;Wein;;;biodynamisch;;;Eigentum;;1,0050;Ja')
    assert.ok(linien[2].startsWith('Kirchberg;Hausweingarten;12;EOP;04023;'), 'KG-Nr. mit führender Null bleibt')
    assert.ok(linien[2].endsWith(';10;0815;3;Grüner Veltliner;GV;WI;Wein;;Weiß;konventionell;2004;Kober 5BB;Pacht;0,1234;0,1235;Ja'))
    // Ried beginnt mit „=“ → Apostroph; enthält " → gequotet; 1234,5 ha ohne Tausenderpunkt
    assert.equal(linien[3], `"'=HYPERLINK(""http://x"")";;;;;;;;;Zweigelt;ZW;;;;Rot;;1998;;;;1234,5000;Nein`)
    assert.ok(linien[4].includes(';77/2;;;;;LSE;LSE Bäume / Büsche;5;;;;;;;0,0100;Ja'))
    assert.ok(linien[6].startsWith(';;;;12105;'))
    assert.ok(linien[6].endsWith(';500;;;;;WI;Wein;;;;;;;;0,5000;'), 'Waise: Aktiv leer')
  })

  test('Dateiname nach Muster, Umlaut nur in der UTF-8-Fassung', () => {
    const n = csvMod.csvDateiname(['Flächenverzeichnis', '1234567'], '2026-09-24')
    assert.deepEqual(n, { utf8: 'Flächenverzeichnis_1234567_2026-09-24.csv', ascii: 'Flaechenverzeichnis_1234567_2026-09-24.csv' })
    assert.equal(csvMod.csvDateiname(['Flächenverzeichnis', null], '2026-09-24').ascii, 'Flaechenverzeichnis_2026-09-24.csv')
  })

  test('Katalog: id, Gruppe, Zugriff, Druckpfad; Seite trägt Marker und Knopf', () => {
    const e = katalogMod.KATALOG_FLAECHEN.flaechenverzeichnis
    assert.equal(e.id, 'flaechenverzeichnis')
    assert.equal(e.gruppe, 'flaechen')
    assert.equal(e.zugriff, 'mitglied')
    assert.equal(e.druckPfad, '/weingarten')
    const seite = readFileSync(path.join(SRC, 'app', '(dashboard)', 'weingarten', 'page.tsx'), 'utf8')
    assert.equal(seite.split(/\r?\n/)[0], '// behoerdenmeldung: flaechenverzeichnis')
    assert.ok(seite.includes("<CsvExportKnopf href={csvPfad('flaechenverzeichnis')} />"))
    assert.ok(seite.includes('ladeRiedenStammdaten('), 'Seite nutzt dieselbe Ladefunktion wie die CSV')
    const register = readFileSync(path.join(SRC, 'lib', 'behoerden', 'register', 'flaechen.ts'), 'utf8')
    assert.ok(register.includes('ladeFlaechenverzeichnis(ctx.supabase, ctx.tenantId)'))
  })
})

// ── lib/utils/csv.ts – Wrapper für Listen-Exporte ─────────────────────────────

describe('lib/utils/csv.ts – Wrapper auf csvText (EXCEL_AT)', { skip: OHNE_HOOKS }, () => {
  test('Semikolon, CRLF inkl. Abschluss, BOM, Kopfzeile auch ohne Zeilen', () => {
    assert.equal(utilsMod.toCSV([], [{ key: 'a', header: 'Behälter' }, { key: 'b', header: 'Inhalt (L)' }]), `${BOM}Behälter;Inhalt (L)\r\n`)
    const t = utilsMod.toCSV([{ a: 'Tank 1; groß', b: 1 }], [{ key: 'a', header: 'Behälter' }, { key: 'b', header: 'Inhalt (L)' }])
    assert.equal(t, `${BOM}Behälter;Inhalt (L)\r\n"Tank 1; groß";1\r\n`)
  })

  test('Typ je Spalte aus den Werten erkannt (Altaufrufer ohne typ, z. B. Keller-Auswertungen)', () => {
    const zeilen = [
      { name: 'Tank 1', kap: 1000, inhalt: 0.1 + 0.2, pct: '12,3', datum: '5.3.2026', iso: '2026-03-05', bio: true, leer: null },
      { name: '-Rest', kap: '', inhalt: 750, pct: '', datum: '', iso: null, bio: false, leer: '' },
    ]
    const sp = ['name', 'kap', 'inhalt', 'pct', 'datum', 'iso', 'bio', 'leer'].map(k => ({ key: k, header: k }))
    assert.deepEqual(utilsMod.csvSpalten(zeilen, sp).map(s => [s.typ, s.stellen]), [
      ['text', undefined], ['ganzzahl', undefined], ['dezimal', 1], ['text', undefined],   // Stellen aus den Werten (0,1 + 0,2 → 1)
      ['text', undefined], ['datum', undefined], ['janein', undefined], ['text', undefined],
    ])
    const linien = utilsMod.toCSV(zeilen, sp).split('\r\n')
    assert.equal(linien[1], 'Tank 1;1000;0,3;12,3;5.3.2026;05.03.2026;Ja;')
    assert.equal(linien[2], "'-Rest;;750,0;;;;Nein;")
  })

  test('erkannte Dezimalspalten runden nicht stumm (KI-Export: Fläche 0,1234 ha)', () => {
    const sp = [{ key: 'ha', header: 'flaeche_ha' }, { key: 'x', header: 'x' }]
    const t = utilsMod.toCSV([{ ha: 0.1234, x: 1.5 }, { ha: 2, x: 0.1234567891 }], sp).split('\r\n')
    assert.equal(t[1], '0,1234;1,500000')
    assert.equal(t[2], '2,0000;0,123457')                                    // höchstens 6 Stellen
    assert.equal(utilsMod.noetigeStellen(0.1 + 0.2), 1)
  })

  test('ausdrücklicher typ/stellen gewinnt; Zeitpunkte in Wiener Zeit; Formelschutz bei Text', () => {
    const t = utilsMod.toCSV(
      [{ b: 12.345, d: '2026-06-30T22:15:00Z', x: '=SUMME(A1:A3)', z: '-12.5' }],
      [{ key: 'b', header: 'Betrag (€)', typ: 'betrag' }, { key: 'd', header: 'Zeitpunkt' }, { key: 'x', header: 'Notiz' }, { key: 'z', header: 'Zahl', typ: 'dezimal', stellen: 1 }],
    )
    assert.equal(t.split('\r\n')[1], "12,35;01.07.2026 00:15;'=SUMME(A1:A3);-12,5")
  })

  test('kein BOM-Zeichen und kein eigener Serializer mehr im Quelltext', () => {
    const quelle = readFileSync(path.join(SRC, 'lib', 'utils', 'csv.ts'), 'utf8')
    assert.ok(!quelle.includes(BOM), 'BOM nur über csvText (lib/csv) – nie als Zeichen im Quelltext')
    assert.ok(!/join\(['"],['"]\)/.test(quelle), 'kein Komma-Serializer')
    assert.ok(quelle.includes('csvText('))
  })
})
