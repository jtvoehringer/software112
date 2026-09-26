// KAN-143 (26.09.2026): neue Maßnahmen-Art „Laubschneiden“ – eine Artenliste für alle Stellen
// (src/lib/behandlungen/arten.ts) gegen die DB-CHECKs, Feld- und Mengen-Matrix, Labels in
// Behördenmeldungen und Rückverfolgung, Assistent (Tool-Schema und Handler) sowie Quelltext-Prüfungen,
// dass keine Stelle eine eigene, veraltete Artenliste führt.
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/massnahmen-arten.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; läuft auch über npm run test:csv)
//
// Resolve-Hook wie in pflanzenschutz.test.mjs ('@/'-Aliase, endungslose Importe, 'server-only'); für den
// Assistenten ersetzt er zusätzlich die Server Action createBehandlung und getCurrentMembership durch
// Attrappen – der Test speichert nichts. createBehandlung/updateBehandlung selbst laufen gegen eine
// Supabase-Attrappe (merkt sich insert/update); Betriebs-, Schreibsperren-Prüfung und revalidatePath
// sind leer.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

// ── Stand der Datenbank ─────────────────────────────────────────────────────────
// Werte der CHECKs nach Migration 20260926175835_kan143_laubschneiden, live per SELECT auf
// pg_constraint geprüft am 26.09.2026 (Produktion und Staging). Ändert sich ein CHECK, zuerst hier und in
// lib/behandlungen/arten.ts nachziehen.
const DB_BEHANDLUNGEN_ART_CHECK = ['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'laubschneiden', 'lese', 'sonstiges']
const DB_SAETZE_ART_CHECK = ['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'laubschneiden', 'sonstiges']

// Attrappen für den Assistenten: createBehandlung merkt sich die FormData, statt zu speichern
globalThis.__kan143Aufrufe = []
const ATTRAPPEN = {
  '@/app/(dashboard)/behandlungen/actions':
    'export async function createBehandlung(fd) { globalThis.__kan143Aufrufe.push(fd); return { id: "b-neu", hinweise: [] } }',
  '@/lib/auth/roles':
    'export async function getCurrentMembership() { return { tenantId: "t-1", role: "winzer" } }',
  '@/lib/supabase/server':
    'export async function createSupabaseServerClient() { return globalThis.__kan143Supabase }',
  '@/lib/auth/seitenBetrieb': 'export async function pruefeSeitenBetrieb() {}',
  '@/lib/auth/sperren': 'export async function pruefeSchreibzugriff() {}',
  'next/cache': 'export function revalidatePath() {}',
}

// Supabase-Attrappe für die Server Actions: Abfragen sind verkettbar und awaitbar, insert/update werden
// in schreiben gemerkt. Eine Maßnahme auf einem GST mit 2 ha.
function supabaseAttrappe() {
  const schreiben = []
  const antwort = (tabelle, op) => {
    if (tabelle === 'grundstuecke') return { data: [{ id: 'g-1', weingarten_id: 'w-1', flaeche_ha: 2 }], error: null }
    if (tabelle === 'behandlungen' && op === 'insert') return { data: { id: 'b-neu' }, error: null }
    if (tabelle === 'behandlungen' && op === 'select') return { data: { id: 'b-1', behandlung_grundstuecke: [{ flaeche_ha: 2 }] }, error: null }
    return { data: null, error: null }
  }
  return {
    schreiben,
    from(tabelle) {
      let op = 'select'
      const q = {
        select: () => q, eq: () => q, in: () => q, or: () => q,
        insert(p) { op = 'insert'; schreiben.push({ tabelle, op, p }); return q },
        update(p) { op = 'update'; schreiben.push({ tabelle, op, p }); return q },
        delete() { op = 'delete'; schreiben.push({ tabelle, op }); return q },
        single: () => Promise.resolve(antwort(tabelle, op)),
        maybeSingle: () => Promise.resolve(antwort(tabelle, op)),
        then: (ok, fehler) => Promise.resolve(antwort(tabelle, op)).then(ok, fehler),
      }
      return q
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }
}

const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(spezifizierer, kontext, weiter) {
      if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
      if (ATTRAPPEN[spezifizierer]) return { url: 'data:text/javascript,' + encodeURIComponent(ATTRAPPEN[spezifizierer]), shortCircuit: true }
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

const laden = (rel) => import(pathToFileURL(path.join(SRC, rel)).href)
const [arten, psm, rueck, feld, mengen, massnahmeMengen, tool, aktionen] = hooksMoeglich
  ? await Promise.all([
      laden('lib/behandlungen/arten.ts'), laden('lib/behoerden/psm.ts'), laden('lib/behoerden/rueckverfolgung.ts'),
      laden('app/(dashboard)/behandlungen/neu/feldMatrix.ts'), laden('app/(dashboard)/behandlungen/neu/mengenFelder.ts'),
      laden('lib/behandlungen/massnahmeMengen.ts'), laden('lib/assistent/tools/massnahme.ts'),
      laden('app/(dashboard)/behandlungen/actions.ts'),
    ])
  : []
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

const quelle = (rel) => readFileSync(path.join(SRC, rel), 'utf8')

// ── Artenliste gegen die DB-CHECKs ──────────────────────────────────────────────

describe('Artenliste (lib/behandlungen/arten.ts) = DB-CHECKs', nurMitHooks, () => {
  test('Werte und Reihenfolge wie behandlungen_art_check bzw. saetze_massnahmen_art_check', () => {
    assert.deepEqual([...arten.BEHANDLUNG_ARTEN], DB_BEHANDLUNGEN_ART_CHECK)
    assert.deepEqual([...arten.MASSNAHMEN_ARTEN], DB_SAETZE_ART_CHECK)
    assert.deepEqual(Object.keys(arten.MASSNAHMEN_ART_LABEL), DB_BEHANDLUNGEN_ART_CHECK)
  })

  // Migration 20260926175835_kan143_laubschneiden (seit PR #60 im Repo) – fehlt sie, schlägt der Test fehl
  test('Migration kan143_laubschneiden liegt im Repo, ihre CHECKs stimmen mit den Konstanten überein', () => {
    const verzeichnis = path.resolve(SRC, '../supabase/migrations')
    const treffer = readdirSync(verzeichnis).filter(d => /^\d{14}_kan143_laubschneiden\.sql$/.test(d))
    assert.equal(treffer.length, 1, `Migration *_kan143_laubschneiden.sql fehlt oder ist doppelt: ${treffer.join(', ')}`)
    const sql = readFileSync(path.join(verzeichnis, treffer[0]), 'utf8')
    const check = (name) => {
      const m = sql.match(new RegExp(`ADD\\s+CONSTRAINT\\s+${name}\\s+CHECK\\s*\\(\\s*art\\s+IN\\s*\\(([^)]*)\\)`, 'i'))
      assert.ok(m, `${treffer[0]}: ADD CONSTRAINT ${name} nicht gefunden`)
      return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
    }
    assert.deepEqual(check('behandlungen_art_check'), DB_BEHANDLUNGEN_ART_CHECK)
    assert.deepEqual(check('saetze_massnahmen_art_check'), DB_SAETZE_ART_CHECK)
  })

  test('Bezeichnungen, Laubschneiden direkt nach Laubarbeit', () => {
    assert.equal(arten.MASSNAHMEN_ART_LABEL.laubschneiden, 'Laubschneiden')
    assert.equal(arten.MASSNAHMEN_ART_LABEL.laubarbeit, 'Laubarbeit')
    const reihe = arten.MASSNAHMEN_ARTEN
    assert.equal(reihe.indexOf('laubschneiden'), reihe.indexOf('laubarbeit') + 1)
    for (const [art, label] of Object.entries(arten.MASSNAHMEN_ART_LABEL)) {
      assert.match(label, /^[A-ZÄÖÜ][a-zäöüß]+$/, `${art}: Bezeichnung „${label}“`)
      assert.doesNotMatch(label, /ae|oe|ue/, `${art}: Umlaute statt ae/oe/ue`)
    }
  })

  test('istMassnahmenArt: Lese und Unbekanntes sind keine Maßnahmenart des Formulars', () => {
    assert.equal(arten.istMassnahmenArt('laubschneiden'), true)
    for (const x of ['lese', 'Laubschneiden', 'laubschnitt', '', null, undefined, 3]) assert.equal(arten.istMassnahmenArt(x), false, String(x))
  })

  test('massnahmenArtLabel: Bezeichnung, Rohwert für Unbekanntes, leer → null', () => {
    assert.equal(arten.massnahmenArtLabel('laubschneiden'), 'Laubschneiden')
    assert.equal(arten.massnahmenArtLabel('lese'), 'Lese')
    assert.equal(arten.massnahmenArtLabel('rodung'), 'rodung')
    assert.equal(arten.massnahmenArtLabel(''), null)
    assert.equal(arten.massnahmenArtLabel(null), null)
    assert.equal(arten.massnahmenArtLabel('toString'), 'toString')   // kein Prototyp-Treffer
  })

  test('laubarbeit_art nur bei Laubarbeit – bei Laubschneiden null', () => {
    assert.equal(arten.laubarbeitArtFuer('laubarbeit', 'gipfeln'), 'gipfeln')
    assert.equal(arten.laubarbeitArtFuer('laubschneiden', 'gipfeln'), null)
    assert.equal(arten.laubarbeitArtFuer('spritzung', 'heften'), null)
    assert.equal(arten.laubarbeitArtFuer('laubarbeit', null), null)
    assert.deepEqual(arten.LAUBARBEIT_OPTIONEN.map(o => o.value), ['entblaettern', 'ausgeizen', 'gipfeln', 'heften', 'sonstige'])
  })

  test('laubarbeitArtFehlt: Laubarbeit braucht ihre Unterart, alle anderen Arten nicht', () => {
    assert.equal(arten.laubarbeitArtFehlt('laubarbeit', null), true)
    assert.equal(arten.laubarbeitArtFehlt('laubarbeit', ''), true)
    assert.equal(arten.laubarbeitArtFehlt('laubarbeit', undefined), true)
    assert.equal(arten.laubarbeitArtFehlt('laubarbeit', 'gipfeln'), false)
    for (const art of DB_BEHANDLUNGEN_ART_CHECK.filter(a => a !== 'laubarbeit')) assert.equal(arten.laubarbeitArtFehlt(art, null), false, art)
    assert.equal(arten.LAUBARBEIT_ART_FEHLT, 'Bitte die Art der Laubarbeit wählen.')
  })

  test('laubarbeitAltwert: ältere Freitext-Unterart bleibt, bekannte Werte und leer → null', () => {
    // Freitexte wie im Demo-Betrieb (demo_musterhof_zuruecksetzen)
    for (const alt of ['Ausbrechen', 'Ausdünnen / Grünlese', 'Entblättern Traubenzone', 'Heften / Einstricken']) {
      assert.equal(arten.laubarbeitAltwert(alt), alt)
    }
    for (const o of arten.LAUBARBEIT_OPTIONEN) assert.equal(arten.laubarbeitAltwert(o.value), null, o.value)
    for (const leer of [null, undefined, '', '  ']) assert.equal(arten.laubarbeitAltwert(leer), null, String(leer))
  })

  test('mittelFuerArt: Mittel und Wartezeit nur, wenn die Art das Mittel kennt', () => {
    const alles = { psmId: 'p-1', duengemittelId: 'd-1', wartezeitTage: 35 }
    for (const art of ['laubschneiden', 'laubarbeit', 'schnitt', 'bodenbearbeitung', 'lese', null]) {
      assert.deepEqual(arten.mittelFuerArt(art, alles), { psmId: null, duengemittelId: null, wartezeitTage: null }, String(art))
    }
    assert.deepEqual(arten.mittelFuerArt('spritzung', alles), { psmId: 'p-1', duengemittelId: null, wartezeitTage: 35 })
    assert.deepEqual(arten.mittelFuerArt('sonstiges', alles), { psmId: 'p-1', duengemittelId: null, wartezeitTage: 35 })
    assert.deepEqual(arten.mittelFuerArt('duengung', alles), { psmId: null, duengemittelId: 'd-1', wartezeitTage: 35 })
    // Wartezeit ohne passendes Mittel (z. B. Düngemittel bei einer Spritzung) gilt nicht
    assert.deepEqual(arten.mittelFuerArt('spritzung', { psmId: null, duengemittelId: 'd-1', wartezeitTage: 35 }), { psmId: null, duengemittelId: null, wartezeitTage: null })
    assert.equal(arten.artMitPsm('laubschneiden'), false)
    assert.equal(arten.artMitDuengemittel('duengung'), true)
  })

  test('Maßnahmenliste: Art-Filter und Freitext finden Laubschneiden', () => {
    const liste = [
      { id: 1, art: 'laubschneiden', weingarten_name: 'Stein', weingarten_ried: 'Stein', psm_name: null },
      { id: 2, art: 'laubarbeit', weingarten_name: 'Hölle', weingarten_ried: null, psm_name: null },
      { id: 3, art: 'spritzung', weingarten_name: 'Stein', weingarten_ried: 'Stein', psm_name: 'Funguran' },
    ]
    const ids = (l) => l.map(b => b.id)
    assert.deepEqual(ids(arten.filterMassnahmen(liste, '', '')), [1, 2, 3])
    assert.deepEqual(ids(arten.filterMassnahmen(liste, 'laubschneiden', '')), [1])
    assert.deepEqual(ids(arten.filterMassnahmen(liste, 'laubarbeit', '')), [2])
    assert.deepEqual(ids(arten.filterMassnahmen(liste, '', 'Laubschn')), [1])        // über die Bezeichnung der Art
    assert.deepEqual(ids(arten.filterMassnahmen(liste, '', 'laub')), [1, 2])
    assert.deepEqual(ids(arten.filterMassnahmen(liste, 'laubschneiden', 'stein')), [1])
    assert.deepEqual(ids(arten.filterMassnahmen(liste, '', 'FUNG')), [3])
    assert.deepEqual(arten.artFilterOptionen(liste), arten.BEHANDLUNG_ARTEN.filter(a => a !== 'lese'))
    assert.ok(arten.artFilterOptionen([...liste, { art: 'lese' }]).includes('lese'))
  })
})

// ── Server Actions: Mittel und Wartezeit je Art ─────────────────────────────────

describe('createBehandlung/updateBehandlung: bei Arten ohne Mittel kein psm_id und keine Wartezeit', nurMitHooks, () => {
  const formular = (felder) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(felder)) fd.set(k, v)
    return fd
  }
  // wie nach einem Artwechsel Spritzung → Laubschneiden im Bearbeiten-Formular bzw. vom Assistenten mitgeschickt
  // (laubarbeit_art geht nur bei einer Laubarbeit mit, dort ist sie Pflicht)
  const MIT_MITTEL = { datum: '2026-07-02', grundstueck_ids: 'g-1', psm_id: 'p-1', duengemittel_id: 'd-1', wartezeit_tage: '14', laubarbeit_art: 'gipfeln' }
  const gespeichert = (op) => globalThis.__kan143Supabase.schreiben.find(s => s.tabelle === 'behandlungen' && s.op === op)?.p

  for (const art of ['laubschneiden', 'laubarbeit', 'schnitt', 'bodenbearbeitung']) {
    test(`${art}: anlegen und bearbeiten ohne psm_id, duengemittel_id und ernte_fruehesteins`, async () => {
      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.createBehandlung(formular({ ...MIT_MITTEL, art }))
      const neu = gespeichert('insert')
      assert.equal(neu.art, art)
      assert.deepEqual([neu.psm_id, neu.duengemittel_id, neu.ernte_fruehesteins], [null, null, null])

      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.updateBehandlung('b-1', formular({ ...MIT_MITTEL, art }))
      const upd = gespeichert('update')
      assert.equal(upd.art, art)
      assert.deepEqual([upd.psm_id, upd.duengemittel_id, upd.ernte_fruehesteins], [null, null, null])
      assert.equal(neu.laubarbeit_art, art === 'laubarbeit' ? 'gipfeln' : null)
      assert.equal(upd.laubarbeit_art, art === 'laubarbeit' ? 'gipfeln' : null)
    })
  }

  test('Laubarbeit ohne Art der Laubarbeit: anlegen und bearbeiten abgelehnt, nichts geschrieben', async () => {
    const ohne = { ...MIT_MITTEL, art: 'laubarbeit' }
    delete ohne.laubarbeit_art
    for (const aufruf of [
      () => aktionen.createBehandlung(formular(ohne)),
      () => aktionen.updateBehandlung('b-1', formular(ohne)),   // z. B. nach Wechsel Laubschneiden → Laubarbeit
      () => aktionen.updateBehandlung('b-1', formular({ ...ohne, laubarbeit_art: '' })),
    ]) {
      globalThis.__kan143Supabase = supabaseAttrappe()
      await assert.rejects(aufruf, { message: 'Bitte die Art der Laubarbeit wählen.' })
      assert.deepEqual(globalThis.__kan143Supabase.schreiben, [])
    }
  })

  test('Laubarbeit mit älterer Freitext-Unterart: Bearbeiten speichert sie unverändert', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.updateBehandlung('b-1', formular({ ...MIT_MITTEL, art: 'laubarbeit', laubarbeit_art: 'Ausbrechen' }))
    assert.equal(gespeichert('update').laubarbeit_art, 'Ausbrechen')
  })

  test('Gegenprobe: Sonstiges mit Mittel behält psm_id und Wartezeit (Datum + 14 Tage)', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.updateBehandlung('b-1', formular({ ...MIT_MITTEL, art: 'sonstiges' }))
    const upd = gespeichert('update')
    assert.deepEqual([upd.psm_id, upd.duengemittel_id, upd.ernte_fruehesteins], ['p-1', null, '2026-07-16'])
  })
})

