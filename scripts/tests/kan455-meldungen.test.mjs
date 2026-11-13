// KAN-455 (13.11.2026): Rollen/Rechte R3, Teil Behördenmeldungen und Benachrichtigungen.
// Befund: zugriffsFehler ließ jeden Mitarbeiter – also auch einen mit Profil „Extern“ – alle Pflichtmeldungen als CSV
// exportieren (UVA, E&A-Journal, Kellerbuch …); eine CRM-Aufgabe ging mit Titel und Text per App und Mail auch an
// Empfänger, die das CRM nicht lesen dürfen. Neu: Lesebereich je Meldung (Gruppe bzw. Feld `bereich`) in
// zugriffsFehler; Benachrichtigungen nur an Empfänger mit Leserecht.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LESEBEREICHE, canRead } from '../../src/lib/auth/lesebereiche.ts'
import { GRUPPEN_BEREICH, meldungsBereich } from '../../src/lib/behoerden/bereich.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

/** Alle Katalog-Einträge aus den Quelltexten: [{ id, gruppe, bereich? }] */
function katalog() {
  const dir = path.join('src', 'lib', 'behoerden', 'katalog')
  const eintraege = []
  for (const datei of readdirSync(path.join(WURZEL, dir)).filter(d => d.endsWith('.ts'))) {
    const text = quelle(path.join(dir, datei))
    const gruppe = /katalogGruppe\('([a-z]+)'/.exec(text)?.[1]
    assert.ok(gruppe, `${datei}: katalogGruppe`)
    for (const m of text.matchAll(/^ {2}(?:'([a-z0-9-]+)'|([a-z0-9]+)): \{\n((?: {4}.*\n)*)/gm)) {
      const bereich = /^ {4}bereich: '([a-z]+)'/m.exec(m[3])?.[1]
      eintraege.push({ id: m[1] ?? m[2], gruppe, ...(bereich ? { bereich } : {}) })
    }
  }
  return eintraege
}
const KATALOG = katalog()
const bereichVon = id => meldungsBereich(KATALOG.find(e => e.id === id))
const darf = (profil, id) => canRead({ role: 'winzer', profil }, bereichVon(id))

describe('KAN-455: Lesebereich je Behördenmeldung', () => {
  test('jede Gruppe hat einen Bereich der Liste – nie „allgemein“', () => {
    assert.deepEqual(Object.keys(GRUPPEN_BEREICH).sort(), [...new Set(KATALOG.map(e => e.gruppe))].sort())
    for (const b of Object.values(GRUPPEN_BEREICH)) {
      assert.ok(LESEBEREICHE.includes(b), b)
      assert.notEqual(b, 'allgemein')
    }
  })
  test('der Katalog ist vollständig gelesen und jeder Eintrag hat einen gültigen Bereich', () => {
    assert.ok(KATALOG.length >= 55, `nur ${KATALOG.length} Einträge gelesen`)
    assert.equal(new Set(KATALOG.map(e => e.id)).size, KATALOG.length)
    for (const e of KATALOG) assert.ok(LESEBEREICHE.includes(meldungsBereich(e)) && meldungsBereich(e) !== 'allgemein', e.id)
  })
  test('abweichende Bereiche stehen am Eintrag', () => {
    assert.deepEqual(KATALOG.filter(e => e.bereich).map(e => `${e.id}=${e.bereich}`).sort(), [
      'aenderungsprotokoll=verwaltung', 'bestandsmeldung=keller', 'bsm-kontrolljournal=keller', 'bsm=keller', 'dac-antraege=keller',
      'pruefnummernantrag=keller', 'transportbescheinigung=lager', 'transportbescheinigungen=lager',
    ])
  })
  test('Extern exportiert keine Meldung außer dem Flächenverzeichnis seiner Rieden', () => {
    assert.deepEqual(KATALOG.filter(e => darf('extern', e.id)).map(e => e.id), ['flaechenverzeichnis'])
    for (const id of ['psm-aufzeichnung', 'cu-bilanz', 'uva', 'weinbuch', 'erntemeldung', 'rueckverfolgung-weingarten']) assert.equal(darf('extern', id), false, id)
  })
  test('Vertrieb: Weinverkehr und Lager – nicht Buchhaltung, Kellerbuch, Ernte, Pflanzenschutz', () => {
    assert.deepEqual(KATALOG.filter(e => darf('vertrieb', e.id)).map(e => e.id).sort(),
      ['emcs-datenblatt', 'exportauftraege', 'exportauftrag', 'transportbescheinigung', 'transportbescheinigungen', 'zusammenfassende-meldung'])
    for (const id of ['uva', 'rechnungsausgangsjournal', 'kassabuch', 'weinbuch', 'bki-verkauf', 'bsm', 'erntemeldung', 'psm-aufzeichnung', 'aenderungsprotokoll']) {
      assert.equal(darf('vertrieb', id), false, id)
    }
  })
  test('ohne Profil ändert sich nichts: jede Rolle liest jeden Meldungsbereich', () => {
    for (const role of ['system_admin', 'tenant_admin', 'winzer', 'leser']) for (const e of KATALOG) assert.equal(canRead({ role }, meldungsBereich(e)), true, `${role} ${e.id}`)
  })
  test('unbekannte Gruppe: gesperrt für jedes Profil (Bereich verwaltung)', () => {
    assert.equal(meldungsBereich({ gruppe: 'neu' }), 'verwaltung')
  })
})

describe('KAN-455: zugriffsFehler prüft den Lesebereich', () => {
  const z = quelle('src/lib/behoerden/zugriff.ts')
  test('nach den Modulen, vor der Rolle – mit eigener Meldung', () => {
    const modul = z.indexOf('ist für diesen Betrieb nicht freigeschaltet.')
    const lese = z.indexOf('if (!canRead(membership, meldungsBereich(e))) return LESE_MELDUNG_MELDUNG')
    const rolle = z.indexOf('switch (e.zugriff)')
    assert.ok(modul > 0 && lese > modul && rolle > lese)
    assert.match(z, /LESE_MELDUNG_MELDUNG = 'Für diese Meldung fehlt dir das Leserecht\.'/)
  })
  test('alle Wege laufen über zugriffsFehler: CSV-Route, Übersichten, BKI-Schnittstelle', () => {
    assert.match(quelle('src/app/(dashboard)/meldungen/[meldung]/csv/route.ts'), /zugriffsFehler\(meldung, membership, module\)/)
    assert.match(z, /KATALOG_LISTE\.filter\(e => zugriffsFehler\(e, membership, module\) === null\)/)
    assert.match(quelle('src/lib/behoerden/bki-schnittstelle-laden.ts'), /zugriffsFehler\(m, ctx\.membership, ctx\.module\)/)
  })
})

describe('KAN-455: Benachrichtigungen nur mit Leserecht', () => {
  const b = quelle('src/lib/benachrichtigungen/server.ts')
  test('CRM-Aufgaben und -Termine tragen den Bereich crm', () => {
    assert.match(b, /quelleTyp: 'aktivitaet', quelleId: a\.id, bereich: 'crm' as const/)
  })
  test('Empfänger werden vor beiden Kanälen gefiltert; ohne Bereich wie bisher', () => {
    assert.match(b, /const empfaenger = e\.bereich \? await nurMitLeserecht\(e\.tenantId, alle, e\.bereich\) : alle\n {2}if \(empfaenger\.length === 0\) return/)
    assert.ok(b.indexOf('nurMitLeserecht(e.tenantId') < b.indexOf('// ── Kanal App ──'))
  })
  test('Leserecht aus Rolle und Profil der Mitgliedschaft im Betrieb; bei Lesefehler an niemanden', () => {
    assert.match(b, /\.select\('user_id, role, profil'\)\.eq\('tenant_id', tenantId\)\.in\('user_id', empfaenger\)/)
    assert.match(b, /canRead\(\{ role: m\.role, profil: m\.profil \}, bereich\)/)
    assert.match(b, /if \(error\) \{ console\.error\('benachrichtigungen \(leserecht\):', error\.message\); return \[\] \}/)
  })
})
