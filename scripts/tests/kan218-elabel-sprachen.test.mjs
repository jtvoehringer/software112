// KAN-218 (08.10.2026): E-Label in allen 24 EU-Amtssprachen – Begriffe aus den amtlichen Verordnungstexten
// (uebersetzungen.ts), vollständig für jeden Katalogeintrag, Sprachwahl nach ?lang= bzw. Browsersprache, Zahlenformat.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sp = hooksMoeglich ? await laden('lib/elabel/sprachen.ts') : null
const ue = hooksMoeglich ? await laden('lib/elabel/uebersetzungen.ts') : null
const tx = hooksMoeglich ? await laden('lib/elabel/texte.ts') : null
const oe = hooksMoeglich ? await laden('lib/elabel/oeffentlich.ts') : null

// Englische Namen des globalen Katalogs elabel_zutaten (Produktion, Stand 08.10.2026) – neuer Eintrag → hier und in
// uebersetzungen.ts ergänzen
const KATALOG_EN = [
  'Egg (egg white)', 'Egg protein', 'Milk (casein)', 'Milk protein', 'Tirage liqueur', 'Expedition liqueur', 'Argon',
  'Nitrogen', 'Carbon dioxide', 'Bottled in a protective atmosphere', 'Sulphites', 'Potassium metabisulphite',
  'Sorbic acid', 'Potassium sorbate', 'Ascorbic acid', 'Lysozyme (from egg)', 'Tartaric acid', 'Malic acid',
  'Lactic acid', 'Potassium hydrogen tartrate', 'Calcium carbonate', 'Potassium hydrogen carbonate', 'Metatartaric acid',
  'Gum arabic', 'Carboxymethylcellulose', 'Potassium polyaspartate', 'Citric acid', 'Yeast mannoproteins', 'Grapes',
  'Sucrose', 'Rectified concentrated grape must', 'Concentrated grape must',
]
const KATEGORIEN = ['zutat', 'saeureregulator', 'konservierung', 'stabilisator', 'gas', 'dosage', 'allergen_hilfsstoff']
const ALLERGENE = ['sulfite', 'ei', 'milch']
const TEXTSCHLUESSEL = ['titel', 'zutaten', 'naehrwerte', 'je100', 'energie', 'fett', 'gesaettigt', 'kohlenhydrate', 'zucker',
  'eiweiss', 'salz', 'alkohol', 'enthaelt', 'geringfuegig', 'allergenHinweis', 'nichtGefunden', 'sprache']

