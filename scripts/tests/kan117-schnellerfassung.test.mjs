// KAN-117 (07.10.2026) – Schnellerfassung auf der Behälterseite (Ziel des QR-Codes): Inhalt, Kacheln, letzte Maßnahmen,
// Notiz als Kellerbehandlung „Notiz“, Schwund über schwundBuchen, Entwurf im localStorage, Wechsel-Hinweis für Gebinde
// eines anderen Betriebs, Nur-Lesen für Leser bzw. bei gesperrtem Abo.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  inhaltLiter, fuellgrad, letzteMassnahmen, schnellZiele, entwurfSchluessel, notizFehler, NOTIZ_TYP,
} from '../../src/lib/keller/schnellerfassung.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SEITE = 'src/app/(dashboard)/kellerbuch/behaelter/[id]/page.tsx'
const B = 'beh-1'

describe('KAN-117: Inhalt und Kacheln', () => {
  test('Inhalt = Summe der aktiven Chargen, Füllgrad ganzzahlig, ohne Volumen null', () => {
    const l = inhaltLiter([{ id: 'a', name: 'A', menge_liter: '1200.5' }, { id: 'b', name: 'B', menge_liter: 300 }, { id: 'c', name: null, menge_liter: null }])
    assert.equal(l, 1500.5)
    assert.equal(fuellgrad(l, 2000), 75)
    assert.equal(fuellgrad(l, null), null)
    assert.equal(fuellgrad(l, 0), null)
  })
  test('Ziele: Behandlung öffnet das Formular, Analyse nur mit einer Charge, Umziehen mit dem Gebinde als Quelle', () => {
    assert.deepEqual(schnellZiele(B, 'ch-1'), {
      behandlung: `/kellerbuch/behaelter/${B}/behandlungen?neu=1`,
      analyse: '/kellerbuch/weinausbau/ch-1/analysen/neu',
      umziehen: `/kellerbuch/umziehen?neu=1&von=${B}`,
    })
    assert.equal(schnellZiele(B, null).analyse, null)
  })
  test('Notiz: Pflicht, höchstens 500 Zeichen; Entwurf je Gebinde und Formular', () => {
    assert.match(notizFehler('  '), /Text/)
    assert.match(notizFehler('x'.repeat(501)), /zu lang/)
    assert.equal(notizFehler('Gärung ruhig'), null)
    assert.equal(entwurfSchluessel(B, 'notiz'), `s112:schnell:notiz:${B}`)
    assert.notEqual(entwurfSchluessel(B, 'notiz'), entwurfSchluessel(B, 'schwund'))
    assert.equal(NOTIZ_TYP, 'Notiz')
  })
})

