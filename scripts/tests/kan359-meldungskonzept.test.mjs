// KAN-359 (22.10.2026) – einheitliches Meldungskonzept: Rückfragen über den eigenen Dialog statt window.confirm,
// Erfolg als Pop-up an einer Stelle, Fehler am Formular (das Pop-up zeigt nur „Fehlermeldung außer Sicht“ mit
// „Zur Meldung“), Wächter check-rueckfragen. Konzept: docs/Meldungskonzept.md.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const r = await import('../../src/lib/ui/rueckfrage.ts')
const e = await import('../../src/lib/ui/erfolg.ts')

describe('KAN-359: Rückfrage (Zustand)', () => {
  test('ohne Dialog gilt eine Rückfrage als abgebrochen – nie still bestätigt', async () => {
    assert.equal(await r.rueckfrage({ titel: 'Löschen?' }), false)
    assert.equal(r.offeneRueckfrage(), null)
  })
  test('Promise löst mit true bzw. false; Reihenfolge bleibt; Vorgaben für Knöpfe', async () => {
    const abmelden = r.wirtAnmelden()
    try {
      const a = r.rueckfrage({ titel: '  Eintrag löschen? ', text: 'Weg ist weg.', bestaetigen: 'Löschen', gefaehrlich: true })
      const b = r.rueckfrage({ titel: 'Buchen?', text: '   ' })
      const f1 = r.offeneRueckfrage()
      assert.deepEqual({ ...f1, id: 0 }, { id: 0, titel: 'Eintrag löschen?', text: 'Weg ist weg.', bestaetigen: 'Löschen', abbrechen: 'Abbrechen', gefaehrlich: true })
      r.beantworte(f1.id, true)
      assert.equal(await a, true)
      const f2 = r.offeneRueckfrage()
      assert.equal(f2.titel, 'Buchen?')
      assert.equal(f2.text, null)
      assert.equal(f2.bestaetigen, 'Fortfahren')
      assert.equal(f2.gefaehrlich, false)
      r.beantworte(f2.id, false)
      assert.equal(await b, false)
      assert.equal(r.offeneRueckfrage(), null)
      r.beantworte(f2.id, true)   // doppelte Antwort ohne Wirkung
    } finally { abmelden() }
  })
  test('Esc = Abbrechen (false), andere Tasten keine Antwort; Fokus bei gefährlich auf „Abbrechen“', () => {
    assert.equal(r.antwortAufTaste('Escape'), false)
    assert.equal(r.antwortAufTaste('Esc'), false)
    assert.equal(r.antwortAufTaste('Enter'), null)
    assert.equal(r.antwortAufTaste('a'), null)
    assert.equal(r.startFokus({ gefaehrlich: true }), 'abbrechen')
    assert.equal(r.startFokus({ gefaehrlich: false }), 'bestaetigen')
  })
  test('Dialog verschwindet (Abmelden): offene Rückfragen gelten als abgebrochen; Hörer werden benachrichtigt', async () => {
    const abmelden = r.wirtAnmelden()
    let meldungen = 0
    const ab = r.abonniereRueckfragen(() => { meldungen++ })
    const p = r.rueckfrage({ titel: 'X?' })
    assert.ok(meldungen >= 1)
    abmelden()
    assert.equal(await p, false)
    assert.equal(r.offeneRueckfrage(), null)
    ab()
  })
  test('useRueckfrage liefert dieselbe Funktion', () => {
    assert.equal(r.useRueckfrage(), r.rueckfrage)
  })
  test('frageAufteilen: Titel bis zum ersten Fragezeichen, Rest als Erklärung', () => {
    assert.deepEqual(r.frageAufteilen('Beleg verwerfen? Die Datei wird endgültig gelöscht.'), { titel: 'Beleg verwerfen?', text: 'Die Datei wird endgültig gelöscht.' })
    assert.deepEqual(r.frageAufteilen('Eintrag löschen?'), { titel: 'Eintrag löschen?', text: null })
    assert.deepEqual(r.frageAufteilen('Kein Fragezeichen'), { titel: 'Kein Fragezeichen', text: null })
    // „?“ mitten im Wort (z. B. URL) trennt nicht
    assert.deepEqual(r.frageAufteilen('Link /a?b=1 öffnen? Jetzt.'), { titel: 'Link /a?b=1 öffnen?', text: 'Jetzt.' })
  })
  test('serverRueckfrage: Text vom Server, gefährlich, Knopf „Trotzdem buchen“ bzw. eigener', async () => {
    const abmelden = r.wirtAnmelden()
    try {
      const p = r.serverRueckfrage('Die Prüfnummer erlischt.\nFortfahren?')
      const f = r.offeneRueckfrage()
      assert.equal(f.text, 'Die Prüfnummer erlischt.\nFortfahren?')
      assert.equal(f.bestaetigen, 'Trotzdem buchen')
      assert.equal(f.gefaehrlich, true)
      r.beantworte(f.id, true)
      assert.equal(await p, true)
      const q = r.serverRueckfrage('x', 'Trotzdem speichern')
      assert.equal(r.offeneRueckfrage().bestaetigen, 'Trotzdem speichern')
      r.beantworte(r.offeneRueckfrage().id, false)
      assert.equal(await q, false)
    } finally { abmelden() }
  })
})

