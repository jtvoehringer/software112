// KAN-133 Soll 10 (26.09.2026): Mengen einer Maßnahme prüfen und ergänzen – pruefeMassnahmeMengen()
// in src/lib/behandlungen/massnahmeMengen.ts (Server Actions, Assistent, Formulare).
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/massnahme-mengen.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; läuft auch über npm run test:csv)
//
// Resolve-Hook wie in pflanzenschutz.test.mjs: '@/'-Aliase und endungslose Importe → src/…/*.ts.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

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

const mm = hooksMoeglich ? await import(pathToFileURL(path.join(SRC, 'lib/behandlungen/massnahmeMengen.ts')).href) : null
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

/** Funguran Progress 0,6 kg/ha auf 2 ha, 400 l/ha, Spritzbrühe 800 l */
const FUNGURAN = {
  art: 'spritzung', psmId: 'p-fu', psm: { cuGehaltPct: 35, wirkstoff: 'Kupferhydroxid', wirkstoffgehaltPct: 53.8 },
  aufwand: 0.6, aufwandEinheit: 'kg_ha', mengeGesamt: 800, mengeEinheit: 'l', wasserLHa: 400, flaecheHa: 2,
}
const spritzung = (teil = {}) => ({ ...FUNGURAN, ...teil })
const duengung = (teil = {}) => ({
  art: 'duengung', duengemittelId: 'd-1', duengemittelEinheit: 'kg',
  aufwand: 400, aufwandEinheit: 'kg_ha', mengeGesamt: 800, mengeEinheit: 'kg', wasserLHa: null, flaecheHa: 2, ...teil,
})

function ok(e, opt) {
  const r = mm.pruefeMassnahmeMengen(e, opt)
  assert.equal(r.ok, true, r.fehler)
  return r
}
function abgelehnt(e, muster, opt) {
  const r = mm.pruefeMassnahmeMengen(e, opt)
  assert.equal(r.ok, false, `erwartet abgelehnt: ${JSON.stringify(e)}`)
  assert.match(r.fehler, muster)
  return r.fehler
}

describe('Spritzung', nurMitHooks, () => {
  test('Funguran: Werte unverändert, Mittelmenge 1,2 kg, Reinkupfer 0,42 kg bzw. 0,21 kg/ha', () => {
    const r = ok(spritzung())
    assert.deepEqual(r.werte, { aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 800, menge_einheit: 'l', wasseraufwand_l_ha: 400, reinkupfer_kg_ha: 0.21 })
    assert.equal(r.mittelmenge.menge, 1.2)
    assert.equal(r.mittelmenge.einheit, 'kg')
    assert.equal(r.spritzbruehe, 800)
    assert.equal(r.cuKg, 0.42)
    assert.deepEqual(r.hinweise, [])
  })

  test('abgelehnt: Spritzbrühe in kg bzw. g', () => {
    abgelehnt(spritzung({ mengeGesamt: 1.2, mengeEinheit: 'kg' }), /Spritzbrühe in Litern – kg ist nicht zulässig/)
    abgelehnt(spritzung({ mengeGesamt: 1200, mengeEinheit: 'g' }), /Spritzbrühe in Litern – g ist nicht zulässig/)
  })

  test('abgelehnt: ohne Aufwand, ohne Aufwand-Einheit, ohne Mittel', () => {
    abgelehnt(spritzung({ aufwand: null }), /Aufwandmenge und Einheit Pflicht/)
    abgelehnt(spritzung({ aufwand: null, aufwandEinheit: null }), /Aufwandmenge und Einheit Pflicht/)
    abgelehnt(spritzung({ aufwandEinheit: null }), /Einheit der Aufwandmenge/)
    abgelehnt(spritzung({ psmId: null }), /Pflanzenschutzmittel Pflicht/)
    abgelehnt(spritzung({ aufwandEinheit: 'g' }), /Aufwand-Einheit „g“ ist nicht zulässig/)
  })

  test('abgelehnt: g/hl bzw. ml/hl ohne Spritzbrühe und Wasseraufwand', () => {
    abgelehnt(spritzung({ aufwand: 25, aufwandEinheit: 'g_hl', mengeGesamt: null, mengeEinheit: null, wasserLHa: null }), /Spritzbrühe gesamt \(l\) oder der Wasseraufwand \(l\/ha\) Pflicht/)
    abgelehnt(spritzung({ aufwand: 300, aufwandEinheit: 'ml_hl', mengeGesamt: null, mengeEinheit: 'kg', wasserLHa: null }), /Konzentration im Tank/)
  })

  test('abgelehnt: ungültige und negative Zahlen', () => {
    abgelehnt(spritzung({ aufwand: Number.NaN }), /„Aufwandmenge“ ist keine gültige Zahl/)
    abgelehnt(spritzung({ mengeGesamt: -5 }), /„Spritzbrühe gesamt“ muss größer als 0 sein/)
    abgelehnt(spritzung({ wasserLHa: 0 }), /„Wasseraufwand“ muss größer als 0 sein/)
  })

  test('Konzentration im Tank: 25 g/hl bzw. 300 ml/hl × 800 l', () => {
    const g = ok(spritzung({ aufwand: 25, aufwandEinheit: 'g_hl' }))
    assert.deepEqual([g.mittelmenge.menge, g.mittelmenge.einheit, g.cuKg], [0.2, 'kg', 0.07])
    const ml = ok(spritzung({ aufwand: 300, aufwandEinheit: 'ml_hl' }))
    assert.equal(ml.mittelmenge.menge, 2.4)
    assert.equal(ml.mittelmenge.einheit, 'l')
    assert.equal(ml.cuKg, 0.84)                                // 2,4 l mit 1 kg/l × 35 %
    assert.equal(ml.werte.reinkupfer_kg_ha, 0.42)
    assert.ok(ml.hinweise.some(h => h.includes('Dichte 1 kg/l')))
  })

  test('Assistent nur mit Wasseraufwand: Spritzbrühe = l/ha × Fläche', () => {
    const r = ok(spritzung({ mengeGesamt: null, mengeEinheit: null }))
    assert.equal(r.werte.menge_gesamt, 800)
    assert.equal(r.werte.menge_einheit, 'l')
    // Vorgabe „kg“ aus dem Formular ohne Menge stört nicht
    assert.equal(ok(spritzung({ mengeGesamt: null, mengeEinheit: 'kg' })).werte.menge_einheit, 'l')
    // g/hl nur mit Wasseraufwand: Brühe ergänzt, Mittelmenge daraus
    const g = ok(spritzung({ aufwand: 25, aufwandEinheit: 'g_hl', mengeGesamt: null, mengeEinheit: null }))
    assert.equal(g.werte.menge_gesamt, 800)
    assert.equal(g.mittelmenge.menge, 0.2)
  })

  test('nur Spritzbrühe: Wasseraufwand = Brühe ÷ Fläche; ml → l; ohne Einheit gilt l', () => {
    const r = ok(spritzung({ wasserLHa: null }))
    assert.equal(r.werte.wasseraufwand_l_ha, 400)
    const ml = ok(spritzung({ mengeGesamt: 800000, mengeEinheit: 'ml', wasserLHa: null }))
    assert.equal(ml.werte.menge_gesamt, 800)
    assert.equal(ml.werte.menge_einheit, 'l')
    assert.equal(ml.werte.wasseraufwand_l_ha, 400)
    assert.equal(ok(spritzung({ mengeEinheit: null })).werte.menge_einheit, 'l')
    // winziges GST: 800 l auf 0,0001 ha wären 8 Mio. l/ha – nicht speicherbar, nur Hinweis
    const winzig = ok(spritzung({ wasserLHa: null, flaecheHa: 0.0001, aufwand: 0.6 }))
    assert.equal(winzig.werte.wasseraufwand_l_ha, null)
    assert.ok(winzig.hinweise.some(h => h.startsWith('Wasseraufwand nicht ergänzt')))
  })

  test('Hinweis, wenn Spritzbrühe ≠ Wasseraufwand × Fläche', () => {
    const r = ok(spritzung({ mengeGesamt: 900 }))
    assert.equal(r.werte.menge_gesamt, 900)                     // nichts überschrieben
    assert.equal(r.hinweise.length, 1)
    assert.match(r.hinweise[0], /Spritzbrühe 900 l weicht von Wasseraufwand × Fläche ab \(400 l\/ha × 2 ha = 800 l\)/)
    assert.deepEqual(ok(spritzung({ mengeGesamt: 805 })).hinweise, [])   // innerhalb 1 %
  })

  test('Brühe Pflicht nur mit Option (Formular, Assistent)', () => {
    const ohne = spritzung({ mengeGesamt: null, mengeEinheit: null, wasserLHa: null })
    assert.equal(ok(ohne).werte.menge_gesamt, null)
    abgelehnt(ohne, /Spritzbrühe gesamt \(l\) oder den Wasseraufwand \(l\/ha\) angeben/, { bruehePflicht: true })
  })

  test('Reinkupfer: ohne Fläche null, ohne Kupfer null, Wirkstoffgehalt als Näherung', () => {
    const ohneFlaeche = ok(spritzung({ flaecheHa: null, aufwand: 1.2, aufwandEinheit: 'kg' }))
    assert.equal(ohneFlaeche.cuKg, 0.42)
    assert.equal(ohneFlaeche.werte.reinkupfer_kg_ha, null)
    const kgHaOhneFlaeche = ok(spritzung({ flaecheHa: 0 }))
    assert.equal(kgHaOhneFlaeche.mittelmenge.menge, null)
    assert.ok(kgHaOhneFlaeche.hinweise.some(h => h.includes('ohne behandelte Fläche')))
    assert.equal(ok(spritzung({ psm: { cuGehaltPct: null, wirkstoff: 'Folpet', wirkstoffgehaltPct: 80 } })).werte.reinkupfer_kg_ha, null)
    assert.equal(mm.kupferGehaltPct({ cuGehaltPct: null, wirkstoff: 'Kupfersulfat', wirkstoffgehaltPct: 20 }), 20)
    assert.equal(mm.kupferGehaltPct({ cuGehaltPct: 0, wirkstoff: 'Folpet', wirkstoffgehaltPct: 80 }), null)
    assert.equal(mm.kupferGehaltPct(null), null)
  })

  test('Reinkupfer je ha über numeric(8,4): nicht gespeichert, Hinweis statt Datenbankfehler', () => {
    // 3 kg gesamt × 35 % = 1,05 kg Cu auf einem Kleinst-GST mit 0,0001 ha wären 10.500 kg/ha
    const winzig = ok(spritzung({ aufwand: 3, aufwandEinheit: 'kg', flaecheHa: 0.0001, wasserLHa: null, mengeGesamt: 0.04 }))
    assert.equal(winzig.cuKg, 1.05)
    assert.equal(winzig.werte.reinkupfer_kg_ha, null)
    assert.ok(winzig.hinweise.some(h => /^Reinkupfer je ha nicht gespeichert: 1,05 kg Cu auf 0,0001 ha wären 10\.500 kg\/ha/.test(h)), winzig.hinweise.join(' | '))
    // dasselbe ohne Kleinstfläche: 30.000 kg/ha auf 1 ha (aufwandmenge passt in numeric(8,3))
    const unsinn = ok(spritzung({ aufwand: 30000, flaecheHa: 1, mengeGesamt: 400 }))
    assert.equal(unsinn.werte.reinkupfer_kg_ha, null)
    assert.ok(unsinn.hinweise.some(h => h.startsWith('Reinkupfer je ha nicht gespeichert')))
    // Grenze numeric(8,4): 9.999,999 kg/ha wird noch gespeichert, 10.000 kg/ha nicht mehr
    const reinesCu = { psm: { cuGehaltPct: 100 }, aufwandEinheit: 'kg', flaecheHa: 1, mengeGesamt: 400 }
    assert.equal(ok(spritzung({ ...reinesCu, aufwand: 9999.999 })).werte.reinkupfer_kg_ha, 9999.999)
    assert.equal(ok(spritzung({ ...reinesCu, aufwand: 10000 })).werte.reinkupfer_kg_ha, null)
    // Kleinstfläche ohne Überlauf: Rundung wie die Kupfer-Bilanz (cu.ts), kein Hinweis
    const klein = ok(spritzung({ flaecheHa: 0.005, wasserLHa: null, mengeGesamt: 2 }))
    assert.equal(klein.werte.reinkupfer_kg_ha, 0.22)
    assert.ok(!klein.hinweise.some(h => h.startsWith('Reinkupfer je ha')))
  })
})

