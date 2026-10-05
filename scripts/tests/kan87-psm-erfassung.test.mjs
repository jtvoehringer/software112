// KAN-87 (05.10.2026): Pflanzenschutz-Aufzeichnung – Anwender, Startuhrzeit, „erfasst am/von“, Erfassungsfrist
// (Standard 24 h ab Ende des Anwendungstags, Wiener Zeit; Pflanzenschutz und Düngung), Ampel und CSV „psm-uebermittlung“ (Golden-Test mit Musterhof-Daten).
// DB-Test 39 (Trigger b_erfassung, CHECKs).
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const ef = hooksMoeglich ? await laden('lib/behandlungen/erfassungsfrist.ts') : null
const psm = hooksMoeglich ? await laden('lib/behoerden/psm.ts') : null
const ueb = hooksMoeglich ? await laden('lib/behoerden/psm_uebermittlung.ts') : null
const csv = hooksMoeglich ? await laden('lib/csv/index.ts') : null

const utc = s => new Date(s).getTime()

describe('KAN-87 Erfassungsfrist in Wiener Zeit', nurMitHooks, () => {
  test('wienZeitpunkt: Sommer- und Winterzeit, Zeitumstellung', () => {
    assert.equal(ef.wienZeitpunkt('2026-07-10', '06:30'), utc('2026-07-10T04:30:00Z'))
    assert.equal(ef.wienZeitpunkt('2026-01-10', '06:30'), utc('2026-01-10T05:30:00Z'))
    assert.equal(ef.wienZeitpunkt('2026-03-29', '04:00'), utc('2026-03-29T02:00:00Z'))   // nach der Umstellung (MESZ)
    assert.equal(ef.wienZeitpunkt('2026-10-25', '00:00'), utc('2026-10-24T22:00:00Z'))   // noch MESZ
    assert.equal(ef.wienZeitpunkt('kein Datum'), null)
  })

  test('Frist ab Tagesende des Anwendungstags (Entscheidung 05.10.2026) – Enduhrzeit zählt nicht; mehrtägig ab datum_bis', () => {
    assert.equal(ef.anwendungsEnde({ datum: '2026-07-10', uhrzeitBis: '09:00' }), utc('2026-07-10T22:00:00Z'))
    assert.equal(ef.anwendungsEnde({ datum: '2026-07-10' }), utc('2026-07-10T22:00:00Z'))
    assert.equal(ef.anwendungsEnde({ datum: '2026-01-10' }), utc('2026-01-10T23:00:00Z'))   // Winterzeit
    assert.equal(ef.anwendungsEnde({ datum: '2026-07-10', datumBis: '2026-07-12' }), utc('2026-07-12T22:00:00Z'))
  })

  test('Frist gilt für Pflanzenschutz und Düngung', () => {
    assert.equal(ef.fristRelevant({ art: 'spritzung', psmId: 'p-1' }), true)
    assert.equal(ef.fristRelevant({ art: 'sonstiges', psm_id: 'p-1' }), true)
    assert.equal(ef.fristRelevant({ art: 'duengung', psmId: null }), true)
    assert.equal(ef.fristRelevant({ art: 'laubarbeit', psmId: null }), false)
    assert.equal(ef.fristRelevant({ art: 'sonstiges', psmId: null }), false)
  })

  test('Verzug in vollen Stunden; Ampel grün bis Frist, gelb bis 72 h, rot darüber', () => {
    const a = { datum: '2026-07-10' }
    assert.equal(ef.erfassungsverzugH(a, '2026-07-10T06:00:00Z'), 0)   // am Anwendungstag erfasst
    assert.equal(ef.erfassungsverzugH(a, '2026-07-11T22:00:00Z'), 24)
    assert.equal(ef.erfassungsAmpel(24), 'gruen')
    assert.equal(ef.erfassungsAmpel(25), 'gelb')
    assert.equal(ef.erfassungsAmpel(72), 'gelb')
    assert.equal(ef.erfassungsAmpel(73), 'rot')
    assert.equal(ef.erfassungsAmpel(100, 120), 'gruen')   // Frist länger als 72 h: bis zur Frist grün, danach rot
    assert.equal(ef.erfassungsAmpel(100, 96), 'rot')
    assert.equal(ef.erfassungsAmpel(50, 48), 'gelb')
    assert.equal(ef.nacherfasstText(30), 'nacherfasst (+30 h)')
    assert.equal(ef.nacherfasstText(24), null)
    assert.match(ef.nacherfassungHinweis(30, 24), /^Nacherfassung \(\+30 h\)/)
  })

  test('Regression: Ampel zwischen 0 und 2 Uhr Wiener Zeit (UTC-Server) – Tag der Anwendung zählt in Wien', () => {
    // Anwendung am 10.07. ohne Uhrzeit, erfasst am 12.07. um 01:30 Wiener Zeit (= 11.07. 23:30 UTC): 25 h nach Tagesende
    const v = ef.erfassungsverzugH({ datum: '2026-07-10' }, '2026-07-11T23:30:00Z')
    assert.equal(v, 25)
    assert.equal(ef.erfassungsAmpel(v), 'gelb')
    // erfasst am 10.07. um 23:30 Wien (= 21:30 UTC): vor dem Tagesende in Wien → 0 h; 11.07. 01:30 Wien → 1 h
    assert.equal(ef.erfassungsverzugH({ datum: '2026-07-10' }, '2026-07-10T21:30:00Z'), 0)
    assert.equal(ef.erfassungsverzugH({ datum: '2026-07-10' }, '2026-07-10T23:30:00Z'), 1)
    // Anwendung „heute“ (11.07.) um 01:30 Wien erfasst – die UTC-Uhr zeigt noch den 10.07. → 0 h, grün
    assert.equal(ef.erfassungsverzugH({ datum: '2026-07-11' }, '2026-07-10T23:30:00Z'), 0)
  })

  test('wienHeute statt toISOString: 00:30 Wiener Zeit ist schon der neue Tag', () => {
    assert.equal(ef.wienHeute(new Date('2026-07-10T22:30:00Z')), '2026-07-11')
  })

  test('Uhrzeiten: Pflicht bei bienengefährlich, Ende nicht vor Beginn (außer mehrtägig)', () => {
    assert.equal(ef.uhrzeitAus(' 06:30 '), '06:30')
    assert.equal(ef.uhrzeitAus(''), null)
    assert.equal(ef.uhrzeitAus('25:00'), undefined)
    assert.match(ef.uhrzeitFehler({ datum: '2026-07-10', uhrzeitVon: null, uhrzeitBis: null, bienengefaehrlich: true }), /bienengefährlich/)
    assert.equal(ef.uhrzeitFehler({ datum: '2026-07-10', uhrzeitVon: null, uhrzeitBis: null, bienengefaehrlich: false }), null)
    assert.match(ef.uhrzeitFehler({ datum: '2026-07-10', uhrzeitVon: '10:00', uhrzeitBis: '08:00', bienengefaehrlich: false }), /vor der Startuhrzeit/)
    assert.equal(ef.uhrzeitFehler({ datum: '2026-07-10', datumBis: '2026-07-11', uhrzeitVon: '18:00', uhrzeitBis: '08:00', bienengefaehrlich: false }), null)
  })

  test('Anwender: Standard ich, Mitglied, Fremdanwender; kein fremdes Mitglied', () => {
    const m = ['u-1', 'u-2']
    assert.deepEqual(ef.anwenderAus('', null, 'u-1', m), { durchgefuehrtVon: 'u-1', anwenderName: null })
    assert.deepEqual(ef.anwenderAus('', null, 'u-1', []), { durchgefuehrtVon: 'u-1', anwenderName: null })   // ich – ohne Mitgliederliste
    assert.deepEqual(ef.anwenderAus('u-2', null, 'u-1', m), { durchgefuehrtVon: 'u-2', anwenderName: null })
    assert.deepEqual(ef.anwenderAus(ef.ANWENDER_FREMD, '  Lohnunternehmer   Huber ', 'u-1', m), { durchgefuehrtVon: null, anwenderName: 'Lohnunternehmer Huber' })
    assert.ok('fehler' in ef.anwenderAus(ef.ANWENDER_FREMD, '', 'u-1', m))
    assert.ok('fehler' in ef.anwenderAus('u-9', null, 'u-1', m))
    const mitglieder = [{ id: 'u-1', name: 'Hannes Muster' }, { id: 'u-2', name: 'Paul Muster' }]
    assert.deepEqual(ef.anwenderZuordnen('ich', mitglieder), { anwender: '' })
    assert.deepEqual(ef.anwenderZuordnen('hannes muster', mitglieder), { anwender: 'u-1' })
    assert.deepEqual(ef.anwenderZuordnen('Paul', mitglieder), { anwender: 'u-2' })
    assert.deepEqual(ef.anwenderZuordnen('Muster', mitglieder), { anwender: ef.ANWENDER_FREMD, anwenderName: 'Muster' })   // mehrdeutig
    assert.deepEqual(ef.anwenderZuordnen('Maschinenring', mitglieder), { anwender: ef.ANWENDER_FREMD, anwenderName: 'Maschinenring' })
  })

  test('Fristen-Dashboard: Ampel der Saison und Zahl der Nacherfassungen', () => {
    const z = [
      { datum: '2026-07-10', created_at: '2026-07-10T18:00:00Z' },   // vor Tagesende: 0 h
      { datum: '2026-07-12', uhrzeit_bis: null, created_at: '2026-07-14T10:00:00Z' },       // ab 12.07. 24:00 Wien: 36 h → gelb
    ]
    const f = ef.psmErfassungFrist(z, 24, 2026)
    assert.equal(f.status, 'faellig')
    assert.equal(f.nacherfassungen, 1)
    assert.equal(f.bezeichnung, 'Aufzeichnung Pflanzenschutz & Düngung (24 h)')
    assert.match(f.statusText, /1 Nacherfassung 2026 · max\. \+36 h/)
    assert.equal(ef.psmErfassungFrist([...z, { datum: '2026-07-01', created_at: '2026-07-20T10:00:00Z' }], 24, 2026).status, 'ueberfaellig')
    assert.equal(ef.psmErfassungFrist(z.slice(0, 1), 24, 2026).status, 'laufend')
    assert.match(ef.psmErfassungFrist([], 24, 2026).statusText, /keine Anwendungen 2026/)
  })
})

