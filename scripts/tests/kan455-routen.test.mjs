// KAN-455 (13.11.2026): Rollen/Rechte R3, Teil API-Routen – Lesebereich je Route.
// Befund: API-Routen laden oft per Service-Role bzw. liefern Dateien, Mails und PDFs – daran hängt keine Sperr-Policy.
// Ein Mitarbeiter mit Profil „Extern“ hätte z. B. das Postfach, Rechnungs-PDFs und den BMD-Export abrufen können.
// Neu: jede Route steht mit ihrem Bereich in scripts/lesebereich-routen.json und ruft leseKonflikt(…) auf (403);
// der Wächter check-lesebereich-routen hält Liste und Code zusammen.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE, canRead } from '../../src/lib/auth/lesebereiche.ts'

const require = createRequire(import.meta.url)
const { pruefe, pruefeRoute, bereicheAus, routen } = require('../check-lesebereich-routen.js')

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const LISTE = JSON.parse(quelle('scripts/lesebereich-routen.json'))
const BEREICHE = Object.keys(JSON.parse(quelle('scripts/lesebereiche.json')).bereiche)
const API = path.join(WURZEL, 'src', 'app', 'api')
const route = r => quelle(path.join('src', 'app', 'api', r, 'route.ts'))
const bereichVon = r => LISTE.routen[r]
/** darf das Profil die Route aufrufen? (Ausnahme = ja) */
const darf = (profil, r) => {
  const e = bereichVon(r)
  if (e && typeof e === 'object' && !Array.isArray(e)) return true
  return (Array.isArray(e) ? e : [e]).every(b => canRead({ role: 'winzer', profil }, b))
}

describe('KAN-455: Stand der Routen', () => {
  test('jede Route unter src/app/api ist eingestuft und geprüft', () => {
    const vorhandene = routen(API)
    assert.deepEqual(pruefe(LISTE, vorhandene, route, BEREICHE), [])
    assert.deepEqual(Object.keys(LISTE.routen).sort(), vorhandene)
  })
  test('im Build eingehängt', () => {
    assert.match(JSON.parse(quelle('package.json')).scripts.prebuild, /node scripts\/check-lesebereich-routen\.js/)
  })
  test('Extern erreicht nur Rieden-Routen und Allgemeines', () => {
    const offen = Object.keys(LISTE.routen).filter(r => typeof bereichVon(r) === 'string' || Array.isArray(bereichVon(r))).filter(r => darf('extern', r))
    assert.deepEqual(offen, ['export/rieden-geo'])
  })
  test('Extern: kein Postfach, keine KI, keine Rechnung, kein Export aus Buchhaltung und CRM', () => {
    for (const r of ['nachrichten/list', 'nachrichten/message', 'email/send', 'm365/send', 'ki-abfrage', 'assistent/chat', 'weinhandel/verkauf/[id]/send',
      'weinhandel/rechnungen/[id]/send', 'export/bmd', 'export/kontakte', 'export/journal', 'buchhaltung/belege/[id]/datei', 'kostenrechnung',
      'behandlungen/uebermittlung', 'weinexport/[id]/nachweis/[nid]', 'crm/suche', 'visitkarte']) {
      assert.ok(r in LISTE.routen, r)
      assert.equal(darf('extern', r), false, r)
    }
  })
  test('Vertrieb: CRM, Verkauf, Lager, Auswertungen und KI – nicht Buchhaltung, Keller, Rieden', () => {
    for (const r of ['nachrichten/list', 'crm/suche', 'weinhandel/verkauf/[id]/send', 'weinexport/[id]', 'export/kontakte', 'export/verkauf', 'export/lager',
      'ki-abfrage', 'kostenrechnung', 'sumup/checkout', 'weinhandel/fuellungen/[id]/bilder', 'reports/umsatz']) assert.equal(darf('vertrieb', r), true, r)
    for (const r of ['export/bmd', 'buchhaltung/belege', 'export/journal', 'reports/weinbuecher', 'export/rieden-geo', 'behandlungen/uebermittlung',
      'assistent/chat']) assert.equal(darf('vertrieb', r), false, r)   // der Assistent arbeitet im Kellerbuch
  })
  test('Ausnahmen: nur Routen ohne Benutzersitzung, im Bereich allgemein oder mit Benutzer-Client unter den Policies', () => {
    const ausnahmen = Object.entries(LISTE.routen).filter(([, e]) => e && typeof e === 'object' && !Array.isArray(e))
    assert.equal(ausnahmen.length, 26)
    for (const [r, e] of ausnahmen) assert.match(e.ausnahme, /ohne Benutzersitzung|Bereich allgemein|Benutzer-Client|OAuth-Rückkehr|Plattform-Admin/, r)
    // Routen mit Benutzer-Client als Ausnahme laden wirklich nicht per Service-Role
    for (const r of ['global-search', 'import']) assert.doesNotMatch(route(r), /createSupabaseAdminClient/, r)
  })
  test('kein Profil hat einen Bereich, den keine Regel kennt', () => {
    for (const p of Object.values(PROFILE)) for (const b of p.lesen) assert.ok(BEREICHE.includes(b), b)
  })
})