describe('Düngung', nurMitHooks, () => {
  test('Düngermenge in kg unverändert, g → kg', () => {
    const r = ok(duengung())
    assert.deepEqual(r.werte, { aufwandmenge: 400, aufwandmenge_einheit: 'kg_ha', menge_gesamt: 800, menge_einheit: 'kg', wasseraufwand_l_ha: null, reinkupfer_kg_ha: null })
    assert.equal(r.mittelmenge.basis, 'Düngermenge')
    const g = ok(duengung({ mengeGesamt: 3275000, mengeEinheit: 'g' }))
    assert.equal(g.werte.menge_gesamt, 3275)
    assert.equal(g.werte.menge_einheit, 'kg')
  })

  test('abgelehnt: g/hl und ml/hl', () => {
    abgelehnt(duengung({ aufwand: 25, aufwandEinheit: 'g_hl' }), /Düngung sind g\/hl und ml\/hl nicht zulässig/)
    abgelehnt(duengung({ aufwand: 300, aufwandEinheit: 'ml_hl' }), /Düngung sind g\/hl und ml\/hl nicht zulässig/)
  })

  test('Liter nur bei Düngemitteln in l', () => {
    abgelehnt(duengung({ mengeGesamt: 50, mengeEinheit: 'l' }), /nur bei Düngemitteln möglich, die in Litern geführt werden/)
    abgelehnt(duengung({ aufwand: 20, aufwandEinheit: 'l_ha' }), /Aufwand in l\/ha bzw\. l nur bei Düngemitteln/)
    const fluessig = ok(duengung({ duengemittelEinheit: 'l', mengeGesamt: 50000, mengeEinheit: 'ml', aufwand: 25, aufwandEinheit: 'l_ha' }))
    assert.equal(fluessig.werte.menge_gesamt, 50)
    assert.equal(fluessig.werte.menge_einheit, 'l')
    assert.equal(fluessig.mittelmenge.einheit, 'l')
  })

  test('Düngemittel in l: Düngermenge ohne Einheit in l, kg/g abgelehnt (keine Dichte-Annahme)', () => {
    // Assistent ohne menge_einheit: die Einheit folgt dem Düngemittel wie im Formular (duengermengeEinheit)
    const r = ok(duengung({ duengemittelEinheit: 'l', mengeGesamt: 50, mengeEinheit: null }))
    assert.equal(r.werte.menge_gesamt, 50)
    assert.equal(r.werte.menge_einheit, 'l')
    assert.deepEqual([r.mittelmenge.menge, r.mittelmenge.einheit, r.mittelmenge.basis], [50, 'l', 'Düngermenge'])
    abgelehnt(duengung({ duengemittelEinheit: 'l', mengeGesamt: 50, mengeEinheit: 'kg' }), /Düngemittel wird in Litern geführt – bitte die Düngermenge in l angeben/)
    abgelehnt(duengung({ duengemittelEinheit: 'l', mengeGesamt: 50000, mengeEinheit: 'g' }), /in Litern geführt/)
    // Vorabprüfung des Assistenten (ohne Fläche, mit bruehePflicht) lehnt ebenso ab
    abgelehnt({ ...duengung({ duengemittelEinheit: 'l', mengeGesamt: 200, mengeEinheit: 'kg' }), flaecheHa: null }, /in l angeben/, { bruehePflicht: true })
  })

  test('Düngemittel in kg bzw. ohne Düngemittel: Düngermenge ohne Einheit weiter kg', () => {
    assert.equal(ok(duengung({ mengeEinheit: null })).werte.menge_einheit, 'kg')
    assert.equal(ok(duengung({ duengemittelEinheit: null, mengeEinheit: null })).werte.menge_einheit, 'kg')
    assert.equal(ok(duengung({ duengemittelId: null, duengemittelEinheit: null, mengeEinheit: null })).werte.menge_einheit, 'kg')
  })

  test('nur Aufwand: Düngermenge = kg/ha × Fläche (nicht gespeichert), Einheit ohne Aufwand entfällt', () => {
    const r = ok(duengung({ mengeGesamt: null, mengeEinheit: 'kg' }))
    assert.equal(r.werte.menge_gesamt, null)
    assert.equal(r.mittelmenge.menge, 800)
    assert.equal(ok(duengung({ aufwand: null })).werte.aufwandmenge_einheit, null)
  })
})

