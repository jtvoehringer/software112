// KAN-318 (10.10.2026, Entscheidung Jörgen: Variante C): Ereignis-Daten in der Zukunft bleiben erlaubt, die App zeigt
// unter dem Feld „Datum liegt in der Zukunft – bitte prüfen.“ (ZukunftsDatum). 31 Felder: Kellerbuch, Lese, Füllung,
// Verkauf/Zukauf, Lager, E&A, Zeiterfassung. Kein Sperren, kein max am Feld.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { liegtInZukunft, ZUKUNFT_HINWEIS } from '../../src/lib/datum/zukunft.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')
const D = 'src/app/(dashboard)/'

describe('liegtInZukunft', () => {
  test('nur Tage nach heute; heute, Vergangenheit, leer und ungültig nicht', () => {
    assert.equal(liegtInZukunft('2026-10-11', '2026-10-10'), true)
    assert.equal(liegtInZukunft('2062-10-10', '2026-10-10'), true)
    assert.equal(liegtInZukunft('2026-10-10', '2026-10-10'), false)
    assert.equal(liegtInZukunft('2026-01-01', '2026-10-10'), false)
    assert.equal(liegtInZukunft('', '2026-10-10'), false)
    assert.equal(liegtInZukunft('10.10.2062', '2026-10-10'), false)
    assert.equal(liegtInZukunft(undefined, '2026-10-10'), false)
    assert.match(ZUKUNFT_HINWEIS, /in der Zukunft – bitte prüfen/)
  })
})

describe('ZukunftsDatum', () => {
  test('Hinweis nur als Ansage, kein Sperren: kein max, kein setCustomValidity', () => {
    const k = lies('src/components/ui/ZukunftsDatum.tsx')
    assert.match(k, /type="date"/)
    assert.match(k, /role="status"/)
    assert.match(k, /aria-describedby=\{beschrieben\}/)
    assert.doesNotMatch(k, /\bmax=|setCustomValidity/)
  })
  test('an den Ereignisfeldern eingesetzt (Stichprobe je Bereich), insgesamt 29', () => {
    const stichprobe = [
      'src/components/kellerbuch/UmziehenWidget.tsx', `${D}kellerbuch/weinausbau/[id]/SchwundBuchenForm.tsx`,
      `${D}erntemeldung/[id]/PressungSection.tsx`, `${D}weinhandel/fuellungen/neu/FuellungFormClient.tsx`,
      `${D}weinhandel/verkauf/neu/page.tsx`, `${D}weinhandel/zukauf/neu/page.tsx`, `${D}behandlungen/lager/LagerClient.tsx`,
      `${D}buchhaltung/neu/page.tsx`, `${D}admin/zeiterfassung/ZeiterfassungClient.tsx`,
    ]
    for (const d of stichprobe) {
      const t = lies(d)
      assert.match(t, /import ZukunftsDatum from '@\/components\/ui\/ZukunftsDatum'/, d)
      assert.match(t, /<ZukunftsDatum\b/, d)
    }
    const alle = [
      'src/components/kellerbuch/UmziehenFormClient.tsx', 'src/components/kellerbuch/UmziehenWidget.tsx', 'src/components/kellerbuch/VerschneidungForm.tsx',
      `${D}kellerbuch/umziehen/UmziehenClient.tsx`, `${D}kellerbuch/weinausbau/[id]/SchwundBuchenForm.tsx`, `${D}kellerbuch/behaelter/[id]/behandlungen/page.tsx`,
      `${D}kellerbuch/weinausbau/[id]/analysen/neu/page.tsx`, `${D}erntemeldung/[id]/ErnteDetailClient.tsx`,
      `${D}erntemeldung/[id]/PressungSection.tsx`, `${D}erntemeldung/[id]/TraubenverkaufSection.tsx`, `${D}weinhandel/fuellungen/neu/FuellungFormClient.tsx`,
      `${D}weinhandel/fuellungen/[id]/edit/page.tsx`, `${D}weinhandel/verkauf/neu/page.tsx`, 'src/components/handel/ZahlungErfassen.tsx',
      `${D}weinhandel/zukauf/neu/page.tsx`, `${D}weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx`, `${D}weinhandel/traubenverkauf/TraubenverkaufClient.tsx`,
      `${D}behandlungen/lager/BetriebsmittelLagerClient.tsx`, `${D}behandlungen/lager/DuengerLagerClient.tsx`,
      `${D}behandlungen/lager/LagerClient.tsx`, `${D}buchhaltung/neu/page.tsx`, `${D}buchhaltung/belege/[id]/BelegBuchenForm.tsx`,
      `${D}konten/[id]/abstimmung/AbstimmungClient.tsx`, `${D}konten/neu/page.tsx`, `${D}buchhaltung/anlagen/AnlageForm.tsx`,
      `${D}admin/zeiterfassung/ZeiterfassungClient.tsx`,
    ]
    const anzahl = alle.reduce((s, d) => s + (lies(d).match(/<ZukunftsDatum\b/g) ?? []).length, 0)
    // KAN-355: Verkaufsseite und Offene Posten teilen sich ZahlungErfassen; KAN-376: das Bewegungsbuch des Gebindes hat
    // kein eigenes Datumsfeld mehr (Schwund über SchwundBuchenForm, oben schon gezählt)
    assert.equal(anzahl, 29)
  })
})
