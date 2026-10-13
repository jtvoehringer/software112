// KAN-224 (07.10.2026) – nach Speichern/Abbrechen zurück, woher man kam; „Zurück“-Knopf auf jeder Unterseite.
// Dazu Rückmeldung Jörgen 07.10.2026 zum Zukauf: Betriebsnummer schon bei der Auswahl des Lieferanten prüfen, Fehler
// sichtbar, nach dem Speichern zur Zukaufsübersicht, Lieferant änderbar.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const z = () => laden('lib/navigation/zurueck.ts')

describe('KAN-224: sicheres Rückkehr-Ziel', nurMitHooks, () => {
  test('nur relative Pfade der App', async () => {
    const { sicheresZiel } = await z()
    assert.equal(sicheresZiel('/kellerbuch?tab=x', '/s'), '/kellerbuch?tab=x')
    assert.equal(sicheresZiel('  /dac  ', '/s'), '/dac')
    for (const boese of [
      'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'kellerbuch',
      '/api/export/kontakte', '/auth/callback', '/login', '/login?x=1', '/a\nb', '/a\u0000b', '/' + 'x'.repeat(500),
      '', null, undefined, 42, ['/dac'],
    ]) assert.equal(sicheresZiel(boese, '/s'), '/s', String(boese))
    // /apix ist kein API-Pfad
    assert.equal(sicheresZiel('/apix', '/s'), '/apix')
  })
  test('mitZurueck hängt nur sichere Ziele an, behält Hash und Parameter', async () => {
    const { mitZurueck } = await z()
    assert.equal(mitZurueck('/kellerbuch/umziehen', '/kellerbuch'), '/kellerbuch/umziehen?zurueck=%2Fkellerbuch')
    assert.equal(mitZurueck('/a?x=1#h', '/b'), '/a?x=1&zurueck=%2Fb#h')
    assert.equal(mitZurueck('/a', '//evil'), '/a')
    assert.equal(mitZurueck('/a', null), '/a')
  })
  test('zielNachAbschluss: Bestätigung nur aus dem Wörterbuch, alte Parameter weg', async () => {
    const { zielNachAbschluss, erledigtText } = await z()
    assert.equal(zielNachAbschluss('/kellerbuch', '/x', 'umzug'), '/kellerbuch?erledigt=umzug')
    assert.equal(zielNachAbschluss('//evil', '/weinhandel/zukauf', 'zukauf'), '/weinhandel/zukauf?erledigt=zukauf')
    assert.equal(zielNachAbschluss('/a?erledigt=alt&zurueck=%2Fb&tab=1', '/x', 'gespeichert'), '/a?tab=1&erledigt=gespeichert')
    assert.equal(zielNachAbschluss('/a', '/x', 'gibtsnicht'), '/a')
    assert.equal(zielNachAbschluss('/a', '/x'), '/a')
    assert.equal(erledigtText('umzug'), 'Umzug gebucht.')
    assert.equal(erledigtText('toString'), null)
    assert.equal(erledigtText('<script>'), null)
    assert.equal(erledigtText(null), null)
  })
})

describe('KAN-224: Seitenverlauf und übergeordnete Seite', nurMitHooks, () => {
  test('verlaufNach: gleiche Seite ersetzt, Rückweg kürzt, unsicheres ignoriert, höchstens 30', async () => {
    const { verlaufNach } = await z()
    assert.deepEqual(verlaufNach([], '/kellerbuch'), ['/kellerbuch'])
    assert.deepEqual(verlaufNach(['/kellerbuch'], '/kellerbuch?tab=2'), ['/kellerbuch?tab=2'])
    assert.deepEqual(verlaufNach(['/kellerbuch', '/kellerbuch/weinausbau/1'], '/kellerbuch?x=1'), ['/kellerbuch?x=1'])
    assert.deepEqual(verlaufNach(['/a'], '//evil'), ['/a'])
    let v = []
    for (let i = 0; i < 40; i++) v = verlaufNach(v, `/s${i}`)
    assert.equal(v.length, 30)
    assert.equal(v[29], '/s39')
  })
  test('vorherigeSeite: anderer Pfad, ohne alte Bestätigung', async () => {
    const { vorherigeSeite } = await z()
    assert.equal(vorherigeSeite(['/kellerbuch?erledigt=umzug&tab=1', '/kellerbuch/umziehen'], '/kellerbuch/umziehen?x=1'), '/kellerbuch?tab=1')
    assert.equal(vorherigeSeite(['/a'], '/a'), null)
    assert.equal(vorherigeSeite([], '/a'), null)
  })
  test('elternZiel: Hauptpunkte ohne Zurück, Unterseiten zum längsten passenden Navigationspunkt', async () => {
    const { elternZiel } = await z()
    const nav = ['/kellerbuch', '/kellerbuch/gebinde', '/weinhandel', '/weinhandel/zukauf', '/dac']
    assert.equal(elternZiel(nav, '/kellerbuch'), null)
    assert.equal(elternZiel(nav, '/dashboard'), null)
    assert.equal(elternZiel(nav, '/kellerbuch/gebinde/qr-etiketten'), '/kellerbuch/gebinde')
    assert.equal(elternZiel(nav, '/kellerbuch/weinausbau/1'), '/kellerbuch')
    assert.equal(elternZiel(nav, '/weinhandel/zukauf/neu'), '/weinhandel/zukauf')
    assert.equal(elternZiel(nav, '/dac/123?x=1'), '/dac')
    assert.equal(elternZiel(nav, '/irgendwo/neu'), '/dashboard')
  })
})

