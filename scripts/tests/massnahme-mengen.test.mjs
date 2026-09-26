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