// ── Feld- und Mengen-Matrix ─────────────────────────────────────────────────────

describe('Feld- und Mengen-Matrix für Laubschneiden', nurMitHooks, () => {
  test('jede Maßnahmenart hat genau eine Zeile in FELD_MATRIX und MENGEN_SICHT', () => {
    assert.deepEqual(Object.keys(feld.FELD_MATRIX), DB_SAETZE_ART_CHECK)
    assert.deepEqual(Object.keys(mengen.MENGEN_SICHT), DB_SAETZE_ART_CHECK)
  })

  test('wie Laubarbeit, aber ohne „Art der Laubarbeit“: BBCH optional, Witterung und Temperatur ausgeblendet', () => {
    const ls = feld.FELD_MATRIX.laubschneiden
    assert.equal(ls.laubarbeitArt, 'hidden')
    assert.equal(ls.bbch, 'optional')
    assert.equal(ls.witterung, 'hidden')
    assert.equal(ls.temperatur, 'hidden')
    assert.deepEqual({ ...ls, laubarbeitArt: 'pflicht' }, feld.FELD_MATRIX.laubarbeit)
    // sonst nichts sichtbar: kein Mittel, kein Dünger, keine Schnittart, keine Bearbeitung
    assert.deepEqual(Object.entries(ls).filter(([, s]) => s !== 'hidden').map(([k]) => k), ['bbch'])
  })

  test('Mengenfelder wie Laubarbeit: alle ausgeblendet, keine Menge gespeichert', () => {
    assert.deepEqual(mengen.MENGEN_SICHT.laubschneiden, mengen.MENGEN_SICHT.laubarbeit)
    assert.ok(Object.values(mengen.MENGEN_SICHT.laubschneiden).every(s => s === 'hidden'))
    const r = massnahmeMengen.pruefeMassnahmeMengen({
      art: 'laubschneiden', psmId: null, duengemittelId: null, aufwand: null, aufwandEinheit: null,
      mengeGesamt: null, mengeEinheit: null, wasserLHa: null, flaecheHa: 2,
    }, { bruehePflicht: true })
    assert.equal(r.ok, true)
    assert.equal(r.werte.reinkupfer_kg_ha, null)
    assert.equal(r.spritzbruehe, null)
  })

  test('Bearbeiten: BBCH bei Laubarbeit/Laubschneiden, Wetterfelder bei Laubschneiden nur mit gespeichertem Wert', () => {
    assert.equal(feld.bbchBeimBearbeiten('laubschneiden', null), true)
    assert.equal(feld.bbchBeimBearbeiten('laubarbeit', null), true)
    assert.equal(feld.bbchBeimBearbeiten('schnitt', null), false)
    assert.equal(feld.bbchBeimBearbeiten('schnitt', '09'), true)     // gespeichertes Stadium nicht still leeren
    assert.equal(feld.bbchBeimBearbeiten('lese', null), false)       // unbekannte Art: kein Absturz
    assert.equal(feld.wetterBeimBearbeiten('laubschneiden', { witterung: null, temperatur_c: null }), false)
    assert.equal(feld.wetterBeimBearbeiten('laubschneiden', null), false)
    assert.equal(feld.wetterBeimBearbeiten('laubschneiden', { witterung: 'sonnig', temperatur_c: null }), true)
    assert.equal(feld.wetterBeimBearbeiten('laubschneiden', { witterung: null, temperatur_c: 0 }), true)
    for (const art of ['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'sonstiges']) {
      assert.equal(feld.wetterBeimBearbeiten(art, null), true, art)   // bisherige Arten unverändert
    }
  })

  test('Bearbeiten: gespeichertes BBCH außerhalb der Auswahlliste bleibt als eigene Option (bbchAltwert)', () => {
    // Codes im Musterhof (SELECT 26.09.2026): Laubarbeit 68/83, Bodenbearbeitung 05/83, Düngung 07, Schnitt 00,
    // Spritzung 13/79 – ohne eigene Option wäre „– Auswählen –“ gewählt und Speichern leerte das Stadium
    for (const code of ['68', '83', '05', '07', '00', '13', '79']) {
      assert.ok(!feld.BBCH_OPTIONS.some(o => o.value === code), `${code} steht nicht in BBCH_OPTIONS`)
      assert.equal(feld.bbchAltwert(code), code, code)
    }
    assert.equal(feld.BBCH_OPTIONS.length, 15)
    for (const o of feld.BBCH_OPTIONS) assert.equal(feld.bbchAltwert(o.value), null, o.value)
    for (const leer of [null, undefined, '', '  ']) assert.equal(feld.bbchAltwert(leer), null, String(leer))
    assert.equal(feld.bbchBeimBearbeiten('schnitt', '00'), true)
    assert.equal(feld.bbchBeimBearbeiten('bodenbearbeitung', '83'), true)
  })
})

// ── Behördenmeldungen, Auswertungen, Rückverfolgung ─────────────────────────────

describe('Labels und Art-Filter in Pflanzenschutz-Aufzeichnung und Rückverfolgung', nurMitHooks, () => {
  test('psm.ART_LABEL: alle DB-Werte, Art-Filter ?art=laubschneiden gültig', () => {
    assert.deepEqual(Object.keys(psm.ART_LABEL), DB_BEHANDLUNGEN_ART_CHECK)
    assert.equal(psm.ART_LABEL.laubschneiden, 'Laubschneiden')
    assert.equal(psm.artAus('laubschneiden'), 'laubschneiden')
    assert.equal(psm.artAus('laubschnitt'), undefined)
    assert.equal(psm.artAus('all'), null)
  })

  test('Aufzeichnung (Druck und CSV): Art „Laubschneiden“, keine Mittelmenge, keine Warnung', () => {
    const b = psm.normalisiereBehandlung({
      id: 'b-ls', datum: '2026-07-02', datum_bis: null, art: 'laubschneiden', bbch_stadium: '73',
      weingarten: null, psm: null, duengemittel: null,
      behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 1.5, grundstueck: { id: 'g-1', gst_nr: '123/1', katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: 1.5, weingarten: null } }],
    })
    assert.equal(psm.behandlungKurz(b), 'Laubschneiden am 02.07.2026')
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen([b])
    assert.deepEqual(warnungen, [])
    assert.deepEqual(zeilen.map(z => [z.art, z.bbch, z.mittelmengeAnteil, z.spritzbruehAnteil]), [['Laubschneiden', '73', null, null]])
  })

  test('Rückverfolgung: BEHANDLUNG_ART_LABEL und Maßnahmentext', () => {
    for (const art of DB_SAETZE_ART_CHECK) assert.equal(rueck.BEHANDLUNG_ART_LABEL[art], arten.MASSNAHMEN_ART_LABEL[art], art)
    assert.equal(rueck.massnahmeMittel({ art: 'laubschneiden', psm: null }), 'Laubschneiden')
    assert.equal(rueck.massnahmeMittel({ art: 'laubarbeit', psm: null }), 'Laubarbeit')
    const m = { behandlung: { id: 'b1', datum: '2025-07-10', datum_bis: '2025-07-11', art: 'laubschneiden', psm: null }, nurWeingarten: false, grundstuecke: ['7/1'], flaecheHa: null }
    assert.equal(rueck.massnahmeText(m, true), '10.07.2025–11.07.2025 Laubschneiden (GST 7/1)')
  })
})