describe('andere Arten', nurMitHooks, () => {
  test('unverändert durchgelassen', () => {
    const e = { art: 'bodenbearbeitung', aufwand: null, aufwandEinheit: 'kg_ha', mengeGesamt: null, mengeEinheit: 'kg', wasserLHa: null, flaecheHa: 2 }
    const r = ok(e)
    assert.deepEqual(r.werte, { aufwandmenge: null, aufwandmenge_einheit: 'kg_ha', menge_gesamt: null, menge_einheit: 'kg', wasseraufwand_l_ha: null, reinkupfer_kg_ha: null })
    assert.equal(r.mittelmenge.grund, 'art')
    assert.equal(r.spritzbruehe, null)
  })
})

// ── Anbindung: createBehandlung/updateBehandlung (Soll 10) und Assistent (Soll 11) ──
// Die Server Actions lesen die Zahlen mit Number(dezimal(…)) (ungültig = NaN), laden Cu-Gehalt bzw.
// Düngemittel-Einheit und übergeben als Fläche die Σ der gewählten WI-GST (beim Bearbeiten Σ
// behandlung_grundstuecke.flaeche_ha). Der Assistent prüft vorab ohne Fläche mit bruehePflicht.
const fmt = hooksMoeglich ? await import(pathToFileURL(path.join(SRC, 'lib/format.ts')).href) : null
/** wie in actions.ts: leer = null, sonst Number(dezimal(…)) */
const ausFormular = (s) => (s ? Number(fmt.dezimal(s)) : null)

/** Musterhof 10.07.2026: Cuprozin progress 1,5 kg/ha (Cu 35 %) auf 16 GST mit 14,1 ha, 600 l/ha – Altwert 21,15 kg */
const CUPROZIN_ALT = {
  art: 'spritzung', psmId: 'p-cu', psm: { cuGehaltPct: 35, wirkstoff: 'Kupferhydroxid', wirkstoffgehaltPct: 53.7 },
  aufwand: 1.5, aufwandEinheit: 'kg_ha', mengeGesamt: 21.15, mengeEinheit: 'kg', wasserLHa: 600, flaecheHa: 14.1,
}

describe('Anbindung Server Action und Assistent', nurMitHooks, () => {
  test('Formularwerte wie in der Action: Dezimalkomma gelesen, ungültige Eingabe abgelehnt', () => {
    const r = ok(spritzung({ aufwand: ausFormular('0,6'), mengeGesamt: ausFormular('800'), wasserLHa: ausFormular('400') }))
    assert.equal(r.mittelmenge.menge, 1.2)
    abgelehnt(spritzung({ aufwand: ausFormular('0,6 kg') }), /„Aufwandmenge“ ist keine gültige Zahl/)
    // Der Assistent schickt Zahlen mit Dezimalkomma: „1.125“ läse dezimal() als Tausenderpunkt
    assert.equal(ausFormular('1.125'), 1125)
    assert.equal(ausFormular('1,125'), 1.125)
  })

  test('Bearbeiten eines Altwerts in kg: abgelehnt; mit Wasseraufwand → Spritzbrühe 8.460 l, Reinkupfer wie bisher', () => {
    abgelehnt(CUPROZIN_ALT, /Spritzbrühe in Litern – kg ist nicht zulässig/)
    const r = ok({ ...CUPROZIN_ALT, mengeGesamt: null, mengeEinheit: 'kg' })
    assert.equal(r.werte.menge_gesamt, 8460)
    assert.equal(r.werte.menge_einheit, 'l')
    assert.equal(r.mittelmenge.menge, 21.15)
    assert.equal(r.cuKg, 7.4025)
    assert.equal(r.werte.reinkupfer_kg_ha, 0.525)                  // = gespeicherter Seed-Wert 0,5250
  })

  test('Tankmischung: Topas mit derselben Spritzbrühe, eigene Mittelmenge, kein Reinkupfer', () => {
    const topas = ok({ ...CUPROZIN_ALT, psmId: 'p-topas', psm: { cuGehaltPct: 0, wirkstoff: 'Penconazol', wirkstoffgehaltPct: 10 },
      aufwand: 0.25, aufwandEinheit: 'l_ha', mengeGesamt: 8460, mengeEinheit: 'l' })
    assert.equal(topas.spritzbruehe, 8460)
    assert.deepEqual([topas.mittelmenge.menge, topas.mittelmenge.einheit], [3.525, 'l'])
    assert.equal(topas.werte.reinkupfer_kg_ha, null)
    assert.deepEqual(topas.hinweise, [])
  })

  test('Assistent: Vorabprüfung ohne Fläche, danach die Action mit Σ GST-Fläche', () => {
    const eingabe = spritzung({ mengeGesamt: null, mengeEinheit: null })
    const vorab = ok({ ...eingabe, flaecheHa: null }, { bruehePflicht: true })
    assert.equal(vorab.werte.menge_gesamt, null)                   // Fläche erst in der Action bekannt
    assert.equal(vorab.werte.reinkupfer_kg_ha, null)
    const action = ok({ ...eingabe, flaecheHa: 0.75 + 0.8 + 0.45 })
    assert.equal(action.werte.menge_gesamt, 800)
    assert.equal(action.werte.reinkupfer_kg_ha, 0.21)
    // Der Bot trägt die Mittelmenge als „Menge gesamt“ ein bzw. vergisst die Brühe
    abgelehnt({ ...spritzung({ mengeGesamt: 1.2, mengeEinheit: 'kg', wasserLHa: null }), flaecheHa: null }, /Spritzbrühe in Litern/, { bruehePflicht: true })
    abgelehnt({ ...spritzung({ mengeGesamt: null, mengeEinheit: null, wasserLHa: null }), flaecheHa: null }, /Spritzbrühe gesamt \(l\) oder den Wasseraufwand/, { bruehePflicht: true })
  })

  test('KI-Kontext (Frag dein Weingut): Cu-Gehalt wie kupferGehaltPct()/cuGehalt() – Näherung über wirkstoffgehalt_pct', () => {
    // „Cuprozin Progress“ mit cu_gehalt_pct 0: Cu-Bilanz und reinkupfer_kg_ha nehmen den Wirkstoffgehalt
    const cuprozin = { cuGehaltPct: 0, wirkstoff: 'Kupferhydroxid', wirkstoffgehaltPct: 18.9 }
    assert.equal(mm.kupferGehaltPct(cuprozin), 18.9)
    assert.equal(ok(spritzung({ psm: cuprozin })).cuKg, 0.2268)       // 1,2 kg × 18,9 % – nicht 0
    assert.equal(mm.kupferGehaltPct({ cuGehaltPct: null, wirkstoff: 'Penconazol', wirkstoffgehaltPct: 10 }), null)
    const kontext = readFileSync(path.join(SRC, 'app/api/ki-abfrage/route.ts'), 'utf8').replace(/\s+/g, ' ')
    const regel = kontext.match(/Reinkupfer \(kg\) = [^.]*\.(?:[^.]*\.){0,4}/)?.[0] ?? ''
    assert.match(regel, /Mittelmenge \* Cu-Gehalt \/ 100/)
    assert.doesNotMatch(regel, /Mittelmenge \* pflanzenschutzmittel\.cu_gehalt_pct \/ 100/)
    assert.ok(kontext.includes("COALESCE(NULLIF(cu_gehalt_pct, 0), CASE WHEN wirkstoff ILIKE '%kupfer%' THEN NULLIF(wirkstoffgehalt_pct, 0) END)"))
  })

  test('Fläche der Action und der Bearbeiten-Seite: summeFlaecheHa() wie normalisiereBehandlung (4 Stellen je GST)', () => {
    assert.equal(mm.summeFlaecheHa([0.75, '0.8', 0.45]), 2)                   // DB-Werte auch als Text
    assert.equal(mm.summeFlaecheHa([0.12346, 0.12346]), 0.247)              // je GST gerundet, dann Summe (nicht 0,2469)
    assert.equal(mm.summeFlaecheHa([null, undefined, '', 0, -1, 'x']), null)
    assert.equal(mm.summeFlaecheHa([]), null)
  })

  test('Maßnahme ohne WI-GST-Fläche: gespeichert, Reinkupfer leer, Hinweis', () => {
    const r = ok(spritzung({ flaecheHa: null, wasserLHa: 400 }))
    assert.equal(r.werte.menge_gesamt, 800)                         // Brühe angegeben, nichts ergänzt
    assert.equal(r.werte.reinkupfer_kg_ha, null)
    assert.ok(r.hinweise.some(h => h.includes('ohne behandelte Fläche')))
  })

  test('Düngung ohne gewähltes Düngemittel: nur kg', () => {
    abgelehnt(duengung({ duengemittelId: null, duengemittelEinheit: null, mengeGesamt: 50, mengeEinheit: 'l' }), /in Litern geführt werden/)
    assert.equal(ok(duengung({ duengemittelId: null, duengemittelEinheit: null })).werte.menge_gesamt, 800)
  })

  test('Bearbeiten: Art von Spritzung auf Schnitt geändert – Reinkupfer wird geleert', () => {
    const r = ok({ ...CUPROZIN_ALT, art: 'schnitt' })
    assert.equal(r.werte.reinkupfer_kg_ha, null)
    assert.equal(r.cuKg, null)
  })
})

