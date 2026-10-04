// KAN-97 (04.10.2026): Prüfnummernantrag als Workflow – Statusmodell, Übergänge und Sperren je Status (App-Seite der
// Regeln aus der Migration kan97_pn_workflow), Prüfnummer der Flaschen bei Endstatus, Quelltext-Verdrahtung.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan97-pn-workflow.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as wf from '../../src/lib/dac/workflow.ts'
import * as pn from '../../src/lib/kellerbuch/pruefnummer.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-97 Statusmodell', () => {
  test('Übergangsmatrix laut Entscheidung 04.10.2026', () => {
    assert.deepEqual(wf.PN_UEBERGAENGE.entwurf, ['eingereicht'])
    assert.deepEqual(wf.PN_UEBERGAENGE.eingereicht, ['in_pruefung', 'genehmigt', 'abgelehnt', 'zurueckgezogen'])
    assert.deepEqual(wf.PN_UEBERGAENGE.in_pruefung, ['genehmigt', 'abgelehnt', 'zurueckgezogen'])
    assert.deepEqual(wf.PN_UEBERGAENGE.genehmigt, ['erloschen', 'entzogen', 'aufgebraucht'])
    for (const s of wf.PN_ENDSTATUS) assert.deepEqual(wf.PN_UEBERGAENGE[s], [], s)
  })
  test('unzulässige Übergänge (z. B. Abgelehnt → Zugeteilt, Entwurf → Zugeteilt, zurück zum Entwurf)', () => {
    assert.equal(wf.pnUebergangErlaubt('abgelehnt', 'genehmigt'), false)
    assert.equal(wf.pnUebergangErlaubt('entwurf', 'genehmigt'), false)
    assert.equal(wf.pnUebergangErlaubt('eingereicht', 'entwurf'), false)
    assert.equal(wf.pnUebergangErlaubt('genehmigt', 'eingereicht'), false)
    assert.equal(wf.pnUebergangErlaubt('eingereicht', 'unbekannt'), false)
    assert.equal(wf.pnUebergangErlaubt('eingereicht', 'genehmigt'), true)
  })
  test('DB-Wert genehmigt heißt „Zugeteilt“; unbekannte Werte bleiben stehen', () => {
    assert.equal(wf.pnStatusLabel('genehmigt'), 'Zugeteilt')
    assert.equal(wf.pnStatusLabel('zurueckgezogen'), 'Zurückgezogen')
    assert.equal(wf.pnStatusLabel('xyz'), 'xyz')
    assert.equal(wf.pnStatusLabel(null), '')
  })
  test('Matrix der App = Matrix der RPC (Migration)', () => {
    const sql = quelle(migrationsDatei())
    const json = /c_uebergaenge constant jsonb := '(\{[\s\S]*?\})';/.exec(sql)?.[1]
    assert.ok(json, 'Übergangsmatrix in der Migration gefunden')
    const db = JSON.parse(json)
    for (const s of wf.PN_STATUS) assert.deepEqual(db[s] ?? [], [...wf.PN_UEBERGAENGE[s]], s)
  })
})

describe('KAN-97 Sperren je Status', () => {
  test('Entwurf: alles änderbar', () => {
    assert.deepEqual(wf.pnAenderbareFelder('entwurf'), wf.PN_FORMULAR_FELDER)
    assert.equal(wf.pnSperre({ status: 'entwurf' }), null)
  })
  test('Eingereicht/In Prüfung: Weinangaben, Menge, Charge gesperrt – Prüfnummer bis zur Zuteilung änderbar', () => {
    for (const s of ['eingereicht', 'in_pruefung']) {
      const f = wf.pnAenderbareFelder(s)
      for (const x of ['bezeichnung', 'dac_region', 'weinausbau_id', 'jahrgang', 'rebsorte', 'menge_liter', 'alkohol_prozent']) assert.ok(!f.includes(x), `${s}: ${x}`)
      for (const x of ['pruefnummer', 'antragsnummer', 'untersuchungsnummer', 'notizen', 'aktiv']) assert.ok(f.includes(x), `${s}: ${x}`)
    }
    assert.deepEqual(wf.pnSperre({ status: 'eingereicht', eingereicht_am: '2026-10-01' }), { grund: 'Prüfnummernantrag eingereicht', seit: '2026-10-01' })
  })
  test('Zugeteilt: nur Notizen und aktiv; Endstatus: nur aktiv', () => {
    assert.deepEqual([...wf.pnAenderbareFelder('genehmigt')], ['notizen', 'aktiv'])
    for (const s of wf.PN_ENDSTATUS) assert.deepEqual([...wf.pnAenderbareFelder(s)], ['aktiv'], s)
    assert.equal(wf.pnSperre({ status: 'genehmigt', bescheid_am: '2026-10-02' }).grund, 'Prüfnummer zugeteilt')
    assert.equal(wf.pnSperre({ status: 'erloschen', status_seit: '2026-10-03T08:00:00Z' }).grund, 'Prüfnummernantrag abgeschlossen')
  })
  test('erlaubte Felder der App ⊆ Positivliste der Freeze-Trigger', () => {
    const sql = quelle(migrationsDatei())
    const liste = name => (new RegExp(`CREATE TRIGGER ${name} [\\s\\S]*?\\$\\$,\\n    '([^']*)'`).exec(sql)?.[1] ?? '').split(',')
    const db = { eingereicht: liste('a_freeze_eingereicht'), genehmigt: liste('a_freeze_zugeteilt'), erloschen: liste('a_freeze_abgeschlossen') }
    for (const [s, erlaubt] of Object.entries(db)) {
      assert.ok(erlaubt.length > 1, `${s}: Liste gefunden`)
      for (const f of wf.pnAenderbareFelder(s)) assert.ok(erlaubt.includes(f), `${s}: ${f} fehlt im Trigger`)
    }
  })
  test('Statuswechsel-Angaben: Zugeteilt braucht die Prüfnummer, Entzogen einen Grund', () => {
    assert.equal(wf.pnUebergangAngaben('genehmigt').pruefnummer, 'pflicht')
    assert.equal(wf.pnUebergangAngaben('entzogen').grundPflicht, true)
    assert.equal(wf.pnUebergangAngaben('eingereicht').grundPflicht, false)
  })
})