describe('KAN-224: Verdrahtung', () => {
  test('App-Rahmen zeigt die Zurück-Leiste', () => {
    const s = quelle('src/components/layout/AppShell.tsx')
    assert.match(s, /<ZurueckLeiste navHrefs=/)
    assert.match(quelle('src/components/layout/ZurueckLeiste.tsx'), /merkeSeite\(/)
  })
  test('Formulare führen nach Speichern/Abbrechen zurück statt fest verdrahtet', () => {
    const client = {
      // KAN-334: Bearbeiten der Charge bleibt auf der Charge (router.replace(hierBleiben()))
      'src/components/kellerbuch/WeinausbauForm.tsx': `router.replace(hierBleiben())`,
      'src/components/kellerbuch/BehaelterForm.tsx': `zielNachVorgang('/kellerbuch', 'gespeichert')`,
      [`${D}/kellerbuch/umziehen/UmziehenClient.tsx`]: `zielNachVorgang('/kellerbuch', 'umzug')`,
      // KAN-334: Umzug auf der Charge bleibt dort, Bestätigung im Formular
      'src/components/kellerbuch/UmziehenWidget.tsx': `setErfolg(gebucht)`,
      [`${D}/weinhandel/fuellungen/neu/FuellungFormClient.tsx`]: `zielNachVorgang('/weinhandel', 'abfuellung')`,
      [`${D}/weinhandel/fuellungen/[id]/edit/FuellungEditFormular.tsx`]: `zielNachVorgang('/weinhandel', 'gespeichert')`,
      [`${D}/weinhandel/fuellungen/[id]/edit/SchwundAusbuchenKnopf.tsx`]: `zielNachVorgang('/weinhandel', 'schwund')`,
      [`${D}/weinhandel/verkauf/neu/page.tsx`]: `zielNachVorgang('/weinhandel/verkauf', 'verkauf')`,
      [`${D}/behandlungen/neu/NeueBehandlungForm.tsx`]: `zielNachVorgang('/behandlungen', 'angelegt')`,
      [`${D}/behandlungen/[id]/edit/BehandlungEditForm.tsx`]: `zielNachVorgang('/behandlungen', 'gespeichert')`,
      'src/components/weingarten/WeingartenForm.tsx': `zielNachVorgang('/weingarten', 'gespeichert')`,
      'src/components/dac/DacForm.tsx': `zielNachVorgang('/dac', 'gespeichert')`,
      [`${D}/buchhaltung/anlagen/AnlageForm.tsx`]: `zielNachVorgang('/buchhaltung/anlagen', 'gespeichert')`,
      [`${D}/buchhaltung/belege/[id]/BelegBuchenForm.tsx`]: `zielNachVorgang('/buchhaltung/belege', 'gespeichert')`,
    }
    for (const [f, erwartet] of Object.entries(client)) assert.ok(quelle(f).includes(erwartet), f)
    const server = {
      [`${D}/weinhandel/zukauf/actions.ts`]: [`'/weinhandel/zukauf', 'zukauf'`, `'/weinhandel/zukauf', 'gespeichert'`],
      [`${D}/kellerbuch/gebinde-actions.ts`]: [`'/kellerbuch/gebinde?tab=eroeffnungsbestand', 'gespeichert'`, `'/kellerbuch/gebinde?tab=umziehen', 'umzug'`],
      [`${D}/konten/neu/page.tsx`]: [`'/konten', 'angelegt'`],
      [`${D}/buchhaltung/neu/page.tsx`]: [`'/buchhaltung', 'gespeichert'`],
      [`${D}/lagen/neu/page.tsx`]: [`'/lagen', 'angelegt'`],
    }
    for (const [f, liste] of Object.entries(server)) {
      const s = quelle(f)
      assert.match(s, /zielNachAbschluss\(formData\.get\('zurueck'\)/, f)
      for (const e of liste) assert.ok(s.includes(e), `${f}: ${e}`)
    }
    for (const f of [`${D}/konten/neu/page.tsx`, `${D}/buchhaltung/neu/page.tsx`, `${D}/lagen/neu/page.tsx`,
      `${D}/kellerbuch/eroeffnungsbestand/[id]/edit/page.tsx`, `${D}/kellerbuch/umzug/[id]/edit/page.tsx`,
      'src/components/kellerbuch/UmziehenFormClient.tsx']) assert.match(quelle(f), /<ZurueckFeld standard=/, f)
  })
})

describe('Rückmeldung Zukauf 07.10.2026', () => {
  test('Betriebsnummer bei der Auswahl prüfen, Fehler sichtbar, zurück zur Übersicht', () => {
    const s = quelle(`${D}/weinhandel/zukauf/neu/page.tsx`)
    assert.match(s, /zukaufLieferantFehler\(\{ art, lieferant: true, betriebNr: lieferantInfo\.betriebNr/)
    assert.match(s, /if \(lieferantHinweis\) \{ setError\(lieferantHinweis\); return \}/)
    assert.match(s, /scrollIntoView/)
    assert.match(s, /fd\.set\('zurueck', +zurueckZiel\('\/weinhandel\/zukauf'\)\)/)
    const a = quelle(`${D}/weinhandel/zukauf/actions.ts`)
    assert.doesNotMatch(a, /redirect\(`\/weinhandel\/fuellungen\//, 'kein Sprung mehr in die Füllung')
  })
  test('Suche liefert die Betriebsnummer, Auswahl ist änderbar', () => {
    assert.match(quelle('src/app/api/crm/suche/route.ts'), /betrieb_nr/)
    const p = quelle('src/components/crm/PartnerSuche.tsx')
    assert.match(p, /const aendern = \(\) => \{[^}]*setOpen\(true\)/)
    assert.match(p, />Ändern</)
  })
})