// ── Formulare: Vorbelegung und Wechsel des Düngemittels (Soll 8/9, Entscheidung 1) ──
// neu/mengenFelder.ts – gemeinsam für Anlegen und Bearbeiten; kg ↔ l nie still umdeuten

describe('Formulare: Düngermenge beim Wechsel kg ↔ l', nurMitHooks, () => {
  const laden = () => import(pathToFileURL(path.join(SRC, 'app/(dashboard)/behandlungen/neu/mengenFelder.ts')).href)

  test('Vorbelegung gegen die Einheit des gewählten Düngemittels: 950 kg bei Düngemittel in l → Altwert', async () => {
    const mf = await laden()
    const gespeichert = { art: 'duengung', menge_gesamt: 950, menge_einheit: 'kg' }
    assert.deepEqual(mf.mengeVorbelegung(gespeichert, 'kg'), { text: '950', altwert: null })
    assert.deepEqual(mf.mengeVorbelegung(gespeichert, 'l'), { text: '', altwert: '950 kg' })
    assert.deepEqual(mf.mengeVorbelegung({ ...gespeichert, menge_gesamt: 500, menge_einheit: 'g' }, 'kg'), { text: '0,5', altwert: null })
    // Spritzung: immer Spritzbrühe in l, unabhängig vom Düngemittel; kg/g vor KAN-133 = Altwert
    assert.deepEqual(mf.mengeVorbelegung({ art: 'spritzung', menge_gesamt: 800, menge_einheit: 'l' }, 'kg'), { text: '800', altwert: null })
    assert.deepEqual(mf.mengeVorbelegung({ art: 'spritzung', menge_gesamt: 21.15, menge_einheit: 'kg' }, 'l'), { text: '', altwert: '21,15 kg' })
    assert.deepEqual(mf.mengeVorbelegung({ art: 'duengung', menge_gesamt: null, menge_einheit: null }, 'l'), { text: '', altwert: null })
  })

  test('Vorbelegung ohne gespeicherte Einheit: Einheit des gespeicherten Düngemittels (wie pruefeMassnahmeMengen)', async () => {
    const mf = await laden()
    const ohneEinheit = { art: 'duengung', menge_gesamt: 50, menge_einheit: null }
    assert.deepEqual(mf.mengeVorbelegung(ohneEinheit, 'l'), { text: '50', altwert: null })
    assert.deepEqual(mf.mengeVorbelegung(ohneEinheit, 'kg'), { text: '50', altwert: null })
    // Wechsel vom Düngemittel in l auf eines in kg (und umgekehrt): Altwert, nie still umgedeutet
    assert.deepEqual(mf.mengeVorbelegung(ohneEinheit, 'kg', 'l'), { text: '', altwert: '50 l' })
    assert.deepEqual(mf.mengeVorbelegung(ohneEinheit, 'l', 'kg'), { text: '', altwert: '50 kg' })
  })

  test('Formular und Server: Düngemittel in l – dieselbe Einheit, gespeicherte kg sind im Formular Altwert und im Server abgelehnt', async () => {
    const mf = await laden()
    const m = mf.mengenFelder({
      art: 'duengung', felder: mf.MENGEN_SICHT.duengung,
      mengeGesamt: '50', wasseraufwand: '', mengeQuelle: null,
      aufwandmenge: '', aufwandmengeEinheit: 'kg_ha', konzentration: '', folge: [],
      flaecheHa: 2, psmId: null, psm: null, duengemittelId: 'd-l', duengemittelEinheit: 'l',
    })
    assert.equal(m.mengeEinheit, 'l')
    assert.equal(m.pruefung.ok, true)
    assert.deepEqual([m.pruefung.werte.menge_gesamt, m.pruefung.werte.menge_einheit], [50, 'l'])
    // was der Server ohne Einheit speichert, belegt das Bearbeiten-Formular ohne Altwert vor
    const gespeichert = ok(duengung({ duengemittelEinheit: 'l', mengeGesamt: 50, mengeEinheit: null, aufwand: null })).werte
    assert.deepEqual(mf.mengeVorbelegung({ art: 'duengung', ...gespeichert }, 'l'), { text: '50', altwert: null })
    // kg bei einem Düngemittel in l: Formular Altwert, Server abgelehnt
    assert.deepEqual(mf.mengeVorbelegung({ art: 'duengung', menge_gesamt: 50, menge_einheit: 'kg' }, 'l'), { text: '', altwert: '50 kg' })
    abgelehnt(duengung({ duengemittelEinheit: 'l', mengeGesamt: 50, mengeEinheit: 'kg' }), /in l angeben/)
  })

  test('eigene Eingabe bleibt stehen, Hinweis nur bei anderer Einheit', async () => {
    const mf = await laden()
    assert.deepEqual(['kg', 'l', null, undefined, 'g'].map(e => mf.duengermengeEinheit(e)), ['kg', 'l', 'kg', 'kg', 'kg'])
    assert.match(mf.duengerEinheitWechsel('kg', 'l', '950'), /von kg auf l gewechselt .* nicht umgerechnet/)
    assert.equal(mf.duengerEinheitWechsel('kg', 'kg', '950'), null)
    assert.equal(mf.duengerEinheitWechsel('kg', 'l', ' '), null)
  })
})