describe('KAN-359: gemeinsame Bausteine ohne Browser-Dialog', () => {
  test('ConfirmDeleteForm fängt den Klick ab, fragt und sendet nach „ja“ mit demselben Knopf', () => {
    const c = quelle('src/components/ui/ConfirmDeleteForm.tsx')
    assert.match(c, /e\.preventDefault\(\)\n\s*const knopf = e\.currentTarget/)
    assert.match(c, /if \(!\(await rueckfrage\(\{ titel, text, bestaetigen: bestaetigen \?\? title \?\? 'Bestätigen', gefaehrlich \}\)\)\) return\n\s*knopf\.form\?\.requestSubmit\(knopf\)/)
    assert.doesNotMatch(c, /confirm\(/)
  })
  test('LoeschenButton fragt im Dialog mit dem Verb des Knopfs', () => {
    const c = quelle('src/components/kellerbuch/LoeschenButton.tsx')
    assert.match(c, /if \(!\(await rueckfrage\(\{ \.\.\.frageAufteilen\(bestaetigung\), bestaetigen: label, gefaehrlich: true \}\)\)\) return/)
    assert.doesNotMatch(c, /window\.confirm/)
  })
  test('UngespeichertSchutz: Klick anhalten, im Dialog fragen, nach „Verlassen“ sauber und erneut klicken', () => {
    const c = quelle('src/components/UngespeichertSchutz.tsx')
    assert.match(c, /e\.preventDefault\(\)\n\s*e\.stopPropagation\(\)\n\s*void rueckfrage\(\{ titel: MELDUNG_TITEL, text: MELDUNG, bestaetigen: 'Verlassen', abbrechen: 'Weiter bearbeiten', gefaehrlich: true \}\)/)
    assert.match(c, /offen\.forEach\(f => f\.removeAttribute\(GEAENDERT_ATTR\)\)\n\s*if \(a\.isConnected\) a\.click\(\)/)
    assert.doesNotMatch(c, /window\.confirm/)
  })
  test('Rückfrage aus einem Dialog heraus: Esc/Tab zuerst an window (vor useDialog am document)', () => {
    const d = quelle('src/components/RueckfrageDialog.tsx')
    assert.match(d, /window\.addEventListener\('keydown', taste, true\)/)
    assert.match(d, /if \(e\.key !== 'Tab'\) return\n(\s*\/\/.*\n)*\s*e\.stopPropagation\(\)/)
  })
})

describe('KAN-359: Erfolg (Zustand)', () => {
  test('zeigen, nicht doppelt, höchstens drei, schließen; leere Texte nie', () => {
    for (const x of e.aktuelleErfolge()) e.schliesseErfolg(x.id)
    assert.equal(e.zeigeErfolg(''), null)
    assert.equal(e.zeigeErfolg(null), null)
    const id = e.zeigeErfolg('  Gespeichert. ')
    assert.equal(e.zeigeErfolg('Gespeichert.'), id)
    assert.deepEqual(e.aktuelleErfolge().map(x => x.text), ['Gespeichert.'])
    e.zeigeErfolg('A gebucht.'); e.zeigeErfolg('B gebucht.'); e.zeigeErfolg('C gebucht.', { vorgelesen: true })
    assert.deepEqual(e.aktuelleErfolge().map(x => x.text), ['A gebucht.', 'B gebucht.', 'C gebucht.'])
    assert.equal(e.aktuelleErfolge().at(-1).vorgelesen, true)
    assert.equal(e.MAX_ERFOLGE, 3)
    for (const x of e.aktuelleErfolge()) e.schliesseErfolg(x.id)
    assert.equal(e.aktuelleErfolge().length, 0)
    assert.equal(e.keineErfolge().length, 0)
  })
  test('Text zusammengefasst und gekürzt; Dauer einige Sekunden', () => {
    assert.equal(e.erfolgText(' Umzug\n  gebucht. '), 'Umzug gebucht.')
    assert.equal(e.erfolgText('x'.repeat(500)).length, e.MAX_ERFOLG_TEXT)
    assert.ok(e.ERFOLG_DAUER_MS >= 3000 && e.ERFOLG_DAUER_MS <= 8000)
  })
})

describe('KAN-359: Bausteine und Einbindung', () => {
  test('RueckfrageDialog: alertdialog, Esc, Fokus, Fokusfalle, scrollt selbst (check-dialoge)', () => {
    const d = quelle('src/components/RueckfrageDialog.tsx')
    assert.match(d, /role="alertdialog" aria-modal="true" aria-labelledby=\{titelId\}/)
    assert.match(d, /antwortAufTaste\(e\.key\)/)
    assert.match(d, /startFokus\(\{ gefaehrlich \}\) === 'abbrechen' \? abbrechenRef : bestaetigenRef/)
    assert.match(d, /if \(e\.key !== 'Tab'\) return/)
    assert.match(d, /vorher\.focus\(\)/)
    assert.match(d, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto/)
    assert.match(d, /useEffect\(\(\) => wirtAnmelden\(\), \[\]\)/)
    const { fundeIn } = require('../check-dialoge.js')
    assert.deepEqual(fundeIn(d, 'RueckfrageDialog.tsx', ts), [])
  })
  test('eine Stelle: Pop-up und Rückfrage-Dialog nur im Root-Layout', () => {
    const l = quelle('src/app/layout.tsx')
    assert.match(l, /<MeldungsPopup \/>/)
    assert.match(l, /<RueckfrageDialog \/>/)
    assert.doesNotMatch(quelle('src/components/layout/AppShell.tsx'), /<MeldungsPopup|<RueckfrageDialog/)
  })
  test('Erfolgs-Pop-up: role="status", Dauer, schließbar; Fehler-Pop-up nur als Hinweis ohne den Text', () => {
    const p = quelle('src/components/MeldungsPopup.tsx')
    assert.match(p, /role="status" aria-live=\{e\.vorgelesen \? 'off' : 'polite'\}/)
    assert.match(p, /schliesseErfolg\(e\.id\) \}, OK_DAUER_MS\)/)
    assert.match(p, /aria-label="Meldung schließen"/)
    assert.match(p, /Es gibt eine Fehlermeldung außer Sicht\./)
    assert.match(p, /Zur Meldung/)
    assert.doesNotMatch(p, /\{p\.text\}/)                       // kein zweiter Ort für den Fehlertext
    assert.match(p, /if \(a === 'ok'\) \{ zeigeErfolg\(text, \{ vorgelesen: true \}\); return \}/)
  })
  test('erledigt-Parameter (KAN-224) wird zum Erfolgs-Pop-up statt grünem Kasten', () => {
    const z = quelle('src/components/layout/ZurueckLeiste.tsx')
    assert.match(z, /zeigeErfolg\(erledigt\)/)
    assert.match(z, /p\.delete\(ERLEDIGT_PARAM\)/)
    assert.doesNotMatch(z, /role="status"/)
  })
  test('grüne „Gespeichert“-Kästen der Formulare melden über das Erfolgs-Pop-up statt im Formular', () => {
    const dateien = [
      'src/app/(dashboard)/admin/benutzer/SystemAdminClient.tsx', 'src/app/(dashboard)/admin/mandanten/[id]/MandantDetailClient.tsx',
      'src/app/(dashboard)/benutzer/BenutzerClient.tsx', 'src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/BestandKorrigierenForm.tsx',
      'src/app/(dashboard)/kellerbuch/weinausbau/[id]/SchwundBuchenForm.tsx', 'src/app/(dashboard)/weinhandel/sonstige-artikel/[id]/ProduktLagerClient.tsx',
      'src/app/(dashboard)/kellerbuch/besondere-konten/StoffkontoClient.tsx', 'src/components/FreezeKorrektur.tsx',
      'src/components/PasskeyVerwaltung.tsx', 'src/components/ui/AktionsFormular.tsx',
    ]
    for (const d of dateien) {
      const s = quelle(d)
      assert.match(s, /import ErfolgsMeldung from '@\/components\/ErfolgsMeldung'/, d)
      assert.match(s, /<ErfolgsMeldung text=\{/, d)
      assert.doesNotMatch(s, /\{(success|ok|erfolg|hinweis|meldung) && <(p|div|span) role="status"/, d)
    }
  })
  test('ErfolgsMeldung meldet den Text beim Setzen bzw. Ändern', () => {
    assert.match(quelle('src/components/ErfolgsMeldung.tsx'), /useEffect\(\(\) => \{\n\s*if \(text\) zeigeErfolg\(text\)\n\s*\}, \[text\]\)/)
  })
  test('Konzept und CLAUDE.md-Eintrag vorhanden', () => {
    const k = quelle('docs/Meldungskonzept.md')
    for (const w of ['Fehler', 'Erfolg', 'Rückfrage', 'rueckfrage-ok', 'gefaehrlich', 'Du-Form', 'Umlaute']) assert.match(k, new RegExp(w))
    assert.match(quelle('CLAUDE.md'), /\*\*Meldungen \(seit 22\.10\.2026, KAN-359\):\*\*/)
  })
})

describe('KAN-359: Wächter check-rueckfragen', () => {
  const { fundeIn } = require('../check-rueckfragen.js')
  const f = (src) => fundeIn(src).map(x => `${x.zeile}:${x.art}`)
  test('findet confirm/alert/prompt global und über window/globalThis', () => {
    assert.deepEqual(f('if (!confirm("x")) return'), ['1:confirm'])
    assert.deepEqual(f('if (!window.confirm(r.bestaetigung)) return'), ['1:confirm'])
    assert.deepEqual(f('a()\nalert(r.error)'), ['2:alert'])
    assert.deepEqual(f('window.alert(fehlerText(e))'), ['1:alert'])
    assert.deepEqual(f('const n = window.prompt("Name?")'), ['1:prompt'])
    assert.deepEqual(f('globalThis.confirm ( "x" )'), ['1:confirm'])
    assert.deepEqual(f('onClick={() => { if (confirm(`"${x}" weg?`)) f() }}'), ['1:confirm'])
  })
  test('ignoriert Kommentare, Text, Methoden, Namen und Deklarationen', () => {
    assert.deepEqual(f('// if (!confirm("x")) return'), [])
    assert.deepEqual(f('/* window.alert(x) */ const a = 1'), [])
    assert.deepEqual(f('const t = "bitte confirm(…) nicht"'), [])
    assert.deepEqual(f('<div role="alert">x</div>'), [])
    assert.deepEqual(f('dialog.confirm(x); onAlert(y); zeigeAlert(z); $alert(1)'), [])
    assert.deepEqual(f('function confirm(x) { return x }'), [])
  })
  test('Ausnahme mit ausreichender Begründung in derselben Zeile oder bis zu zwei Zeilen davor', () => {
    assert.deepEqual(f('// rueckfrage-ok: Altsystem ohne React, Dialog nicht verfügbar\n\nconfirm("x")'), [])
    assert.deepEqual(f('confirm("x") // rueckfrage-ok: Altsystem ohne React, Dialog nicht verfügbar'), [])
    assert.deepEqual(f('// rueckfrage-ok: kurz\nconfirm("x")'), ['2:confirm'])
    assert.match(fundeIn('// rueckfrage-ok: kurz\nconfirm("x")')[0].text, /ohne ausreichende Begründung/)
    assert.deepEqual(f('// rueckfrage-ok: Altsystem ohne React, Dialog nicht verfügbar\n\n\nconfirm("x")'), ['4:confirm'])
  })
  test('im prebuild verdrahtet (CI über verify) und bei Einführung ohne Ausnahme', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-rueckfragen\.js/)
    const { execFileSync } = require('node:child_process')
    const aus = execFileSync(process.execPath, ['scripts/check-rueckfragen.js'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' })
    assert.match(aus, /✓ check-rueckfragen: keine Browser-Dialoge/)
  })
})