describe('KAN-218: E-Label in allen EU-Amtssprachen', nurMitHooks, () => {
  test('24 Amtssprachen, 22 davon in uebersetzungen.ts', () => {
    assert.equal(sp.ELABEL_SPRACHEN.length, 24)
    const fremd = sp.ELABEL_SPRACHEN.filter(s => s !== 'de' && s !== 'en')
    assert.deepEqual(Object.keys(ue.UEBERSETZUNGEN).sort(), [...fremd].sort())
  })

  test('jede Sprache vollständig: Kategorien, Allergene, jeder Katalogeintrag, alle Seitentexte – nicht leer', () => {
    for (const [s, u] of Object.entries(ue.UEBERSETZUNGEN)) {
      for (const k of KATEGORIEN) assert.ok(u.kategorien[k]?.trim(), `${s}: Kategorie ${k}`)
      for (const a of ALLERGENE) assert.ok(u.allergene[a]?.trim(), `${s}: Allergen ${a}`)
      for (const z of KATALOG_EN) assert.ok(u.zutaten[z]?.trim(), `${s}: Zutat ${z}`)
      for (const t of TEXTSCHLUESSEL) assert.ok(u.texte[t]?.trim(), `${s}: Text ${t}`)
      assert.ok(u.quellen.length > 0, `${s}: Fundstellen`)
      // nichtAmtlich nennt nur vorhandene Schlüssel
      for (const n of u.nichtAmtlich) {
        const [bereich, ...rest] = n.split('.')
        assert.ok(rest.length > 0 && u[bereich] && rest.join('.') in u[bereich], `${s}: nichtAmtlich ${n}`)
      }
      // keine bloße Kopie des Englischen bei sprachlichen Begriffen (Argon, Carboxymethylcellulose u. Ä. dürfen gleich sein)
      assert.notEqual(u.texte.zutaten, 'List of ingredients', `${s}: Überschrift Zutatenliste übersetzt`)
      assert.notEqual(u.allergene.sulfite, 'Sulphites', `${s}: Sulfite übersetzt`)
    }
  })

  test('Zugriff: Deutsch/Englisch aus Katalog und TEXTE, sonst Übersetzung, fehlender Begriff englisch', () => {
    const k = { name_de: 'Weinsäure', name_en: 'Tartaric acid' }
    assert.equal(tx.zutatName(k, 'de'), 'Weinsäure')
    assert.equal(tx.zutatName(k, 'en'), 'Tartaric acid')
    assert.equal(tx.zutatName(k, 'fr'), ue.UEBERSETZUNGEN.fr.zutaten['Tartaric acid'])
    assert.equal(tx.zutatName({ name_de: 'Neu', name_en: 'Something new' }, 'fr'), 'Something new')
    assert.equal(tx.kategorieText('saeureregulator', 'de'), 'Säureregulatoren')
    assert.equal(tx.allergenText('sulfite', 'it'), ue.UEBERSETZUNGEN.it.allergene.sulfite)
    assert.equal(tx.sprachName('de'), 'Deutsch')
    assert.equal(tx.sprachName('en'), 'English')
    assert.equal(tx.seitenTexte('pl').energie, ue.UEBERSETZUNGEN.pl.texte.energie)
  })

  test('Sprachwahl: ?lang vor Browsersprache, erste EU-Sprache des Browsers, sonst Englisch bzw. ohne Angabe Deutsch', () => {
    assert.equal(oe.elabelSprache('fr', 'de-AT'), 'fr')
    assert.equal(oe.elabelSprache('FR', null), 'fr')
    assert.equal(oe.elabelSprache('xx', 'it-IT,it;q=0.9'), 'it')
    assert.equal(oe.elabelSprache(null, 'ja-JP,ja;q=0.9,nl;q=0.5'), 'nl')
    assert.equal(oe.elabelSprache(null, 'ja-JP,ja;q=0.9'), 'en')
    assert.equal(oe.elabelSprache(null, ''), 'de')
    assert.equal(oe.elabelSprache(null, 'sv-SE'), 'sv')
  })

  test('„Enthält geringfügige Mengen“: Aufzählung an der Leerstelle bzw. dahinter', () => {
    assert.equal(oe.geringfuegigSatz('Enthält geringfügige Mengen von', 'Fett, Salz'), 'Enthält geringfügige Mengen von Fett, Salz.')
    assert.equal(oe.geringfuegigSatz(ue.UEBERSETZUNGEN.lt.texte.geringfuegig, 'riebalai'), 'Sudėtyje yra labai mažas riebalai kiekis.')
    for (const s of ['lt', 'ga', 'hu']) assert.ok(ue.UEBERSETZUNGEN[s].texte.geringfuegig.includes('…'), s)
    assert.match(quelle('src/app/e/[code]/page.tsx'), /geringfuegigSatz\(T\.geringfuegig, gering\.map/)
  })

  test('Zahlenformat je Sprache', () => {
    assert.equal(oe.zahlText(12.5, 1, 'de'), '12,5')
    assert.equal(oe.zahlText(12.5, 1, 'en'), '12.5')
    assert.equal(oe.zahlText(12.5, 1, 'fr'), '12,5')
  })
})

describe('KAN-218: Verdrahtung', () => {
  test('Seite: Texte und Begriffe über texte.ts, Umschalter mit allen Sprachen', () => {
    const p = quelle('src/app/e/[code]/page.tsx')
    assert.match(p, /const T = seitenTexte\(sprache\)/)
    assert.match(p, /ELABEL_SPRACHLISTE\.map\(s =>/)
    assert.match(p, /zutatName\(k, sprache\)/)
    assert.match(p, /kategorieText\(g\.kategorie, sprache\)/)
    assert.match(p, /allergenText\(a, sprache\)/)
    assert.doesNotMatch(p, /TEXTE\[sprache\]|KATEGORIE_LABEL\[|ALLERGEN_LABEL\[/)
  })
})
