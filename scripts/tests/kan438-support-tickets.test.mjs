// KAN-438 (12.11.2026): Support-Anfragen aller Betriebe des Benutzers in der Darstellung der Hohenstein Suite.
// Bisher: nur die eigenen Anfragen (Nummer, Betreff, Status, Datum) unter System › Support. Jetzt: alle Anfragen der
// Betriebe des Benutzers mit Typ, Betrieb/Melder, Status nach Phase, Priorität, Bearbeiter, Erstellt, Fällig (SLA) –
// auch als Karte auf der Übersicht. Entscheidungen Jörgen: 1A, 2B (alle Mitglieder sehen alle Anfragen ihres Betriebs),
// 3A, 4A, 5A. Kern der Tests: die Mandantentrennung über die Mandanten-ID der Anfrage.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  alterText, darfSehen, istUeberfaellig, offeneAnfragen, phaseAus, prioritaetHoch, slaAus, tenantAusBeschreibung, ticketAus,
} from '../../src/lib/support/tickets.ts'
import { WIDGETS, STANDARD_LAYOUT } from '../../src/lib/dashboard/widgets.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'   // eigener Betrieb
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'   // zweiter eigener Betrieb
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff'   // fremder Betrieb
const ICH = { accountId: 'acc-ich', betriebe: new Map([[A, 'Weingut A'], [B, 'Weingut B']]) }
const FELDER = { sla: 'customfield_10107', anfragetyp: 'customfield_10010' }
const beschreibung = (id, name = 'Weingut') => `Etwas geht nicht.\n\n----\nBetrieb: ${name} (${id})\nBenutzer: Karin`
const issue = (teil = {}) => ({ key: 'SUP-4', fields: {
  summary: 'Transfergebinde', status: { name: 'Wartet auf Support', statusCategory: { key: 'indeterminate' } }, issuetype: { name: '[System] Service request' },
  priority: { name: 'Medium' }, assignee: { displayName: 'Jörgen Vöhringer' }, reporter: { accountId: 'acc-kollegin', displayName: 'Karin K.' },
  created: '2026-11-12T09:30:00.000+0100', duedate: null, resolutiondate: null, description: beschreibung(A, 'Weingut A'),
  customfield_10010: { requestType: { name: 'Wunsch/Idee' } },
  customfield_10107: { ongoingCycle: { breachTime: { iso8601: '2026-11-20T17:00:00+0100' }, breached: false, paused: false } },
  ...teil,
} })