describe('Formulare: Hinweis unter „Konzentration (%)“ nennt, was fehlt', nurMitHooks, () => {
  const laden = () => import(pathToFileURL(path.join(SRC, 'app/(dashboard)/behandlungen/neu/mengenFelder.ts')).href)
  const eingaben = (mf, x = {}) => ({
    art: 'spritzung', felder: mf.MENGEN_SICHT.spritzung,
    mengeGesamt: '', wasseraufwand: '', mengeQuelle: null,
    aufwandmenge: '0,6', aufwandmengeEinheit: 'kg_ha', konzentration: '', folge: ['aufwand'],
    flaecheHa: null, psmId: 'p-funguran', psm: null, duengemittelId: null, duengemittelEinheit: null,
    ...x,
  })

  test('weder Spritzbrühe noch Wasseraufwand: bisheriger Text', async () => {
    const mf = await laden()
    // KAN-155: auch die Konzentration (%) genügt – Aufwand und Konzentration ergeben den Wasseraufwand
    assert.equal(mf.mengenFelder(eingaben(mf)).konzentrationHinweis,
      'Für die automatische Berechnung bitte Konzentration (%), Wasseraufwand (l/ha) oder Spritzbrühe gesamt angeben.')
    assert.match(mf.mengenFelder(eingaben(mf, { flaecheHa: 2 })).konzentrationHinweis, /oder Spritzbrühe gesamt angeben/)
  })

  test('Spritzbrühe gesamt eingetragen, aber keine Fläche: verlangt nicht erneut die Brühe', async () => {
    const mf = await laden()
    const bruehe = { mengeGesamt: '800', mengeQuelle: 'gesamt' }
    const neu = mf.mengenFelder(eingaben(mf, bruehe))
    assert.equal(neu.wasserBerechnet, null)
    assert.equal(neu.konzentrationHinweis, 'Konzentration wird berechnet, sobald Ried(en) ausgewählt sind – oder Wasseraufwand (l/ha) angeben.')
    assert.equal(mf.mengenFelder(eingaben(mf, { ...bruehe, formular: 'neu' })).konzentrationHinweis, neu.konzentrationHinweis)
    const bearbeiten = mf.mengenFelder(eingaben(mf, { ...bruehe, formular: 'bearbeiten' })).konzentrationHinweis
    assert.match(bearbeiten, /^Ohne zugeordnete Grundstücke lässt sich die Spritzbrühe gesamt nicht umrechnen/)
    for (const t of [neu.konzentrationHinweis, bearbeiten]) assert.doesNotMatch(t, /Spritzbrühe gesamt angeben/)
    // Bearbeiten mit Fläche, Brühe gespeichert, Wasseraufwand leer und unverändert (mengeQuelle null): nur der Wasseraufwand fehlt
    assert.equal(mf.mengenFelder(eingaben(mf, { mengeGesamt: '800', flaecheHa: 2, formular: 'bearbeiten' })).konzentrationHinweis,
      'Für die automatische Berechnung bitte Wasseraufwand (l/ha) angeben.')
  })

  test('kein Hinweis, sobald gerechnet wird oder nichts zu rechnen ist', async () => {
    const mf = await laden()
    // mit Fläche: 800 l ÷ 2 ha = 400 l/ha; 0,6 kg/ha ÷ 400 l/ha × 100 = 0,15 %
    const mitFlaeche = mf.mengenFelder(eingaben(mf, { mengeGesamt: '800', mengeQuelle: 'gesamt', flaecheHa: 2 }))
    assert.equal(mitFlaeche.wasserBerechnet, 400)
    assert.ok(Math.abs(mitFlaeche.konzentrationBerechnet - 0.15) < 1e-9)
    assert.equal(mitFlaeche.konzentrationHinweis, null)
    // Wasseraufwand wirkt auch ohne Fläche direkt
    const nurWasser = mf.mengenFelder(eingaben(mf, { wasseraufwand: '400', mengeQuelle: 'wasser' }))
    assert.ok(Math.abs(nurWasser.konzentrationBerechnet - 0.15) < 1e-9)
    assert.equal(nurWasser.konzentrationHinweis, null)
    for (const x of [
      { aufwandmenge: '25', aufwandmengeEinheit: 'g_hl' },   // g/hl → % ohne Wasseraufwand
      { aufwandmenge: '1,2', aufwandmengeEinheit: 'kg' },    // gesamt: keine Umrechnung in %
      { aufwandmenge: '', folge: [] },                       // nichts eingegeben
      { art: 'duengung', felder: mf.MENGEN_SICHT.duengung }, // Düngung ohne Konzentrationsfeld
    ]) assert.equal(mf.mengenFelder(eingaben(mf, x)).konzentrationHinweis, null, JSON.stringify(x))
  })
})

// ── Optionaler CHECK „Spritzung nur l“ (Migration kan133_spritzbruehe_demo_kommentare, Abschnitt 5) ──
// Liegt die Migration schon unter supabase/migrations/ (<version>_kan133_spritzbruehe_demo_kommentare.sql,
// nach apply_migration), liest der Test den Namen aus der Datei (ADD CONSTRAINT …), sonst gilt der Name aus
// dem Entwurf. Muster wie scripts/tests/mostgewicht-pruefregeln.test.mjs.

const CHECK_SPRITZBRUEHE = 'behandlungen_spritzung_bruehe_l_check'

function spritzbruehenCheck() {
  const verzeichnis = path.resolve(SRC, '../supabase/migrations')
  const treffer = readdirSync(verzeichnis).filter(d => /^\d{14}_kan133_spritzbruehe_demo_kommentare\.sql$/.test(d))
  assert.ok(treffer.length <= 1, `mehrere Migrationen kan133_spritzbruehe_demo_kommentare: ${treffer.join(', ')}`)
  if (treffer.length === 0) return { quelle: 'Entwurf', namen: [CHECK_SPRITZBRUEHE] }
  const sql = readFileSync(path.join(verzeichnis, treffer[0]), 'utf8')
  return { quelle: treffer[0], namen: [...new Set([...sql.matchAll(/\bADD\s+CONSTRAINT\s+([a-z0-9_]+)/gi)].map(m => m[1]))] }
}

/** Bedingung wie in der Migration: art IS DISTINCT FROM 'spritzung' OR menge_gesamt IS NULL OR menge_einheit IS NOT DISTINCT FROM 'l' */
const checkErfuellt = (art, w) => art !== 'spritzung' || w.menge_gesamt === null || w.menge_einheit === 'l'