describe('KAN-117: letzte Maßnahmen', () => {
  const beh = [
    { id: 1, datum: '2026-10-05', typ: { name: 'Schwefelung' }, menge: '30', einheit: 'g', notizen: null },
    { id: 2, datum: '2026-10-01', typ: null, typ_name_snapshot: 'Notiz', menge: null, einheit: '-', notizen: 'Gärung ruhig' },
  ]
  const umz = [
    { id: 3, datum: '2026-10-05', umzug_typ: 'normal', menge_liter: 500, von_behaelter_id: B, nach_behaelter_id: 'x' },
    { id: 4, datum: '2026-10-03', umzug_typ: 'schwund', menge_liter: 0, schwund_liter: 2.5, von_behaelter_id: null, nach_behaelter_id: B },
    { id: 5, datum: '2026-09-20', umzug_typ: 'filtration', menge_liter: 800, von_behaelter_id: B, nach_behaelter_id: B },
  ]
  const ana = [{ id: 6, analyse_datum: '2026-10-04', alkohol_vol: 12.5, restzucker_gl: null, gesamtsaeure_gl: 6.1, weinausbau_id: 'ch-1' }]

  test('neueste zuerst, höchstens 5; am selben Tag Behandlung vor Umzug', () => {
    const m = letzteMassnahmen(B, beh, umz, ana, 5, l => `${l} L`)
    assert.deepEqual(m.map(x => x.key), ['b-1', 'u-3', 'a-6', 'u-4', 'b-2'])
    assert.equal(m[0].titel, 'Schwefelung')
    assert.equal(m[0].detail, '30 g')
    assert.equal(m[1].titel, 'Umzug (abgegeben)')
    assert.equal(m[1].detail, '500 L')
    assert.equal(m[2].detail, '12,5 % vol · S 6,1 g/L')
    assert.equal(m[2].href, '/kellerbuch/weinausbau/ch-1')
    assert.equal(m[3].art, 'schwund')
    assert.equal(m[3].detail, '2.5 L')
    assert.equal(m[4].detail, 'Gärung ruhig')
  })
  test('Filtration im selben Gebinde, Umzug herein; n begrenzt', () => {
    const m = letzteMassnahmen(B, [], umz, [], 10)
    assert.deepEqual(m.map(x => x.titel), ['Umzug (abgegeben)', 'Schwund', 'Filtration'])
    assert.equal(letzteMassnahmen(B, beh, umz, ana, 2).length, 2)
    const herein = letzteMassnahmen(B, [], [{ id: 9, datum: '2026-10-06', umzug_typ: 'normal', menge_liter: 100, von_behaelter_id: 'y', nach_behaelter_id: B }], [])
    assert.equal(herein[0].titel, 'Umzug (erhalten)')
  })
})

describe('KAN-117: Seite und Aktionen', () => {
  test('Seite: Gebinde über lade_behaelter (auch freigegebene), sonst Wechsel-Hinweis bzw. 404', () => {
    const s = quelle(SEITE)
    assert.match(s, /ladeBehaelterEinzeln\(supabase, tenantId, id\)/)
    assert.match(s, /if \(!anderer\) notFound\(\)/)
    assert.match(s, /\/auth\/betrieb\?tenant_id=\$\{anderer\.tenantId\}&weiter=/)
  })
  test('Seite: Schreiben nur mit Kellerbuch-Recht, ohne Abo-Sperre und bei aktivem Gebinde; Stammdaten nur für den Eigentümer', () => {
    const s = quelle(SEITE)
    assert.match(s, /canWrite\(membership, 'kellerbuch'\)/)
    assert.match(s, /schreibSperre\(membership\)/)
    assert.match(s, /const schreiben = darf && !gesperrt && gebinde\.aktiv/)
    assert.match(s, /if \(!gebinde\.fremd\)/)
  })
  test('Seite: letzte Maßnahmen ohne stornierte Zeilen, alles auf den aktiven Betrieb gefiltert', () => {
    const s = quelle(SEITE)
    assert.equal((s.match(/\.is\('storniert_am', null\)/g) ?? []).length, 3)
    assert.equal((s.match(/\.eq\('tenant_id', tenantId\)/g) ?? []).length >= 5, true)
  })
  test('Notiz: eigene Action über speichereKellerbehandlung, Typ „Notiz“ ohne Wirkung auf die Prüfnummer', () => {
    const a = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const teil = a.slice(a.indexOf('export async function kellerNotizErfassen'), a.indexOf('/** Einstufung eines Typs ändern'))
    assert.match(teil, /kellerbuchSchreibrecht\(\)/)
    assert.match(teil, /pn_wirkung: 'pflege'/)
    assert.match(teil, /einheit_standard: '-'/)
    assert.match(teil, /speichereKellerbehandlung\(fd\)/)
  })
  test('Schnellerfassung: ohne Netz Meldung und Entwurf im localStorage; Behandlungsseite öffnet mit ?neu=1 das Formular', () => {
    const k = quelle('src/components/kellerbuch/Schnellerfassung.tsx')
    assert.match(k, /navigator\.onLine/)
    assert.match(k, /localStorage\.setItem/)
    assert.match(k, /Keine Verbindung zum Netz – nichts gespeichert/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx'), /get\('neu'\) === '1'\) openNeu\(\)/)
  })
})