describe('KAN-455: leseKonflikt', () => {
  const lib = quelle('src/lib/api/lesebereich.ts')
  test('403 mit deutscher Meldung in beiden Feldern; ohne Mitgliedschaft meldet die Route selbst', () => {
    assert.match(lib, /if \(!membership\) return null/)
    assert.match(lib, /if \(!canRead\(membership, bereich\)\) return NextResponse\.json\(\{ fehler: LESE_MELDUNG, error: LESE_MELDUNG \}, \{ status: 403 \}\)/)
    assert.match(lib, /LESE_MELDUNG = 'Für diesen Bereich fehlt dir das Leserecht\.'/)
  })
  test('mehrere Bereiche: alle nötig', () => {
    assert.match(lib, /for \(const bereich of bereiche\)/)
  })
})

describe('KAN-455: Wächter check-lesebereich-routen', () => {
  const gut = [
    "import { leseKonflikt } from '@/lib/api/lesebereich'",
    'export async function GET() {',
    '  const membership = await getCurrentMembership()',
    "  const leseSperre = leseKonflikt(membership, 'crm')   // KAN-455",
    '  if (leseSperre) return leseSperre',
    '  return NextResponse.json({})',
    '}',
  ].join('\n')
  const p = (eintrag, text) => pruefeRoute('x/y', eintrag, text, BEREICHE).join('|')
  test('richtige Route: kein Befund – auch mit „await getCurrentMembership()“ als erstem Argument', () => {
    assert.equal(p('crm', gut), '')
    assert.equal(p('crm', gut.replace('leseKonflikt(membership,', 'leseKonflikt(await getCurrentMembership(),')), '')
    assert.deepEqual(bereicheAus("await getCurrentMembership(), 'ki', 'keller'"), ['ki', 'keller'])
  })
  test('Handler ohne Aufruf, zweiter Handler vergessen', () => {
    assert.match(p('crm', gut.replace(/^.*leseKonflikt\(membership.*\n.*\n/m, '')), /Handler GET ohne leseKonflikt\(…, 'crm'\)/)
    assert.match(p('crm', gut + '\nexport async function POST() {\n  return NextResponse.json({})\n}'), /Handler POST ohne leseKonflikt/)
  })
  test('anderer Bereich als in der Liste, fehlender Bereich einer Liste', () => {
    assert.match(p('ea', gut), /leseKonflikt prüft \[crm\], die Liste nennt \[ea\]/)
    assert.match(p(['ki', 'keller'], gut.replace("'crm'", "'ki'")), /prüft \[ki\], die Liste nennt \[ki, keller\]/)
  })
  test('Ergebnis nicht zurückgegeben', () => {
    assert.match(p('crm', gut.replace('  if (leseSperre) return leseSperre\n', '')), /nach leseKonflikt fehlt „if \(leseSperre\) return leseSperre“/)
  })
  test('Weitergabe an eine lokale Funktion zählt', () => {
    const delegiert = [
      'export async function GET(req) { return handle(req) }',
      'export async function POST(req) { return handle(req) }',
      'async function handle(req) {',
      '  const membership = await getCurrentMembership()',
      "  const leseSperre = leseKonflikt(membership, 'crm')",
      '  if (leseSperre) return leseSperre',
      '}',
    ].join('\n')
    assert.equal(p('crm', delegiert), '')
  })
  test('Liste: unbekannter Bereich, „allgemein“ als Wert, Ausnahme ohne Grund, Ausnahme mit Aufruf', () => {
    assert.match(p('kunden', gut), /unbekannter Bereich „kunden“/)
    assert.match(p('allgemein', gut), /Bereich „allgemein“ braucht keine Prüfung/)
    assert.match(p({ ausnahme: 'kurz' }, 'export async function GET() {}'), /Ausnahme ohne Grund/)
    assert.match(p({ ausnahme: 'Webhook mit Signatur – ohne Benutzersitzung' }, gut), /steht aber als Ausnahme in der Liste/)
  })
  test('neue Route ohne Eintrag, Eintrag ohne Route', () => {
    const vorhandene = routen(API)
    assert.match(pruefe(LISTE, [...vorhandene, 'neu/route'], r => (r === 'neu/route' ? gut : route(r)), BEREICHE).join('|'), /neu\/route: Route ohne Eintrag/)
    assert.match(pruefe({ routen: { ...LISTE.routen, 'gibt/es/nicht': 'crm' } }, vorhandene, route, BEREICHE).join('|'), /gibt\/es\/nicht: steht in der Liste, aber/)
  })
})