describe('CHECK behandlungen_spritzung_bruehe_l_check (KAN-133, optional)', () => {
  test('deutsche Meldung in PRUEFREGEL_MELDUNG – kein allgemeiner Prüfregel-Text', async () => {
    const { uebersetzeDbMeldung, dbFehlerText } = await import(pathToFileURL(path.join(SRC, 'lib/fehler.ts')).href)
    const { quelle, namen } = spritzbruehenCheck()
    // ohne CHECK (Abschnitt 5 gestrichen) enthält die Migration kein ADD CONSTRAINT – dann gibt es nichts zu übersetzen
    assert.ok(namen.length <= 1, `${quelle}: unerwartete Constraints ${namen.join(', ')}`)
    for (const n of namen) {
      assert.equal(n, CHECK_SPRITZBRUEHE, quelle)
      assert.ok(n.length <= 63, `${n}: länger als 63 Zeichen (PostgreSQL kürzt Namen)`)
      const meldung = `new row for relation "behandlungen" violates check constraint "${n}"`
      const t = uebersetzeDbMeldung(meldung)
      assert.doesNotMatch(t, /Prüfregel der Datenbank|violates/)
      assert.match(t, /Spritzbrühe in Litern/)
      assert.equal(dbFehlerText({ code: '23514', message: meldung }), t)
    }
  })

  test('was die Serverprüfung bei einer Spritzung speichert, erfüllt den CHECK', nurMitHooks, () => {
    for (const e of [
      spritzung(), spritzung({ mengeGesamt: 800000, mengeEinheit: 'ml' }), spritzung({ mengeEinheit: null }),
      spritzung({ mengeGesamt: null, mengeEinheit: null }), spritzung({ mengeGesamt: null, mengeEinheit: null, flaecheHa: null }),
      spritzung({ aufwand: 25, aufwandEinheit: 'g_hl', mengeGesamt: null, mengeEinheit: null }),
    ]) {
      const r = ok(e)
      assert.ok(checkErfuellt('spritzung', r.werte), JSON.stringify(r.werte))
    }
    // kg/g lehnt schon die Serverprüfung ab – der CHECK ist nur der Rückfall
    abgelehnt(spritzung({ mengeGesamt: 1.2, mengeEinheit: 'kg' }), /Spritzbrühe in Litern/)
    assert.equal(checkErfuellt('spritzung', { menge_gesamt: 1.2, menge_einheit: 'kg' }), false)
    assert.equal(checkErfuellt('duengung', ok(duengung()).werte), true)
  })
})

// ── KAN-155: Aufwand, Konzentration (%) und Wasseraufwand – je zwei bestimmen die dritte ──
// Aufwand (kg/ha, l/ha) = Wasseraufwand × Konzentration ÷ 100; Spritzbrühe gesamt = Wasseraufwand × Fläche.

/** Ergebnis von pruefeMassnahmeMengen muss gültig sein (ok()/abgelehnt() oben nehmen die Eingabe) */
function gueltig(r) {
  assert.equal(r.ok, true, r.fehler)
  return r
}

describe('KAN-155: wasseraufwandAusKonzentration und pruefeMassnahmeMengen', nurMitHooks, () => {
  test('Rechnung und Randfälle (0, leer, ungültig, > 100 %, Einheiten) – nie durch 0 teilen', () => {
    const w = mm.wasseraufwandAusKonzentration
    assert.equal(w(2, 'l_ha', 0.5), 400)                  // Beispiel aus dem Ticket
    assert.equal(w(0.6, 'kg_ha', 0.15), 400)              // Rundung auf 2 Stellen fängt 400,0000001 ab
    assert.equal(w(1, 'kg_ha', 3), 33.33)
    for (const k of [0, -1, 100.5, null, Number.NaN, Infinity]) assert.equal(w(2, 'l_ha', k), null, String(k))
    for (const a of [0, -2, null, Number.NaN]) assert.equal(w(a, 'l_ha', 0.5), null, String(a))
    for (const e of ['g_hl', 'ml_hl', 'kg', 'l', null, '']) assert.equal(w(2, e, 0.5), null, String(e))
    assert.equal(w(2, 'l_ha', 100), 2)
  })

  test('Server: Aufwand + Konzentration ohne Spritzbrühe und Wasseraufwand → 400 l/ha, bei 1,5 ha 600 l', () => {
    const e = (teil) => ({ art: 'spritzung', psmId: 'p-1', psm: null, aufwand: 2, aufwandEinheit: 'l_ha', mengeGesamt: null, mengeEinheit: null, wasserLHa: null, konzentrationPct: 0.5, flaecheHa: 1.5, ...teil })
    const r = gueltig(mm.pruefeMassnahmeMengen(e({}), { bruehePflicht: true }))
    assert.deepEqual([r.werte.wasseraufwand_l_ha, r.werte.menge_gesamt, r.werte.menge_einheit, r.spritzbruehe], [400, 600, 'l', 600])
    assert.deepEqual([r.mittelmenge.menge, r.mittelmenge.einheit], [3, 'l'])  // Mittelmenge weiter nur aus dem Aufwand
    // ohne Fläche: Wasseraufwand ja, Spritzbrühe erst mit Fläche
    const ohneHa = gueltig(mm.pruefeMassnahmeMengen(e({ flaecheHa: null }), { bruehePflicht: true }))
    assert.deepEqual([ohneHa.werte.wasseraufwand_l_ha, ohneHa.werte.menge_gesamt], [400, null])
    // eingegebene Spritzbrühe bzw. eingegebener Wasseraufwand gehen vor – die Konzentration ändert sie nicht
    assert.equal(gueltig(mm.pruefeMassnahmeMengen(e({ wasserLHa: 300 }))).werte.wasseraufwand_l_ha, 300)
    assert.deepEqual(gueltig(mm.pruefeMassnahmeMengen(e({ mengeGesamt: 900, mengeEinheit: 'l' }))).werte.wasseraufwand_l_ha, 600)
    // Konzentration 0, leer oder g/hl: nichts ergänzt – mit Brühe-Pflicht die Rückfrage, sonst ohne Wasseraufwand gespeichert
    for (const teil of [{ konzentrationPct: 0 }, { konzentrationPct: null }, { konzentrationPct: undefined }]) {
      const r2 = mm.pruefeMassnahmeMengen(e(teil), { bruehePflicht: true })
      assert.equal(r2.ok, false, JSON.stringify(teil))
      assert.match(r2.fehler, /genügt auch die Konzentration \(%\)/)
      assert.equal(gueltig(mm.pruefeMassnahmeMengen(e(teil))).werte.wasseraufwand_l_ha, null)
    }
    abgelehnt(e({ aufwand: 25, aufwandEinheit: 'g_hl' }), /g\/hl bzw\. ml\/hl .* Pflicht/)
    // Düngung und Sonstiges: Konzentration spielt keine Rolle
    assert.equal(gueltig(mm.pruefeMassnahmeMengen({ art: 'duengung', aufwand: 2, aufwandEinheit: 'kg_ha', mengeGesamt: 100, mengeEinheit: 'kg', wasserLHa: null, konzentrationPct: 0.5, flaecheHa: 1.5 })).werte.wasseraufwand_l_ha, null)
  })
})

