// KAN-173 (01.10.2026): Lagerbewegung je Mittel im laufenden Geschäftsjahr (Anfangsbestand | Zukäufe | Verbräuche |
// Saldo) in den Stammdaten-Tabellen – gerechnet in lagerKonto()/bmKonto() über jahresBewegung() (lib/behandlungen/lagerJahr.ts),
// Saldo = Bestand der Lagerkarte. Dazu Quelltextprüfungen: alle vier Stammdaten-Tabellen zeigen die Spalten, am Handy
// nur den Saldo.
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan173-lager-jahr.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const LAGER = path.join(SRC, 'app/(dashboard)/behandlungen/lager')

const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(spezifizierer, kontext, weiter) {
      if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
      let basis = null
      if (spezifizierer.startsWith('@/')) basis = path.join(SRC, spezifizierer.slice(2))
      else if (/^\.\.?\//.test(spezifizierer) && !path.extname(spezifizierer) && kontext.parentURL?.startsWith('file:')) {
        basis = path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer)
      }
      if (basis) {
        for (const kandidat of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts')]) {
          if (existsSync(kandidat)) return weiter(pathToFileURL(kandidat).href, kontext)
        }
      }
      return weiter(spezifizierer, kontext)
    },
  })
}

const lade = (datei) => import(pathToFileURL(path.join(SRC, datei)).href)
const lj = hooksMoeglich ? await lade('lib/behandlungen/lagerJahr.ts') : null
const bm = hooksMoeglich ? await lade('lib/behandlungen/betriebsmittel.ts') : null
const lv = hooksMoeglich ? await lade('lib/behandlungen/lagerVerbrauch.ts') : null
const opt = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node < 22.15)' }

