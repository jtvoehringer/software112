// KAN-332 (13.10.2026) – Journal: wer hat wann in welchem Bereich was gebucht. Mitarbeiter sehen ihre eigenen Vorgänge,
// die Betriebsleitung alle; Anlage, Änderung, Storno, Löschung; Druck und CSV mit denselben Filtern.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const j = () => laden('lib/journal/journal.ts')

describe('KAN-332: Aktion, Bereich, Beschreibung', nurMitHooks, () => {
  test('Aktion: Anlage, Änderung, Storno (storniert_am bzw. storniert gesetzt), Löschung', async () => {
    const { aktionDerZeile } = await j()
    assert.equal(aktionDerZeile('INSERT', null, null), 'anlage')
    assert.equal(aktionDerZeile('DELETE', null, null), 'loeschung')
    assert.equal(aktionDerZeile('UPDATE', ['notizen'], { notizen: 'x' }), 'aenderung')
    assert.equal(aktionDerZeile('UPDATE', ['storniert_am', 'storno_grund'], { storniert_am: '2026-10-13T08:00:00Z' }), 'storno')
    assert.equal(aktionDerZeile('UPDATE', ['storniert'], { storniert: true }), 'storno')
    // Storno aufgehoben bzw. nur Grund geändert: Änderung
    assert.equal(aktionDerZeile('UPDATE', ['storniert_am'], { storniert_am: null }), 'aenderung')
  })
  test('jede Protokoll-Tabelle hat einen Bereich und eine Bezeichnung', async () => {
    const { bereichDerTabelle, TABELLE_LABEL } = await j()
    for (const t of ['weinausbau', 'keller_umzuege', 'fuellungen', 'verkaufsposten', 'ea_transaktionen', 'behandlungen', 'psm_lager_bewegungen',
      'lesen', 'rechnungen', 'transportbescheinigungen', 'exportauftraege', 'weinanalysen', 'betriebsmittel', 'pressungen', 'zahlungen']) {
      assert.ok(bereichDerTabelle(t), t)
      assert.ok(TABELLE_LABEL[t], t)
    }
    assert.equal(bereichDerTabelle('weinausbau').key, 'kellerbuch')
    assert.equal(bereichDerTabelle('verkaufsposten').key, 'warenwirtschaft')
    assert.equal(bereichDerTabelle('kontakte'), null)
  })
  test('Beschreibung aus der Kennung: Name, Datum, Menge, Betrag', async () => {
    const { beschreibung } = await j()
    assert.equal(beschreibung({ name: 'GV 2025', menge_liter: 1200.5, status: 'ausbau' }), 'GV 2025 · 1.200,5 L')
    assert.equal(beschreibung({ rechnungsnummer: 'R-2026-0042', datum: '2026-10-12', transaktions_nr: 'T-7' }), 'R-2026-0042 · 12.10.2026')
    assert.equal(beschreibung({ beschreibung: 'Diesel', datum: '2026-10-01', betrag_brutto: 89.9, betrag_netto: 74.92 }), 'Diesel · 01.10.2026 · € 89,9')
    assert.equal(beschreibung({ jahr: 2026, monat: 9 }), '09/2026')
    assert.equal(beschreibung({ lfd_nr: 2, art: 'Eiswein' }), 'Nr. 2')
    assert.equal(beschreibung(null), '–')
    // ältere Zeilen ohne Kennung: aus alt/neu
    assert.equal(beschreibung(null, { name: 'Tank 3 alt' }, null), 'Tank 3 alt')
  })
  test('Link nur zu bestehenden Seiten und nie bei Löschungen', async () => {
    const { journalLink } = await j()
    assert.equal(journalLink('weinausbau', 'a1', 'anlage'), '/kellerbuch/weinausbau/a1')
    assert.equal(journalLink('verkaufsposten', 'v1', 'storno'), '/weinhandel/verkauf/v1')
    assert.equal(journalLink('weinausbau', 'a1', 'loeschung'), null)
    assert.equal(journalLink('keller_umzuege', 'u1', 'anlage'), null)
    assert.equal(journalLink('weinausbau', null, 'anlage'), null)
    const D = 'src/app/(dashboard)'
    for (const [t, pfad] of [['weinausbau', 'kellerbuch/weinausbau/[id]'], ['verkaufsposten', 'weinhandel/verkauf/[id]'],
      ['rechnungen', 'weinhandel/rechnungen/[id]'], ['fuellungen', 'weinhandel/fuellungen/[id]/edit'], ['zukauf_posten', 'weinhandel/zukauf/[id]/edit'],
      ['behandlungen', 'behandlungen/[id]/edit'], ['weingarten', 'weingarten/[id]'], ['dac_antrag', 'dac/[id]'], ['ea_belege', 'buchhaltung/belege/[id]'],
      ['exportauftraege', 'weinexport/[id]'], ['weinjahrgaenge', 'erntemeldung/[id]']]) {
      assert.ok(journalLink(t, 'x', 'anlage'), t)
      assert.ok(existsSync(new URL(`../../${D}/${pfad}/page.tsx`, import.meta.url)), pfad)
    }
  })
  test('Journalzeilen: Benutzername, System, ehemaliges Mitglied; Aktion filtern', async () => {
    const { journalZeilen, nachAktion } = await j()
    const roh = [
      { id: 3, tabelle: 'weinausbau', datensatz_id: 'c1', aktion: 'INSERT', erstellt_am: '2026-10-13T08:00:00Z', benutzer_id: 'u1', kennung: { name: 'GV' } },
      { id: 2, tabelle: 'verkaufsposten', datensatz_id: 'v1', aktion: 'UPDATE', geaenderte_spalten: ['storniert_am'], neu: { storniert_am: '2026-10-13' }, erstellt_am: '2026-10-13T07:00:00Z', benutzer_id: 'u2', grund: 'Tippfehler', kennung: { rechnungsnummer: 'R-1' } },
      { id: 1, tabelle: 'weingarten', datensatz_id: 'w1', aktion: 'UPDATE', geaenderte_spalten: ['aktiv'], neu: { aktiv: false }, erstellt_am: '2026-10-12T07:00:00Z', benutzer_id: null, kennung: { name: 'Ried 1' } },
    ]
    const z = journalZeilen(roh, new Map([['u1', 'Karin']]))
    assert.deepEqual(z.map(x => [x.aktionText, x.benutzer, x.bereich]), [
      ['Anlage', 'Karin', 'Kellerbuch'], ['Storno', 'ehemaliges Mitglied', 'Füllung & Verkauf'], ['Änderung', 'System', 'Rieden & Maßnahmen']])
    assert.equal(z[1].grund, 'Tippfehler')
    assert.equal(z[2].felder, 'aktiv')
    assert.deepEqual(nachAktion(z, 'storno').map(x => x.id), [2])
    assert.equal(nachAktion(z, null).length, 3)
  })
  test('Filter aus der URL: Standard 30 Tage, ungültige Werte verworfen, Von/Bis getauscht', async () => {
    const { journalFilter, filterParameter, tageZurueck } = await j()
    assert.equal(tageZurueck('2026-03-01', 1), '2026-02-28')
    assert.deepEqual(journalFilter({}, '2026-10-13'), { von: '2026-09-14', bis: '2026-10-13', bereich: null, aktion: null, benutzer: null })
    assert.deepEqual(journalFilter({ von: '2026-10-10', bis: '2026-10-01', bereich: 'ea', aktion: 'storno', benutzer: 'ABCDEF01-2345-4789-8abc-def012345678' }, '2026-10-13'),
      { von: '2026-10-01', bis: '2026-10-10', bereich: 'ea', aktion: 'storno', benutzer: 'abcdef01-2345-4789-8abc-def012345678' })
    assert.deepEqual(journalFilter({ von: 'gestern', bereich: 'x', aktion: 'DROP', benutzer: "1' or 1=1" }, '2026-10-13'),
      { von: '2026-09-14', bis: '2026-10-13', bereich: null, aktion: null, benutzer: null })
    assert.deepEqual(filterParameter({ von: '2026-10-01', bis: '2026-10-10', bereich: null, aktion: 'anlage', benutzer: null }),
      { von: '2026-10-01', bis: '2026-10-10', aktion: 'anlage' })
  })
})

