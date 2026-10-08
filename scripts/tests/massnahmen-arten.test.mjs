// KAN-143 (26.09.2026): neue Maßnahmen-Art „Laubschneiden“ – eine Artenliste für alle Stellen
// (src/lib/behandlungen/arten.ts) gegen die DB-CHECKs, Feld- und Mengen-Matrix, Labels in
// Behördenmeldungen und Rückverfolgung, Assistent (Tool-Schema und Handler) sowie Quelltext-Prüfungen,
// dass keine Stelle eine eigene, veraltete Artenliste führt.
// KAN-152: Das Bearbeiten-Formular zeigt BBCH, Schaderreger bzw. Grund / Anlass, Witterung und Temperatur nach
// der Feld-Matrix (felderBeimBearbeiten) und sendet ausgeblendete, gespeicherte Werte bei unveränderter Art mit.
// KAN-153: „Maßnahme erfassen“ ohne Ried-Auswahl bzw. bei Bio-Sperre – Klick zeigt den Grund (absenden.ts).
// KAN-154: Einarbeitung (Modus je Art × Ausgangsart × Düngemittel, false bleibt false), Pflichtfelder beim
// Bearbeiten mit Ausnahme für Altdaten, Pflanzenschutzmittel bei Sonstiges (samt Aufwand, Lager, Bio-Sperre) und
// Bio-Sperre im Bearbeiten-Formular wie KAN-153; unverändertes Speichern aller Musterhof-Konstellationen.
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
    'export async function getCurrentMembership() { return { tenantId: "t-1", role: "winzer" } }\n' +
    // KAN-242: Lager-Actions prüfen die Freigabe Rieden – Mitarbeiter ohne Einschränkung (schreibmodule fehlt) darf alles
    'export function canWrite() { return true }',
  '@/lib/supabase/server':
    'export async function createSupabaseServerClient() { return globalThis.__kan143Supabase }',
  '@/lib/auth/seitenBetrieb': 'export async function pruefeSeitenBetrieb() {}',
  '@/lib/auth/sperren': 'export async function pruefeSchreibzugriff() {}',
  // KAN-195: Kosten in Maßnahmen nur mit Modul Controlling – hier an, wie bisher
  '@/lib/auth/modul': 'export async function hatModul() { return true }',
  'next/cache': 'export function revalidatePath() {}',
}

// Supabase-Attrappe für die Server Actions: Abfragen sind verkettbar und awaitbar, insert/update werden
// in schreiben gemerkt. Eine Maßnahme auf einem GST mit 2 ha; angemeldet ist 'u-1' (Stundensätze).
// KAN-154: Bio-Status des Betriebs und das Pflanzenschutzmittel (öko-zugelassen, Cu-Gehalt) einstellbar –
// Spritzung und Sonstiges laden seine Stammdaten, Anlegen und Bearbeiten prüfen die Bio-Sperre.
function supabaseAttrappe({ bio = 'konventionell', oeko = true, cuGehaltPct = null } = {}) {
  const schreiben = []
  const antwort = (tabelle, op) => {
    if (tabelle === 'grundstuecke') return { data: [{ id: 'g-1', weingarten_id: 'w-1', flaeche_ha: 2 }], error: null }
    if (tabelle === 'tenants') return { data: { bio_status: bio }, error: null }
    if (tabelle === 'pflanzenschutzmittel') {
      return { data: { oeko_zugelassen: oeko, cu_gehalt_pct: cuGehaltPct, wirkstoff: null, wirkstoffgehalt_pct: null }, error: null }
    }
    if (tabelle === 'behandlungen' && op === 'insert') return { data: { id: 'b-neu' }, error: null }
    if (tabelle === 'behandlungen' && op === 'select') return { data: { id: 'b-1', behandlung_grundstuecke: [{ flaeche_ha: 2 }] }, error: null }
    return { data: null, error: null }
  }
  return {
    schreiben,
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from(tabelle) {
      let op = 'select'
      const q = {
        // order/range: Grundstücke der Auswahl lädt die Action seitenweise über alle() (05.10.2026)
        select: () => q, eq: () => q, in: () => q, or: () => q, order: () => q, range: () => q,
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
const [arten, psm, rueck, feld, mengen, massnahmeMengen, tool, aktionen, lagerAktionen, artOptionen, lucide, absenden] = hooksMoeglich
  ? await Promise.all([
      laden('lib/behandlungen/arten.ts'), laden('lib/behoerden/psm.ts'), laden('lib/behoerden/rueckverfolgung.ts'),
      laden('app/(dashboard)/behandlungen/neu/feldMatrix.ts'), laden('app/(dashboard)/behandlungen/neu/mengenFelder.ts'),
      laden('lib/behandlungen/massnahmeMengen.ts'), laden('lib/assistent/tools/massnahme.ts'),
      laden('app/(dashboard)/behandlungen/actions.ts'), laden('app/(dashboard)/behandlungen/lager/actions.ts'),
      laden('app/(dashboard)/behandlungen/neu/artOptionen.ts'), import('lucide-react'),
      laden('app/(dashboard)/behandlungen/neu/absenden.ts'),
    ])
  : []
const nurMitHooks = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node ≥ 22.15 nötig)' }

// Die Ried-Auswahl des Anlegen-Formulars steht seit 30.09.2026 in RiedAuswahlListe.tsx (gemeinsam mit „Bearbeiten“) –
// Quelltext-Prüfungen des Anlegen-Formulars lesen sie mit
const quelle = (rel) => readFileSync(path.join(SRC, rel), 'utf8')
  + (rel.endsWith('neu/NeueBehandlungForm.tsx') ? readFileSync(path.join(SRC, 'app/(dashboard)/behandlungen/neu/RiedAuswahlListe.tsx'), 'utf8') : '')
const EDIT_FORM = 'app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx'
const NEU_FORM = 'app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx'
// Beginn der sichtbaren BBCH-Auswahl im Bearbeiten-Formular (ohne das unsichtbare Feld bei ausgeblendetem BBCH)
const BBCH_AUSWAHL = '<select aria-label="BBCH-Stadium" name="bbch_stadium"'
// Die vier Felder, die das Bearbeiten-Formular nach der Feld-Matrix zeigt oder mitsendet (KAN-143, KAN-152):
// Feld der Matrix → Name im Formular = Spalte in behandlungen
const BEARBEITEN_NAME = { bbch: 'bbch_stadium', schaderreger: 'schaderreger', witterung: 'witterung', temperatur: 'temperatur_c' }
// Sichtbar laut Ticket KAN-152 bzw. Anlegen-Formular (unabhängig von FELD_MATRIX notiert)
const BEARBEITEN_SICHTBAR = {
  bbch:         ['spritzung', 'laubarbeit', 'laubschneiden'],
  schaderreger: ['spritzung', 'sonstiges'],
  witterung:    ['spritzung', 'duengung', 'bodenbearbeitung'],
  temperatur:   ['spritzung'],
}

/**
 * Was das Bearbeiten-Formular für diese vier Felder sendet, wenn niemand sie ändert: 'sichtbar' → das mit dem
 * gespeicherten Wert vorbelegte Eingabefeld, 'behalten' → das unsichtbare Feld mit dem gespeicherten Wert,
 * 'keine' → nichts. Der Quelltext-Test „je Feld eine sichtbare und eine unsichtbare Stelle“ sichert, dass das
 * Formular genau so verdrahtet ist.
 */
function bearbeitenSendet(gespeichert, art, startArt) {
  const modus = feld.felderBeimBearbeiten(art, startArt)
  const fd = {}
  for (const f of feld.BEARBEITEN_FELDER) {
    if (modus[f] !== 'keine') fd[BEARBEITEN_NAME[f]] = String(gespeichert[BEARBEITEN_NAME[f]] ?? '')
  }
  return fd
}

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

  test('BBCH bei Arten mit ausgeblendetem BBCH: Bearbeiten übernimmt den mitgesendeten Wert, ohne Wert null', async () => {
    // Das Bearbeiten-Formular schickt das gespeicherte Stadium bei unveränderter Art als <input type="hidden">
    // mit – die Server Action darf es nicht selbst nach der Feld-Matrix verwerfen; nach einem Artwechsel fehlt
    // es → null
    for (const art of ['duengung', 'bodenbearbeitung', 'schnitt', 'sonstiges']) {
      assert.equal(feld.FELD_MATRIX[art].bbch, 'hidden', art)
      const basis = { datum: '2026-07-02', grundstueck_ids: 'g-1', art }
      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.updateBehandlung('b-1', formular({ ...basis, bbch_stadium: '83' }))
      assert.equal(gespeichert('update').bbch_stadium, '83', art)
      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.updateBehandlung('b-1', formular(basis))
      assert.equal(gespeichert('update').bbch_stadium, null, art)
    }
  })
})

// ── KAN-152: Bearbeiten nach der Feld-Matrix – updateBehandlung mit bzw. ohne mitgesendete Werte ─────────────────

describe('updateBehandlung: BBCH, Schaderreger bzw. Grund / Anlass, Witterung und Temperatur (KAN-152)', nurMitHooks, () => {
  const formular = (felder) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(felder)) fd.set(k, v)
    return fd
  }
  // laubarbeit_art nur, damit auch eine Laubarbeit speichert – bei allen anderen Arten verwirft die Action sie
  const BASIS = { datum: '2026-07-02', grundstueck_ids: 'g-1', laubarbeit_art: 'gipfeln' }
  // Spritzung braucht Mittel und Mengen (eigene Tests) – ihre vier Felder sind ohnehin alle sichtbar
  const OHNE_SPRITZUNG = DB_SAETZE_ART_CHECK.filter(a => a !== 'spritzung')
  const GESPEICHERT = { bbch_stadium: '83', schaderreger: 'Rodung', witterung: 'bewoelkt', temperatur_c: 18.5 }
  const vier = (p) => [p.bbch_stadium, p.schaderreger, p.witterung, p.temperatur_c]
  const gespeichert = (op) => globalThis.__kan143Supabase.schreiben.find(s => s.tabelle === 'behandlungen' && s.op === op)?.p

  test('mitgesendet bleibt, leer gesendet und nicht gesendet → null; 0 °C bleibt 0', async () => {
    for (const art of OHNE_SPRITZUNG) {
      for (const [fall, felder, erwartet] of [
        ['mitgesendet', { bbch_stadium: '83', schaderreger: 'Rodung', witterung: 'bewoelkt', temperatur_c: '18.5' }, ['83', 'Rodung', 'bewoelkt', 18.5]],
        ['0 °C', { temperatur_c: '0' }, [null, null, null, 0]],
        ['leer gesendet', { bbch_stadium: '', schaderreger: '', witterung: '', temperatur_c: '' }, [null, null, null, null]],
        ['Leerzeichen als Temperatur', { temperatur_c: '  ' }, [null, null, null, null]],
        ['nicht gesendet', {}, [null, null, null, null]],
      ]) {
        globalThis.__kan143Supabase = supabaseAttrappe()
        await aktionen.updateBehandlung('b-1', formular({ ...BASIS, art, ...felder }))
        assert.deepEqual(vier(gespeichert('update')), erwartet, `${art}: ${fall}`)
      }
    }
  })

  test('unverändert speichern: gespeicherte Werte bleiben bei jeder Art – auch ausgeblendete (Musterhof-Fall)', async () => {
    // Musterhof (SELECT 26.09.2026): Witterung und Temperatur bei allen Maßnahmen, BBCH auch bei Düngung,
    // Bodenbearbeitung, Schnitt und Sonstiges – auf main leerte Speichern z. B. den Grund / Anlass einer Sonstigen
    for (const art of OHNE_SPRITZUNG) {
      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.updateBehandlung('b-1', formular({ ...BASIS, art, ...bearbeitenSendet(GESPEICHERT, art, art) }))
      assert.deepEqual(vier(gespeichert('update')), vier(GESPEICHERT), art)
    }
  })

  test('Sonstiges mit Grund / Anlass: anlegen, bearbeiten und unverändert speichern – der Grund / Anlass bleibt', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.createBehandlung(formular({ ...BASIS, art: 'sonstiges', schaderreger: 'Rodung' }))
    const neu = gespeichert('insert')
    assert.equal(neu.schaderreger, 'Rodung')
    assert.equal(feld.felderBeimBearbeiten('sonstiges', 'sonstiges').schaderreger, 'sichtbar')
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.updateBehandlung('b-1', formular({ ...BASIS, art: 'sonstiges', ...bearbeitenSendet(neu, 'sonstiges', 'sonstiges') }))
    assert.equal(gespeichert('update').schaderreger, 'Rodung')
  })

  test('nach einem Artwechsel: sichtbare Felder behalten den Wert, ausgeblendete werden nicht gesendet → null', async () => {
    for (const startArt of DB_SAETZE_ART_CHECK) {
      for (const art of OHNE_SPRITZUNG.filter(a => a !== startArt)) {
        const sendet = bearbeitenSendet(GESPEICHERT, art, startArt)
        globalThis.__kan143Supabase = supabaseAttrappe()
        await aktionen.updateBehandlung('b-1', formular({ ...BASIS, art, ...sendet }))
        const upd = gespeichert('update')
        for (const f of feld.BEARBEITEN_FELDER) {
          const name = BEARBEITEN_NAME[f]
          const sichtbar = BEARBEITEN_SICHTBAR[f].includes(art)
          assert.equal(name in sendet, sichtbar, `${f}: ${startArt} → ${art} gesendet`)
          assert.equal(upd[name], sichtbar ? GESPEICHERT[name] : null, `${f}: ${startArt} → ${art}`)
        }
      }
    }
  })
})

