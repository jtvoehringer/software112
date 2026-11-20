// KAN-486 (20.11.2026): Hinweise zu Export-Registrierungen erklären sich – Folge zu KAN-437 Teil 2.
// Befund (Jörgen, Musterhof, EX-0004 in die USA): „FDA-Registrierung: Die Erneuerung ist jetzt fällig“ blieb stehen,
// obwohl die Registrierung hinterlegt war (ohne Ablaufdatum); nach einem Datum im Jänner 2027 stand „läuft am
// 20.01.2027 ab“ – beide Male ohne Grund und ohne nächsten Schritt. Das Formular nahm für FDA jedes Datum an.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registrierungHinweise, registrierungFristen, registrierungEingabeFehler, fdaAblaufVorschlag, fdaAblaufUnueblich } from '../../src/lib/export/registrierungen.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const reg = (art, gueltig_bis, nummer = 'FDA1234567') => ({ id: `r-${art}-${gueltig_bis}`, art, bezeichnung: null, nummer, gueltig_bis, zusatz: null, notiz: null })
const SCHRITT = 'Nach der Erneuerung das neue Ablaufdatum unter „Registrierungen verwalten“ eintragen.'

describe('KAN-486: Hinweise am Exportauftrag nennen Grund und nächsten Schritt', () => {
  test('FDA ohne Ablaufdatum im Erneuerungsfenster: sagt, dass das Datum fehlt und welches einzutragen ist', () => {
    assert.deepEqual(registrierungHinweise('US', [reg('fda', null)], '2026-11-20'), [
      'FDA-Registrierung FDA1234567: Es ist kein Ablaufdatum hinterlegt. Die Erneuerung ist jetzt fällig (Oktober bis Dezember gerader Jahre). Danach als „Gültig bis“ den 31.12.2028 eintragen – dann entfällt dieser Hinweis.',
    ])
    // außerhalb des Fensters bleibt eine Registrierung ohne Ablaufdatum still
    assert.deepEqual(registrierungHinweise('US', [reg('fda', null)], '2027-03-01'), [])
    assert.deepEqual(registrierungHinweise('US', [reg('fda', null)], '2026-09-30'), [])
  })
  test('der genannte Schritt stimmt: mit dem vorgeschlagenen Datum ist der Hinweis weg', () => {
    for (const heute of ['2026-10-01', '2026-11-20', '2026-12-31', '2028-10-15']) {
      assert.deepEqual(registrierungHinweise('US', [reg('fda', fdaAblaufVorschlag(heute))], heute), [], heute)
    }
  })
  test('läuft ab: mit Vorwarnzeit und Schritt (Befund 20.01.2027); abgelaufen: mit Schritt', () => {
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2027-01-20')], '2026-11-20'),
      [`FDA-Registrierung FDA1234567: läuft am 20.01.2027 ab (Erinnerung ab 90 Tagen vor dem Ablauf). ${SCHRITT}`])
    assert.deepEqual(registrierungHinweise('US', [reg('fda', '2026-11-19')], '2026-11-20'),
      [`FDA-Registrierung FDA1234567: abgelaufen am 19.11.2026. ${SCHRITT}`])
    // im Fenster mit Ablauf im laufenden Jahr: der Schritt steht einmal, in der Zeile zur Erneuerung
    const h = registrierungHinweise('US', [reg('fda', '2026-12-31')], '2026-11-20')
    assert.equal(h.length, 2)
    assert.doesNotMatch(h[0], /Registrierungen verwalten/)
    assert.match(h[1], /den 31\.12\.2028 eintragen/)
  })
  test('China/Südkorea: Vermerk „nicht geprüft“ bleibt, Schritt kommt dazu', () => {
    assert.deepEqual(registrierungHinweise('CN', [reg('gacc', '2027-02-28', 'G1')], '2027-03-01'),
      [`GACC-Registrierung G1: abgelaufen am 28.02.2027 (laut Länderhinweis nötig – nicht geprüft). ${SCHRITT}`])
    assert.deepEqual(registrierungHinweise('KR', [reg('mfds', '2027-04-30', 'M1')], '2027-03-01'),
      [`MFDS-Vorregistrierung M1: läuft am 30.04.2027 ab (Erinnerung ab 90 Tagen vor dem Ablauf). ${SCHRITT}`])
  })
  test('Fristen im Dashboard bleiben unverändert', () => {
    assert.deepEqual(registrierungFristen([reg('fda', '2027-01-20')], '2026-11-20').map(f => f.statusText), ['läuft am 20.01.2027 ab'])
  })
})

describe('KAN-486: FDA-Ablaufdatum', () => {
  test('Vorschlag: 31.12. des laufenden geraden Jahres, im Erneuerungsfenster des übernächsten', () => {
    assert.deepEqual(['2026-03-01', '2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01', '2027-11-20', '2028-05-01', '2028-10-01'].map(fdaAblaufVorschlag),
      ['2026-12-31', '2026-12-31', '2028-12-31', '2028-12-31', '2028-12-31', '2028-12-31', '2028-12-31', '2030-12-31'])
  })
  test('unüblich ist alles außer dem 31.12. eines geraden Jahres; leer und ungültig nicht', () => {
    assert.deepEqual(['2027-01-20', '2027-12-31', '2028-12-30', '2028-12-31', '2026-12-31', '', null, '31.12.2028'].map(fdaAblaufUnueblich),
      [true, true, true, false, false, false, false, false])
  })
})

describe('KAN-486: Verdrahtung', () => {
  test('Formular: Vermerk und Vorschlag nur bei FDA, Hinweis bei unüblichem Datum – keine Sperre', () => {
    const c = quelle('src/app/(dashboard)/weinexport/registrierungen/RegistrierungenClient.tsx')
    assert.match(c, /\{f\.art === 'fda' && \(\s+<p id="reg-bis-fda"[^>]*data-fda-ablauf>/)
    assert.match(c, /onClick=\{\(\) => setF\(alt => \(\{ \.\.\.alt, gueltig_bis: fdaVorschlag \}\)\)\}/)
    assert.match(c, /\{fdaAblaufUnueblich\(f\.gueltig_bis\) && \(\s+<span[^>]*data-fda-unueblich>/)
    assert.equal(registrierungEingabeFehler({ art: 'fda', nummer: '1', gueltig_bis: '2027-01-20' }), null, 'die Eingabeprüfung lehnt kein FDA-Datum ab')
  })
  test('Speichern und Entfernen frischen auch die Exportaufträge auf', () => {
    const a = quelle('src/app/(dashboard)/weinexport/registrierungen/actions.ts')
    assert.match(a, /function aktualisiereSeiten\(\) \{\s+revalidatePath\('\/weinexport', 'layout'\)\s+revalidatePath\('\/dashboard\/fristen'\)\s+\}/)
    assert.equal(a.split('aktualisiereSeiten()\n    return {}').length - 1, 2)
  })
})
