// KAN-86 (05.10.2026): PSM-Stammdaten – Registernummer, EPPO-Code (Hauptschaderreger) und „bienengefährlich“ pflegbar.
// Entscheidungen Jörgen (05.10.2026): EPPO-Code am Mittel = Hauptschaderreger, Kultur der Aufzeichnung immer VITVI;
// keine Übernahme aus dem PSM-Register – jeder Betrieb pflegt seine Mittel von Hand.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const stamm = hooksMoeglich ? await laden('lib/behandlungen/psmStamm.ts') : null
const psm = hooksMoeglich ? await laden('lib/behoerden/psm.ts') : null
const csv = hooksMoeglich ? await laden('lib/csv/index.ts') : null

const GST = { id: 'g-1', gst_nr: '123/1', katastralgemeinde: '04023', kg_bezeichnung: 'Stein', flaeche_ha: 1, weingarten: { id: 'wg-1', name: 'Pfaffenberg', ried: null, flaeche_ha: 1, lage_id: null, lagen: null } }
const behandlung = (mittel, teil = {}) => psm.normalisiereBehandlung({
  id: 'b-' + mittel.id, datum: '2026-06-10', datum_bis: null, art: 'spritzung', psm_id: mittel.id, psm: mittel,
  aufwandmenge: 1, aufwandmenge_einheit: 'kg_ha', menge_gesamt: null, menge_einheit: null, wasseraufwand_l_ha: null,
  weingarten_id: 'wg-1', weingarten: GST.weingarten, behandlung_grundstuecke: [{ grundstueck_id: 'g-1', flaeche_ha: 1, grundstueck: GST }],
  ...teil,
})
const MITTEL = (teil) => ({ id: 'p-1', name: 'Folpan 80 WDG', handelsname: null, wirkstoff: 'Folpet', wirkstoffgehalt_pct: 80, zulassungsnr: '2648-0', eppo_code: 'PLASVI', bienengefaehrlich: false, cu_gehalt_pct: null, wartezeit_tage: 35, max_aufwand_kg_ha: null, max_anwendungen: null, oeko_zugelassen: false, ...teil })

describe('KAN-86 Prüfung der Stammdaten', nurMitHooks, () => {
  test('EPPO-Code: Großbuchstaben, 5–6 Zeichen, leer erlaubt', () => {
    assert.equal(stamm.eppoCodeNormal(' plasvi '), 'PLASVI')
    assert.equal(stamm.eppoCodeNormal(''), null)
    assert.equal(stamm.eppoCodeFehler('uncine'), null)
    assert.equal(stamm.eppoCodeFehler('VITVI'), null)
    assert.equal(stamm.eppoCodeFehler(''), null)
    assert.match(stamm.eppoCodeFehler('Peronospora'), /EPPO-Code „PERONOSPORA“ ist ungültig/)
    assert.match(stamm.eppoCodeFehler('PL-AS'), /ungültig/)
  })
  test('Registernummer: getrimmt, Ziffern/Buchstaben mit - / . erlaubt', () => {
    assert.equal(stamm.registernummerNormal('  3456-0 '), '3456-0')
    assert.equal(stamm.registernummerNormal('   '), null)
    assert.equal(stamm.registernummerFehler('3456-0'), null)
    assert.equal(stamm.registernummerFehler('PI-0123/2'), null)
    assert.match(stamm.registernummerFehler('=1+1'), /Registernummer „=1\+1“ ist ungültig/)
    assert.match(stamm.registernummerFehler('1'.repeat(31)), /höchstens 30 Zeichen/)
  })
})

describe('KAN-86 Pflanzenschutz-Aufzeichnung', nurMitHooks, () => {
  test('Kultur immer VITVI, EPPO-Code des Mittels als Schaderreger, bienengefährlich Ja/Nein', () => {
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen([behandlung(MITTEL({ bienengefaehrlich: true }))])
    assert.deepEqual(warnungen, [])
    assert.deepEqual([zeilen[0].eppoKultur, zeilen[0].eppoSchaderreger, zeilen[0].bienengefaehrlich], ['VITVI', 'PLASVI', true])
    const [kopf, z] = csv.csvText(zeilen, psm.SPALTEN_PSM_AUFZEICHNUNG).replace(/^﻿/, '').split('\r\n').map(r => r.split(';'))
    assert.equal(z[kopf.indexOf('EPPO-Code Kultur')], 'VITVI')
    assert.equal(z[kopf.indexOf('EPPO-Code Schaderreger')], 'PLASVI')
    assert.equal(z[kopf.indexOf('Bienengefährlich')], 'Ja')
    assert.equal(kopf.indexOf('EPPO-Code Schaderreger'), kopf.indexOf('Schaderreger') + 1)
  })
  test('Mittel ohne Registernummer: ein Hinweis je Mittel (sortiert), nicht je Maßnahme', () => {
    const a = MITTEL({ id: 'p-a', name: 'Topas', zulassungsnr: null })
    const b = MITTEL({ id: 'p-b', name: 'Cuprozin', zulassungsnr: '' })
    const { warnungen } = psm.psmAufzeichnungZeilen([behandlung(a), behandlung(a, { id: 'b-2' }), behandlung(b), behandlung(MITTEL())])
    assert.equal(warnungen.length, 1)
    assert.match(warnungen[0], /^2 Mittel haben keine Registernummer .*: Cuprozin; Topas$/)
  })
  test('Düngung ohne Pflanzenschutzmittel: kein Hinweis, Bienengefährlich leer', () => {
    const d = behandlung(MITTEL(), { art: 'duengung', psm: null, psm_id: null, duengemittel_id: 'd-1', duengemittel: { id: 'd-1', name: 'Biosol', typ: 'organisch', einheit: 'kg' } })
    const { zeilen, warnungen } = psm.psmAufzeichnungZeilen([d])
    assert.deepEqual(warnungen, [])
    assert.equal(zeilen[0].bienengefaehrlich, null)
  })
})

describe('KAN-86 Verdrahtung', () => {
  test('Server Action speichert und prüft die drei Felder', () => {
    const a = quelle('src/app/(dashboard)/behandlungen/lager/actions.ts')
    assert.match(a, /zulassungsnr:\s+registernummerNormal\(fd\.get\('zulassungsnr'\)\)/)
    assert.match(a, /eppo_code:\s+eppoCodeNormal\(fd\.get\('eppo_code'\)\)/)
    assert.match(a, /bienengefaehrlich:\s+fd\.get\('bienengefaehrlich'\) === 'true'/)
    assert.match(a, /eppoCodeFehler\(fd\.get\('eppo_code'\)\)/)
    assert.match(a, /registernummerFehler\(fd\.get\('zulassungsnr'\)\)/)
  })
  test('Formular: Felder, kontrollierte Checkbox, Hinweis „fehlt“ in der Liste; Seite lädt die Felder', () => {
    const c = quelle('src/app/(dashboard)/behandlungen/lager/PSMClient.tsx')
    assert.match(c, /name="zulassungsnr"/)
    assert.match(c, /name="eppo_code"/)
    assert.match(c, /<input type="hidden" name="bienengefaehrlich" value="false" disabled=\{bienengefaehrlich\} \/>/)
    assert.match(c, /title=\{REGISTERNUMMER_FEHLT\}>fehlt</)
    assert.match(quelle('src/app/(dashboard)/behandlungen/lager/page.tsx'), /oeko_zugelassen, zulassungsnr, eppo_code, bienengefaehrlich, notizen'/)
  })
})