describe('Jahressicht (KAN-173)', opt, () => {
  test('Vorjahre bilden den Anfangsbestand, Anfangsbestand-Buchungen im Jahr zählen dazu', () => {
    const j = lj.jahresBewegung(
      [
        { datum: '2025-03-01', menge: 100, typ: 'einkauf' },
        { datum: '2025-12-31', menge: -5, typ: 'korrektur' },
        { datum: '2026-01-01', menge: 20, typ: 'anfangsbestand' },
        { datum: '2026-04-01', menge: 50, typ: 'einkauf' },
        { datum: '2026-05-01', menge: 3, typ: 'korrektur' },
        { datum: '2026-06-01', menge: -2, typ: 'korrektur' },
      ],
      [{ datum: '2025-07-01', menge: 30 }, { datum: '2026-07-01', menge: 12.5 }],
      2026,
    )
    assert.deepEqual(j, { jahr: 2026, anfangsbestand: 85, zukauf: 53, verbrauch: 14.5, saldo: 123.5, korrekturPlus: 3, korrekturMinus: 2, anfangsbestandUnterjaehrig: 0 })
  })

  test('Nachtrag 02.10.2026: Inventurkorrekturen getrennt ausgewiesen, Vorjahre und Einkäufe nicht', () => {
    const j = lj.jahresBewegung(
      [
        { datum: '2025-12-31', menge: 7, typ: 'korrektur' },
        { datum: '2026-02-01', menge: 10, typ: 'einkauf' },
        { datum: '2026-03-01', menge: 1.25, typ: 'korrektur' },
        { datum: '2026-03-02', menge: 0.5, typ: 'korrektur' },
        { datum: '2026-04-01', menge: -0.75, typ: 'korrektur' },
      ],
      [{ datum: '2026-05-01', menge: 2 }],
      2026,
    )
    assert.equal(j.zukauf, 11.75)
    assert.equal(j.korrekturPlus, 1.75)
    assert.equal(j.verbrauch, 2.75)
    assert.equal(j.korrekturMinus, 0.75)
    assert.equal(j.saldo, 16)
  })

  // Nachtrag 02.10.2026 (Jörgen): unterjährige Anfangsbestände nur im Startjahr des Betriebs als Anfangsbestand
  const mitUnterjaehrigem = [
    { datum: '2025-03-01', menge: 40, typ: 'einkauf' },
    { datum: '2026-01-01', menge: 10, typ: 'anfangsbestand' },
    { datum: '2026-05-15', menge: 25, typ: 'anfangsbestand' },
    { datum: '2026-06-01', menge: 5, typ: 'einkauf' },
    { datum: '2026-06-02', menge: 2, typ: 'korrektur' },
  ]
  const verbrauch2026 = [{ datum: '2026-07-01', menge: 12 }]

  test('Nachtrag 02.10.2026: im Startjahr zählen unterjährige Anfangsbestände zum Anfangsbestand', () => {
    const j = lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026, 3, 2026)
    assert.deepEqual(j, { jahr: 2026, anfangsbestand: 75, zukauf: 7, verbrauch: 12, saldo: 70, korrekturPlus: 2, korrekturMinus: 0, anfangsbestandUnterjaehrig: 0 })
  })

  test('Nachtrag 02.10.2026: ohne bekanntes Startjahr bleibt es beim bisherigen Verhalten', () => {
    assert.deepEqual(lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026, 3, null), lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026, 3, 2026))
    assert.deepEqual(lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026), lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026, 3, 2026))
  })

  test('Nachtrag 02.10.2026: in einem Folgejahr zählen Anfangsbestände nach dem 1.1. als Zukauf, Saldo unverändert', () => {
    const start = lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026, 3, 2026)
    const j = lj.jahresBewegung(mitUnterjaehrigem, verbrauch2026, 2026, 3, 2025)
    // der Anfangsbestand mit Datum 1.1. bleibt Anfangsbestand, der vom 15.5. wird Zukauf
    assert.deepEqual(j, { jahr: 2026, anfangsbestand: 50, zukauf: 32, verbrauch: 12, saldo: 70, korrekturPlus: 2, korrekturMinus: 0, anfangsbestandUnterjaehrig: 25 })
    assert.equal(j.saldo, start.saldo)
  })

  test('Nachtrag 02.10.2026: Anfangsbestände aus Vorjahren bleiben Teil des Anfangsbestands', () => {
    const j = lj.jahresBewegung([{ datum: '2025-08-01', menge: 30, typ: 'anfangsbestand' }], [], 2026, 3, 2025)
    assert.equal(j.anfangsbestand, 30)
    assert.equal(j.zukauf, 0)
    assert.equal(j.anfangsbestandUnterjaehrig, 0)
  })

  test('Nachtrag 02.10.2026: lagerKonto und bmKonto reichen das Startjahr durch', () => {
    const k = lv.lagerKonto([{ datum: '2026-04-01', menge: 3, einheit: 'kg', typ: 'anfangsbestand' }], [], undefined, 2026, 2025)
    assert.equal(k.jahr.zukauf, 3)
    assert.equal(k.jahr.anfangsbestandUnterjaehrig, 3)
    assert.equal(k.jahr.saldo, k.bestand)
    const b = bm.bmKonto([{ datum: '2026-04-01', menge: 50, einheit: 'stk', storniert: false, typ: 'anfangsbestand' }], [], 'stk', 2026, 2026)
    assert.equal(b.jahr.anfangsbestand, 50)
    assert.equal(b.jahr.anfangsbestandUnterjaehrig, 0)
  })

  test('ohne Bewegungen alles 0', () => {
    assert.deepEqual(lj.jahresBewegung([], [], 2026), { jahr: 2026, anfangsbestand: 0, zukauf: 0, verbrauch: 0, saldo: 0, korrekturPlus: 0, korrekturMinus: 0, anfangsbestandUnterjaehrig: 0 })
  })

  test('lagerKonto: Saldo = Bestand, Buchungen in g in die Lager-Einheit kg umgerechnet', () => {
    const k = lv.lagerKonto(
      [
        { datum: '2025-05-01', menge: 10, einheit: 'kg', typ: 'einkauf' },
        { datum: '2026-03-01', menge: 2, einheit: 'kg', typ: 'einkauf' },
        { datum: '2026-03-02', menge: 500, einheit: 'g', typ: 'einkauf' },
      ],
      [
        { behandlungId: 'a', datum: '2025-06-01', menge: 4, einheit: 'kg', basis: null, warnung: null, kurz: 'a', art: 'Spritzung', ort: null },
        { behandlungId: 'b', datum: '2026-06-01', menge: 1.5, einheit: 'kg', basis: null, warnung: null, kurz: 'b', art: 'Spritzung', ort: null },
      ],
      undefined,
      2026,
    )
    assert.equal(k.einheit, 'kg')
    assert.deepEqual(k.jahr, { jahr: 2026, anfangsbestand: 6, zukauf: 2.5, verbrauch: 1.5, saldo: 7, korrekturPlus: 0, korrekturMinus: 0, anfangsbestandUnterjaehrig: 0 })
    assert.equal(k.jahr.saldo, k.bestand)
  })

  test('lagerKonto ohne Jahr bleibt wie bisher (keine Jahressicht)', () => {
    const k = lv.lagerKonto([{ datum: '2026-01-02', menge: 1, einheit: 'kg' }], [])
    assert.equal(k.jahr, undefined)
    assert.equal(k.bestand, 1)
  })

  test('bmKonto: stornierte Buchungen zählen nicht, Saldo = Bestand', () => {
    const k = bm.bmKonto(
      [
        { datum: '2026-01-05', menge: 100, einheit: 'stk', storniert: false, typ: 'anfangsbestand' },
        { datum: '2026-02-01', menge: 500, einheit: 'stk', storniert: false, typ: 'einkauf' },
        { datum: '2026-02-02', menge: 300, einheit: 'stk', storniert: true, typ: 'einkauf' },
        { datum: '2026-09-20', menge: -10, einheit: 'stk', storniert: false, typ: 'korrektur' },
      ],
      [{ behandlungId: 'l', datum: '2026-07-01', kurz: 'Laubarbeit', art: 'Laubarbeit', ort: null, aufwand: 200, aufwandEinheit: 'stk_ha', flaecheHa: 0.5 }],
      'stk',
      2026,
    )
    assert.deepEqual(k.jahr, { jahr: 2026, anfangsbestand: 100, zukauf: 500, verbrauch: 110, saldo: 490, korrekturPlus: 0, korrekturMinus: 10, anfangsbestandUnterjaehrig: 0 })
    assert.equal(k.jahr.saldo, k.bestand)
  })
})

