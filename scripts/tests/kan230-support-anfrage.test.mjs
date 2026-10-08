// KAN-230 Phase 2 (08.10.2026): Support-Anfrage aus software:112 an Jira Service Management – Anfragearten
// (Premium-Support nur mit aktivem Paket), Eingabeprüfung inkl. Screenshot-Zustimmung, Kontextblock ohne
// Geheimnisse, Seite ohne Query, Rate-Limit, JQL-Quoting und die Verdrahtung der Route (2FA, Seiten-Betrieb,
// Token nur serverseitig).
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const a = hooksMoeglich ? await laden('lib/support/anfrage.ts') : null

const gut = { art: 'fehler', betreff: 'Füllung speichert nicht', beschreibung: 'Beim Speichern kommt ein Fehler.', dringlichkeit: 'normal' }

describe('KAN-230 Anfragearten', nurMitHooks, () => {
  test('Premium-Support nur mit aktivem Paket, dann zuerst', () => {
    assert.deepEqual(a.erlaubteArten(false), ['fehler', 'wunsch', 'frage'])
    assert.deepEqual(a.erlaubteArten(true), ['premium', 'fehler', 'wunsch', 'frage'])
  })
  test('Namen der Anfragetypen in SUP (Queue und SLA filtern auf „Premium-Support“)', () => {
    assert.equal(a.ANFRAGE_ARTEN.premium.name, 'Premium-Support')
    assert.equal(a.ANFRAGE_ARTEN.fehler.name, 'Fehler melden')
    assert.equal(a.ANFRAGE_ARTEN.wunsch.name, 'Wunsch/Idee')
    assert.equal(a.ANFRAGE_ARTEN.frage.name, 'Frage')
  })
})

describe('KAN-230 Eingabeprüfung', nurMitHooks, () => {
  test('gültige Anfrage', () => {
    assert.equal(a.anfrageEingabeFehler(gut, false), null)
    assert.equal(a.anfrageEingabeFehler({ ...gut, art: 'premium' }, true), null)
  })
  test('Premium ohne Paket abgelehnt, unbekannte Art abgelehnt', () => {
    assert.match(a.anfrageEingabeFehler({ ...gut, art: 'premium' }, false), /Anfrageart/)
    assert.match(a.anfrageEingabeFehler({ ...gut, art: 'x' }, true), /Anfrageart/)
  })
  test('Betreff, Beschreibung, Dringlichkeit', () => {
    assert.match(a.anfrageEingabeFehler({ ...gut, betreff: ' a ' }, false), /Betreff/)
    assert.match(a.anfrageEingabeFehler({ ...gut, betreff: 'x'.repeat(201) }, false), /höchstens 200/)
    assert.match(a.anfrageEingabeFehler({ ...gut, beschreibung: 'kurz' }, false), /mindestens 10/)
    assert.match(a.anfrageEingabeFehler({ ...gut, dringlichkeit: 'sofort' }, false), /Dringlichkeit/)
  })
  test('Screenshot nur mit Zustimmung, nur Bilder, höchstens 5 MB', () => {
    const bild = { typ: 'image/png', groesse: 1000 }
    assert.match(a.anfrageEingabeFehler({ ...gut, screenshot: bild }, false), /bestätigen/)
    assert.equal(a.anfrageEingabeFehler({ ...gut, screenshot: bild, screenshotZustimmung: true }, false), null)
    assert.match(a.anfrageEingabeFehler({ ...gut, screenshot: { typ: 'application/pdf', groesse: 1 }, screenshotZustimmung: true }, false), /PNG/)
    assert.match(a.anfrageEingabeFehler({ ...gut, screenshot: { typ: 'image/png', groesse: 5 * 1024 * 1024 + 1 }, screenshotZustimmung: true }, false), /5 MB/)
  })
})