// ── Golden-Test psm-uebermittlung (Musterhof-Daten: Ried Pfaffenberg mit zwei GST, eine Spritzung durch den
// Betriebsleiter rechtzeitig, eine Nacherfassung durch einen Lohnunternehmer, eine Düngung – nicht in der CSV) ──
const WG = { id: 'w-1', name: 'Pfaffenberg', ried: null, flaeche_ha: 1.2, lage_id: null, ama_feldnummer: '12', lagen: { name: 'Steiner Pfaffenberg' } }
const GST1 = { id: 'g-1', gst_nr: '1203/1', katastralgemeinde: '12034', kg_bezeichnung: 'Stein', flaeche_ha: 0.8, ama_feldnummer: '3', weingarten: WG }
const GST2 = { id: 'g-2', gst_nr: '1204', katastralgemeinde: '12034', kg_bezeichnung: 'Stein', flaeche_ha: 0.4, ama_feldnummer: '4', weingarten: WG }
const MITTEL = { id: 'p-1', name: 'Folpan 80 WDG', handelsname: null, wirkstoff: 'Folpet', wirkstoffgehalt_pct: 80, zulassungsnr: '2648-0', eppo_code: 'PLASVI', bienengefaehrlich: false, cu_gehalt_pct: null, wartezeit_tage: 35, max_aufwand_kg_ha: null, max_anwendungen: null, oeko_zugelassen: false }
const ROH = [
  { id: '11111111-0000-4000-8000-000000000001', datum: '2026-06-10', datum_bis: null, art: 'spritzung', psm_id: 'p-1', psm: MITTEL,
    aufwandmenge: 1.2, aufwandmenge_einheit: 'kg_ha', wasseraufwand_l_ha: 400, bbch_stadium: '61', durchgefuehrt_von: 'u-1', erfasst_von: 'u-1',
    uhrzeit_von: '06:30:00', uhrzeit_bis: '09:00:00', art_verwendung: 'freiland', anwender_name: null, created_at: '2026-06-10T17:30:00+00:00',
    weingarten_id: 'w-1', weingarten: WG, behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 0.8, grundstueck: GST1 }, { grundstueck_id: 'g-2', flaeche_ha: 0.4, grundstueck: GST2 }] },
  { id: '11111111-0000-4000-8000-000000000002', datum: '2026-06-24', datum_bis: null, art: 'spritzung', psm_id: 'p-1', psm: MITTEL,
    aufwandmenge: 1.2, aufwandmenge_einheit: 'kg_ha', wasseraufwand_l_ha: 400, bbch_stadium: '71', durchgefuehrt_von: null, erfasst_von: 'u-1',
    uhrzeit_von: '05:45:00', uhrzeit_bis: null, art_verwendung: 'freiland', anwender_name: 'Lohnunternehmer Huber', created_at: '2026-06-27T08:15:00+00:00',
    weingarten_id: 'w-1', weingarten: WG, behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 0.8, grundstueck: GST1 }] },
  { id: '11111111-0000-4000-8000-000000000003', datum: '2026-04-02', datum_bis: null, art: 'duengung', psm_id: null, psm: null, duengemittel_id: 'd-1',
    duengemittel: { id: 'd-1', name: 'Kompost', einheit: 'kg' }, menge_gesamt: 500, menge_einheit: 'kg', created_at: '2026-04-02T12:00:00+00:00',
    weingarten_id: 'w-1', weingarten: WG, behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 0.8, grundstueck: GST1 }] },
]
const NAMEN = new Map([['u-1', 'Hannes Muster']])