describe('KAN-155: Formular – welches Feld berechnet wird', nurMitHooks, () => {
  const laden = () => import(pathToFileURL(path.join(SRC, 'app/(dashboard)/behandlungen/neu/mengenFelder.ts')).href)
  const eingaben = (mf, x = {}) => ({
    art: 'spritzung', felder: mf.MENGEN_SICHT.spritzung,
    mengeGesamt: '', wasseraufwand: '', mengeQuelle: null,
    aufwandmenge: '', aufwandmengeEinheit: 'l_ha', konzentration: '', folge: [],
    flaecheHa: 1.5, psmId: 'p-1', psm: null, duengemittelId: null, duengemittelEinheit: null,
    ...x,
  })
  /** Eingaben wie im Formular nacheinander: [['aufwand', '2'], ['konzentration', '0,5'], ['wasser', '400'], ['gesamt', '600']] */
  const tippe = (mf, schritte, x = {}) => {
    let e = eingaben(mf, x)
    for (const [feld, wert] of schritte) {
      if (feld === 'aufwand') e = { ...e, aufwandmenge: wert, folge: mf.eingabeFolge(e.folge, 'aufwand', wert) }
      if (feld === 'konzentration') e = { ...e, konzentration: wert, folge: mf.eingabeFolge(e.folge, 'konzentration', wert) }
      if (feld === 'wasser') e = { ...e, wasseraufwand: wert, mengeQuelle: wert.trim() ? 'wasser' : null, folge: mf.eingabeFolge(e.folge, 'wasser', wert) }
      if (feld === 'gesamt') e = { ...e, mengeGesamt: wert, mengeQuelle: wert.trim() ? 'gesamt' : null, folge: mf.eingabeFolge(e.folge, 'wasser', wert) }
    }
    return mf.mengenFelder(e)
  }

  test('eingabeFolge: zuletzt geänderte Größe ans Ende, geleertes Feld fällt heraus', async () => {
    const mf = await laden()
    assert.deepEqual(mf.eingabeFolge([], 'aufwand', '2'), ['aufwand'])
    assert.deepEqual(mf.eingabeFolge(['aufwand', 'konzentration'], 'aufwand', '3'), ['konzentration', 'aufwand'])
    assert.deepEqual(mf.eingabeFolge(['aufwand', 'konzentration'], 'aufwand', '  '), ['konzentration'])
    const vorher = ['wasser']
    mf.eingabeFolge(vorher, 'aufwand', '1')
    assert.deepEqual(vorher, ['wasser'])   // unverändert (React-State)
  })

  test('berechneteGroesse: die nicht unter den zwei zuletzt eingegebenen; gespeicherte Werte zählen als älter', async () => {
    const mf = await laden()
    const alle = { aufwand: true, konzentration: true, wasser: true }
    const keine = { aufwand: false, konzentration: false, wasser: false }
    assert.equal(mf.berechneteGroesse([], alle, false), null)                       // nichts geändert: nichts rechnen
    assert.equal(mf.berechneteGroesse(['aufwand'], { ...keine, aufwand: true }, false), null)
    assert.equal(mf.berechneteGroesse(['aufwand', 'konzentration'], keine, false), 'wasser')
    assert.equal(mf.berechneteGroesse(['konzentration', 'aufwand'], keine, false), 'wasser')
    assert.equal(mf.berechneteGroesse(['aufwand', 'wasser'], keine, false), 'konzentration')
    assert.equal(mf.berechneteGroesse(['konzentration', 'wasser'], keine, false), 'aufwand')
    assert.equal(mf.berechneteGroesse(['wasser', 'aufwand', 'konzentration'], keine, false), 'wasser')
    assert.equal(mf.berechneteGroesse(['konzentration', 'aufwand', 'wasser'], keine, false), 'konzentration')
    // Bearbeiten mit allen drei gespeichert: wie bisher bleibt der Wasseraufwand stehen
    assert.equal(mf.berechneteGroesse(['aufwand'], alle, false), 'konzentration')
    assert.equal(mf.berechneteGroesse(['konzentration'], alle, false), 'aufwand')
    assert.equal(mf.berechneteGroesse(['wasser'], alle, false), 'konzentration')
    // g/hl, ml/hl: nur Aufwand ↔ Konzentration
    assert.equal(mf.berechneteGroesse(['aufwand', 'konzentration'], keine, true), 'aufwand')
    assert.equal(mf.berechneteGroesse(['konzentration', 'aufwand'], keine, true), 'konzentration')
    assert.equal(mf.berechneteGroesse(['wasser'], keine, true), null)
    assert.equal(mf.berechneteGroesse(['wasser'], { ...keine, aufwand: true }, true), 'konzentration')
  })

  test('Akzeptanz: 2 l/ha und 0,5 % → 400 l/ha Wasseraufwand, bei 1,5 ha 600 l Spritzbrühe – beide gesperrt', async () => {
    const mf = await laden()
    for (const schritte of [[['aufwand', '2'], ['konzentration', '0,5']], [['konzentration', '0,5'], ['aufwand', '2']]]) {
      const m = tippe(mf, schritte)
      assert.equal(m.berechnet, 'wasser')
      assert.deepEqual([m.wasserBerechnet, m.mengeGesamtBerechnet], [400, 600])
      assert.deepEqual(m.gesperrt, { aufwandmenge: false, konzentration: false, wasser: true, mengeGesamt: true })
      assert.equal(m.berechnetHinweis.wasser, 'Automatisch berechnet aus Aufwandmenge ÷ Konzentration (%) × 100.')
      assert.equal(m.berechnetHinweis.mengeGesamt, 'Automatisch berechnet aus Wasseraufwand (l/ha) × Fläche.')
      assert.deepEqual([m.eingabe.wasserLHa, m.eingabe.mengeGesamt, m.eingabe.aufwand], [400, 600, 2])
      const p = gueltig(m.pruefung)
      assert.deepEqual([p.werte.wasseraufwand_l_ha, p.werte.menge_gesamt, p.mittelmenge.menge], [400, 600, 3])
      assert.equal(m.konzentrationHinweis, null)
      // die eingegebenen Felder bleiben änderbar: neue Konzentration → neuer Wasseraufwand
      const neu = tippe(mf, [...schritte, ['konzentration', '0,25']])
      assert.deepEqual([neu.wasserBerechnet, neu.mengeGesamtBerechnet], [800, 1200])
    }
    // kg/ha genauso; ohne Fläche Wasseraufwand ja, Spritzbrühe gesperrt und leer
    const kg = tippe(mf, [['aufwand', '0,6'], ['konzentration', '0,15']], { aufwandmengeEinheit: 'kg_ha', flaecheHa: null })
    assert.deepEqual([kg.wasserBerechnet, kg.mengeGesamtBerechnet, kg.gesperrt.mengeGesamt, kg.eingabe.mengeGesamt], [400, null, true, null])
    assert.equal(kg.berechnetHinweis.mengeGesamt, 'Wird berechnet, sobald Ried(en) ausgewählt sind.')
    assert.equal(mf.mengenFelder({ ...eingaben(mf, { aufwandmenge: '2', konzentration: '0,5', folge: ['aufwand', 'konzentration'], flaecheHa: null }), formular: 'bearbeiten' }).berechnetHinweis.mengeGesamt,
      'Ohne zugeordnete Grundstücke nicht berechenbar.')
  })

  test('bisherige Wege bleiben: Wasseraufwand bzw. Spritzbrühe → Konzentration; Konzentration + Wasseraufwand → Aufwand', async () => {
    const mf = await laden()
    const w = tippe(mf, [['aufwand', '2'], ['wasser', '400']])
    assert.equal(w.berechnet, 'konzentration')
    assert.ok(Math.abs(w.konzentrationBerechnet - 0.5) < 1e-9)
    assert.deepEqual([w.gesperrt.konzentration, w.gesperrt.wasser, w.mengeGesamtBerechnet], [true, false, 600])
    assert.equal(w.berechnetHinweis.konzentration, 'Automatisch berechnet aus Aufwandmenge ÷ Wasseraufwand (l/ha) × 100.')
    const b = tippe(mf, [['aufwand', '2'], ['gesamt', '600']])
    assert.deepEqual([b.berechnet, b.wasserBerechnet, b.gesperrt.wasser, b.gesperrt.mengeGesamt], ['konzentration', 400, true, false])
    assert.ok(Math.abs(b.konzentrationBerechnet - 0.5) < 1e-9)
    // Spritzbrühe zuerst, dann Aufwand: ebenfalls Konzentration
    assert.equal(tippe(mf, [['gesamt', '600'], ['aufwand', '2']]).berechnet, 'konzentration')
    const a = tippe(mf, [['konzentration', '0,5'], ['wasser', '400']])
    assert.deepEqual([a.berechnet, a.aufwandmengeBerechnet, a.gesperrt.aufwandmenge], ['aufwand', 2, true])
    assert.equal(a.berechnetHinweis.aufwandmenge, 'Automatisch berechnet aus Konzentration (%) × Wasseraufwand (l/ha) ÷ 100.')
    assert.equal(gueltig(a.pruefung).mittelmenge.menge, 3)
    // Konzentration geleert: nichts mehr berechnet, der Wasseraufwand (hier nie eingegeben) ist wieder frei
    const leer = tippe(mf, [['aufwand', '2'], ['konzentration', '0,5'], ['konzentration', '']])
    assert.deepEqual([leer.berechnet, leer.gesperrt.wasser, leer.gesperrt.mengeGesamt, leer.eingabe.wasserLHa], [null, false, false, null])
  })

  test('g/hl, ml/hl unverändert: nur Aufwand ↔ Konzentration, der Wasseraufwand wird nie berechnet', async () => {
    const mf = await laden()
    const g = tippe(mf, [['aufwand', '25']], { aufwandmengeEinheit: 'g_hl' })
    assert.deepEqual([g.berechnet, g.konzentrationBerechnet], ['konzentration', 0.025])
    const k = tippe(mf, [['konzentration', '0,05'], ['wasser', '400']], { aufwandmengeEinheit: 'ml_hl' })
    assert.deepEqual([k.berechnet, k.aufwandmengeBerechnet, k.wasserBerechnet, k.gesperrt.wasser], ['aufwand', 50, null, false])
    // kg bzw. l gesamt: nichts wird berechnet
    const gesamt = tippe(mf, [['aufwand', '3'], ['konzentration', '0,5']], { aufwandmengeEinheit: 'l' })
    assert.deepEqual([gesamt.berechnet, gesamt.wasserBerechnet, gesamt.konzentrationHinweis], [null, null, null])
  })

  test('Randfälle: Konzentration 0 teilt nicht durch 0, leere und ungültige Eingaben rechnen nicht', async () => {
    const mf = await laden()
    const null0 = tippe(mf, [['aufwand', '2'], ['konzentration', '0']])
    assert.deepEqual([null0.berechnet, null0.wasserBerechnet, null0.gesperrt.wasser], [null, null, false])
    assert.match(null0.konzentrationHinweis, /^Aus einer Konzentration von 0 % lässt sich der Wasseraufwand nicht berechnen/)
    // Aufwand 0: kein Wasseraufwand (0 l/ha wäre keine Spritzbrühe)
    assert.equal(tippe(mf, [['aufwand', '0'], ['konzentration', '0,5']]).wasserBerechnet, null)
    // ungültige Konzentration: Fehler, keine Rechnung
    const falsch = tippe(mf, [['aufwand', '2'], ['konzentration', '120']])
    assert.deepEqual([falsch.berechnet, falsch.konzentrationFehler], [null, '„Konzentration (%)“ muss zwischen 0 und 100 liegen.'])
    const text = tippe(mf, [['aufwand', '2'], ['konzentration', 'abc']])
    assert.deepEqual([text.berechnet, text.konzentrationFehler], [null, '„Konzentration (%)“ ist keine gültige Zahl.'])
    // nur die Konzentration: Hinweis nennt Aufwand bzw. Wasseraufwand
    assert.equal(tippe(mf, [['konzentration', '0,5']]).konzentrationHinweis,
      'Für die automatische Berechnung bitte Aufwandmenge, Wasseraufwand (l/ha) oder Spritzbrühe gesamt angeben.')
    // Düngung: kein Konzentrationsfeld – nichts berechnet, auch mit eingegebenen Feldern
    const d = mf.mengenFelder(eingaben(mf, { art: 'duengung', felder: mf.MENGEN_SICHT.duengung, aufwandmenge: '2', aufwandmengeEinheit: 'kg_ha', konzentration: '0,5', folge: ['aufwand', 'konzentration'], mengeGesamt: '100' }))
    assert.deepEqual([d.berechnet, d.wasserBerechnet, d.eingabe.wasserLHa, d.eingabe.konzentrationPct], [null, null, null, null])
  })

  test('Bearbeiten: gespeicherte Werte bleiben unberechnet, bis ein Feld geändert wird', async () => {
    const mf = await laden()
    const gespeichert = { aufwandmenge: '2', konzentration: '0,4', wasseraufwand: '400', mengeGesamt: '600', formular: 'bearbeiten' }
    const start = mf.mengenFelder(eingaben(mf, gespeichert))
    assert.equal(start.berechnet, null)
    assert.deepEqual(start.gesperrt, { aufwandmenge: false, konzentration: false, wasser: false, mengeGesamt: false })
    // Aufwand geändert → Konzentration folgt (wie bisher), Wasseraufwand und Spritzbrühe bleiben
    const a = mf.mengenFelder(eingaben(mf, { ...gespeichert, aufwandmenge: '3', folge: ['aufwand'] }))
    assert.equal(a.berechnet, 'konzentration')
    assert.ok(Math.abs(a.konzentrationBerechnet - 0.75) < 1e-9)
    // Konzentration geändert → Aufwand folgt
    const k = mf.mengenFelder(eingaben(mf, { ...gespeichert, konzentration: '0,5', folge: ['konzentration'] }))
    assert.deepEqual([k.berechnet, k.aufwandmengeBerechnet], ['aufwand', 2])
  })

  test('Quelltext: beide Formulare führen die Reihenfolge und zeigen die Sperren samt Hinweis', () => {
    for (const rel of ['app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx', 'app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx']) {
      const q = readFileSync(path.join(SRC, rel), 'utf8')
      assert.doesNotMatch(q, /aufwandQuelle/, rel)
      for (const [groesse, n] of [['aufwand', 1], ['konzentration', 1], ['wasser', 2]]) {
        const treffer = q.match(new RegExp(`setFolge\\(f => eingabeFolge\\(f, '${groesse}', v\\)\\)`, 'g')) ?? []
        assert.equal(treffer.length, n, `${rel}: ${groesse}`)
      }
      for (const f of ['wasser', 'mengeGesamt', 'konzentration', 'aufwandmenge']) assert.match(q, new RegExp(`m\\.gesperrt\\.${f}`), `${rel}: ${f}`)
      for (const f of ['wasser', 'mengeGesamt', 'aufwandmenge']) assert.match(q, new RegExp(`\\{m\\.berechnetHinweis\\.${f} && \\(`), `${rel}: ${f}`)
      assert.match(q, /mengeGesamtGesperrt \? '' : mengeGesamt/, rel)
    }
  })
})