// ── Assistent ───────────────────────────────────────────────────────────────────

describe('Assistent: Tool massnahme_dokumentieren kennt Laubschneiden', nurMitHooks, () => {
  const EINGABE = { bestaetigt_vom_user: true, datum: '2026-07-02', weingarten_ids: ['w-1'] }

  test('Schema: enum = saetze_massnahmen_art_check, Beschreibung und Feld-Matrix nennen Laubschneiden', () => {
    const p = tool.MASSNAHME_TOOL.input_schema.properties
    assert.deepEqual(p.art.enum, DB_SAETZE_ART_CHECK)
    assert.match(tool.MASSNAHME_TOOL.description, /Laubarbeit, Laubschneiden oder Sonstiges/)
    assert.match(p.art.description, /laubschneiden = maschinelles Laubschneiden/)
    assert.deepEqual(p.laubarbeit_art.enum, arten.LAUBARBEIT_OPTIONEN.map(o => o.value))
    assert.match(tool.MASSNAHME_FELD_MATRIX_TEXT, /- laubschneiden: +bbch_stadium \(optional\); KEIN laubarbeit_art/)
    // jede Art des Schemas hat eine Zeile in der Feld-Matrix des Systemprompts
    for (const art of DB_SAETZE_ART_CHECK) assert.match(tool.MASSNAHME_FELD_MATRIX_TEXT, new RegExp(`^- ${art}:`, 'm'), art)
  })

  test('legt Laubschneiden an – laubarbeit_art wird nicht mitgeschickt', async () => {
    globalThis.__kan143Aufrufe.length = 0
    const r = await tool.fuehreMassnahmeDokumentierenAus({ ...EINGABE, art: 'laubschneiden', laubarbeit_art: 'gipfeln', bbch_stadium: '73' }, null)
    assert.deepEqual(r, { erfolg: true, behandlung_id: 'b-neu' })
    assert.equal(globalThis.__kan143Aufrufe.length, 1)
    const fd = globalThis.__kan143Aufrufe[0]
    assert.equal(fd.get('art'), 'laubschneiden')
    assert.equal(fd.get('bbch_stadium'), '73')
    assert.deepEqual(fd.getAll('weingarten_ids'), ['w-1'])
    assert.equal(fd.has('laubarbeit_art'), false)
  })

  test('Laubarbeit behält ihre Unterart', async () => {
    globalThis.__kan143Aufrufe.length = 0
    const r = await tool.fuehreMassnahmeDokumentierenAus({ ...EINGABE, art: 'laubarbeit', laubarbeit_art: 'gipfeln' }, null)
    assert.equal(r.erfolg, true)
    assert.equal(globalThis.__kan143Aufrufe[0].get('laubarbeit_art'), 'gipfeln')
  })

  test('Laubarbeit ohne Unterart: Rückfrage, nichts gespeichert', async () => {
    globalThis.__kan143Aufrufe.length = 0
    for (const laubarbeit_art of [undefined, null, '']) {
      const r = await tool.fuehreMassnahmeDokumentierenAus({ ...EINGABE, art: 'laubarbeit', laubarbeit_art }, null)
      assert.equal(r.erfolg, false, String(laubarbeit_art))
      assert.match(r.hinweis, /Bei einer Laubarbeit ist laubarbeit_art Pflicht \(entblaettern, ausgeizen, gipfeln, heften, sonstige\).*NICHTS gespeichert/)
    }
    assert.equal(globalThis.__kan143Aufrufe.length, 0)
  })

  test('unbekannte Art: abgelehnt, nichts gespeichert', async () => {
    globalThis.__kan143Aufrufe.length = 0
    for (const art of ['laubschnitt', 'lese', 'Laubschneiden']) {
      const r = await tool.fuehreMassnahmeDokumentierenAus({ ...EINGABE, art }, null)
      assert.equal(r.erfolg, false, art)
      assert.match(r.hinweis, /Unbekannte Maßnahmenart .*NICHTS gespeichert/, art)
    }
    assert.equal(globalThis.__kan143Aufrufe.length, 0)
  })
})