describe('KAN-87 CSV psm-uebermittlung', nurMitHooks, () => {
  const behandlungen = () => ROH.map(r => psm.normalisiereBehandlung(r, NAMEN))

  test('Golden-Datei: byte-identisch (Excel-AT-Profil), nur Pflanzenschutz, Fremdanwender und Nacherfassung', () => {
    const e = ueb.psmUebermittlungZeilen(behandlungen(), '1234567', 24)
    assert.equal(e.zeilen.length, 3)
    assert.deepEqual(e.warnungen, [])
    const text = csv.csvText(e.zeilen, ueb.SPALTEN_PSM_UEBERMITTLUNG)
    assert.equal(text, readFileSync(path.join(HIER, 'golden', 'psm_uebermittlung_musterhof.csv'), 'utf8'))
  })

  test('Leermeldung: 0 Anwendungen → nur Kopfzeile', () => {
    const e = ueb.psmUebermittlungZeilen([], '1234567', 24)
    assert.equal(e.zeilen.length, 0)
    const text = csv.csvText(e.zeilen, ueb.SPALTEN_PSM_UEBERMITTLUNG)
    assert.equal(text.split('\r\n').filter(Boolean).length, 1)
    assert.match(text, /^﻿Datensatz-ID;Betriebsnummer;Anwender;Datum;/)
  })

  test('Hinweise: Anwendung ohne Anwender, Mittel ohne Registernummer, Betriebsnummer fehlt', () => {
    const roh = { ...ROH[0], durchgefuehrt_von: null, psm: { ...MITTEL, zulassungsnr: null } }
    const e = ueb.psmUebermittlungZeilen([psm.normalisiereBehandlung(roh, NAMEN)], null, 24)
    assert.equal(e.warnungen.length, 3)
  })

  test('psm-aufzeichnung hat die Zusatzspalten', () => {
    const koepfe = psm.SPALTEN_PSM_AUFZEICHNUNG.map(s => s.kopf)
    for (const k of ['Startzeit', 'Art der Verwendung', 'AMA-Feldstück', 'AMA-Schlag', 'Erfasst am', 'Erfasst von', 'Datensatz-ID']) assert.ok(koepfe.includes(k), k)
    const z = psm.psmAufzeichnungZeilen(behandlungen()).zeilen
    const fremd = z.find(r => r.behandlungId.endsWith('2'))
    assert.equal(fremd.anwender, 'Lohnunternehmer Huber')
    assert.equal(fremd.uhrzeitVon, '05:45')
    assert.equal(fremd.erfasstVon, 'Hannes Muster')
    assert.equal(z.find(r => r.behandlungId.endsWith('3')).artVerwendung, null)   // Düngung ohne Art der Verwendung
  })
})

