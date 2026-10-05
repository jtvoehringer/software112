// Abnehmer im Traubenverkauf per Suche statt Auswahlliste (05.10.2026).
// Vorher luden Jahrgangsseite (Erntemeldung → Lese) und Warenwirtschaft → Traubenverkauf alle Kontakte und Firmen
// (Gebeshuber: 8.290 + 4.652) in je eine Auswahlliste. Jetzt PartnerSuche (/api/crm/suche, höchstens 30 Treffer),
// die Betriebsnummer steht im Treffer, ein gespeicherter (auch inaktiver) Abnehmer wird beim Bearbeiten angezeigt.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const LESE_KONTEXT = 'src/app/(dashboard)/erntemeldung/[id]/leseKontext.ts'
const LESE_SEITE = 'src/app/(dashboard)/erntemeldung/[id]/page.tsx'
const LESE_FORM = 'src/app/(dashboard)/erntemeldung/[id]/TraubenverkaufSection.tsx'
const WH_SEITE = 'src/app/(dashboard)/weinhandel/traubenverkauf/page.tsx'
const WH_FORM = 'src/app/(dashboard)/weinhandel/traubenverkauf/TraubenverkaufClient.tsx'
const SUCHE = 'src/app/api/crm/suche/route.ts'

test('Seiten laden keine Kontakt-/Firmenliste mehr für die Abnehmer-Auswahl', () => {
  for (const datei of [LESE_KONTEXT, WH_SEITE]) {
    const t = lies(datei)
    assert.doesNotMatch(t, /\.from\('kontakte'\)/, datei)
    assert.doesNotMatch(t, /\.from\('firmen'\)/, datei)
  }
  assert.doesNotMatch(lies(LESE_SEITE), /kontaktOptions|firmaOptions/)
  assert.doesNotMatch(lies(WH_SEITE), /kontakte=\{|firmen=\{/)
})

test('beide Formulare: PartnerSuche für Firma und Privatperson, keine Auswahlliste', () => {
  for (const datei of [LESE_FORM, WH_FORM]) {
    const t = lies(datei)
    assert.match(t, /import PartnerSuche from '@\/components\/crm\/PartnerSuche'/, datei)
    assert.match(t, /<PartnerSuche art="firma" value=\{\w+\}/, datei)
    assert.match(t, /<PartnerSuche art="kontakt" value=\{\w+\}/, datei)
    assert.doesNotMatch(t, /– Firma wählen –|– Kontakt wählen –/, datei)
    assert.doesNotMatch(t, /kontaktOptions|firmaOptions|firmen\.map|kontakte\.map/, datei)
  }
})

test('Warenwirtschaft-Formular: gewählter Käufer geht in die FormData, der jeweils andere wird geleert', () => {
  const t = lies(WH_FORM)
  assert.match(t, /fd\.set\('firma_id', kaeuferTyp === 'firma' \? firmaId : ''\)/)
  assert.match(t, /fd\.set\('kontakt_id', kaeuferTyp === 'kontakt' \? kontaktId : ''\)/)
  // Bearbeiten belegt vor, Neu leert
  assert.match(t, /setFirmaId\(v\.firma_id \?\? ''\); setKontaktId\(v\.kontakt_id \?\? ''\)/)
  assert.match(t, /setFirmaId\(''\); setKontaktId\(''\)/)
})

test('Jahrgangsseite: FormData nimmt den gewählten Käufer wie bisher aus dem Zustand', () => {
  const t = lies(LESE_FORM)
  assert.match(t, /if \(kontaktId\) fd\.append\('kontakt_id', kontaktId\)/)
  assert.match(t, /if \(firmaId\) fd\.append\('firma_id', firmaId\)/)
  assert.match(t, /onChange=\{id => setFirma\(id\)\}/)
  assert.match(t, /onChange=\{id => setKontakt\(id\)\}/)
})

test('Suche: Betriebsnummer im Treffer, Vorbelegung auch inaktiv, Firmen wortweise', () => {
  const t = lies(SUCHE)
  assert.match(t, /const K_SPALTEN = '[^']*\bbetrieb_nr\b/)
  assert.match(t, /const F_SPALTEN = '[^']*\bbetrieb_nr\b/)
  assert.match(t, /betrNr\(k\)/)
  assert.match(t, /betrNr\(f\)/)
  // aktiv nur ohne ids (Suche), nicht bei der Vorbelegung
  assert.doesNotMatch(t, /select\([KF]_SPALTEN\)\.eq\('tenant_id', tenantId\)\.eq\('aktiv', true\)/)
  assert.equal((t.match(/if \(ids\.length\) query = query\.in\('id', ids\)[^\n]*\n\s*else \{\n\s*query = query\.eq\('aktiv', true\)/g) ?? []).length, 2)
  // jedes Wort einzeln – wie die Listensuche (#236)
  assert.match(t, /for \(const w of suchWoerter\(q\)\) query = query\.or\(`name\.ilike/)
  assert.doesNotMatch(t, /query\.or\(`name\.ilike\.%\$\{q\}%/)
})