describe('Stammdaten-Tabellen zeigen die Jahressicht (KAN-173)', () => {
  const quelle = (d) => readFileSync(path.join(LAGER, d), 'utf8')
  for (const d of ['PSMClient.tsx', 'DuengemittelClient.tsx', 'BetriebsmittelStammClient.tsx']) {
    test(`${d}: Kopf, Zellen und Fußnote`, () => {
      const s = quelle(d)
      assert.match(s, /<LagerJahrKopf jahr=\{jahr\}/)
      assert.match(s, /<LagerJahrZellen lager=\{\w+\.lager\}/)
      assert.match(s, /<LagerJahrHinweis jahr=\{jahr\} \/>/)
    })
  }

  test('Spalten: am Handy nur Saldo (Anfangsbestand/Zukäufe/Verbräuche erst ab md)', () => {
    const s = quelle('LagerJahrSpalten.tsx')
    assert.match(s, /const breit = 'hidden md:table-cell'/)
    for (const t of ['Anfangsbestand', 'Zukäufe', 'Verbräuche']) assert.match(s, new RegExp(`\\$\\{breit\\}[^>]*>${t}<`))
    assert.match(s, /<th className=\{klasse\} title="Aktueller Bestand">Saldo<\/th>/)
  })

  test('Nachtrag 02.10.2026: „davon Inventurkorrektur“ unter Zukäufen und Verbräuchen, nur wenn ≠ 0', () => {
    const s = quelle('LagerJahrSpalten.tsx')
    assert.match(s, /<DavonKorrektur menge=\{lager\.korrekturPlus\} vorzeichen="\+" \/>/)
    assert.match(s, /<DavonKorrektur menge=\{lager\.korrekturMinus\} vorzeichen="−" \/>/)
    assert.match(s, /if \(!menge\) return null/)
    assert.match(s, /davon Inventurkorrektur \{vorzeichen\}\{zahl\(menge\)\}/)
  })

  test('Nachtrag 02.10.2026: „davon Anfangsbestand“ unter Zukäufen, Fußnote erklärt die Regel', () => {
    const s = quelle('LagerJahrSpalten.tsx')
    assert.match(s, /<DavonAnfangsbestand menge=\{lager\.anfangsbestandUnterjaehrig\} \/>/)
    assert.match(s, /davon Anfangsbestand/)
    assert.match(s, /zählen\s+sonst als Zukauf/)
  })

  test('Nachtrag 02.10.2026: page.tsx lädt das Startjahr des Betriebs und reicht es durch', () => {
    const s = quelle('page.tsx')
    assert.match(s, /from\('tenants'\) as any\)\s*\.select\('created_at'\)\.eq\('id', tenantId\)/)
    assert.match(s, /verbrauchByPsm\.get\(id\) \?\? \[\], undefined, jahr, startJahr\)/)
    assert.match(s, /d\.einheit \?\? null, jahr, startJahr\)/)
    assert.match(s, /m\.einheit, jahr, startJahr\)/)
    assert.match(s, /<StartJahrRahmen startJahr=\{startJahr\}>/)
  })

  test('Nachtrag 02.10.2026: Buchungsformulare zeigen den Hinweis bei unterjährigem Anfangsbestand (ohne Sperre)', () => {
    for (const d of ['LagerClient.tsx', 'DuengerLagerClient.tsx', 'BetriebsmittelLagerClient.tsx']) {
      assert.match(quelle(d), /<AnfangsbestandHinweis typ=\{typ\} datum=\{datum\} \/>/, d)
    }
    const s = quelle('AnfangsbestandHinweis.tsx')
    assert.match(s, /Number\(datum\.slice\(0, 4\)\) > startJahr && datum\.slice\(5, 10\) !== '01-01'/)
    assert.match(s, /Unterjährig bitte als Einkauf\/Zukauf buchen/)
  })

  test('page.tsx rechnet mit lagerKonto/bmKonto und dem Jahr und lädt den Verbrauch auch für die Stammdaten-Tabs', () => {
    const s = quelle('page.tsx')
    assert.match(s, /const jahr = wienJetzt\(\)\.getFullYear\(\)/)
    assert.match(s, /verbrauchByPsm\.get\(id\) \?\? \[\], undefined, jahr(, startJahr)?\)/)
    assert.match(s, /d\.einheit \?\? null, jahr(, startJahr)?\)/)
    assert.match(s, /bmVerbrauch\.get\(m\.id\) \?\? \[\], m\.einheit, jahr(, startJahr)?\)/)
    assert.match(s, /const brauchtPsm = zeigtBestand \|\| tab === 'stammdaten'/)
    assert.match(s, /const brauchtDuenger = zeigtBestand \|\| tab === 'duengemittel'/)
    assert.match(s, /rawBmVerbrauch \} = brauchtBm/)
  })
})