describe('KAN-87 Verdrahtung', () => {
  test('createBehandlung: Anwendungsfelder für Formular und Assistent, Hinweis Nacherfassung als Rückgabe', () => {
    const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
    assert.match(a, /const anwendung = await anwendungSpalten\(supabase, tenantId, formData, psmId, datum, datumBis, true\)/)
    assert.match(a, /const anwendung = await anwendungSpalten\(supabase, tenantId, formData, psmId, datum, datumBis, false\)/)
    assert.match(a, /nacherfassungHinweis\(erfassungsverzugH\(/)
    assert.match(a, /return \{ id: behandlungId, hinweise \}/)
    // erfasst am/von schreibt die App nie selbst (Trigger b_erfassung)
    assert.doesNotMatch(a, /erfasst_von:|created_at:/)
  })

  test('Formular: Datum in Wiener Zeit, Anwendungsfelder in Neu und Bearbeiten', () => {
    const n = quelle('src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx')
    assert.doesNotMatch(n, /toISOString\(\)\.split\('T'\)\[0\]/)
    assert.match(n, /useState\(\(\) => wienHeute\(\)\)/)
    assert.match(n, /<AnwendungFelder /)
    assert.match(quelle('src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx'), /<AnwendungFelder [\s\S]*?vorschau=\{false\}/)
  })

  test('Assistent: Anwender, Uhrzeit, Art der Verwendung im Tool-Schema', () => {
    const t = quelle('src/lib/assistent/tools/massnahme.ts')
    for (const f of ['uhrzeit_von', 'uhrzeit_bis', 'anwender', 'art_verwendung']) assert.match(t, new RegExp(`${f}: \\{ type: 'string'`), f)
    assert.match(quelle('src/lib/assistent/kontext.ts'), /bienengefährlich – Startuhrzeit Pflicht/)
  })

  test('Fristen-Dashboard, Liste, Katalog und Register', () => {
    assert.match(quelle('src/app/(dashboard)/dashboard/_shared/data.ts'), /psmErfassungFrist\(/)
    assert.match(quelle('src/app/(dashboard)/behandlungen/page.tsx'), /nacherfasstText\(verzug, psmFristH\)/)
    assert.match(quelle('src/lib/behoerden/katalog/pflanzenschutz.ts'), /'psm-uebermittlung': \{/)
    assert.match(quelle('src/lib/behoerden/register/pflanzenschutz.ts'), /'psm-uebermittlung': definiereMeldung/)
    assert.match(quelle('src/app/(dashboard)/reports/(pflicht)/behandlungsprotokoll/page.tsx'), /csvPfad\('psm-uebermittlung'/)
  })

  test('Migration: Trigger b_erfassung, Frist-Spalte mit Spaltenrecht, Demo-Reset ohne Nacherfassung', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan87_psm_erfassung.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan87_psm_erfassung.sql')
    assert.match(m, /CREATE TRIGGER b_erfassung BEFORE INSERT OR UPDATE ON public\.behandlungen/)
    assert.match(m, /NEW\.created_at := now\(\);\s+NEW\.erfasst_von := v_uid;/)
    assert.match(m, /GRANT SELECT \(psm_erfassungsfrist_h\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    assert.match(m, /coalesce\(datum_bis > datum, false\)/)
    assert.match(m, /\+ time '19:30'\) at time zone 'Europe\/Vienna'/)
  })
})