// ── Server Actions: Art-Prüfung (Maßnahme und Stundensatz) ──────────────────────

describe('Server Actions: Laubschneiden wird gespeichert, unbekannte Arten abgelehnt, ohne zu schreiben', nurMitHooks, () => {
  const formular = (felder) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(felder)) fd.set(k, v)
    return fd
  }
  const SATZ = { bezeichnung: 'Laubschneiden Seiten und Gipfel', satz_pro_ha: '85,5', gueltig_ab: '2026-09-26' }
  // unbekannt für saetze_massnahmen_art_check: Lese (nur behandlungen), Tippfehler, leere Auswahl
  const OHNE_SATZ_ART = ['lese', 'laubschnitt', '']

  test('upsertSatzMassnahme: Stundensatz für Laubschneiden anlegen und bearbeiten', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await lagerAktionen.upsertSatzMassnahme(formular({ ...SATZ, art: 'laubschneiden' }))
    await lagerAktionen.upsertSatzMassnahme(formular({ ...SATZ, art: 'laubschneiden', existing_id: 's-1' }))
    const s = globalThis.__kan143Supabase.schreiben
    assert.deepEqual(s.map(x => [x.tabelle, x.op]), [['saetze_massnahmen', 'insert'], ['saetze_massnahmen', 'update']])
    for (const { p } of s) {
      assert.deepEqual([p.tenant_id, p.art, p.bezeichnung, p.satz_pro_ha], ['t-1', 'laubschneiden', SATZ.bezeichnung, 85.5])
    }
  })

  test('upsertSatzMassnahme: Lese, unbekannte und fehlende Art abgelehnt', async () => {
    for (const art of [...OHNE_SATZ_ART, null]) {
      globalThis.__kan143Supabase = supabaseAttrappe()
      const fd = formular(art === null ? SATZ : { ...SATZ, art })
      await assert.rejects(() => lagerAktionen.upsertSatzMassnahme(fd), { message: /^Bitte eine Maßnahmenart wählen \(.*Laubschneiden/ }, String(art))
      assert.deepEqual(globalThis.__kan143Supabase.schreiben, [], String(art))
    }
  })

  test('createBehandlung/updateBehandlung: unbekannte Art abgelehnt (ohne Angabe wie bisher Spritzung)', async () => {
    const basis = { datum: '2026-07-02', grundstueck_ids: 'g-1' }
    for (const art of ['laubschnitt', 'lese', 'Laubschneiden']) {
      for (const aufruf of [
        () => aktionen.createBehandlung(formular({ ...basis, art })),
        () => aktionen.updateBehandlung('b-1', formular({ ...basis, art })),
      ]) {
        globalThis.__kan143Supabase = supabaseAttrappe()
        await assert.rejects(aufruf, { message: new RegExp(`^Unbekannte Maßnahmenart „${art}“ – erlaubt: .*Laubschneiden`) }, art)
        assert.deepEqual(globalThis.__kan143Supabase.schreiben, [], art)
      }
    }
    // leere Auswahl ist keine unbekannte Art: createBehandlung fällt auf Spritzung zurück (hier ohne Mittel →
    // deren Pflichtprüfung greift)
    globalThis.__kan143Supabase = supabaseAttrappe()
    await assert.rejects(() => aktionen.createBehandlung(formular({ ...basis, art: '' })),
      { message: 'Bei einer Spritzung ist ein Pflanzenschutzmittel Pflicht.' })
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

  test('Bearbeiten: BBCH, Schaderreger, Witterung und Temperatur nach der Feld-Matrix – Modus je Art und Ausgangsart', () => {
    assert.deepEqual([...feld.BEARBEITEN_FELDER], Object.keys(BEARBEITEN_SICHTBAR))
    for (const [f, sichtbar] of Object.entries(BEARBEITEN_SICHTBAR)) {
      for (const art of DB_SAETZE_ART_CHECK) {
        // sichtbar genau dort, wo das Anlegen-Formular das Feld zeigt (felder.<feld> !== 'hidden')
        assert.equal(feld.FELD_MATRIX[art][f] !== 'hidden', sichtbar.includes(art), `${f} bei ${art} (Feld-Matrix)`)
        // sichtbar auch nach einem Artwechsel; ausgeblendet bei unveränderter Art 'behalten' (der gespeicherte
        // Wert geht unsichtbar mit), nach einem Artwechsel 'keine' (nichts gesendet)
        for (const startArt of [...DB_SAETZE_ART_CHECK, 'lese']) {
          const erwartet = sichtbar.includes(art) ? 'sichtbar' : art === startArt ? 'behalten' : 'keine'
          assert.equal(feld.feldBeimBearbeiten(f, art, startArt), erwartet, `${f}: ${startArt} → ${art}`)
        }
      }
      assert.equal(feld.feldBeimBearbeiten(f, 'lese', 'lese'), 'behalten', f)   // unbekannte Art: kein Absturz, Wert bleibt
      assert.equal(feld.feldBeimBearbeiten(f, 'lese', 'spritzung'), 'keine', f)
    }
    // felderBeimBearbeiten: alle vier auf einmal, wie feldBeimBearbeiten
    for (const art of DB_SAETZE_ART_CHECK) {
      for (const startArt of DB_SAETZE_ART_CHECK) {
        assert.deepEqual(feld.felderBeimBearbeiten(art, startArt),
          Object.fromEntries(feld.BEARBEITEN_FELDER.map(f => [f, feld.feldBeimBearbeiten(f, art, startArt)])), `${startArt} → ${art}`)
      }
    }
    // Fälle aus dem Ticket
    assert.deepEqual(feld.felderBeimBearbeiten('sonstiges', 'sonstiges'), { bbch: 'behalten', schaderreger: 'sichtbar', witterung: 'behalten', temperatur: 'behalten' })
    assert.deepEqual(feld.felderBeimBearbeiten('laubarbeit', 'laubarbeit'), { bbch: 'sichtbar', schaderreger: 'behalten', witterung: 'behalten', temperatur: 'behalten' })
    assert.deepEqual(feld.felderBeimBearbeiten('laubschneiden', 'spritzung'), { bbch: 'sichtbar', schaderreger: 'keine', witterung: 'keine', temperatur: 'keine' })
    assert.deepEqual(feld.felderBeimBearbeiten('duengung', 'sonstiges'), { bbch: 'keine', schaderreger: 'keine', witterung: 'sichtbar', temperatur: 'keine' })
  })

  test('Pflicht und Bezeichnung wie beim Anlegen: BBCH und Schaderreger nirgends Pflicht (KAN-155), „Grund / Anlass“ bei Sonstiges', () => {
    for (const art of ['spritzung', 'sonstiges', 'laubarbeit', 'laubschneiden', 'duengung', 'lese', '']) {
      assert.equal(feld.feldPflicht('schaderreger', art), false, art)
      assert.equal(feld.feldPflicht('bbch', art), false, art)
    }
    assert.equal(feld.feldPflicht('laubarbeitArt', 'laubarbeit'), true)
    assert.deepEqual(feld.schaderregerFeld('sonstiges'), { label: 'Grund / Anlass', placeholder: 'z.B. Rodung', vorschlaege: false })
    for (const art of ['spritzung', 'duengung', 'lese']) {
      assert.deepEqual(feld.schaderregerFeld(art), { label: 'Schaderreger', placeholder: 'z.B. Peronospora', vorschlaege: true }, art)
    }
    assert.deepEqual([...feld.SCHADERREGER_OPTIONEN], ['Oidium', 'Peronospora', 'Botrytis'])
    // Werte wie behandlungen_witterung_check, Bezeichnungen mit Umlaut
    assert.deepEqual(feld.WITTERUNG_OPTIONEN.map(o => o.value), ['sonnig', 'bewoelkt', 'regnerisch', 'wind'])
    assert.deepEqual(feld.WITTERUNG_OPTIONEN.map(o => o.label), ['Sonnig', 'Bewölkt', 'Regnerisch', 'Wind'])
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
    // Schnitt 00, Bodenbearbeitung 05/83, Düngung 07: keine Auswahl, der Code geht unverändert unsichtbar mit
    for (const art of ['schnitt', 'bodenbearbeitung', 'duengung']) assert.equal(feld.feldBeimBearbeiten('bbch', art, art), 'behalten', art)
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

  test('Formulare: Auswahl aus ART_OPTIONS mit eigenem Symbol für Laubschneiden (nicht Schere, nicht Blatt)', nurMitHooks, () => {
    const { ART_OPTIONS, ART_SYMBOL } = artOptionen
    assert.deepEqual(ART_OPTIONS.map(o => o.value), DB_SAETZE_ART_CHECK)
    assert.deepEqual(ART_OPTIONS.map(o => o.label), DB_SAETZE_ART_CHECK.map(a => arten.MASSNAHMEN_ART_LABEL[a]))
    for (const o of ART_OPTIONS) assert.equal(o.icon, ART_SYMBOL[o.value], `Symbol der Option ${o.value}`)
    assert.deepEqual(Object.keys(ART_SYMBOL).sort(), [...DB_SAETZE_ART_CHECK].sort())
    // Vergleich der Komponenten selbst, nicht ihrer Namen: in lucide-react ist z. B. MoreHorizontal dasselbe
    // Symbol wie Ellipsis
    assert.equal(new Set(Object.values(ART_SYMBOL)).size, DB_SAETZE_ART_CHECK.length, 'jede Art ein eigenes Symbol')
    assert.equal(ART_SYMBOL.laubschneiden, lucide.Shrub)
    assert.notEqual(ART_SYMBOL.laubschneiden, lucide.Scissors)
    assert.notEqual(ART_SYMBOL.laubschneiden, lucide.Leaf)
    for (const rel of ['app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx', 'app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx']) {
      const f = quelle(rel)
      assert.match(f, /import \{ ART_OPTIONS \} from '\.\.?\/(\.\.\/neu\/)?artOptionen'/, rel)
      assert.doesNotMatch(f, /const ART_OPTIONS\b/, rel)
      assert.match(f, /art === 'laubschneiden' && <p[^>]*>\{LAUBSCHNEIDEN_HINWEIS\}/, rel)
    }
  })

  test('Bearbeiten-Formular: BBCH, Schaderreger und Wetter über die Feld-Matrix, Mittel beim Artwechsel geleert, Wartezeit nur vom sichtbaren Mittel', () => {
    const f = quelle(EDIT_FORM)
    assert.match(f, /const modus = felderBeimBearbeiten\(art, startArt\)/)
    // keine eigene Sichtbarkeitsregel mehr (KAN-143: art === 'spritzung', wetterBeimBearbeiten)
    assert.doesNotMatch(f, /bbchBeimBearbeiten|wetterBeimBearbeiten|bbchModus/)
    assert.doesNotMatch(f, /\{art === 'spritzung' && \(\s*<div className="grid grid-cols-2 gap-3">/)
    assert.match(f, /if \(!artMitPsm\(neu\)\) setSelectedPsmId\(''\)/)
    assert.match(f, /if \(!artMitDuengemittel\(neu\)\) setSelectedDuengemittelId\(''\)/)
    assert.match(f, /const wartezeit = artMitPsm\(art\) \? selectedPsm\?\.wartezeit_tage\s+: artMitDuengemittel\(art\) \? selectedDuengemittel\?\.wartezeit_tage/)
    assert.doesNotMatch(f, /selectedPsm\?\.wartezeit_tage \?\? selectedDuengemittel/)
  })

  // greift auf die per Hook geladenen Module zu → ohne Hooks übersprungen (wie massnahme-mengen.test.mjs);
  // die Server Actions prüft der Block „createBehandlung/updateBehandlung: bei Arten ohne Mittel …“ (Verhalten)
  test('Art der Laubarbeit ist Pflicht – Anlegen und Bearbeiten (auch nach Artwechsel)', nurMitHooks, () => {
    assert.equal(feld.FELD_MATRIX.laubarbeit.laubarbeitArt, 'pflicht')
    const neu = quelle('app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
    assert.match(neu, /<select name="laubarbeit_art" required=\{felder\.laubarbeitArt === 'pflicht'\}/)
    const edit = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(edit, /import \{\s*BBCH_OPTIONS, FELD_MATRIX,[^}]*\bfelderBeimBearbeiten\b[^}]*\} from '\.\.\/\.\.\/neu\/feldMatrix'/)
    assert.match(edit, /name="laubarbeit_art"[^>]*\s+required=\{FELD_MATRIX\.laubarbeit\.laubarbeitArt === 'pflicht'\}/)
    assert.match(edit, /Art der Laubarbeit\s+\{FELD_MATRIX\.laubarbeit\.laubarbeitArt === 'pflicht' && <span className="text-s112-err"> \*<\/span>\}/)
  })

  test('Bearbeiten-Formular: ältere Freitext-Unterart der Laubarbeit bleibt als eigene Option vorausgewählt', () => {
    const edit = quelle('app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(edit, /const laubarbeitBisher = laubarbeitAltwert\(behandlung\.laubarbeit_art\)/)
    assert.match(edit, /name="laubarbeit_art" defaultValue=\{behandlung\.laubarbeit_art \?\? ''\}/)
    const auswahl = edit.slice(edit.indexOf('name="laubarbeit_art"'), edit.indexOf('</select>', edit.indexOf('name="laubarbeit_art"')))
    assert.match(auswahl, /\{art === startArt && laubarbeitBisher && \(\s*<option value=\{laubarbeitBisher\}>\{laubarbeitBisher\} \(bisherige Angabe\)<\/option>/)
    assert.ok(auswahl.indexOf('laubarbeitBisher') < auswahl.indexOf('LAUBARBEIT_OPTIONEN.map'), 'Altwert-Option vor den Standardwerten')
  })

  test('BBCH: eine Auswahlliste (feldMatrix.ts) für Anlegen und Bearbeiten, Altwert in der BBCH-Auswahl des Bearbeiten-Formulars', () => {
    const neu = quelle(NEU_FORM)
    const edit = quelle(EDIT_FORM)
    for (const [name, f] of [['Anlegen', neu], ['Bearbeiten', edit]]) {
      assert.doesNotMatch(f, /const BBCH_OPTIONS\b/, name)
      assert.match(f, /import \{\s*BBCH_OPTIONS, FELD_MATRIX\b[^}]*\} from '(\.\/|\.\.\/\.\.\/neu\/)feldMatrix'/, name)
    }
    assert.match(edit, /const bbchBisher = bbchAltwert\(behandlung\.bbch_stadium\)/)
    const auswahlen = edit.split(BBCH_AUSWAHL).slice(1).map(t => t.slice(0, t.indexOf('</select>')))
    assert.equal(auswahlen.length, 1)   // eine Auswahl für Spritzung, Laubarbeit und Laubschneiden (KAN-152)
    assert.match(auswahlen[0], /\{bbchBisher && <option value=\{bbchBisher\}>\{bbchBisher\} \(bisherige Angabe\)<\/option>\}/)
    assert.ok(auswahlen[0].indexOf('bbchBisher') < auswahlen[0].indexOf('BBCH_OPTIONS.map'), 'Altwert-Option vor den Standardwerten')
  })

  test('Bearbeiten-Formular: BBCH-Auswahl aus einem State – Stadium beim Artwechsel unabhängig vom Weg', () => {
    // Spritzung → Laubschneiden, Laubarbeit → Spritzung → Laubschneiden und eine eigene Eingabe behalten das
    // Stadium wie im Anlegen-Formular; eine ungesteuerte Auswahl (defaultValue) fiele nach einem Umweg über eine
    // Art ohne BBCH auf den gespeicherten Wert zurück
    const edit = quelle(EDIT_FORM)
    assert.match(edit, /const \[bbch, setBbch\] = useState\(behandlung\.bbch_stadium \?\? ''\)/)
    const auswahlen = edit.split(BBCH_AUSWAHL).slice(1).map(t => t.slice(0, t.indexOf('className=')))
    assert.equal(auswahlen.length, 1)
    assert.match(auswahlen[0], /^ value=\{bbch\} onChange=\{e => setBbch\(e\.target\.value\)\}/)
    assert.doesNotMatch(auswahlen[0], /defaultValue/)
  })

  test('Bearbeiten-Formular: je Feld eine sichtbare und eine unsichtbare Stelle, die der Modus ausschließt (KAN-152)', () => {
    // BBCH, Schaderreger bzw. Grund / Anlass, Witterung, Temperatur: das Eingabefeld nur bei 'sichtbar', das
    // unsichtbare Feld mit dem gespeicherten Wert nur bei 'behalten' (art = startArt, felderBeimBearbeiten) – so
    // sendet je Feld immer höchstens eine Stelle (bei zwei gleichnamigen Feldern nähme formData.get das erste),
    // nach einem Artwechsel ('keine') keine. Auf main leerte Speichern z. B. den Grund / Anlass einer Sonstigen
    // und bei ausgeblendetem BBCH das Stadium (Musterhof: 14 Maßnahmen)
    const edit = quelle(EDIT_FORM)
    for (const [f, name] of Object.entries(BEARBEITEN_NAME)) {
      const stellen = [...edit.matchAll(new RegExp(`<(select|input)\\b[^>]*\\bname="${name}"[^>]*>`, 'g'))]
      assert.equal(stellen.length, 2, `${name}: genau zwei Stellen`)
      const [sichtbar, versteckt] = [stellen.filter(s => !/type="hidden"/.test(s[0])), stellen.filter(s => /type="hidden"/.test(s[0]))]
      assert.equal(sichtbar.length, 1, name)
      assert.equal(versteckt.length, 1, name)
      // unsichtbar: gespeicherter Wert (nicht der State), nur im Modus 'behalten'
      assert.match(edit, new RegExp(`\\{modus\\.${f} === 'behalten' && <input type="hidden" name="${name}" value=\\{behandlung\\.${name} \\?\\? ''\\} />\\}`), name)
      // sichtbar: der nächste Modus-Guard davor ist 'sichtbar' desselben Felds
      const guard = [...edit.slice(0, sichtbar[0].index).matchAll(/\{modus\.(\w+) === '(\w+)' && /g)].at(-1)
      assert.deepEqual([guard?.[1], guard?.[2]], [f, 'sichtbar'], name)
    }
    // Schaderreger bzw. Grund / Anlass: Bezeichnung, Pflicht und Vorschläge wie beim Anlegen (Pflicht seit KAN-154
    // über pflichtBeimBearbeiten – Altdaten ohne Wert ausgenommen)
    assert.match(edit, /const schaderreger = schaderregerFeld\(art\)/)
    assert.match(edit, /<input aria-label=\{schaderreger\.label\} name="schaderreger" type="text"\s+required=\{pflicht\.schaderreger\}/)
    assert.match(edit, /\{schaderreger\.label\}\s+\{pflicht\.schaderreger && <span className="text-s112-err"> \*<\/span>\}/)
    assert.match(edit, /list=\{schaderreger\.vorschlaege \? 'schaderreger-kb' : undefined\}/)
    assert.match(edit, /required=\{pflicht\.bbch\}/)
    assert.match(edit, /schaderreger: +pflichtBeimBearbeiten\('schaderreger', art, startArt, behandlung\.schaderreger\)/)
    assert.match(edit, /bbch: +pflichtBeimBearbeiten\('bbch', art, startArt, behandlung\.bbch_stadium\)/)
    // Anlegen nimmt dieselbe Bezeichnung
    const neu = quelle(NEU_FORM)
    assert.match(neu, /const schaderreger = schaderregerFeld\(art\)/)
    assert.doesNotMatch(neu, /art === 'sonstiges' \? 'Grund \/ Anlass'/)
    for (const [name, f] of [['Anlegen', neu], ['Bearbeiten', edit]]) {
      assert.doesNotMatch(f, /const (WITTERUNG|SCHADERREGER_OPTIONEN)\b/, name)
      assert.match(f, /WITTERUNG_OPTIONEN\.map\(o => <option key=\{o\.value\} value=\{o\.value\}>\{o\.label\}<\/option>\)/, name)
    }
  })

  test('Maßnahmenliste: Art-Auswahl „Alle Arten“ und Filter aus lib/behandlungen/arten.ts', () => {
    const c = quelle('app/(dashboard)/behandlungen/BehandlungenClient.tsx')
    assert.match(c, /const artOptionen = artFilterOptionen\(behandlungen\)/)
    assert.match(c, /const gefiltert = filterMassnahmen\(behandlungen, artFilter, filter\)/)
    assert.match(c, /value=\{artFilter\}/)
    assert.match(c, /<option value="">Alle Arten<\/option>/)
  })

  // Server Actions – Art-Prüfung (Maßnahme und Stundensatz): Verhaltenstests im Block „Server Actions: Laubschneiden
  // wird gespeichert …“; Mittel, Wartezeit, laubarbeit_art und Pflicht der Unterart beim Anlegen und Bearbeiten:
  // Block „createBehandlung/updateBehandlung: bei Arten ohne Mittel …“

  test('Weinbuch zeigt die Bezeichnung statt des Rohwerts', () => {
    const w = quelle('lib/wein/weinbuch.ts')
    assert.match(w, /const artText = massnahmenArtLabel\(b\.art\)/)
    assert.match(w, /artText && `Art: \$\{artText\}`/)
    assert.doesNotMatch(w, /`Art: \$\{b\.art\}`/)
  })

  test('Assistent (Systemprompt) und KI-Kontext nennen Laubschneiden und grenzen es von Gipfeln ab', nurMitHooks, () => {
    // Artenliste unter „AKTUELL KANNST DU“ ist im Systemprompt von Hand geschrieben → genau die Klammer nach
    // „Maßnahmen dokumentieren“ gegen alle Arten des Formulars (ein includes über den ganzen Prompt träfe z. B.
    // „Sonstiges“ auch unter Punkt 2)
    const chat = quelle('app/api/assistent/chat/route.ts').replace(/\s+/g, ' ')
    const promptArten = chat.match(/Maßnahmen dokumentieren \(([^)]*)\) über das Tool "massnahme_dokumentieren"/)?.[1]
    assert.ok(promptArten, 'Systemprompt: Artenliste nach „Maßnahmen dokumentieren“ nicht gefunden')
    assert.deepEqual(promptArten.split(', '), arten.MASSNAHMEN_ARTEN.map(a => arten.MASSNAHMEN_ART_LABEL[a]))
    const ki = quelle('app/api/ki-abfrage/route.ts').replace(/\s+/g, ' ')
    for (const art of DB_BEHANDLUNGEN_ART_CHECK) assert.ok(ki.includes(`'${art}' (${arten.MASSNAHMEN_ART_LABEL[art]}`), `KI-Kontext: ${art}`)
    assert.match(ki, /'laubschneiden' \(Laubschneiden = maschinelles Laubschneiden an Seiten und Gipfel, ohne laubarbeit_art\)/)
    assert.match(ki, /saetze_massnahmen\.art .*dieselben Werte ohne 'lese'/)
    // Unterarten mit gespeichertem Code und Bezeichnung exakt wie in der Oberfläche (nicht „Gipfeln von Hand“);
    // Suche über Wortstämme ohne Umlaut, die Code und Freitext treffen ('%entblätter%' fände 'entblaettern' nicht)
    for (const o of arten.LAUBARBEIT_OPTIONEN) {
      assert.ok(ki.includes(`'${o.value}' (${o.label})`), `KI-Kontext: laubarbeit_art ${o.value}`)
    }
    const wortstaemme = [...(ki.match(/UNTERARTEN \(behandlungen\.laubarbeit_art[^]*?ILIKE ((?:'%[a-z]+%'(?:, | bzw\. )?)+)/)?.[1] ?? '').matchAll(/'%([a-z]+)%'/g)].map(m => m[1])
    assert.ok(wortstaemme.length > 0, 'KI-Kontext: Wortstämme für laubarbeit_art')
    for (const o of arten.LAUBARBEIT_OPTIONEN.filter(x => x.value !== 'sonstige')) {
      for (const text of [o.value, o.label.toLowerCase()]) assert.ok(wortstaemme.some(w => text.includes(w)), `KI-Kontext: kein Wortstamm für ${text}`)
    }
    assert.doesNotMatch(ki, /vor KAN-143/)
    // Ältere Laubarbeiten können maschinelles Laubschneiden sein – als Hinweis, ohne Stichtag-Unterabfrage im
    // Prompt (die KI soll für einfache Fragen einfaches SQL erzeugen)
    assert.match(ki, /Die Art 'laubschneiden' gibt es erst seit Ende September 2026 – ältere Laubarbeiten \(Unterart 'gipfeln'\) können maschinelles Laubschneiden enthalten\./)
    assert.match(ki, /Fragt der User allgemein nach Gipfeln bzw\. Laubschnitt, beide Arten berücksichtigen/)
    const artenAbschnitt = ki.slice(ki.indexOf('ARTEN (behandlungen.art'), ki.indexOf('saetze_massnahmen.art'))
    assert.ok(artenAbschnitt.length > 100, 'KI-Kontext: Abschnitt ARTEN/UNTERARTEN gefunden')
    assert.doesNotMatch(artenAbschnitt, /STICHTAG|min\(created_at\)|\d{1,2}\.\d{2}\.\d{4}/)
  })

  test('Hilfe: FAQ und Handbuch erklären Laubschneiden, Gipfeln von Hand bleibt Laubarbeit', () => {
    const faq = quelle('app/(dashboard)/hilfe/faq/page.tsx')
    assert.match(faq, /frage: 'Laubarbeit oder Laubschneiden – was wähle ich\?'/)
    assert.match(faq, /Stundensätze für die Kosten-Vorschlagsfunktion.*Laubschneiden/)
    assert.doesNotMatch(faq, /z\.B\. Schnitt, Laubarbeit, Ernte/)   // Ernte ist keine Art der Stundensätze
    // … und keine Beispiel-Bezeichnung im Stundensatz-Formular (ein Satz „Handlese“ landete unter einer anderen Art)
    const saetze = quelle('app/(dashboard)/behandlungen/lager/SaetzeClient.tsx')
    assert.match(saetze, /placeholder="z\.B\. Laubschneiden Seiten und Gipfel, Rebschnitt Guyot"/)
    assert.doesNotMatch(saetze, /placeholder="[^"]*(Lese|lese|Ernte)/)
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

// ── KAN-153: „Maßnahme erfassen“ ohne Ried-Auswahl bzw. bei Bio-Sperre ──────────────────────────────────────

describe('Neue Maßnahme: Knopf ohne Auswahl nicht gesperrt, Klick zeigt den Grund (KAN-153)', () => {
  test('absendenHindernis: Bio-Sperre vor fehlender Auswahl (Reihenfolge des Formulars), sonst absenden', nurMitHooks, () => {
    assert.equal(absenden.absendenHindernis(0, false), 'ried')
    assert.equal(absenden.absendenHindernis(0, true), 'bio')
    assert.equal(absenden.absendenHindernis(2, true), 'bio')
    assert.equal(absenden.absendenHindernis(1, false), null)
    assert.equal(absenden.absendenHindernis(Number.NaN, false), 'ried')
    assert.equal(absenden.RIED_AUSWAHL_FEHLT, 'Bitte mindestens ein Ried oder Grundstück auswählen.')
  })

  test('Kopfzeile und Knopftext: ohne Auswahl „noch keine Auswahl“ (Warnfarbe) und kein „(0 ausgewählt)“', nurMitHooks, () => {
    assert.deepEqual(absenden.auswahlKopf(0, 0), { text: 'noch keine Auswahl', warnung: true })
    assert.deepEqual(absenden.auswahlKopf(2, 1.25), { text: '2 ausgewählt · 1,25 ha', warnung: false })
    assert.deepEqual(absenden.auswahlKopf(1, 0.12345), { text: '1 ausgewählt · 0,1235 ha', warnung: false })
    assert.equal(absenden.erfassenKnopfText(false, 0), 'Maßnahme erfassen')
    assert.equal(absenden.erfassenKnopfText(false, 3), 'Maßnahme erfassen (3 ausgewählt)')
    assert.equal(absenden.erfassenKnopfText(true, 0), 'Speichert…')
    assert.equal(absenden.erfassenKnopfText(true, 3), 'Speichert…')
  })

  test('Quelltext: Knopf nur beim Speichern gesperrt, Klick ohne Auswahl springt zum Abschnitt – nichts gesendet', () => {
    const neu = quelle(NEU_FORM)
    const knopf = neu.match(/<button type="submit"[^>]*>/g) ?? []
    assert.equal(knopf.length, 1)
    assert.match(knopf[0], /disabled=\{pending\}/)
    assert.doesNotMatch(knopf[0], /totalSelCount|bioSperre/)
    assert.doesNotMatch(neu, /disabled=\{[^}]*totalSelCount === 0/)
    assert.match(neu, /\{erfassenKnopfText\(pending, totalSelCount\)\}/)
    assert.doesNotMatch(neu, /`Maßnahme erfassen \(\$\{totalSelCount\} ausgewählt\)`/)
    // handleSubmit: vor dem Zusammenstellen der Daten, ohne createBehandlung
    const submit = neu.slice(neu.indexOf('function handleSubmit'), neu.indexOf('createBehandlung(fd)'))
    assert.match(submit, /const hindernis = absendenHindernis\(totalSelCount, bioSperre\)/)
    assert.match(submit, /if \(hindernis === 'bio'\) \{ setBioSprung\(n => n \+ 1\); return \}/)
    assert.match(submit, /if \(hindernis === 'ried'\) \{ setRiedenExpanded\(true\); setRiedSprung\(n => n \+ 1\); return \}/)
    assert.ok(submit.indexOf('absendenHindernis') < submit.indexOf('new FormData'), 'Prüfung vor dem Zusammenstellen der Daten')
    assert.doesNotMatch(submit, /totalSelCount === 0\) \{ setError/)
    // nach dem Klick: hinscrollen und die erste Checkbox der (aufgeklappten) Auswahl fokussieren
    assert.match(neu, /riedenRef\.current\?\.scrollIntoView\(/)
    assert.match(neu, /querySelector<HTMLInputElement>\('input\[type="checkbox"\]:not\(:disabled\)'\)/)
    assert.match(neu, /\(erste \?\? riedenKopfRef\.current\)\?\.focus\(/)
    assert.match(neu, /<div ref=\{riedenRef\} className="card">/)
  })

  test('Quelltext: Meldung mit role="alert" am Abschnitt, Pflicht-Stern und Warnfarbe in der Kopfzeile', () => {
    const neu = quelle(NEU_FORM)
    const abschnitt = neu.slice(neu.indexOf('<div ref={riedenRef}'), neu.indexOf('{/* Kosten-Vorschlagsfunktion'))
    assert.match(abschnitt, /Ried\(en\) auswählen<span className="text-s112-err"> \*<\/span>/)
    assert.match(abschnitt, /riedKopf\.warnung \? 'text-s112-warn-fg' : 'text-s112-blue-700'/)
    assert.match(abschnitt, /\{riedKopf\.text\}/)
    assert.match(abschnitt, /aria-expanded=\{riedenExpanded\}/)
    assert.match(abschnitt, /\{riedHinweis && \(\s*<p key=\{riedSprung\} id="ried-auswahl-fehlt" role="alert"[^>]*>[\s\S]*?\{RIED_AUSWAHL_FEHLT\}/)
    assert.match(neu, /const riedHinweis = riedSprung > 0 && totalSelCount === 0/)
    // Fokusziel liest die Meldung sicher mit (aria-describedby wie bei der Bio-Sperre): alle Ried-Checkboxen
    // und der Kopf-Knopf (Rückfall-Fokus ohne aktive Checkbox) verweisen auf sie, solange sie steht
    assert.match(neu, /const riedMeldung = riedHinweis \? 'ried-auswahl-fehlt' : undefined/)
    assert.equal((neu.match(/ried-auswahl-fehlt/g) ?? []).length, 2, 'id genau einmal vergeben, einmal verwiesen')
    const kopfKnopf = abschnitt.match(/<button type="button" ref=\{riedenKopfRef\}[\s\S]*?className=/)?.[0]
    assert.ok(kopfKnopf, 'Kopf-Knopf mit riedenKopfRef')
    assert.match(kopfKnopf, /aria-describedby=\{riedMeldung\}/)
    // Checkboxen seit 30.09.2026 in RiedAuswahlListe.tsx – das Formular reicht riedHinweis und riedMeldung durch
    assert.match(abschnitt, /<RiedAuswahlListe [\s\S]*?riedHinweis=\{riedHinweis\} riedMeldung=\{riedMeldung\} \/>/)
    const liste = quelle('app/(dashboard)/behandlungen/neu/RiedAuswahlListe.tsx')
    const checkboxen = liste.match(/<input\s+type="checkbox"[^>]*>/g) ?? []
    assert.equal(checkboxen.length, 3, 'Lage-, Ried- und GST-Checkbox')
    for (const c of checkboxen) {
      assert.match(c, /aria-describedby=\{riedMeldung\}/, c)
      assert.match(c, /aria-invalid=\{riedHinweis \|\| undefined\}/, c)
    }
    assert.match(neu, /const riedKopf = auswahlKopf\(totalSelCount, totalHaAktiv\)/)
    // Checkboxen mit Namen für Vorleseprogramme (Fokusziel nach dem Klick)
    assert.match(liste, /aria-label=\{`\$\{lageName\}: alle spritzbaren auswählen`\}/)
    assert.match(liste, /aria-label=\{w\.name\}/)
  })

  test('Quelltext: Bio-Sperre zeigt den Grund am Mittel (role="alert", aria-describedby, Fokus)', () => {
    const neu = quelle(NEU_FORM)
    assert.match(neu, /\{bioSperre && \(\s*<div key=\{bioSprung\} id="bio-sperre-grund" role="alert"/)
    for (const [ref, name] of [['psmRef', 'psm_id'], ['duengemittelRef', 'duengemittel_id']]) {
      const s = neu.match(new RegExp(`<select ref=\\{${ref}\\}[^]*?name="${name}"[^]*?onChange`))?.[0]
      assert.ok(s, `${name}: Auswahl mit ${ref}`)
      assert.match(s, /aria-describedby=\{bioSperre \? 'bio-sperre-grund' : undefined\}/, name)
      assert.match(s, /aria-invalid=\{bioSperre \|\| undefined\}/, name)
    }
    assert.match(neu, /const mittel = psmRef\.current \?\? duengemittelRef\.current/)
    // Sperre nur für ein Mittel, dessen Feld die Art zeigt; ausgeblendete Mittel werden beim Artwechsel geleert
    assert.match(neu, /felder\.psm !== 'hidden'\s+\? selectedPsm\?\.oeko_zugelassen/)
    assert.match(neu, /if \(FELD_MATRIX\[art\]\.psm === 'hidden'\) setSelectedPsmId\(''\)/)
    assert.match(neu, /if \(FELD_MATRIX\[art\]\.duengemittel === 'hidden'\) setSelectedDuengemittelId\(''\)/)
  })

  test('Server-Prüfung bleibt: createBehandlung ohne Ried und Grundstück abgelehnt, nichts geschrieben', nurMitHooks, async () => {
    const fd = new FormData()
    for (const [k, v] of Object.entries({ datum: '2026-07-02', art: 'laubarbeit', laubarbeit_art: 'gipfeln', bbch_stadium: '61', kosten_aktiv: 'on', kosten_betrag: '2000' })) fd.set(k, v)
    globalThis.__kan143Supabase = supabaseAttrappe()
    await assert.rejects(() => aktionen.createBehandlung(fd), { message: 'Mindestens eine Ried oder ein Grundstück auswählen' })
    assert.deepEqual(globalThis.__kan143Supabase.schreiben, [])
    // mit Auswahl: Maßnahme samt Kosteneintrag gespeichert (Fall aus dem Ticket: Laubarbeit › Gipfeln, BBCH 61, 2.000 €)
    fd.set('grundstueck_ids', 'g-1')
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.createBehandlung(fd)
    // (die Attrappe liefert für den Kosteneintrag keine id – die Aufteilung auf Weingärten prüft sie daher nicht)
    const eingefuegt = globalThis.__kan143Supabase.schreiben.filter(s => s.op === 'insert')
    assert.deepEqual(eingefuegt.map(s => s.tabelle), ['behandlungen', 'behandlung_grundstuecke', 'kosteneintraege'])
    assert.deepEqual([eingefuegt[0].p.art, eingefuegt[0].p.laubarbeit_art, eingefuegt[0].p.bbch_stadium], ['laubarbeit', 'gipfeln', '61'])
    assert.deepEqual([eingefuegt[2].p.behandlung_id, eingefuegt[2].p.betrag], ['b-neu', 2000])
  })

  test('Hilfe: Handbuch und FAQ nennen die Pflicht und den Sprung zum Abschnitt', () => {
    const hb = quelle('app/(dashboard)/hilfe/handbuch/page.tsx')
    const abschnitt = hb.match(/titel: 'Ried\(en\)-Auswahl ein-\/aufklappen', inhalt: '([^']*)'/)?.[1]
    assert.ok(abschnitt, 'Handbuch-Abschnitt „Ried(en)-Auswahl ein-/aufklappen“')
    assert.match(abschnitt, /Pflicht – ohne Auswahl springt „Maßnahme erfassen“ zum Abschnitt/)
    assert.match(abschnitt, /„Bitte mindestens ein Ried oder Grundstück auswählen\.“/)
    assert.match(abschnitt, /„noch keine Auswahl“/)
    const faq = quelle('app/(dashboard)/hilfe/faq/page.tsx')
    assert.match(faq, /Die Auswahl ist Pflicht: Klickst du ohne Auswahl auf „Maßnahme erfassen“, klappt der Abschnitt auf/)
    assert.match(faq, /ein Klick auf „Maßnahme erfassen“ springt dorthin, statt still gesperrt zu bleiben/)
    // KAN-152: Bearbeiten mit denselben Feldern, ausgeblendete gespeicherte Angaben bleiben
    assert.match(hb, /Beim Bearbeiten einer Maßnahme zeigt das Formular BBCH-Stadium, Schaderreger bzw\. Grund \/ Anlass, Witterung und Temperatur genauso/)
    // KAN-154: seither gleichen sich Anlegen und Bearbeiten auch bei PSM (Sonstiges), Einarbeitung und Pflichtfeldern
    assert.match(faq, /Beim Bearbeiten zeigt das Formular dieselben Felder und Pflichtfelder wie beim Anlegen; eine schon gespeicherte Angabe in einem ausgeblendeten Feld \(auch eine Einarbeitung „nein“\) bleibt beim Speichern erhalten/)
    assert.doesNotMatch(faq, /Beim Bearbeiten gelten dieselben Felder/)
  })
})

// ── KAN-154: restliche Abweichungen Anlegen ↔ Bearbeiten ─────────────────────────────────────────────────────

const formularAus = (felder) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(felder)) fd.set(k, v)
  return fd
}
const geschrieben = (op) => globalThis.__kan143Supabase.schreiben.find(s => s.tabelle === 'behandlungen' && s.op === op)?.p

/**
 * Was das Bearbeiten-Formular für die Einarbeitung sendet (Spiegel der JSX-Blöcke 'sichtbar' und 'behalten' –
 * der Quelltext-Test unten sichert die Verdrahtung): `angeklickt` = Stand der Checkbox nach einem Klick
 * (undefined = nicht angefasst, dann der gespeicherte Wert).
 */
function einarbeitungSendet(gespeichert, art, startArt, typ, angeklickt) {
  const modus = feld.einarbeitungBeimBearbeiten(art, startArt, typ)
  const fd = {}
  if (modus === 'keine') return fd
  const wert = modus === 'sichtbar' && angeklickt !== undefined ? angeklickt : gespeichert.einarbeitung
  if (wert !== null) fd.einarbeitung_gesendet = '1'
  if (wert) fd.einarbeitung = 'on'
  fd.einarbeitung_zeitpunkt = gespeichert.einarbeitung_zeitpunkt ?? ''
  return fd
}

describe('KAN-154: Feld-Matrix – Pflanzenschutzmittel bei Sonstiges, Bearbeitungstiefe optional', nurMitHooks, () => {
  test('Sonstiges: Mittel optional; Bearbeiten zeigt es dort, wo das Anlegen es zeigt (artMitPsm = Feld-Matrix)', () => {
    assert.equal(feld.FELD_MATRIX.sonstiges.psm, 'optional')
    assert.equal(feld.FELD_MATRIX.spritzung.psm, 'pflicht')
    for (const art of DB_SAETZE_ART_CHECK) {
      assert.equal(arten.artMitPsm(art), feld.FELD_MATRIX[art].psm !== 'hidden', art)
      assert.equal(arten.artMitDuengemittel(art), feld.FELD_MATRIX[art].duengemittel !== 'hidden', art)
    }
    assert.equal(feld.feldPflicht('psm', 'sonstiges'), false)
    assert.equal(feld.feldPflicht('psm', 'spritzung'), true)
  })

  test('Bodenbearbeitung: Gerät Pflicht, Tiefe optional (Mulchen, Mähen) – sonst beide ausgeblendet', () => {
    for (const art of DB_SAETZE_ART_CHECK) {
      const f = feld.FELD_MATRIX[art]
      assert.deepEqual([f.bearbeitungstiefe, f.bearbeitungsgeraet],
        art === 'bodenbearbeitung' ? ['optional', 'pflicht'] : ['hidden', 'hidden'], art)
      assert.equal('bearbeitung' in f, false, art)
    }
  })

  test('Mengenfelder: Aufwand bei Sonstiges nur mit Mittel (optional), ohne g/hl und ml/hl; alle anderen wie MENGEN_SICHT', () => {
    assert.equal(mengen.MENGEN_SICHT.sonstiges.aufwandmenge, 'bedingt')
    assert.deepEqual(mengen.mengenSicht('sonstiges', false), { mengeGesamt: 'hidden', aufwandmenge: 'hidden', konzentration: 'hidden', wasseraufwand: 'hidden' })
    assert.deepEqual(mengen.mengenSicht('sonstiges', true), { mengeGesamt: 'hidden', aufwandmenge: 'optional', konzentration: 'hidden', wasseraufwand: 'hidden' })
    for (const art of DB_SAETZE_ART_CHECK.filter(a => a !== 'sonstiges')) {
      for (const mitPsm of [false, true]) assert.deepEqual(mengen.mengenSicht(art, mitPsm), mengen.MENGEN_SICHT[art], art)
    }
    assert.deepEqual([...mengen.aufwandEinheiten('sonstiges', false)], ['kg_ha', 'l_ha', 'kg', 'l'])
    // Formular: 0,4 kg/ha auf 2 ha → Mittelmenge 0,8 kg (wie die Server Action)
    const m = mengen.mengenFelder({
      art: 'sonstiges', felder: mengen.mengenSicht('sonstiges', true),
      mengeGesamt: '', wasseraufwand: '', mengeQuelle: null,
      aufwandmenge: '0,4', aufwandmengeEinheit: 'kg_ha', konzentration: '', folge: ['aufwand'],
      flaecheHa: 2, psmId: 'p-1', psm: { cuGehaltPct: null }, duengemittelId: null, duengemittelEinheit: null,
    })
    assert.equal(m.pruefung.ok, true)
    assert.deepEqual([m.pruefung.mittelmenge.menge, m.pruefung.mittelmenge.einheit], [0.8, 'kg'])
    // ohne Mittel: Feld ausgeblendet, nichts gesendet
    const fd = new FormData()
    mengen.mengenInFormData(fd, mengen.mengenSicht('sonstiges', false), { aufwandmenge: 1, aufwandmenge_einheit: 'kg', menge_gesamt: null, menge_einheit: null, wasseraufwand_l_ha: null, reinkupfer_kg_ha: null }, null)
    assert.deepEqual([...fd.keys()], [])
  })

  test('pruefeMassnahmeMengen bei Sonstiges: Aufwand nur mit Mittel, g/hl abgelehnt, Reinkupfer wie bei der Spritzung', () => {
    const e = (teil) => ({ art: 'sonstiges', psmId: 'p-1', duengemittelId: null, psm: null, aufwand: null, aufwandEinheit: null, mengeGesamt: null, mengeEinheit: null, wasserLHa: null, flaecheHa: 2, ...teil })
    const ohne = massnahmeMengen.pruefeMassnahmeMengen(e({ psmId: null, aufwand: 5, aufwandEinheit: 'kg' }))
    assert.deepEqual([ohne.ok, ohne.werte.aufwandmenge, ohne.werte.aufwandmenge_einheit], [true, null, null])
    const leer = massnahmeMengen.pruefeMassnahmeMengen(e({}), { bruehePflicht: true })   // Mittel ohne Aufwand: erlaubt
    assert.deepEqual([leer.ok, leer.werte.aufwandmenge, leer.mittelmenge.grund], [true, null, 'art'])
    const cu = massnahmeMengen.pruefeMassnahmeMengen(e({ aufwand: 0.4, aufwandEinheit: 'kg_ha', psm: { cuGehaltPct: 35 } }))
    assert.deepEqual([cu.werte.aufwandmenge, cu.werte.aufwandmenge_einheit, cu.mittelmenge.menge, cu.cuKg, cu.werte.reinkupfer_kg_ha], [0.4, 'kg_ha', 0.8, 0.28, 0.14])
    assert.equal(cu.spritzbruehe, null)
    for (const [teil, text] of [
      [{ aufwand: 25, aufwandEinheit: 'g_hl' }, /„g_hl“ ist bei Sonstiges nicht zulässig/],
      [{ aufwand: 0, aufwandEinheit: 'kg' }, /größer als 0/],
      [{ aufwand: 1, aufwandEinheit: null }, /Einheit der Aufwandmenge/],
    ]) {
      const r = massnahmeMengen.pruefeMassnahmeMengen(e(teil))
      assert.equal(r.ok, false)
      assert.match(r.fehler, text)
    }
  })

  test('Mittelmenge, Mittelverbrauch und Aufzeichnung: Sonstiges mit Mittel und Aufwand zählt, ohne Aufwand still', () => {
    const gst = { grundstueck_id: 'g-1', flaeche_ha: 2, grundstueck: { id: 'g-1', gst_nr: '12/1', katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: 2, weingarten: null } }
    const b = (teil) => psm.normalisiereBehandlung({
      id: 'b-so', datum: '2026-05-02', datum_bis: null, art: 'sonstiges', weingarten: null, duengemittel: null,
      psm: { id: 'p-iso', name: 'Isonet LE', zulassungsnr: '3020-0' }, psm_id: 'p-iso', behandlung_grundstuecke: [gst], ...teil,
    })
    const mit = b({ aufwandmenge: 0.25, aufwandmenge_einheit: 'kg_ha' })
    assert.deepEqual([psm.mittelmenge(mit).menge, psm.mittelmenge(mit).einheit], [0.5, 'kg'])
    assert.equal(psm.mittelmenge(b({ aufwandmenge: 25, aufwandmenge_einheit: 'g_hl' })).grund, 'einheit')
    const ohne = b({})
    assert.deepEqual([psm.mittelmenge(ohne).menge, psm.mittelmenge(ohne).grund], [null, 'art'])
    const [z] = psm.mittelverbrauch([mit])
    assert.deepEqual([z.mittel, z.anwendungen, z.mittelmenge], ['Isonet LE', 1, 0.5])
    assert.match(psm.mittelverbrauchHinweise([ohne])[0], /bei Sonstiges ohne Aufwand keine Mittelmenge/)
    // Behandlungsprotokoll: Sonstiges ohne Aufwand bzw. ohne Mittel ohne Warnung „ohne Mittelmenge“
    assert.deepEqual(psm.psmAufzeichnungZeilen([ohne, b({ psm: null, psm_id: null })]).warnungen, [])
    assert.equal(psm.psmAufzeichnungZeilen([mit]).zeilen[0].mittel, 'Isonet LE')
  })
})

describe('KAN-154: Anlegen und Bearbeiten – Sonstiges mit Pflanzenschutzmittel, Bio-Sperre', nurMitHooks, () => {
  const BASIS = { datum: '2026-07-02', grundstueck_ids: 'g-1', art: 'sonstiges', schaderreger: 'Verwirrung Traubenwickler' }

  test('Anlegen ohne Mittel (Musterhof: Rodung) und mit Mittel samt Aufwand, Wartezeit und Reinkupfer', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.createBehandlung(formularAus({ ...BASIS, aufwandmenge: '5', aufwandmenge_einheit: 'kg' }))
    let p = geschrieben('insert')
    assert.deepEqual([p.psm_id, p.aufwandmenge, p.aufwandmenge_einheit, p.ernte_fruehesteins], [null, null, null, null])

    globalThis.__kan143Supabase = supabaseAttrappe({ cuGehaltPct: 35 })
    await aktionen.createBehandlung(formularAus({ ...BASIS, psm_id: 'p-1', wartezeit_tage: '14', aufwandmenge: '0,4', aufwandmenge_einheit: 'kg_ha' }))
    p = geschrieben('insert')
    assert.deepEqual([p.psm_id, p.aufwandmenge, p.aufwandmenge_einheit, p.ernte_fruehesteins, p.reinkupfer_kg_ha],
      ['p-1', 0.4, 'kg_ha', '2026-07-16', 0.14])

    globalThis.__kan143Supabase = supabaseAttrappe()
    await assert.rejects(() => aktionen.createBehandlung(formularAus({ ...BASIS, psm_id: 'p-1', aufwandmenge: '25', aufwandmenge_einheit: 'g_hl' })),
      { message: /bei Sonstiges nicht zulässig/ })
    assert.deepEqual(globalThis.__kan143Supabase.schreiben, [])
  })

  test('Bio-Sperre: nicht öko-zugelassenes Mittel bei Bio-EU – Anlegen und Bearbeiten abgelehnt, nichts geschrieben', async () => {
    for (const art of ['sonstiges', 'spritzung']) {
      for (const aufruf of [aktionen.createBehandlung, (fd) => aktionen.updateBehandlung('b-1', fd)]) {
        globalThis.__kan143Supabase = supabaseAttrappe({ bio: 'bio_eu', oeko: false })
        await assert.rejects(() => aufruf(formularAus({ ...BASIS, art, psm_id: 'p-1', aufwandmenge: '1', aufwandmenge_einheit: 'kg' })),
          { message: 'Dieses Mittel ist nicht öko-zugelassen und passt nicht zum Bio-Status des Betriebs.' }, art)
        assert.deepEqual(globalThis.__kan143Supabase.schreiben, [], art)
      }
    }
    // Gegenproben: öko-zugelassen bzw. ohne Mittel speichert; KIP sperrt nicht
    for (const [opt, felder] of [[{ bio: 'bio_eu', oeko: true }, { psm_id: 'p-1' }], [{ bio: 'bio_eu', oeko: false }, {}], [{ bio: 'kip', oeko: false }, { psm_id: 'p-1' }]]) {
      globalThis.__kan143Supabase = supabaseAttrappe(opt)
      await aktionen.updateBehandlung('b-1', formularAus({ ...BASIS, ...felder }))
      assert.equal(geschrieben('update').psm_id, felder.psm_id ?? null, JSON.stringify(opt))
    }
  })

  test('Quelltext Bearbeiten: Knopf nur beim Speichern gesperrt, Klick bei Bio-Sperre fokussiert das Mittel (role="alert")', () => {
    const edit = quelle(EDIT_FORM)
    const knopf = edit.match(/<button type="submit"[^>]*>/g) ?? []
    assert.equal(knopf.length, 1)
    assert.match(knopf[0], /disabled=\{pending\}/)
    assert.doesNotMatch(knopf[0], /bioSperre/)
    const submit = edit.slice(edit.indexOf('function handleSubmit'), edit.indexOf('updateWithId(fd)'))
    assert.match(submit, /if \(bioSperre\) \{ setBioSprung\(n => n \+ 1\); return \}/)
    assert.ok(submit.indexOf('bioSperre') < submit.indexOf('new FormData'), 'Prüfung vor dem Zusammenstellen der Daten')
    assert.match(edit, /\{bioSperre && \(\s*<div key=\{bioSprung\} id="bio-sperre-grund" role="alert"/)
    for (const [ref, name] of [['psmRef', 'psm_id'], ['duengemittelRef', 'duengemittel_id']]) {
      const s = edit.match(new RegExp(`<select ref=\\{${ref}\\}[^]*?name="${name}"[^]*?onChange`))?.[0]
      assert.ok(s, `${name}: Auswahl mit ${ref}`)
      assert.match(s, /aria-describedby=\{bioSperre \? 'bio-sperre-grund' : undefined\}/, name)
      assert.match(s, /aria-invalid=\{bioSperre \|\| undefined\}/, name)
    }
    assert.match(edit, /const mittel = psmRef\.current \?\? duengemittelRef\.current/)
    assert.match(edit, /mittel\?\.focus\(/)
    // PSM wie beim Anlegen: sichtbar bei Spritzung und Sonstiges, Pflicht laut Feld-Matrix
    assert.match(edit, /\{artMitPsm\(art\) && \(/)
    assert.match(edit, /required=\{feldPflicht\('psm', art\)\}/)
    assert.doesNotMatch(edit, /art === 'spritzung' \|\| art === 'sonstiges'/)
    // Anlegen: Mengenfelder, Material und Mittel über die Matrix
    const neu = quelle(NEU_FORM)
    assert.match(neu, /const felder = \{ \.\.\.FELD_MATRIX\[art\], \.\.\.mengenSicht\(art, !!selectedPsmId\) \}/)
    assert.match(edit, /const felder = mengenSicht\(art, !!selectedPsmId\)/)
    assert.match(neu, /felder\.psm !== 'hidden' \? selectedPsm\?\.preis_pro_einheit/)
  })
})

describe('KAN-154: Einarbeitung – sichtbar nur bei organischem Dünger, „nein“ bleibt „nein“', nurMitHooks, () => {
  test('einarbeitungAus: angehakt → true, gesendet und nicht angehakt → false, nicht gesendet → null', () => {
    assert.equal(feld.EINARBEITUNG_GESENDET, 'einarbeitung_gesendet')
    const fd = (felder) => formularAus(felder)
    assert.equal(feld.einarbeitungAus(fd({ einarbeitung_gesendet: '1', einarbeitung: 'on' })), true)
    assert.equal(feld.einarbeitungAus(fd({ einarbeitung_gesendet: '1' })), false)
    assert.equal(feld.einarbeitungAus(fd({})), null)
    assert.equal(feld.einarbeitungAus(fd({ einarbeitung: 'on' })), true)   // ohne Kennzeichen wie bisher (Assistent)
  })

  test('Modus je Art × Ausgangsart × Düngemittel-Typ (wie felderBeimBearbeiten)', () => {
    for (const art of DB_SAETZE_ART_CHECK) {
      for (const typ of ['organisch', 'mineralisch', null]) {
        assert.equal(feld.einarbeitungSichtbar(art, typ), art === 'duengung' && typ === 'organisch', `${art}/${typ}`)
        for (const startArt of [...DB_SAETZE_ART_CHECK, 'lese']) {
          const erwartet = art === 'duengung' && typ === 'organisch' ? 'sichtbar' : art === startArt ? 'behalten' : 'keine'
          assert.equal(feld.einarbeitungBeimBearbeiten(art, startArt, typ), erwartet, `${startArt} → ${art} (${typ})`)
        }
      }
    }
    assert.equal(feld.einarbeitungBeimBearbeiten('lese', 'lese', null), 'behalten')
  })

  test('updateBehandlung: true, false und nicht gesendet – unverändert gespeichert, auch bei mineralischem Dünger', async () => {
    const BASIS = { datum: '2026-03-28', grundstueck_ids: 'g-1', art: 'duengung' }
    for (const [fall, gespeichert, typ] of [
      ['organisch, eingearbeitet', { einarbeitung: true, einarbeitung_zeitpunkt: '2026-03-28' }, 'organisch'],
      ['mineralisch, nein (Musterhof)', { einarbeitung: false, einarbeitung_zeitpunkt: null }, 'mineralisch'],
      ['organisch, nein', { einarbeitung: false, einarbeitung_zeitpunkt: null }, 'organisch'],
      ['organisch, keine Angabe', { einarbeitung: null, einarbeitung_zeitpunkt: null }, 'organisch'],
      ['mineralisch, keine Angabe', { einarbeitung: null, einarbeitung_zeitpunkt: null }, 'mineralisch'],
      ['ohne Düngemittel, ja', { einarbeitung: true, einarbeitung_zeitpunkt: '2025-03-28' }, null],
    ]) {
      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.updateBehandlung('b-1', formularAus({ ...BASIS, ...einarbeitungSendet(gespeichert, 'duengung', 'duengung', typ) }))
      const p = geschrieben('update')
      assert.deepEqual([p.einarbeitung, p.einarbeitung_zeitpunkt], [gespeichert.einarbeitung, gespeichert.einarbeitung_zeitpunkt], fall)
    }
    // Klick auf die sichtbare Checkbox: ja → nein bleibt false (auf main wurde daraus null)
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.updateBehandlung('b-1', formularAus({ ...BASIS, ...einarbeitungSendet({ einarbeitung: true, einarbeitung_zeitpunkt: null }, 'duengung', 'duengung', 'organisch', false) }))
    assert.equal(geschrieben('update').einarbeitung, false)
    // nach einem Artwechsel nichts gesendet → null wie beim Anlegen
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.updateBehandlung('b-1', formularAus({ ...BASIS, art: 'bodenbearbeitung', bearbeitungsgeraet: 'Grubber',
      ...einarbeitungSendet({ einarbeitung: false, einarbeitung_zeitpunkt: null }, 'bodenbearbeitung', 'duengung', null) }))
    assert.deepEqual([geschrieben('update').einarbeitung, geschrieben('update').einarbeitung_zeitpunkt], [null, null])
  })

  test('Anlegen: sichtbare, nicht angehakte Einarbeitung → false; Assistent mit einarbeitung=false → false', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.createBehandlung(formularAus({ datum: '2026-03-28', grundstueck_ids: 'g-1', art: 'duengung', einarbeitung_gesendet: '1' }))
    assert.equal(geschrieben('insert').einarbeitung, false)
    for (const [wert, erwartet] of [[false, ['1', null]], [true, ['1', 'on']], [undefined, [null, null]]]) {
      globalThis.__kan143Aufrufe.length = 0
      const r = await tool.fuehreMassnahmeDokumentierenAus({ bestaetigt_vom_user: true, datum: '2026-03-28', weingarten_ids: ['w-1'], art: 'duengung', menge_gesamt: 500, einarbeitung: wert }, null)
      assert.equal(r.erfolg, true, String(wert))
      const fd = globalThis.__kan143Aufrufe[0]
      assert.deepEqual([fd.get('einarbeitung_gesendet'), fd.get('einarbeitung')], erwartet, String(wert))
    }
  })

  test('Quelltext: je Modus eine Stelle – nie zwei gleichnamige Felder gleichzeitig im Formular', () => {
    const edit = quelle(EDIT_FORM)
    assert.match(edit, /const einarbeitungModus = einarbeitungBeimBearbeiten\(art, startArt, selectedDuengemittel\?\.typ\)/)
    const block = (modus) => {
      const start = edit.indexOf(`{einarbeitungModus === '${modus}' && (`)
      assert.ok(start >= 0, modus)
      return edit.slice(start, edit.indexOf('\n        )}', start))
    }
    const sichtbar = block('sichtbar')
    const behalten = block('behalten')
    assert.match(sichtbar, /\{einarbeitung !== null && <input type="hidden" name=\{EINARBEITUNG_GESENDET\} value="1" \/>\}/)
    assert.match(sichtbar, /<input type="checkbox" name="einarbeitung" checked=\{!!einarbeitung\}/)
    assert.match(sichtbar, /name="einarbeitung_zeitpunkt" type="date"/)
    assert.match(behalten, /\{behandlung\.einarbeitung !== null && <input type="hidden" name=\{EINARBEITUNG_GESENDET\} value="1" \/>\}/)
    assert.match(behalten, /\{behandlung\.einarbeitung && <input type="hidden" name="einarbeitung" value="on" \/>\}/)
    assert.match(behalten, /<input type="hidden" name="einarbeitung_zeitpunkt" value=\{behandlung\.einarbeitung_zeitpunkt \?\? ''\} \/>/)
    // außerhalb der beiden Blöcke kein Feld dieser Namen (die Modi schließen sich aus)
    const rest = edit.replace(sichtbar, '').replace(behalten, '')
    assert.doesNotMatch(rest, /name=("einarbeitung"|"einarbeitung_zeitpunkt"|\{EINARBEITUNG_GESENDET\})/)
    assert.equal((edit.match(/useState<boolean \| null>\(behandlung\.einarbeitung\)/g) ?? []).length, 1)
    // Anlegen: nur bei organischem Dünger, mit Kennzeichen
    const neu = quelle(NEU_FORM)
    assert.match(neu, /\{einarbeitungSichtbar\(art, selectedDuengemittel\?\.typ\) && \(\s*<div[^>]*>\s*<input type="hidden" name=\{EINARBEITUNG_GESENDET\} value="1" \/>/)
    assert.equal((neu.match(/name="einarbeitung"/g) ?? []).length, 1)
  })
})

describe('KAN-154: Pflichtfelder beim Bearbeiten wie beim Anlegen – Altdaten ohne Wert bleiben speicherbar', nurMitHooks, () => {
  test('pflichtBeimBearbeiten: Pflicht nur nach Artwechsel oder mit gespeichertem Wert', () => {
    const FELDER = ['bbch', 'schaderreger', 'bearbeitungstiefe', 'bearbeitungsgeraet', 'schnittart']
    for (const f of FELDER) {
      for (const art of DB_SAETZE_ART_CHECK) {
        for (const startArt of DB_SAETZE_ART_CHECK) {
          for (const gespeichert of [null, '', '  ', 'Grubber', 0, 10]) {
            const erwartet = feld.feldPflicht(f, art) && (art !== startArt || (gespeichert !== null && String(gespeichert).trim() !== ''))
            assert.equal(feld.pflichtBeimBearbeiten(f, art, startArt, gespeichert), erwartet, `${f}: ${startArt} → ${art} (${gespeichert})`)
          }
        }
      }
    }
    // Fälle aus dem Ticket: Mulcher ohne Tiefe, Gerät vorhanden bzw. fehlend, Schnitt nach Artwechsel
    assert.equal(feld.pflichtBeimBearbeiten('bearbeitungstiefe', 'bodenbearbeitung', 'bodenbearbeitung', null), false)
    assert.equal(feld.pflichtBeimBearbeiten('bearbeitungstiefe', 'bodenbearbeitung', 'duengung', null), false)   // Tiefe nie Pflicht
    assert.equal(feld.pflichtBeimBearbeiten('bearbeitungsgeraet', 'bodenbearbeitung', 'bodenbearbeitung', 'Mulcher'), true)
    assert.equal(feld.pflichtBeimBearbeiten('bearbeitungsgeraet', 'bodenbearbeitung', 'bodenbearbeitung', null), false)
    assert.equal(feld.pflichtBeimBearbeiten('bearbeitungsgeraet', 'bodenbearbeitung', 'laubarbeit', null), true)
    assert.equal(feld.pflichtBeimBearbeiten('schnittart', 'schnitt', 'sonstiges', null), true)
  })

  test('Quelltext: Stern und required aus pflicht.<feld> – Anlegen: Tiefe ohne, Gerät mit Pflicht', () => {
    const edit = quelle(EDIT_FORM)
    for (const [f, spalte, name] of [
      ['bearbeitungstiefe', 'bearbeitungstiefe_cm', 'bearbeitungstiefe_cm'], ['bearbeitungsgeraet', 'bearbeitungsgeraet', 'bearbeitungsgeraet'],
      ['schnittart', 'schnittart', 'schnittart'],
    ]) {
      assert.match(edit, new RegExp(`${f}: +pflichtBeimBearbeiten\\('${f}', art, startArt, behandlung\\.${spalte}\\)`), f)
      assert.match(edit, new RegExp(`name="${name}"[^>]*required=\\{pflicht\\.${f}\\}`), f)
      assert.match(edit, new RegExp(`\\{pflicht\\.${f} && <span className="text-s112-err"> \\*</span>\\}`), f)
    }
    const neu = quelle(NEU_FORM)
    assert.match(neu, /name="bearbeitungstiefe_cm"[^>]*\s+required=\{felder\.bearbeitungstiefe === 'pflicht'\}/)
    assert.match(neu, /name="bearbeitungsgeraet"[^>]*\s+required=\{felder\.bearbeitungsgeraet === 'pflicht'\}/)
  })

  test('Musterhof-Konstellationen unverändert speichern: alle Felder bleiben, keine Pflicht ohne Wert', async () => {
    // Datenlage Produktion (SELECT 27.09.2026): 4 von 6 Bodenbearbeitungen ohne Tiefe, alle mit Gerät; 2 Schnitte
    // mit Schnittart; Düngungen organisch/eingearbeitet und mineralisch/„nein“; Sonstiges ohne Mittel
    const KONSTELLATIONEN = [
      { art: 'bodenbearbeitung', bearbeitungstiefe_cm: null, bearbeitungsgeraet: 'Mulcher', bbch_stadium: '83', witterung: 'sonnig', temperatur_c: 12 },
      { art: 'bodenbearbeitung', bearbeitungstiefe_cm: 10, bearbeitungsgeraet: 'Grubber', bbch_stadium: '05', witterung: null, temperatur_c: null },
      { art: 'schnitt', schnittart: 'Guyot', bbch_stadium: '00', witterung: 'bewoelkt', temperatur_c: 4 },
      { art: 'duengung', typ: 'organisch', einarbeitung: true, einarbeitung_zeitpunkt: '2026-03-28', bbch_stadium: '07', witterung: 'sonnig', temperatur_c: 9 },
      { art: 'duengung', typ: 'mineralisch', einarbeitung: false, einarbeitung_zeitpunkt: null, bbch_stadium: '07', witterung: null, temperatur_c: 9 },
      { art: 'sonstiges', schaderreger: 'Rodung', bbch_stadium: '00', witterung: 'wind', temperatur_c: 15 },
      { art: 'laubarbeit', laubarbeit_art: 'Ausbrechen', bbch_stadium: '68', witterung: 'sonnig', temperatur_c: 24 },
    ]
    for (const g of KONSTELLATIONEN) {
      const gespeichert = { bearbeitungstiefe_cm: null, bearbeitungsgeraet: null, schnittart: null, schaderreger: null, einarbeitung: null, einarbeitung_zeitpunkt: null, laubarbeit_art: null, ...g }
      const art = g.art
      // sichtbare Felder so, wie das Bearbeiten-Formular sie vorbelegt (nur die, die die Art zeigt)
      const sichtbar = {}
      if (art === 'bodenbearbeitung') {
        sichtbar.bearbeitungstiefe_cm = String(gespeichert.bearbeitungstiefe_cm ?? '')
        sichtbar.bearbeitungsgeraet = gespeichert.bearbeitungsgeraet ?? ''
      }
      if (art === 'schnitt') sichtbar.schnittart = gespeichert.schnittart ?? ''
      if (art === 'laubarbeit') sichtbar.laubarbeit_art = gespeichert.laubarbeit_art ?? ''
      // keine Pflicht verlangt einen Wert, den es nicht gibt (sonst blockierte der Browser das Speichern)
      for (const [f, spalte] of [['bbch', 'bbch_stadium'], ['schaderreger', 'schaderreger'], ['bearbeitungstiefe', 'bearbeitungstiefe_cm'], ['bearbeitungsgeraet', 'bearbeitungsgeraet'], ['schnittart', 'schnittart']]) {
        if (feld.pflichtBeimBearbeiten(f, art, art, gespeichert[spalte])) assert.ok(String(gespeichert[spalte] ?? '').trim() !== '', `${art}: ${f} Pflicht ohne Wert`)
      }
      globalThis.__kan143Supabase = supabaseAttrappe()
      await aktionen.updateBehandlung('b-1', formularAus({
        datum: '2026-04-01', grundstueck_ids: 'g-1', art,
        ...bearbeitenSendet(gespeichert, art, art),
        ...einarbeitungSendet(gespeichert, art, art, g.typ ?? null),
        ...sichtbar,
      }))
      const p = geschrieben('update')
      for (const spalte of ['bbch_stadium', 'schaderreger', 'witterung', 'temperatur_c', 'bearbeitungstiefe_cm', 'bearbeitungsgeraet', 'schnittart', 'laubarbeit_art', 'einarbeitung', 'einarbeitung_zeitpunkt']) {
        assert.deepEqual(p[spalte], gespeichert[spalte] ?? null, `${art}${g.typ ? ` (${g.typ})` : ''}: ${spalte}`)
      }
      assert.equal(p.psm_id, null, art)
    }
  })

  test('Assistent: Feld-Matrix nennt Tiefe optional und Mittel bei Sonstiges', () => {
    assert.match(tool.MASSNAHME_FELD_MATRIX_TEXT, /- bodenbearbeitung: +bearbeitungsgeraet \(pflicht\), bearbeitungstiefe_cm \(optional/)
    assert.match(tool.MASSNAHME_FELD_MATRIX_TEXT, /psm_id \(optional, z\. B\. Pheromon-Dispenser\), aufwandmenge \+ aufwandmenge_einheit\s+\(optional, nur mit psm_id/)
  })

  test('Hilfe: FAQ und Handbuch nennen Mittel bei Sonstiges, Tiefe optional, Einarbeitung und Altdaten-Ausnahme', () => {
    const faq = quelle('app/(dashboard)/hilfe/faq/page.tsx')
    const hb = quelle('app/(dashboard)/hilfe/handbuch/page.tsx')
    for (const [name, s] of [['FAQ', faq], ['Handbuch', hb]]) {
      assert.match(s, /Pheromon-Dispenser/, name)
      assert.match(s, /Gerät Pflicht, die Bearbeitungstiefe optional/, name)
      assert.match(s, /Einarbeitung[^.]*nur bei organischem Dünger/, name)
      assert.doesNotMatch(s, /entfallen "Spritzmittel" und die Mengenfelder|das Feld "Spritzmittel" und die Mengenfelder/, name)
    }
    assert.match(faq, /lässt sie sich unverändert speichern – Pflicht werden sie erst, wenn du die Art wechselst oder das Feld schon einen Wert hat/)
    assert.match(hb, /Pflichtfelder ohne gespeicherten Wert \(z\. B\. ältere Maßnahmen ohne Gerät\) verlangen beim unveränderten Speichern keine Angabe/)
    assert.match(faq, /Beim Bearbeiten macht „Änderungen speichern“ dasselbe; gespeichert wird dabei nichts\./)
  })
})

// ── KAN-155: BBCH und Schaderreger optional, Ried-Auswahl (Pilotbetrieb, 28.09.2026) ─────────────────────────

describe('KAN-155: Spritzung ohne BBCH-Stadium und Schaderreger – anlegen, bearbeiten, Assistent, Protokoll', nurMitHooks, () => {
  const SPRITZUNG = { datum: '2026-07-02', grundstueck_ids: 'g-1', art: 'spritzung', psm_id: 'p-1', aufwandmenge: '0,6', aufwandmenge_einheit: 'kg_ha', wasseraufwand_l_ha: '400' }

  test('Feld-Matrix: bei der Spritzung optional, auch beim Bearbeiten mit gespeichertem Wert oder nach Artwechsel', () => {
    assert.deepEqual([feld.FELD_MATRIX.spritzung.bbch, feld.FELD_MATRIX.spritzung.schaderreger], ['optional', 'optional'])
    for (const f of ['bbch', 'schaderreger']) {
      for (const startArt of ['spritzung', 'duengung']) {
        for (const gespeichert of [null, '', '61', 'Peronospora']) {
          assert.equal(feld.pflichtBeimBearbeiten(f, 'spritzung', startArt, gespeichert), false, `${f} ${startArt} ${gespeichert}`)
        }
      }
      // Eingabefeld bleibt sichtbar – nur ohne Stern und required
      assert.equal(feld.feldBeimBearbeiten(f, 'spritzung', 'spritzung'), 'sichtbar')
    }
    // übrige Pflichtfelder unverändert
    assert.equal(feld.feldPflicht('psm', 'spritzung'), true)
    assert.equal(feld.feldPflicht('bearbeitungsgeraet', 'bodenbearbeitung'), true)
    assert.equal(feld.feldPflicht('schnittart', 'schnitt'), true)
  })

  test('Server Actions: anlegen und bearbeiten ohne BBCH und Schaderreger speichert null', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.createBehandlung(formularAus(SPRITZUNG))
    let p = geschrieben('insert')
    assert.deepEqual([p.art, p.bbch_stadium, p.schaderreger, p.aufwandmenge, p.wasseraufwand_l_ha, p.menge_gesamt], ['spritzung', null, null, 0.6, 400, 800])
    globalThis.__kan143Supabase = supabaseAttrappe()
    await aktionen.updateBehandlung('b-1', formularAus({ ...SPRITZUNG, bbch_stadium: '', schaderreger: '' }))
    p = geschrieben('update')
    assert.deepEqual([p.bbch_stadium, p.schaderreger], [null, null])
  })

  test('Server Action: Aufwand + Konzentration ohne Spritzbrühe und Wasseraufwand ergänzt Wasseraufwand und Spritzbrühe', async () => {
    globalThis.__kan143Supabase = supabaseAttrappe()
    const ohneWasser = { ...SPRITZUNG }
    delete ohneWasser.wasseraufwand_l_ha
    await aktionen.createBehandlung(formularAus({ ...ohneWasser, aufwandmenge: '2', aufwandmenge_einheit: 'l_ha', konzentration: '0,5' }))
    const p = geschrieben('insert')
    // 2 l/ha ÷ 0,5 % × 100 = 400 l/ha; GST der Attrappe mit 2 ha → 800 l
    assert.deepEqual([p.aufwandmenge, p.konzentration, p.wasseraufwand_l_ha, p.menge_gesamt, p.menge_einheit], [2, 0.5, 400, 800, 'l'])
  })

  test('Assistent: Spritzung ohne BBCH und Schaderreger, nur mit Aufwand und Konzentration', async () => {
    globalThis.__kan143Aufrufe.length = 0
    const eingabe = { bestaetigt_vom_user: true, datum: '2026-07-02', weingarten_ids: ['w-1'], art: 'spritzung', psm_id: 'p-1', aufwandmenge: 2, aufwandmenge_einheit: 'l_ha' }
    const r = await tool.fuehreMassnahmeDokumentierenAus({ ...eingabe, konzentration: 0.5 }, supabaseAttrappe())
    assert.equal(r.erfolg, true, JSON.stringify(r))
    const fd = globalThis.__kan143Aufrufe[0]
    assert.deepEqual([fd.has('bbch_stadium'), fd.has('schaderreger'), fd.get('konzentration')], [false, false, '0,5'])
    assert.match(tool.MASSNAHME_FELD_MATRIX_TEXT, /bbch_stadium\/schaderreger\/konzentration\/witterung\/temperatur_c \(optional\)/)
    assert.doesNotMatch(tool.MASSNAHME_FELD_MATRIX_TEXT, /bbch_stadium \(pflicht\)|schaderreger \(pflicht\)/)
    // ohne Konzentration weiter die Rückfrage nach Spritzbrühe bzw. Wasseraufwand
    globalThis.__kan143Aufrufe.length = 0
    const ohne = await tool.fuehreMassnahmeDokumentierenAus(eingabe, supabaseAttrappe())
    assert.equal(ohne.erfolg, false)
    assert.match(ohne.hinweis, /Spritzbrühe gesamt \(l\) oder den Wasseraufwand \(l\/ha\) angeben – bei kg\/ha, l\/ha bzw\. kg, l \(gesamt\) genügt auch die Konzentration/)
    assert.equal(globalThis.__kan143Aufrufe.length, 0)
  })

  test('Behandlungsprotokoll: leeres BBCH und leerer Schaderreger – Druck „–“, CSV leere Zellen', async () => {
    const csv = await laden('lib/csv/index.ts')
    const gst = { grundstueck_id: 'g-1', flaeche_ha: 2, grundstueck: { id: 'g-1', gst_nr: '12/1', katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: 2, weingarten: null } }
    for (const [bbch, schaderreger] of [[null, null], ['', '  ']]) {
      const b = psm.normalisiereBehandlung({
        id: 'b-sp', datum: '2026-07-02', datum_bis: null, art: 'spritzung', weingarten: null, duengemittel: null,
        psm: { id: 'p-1', name: 'Funguran Progress' }, psm_id: 'p-1', behandlung_grundstuecke: [gst],
        aufwandmenge: 0.6, aufwandmenge_einheit: 'kg_ha', wasseraufwand_l_ha: 400, bbch_stadium: bbch, schaderreger,
      })
      assert.deepEqual([b.bbch, b.schaderreger], [null, null])
      const { zeilen } = psm.psmAufzeichnungZeilen([b])
      const text = csv.csvText(zeilen, psm.SPALTEN_PSM_AUFZEICHNUNG)
      const [kopf, zeile] = text.replace(/^﻿/, '').split('\r\n')
      const spalten = kopf.split(';')
      const werte = zeile.split(';')
      assert.equal(werte[spalten.indexOf('Schaderreger')], '')
      assert.equal(werte[spalten.indexOf('BBCH')], '')
      assert.equal(werte[spalten.indexOf('Mittel')], 'Funguran Progress')
    }
    const druck = quelle('app/(dashboard)/reports/(pflicht)/behandlungsprotokoll/page.tsx')
    assert.match(druck, /\{b\.schaderreger \?\? '–'\}/)
    assert.match(druck, /\{b\.bbch \?\? '–'\}/)
  })

  test('Quelltext: Stern und required nur bei Pflicht – Anlegen nach Feld-Matrix, Bearbeiten über pflichtBeimBearbeiten', () => {
    const neu = quelle(NEU_FORM)
    assert.match(neu, /<select name="bbch_stadium" required=\{felder\.bbch === 'pflicht'\}/)
    assert.match(neu, /name="schaderreger" type="text" required=\{felder\.schaderreger === 'pflicht'\}/)
    const edit = quelle(EDIT_FORM)
    assert.match(edit, /required=\{pflicht\.bbch\}/)
    assert.match(edit, /required=\{pflicht\.schaderreger\}/)
    const hb = quelle('app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(hb, /BBCH-Stadium und Schaderreger sind bei der Spritzung optional/)
  })
})

describe('KAN-155: Ried-Auswahl – „Ohne Ried-Zuordnung“ zuletzt, „Alle auswählen“ ↔ „Alle abwählen“', nurMitHooks, () => {
  const wg = (id, lage_name, spritzbar = true) => ({ id, lage_name, spritzbar })

  test('riedGruppen: Rieden alphabetisch (de), Weingärten ohne Ried in einer Gruppe am Ende', () => {
    const g = absenden.riedGruppen([wg('1', null), wg('2', 'Zöbinger Heiligenstein'), wg('3', 'Äußere Point'), wg('4', ''), wg('5', 'Gaisberg'), wg('6', 'Gaisberg'), wg('7', '  ')])
    assert.deepEqual(g.map(x => x.name), ['Äußere Point', 'Gaisberg', 'Zöbinger Heiligenstein', 'Ohne Ried-Zuordnung'])
    assert.deepEqual(g.map(x => x.weingaerten.map(w => w.id)), [['3'], ['5', '6'], ['2'], ['1', '4', '7']])
    assert.deepEqual(g.map(x => x.ohneRied), [false, false, false, true])
    // eindeutige Schlüssel – auch wenn ein Ried zufällig so heißt wie die Sammelgruppe
    const doppelt = absenden.riedGruppen([wg('1', 'Ohne Ried-Zuordnung'), wg('2', null)])
    assert.equal(new Set(doppelt.map(x => x.schluessel)).size, 2)
    assert.deepEqual(doppelt.map(x => x.ohneRied), [false, true])
    // ohne Weingärten ohne Ried keine leere Sammelgruppe; ganz leer → keine Gruppe
    assert.deepEqual(absenden.riedGruppen([wg('1', 'Gaisberg')]).map(x => x.name), ['Gaisberg'])
    assert.deepEqual(absenden.riedGruppen([]), [])
    assert.equal(absenden.OHNE_RIED_GRUPPE, 'Ohne Ried-Zuordnung')
  })

  test('alleAuswahlModus: „abwählen“ erst, wenn alle spritzbaren ganz ausgewählt sind', () => {
    assert.equal(absenden.alleAuswahlModus(['a', 'b'], new Set()), 'auswaehlen')
    assert.equal(absenden.alleAuswahlModus(['a', 'b'], new Set(['a'])), 'auswaehlen')
    assert.equal(absenden.alleAuswahlModus(['a', 'b'], new Set(['a', 'b'])), 'abwaehlen')
    assert.equal(absenden.alleAuswahlModus(['a', 'b'], new Set(['a', 'b', 'x'])), 'abwaehlen')
    assert.equal(absenden.alleAuswahlModus([], new Set()), 'auswaehlen')
  })

  test('Quelltext Anlegen: Gruppen aus riedGruppen, kein „Alle Rieden“ mehr, Knopf schaltet und leert die ganze Auswahl', () => {
    const neu = quelle(NEU_FORM)
    assert.doesNotMatch(neu, /'Alle Rieden'/)
    assert.match(neu, /const lagen = riedGruppen\(weingaerten\)/)
    assert.match(neu, /\{alleModus === 'abwaehlen' \? 'Alle abwählen' : 'Alle auswählen'\}/)
    assert.match(neu, /setSelectedGSTs\(new Map\(\)\)\s+setSelectedWGs\(alleModus === 'abwaehlen' \? new Set\(\) : new Set\(spritzbareIds\)\)/)
    assert.match(neu, /<div key=\{schluessel\}/)
    const hb = quelle('app/(dashboard)/hilfe/handbuch/page.tsx')
    assert.match(hb, /„Ohne Ried-Zuordnung“/)
    assert.match(hb, /„Alle abwählen“/)
  })
})
