// KAN-204 (05.10.2026): Charge – Pflichtmerkmale, Qualität nur über „Abstufen“, Sperre ab Prüfnummernantrag „Eingereicht“.
// Entscheidung Jörgen (05.10.2026): Eröffnungsbestand darf ohne Jahrgang/Sorte sein – nur ein Hinweis auf die Notizen.
// Matrix KAN-85; DB-Test 34.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const r = hooksMoeglich ? await laden('lib/kellerbuch/chargeRegeln.ts') : null

const VOLL = { jahrgang: 2025, rebsorte: 'Grüner Veltliner', weinart: 'weiss', qualitaetsstufe: 'qualitaetswein', behaelterId: 't1', mitBestand: true }

describe('KAN-204 Regeln', nurMitHooks, () => {
  test('Pflicht: vollständig → null; fehlende Angaben werden aufgezählt', () => {
    assert.equal(r.chargePflichtFehler(VOLL), null)
    assert.equal(r.chargePflichtFehler({ ...VOLL, jahrgang: null, rebsorte: ' ', weinart: 'unbekannt', qualitaetsstufe: null, behaelterId: null }),
      'Bitte noch angeben: Jahrgang, Rebsorte, Weinart (weiß, rot oder rosé), Qualitätsstufe, Gebinde.')
  })
  test('Gebinde nur mit Bestand; gesperrte Felder werden nicht geprüft', () => {
    assert.equal(r.chargePflichtFehler({ ...VOLL, behaelterId: null, mitBestand: false }), null)
    assert.equal(r.chargePflichtFehler({ ...VOLL, jahrgang: null, weinart: null }, { geprueft: { jahrgang: false, weinart: false } }), null)
  })
  test('Eröffnungsbestand: ohne Jahrgang/Sorte/Weinart erlaubt, Qualität und Gebinde Pflicht; Hinweis auf die Notizen', () => {
    assert.equal(r.chargePflichtFehler({ ...VOLL, jahrgang: null, rebsorte: null, weinart: 'unbekannt' }, { eroeffnungsbestand: true }), null)
    assert.match(r.chargePflichtFehler({ ...VOLL, qualitaetsstufe: null, behaelterId: null }, { eroeffnungsbestand: true }), /Qualitätsstufe, Gebinde/)
    assert.match(r.eroeffnungsbestandHinweis({ jahrgang: null, rebsorte: '', weinart: 'unbekannt', herkunft: null }), /^Ohne Jahrgang, Rebsorte, Weinart, Herkunft – .*Notizen/)
    assert.equal(r.eroeffnungsbestandHinweis({ jahrgang: 2020, rebsorte: 'Zweigelt', weinart: 'rot', herkunft: 'niederoesterreich' }), null)
  })
  test('Sperrstufe: eingereicht/in Prüfung vor gültiger Prüfnummer; stornierte Anträge zählen nicht', () => {
    assert.equal(r.chargePnSperre([{ status: 'eingereicht' }], []), 'eingereicht')
    assert.equal(r.chargePnSperre([{ status: 'in_pruefung' }], [{ gueltig_bis: null }]), 'eingereicht')
    assert.equal(r.chargePnSperre([{ status: 'eingereicht', storniert_am: '2026-10-01' }], []), null)
    assert.equal(r.chargePnSperre([{ status: 'genehmigt' }], [{ gueltig_bis: null }]), 'gueltig')
    assert.equal(r.chargePnSperre([{ status: 'genehmigt' }], [{ gueltig_bis: '2026-10-01' }]), null)
    assert.equal(r.chargePnSperre([{ status: 'entwurf' }], []), null)
    assert.match(r.chargePnSperreText('gueltig'), /Abstufen ist möglich/)
    assert.equal(r.chargePnSperreText(null), null)
  })
})

describe('KAN-204 Datenbank und App gleich', () => {
  const mig = () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan204_charge_freeze.sql'))
    return quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan204_charge_freeze.sql')
  }
  test('Trigger: Grund, Status und Positivliste wie in chargeRegeln.ts', () => {
    const m = mig()
    const regeln = quelle('src/lib/kellerbuch/chargeRegeln.ts')
    const grund = regeln.match(/CHARGE_FREEZE_GRUND = '([^']+)'/)[1]
    const erlaubt = [...regeln.match(/CHARGE_FREEZE_ERLAUBT = \[([\s\S]+?)\] as const/)[1].matchAll(/'([^']+)'/g)].map(x => x[1])
    const status = [...regeln.match(/CHARGE_SPERR_STATUS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(x => x[1])
    assert.match(m, new RegExp(`CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public\\.weinausbau\\s+FOR EACH ROW EXECUTE FUNCTION public\\.s112_freeze\\('${grund}'`))
    assert.ok(m.includes(`'${erlaubt.join(',')}'`), 'Positivliste = CHARGE_FREEZE_ERLAUBT')
    assert.ok(m.includes(`d.status IN (${status.map(x => `'${x}'`).join(', ')})`), 'Status = CHARGE_SPERR_STATUS')
  })
  test('Server Action: nur Abstufen, Sperre, Pflicht; createWeinausbau entfallen', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    assert.match(a, /if \(altQualitaet\.stufe && !gleicheQualitaet\(altQualitaet, neuQualitaet\)\) throw new AktionsFehler\(NUR_ABSTUFEN_MELDUNG\)/)
    assert.match(a, /const pnSperre = chargePnSperre\(/)
    assert.match(a, /const pflicht = chargePflichtFehler\(/)
    assert.doesNotMatch(a, /export async function createWeinausbau/)
  })
  test('Formular und Seite: Sperrstufe, Pflichtfelder, Abstufen-Link; Eröffnungsbestand mit Gebinde/Qualität Pflicht', () => {
    const f = quelle('src/components/kellerbuch/WeinausbauForm.tsx')
    assert.match(f, /const merkmaleGesperrt = vonPressung \|\| !!pnSperre/)
    assert.match(f, /<GesperrtHinweis grund=\{CHARGE_FREEZE_GRUND\}/)
    assert.match(f, /\/kellerbuch\/weinausbau\/\$\{weinausbau\.id\}\/abstufen/)
    assert.match(f, /WEINART_OPTS\.filter\(o => istEB \|\| o\.value !== 'unbekannt'\)/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /pnSperre=\{pnSperre\}/)
    const g = quelle('src/app/(dashboard)/kellerbuch/gebinde-actions.ts')
    assert.match(g, /if \(!\(formData\.get\('behaelter_id'\) as string\)\) return 'Bitte das Gebinde angeben\.'/)
    assert.match(g, /if \(!angabe\.stufe\) return 'Bitte die Qualitätsstufe angeben/)
    for (const p of ['src/app/(dashboard)/kellerbuch/gebinde/page.tsx', 'src/app/(dashboard)/admin/import/ImportClient.tsx', 'src/app/(dashboard)/kellerbuch/eroeffnungsbestand/[id]/edit/page.tsx']) {
      assert.match(quelle(p), /\{EB_NOTIZEN_HINWEIS\}/, p)
    }
    assert.match(quelle('src/lib/import/eroeffnungsbestand.ts'), /key: 'qualitaet', kopf: 'Qualitätsstufe', pflicht: true/)
  })
})