describe('KAN-230 Kontext', nurMitHooks, () => {
  const k = {
    betriebName: 'Weingut Muster', tenantId: 't-1', benutzerName: 'Karin', benutzerEmail: 'k@example.at', rolle: 'winzer',
    seite: '/weinhandel/fuellungen', userAgent: 'Mozilla/5.0\r\nX-Injected: 1', appVersion: 'abc1234', zeitpunkt: '08.10.2026, 12:00:00',
  }
  test('Text des Benutzers zuerst, danach Kontextblock', () => {
    const b = a.beschreibungMitKontext('  Es geht nicht.  ', k)
    assert.ok(b.startsWith('Es geht nicht.\n\n----\nGemeldet aus software:112'))
    assert.match(b, /Betrieb: Weingut Muster \(t-1\)/)
    assert.match(b, /Benutzer: Karin <k@example\.at>, Rolle: winzer/)
    assert.match(b, /Seite: \/weinhandel\/fuellungen/)
    assert.match(b, /App-Version: abc1234/)
  })
  test('User-Agent ohne Zeilenumbrüche (keine eingeschleusten Zeilen)', () => {
    const b = a.beschreibungMitKontext('Text lang genug', k)
    assert.match(b, /Browser: Mozilla\/5\.0 X-Injected: 1\n/)
  })
  test('Seite nur als Pfad – Query und Fragment fallen weg', () => {
    assert.equal(a.seiteBereinigen('/crm/kontakte?suche=Huber&token=x#a'), '/crm/kontakte')
    assert.equal(a.seiteBereinigen('https://software112.icp-consultants.at/kellerbuch?x=1'), '/kellerbuch')
    assert.equal(a.seiteBereinigen(''), null)
    assert.equal(a.seiteBereinigen(null), null)
  })
})

describe('KAN-230 Rate-Limit, Priorität, JQL', nurMitHooks, () => {
  test('ab 5 Anfragen in 10 Minuten gesperrt', () => {
    assert.equal(a.rateLimitFehler(4), null)
    assert.match(a.rateLimitFehler(5), /10 Minuten bereits 5/)
  })
  test('Dringlichkeit → Jira-Priorität', () => {
    assert.equal(a.DRINGLICHKEITEN.niedrig.prioritaet, 'Low')
    assert.equal(a.DRINGLICHKEITEN.normal.prioritaet, 'Medium')
    assert.equal(a.DRINGLICHKEITEN.hoch.prioritaet, 'High')
  })
  test('JQL-Werte werden gequotet', () => {
    assert.equal(a.jqlString('abc'), '"abc"')
    assert.equal(a.jqlString('a"b\\c'), '"a\\"b\\\\c"')
  })
  test('Portal-Link auf SUP', () => {
    assert.equal(a.portalLink('SUP-7'), 'https://jorgena.atlassian.net/servicedesk/customer/portal/1/SUP-7')
  })
})

describe('KAN-230 Verdrahtung', () => {
  const route = quelle('src/app/api/support/anfragen/route.ts')
  test('GET und POST beginnen mit der Zwei-Faktor-Prüfung, POST prüft den Seiten-Betrieb', () => {
    for (const m of ['GET', 'POST']) {
      const f = route.slice(route.indexOf(`export async function ${m}`))
      assert.match(f.slice(0, 200), /const zweiFaktor = await pruefeZweiFaktor\(\)\s+if \(zweiFaktor\) return zweiFaktor/)
    }
    assert.match(route.slice(route.indexOf('export async function POST')), /seitenBetriebKonflikt\(k\.membership\.tenantId\)/)
  })
  test('Premium-Support kommt aus dem Kennzeichen am Betrieb, nicht vom Client', () => {
    assert.match(route, /premiumSupportAktiv\(/)
    assert.match(route, /anfrageEingabeFehler\(eingabe, k\.premium\)/)
  })
  test('Token nur serverseitig: jsm.ts ist server-only, kein NEXT_PUBLIC_JSM', () => {
    const jsm = quelle('src/lib/support/jsm.ts')
    assert.ok(jsm.startsWith("import 'server-only'"))
    assert.doesNotMatch(jsm + route, /NEXT_PUBLIC_JSM/)
    assert.doesNotMatch(quelle('src/app/(dashboard)/hilfe/support/SupportAnfrage.tsx'), /JSM_API|lib\/support\/jsm/)
  })
  test('Support-Seite zeigt das Formular nur mit Konfiguration', () => {
    assert.match(quelle('src/app/(dashboard)/hilfe/support/page.tsx'), /jsmKonfiguriert\(\) && <SupportAnfrage/)
  })
})
