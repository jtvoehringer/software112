// KAN-325 und KAN-326 (UAT 11.10.2026)
//  KAN-325: Die Bienenschutz-Bestätigung (KAN-171) wurde nur beim Absenden geprüft und nie gespeichert – beim Bearbeiten
//           war der Haken leer. Jetzt speichert die Maßnahme sie (Zeitpunkt, Benutzer und Name setzt die Datenbank,
//           DB-Test 80), und das Bearbeiten-Formular zeigt sie wieder an.
//  KAN-326: PSM- und Dünger-Einkauf ohne E/A-Ausgabe – nur Betriebsmittel hatten „Einkauf (mit E/A-Ausgabe)“. Jetzt beide
//           Lager über die RPC s112_lager_einkauf; Storno über s112_lager_einkauf_stornieren (Ausgabe wird mitstorniert).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { bienenschutzBestaetigtAm, bienenschutzFehler } from '../../src/lib/behandlungen/bienenschutz.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(ROOT, ...p.split('/')), 'utf8')

describe('KAN-325: Bienenschutz-Bestätigung wird gespeichert', () => {
  const jetzt = new Date('2026-10-11T10:00:00Z')

  test('bestätigt in der Blüte → Zeitpunkt; nicht (mehr) relevant → null (hebt eine frühere Bestätigung auf)', () => {
    assert.equal(bienenschutzBestaetigtAm({ bienengefaehrlich: true, bbch: '65', bestaetigt: true }, jetzt), '2026-10-11T10:00:00.000Z')
    assert.equal(bienenschutzBestaetigtAm({ bienengefaehrlich: true, bbch: '75', bestaetigt: true }, jetzt), null)   // nach der Blüte
    assert.equal(bienenschutzBestaetigtAm({ bienengefaehrlich: false, bbch: '65', bestaetigt: true }, jetzt), null)  // nicht bienengefährlich
    assert.equal(bienenschutzBestaetigtAm({ bienengefaehrlich: true, bbch: null, bestaetigt: false }, jetzt), null)
  })

  test('relevant und nicht bestätigt bleibt abgelehnt (vor dem Speichern)', () => {
    assert.ok(bienenschutzFehler({ bienengefaehrlich: true, bbch: '61', bestaetigt: false }))
  })

  test('Speichern (Anlegen, Bearbeiten, Assistent) setzt die Spalte über anwendungSpalten', () => {
    const a = quelle('src/app/(dashboard)/behandlungen/actions.ts')
    const teil = a.slice(a.indexOf('async function anwendungSpalten'), a.indexOf('/** Erfassungsfrist des Betriebs'))
    assert.match(teil, /bienenschutz_bestaetigt_am: bienenschutzBestaetigtAm\(bienenEingabe\)/)
    assert.match(teil, /const bienen = bienenschutzFehler\(bienenEingabe\)/)   // dieselbe Eingabe für Prüfung und Wert
  })

  test('Bearbeiten lädt die Bestätigung und zeigt den Haken gesetzt, mit Zeitpunkt und Name', () => {
    const seite = quelle('src/app/(dashboard)/behandlungen/[id]/edit/page.tsx')
    assert.match(seite, /bienenschutz_bestaetigt_am, bienenschutz_bestaetigt_von_name/)
    const form = quelle('src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx')
    assert.match(form, /bestaetigung=\{behandlung\.bienenschutz_bestaetigt_am \?/)
    const hinweis = quelle('src/components/behandlungen/BienenschutzHinweis.tsx')
    assert.match(hinweis, /defaultChecked=\{!!bestaetigung\}/)
    assert.match(hinweis, /Bestätigt am/)
    assert.match(hinweis, /timeZone: 'Europe\/Vienna'/)
  })
})

describe('KAN-326: PSM- und Dünger-Einkauf mit E/A-Ausgabe', () => {
  const actions = quelle('src/app/(dashboard)/behandlungen/lager/actions.ts')

  test('Einkauf über die RPC s112_lager_einkauf, Art psm oder duenger, Mittel je Lager', () => {
    const teil = actions.slice(actions.indexOf('export async function bucheLagerEinkauf'))
    assert.match(teil, /rpc as any\)\('s112_lager_einkauf', \{/)
    assert.match(teil, /if \(art !== 'psm' && art !== 'duenger'\)/)
    assert.match(teil, /fd\.get\(art === 'psm' \? 'psm_id' : 'duengemittel_id'\)/)
    assert.match(teil, /revalidatePath\('\/buchhaltung'\)/)
  })

  test('Storno beider Lager über s112_lager_einkauf_stornieren – kein direktes Update mehr (Ausgabe würde stehen bleiben)', () => {
    const teil = actions.slice(actions.indexOf('async function lagerStornieren'), actions.indexOf('export async function bucheLagerEinkauf'))
    assert.match(teil, /'s112_lager_einkauf_stornieren'/)
    assert.doesNotMatch(teil, /\.update\(/)
    assert.match(actions, /psm_lager_bewegungen: 'psm', duengemittel_lager_bewegungen: 'duenger'/)
  })

  for (const datei of ['LagerClient.tsx', 'DuengerLagerClient.tsx']) {
    test(`${datei}: Typ „Einkauf (mit E/A-Ausgabe)“ mit Feldern, gesperrt ohne E&A, bucht über bucheLagerEinkauf`, () => {
      const k = quelle(`src/app/(dashboard)/behandlungen/lager/${datei}`)
      assert.match(k, /<option value=\{TYP_EINKAUF_EA\} disabled=\{!!einkauf\.einkaufSperre\}>Einkauf \(mit E\/A-Ausgabe\)<\/option>/)
      assert.match(k, /\{mitAusgabe && einkauf && <EinkaufAusgabeFelder ctx=\{einkauf\} \/>\}/)
      assert.match(k, /if \(mitAusgabe\) \{ fd\.set\('art', '(psm|duenger)'\); await bucheLagerEinkauf\(fd\) \}/)
      assert.match(k, /b\.mit_ausgabe &&/)
      assert.match(k, /<form data-ungespeichert onSubmit=\{handleSubmit\}/)
    })
  }

  test('die Lagerseite reicht Kategorien, Lieferanten und Sperre an beide Lager und lädt Betrag und Ausgabe', () => {
    const seite = quelle('src/app/(dashboard)/behandlungen/lager/page.tsx')
    assert.equal(seite.split('einkauf={{ kategorien, lieferanten, einkaufSperre }}').length - 1, 2)
    assert.equal(seite.split('storniert_von_name, storno_grund, betrag_netto, ea_transaktion_id').length - 1, 2)
    assert.equal(seite.split('mit_ausgabe: b.ea_transaktion_id != null').length - 1, 2)
  })

  test('Felder: Netto-Betrag, USt-Satz, Ausgaben-Kategorie (Pflicht), Lieferant', () => {
    const f = quelle('src/app/(dashboard)/behandlungen/lager/EinkaufAusgabeFelder.tsx')
    for (const name of ['betrag_netto', 'ust_satz', 'ea_kategorie_id', 'lieferant_firma_id']) assert.match(f, new RegExp(`name="${name}"`))
    assert.match(f, /name="ea_kategorie_id" required/)
  })
})
