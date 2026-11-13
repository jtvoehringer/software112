// KAN-437 Teil 1 (13.11.2026): Weinexport F – Länderhinweise „Was ist für dieses Land nötig?“.
// Befund: Am Exportauftrag stand nirgends, was das Zielland verlangt. Die Inhalte stammen aus der Zollrecherche
// KAN-417 (Abschnitt C); belegt sind dort im Wesentlichen USA, Vereinigtes Königreich und Schweiz. Die Tests sichern
// die Kennzeichnung – ein ungeprüfter Hinweis darf nie wie ein geprüfter aussehen. Die inhaltliche Richtigkeit
// können sie nicht prüfen.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAENDERPROFILE, ABSCHNITTE, ABSCHNITT_TITEL, DRITTLAND_GEMEINSAM, laenderprofil, profilStand, PROFIL_STAND_TEXT,
  NICHT_GEPRUEFT, OHNE_ANGABEN, LAENDER_HAFTUNG,
} from '../../src/lib/export/laenderprofile.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const aussagen = p => ABSCHNITTE.flatMap(a => p.abschnitte[a])

describe('KAN-437: Länderprofile', () => {
  test('die neun Zielländer aus dem Ticket – jedes genau einmal, mit Name und Quelle', () => {
    assert.deepEqual(LAENDERPROFILE.map(p => p.land).sort(), ['BR', 'CH', 'CN', 'GB', 'JP', 'KR', 'MY', 'TH', 'US'])
    for (const p of LAENDERPROFILE) {
      assert.ok(p.name.length > 2 && p.quelle.length > 5, p.land)
      assert.deepEqual(Object.keys(p.abschnitte).sort(), [...ABSCHNITTE].sort(), p.land)
    }
    assert.deepEqual(Object.keys(ABSCHNITT_TITEL).sort(), [...ABSCHNITTE].sort())
  })
  test('jede Aussage trägt das Kennzeichen geprüft/nicht geprüft und ist ein ganzer Satz', () => {
    for (const p of LAENDERPROFILE) {
      for (const x of aussagen(p)) {
        assert.equal(typeof x.geprueft, 'boolean', `${p.land}: ${x.text}`)
        assert.ok(x.text.length >= 25 && /[.)]$/.test(x.text), `${p.land}: ${x.text}`)
        assert.doesNotMatch(x.text, /\b(fuer|ueber|Laender|Pruef|noetig|Ausfuehr)/i, `${p.land}: Umlaute – ${x.text}`)
      }
    }
  })
  test('Stand je Profil: nur belegte Länder gelten als (teilweise) geprüft; Malaysia hat keine Angaben', () => {
    const stand = Object.fromEntries(LAENDERPROFILE.map(p => [p.land, profilStand(p)]))
    assert.equal(stand.MY, 'ohne')
    assert.equal(aussagen(laenderprofil('MY')).length, 0)
    // kein Profil gilt als vollständig geprüft – die Recherche kennzeichnet überall offene Punkte
    assert.ok(!Object.values(stand).includes('geprueft'), JSON.stringify(stand))
    for (const l of ['US', 'GB', 'CH', 'JP', 'KR', 'CN', 'TH', 'BR']) assert.ok(['teilweise', 'ungeprueft'].includes(stand[l]), `${l}: ${stand[l]}`)
    assert.equal(stand.BR, 'ungeprueft')
    assert.deepEqual(Object.keys(PROFIL_STAND_TEXT).sort(), ['geprueft', 'ohne', 'teilweise', 'ungeprueft'])
  })
  test('Länder, deren Einfuhrregeln nur aus zweiter Hand stammen: geprüft sind dort allein die Aussagen zu Abkommen und Präferenz', () => {
    for (const l of ['JP', 'KR', 'CN', 'TH', 'BR']) {
      const p = laenderprofil(l)
      for (const a of ['dokumente', 'etikett']) {
        for (const x of p.abschnitte[a]) assert.equal(x.geprueft, false, `${l} ${a}: ${x.text}`)
      }
      for (const x of aussagen(p).filter(y => y.geprueft)) {
        assert.match(x.text, /Präferenz|abkommen/i, `${l}: geprüft ist nur, was am Abkommenstext gelesen wurde – ${x.text}`)
      }
    }
  })
  test('Kernaussagen der belegten Länder', () => {
    const us = aussagen(laenderprofil('US'))
    assert.ok(us.some(x => x.geprueft && /FDA Food Facility Registration/.test(x.text) && /US-Agenten/.test(x.text) && /Oktober bis Dezember gerader Jahre/.test(x.text)))
    assert.ok(us.some(x => x.geprueft && /Prior Notice/.test(x.text)))
    assert.ok(us.some(x => x.geprueft && /COLA/.test(x.text) && /Importeur/.test(x.text)))
    assert.ok(us.some(x => !x.geprueft && /15 %/.test(x.text)), 'der Zusatzzoll stammt aus der Presse')
    assert.ok(aussagen(laenderprofil('GB')).some(x => x.geprueft && /Kein VI-1/.test(x.text)))
    assert.ok(aussagen(laenderprofil('CH')).some(x => x.geprueft && /keinen Präferenzzoll/.test(x.text)))
    assert.ok(aussagen(laenderprofil('KR')).some(x => x.geprueft && /Ermächtigter Ausführer/.test(x.text)))
  })
  test('Suche nach ISO-Code: Groß-/Kleinschreibung und Leerzeichen egal, Unbekanntes und EU-Länder ohne Profil', () => {
    assert.equal(laenderprofil(' us ').land, 'US')
    assert.equal(laenderprofil('DE'), null)
    assert.equal(laenderprofil(null), null)
    assert.equal(laenderprofil('XX'), null)
  })
  test('Texte der Anzeige', () => {
    assert.equal(NICHT_GEPRUEFT, 'nicht geprüft – mit dem Importeur klären')
    assert.match(OHNE_ANGABEN, /keine belegten Angaben/)
    assert.match(LAENDER_HAFTUNG, /ohne Gewähr, keine Rechtsberatung/)
    assert.equal(DRITTLAND_GEMEINSAM.length, 4)
  })
})

describe('KAN-437: Anzeige am Exportauftrag', () => {
  test('Block nur bei Drittland; jede ungeprüfte Aussage bekommt das Kennzeichen', () => {
    const k = quelle('src/app/(dashboard)/weinexport/[id]/ExportLaenderhinweise.tsx')
    assert.match(k, /\{!x\.geprueft && <span [^>]*data-nicht-geprueft>\{NICHT_GEPRUEFT\}<\/span>\}/)
    assert.match(k, /\{profil && stand === 'ohne' && <p [^>]*data-ohne-angaben>\{OHNE_ANGABEN\}<\/p>\}/)
    assert.match(k, /\{LAENDER_HAFTUNG\}/)
    assert.doesNotMatch(k, /'use client'/)
    const p = quelle('src/app/(dashboard)/weinexport/[id]/page.tsx')
    assert.match(p, /\{gebiet === 'drittland' && !a\.storniert_am && \(\s+<div className="px-8 max-w-5xl mx-auto">\s+<ExportLaenderhinweise land=\{/)
  })
  test('Handbuch', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/handbuch/page.tsx'), /titel: 'Länderhinweise', inhalt: 'Bei einem Exportauftrag in ein Drittland/)
  })
})
