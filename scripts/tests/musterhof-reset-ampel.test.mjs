// Ampel für den nächtlichen Demo-Reset des Musterhofs (24.10.2026): Vercel-Cron /api/cron/musterhof-reset prüft nur
// lesend und mailt jeden Tag 🟢/🟡/🔴 an Jörgen (Hintergrund KAN-380: Reset scheiterte 12.–23.10. unbemerkt).
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/musterhof-reset-ampel.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MUSTERHOF_SOLL, MUSTERHOF_TENANT_ID, MUSTERHOF_RESET_EMPFAENGER, ROT_HINWEIS,
  bewerten, ladeMusterhofPruefung, mailInhalt, resetFaelligAb, kellerbuchSoll,
} from '../../src/lib/demo/musterhofResetAmpel.ts'

// CRLF → LF: unter Windows (core.autocrlf) scheiterten die zeilenübergreifenden Muster
const quelle = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Quelltext ohne Kommentarzeilen (Zeilen, die mit // bzw. /** oder * beginnen) */
const code = f => quelle(f).split('\n').filter(z => !/^\s*(\/\/|\/?\*)/.test(z)).join('\n')

// Prüfzeitpunkt wie der Cron: 24.10.2026 03:35 UTC
const JETZT = new Date('2026-10-24T03:35:00Z')
const info = (extra = {}) => ({ ...MUSTERHOF_SOLL, letzter_reset: '2026-10-24T03:00:14.828986+00:00', kellerbuch_abgeschlossen_bis: '2025-07-31', ...extra })
const pruefung = (extra = {}) => ({ info: info(), journalAbweichungen: 0, ueberfuellt: [], fehler: [], ...extra })

test('Grün: Reset heute nach 02:30 UTC, alle Kennzahlen auf Soll', () => {
  const b = bewerten(pruefung(), JETZT)
  assert.equal(b.ampel, 'gruen')
  assert.deepEqual(b.gruende, [])
})

test('Rot: Reset von gestern (KAN-380: 409 seit dem 12.10.)', () => {
  const b = bewerten(pruefung({ info: info({ letzter_reset: '2026-10-23T03:00:10+00:00' }) }), JETZT)
  assert.equal(b.ampel, 'rot')
  assert.match(b.gruende[0], /vor dem fälligen Reset/)
})

test('Rot: Grenze 02:30 UTC – 02:29:59 zu früh, 02:30:00 gilt', () => {
  assert.equal(bewerten(pruefung({ info: info({ letzter_reset: '2026-10-24T02:29:59Z' }) }), JETZT).ampel, 'rot')
  assert.equal(bewerten(pruefung({ info: info({ letzter_reset: '2026-10-24T02:30:00Z' }) }), JETZT).ampel, 'gruen')
})

test('Rot: kein letzter_reset bzw. unlesbarer Zeitpunkt', () => {
  assert.equal(bewerten(pruefung({ info: info({ letzter_reset: null }) }), JETZT).ampel, 'rot')
  assert.equal(bewerten(pruefung({ info: info({ letzter_reset: 'kaputt' }) }), JETZT).ampel, 'rot')
})

test('Rot: gescheiterte Abfrage, auch wenn alles andere passt – nie stilles 0', () => {
  const b = bewerten(pruefung({ journalAbweichungen: null, fehler: ['journal_konsistenz: permission denied'] }), JETZT)
  assert.equal(b.ampel, 'rot')
  assert.match(b.gruende[0], /Abfrage gescheitert: journal_konsistenz/)
})

test('Fälliger Reset: vor 02:30 UTC gilt der Vortag (manueller Lauf in der Nacht)', () => {
  assert.equal(resetFaelligAb(new Date('2026-10-24T01:00:00Z')).toISOString(), '2026-10-23T02:30:00.000Z')
  assert.equal(resetFaelligAb(new Date('2026-10-24T02:30:00Z')).toISOString(), '2026-10-24T02:30:00.000Z')
  assert.equal(resetFaelligAb(new Date('2027-01-01T00:10:00Z')).toISOString(), '2026-12-31T02:30:00.000Z')
  assert.equal(bewerten(pruefung({ info: info({ letzter_reset: '2026-10-23T03:00:00Z' }) }), new Date('2026-10-24T01:00:00Z')).ampel, 'gruen')
})

test('Kellerbuch-Soll: 31.07. des Vorjahres nach Wiener Kalender (Silvester 23:30 UTC = schon Neujahr in Wien)', () => {
  assert.equal(kellerbuchSoll(JETZT), '2025-07-31')
  assert.equal(kellerbuchSoll(new Date('2026-12-31T23:30:00Z')), '2026-07-31')
  assert.equal(kellerbuchSoll(new Date('2026-12-31T22:59:00Z')), '2025-07-31')
  assert.equal(kellerbuchSoll(new Date('2026-12-31T21:00:00Z')), '2025-07-31')
})

test('Gelb: Kennzahl weicht ab bzw. fehlt', () => {
  const b = bewerten(pruefung({ info: info({ chargen: 30 }) }), JETZT)
  assert.equal(b.ampel, 'gelb')
  assert.deepEqual(b.gruende, ['Chargen: 30 statt 31'])
  assert.equal(bewerten(pruefung({ info: info({ liter_im_keller: undefined }) }), JETZT).ampel, 'gelb')
  // numeric aus PostgREST als Text gilt
  assert.equal(bewerten(pruefung({ info: info({ liter_im_keller: '17186.00' }) }), JETZT).ampel, 'gruen')
})

test('Gelb: Kellerbuch mit falschem Jahr, Journal-Abweichung, überfülltes Gebinde', () => {
  assert.equal(bewerten(pruefung({ info: info({ kellerbuch_abgeschlossen_bis: '2024-07-31' }) }), JETZT).ampel, 'gelb')
  assert.equal(bewerten(pruefung({ journalAbweichungen: 1 }), JETZT).ampel, 'gelb')
  const b = bewerten(pruefung({ ueberfuellt: [{ name: 'Barrique 3', volumen_liter: 225, inhalt: 230 }] }), JETZT)
  assert.equal(b.ampel, 'gelb')
  assert.deepEqual(b.gruende, ['1 überfüllte Gebinde'])
})

/** Admin-Attrappe: nur rpc, protokolliert Aufrufe */
function attrappe(antworten) {
  const aufrufe = []
  return { aufrufe, rpc: (name, args) => { aufrufe.push({ name, args }); return Promise.resolve(antworten[name]) } }
}

test('Laden: nur die drei lesenden RPCs, Überfüllung mit Toleranz 0,5 l über eigen + fremd', async () => {
  const admin = attrappe({
    demo_musterhof_info: { data: info(), error: null },
    journal_konsistenz: { data: [], error: null },
    lade_behaelter: { data: [
      { name: 'T1', volumen_liter: 1000, eigen_liter: 1000.5, fremd_liter: 0 },
      { name: 'T2', volumen_liter: '1000', eigen_liter: 900, fremd_liter: 100.6 },
      { name: 'T3', volumen_liter: null, eigen_liter: 5000, fremd_liter: 0 },
    ], error: null },
  })
  const p = await ladeMusterhofPruefung(admin)
  assert.deepEqual(admin.aufrufe.map(a => a.name).sort(), ['demo_musterhof_info', 'journal_konsistenz', 'lade_behaelter'])
  for (const a of admin.aufrufe.filter(a => a.args)) assert.equal(a.args.p_tenant_id, MUSTERHOF_TENANT_ID)
  assert.deepEqual(p.fehler, [])
  assert.equal(p.journalAbweichungen, 0)
  assert.deepEqual(p.ueberfuellt.map(g => g.name), ['T2'])
})

test('Laden: Fehler jeder Abfrage landet in fehler, Wert bleibt null', async () => {
  const fehler = { message: 'boom', code: 'XX000' }
  const p = await ladeMusterhofPruefung(attrappe({
    demo_musterhof_info: { data: null, error: fehler },
    journal_konsistenz: { data: null, error: fehler },
    lade_behaelter: { data: null, error: fehler },
  }))
  assert.equal(p.fehler.length, 3)
  assert.equal(p.info, null)
  assert.equal(p.journalAbweichungen, null)
  assert.equal(p.ueberfuellt, null)
  assert.equal(bewerten(p, JETZT).ampel, 'rot')
})

test('Laden: leere Antwort von demo_musterhof_info ist ein Fehler', async () => {
  const p = await ladeMusterhofPruefung(attrappe({
    demo_musterhof_info: { data: null, error: null },
    journal_konsistenz: { data: [], error: null },
    lade_behaelter: { data: [], error: null },
  }))
  assert.equal(p.fehler.length, 1)
})

test('Mail: Betreff je Ampel, Reset in Wiener Zeit, Rot mit Hinweis', () => {
  const g = mailInhalt(bewerten(pruefung(), JETZT), pruefung(), JETZT)
  assert.equal(g.betreff, '🟢 Musterhof-Reset 24.10.2026 ok')
  assert.match(g.text, /24\.10\.2026, 05:00 Uhr \(Wien\)/)
  assert.doesNotMatch(g.text, /Supabase-Logs/)

  const pg = pruefung({ journalAbweichungen: 2 })
  assert.match(mailInhalt(bewerten(pg, JETZT), pg, JETZT).betreff, /^🟡 Musterhof-Reset 24\.10\.2026 mit Abweichungen$/)

  const pr = pruefung({ info: info({ letzter_reset: '2026-10-22T03:00:00Z' }) })
  const r = mailInhalt(bewerten(pr, JETZT), pr, JETZT)
  assert.equal(r.betreff, '🔴 Musterhof-Reset 24.10.2026 gescheitert')
  assert.ok(r.text.includes(ROT_HINWEIS) && r.html.includes('postgres_logs'))
})

test('Mail: HTML maskiert Gebindenamen', () => {
  const p = pruefung({ ueberfuellt: [{ name: '<b>Tank</b>', volumen_liter: 10, inhalt: 20 }] })
  const m = mailInhalt(bewerten(p, JETZT), p, JETZT)
  assert.ok(m.html.includes('&lt;b&gt;Tank') && !m.html.includes('<b>Tank'))
})

test('Verdrahtung: Route nur mit CRON_SECRET, liest nur, mailt an Jörgen über das Systemkonto', () => {
  const route = quelle('src/app/api/cron/musterhof-reset/route.ts')
  assert.match(route, /\/\/ zwei-faktor-ausnahme: .{15,}\nexport async function GET/)
  assert.match(route, /authorization'\) !== `Bearer \$\{cronSecret\}`/)
  assert.match(route, /if \(!cronSecret\) return/)
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  assert.match(route, /sendEmail\(\{ to: \{ email: empfaenger \}/)
  assert.doesNotMatch(route, /zugang/, 'System-Mail: kein Brevo-Zugang eines Betriebs')
  assert.match(route, /status: 500/)
  assert.equal(MUSTERHOF_RESET_EMPFAENGER, 'jv@icp-consultants.at')

  const lib = quelle('src/lib/demo/musterhofResetAmpel.ts')
  for (const q of [code('src/app/api/cron/musterhof-reset/route.ts'), code('src/lib/demo/musterhofResetAmpel.ts')]) {
    assert.doesNotMatch(q, /demo_musterhof_zuruecksetzen\s*['"(]|demo_musterhof_y2_kette\s*['"(]|\.rpc\(\s*['"]demo_musterhof_(zuruecksetzen|y2)/)
    assert.doesNotMatch(q, /\.(insert|update|upsert|delete)\(/)
  }
  const rpcs = [...lib.matchAll(/\.rpc\('([a-z_0-9]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(rpcs, ['demo_musterhof_info', 'journal_konsistenz', 'lade_behaelter'])
})

test('vercel.json: täglicher Cron 35 3 * * * auf die Route', () => {
  const v = JSON.parse(quelle('vercel.json'))
  assert.deepEqual(v.crons.filter(c => c.path === '/api/cron/musterhof-reset'), [{ path: '/api/cron/musterhof-reset', schedule: '35 3 * * *' }])
})
