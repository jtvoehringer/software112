// KAN-129: Lesen je Jahrgang – Regeln für „Neue Lese“, Reiter und Löschsperre (src/lib/wein/lesen.ts)
// sowie die Verdrahtung in Actions und Seiten (Quelltext-Prüfungen).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  gewaehlteLese, jahrgangAusEingabe, leseLoeschsperre, leseTitel, leseZeitraumFehler, leseZeitraumText,
  vorgeschlagenerJahrgang,
} from '../../src/lib/wein/lesen.ts'

test('vorgeschlagener Jahrgang: Jänner/Februar → Vorjahr (Eiswein), sonst laufendes Jahr', () => {
  assert.equal(vorgeschlagenerJahrgang('2027-01-15'), 2026)
  assert.equal(vorgeschlagenerJahrgang('2027-02-28'), 2026)
  assert.equal(vorgeschlagenerJahrgang('2027-03-01'), 2027)
  assert.equal(vorgeschlagenerJahrgang('2026-09-29'), 2026)
})

test('Jahrgang aus Eingabe: nur 1900–2100', () => {
  assert.equal(jahrgangAusEingabe('2026'), 2026)
  assert.equal(jahrgangAusEingabe(' 2026 '), 2026)
  assert.equal(jahrgangAusEingabe('1899'), null)
  assert.equal(jahrgangAusEingabe('20a6'), null)
  assert.equal(jahrgangAusEingabe(''), null)
})

test('Zeitraum: Jahrgangsjahr bis 31.03. des Folgejahres, Ende nicht vor Beginn', () => {
  assert.equal(leseZeitraumFehler(2026, null, null), null)
  assert.equal(leseZeitraumFehler(2026, '2026-09-01', '2026-10-15'), null)
  assert.equal(leseZeitraumFehler(2026, '2027-01-10', '2027-03-31'), null)
  assert.match(leseZeitraumFehler(2026, '2027-04-01', null), /außerhalb des Jahrgangs 2026/)
  assert.match(leseZeitraumFehler(2026, '2025-12-31', null), /außerhalb/)
  assert.match(leseZeitraumFehler(2026, '2026-10-15', '2026-09-01'), /vor ihrem Beginn/)
  assert.match(leseZeitraumFehler(2026, '2026-02-30', null), /kein gültiges Datum/)
})

test('Titel und Zeitraumtext', () => {
  assert.equal(leseTitel(2026, { lfd_nr: 2, art: 'eiswein', bezeichnung: null }), '2026/2 Eiswein')
  assert.equal(leseTitel(2026, { lfd_nr: 1, art: 'hauptlese', bezeichnung: ' GV ' }), '2026/1 Hauptlese – GV')
  assert.equal(leseZeitraumText('2026-09-01', '2026-10-15'), '01.09.2026 – 15.10.2026')
  assert.equal(leseZeitraumText('2026-09-01', null), 'ab 01.09.2026')
  assert.equal(leseZeitraumText(null, null), null)
})

test('gewählte Lese: ?lese=<Nr.>, sonst die höchste', () => {
  const lesen = [{ lfd_nr: 1 }, { lfd_nr: 3 }, { lfd_nr: 2 }]
  assert.equal(gewaehlteLese(lesen, '2')?.lfd_nr, 2)
  assert.equal(gewaehlteLese(lesen, undefined)?.lfd_nr, 3)
  assert.equal(gewaehlteLese(lesen, '9')?.lfd_nr, 3)
  assert.equal(gewaehlteLese(lesen, ['1', '2'])?.lfd_nr, 1)
  assert.equal(gewaehlteLese(lesen, 'x')?.lfd_nr, 3)
  assert.equal(gewaehlteLese([], '1'), null)
})

test('Löschsperre: einzige, nicht höchste und belegte Lese', () => {
  const leer = { eintraege: 0, pressungen: 0, traubenverkaeufe: 0 }
  assert.match(leseLoeschsperre({ lfd_nr: 1 }, [1], leer), /einzige Lese/)
  assert.match(leseLoeschsperre({ lfd_nr: 1 }, [1, 2], leer), /höchsten Nummer \(2\)/)
  assert.equal(leseLoeschsperre({ lfd_nr: 2 }, [1, 2], leer), null)
  assert.match(leseLoeschsperre({ lfd_nr: 2 }, [1, 2], { eintraege: 1, pressungen: 2, traubenverkaeufe: 0 }),
    /1 Lese-Eintrag, 2 Pressungen/)
})

const lies = p => fs.readFileSync(p, 'utf8')
const ACTIONS = lies('src/app/(dashboard)/erntemeldung/actions.ts')

test('Verdrahtung: neue Einträge und Pressungen bekommen die gewählte Lese', () => {
  assert.ok(ACTIONS.includes("insert(leseId ? { ...payload, lese_id: leseId } : payload)"), 'upsertErnteParzelle')
  assert.ok(ACTIONS.includes("const base = { jahrgang_id: jahrgangId, ernte_datum: ernteDatum, ...(leseId ? { lese_id: leseId } : {}) }"), 'createMultipleErnteParzellen')
  assert.ok(ACTIONS.includes('notizen, lese_id: lesePressung?.id })'), 'upsertPressung')
  // Lese muss zu Jahrgang und Betrieb gehören
  assert.ok(ACTIONS.includes(".select('id').eq('id', leseId).eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId)"))
  const detail = lies('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  assert.ok(detail.includes("if (leseId) fd.set('lese_id', leseId)"))
  const pressung = lies('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
  assert.ok(pressung.includes("if (leseId && !pressung) fd.append('lese_id', leseId)"))
})

test('deleteLese nur für Betriebsleiter, updateJahrgang schreibt keinen Zeitraum mehr', () => {
  const del = ACTIONS.slice(ACTIONS.indexOf('export async function deleteLese'))
  assert.ok(del.slice(0, 600).includes('if (!canAdmin(membership.role))'))
  const upd = ACTIONS.slice(ACTIONS.indexOf('export async function updateJahrgang'), ACTIONS.indexOf('// ── Lesen (KAN-129)'))
  assert.ok(!upd.includes('ernte_beginn') && !upd.includes('ernte_ende'))
  assert.ok(upd.includes('formData.has(feld)'), 'fehlende Felder (witterungscharakter) bleiben unverändert')
})