describe('KAN-438: Mandantentrennung', () => {
  test('Mandanten-ID aus dem Kontextblock – Text und Atlassian Document Format', () => {
    assert.equal(tenantAusBeschreibung(beschreibung(A)), A)
    assert.equal(tenantAusBeschreibung(`Betrieb: Spaetrot (${A.toUpperCase()}) – Submandant von Gebeshuber`), A)
    assert.equal(tenantAusBeschreibung({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Betrieb: Weingut A (${A})` }] }] }), A)
    assert.equal(tenantAusBeschreibung('Betrieb: ohne ID'), null)
    assert.equal(tenantAusBeschreibung(null), null)
    // eine UUID irgendwo im Text ist keine Zuordnung – nur die Zeile „Betrieb: … (<id>)“
    assert.equal(tenantAusBeschreibung(`Mein Auftrag ${A} klemmt`), null)
  })
  test('sichtbar: eigene Anfrage immer; fremde nur über die Mandanten-ID eines eigenen Betriebs', () => {
    assert.equal(darfSehen({ melderAccountId: 'acc-ich', tenantId: null }, ICH), true)       // eigene, ohne Mandanten-ID (z. B. per E-Mail)
    assert.equal(darfSehen({ melderAccountId: 'acc-kollegin', tenantId: A }, ICH), true)      // Kollegin im eigenen Betrieb (2B)
    assert.equal(darfSehen({ melderAccountId: 'acc-kollegin', tenantId: B }, ICH), true)      // zweiter eigener Betrieb (3A)
    assert.equal(darfSehen({ melderAccountId: 'acc-fremd', tenantId: F }, ICH), false)        // fremder Betrieb
    assert.equal(darfSehen({ melderAccountId: 'acc-fremd', tenantId: null }, ICH), false)     // ohne Mandanten-ID nur der Melder
    assert.equal(darfSehen({ melderAccountId: null, tenantId: null }, { accountId: null, betriebe: new Map() }), false)
    assert.equal(darfSehen({ melderAccountId: 'acc-x', tenantId: A }, { accountId: null, betriebe: ICH.betriebe }), true)   // noch kein Jira-Konto
  })
  test('gleicher Organisationsname gibt keinen Zugriff: fremde Anfrage wird verworfen, auch wenn Jira sie liefert', () => {
    assert.equal(ticketAus(issue({ description: beschreibung(F, 'Weingut A'), reporter: { accountId: 'acc-fremd', displayName: 'Fremd' } }), ICH, FELDER), null)
    assert.equal(ticketAus(issue({ description: 'ohne Kontextblock', reporter: { accountId: 'acc-fremd' } }), ICH, FELDER), null)
  })
  test('der Betriebsname kommt aus software:112, nicht aus dem Text der Anfrage', () => {
    const t = ticketAus(issue({ description: beschreibung(A, 'Gefälschter Name') }), ICH, FELDER)
    assert.equal(t.betrieb, 'Weingut A')
    assert.equal(t.tenantId, A)
  })
})

describe('KAN-438: Ticket wie in der Hohenstein Suite', () => {
  test('alle Spalten: Typ aus dem Anfragetyp, Phase, Priorität, Bearbeiter, Melder, SLA', () => {
    assert.deepEqual(ticketAus(issue(), ICH, FELDER), {
      key: 'SUP-4', betreff: 'Transfergebinde', typ: 'Wunsch/Idee', status: 'Wartet auf Support', phase: 'wartet_support', erledigt: false,
      prioritaet: 'Medium', bearbeiter: 'Jörgen Vöhringer', melder: 'Karin K.', betrieb: 'Weingut A', tenantId: A, eigene: false,
      erstellt: '2026-11-12T09:30:00.000+0100', sla: { faellig: '2026-11-20T17:00:00+0100', verletzt: false, pausiert: false }, faellig: null, erledigtAm: null,
    })
    const eigene = ticketAus(issue({ reporter: { accountId: 'acc-ich', displayName: 'Ich' }, description: 'per E-Mail', assignee: null, customfield_10010: null }), ICH, FELDER)
    assert.deepEqual([eigene.eigene, eigene.betrieb, eigene.bearbeiter, eigene.typ], [true, null, null, 'Service request'])
    const fertig = ticketAus(issue({ status: { name: 'Gelöst', statusCategory: { key: 'done' } }, resolutiondate: '2026-11-13T10:00:00.000+0100' }), ICH, FELDER)
    assert.deepEqual([fertig.phase, fertig.erledigt, fertig.sla], ['erledigt', true, null])
  })
  test('Phase aus Statusname und Kategorie', () => {
    assert.equal(phaseAus('Wartet auf Support', 'indeterminate'), 'wartet_support')
    assert.equal(phaseAus('In Arbeit', 'indeterminate'), 'in_arbeit')
    assert.equal(phaseAus('Wartet auf Kunde', 'indeterminate'), 'wartet_kunde')
    assert.equal(phaseAus('Offen', 'new'), 'wartet_support')
    assert.equal(phaseAus('Gelöst', 'done'), 'erledigt')
  })
  test('SLA und Überfälligkeit', () => {
    assert.equal(slaAus(null), null)
    assert.equal(slaAus({ completedCycles: [] }), null)
    const jetzt = new Date('2026-11-21T08:00:00+01:00')
    const sla = f => ({ erledigt: false, sla: { faellig: '2026-11-20T17:00:00+01:00', verletzt: false, pausiert: false, ...f }, faellig: null })
    assert.equal(istUeberfaellig(sla({}), jetzt, '2026-11-21'), true)
    assert.equal(istUeberfaellig(sla({ pausiert: true }), jetzt, '2026-11-21'), false)        // pausiert (wartet auf Kunde) läuft nicht ab
    assert.equal(istUeberfaellig(sla({ pausiert: true, verletzt: true }), jetzt, '2026-11-21'), true)
    assert.equal(istUeberfaellig(sla({}), new Date('2026-11-20T10:00:00+01:00'), '2026-11-20'), false)
    assert.equal(istUeberfaellig({ erledigt: true, sla: null, faellig: '2026-01-01' }, jetzt, '2026-11-21'), false)
    assert.equal(istUeberfaellig({ erledigt: false, sla: null, faellig: '2026-11-20' }, jetzt, '2026-11-21'), true)
    assert.equal(istUeberfaellig({ erledigt: false, sla: null, faellig: '2026-11-21' }, jetzt, '2026-11-21'), false)
  })
  test('Alter auf Kalendertagen, Priorität, Karte der offenen Anfragen', () => {
    assert.equal(alterText('2026-11-12', '2026-11-12'), 'heute')
    assert.equal(alterText('2026-11-11', '2026-11-12'), 'gestern')
    assert.equal(alterText('2026-10-20', '2026-10-30'), 'vor 10 Tagen')   // über die Zeitumstellung
    assert.equal(alterText('', '2026-11-12'), 'heute')
    assert.equal(prioritaetHoch('Highest'), true)
    assert.equal(prioritaetHoch('Medium'), false)
    assert.equal(prioritaetHoch(null), false)
    const liste = Array.from({ length: 8 }, (_, i) => ({ key: `SUP-${i}`, erledigt: i % 4 === 0 }))
    const o = offeneAnfragen(liste)
    assert.equal(o.offen, 6)
    assert.deepEqual(o.zeilen.map(t => t.key), ['SUP-1', 'SUP-2', 'SUP-3', 'SUP-5', 'SUP-6'])
  })
})

describe('KAN-438: Verdrahtung', () => {
  test('Jira-Suche: grob über Melder bzw. bekannte Organisationen – gezeigt wird nur, was ticketAus durchlässt', () => {
    const j = quelle('src/lib/support/jsm.ts')
    const f = j.slice(j.indexOf('export async function betriebsAnfragen'), j.indexOf('export async function anfrageSichtbar'))
    assert.match(f, /teile\.push\(`reporter = \$\{jqlString\(z\.accountId\)\}`\)/)
    assert.match(f, /const bekannt = z\.organisationen\.filter\(n => namen\.has\(n\)\)/)
    assert.match(f, /organizations in \(\$\{bekannt\.map\(jqlString\)\.join\(', '\)\}\)/)
    assert.match(f, /if \(teile\.length === 0\) return \[\]/)
    assert.match(f, /const t = ticketAus\(i, z, \{ sla: FELD_SLA, anfragetyp: FELD_ANFRAGETYP \}\)\s+if \(t\) tickets\.push\(t\)/)
    assert.match(f, /project = SUP AND \(/)
    // das Token bleibt serverseitig
    assert.match(j, /^import 'server-only'/)
  })
  test('Verlauf und Antwort: dieselbe Sichtbarkeitsregel wie die Liste, vor jedem Zugriff', () => {
    const j = quelle('src/lib/support/jsm.ts')
    const s = j.slice(j.indexOf('export async function anfrageSichtbar'), j.indexOf('// ── KAN-235'))
    assert.match(s, /if \(String\(f\.project\?\.key \?\? ''\) !== 'SUP'\) return false/)
    assert.match(s, /return darfSehen\(\{ melderAccountId: .*tenantId: tenantAusBeschreibung\(f\.description\) \}, z\)/)
    const d = j.slice(j.indexOf('export async function anfrageDetail'))
    assert.ok(d.indexOf('if (!(await anfrageSichtbar(key, z))) return null') < d.indexOf('/rest/servicedeskapi/request/'), 'erst prüfen, dann laden')
    const r = quelle('src/app/api/support/anfragen/[key]/route.ts')
    const post = r.slice(r.indexOf('export async function POST'))
    assert.ok(post.indexOf('const detail = await anfrageDetail(zugriff, key)') < post.indexOf('antwortSenden('), 'erst prüfen, dann antworten')
    assert.match(post, /if \(!detail\) return nichtGefunden\(\)/)
  })
  test('Zugriff: aktive Mitgliedschaften des Benutzers, Betriebsnamen aus software:112, Fehler führen zum Abbruch', () => {
    const k = quelle('src/lib/support/kontext.ts')
    const f = k.slice(k.indexOf('export async function supportZugriff'))
    assert.match(f, /\.select\('tenant_id'\)\.eq\('user_id', userId\)\.eq\('aktiv', true\)/)
    assert.match(f, /if \(mErr\) throw new AktionsFehler/)
    assert.match(f, /if \(tErr\) throw new AktionsFehler/)
    assert.match(f, /if \(hErr\) throw new AktionsFehler/)
    assert.match(f, /betriebe\.set\(String\(x\.id\)\.toLowerCase\(\), name\)/)
    assert.match(f, /organisationen\.add\(supportOrganisation\(name, /)
    const liste = quelle('src/app/api/support/anfragen/route.ts')
    assert.match(liste, /betriebsAnfragen\(await supportZugriff\(k\.user\.id, k\.user\.email!\)\)/)
    assert.match(liste, /const zweiFaktor = await pruefeZweiFaktor\(\)\s+if \(zweiFaktor\) return zweiFaktor/)
  })
  test('Support-Seite: Tabelle mit allen Spalten, Karten am Handy, Verlauf je Zeile', () => {
    const t = quelle('src/components/support/SupportTickets.tsx')
    const koepfe = [...t.matchAll(/<th className="px-3 py-2 font-semibold">([^<]+)<\/th>/g)].map(x => x[1])
    assert.deepEqual(koepfe, ['Ticket', 'Betrieb', 'Status', 'Priorität', 'Bearbeiter', 'Erstellt', 'Fällig (SLA)'])
    assert.match(t, /<div className="hidden md:block overflow-x-auto">/)
    assert.match(t, /<ul className="md:hidden divide-y divide-s112-line">/)
    assert.match(t, /aria-expanded=\{offen === t\.key\}/)
    const s = quelle('src/app/(dashboard)/hilfe/support/SupportAnfrage.tsx')
    assert.match(s, /<h2 className="text-base font-semibold text-s112-text">Support-Anfragen<\/h2>/)
    assert.match(s, /verlauf=\{t => <AnfrageVerlauf anfrageKey=\{t\.key\} onGeaendert=\{laden\} \/>\}/)
    assert.doesNotMatch(s, /Meine Anfragen/)
  })
  test('Übersicht: Widget im Standard, lädt selbst nach und zeigt bei Jira-Ausfall einen Hinweis', () => {
    const w = WIDGETS.find(x => x.id === 'support-anfragen')
    assert.deepEqual([w.titel, w.bereich, w.groesse, [...w.quellen]], ['Support-Anfragen', 'uebersicht', 'breit', []])
    assert.ok(STANDARD_LAYOUT.some(e => e.id === 'support-anfragen'))
    assert.match(quelle('src/app/(dashboard)/dashboard/_widgets/index.tsx'), /'support-anfragen': SupportAnfragenWidget,/)
    const k = quelle('src/components/support/SupportAnfragenKarte.tsx')
    assert.match(k, /^'use client'/)
    assert.match(k, /fetch\('\/api\/support\/anfragen', \{ cache: 'no-store' \}\)/)
    assert.match(k, /if \(!r\.ok\) throw new Error/)
    assert.match(k, /Die Support-Anfragen sind gerade nicht abrufbar/)
    assert.match(k, /offeneAnfragen\(stand\?\.anfragen \?\? \[\]\)/)
  })
})