// Eingespielte Migration (supabase/migrations/<version>_kan97_pn_workflow.sql), bis dahin der Entwurf
function migrationsDatei() {
  const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(x => x.endsWith('_kan97_pn_workflow.sql'))
  return f ? 'supabase/migrations/' + f : 'supabase/entwurf/kan97_pn_workflow.sql'
}

describe('KAN-97 Prüfnummer der Flaschen bei Endstatus', () => {
  const A = { id: 'a1', weinausbauId: 'c1', status: 'genehmigt', aktiv: true, pruefnummer: 'N 1/26', mengeLiter: 100, eingereichtAm: '2026-05-01', bescheidAm: '2026-06-01', angelegtAm: '2026-05-01', bezeichnung: 'GV' }
  test('erloschen und aufgebraucht: abgefüllte Flaschen behalten die Nummer; entzogen, abgelehnt, zurückgezogen nicht', () => {
    for (const s of ['genehmigt', 'erloschen', 'aufgebraucht']) assert.equal(pn.pruefnummerAusAntrag({ ...A, status: s }, 'c1'), 'N 1/26', s)
    for (const s of ['entzogen', 'abgelehnt', 'zurueckgezogen', 'eingereicht']) assert.equal(pn.pruefnummerAusAntrag({ ...A, status: s }, 'c1'), null, s)
    assert.equal(pn.pruefnummerAusAntrag({ ...A, status: 'erloschen', aktiv: false }, 'c1'), null)
  })
  test('für den Tankbestand gilt nur „Zugeteilt“', () => {
    assert.equal(pn.antragGenehmigt({ ...A, status: 'erloschen' }), false)
    assert.equal(pn.antragGenehmigt(A), true)
  })
  test('neue Füllung: Antrag im Endstatus wird mit Klartext abgelehnt', () => {
    const daten = { chargeId: 'c1', bestandLiter: 100, bestandAm: '2026-10-01', antraege: [{ ...A, status: 'aufgebraucht' }], zugaenge: [], abfuellungen: [] }
    const r = pn.fuellungAntragPruefen(daten, 'a1', '2026-10-01')
    assert.equal(r.ok, false)
    assert.match(r.fehler, /ist aufgebraucht und kann nicht mit der Füllung verknüpft werden/)
  })
})

describe('KAN-97 Verdrahtung', () => {
  test('Statuswechsel nur über die RPC; Speichern sendet nur erlaubte Felder; neuer Antrag = Entwurf', () => {
    const a = quelle('src/app/(dashboard)/dac/actions.ts')
    assert.match(a, /s112_pruefnummernantrag_status_setzen/)
    assert.match(a, /for \(const k of pnAenderbareFelder\(\(alt as R\)\.status\)\) payload\[k\] = w\[k\]/)
    assert.match(a, /status: 'entwurf'/)
    assert.doesNotMatch(a, /formData\.get\('status'\)/)
    assert.doesNotMatch(a, /formData\.get\('eingereicht_am'\)|formData\.get\('bescheid_am'\)/)
  })
  test('Formular ohne Status-Auswahl; Antragsformular ab Eingereicht schreibgeschützt', () => {
    assert.doesNotMatch(quelle('src/components/dac/DacForm.tsx'), /name="status"/)
    assert.match(quelle('src/app/(dashboard)/dac/[id]/antrag/PNAFormular.tsx'), /<fieldset disabled=\{!!gesperrt\}/)
    assert.match(quelle('src/app/(dashboard)/dac/[id]/antrag/actions.ts'), /'23505'/)
  })
})