// ── Quelltext-Prüfungen ─────────────────────────────────────────────────────────

function dateien(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? dateien(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

describe('Quelltext: keine Stelle mit eigener, veralteter Artenliste', () => {
  test('jede Datei, die Bodenbearbeitung und Laubarbeit aufzählt, kennt auch Laubschneiden', () => {
    const fehlend = dateien(SRC)
      .filter(f => { const s = readFileSync(f, 'utf8'); return /\bbodenbearbeitung\b/i.test(s) && /\blaubarbeit\b/i.test(s) && !/laubschneiden/i.test(s) })
      .map(f => path.relative(SRC, f))
    assert.deepEqual(fehlend, [])
  })

  test('Objekte je Art (spritzung: …) nur in arten.ts oder mit Typ MassnahmenArt (Vollständigkeit prüft tsc)', () => {
    const lose = dateien(SRC)
      .filter(f => /\bspritzung\s*:\s*['"{A-Z]/.test(readFileSync(f, 'utf8')))
      .filter(f => !f.endsWith(path.join('lib', 'behandlungen', 'arten.ts')) && !/Record<MassnahmenArt\b/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(SRC, f))
    assert.deepEqual(lose, [])
  })

  test('Artenlisten als Array-Literal nur in lib/behandlungen/arten.ts', () => {
    const treffer = dateien(SRC)
      .filter(f => /'spritzung'\s*,\s*'duengung'/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(SRC, f).replaceAll('\\', '/'))
    assert.deepEqual(treffer, ['lib/behandlungen/arten.ts'])
  })

  test('alle Stellen mit Maßnahmen-Arten lesen sie aus lib/behandlungen/arten.ts', () => {
    for (const rel of [
      'app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx',
      'app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx',
      'app/(dashboard)/behandlungen/neu/feldMatrix.ts',
      'app/(dashboard)/behandlungen/neu/mengenFelder.ts',
      'app/(dashboard)/behandlungen/neu/artOptionen.ts',
      'app/(dashboard)/behandlungen/BehandlungenClient.tsx',
      'app/(dashboard)/behandlungen/actions.ts',
      'app/(dashboard)/behandlungen/lager/SaetzeClient.tsx',
      'app/(dashboard)/behandlungen/lager/actions.ts',
      'app/(dashboard)/weingarten/GrundstueckePanel.tsx',
      'lib/behoerden/psm.ts',
      'lib/behoerden/rueckverfolgung.ts',
      'lib/wein/weinbuch.ts',
      'lib/assistent/tools/massnahme.ts',
    ]) assert.match(quelle(rel), /from '@\/lib\/behandlungen\/arten'/, rel)
  })

  test('Formulare: Auswahl aus ART_OPTIONS mit eigenem Symbol für Laubschneiden (nicht Schere, nicht Blatt)', () => {
    const s = quelle('app/(dashboard)/behandlungen/neu/artOptionen.ts')
    const symbol = Object.fromEntries([...s.matchAll(/^\s+([a-z]+):\s+([A-Z][A-Za-z]+),\r?$/gm)].map(m => [m[1], m[2]]))
    assert.deepEqual(Object.keys(symbol), DB_SAETZE_ART_CHECK)
    assert.equal(symbol.laubschneiden, 'Shrub')
    assert.equal(new Set(Object.values(symbol)).size, DB_SAETZE_ART_CHECK.length, 'jede Art ein eigenes Symbol')
    for (const rel of ['app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx', 'app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx']) {
      const f = quelle(rel)
      assert.match(f, /import \{ ART_OPTIONS \} from '\.\.?\/(\.\.\/neu\/)?artOptionen'/, rel)
      assert.doesNotMatch(f, /const ART_OPTIONS\b/, rel)
      assert.match(f, /art === 'laubschneiden' && <p[^>]*>\{LAUBSCHNEIDEN_HINWEIS\}/, rel)
    }
  })

  test('Bearbeiten-Formular: BBCH/Wetter über die Feld-Matrix, Mittel beim Artwechsel geleert, Wartezeit nur vom sichtbaren Mittel', () => {
    const f = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(f, /\{art !== 'spritzung' && bbchBeimBearbeiten\(art, /)
    assert.match(f, /\{wetterBeimBearbeiten\(art, /)
    assert.match(f, /if \(!artMitPsm\(neu\)\) setSelectedPsmId\(''\)/)
    assert.match(f, /if \(!artMitDuengemittel\(neu\)\) setSelectedDuengemittelId\(''\)/)
    assert.match(f, /const wartezeit = artMitPsm\(art\) \? selectedPsm\?\.wartezeit_tage\s+: artMitDuengemittel\(art\) \? selectedDuengemittel\?\.wartezeit_tage/)
    assert.doesNotMatch(f, /selectedPsm\?\.wartezeit_tage \?\? selectedDuengemittel/)
  })

  // greift auf die per Hook geladenen Module zu → ohne Hooks übersprungen (wie massnahme-mengen.test.mjs)
  test('Art der Laubarbeit ist Pflicht – Anlegen, Bearbeiten (auch nach Artwechsel) und Server Actions', nurMitHooks, () => {
    assert.equal(feld.FELD_MATRIX.laubarbeit.laubarbeitArt, 'pflicht')
    const neu = quelle('app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
    assert.match(neu, /<select name="laubarbeit_art" required=\{felder\.laubarbeitArt === 'pflicht'\}/)
    const edit = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(edit, /import \{ BBCH_OPTIONS, FELD_MATRIX, bbchAltwert, bbchBeimBearbeiten, wetterBeimBearbeiten \} from '\.\.\/\.\.\/neu\/feldMatrix'/)
    assert.match(edit, /name="laubarbeit_art"[^>]*\s+required=\{FELD_MATRIX\.laubarbeit\.laubarbeitArt === 'pflicht'\}/)
    assert.match(edit, /Art der Laubarbeit\s+\{FELD_MATRIX\.laubarbeit\.laubarbeitArt === 'pflicht' && <span className="text-s112-err"> \*<\/span>\}/)
    const a = quelle('app/(dashboard)/behandlungen/actions.ts')
    assert.equal(a.match(/if \(laubarbeitArtFehlt\(art, laubarbeitArt\)\) throw new AktionsFehler\(LAUBARBEIT_ART_FEHLT\)/g)?.length, 2)   // Anlegen und Bearbeiten
  })

  test('Bearbeiten-Formular: ältere Freitext-Unterart der Laubarbeit bleibt als eigene Option vorausgewählt', () => {
    const edit = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(edit, /const laubarbeitBisher = laubarbeitAltwert\(behandlung\.laubarbeit_art\)/)
    assert.match(edit, /name="laubarbeit_art" defaultValue=\{behandlung\.laubarbeit_art \?\? ''\}/)
    const auswahl = edit.slice(edit.indexOf('name="laubarbeit_art"'), edit.indexOf('</select>', edit.indexOf('name="laubarbeit_art"')))
    assert.match(auswahl, /\{art === startArt && laubarbeitBisher && \(\s*<option value=\{laubarbeitBisher\}>\{laubarbeitBisher\} \(bisherige Angabe\)<\/option>/)
    assert.ok(auswahl.indexOf('laubarbeitBisher') < auswahl.indexOf('LAUBARBEIT_OPTIONEN.map'), 'Altwert-Option vor den Standardwerten')
  })

  test('BBCH: eine Auswahlliste (feldMatrix.ts) für Anlegen und Bearbeiten, Altwert in beiden BBCH-Auswahlen des Bearbeiten-Formulars', () => {
    const neu = quelle('app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
    const edit = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    for (const [name, f] of [['Anlegen', neu], ['Bearbeiten', edit]]) {
      assert.doesNotMatch(f, /const BBCH_OPTIONS\b/, name)
      assert.match(f, /import \{ BBCH_OPTIONS, FELD_MATRIX\b[^}]*\} from '(\.\/|\.\.\/\.\.\/neu\/)feldMatrix'/, name)
    }
    assert.match(edit, /const bbchBisher = bbchAltwert\(behandlung\.bbch_stadium\)/)
    const auswahlen = edit.split('name="bbch_stadium"').slice(1).map(t => t.slice(0, t.indexOf('</select>')))
    assert.equal(auswahlen.length, 2)   // Spritzung und alle anderen Arten
    for (const a of auswahlen) {
      assert.match(a, /\{bbchBisher && <option value=\{bbchBisher\}>\{bbchBisher\} \(bisherige Angabe\)<\/option>\}/)
      assert.ok(a.indexOf('bbchBisher') < a.indexOf('BBCH_OPTIONS.map'), 'Altwert-Option vor den Standardwerten')
    }
  })

  test('Bearbeiten-Formular: beide BBCH-Auswahlen teilen einen State – Stadium beim Artwechsel unabhängig vom Weg', () => {
    // Spritzung → Laubschneiden, Laubarbeit → Spritzung → Laubschneiden und eine eigene Eingabe behalten das
    // Stadium wie im Anlegen-Formular; ungesteuerte Auswahlen (defaultValue) fielen je nach Weg auf leer oder
    // den gespeicherten Wert zurück
    const edit = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(edit, /const \[bbch, setBbch\] = useState\(behandlung\.bbch_stadium \?\? ''\)/)
    const auswahlen = edit.split('name="bbch_stadium"').slice(1).map(t => t.slice(0, t.indexOf('className=')))
    assert.equal(auswahlen.length, 2)   // Spritzung und alle anderen Arten
    for (const a of auswahlen) {
      assert.match(a, /^ value=\{bbch\} onChange=\{e => setBbch\(e\.target\.value\)\}/)
      assert.doesNotMatch(a, /defaultValue/)
    }
  })

  test('Maßnahmenliste: Art-Auswahl „Alle Arten“ und Filter aus lib/behandlungen/arten.ts', () => {
    const c = quelle('app/(dashboard)/behandlungen/BehandlungenClient.tsx')
    assert.match(c, /const artOptionen = artFilterOptionen\(behandlungen\)/)
    assert.match(c, /const gefiltert = filterMassnahmen\(behandlungen, artFilter, filter\)/)
    assert.match(c, /value=\{artFilter\}/)
    assert.match(c, /<option value="">Alle Arten<\/option>/)
  })

  test('Server Actions: Mittel und Wartezeit über mittelFuerArt (Anlegen und Bearbeiten)', () => {
    const a = quelle('app/(dashboard)/behandlungen/actions.ts')
    assert.equal(a.match(/= mittelFuerArt\(art, \{/g)?.length, 2)
    assert.doesNotMatch(a, /const (psmId|wartezeit)\s+=/)
  })

  test('Server Actions: laubarbeit_art über laubarbeitArtFuer, Art geprüft (Maßnahme und Stundensatz)', () => {
    const a = quelle('app/(dashboard)/behandlungen/actions.ts')
    assert.equal(a.match(/laubarbeitArtFuer\(art,/g)?.length, 2)      // createBehandlung und updateBehandlung
    assert.equal(a.match(/= massnahmenArtAus\(formData\)/g)?.length, 2)
    assert.match(quelle('app/(dashboard)/behandlungen/lager/actions.ts'), /if \(!istMassnahmenArt\(art\)\)/)
  })

  test('Weinbuch zeigt die Bezeichnung statt des Rohwerts', () => {
    const w = quelle('lib/wein/weinbuch.ts')
    assert.match(w, /const artText = massnahmenArtLabel\(b\.art\)/)
    assert.match(w, /artText && `Art: \$\{artText\}`/)
    assert.doesNotMatch(w, /`Art: \$\{b\.art\}`/)
  })

  test('Assistent (Systemprompt) und KI-Kontext nennen Laubschneiden und grenzen es von Gipfeln ab', nurMitHooks, () => {
    const chat = quelle('app/api/assistent/chat/route.ts').replace(/\s+/g, ' ')
    assert.match(chat, /Maßnahmen dokumentieren \(Spritzung, Düngung, Bodenbearbeitung, Schnitt, Laubarbeit, Laubschneiden, Sonstiges\)/)
    const ki = quelle('app/api/ki-abfrage/route.ts').replace(/\s+/g, ' ')
    for (const art of DB_BEHANDLUNGEN_ART_CHECK) assert.ok(ki.includes(`'${art}' (${arten.MASSNAHMEN_ART_LABEL[art]}`), `KI-Kontext: ${art}`)
    assert.match(ki, /'laubschneiden' \(Laubschneiden = maschinelles Laubschneiden an Seiten und Gipfel, ohne laubarbeit_art\)/)
    assert.match(ki, /saetze_massnahmen\.art .*dieselben Werte ohne 'lese'/)
    // Unterarten mit gespeichertem Code und Bezeichnung; Suche über Wortstämme ohne Umlaut, die Code und
    // Freitext treffen ('%entblätter%' fände 'entblaettern' nicht); Datierung per Datum statt Ticketnummer
    for (const o of arten.LAUBARBEIT_OPTIONEN) assert.ok(ki.includes(`'${o.value}' (${o.label}`), `KI-Kontext: laubarbeit_art ${o.value}`)
    const wortstaemme = [...(ki.match(/UNTERARTEN \(behandlungen\.laubarbeit_art[^]*?ILIKE ((?:'%[a-z]+%'(?:, | bzw\. )?)+)/)?.[1] ?? '').matchAll(/'%([a-z]+)%'/g)].map(m => m[1])
    assert.ok(wortstaemme.length > 0, 'KI-Kontext: Wortstämme für laubarbeit_art')
    for (const o of arten.LAUBARBEIT_OPTIONEN.filter(x => x.value !== 'sonstige')) {
      for (const text of [o.value, o.label.toLowerCase()]) assert.ok(wortstaemme.some(w => text.includes(w)), `KI-Kontext: kein Wortstamm für ${text}`)
    }
    assert.doesNotMatch(ki, /vor KAN-143/)
    assert.match(ki, /vor dem 26\.09\.2026/)
  })

  test('Hilfe: FAQ und Handbuch erklären Laubschneiden, Gipfeln von Hand bleibt Laubarbeit', () => {
    const faq = quelle('app/(dashboard)/hilfe/faq/page.tsx')
    assert.match(faq, /frage: 'Laubarbeit oder Laubschneiden – was wähle ich\?'/)
    assert.match(faq, /Stundensätze für die Kosten-Vorschlagsfunktion.*Laubschneiden/)
    assert.doesNotMatch(faq, /z\.B\. Schnitt, Laubarbeit, Ernte/)   // Ernte ist keine Art der Stundensätze
    const hb = quelle('app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(hb, /titel: 'Laubarbeit oder Laubschneiden'/)
    assert.match(hb, /Gipfeln von Hand erfasst du also weiterhin als Laubarbeit/)
    // festgelegt ist nur das Gipfeln von Hand – Laubarbeit ist nicht allgemein Handarbeit
    for (const [name, s] of [['FAQ', faq], ['Handbuch', hb]]) {
      assert.match(s, /Alle anderen Arbeiten an der Laubwand/, name)
      assert.doesNotMatch(s, /Arbeiten an der Laubwand von Hand|Laubarbeit von Hand/, name)
    }
    assert.doesNotMatch(quelle('app/api/ki-abfrage/route.ts'), /'laubarbeit' \(Laubarbeit von Hand/)
    // Menüweg der Stundensätze und sichtbare Beschriftung der Art-Auswahl
    assert.match(faq, /Unter Rieden > Betriebsmittel > Tab "Stundensätze"/)
    assert.match(faq, /Unter Rieden > Betriebsmittel > Tab "Düngemittel"/)
    assert.doesNotMatch(faq, /Maßnahmen\s*(>|›)\s*Betriebsmittel/)   // Betriebsmittel ist kein Unterpunkt von Maßnahmen
    assert.match(hb, /Maßnahmenliste \(Auswahl „Alle Arten“ neben dem Suchfeld\)/)
    assert.doesNotMatch(hb, /Filter „Art der Maßnahme“/)
    // das Symbol (Shrub) gibt es nur in der Art-Auswahl der Formulare, nicht in Liste und Berichten
    assert.match(hb, /Im Formular hat Laubschneiden ein eigenes Symbol \(Strauch\); außerdem erscheint es in der Maßnahmenliste/)
    assert.doesNotMatch(hb, /mit eigenem Symbol im Formular, in der/)
  })
})