describe('KAN-332: Seite, CSV, Rechte, Navigation', () => {
  const D = 'src/app/(dashboard)'
  test('Seite und CSV nutzen dieselbe Ladefunktion und denselben Filter', () => {
    const seite = quelle(`${D}/dashboard/journal/page.tsx`)
    const route = quelle('src/app/api/export/journal/route.ts')
    for (const s of [seite, route]) {
      assert.match(s, /ladeJournal\(/)
      assert.match(s, /journalFilter\(/)
    }
    assert.match(seite, /<CsvExportKnopf href=\{csvHref\} \/>/)
    assert.match(seite, /<DruckFormatKnopf /)
    assert.match(route, /const zweiFaktor = await pruefeZweiFaktor\(\)\n\s+if \(zweiFaktor\) return zweiFaktor/)
    assert.match(route, /csvDatei\(zeilen, SPALTEN_JOURNAL, PROFIL_EXCEL_AT\)/)
  })
  test('Mitarbeiter nur eigene Vorgänge, Betriebsleitung alle', () => {
    const l = quelle('src/lib/journal/laden.ts')
    assert.match(l, /const benutzerFilter = alleSichtbar \? f\.benutzer : ctx\.userId/)
    assert.match(l, /if \(benutzerFilter\) q = q\.eq\('benutzer_id', benutzerFilter\)/)
    assert.match(l, /\.eq\('tenant_id', ctx\.tenantId\)/)
    assert.match(l, /VERWALTUNG_ROLLEN/)
  })
  test('Reiter „Journal“ auf der Übersicht', () => {
    assert.match(quelle('src/lib/navigation/index.ts'), /\{ href: '\/dashboard\/journal',\s+label: 'Journal'/)
  })
  test('Änderungsprotokoll (Behördenmeldung) bleibt bei Änderungen und Löschungen; gemeinsame Bezeichnungen', () => {
    const a = quelle('src/lib/behoerden/aenderungsprotokoll.ts')
    assert.match(a, /\.in\('aktion', \['UPDATE', 'DELETE'\]\)/)
    assert.match(a, /import \{ TABELLE_LABEL \} from '@\/lib\/journal\/journal'/)
  })
})
