// KAN-235 (08.10.2026) – Support: Anfrage verfolgen ohne Portal-Login. „Meine Anfragen“ zeigt den Verlauf in
// software:112 (Beschreibung ohne Kontextblock, öffentliche Antworten des Supports) und nimmt Antworten entgegen
// (öffentlicher Kommentar mit dem Namen des Benutzers). Nur eigene Anfragen (Reporter = Konto zur E-Mail).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as a from '../../src/lib/support/anfrage.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-235: Verlauf und Antworten', () => {
  test('supportKeyGueltig: nur SUP-<Zahl>', () => {
    for (const ok of ['SUP-1', 'SUP-12', 'SUP-999999999']) assert.equal(a.supportKeyGueltig(ok), true, ok)
    for (const nein of ['KAN-12', 'SUP-0', 'SUP-', 'sup-1', 'SUP-1/../x', 'SUP-1 OR 1=1', '', null, 12]) assert.equal(a.supportKeyGueltig(nein), false, String(nein))
  })
  test('Antwort: Länge, Kopfzeile mit Name, Zerlegen', () => {
    assert.match(a.antwortFehler(' ') ?? '', /Bitte eine Antwort/)
    assert.match(a.antwortFehler('x'.repeat(a.MAX_ANTWORT + 1)) ?? '', /höchstens/)
    assert.equal(a.antwortFehler('Danke, passt.'), null)
    const k = a.antwortKommentar('Karin\nK.', '  Danke, passt.  ')
    assert.equal(k, 'Antwort von Karin K. (über software:112):\nDanke, passt.')
    assert.deepEqual(a.kommentarZerlegen(k), { vonKunde: true, name: 'Karin K.', text: 'Danke, passt.' })
    assert.deepEqual(a.kommentarZerlegen('Wir haben den Fehler behoben.'), { vonKunde: false, name: null, text: 'Wir haben den Fehler behoben.' })
  })
  test('Beschreibung ohne Kontextblock – derselbe Block wie beschreibungMitKontext', () => {
    const mit = a.beschreibungMitKontext('Füllung lässt sich nicht speichern.', {
      betriebName: 'Musterhof', tenantId: 't1', benutzerName: 'Karin', benutzerEmail: 'k@x.at', rolle: 'winzer',
      seite: '/weinhandel', userAgent: null, appVersion: null, zeitpunkt: '08.10.2026, 10:00:00',
    })
    assert.equal(a.beschreibungOhneKontext(mit), 'Füllung lässt sich nicht speichern.')
    assert.equal(a.beschreibungOhneKontext('Nur Text'), 'Nur Text')
  })

  test('Route: nur eigene Anfragen, Antwort erst nach der Prüfung, Betrieb der Seite', () => {
    const r = quelle('src/app/api/support/anfragen/[key]/route.ts')
    const post = r.slice(r.indexOf('export async function POST'))
    assert.match(r, /if \(!supportKeyGueltig\(key\)\) return nichtGefunden\(\)/)
    assert.match(post, /seitenBetriebKonflikt\(k\.membership\.tenantId\)/)
    assert.ok(post.indexOf('anfrageDetail(k.user.email!, key)') < post.indexOf('antwortSenden('), 'erst Eigentum prüfen, dann antworten')
    const j = quelle('src/lib/support/jsm.ts')
    assert.match(j, /if \(String\(a\.reporter\?\.accountId \?\? ''\) !== accountId\) return null/)
    assert.match(j, /comment\?public=true&internal=false&limit=100/)
  })
  test('Oberfläche: Verlauf statt Portal-Link', () => {
    const s = quelle('src/app/(dashboard)/hilfe/support/SupportAnfrage.tsx')
    assert.doesNotMatch(s, /Im Support-Portal ansehen|im Support-Portal öffnen/)
    assert.match(s, /\{offen === a\.key && <AnfrageVerlauf anfrageKey=\{a\.key\} onGeaendert=\{laden\} \/>\}/)
    const v = quelle('src/app/(dashboard)/hilfe/support/AnfrageVerlauf.tsx')
    assert.match(v, /method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(\{ text: antwort \}\)/)
  })
})
