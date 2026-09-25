// KAN-123: Täglicher Cron /api/cron/taeglich im 60-s-Zeitlimit – Morgenberichte ausgelassen (25.09.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/kan123-morgenbericht.test.mjs
//
// Geprüft: faire Reihenfolge, Zeitgrenzen je Betrieb, Einordnung der Ergebnisse (Fehler / bewusst
// ausgelassen), Systembericht-Regeln (Vortag, fehlendes Cron-Protokoll) aus
// src/lib/morgenbericht/zeitplan.ts, Worker-Pool und Start-Takt aus src/lib/utils/parallel.ts
// (beide ohne '@/'-Importe) sowie die Verdrahtung per Quelltext-Prüfung (maxDuration, KI-Aufruf,
// GeoSphere-Timeout, Demo-Auslassung).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const z = await import('../../src/lib/morgenbericht/zeitplan.ts')
const par = await import('../../src/lib/utils/parallel.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const SANDBOX = { id: 'fa22dc07-eca5-43df-af96-f7b9b09f0471', name: 'Sandbox', created_at: '2026-05-26T08:00:00+00:00' }
const GEBESHUBER = { id: '097f67ed-381e-4bb3-952e-758aa9d3a501', name: 'Weingut Johannes Gebeshuber', created_at: '2026-08-14T08:00:00+00:00' }
const MUSTERHOF = { id: '33333333-3333-4333-8333-333333333333', name: 'Weingut Musterhof (Demo)', created_at: '2026-08-27T08:00:00+00:00' }
const SPAETROT = { id: '0569d025-576d-4d47-a102-17173835dc5d', name: 'Spaetrot Gebeshuber GmbH', created_at: '2026-09-16T08:00:00+00:00' }
const ALLE = [SANDBOX, GEBESHUBER, MUSTERHOF, SPAETROT]
const namen = (liste) => liste.map(b => b.name)

describe('fairReihenfolge()', () => {
  test('alle mit Bericht von gestern → Reihenfolge nach created_at', () => {
    const letzte = new Map(ALLE.map(b => [b.id, '2026-09-24']))
    assert.deepEqual(namen(z.fairReihenfolge(ALLE, letzte)), namen(ALLE))
  })

  test('der gestern ausgelassene Betrieb kommt heute zuerst', () => {
    const letzte = new Map([[SANDBOX.id, '2026-09-24'], [GEBESHUBER.id, '2026-09-24'], [MUSTERHOF.id, '2026-09-24'], [SPAETROT.id, '2026-09-23']])
    assert.deepEqual(namen(z.fairReihenfolge(ALLE, letzte)), ['Spaetrot Gebeshuber GmbH', 'Sandbox', 'Weingut Johannes Gebeshuber', 'Weingut Musterhof (Demo)'])
  })

  test('Betriebe ohne Cron-Bericht vor allen anderen, untereinander nach created_at', () => {
    const letzte = new Map([[SANDBOX.id, '2026-09-24'], [MUSTERHOF.id, '2026-09-20']])
    assert.deepEqual(namen(z.fairReihenfolge(ALLE, letzte)), ['Weingut Johannes Gebeshuber', 'Spaetrot Gebeshuber GmbH', 'Weingut Musterhof (Demo)', 'Sandbox'])
  })

  test('Gleichstand ohne created_at bleibt in der Eingangsreihenfolge; Eingabe unverändert', () => {
    const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c', created_at: null }
    const eingabe = [a, b, c]
    assert.deepEqual(z.fairReihenfolge(eingabe, new Map()).map(x => x.id), ['a', 'b', 'c'])
    assert.deepEqual(eingabe.map(x => x.id), ['a', 'b', 'c'])
  })

  test('letzteCronBerichte() nimmt je Betrieb das jüngste Datum', () => {
    const m = z.letzteCronBerichte([
      { tenant_id: 'a', datum: '2026-09-22' }, { tenant_id: 'a', datum: '2026-09-24' }, { tenant_id: 'a', datum: '2026-09-23' },
      { tenant_id: 'b', datum: '2026-09-20T00:00:00' },
    ])
    assert.equal(m.get('a'), '2026-09-24')
    assert.equal(m.get('b'), '2026-09-20')
    assert.equal(m.has('c'), false)
  })
})

describe('Zeitgrenzen', () => {
  const T = 1_000_000

  test('betriebsDeadline(): höchstens 120 s, nie über das Laufende', () => {
    assert.equal(z.BETRIEB_ZEITGRENZE_MS, 120_000)
    assert.equal(z.betriebsDeadline(T, T + 700_000), T + 120_000)
    assert.equal(z.betriebsDeadline(T, T + 60_000), T + 60_000)
    assert.equal(z.betriebsDeadline(T, T + z.BETRIEB_MINDESTZEIT_MS), T + z.BETRIEB_MINDESTZEIT_MS)
  })

  test('betriebsDeadline(): unter der Mindestzeit kein Beginn mehr', () => {
    assert.equal(z.betriebsDeadline(T, T + z.BETRIEB_MINDESTZEIT_MS - 1), null)
    assert.equal(z.betriebsDeadline(T, T - 5), null)
  })

  test('kiStartErlaubt(): ohne Grenze immer, sonst nur mit ≥ 22 s Restzeit', () => {
    assert.equal(z.KI_MINDESTZEIT_MS, 22_000)
    assert.equal(z.kiStartErlaubt(undefined), true)
    assert.equal(z.kiStartErlaubt(T + 22_000, T), true)
    assert.equal(z.kiStartErlaubt(T + 21_999, T), false)
    assert.equal(z.kiStartErlaubt(T - 1, T), false)
  })

  test('wetterDeadline(): Reserve für Prüfungen, KI und Speichern', () => {
    assert.equal(z.wetterDeadline(undefined), undefined)
    assert.equal(z.wetterDeadline(T + 120_000), T + 120_000 - z.WETTER_RESERVE_MS)
    assert.ok(z.WETTER_RESERVE_MS > z.KI_MINDESTZEIT_MS, 'Reserve muss die KI-Mindestzeit abdecken')
  })

  test('Reserven passen zusammen: Nachlauf eines Betriebs < Laufreserve', () => {
    assert.ok(z.BETRIEB_NACHLAUF_MS < z.LAUF_RESERVE_MS)
    assert.equal(z.LAUF_RESERVE_MS, 30_000)
  })

  test('mitZeitgrenze(): Ergebnis durchreichen bzw. ZeitgrenzeFehler', async () => {
    assert.equal(await z.mitZeitgrenze(Promise.resolve(42), Date.now() + 1000), 42)
    const langsam = new Promise(r => setTimeout(() => r('zu spät'), 200))
    await assert.rejects(z.mitZeitgrenze(langsam, Date.now() + 20), (e) => e instanceof z.ZeitgrenzeFehler && /Zeitgrenze/.test(e.message))
    await assert.rejects(z.mitZeitgrenze(Promise.reject(new Error('DB weg')), Date.now() + 1000), /DB weg/)
  })
})

describe('Einordnung der Ergebnisse (Cron-Protokoll)', () => {
  test('ergebnisArt(): Zeitmangel und Ausnahmen sind Fehler, bewusste Auslassungen nicht', () => {
    assert.equal(z.ergebnisArt({ tenant: 'x', befunde: 3 }), 'ok')
    assert.equal(z.ergebnisArt({ tenant: 'x', fehler: 'kaputt' }), 'fehler')
    assert.equal(z.ergebnisArt({ tenant: 'x', uebersprungen: 'Zeitbudget erschöpft' }), 'zeit')
    assert.equal(z.ergebnisArt({ tenant: 'x', befunde: 2, zeitgrenze: 'KI-Zusammenfassung ausgelassen' }), 'zeit')
    assert.equal(z.ergebnisArt({ tenant: 'x', uebersprungen: 'Morgenbericht deaktiviert' }), 'bewusst')
    assert.equal(z.ergebnisArt({ tenant: 'x', uebersprungen: 'Abo gesperrt (Nur-Lesen-Modus)' }), 'bewusst')
    assert.equal(z.ergebnisArt({ tenant: 'x', uebersprungen: 'Demo-Betrieb: kein tägliches Update' }), 'bewusst')
    assert.equal(z.ergebnisArt({ tenant: 'x', uebersprungen: 'unbekannter Grund' }), 'fehler')
  })

  test('laufBilanz(): Zahlen für Meldung und fehlerAnzahl', () => {
    const b = z.laufBilanz([
      { tenant: 'Sandbox', befunde: 4 },
      { tenant: 'Gebeshuber', befunde: 9, zeitgrenze: 'Wetter: 2 Punkte nicht aufgefrischt' },
      { tenant: 'Musterhof', uebersprungen: z.GRUND.demo },
      { tenant: 'Spaetrot', uebersprungen: z.GRUND.zeitbudget },
      { tenant: 'Neu', fehler: 'Zeitgrenze des Betriebs überschritten – Bericht abgebrochen' },
      { tenant: 'Aus', uebersprungen: z.GRUND.deaktiviert },
    ])
    assert.deepEqual(b, { erstellt: 2, gekuerzt: 1, fehler: 1, zeitUebersprungen: 1, bewusst: 2, alsFehler: 3 })
  })

  test('Gründe der Auslassung (Texte im Protokoll)', () => {
    assert.equal(z.GRUND.demo, 'Demo-Betrieb: kein tägliches Update')
    assert.equal(z.GRUND.zeitbudget, 'Zeitbudget erschöpft')
  })
})

describe('Systembericht', () => {
  const basis = { aktiv: true, morgenberichtAktiv: true, aboGesperrt: false, demo: false, createdAt: '2026-08-14T08:00:00+00:00' }
  const b = (id, extra = {}) => ({ id, name: id, ...basis, ...extra })

  test('betriebeOhneVortagsbericht(): nur echte Lücken, mit allen Ausnahmen', () => {
    const betriebe = [
      b('mit-bericht'),
      b('ohne-bericht'),
      b('demo', { demo: true }),
      b('inaktiv', { aktiv: false }),
      b('deaktiviert', { morgenberichtAktiv: false }),
      b('gesperrt', { aboGesperrt: true }),
      b('am-vortag-angelegt', { createdAt: '2026-09-24T12:00:00+00:00' }),
      b('heute-angelegt', { createdAt: '2026-09-25T04:00:00+00:00' }),
      b('ohne-anlagedatum', { createdAt: null }),
    ]
    const ohne = z.betriebeOhneVortagsbericht(betriebe, new Set(['mit-bericht']), '2026-09-24')
    assert.deepEqual(ohne.map(x => x.id), ['ohne-bericht', 'ohne-anlagedatum'])
  })

  test('vortagVon(): Wiener Kalendertag, auch an den Tagen der Zeitumstellung', () => {
    assert.equal(z.vortagVon(new Date('2026-09-25T05:00:00Z')), '2026-09-24')
    assert.equal(z.vortagVon(new Date('2026-09-24T22:30:00Z')), '2026-09-24')   // 25.9. 00:30 Wien
    assert.equal(z.vortagVon(new Date('2026-03-29T05:00:00Z')), '2026-03-28')
    assert.equal(z.vortagVon(new Date('2026-10-25T23:30:00Z')), '2026-10-25')   // 26.10. 00:30 Wien
    assert.equal(z.vortagVon(new Date('2027-01-01T05:00:00Z')), '2026-12-31')
  })

  test('berichtDatum() bleibt Wiener Datum', () => {
    assert.equal(z.berichtDatum(new Date('2026-09-24T22:30:00Z')), '2026-09-25')
    assert.equal(z.berichtDatum(new Date('2026-09-25T05:00:00Z')), '2026-09-25')
  })

  test('cronProtokollFehlt(): erst ab 05:30 UTC, nur Einträge ab 05:00 UTC von heute zählen', () => {
    assert.equal(z.cronProtokollFehlt(new Date('2026-09-25T05:29:00Z'), null), false)
    assert.equal(z.cronProtokollFehlt(new Date('2026-09-25T05:30:00Z'), null), true)
    assert.equal(z.cronProtokollFehlt(new Date('2026-09-25T09:00:00Z'), '2026-09-25T05:12:40.123+00:00'), false)
    assert.equal(z.cronProtokollFehlt(new Date('2026-09-25T09:00:00Z'), '2026-09-24T05:12:40+00:00'), true)
    assert.equal(z.cronProtokollFehlt(new Date('2026-09-25T09:00:00Z'), '2026-09-25T04:59:00+00:00'), true)
    assert.equal(z.cronLaufBeginn(new Date('2026-09-25T23:59:00Z')).toISOString(), '2026-09-25T05:00:00.000Z')
  })
})

describe('Parallelität (src/lib/utils/parallel.ts)', () => {
  test('mitHoechstens(): höchstens n gleichzeitig, Ergebnis in Eingangsreihenfolge', async () => {
    let laufend = 0, hoechstens = 0
    const dauer = [50, 5, 30, 1, 20, 10, 5]
    const erg = await par.mitHoechstens(dauer, 2, async (ms, i) => {
      laufend++; hoechstens = Math.max(hoechstens, laufend)
      await new Promise(r => setTimeout(r, ms))
      laufend--
      return `${i}:${ms}`
    })
    assert.equal(hoechstens, 2)
    assert.deepEqual(erg, dauer.map((ms, i) => `${i}:${ms}`))
  })

  test('mitHoechstens(): leere Liste und n größer als die Liste', async () => {
    assert.deepEqual(await par.mitHoechstens([], 3, async () => 1), [])
    assert.deepEqual(await par.mitHoechstens([1, 2], 5, async (x) => x * 2), [2, 4])
  })

  test('startTakt(): höchstens anzahl Starts je Fenster', async () => {
    const takt = par.startTakt(3, 100)
    const t0 = Date.now()
    const starts = []
    for (let i = 0; i < 7; i++) { await takt(); starts.push(Date.now() - t0) }
    // Start 4 frühestens nach einem Fenster, Start 7 nach zwei Fenstern
    assert.ok(starts[3] >= 95, `4. Start nach ${starts[3]} ms`)
    assert.ok(starts[6] >= 195, `7. Start nach ${starts[6]} ms`)
    for (let i = 3; i < starts.length; i++) assert.ok(starts[i] - starts[i - 3] >= 95, `Fenster bei Start ${i + 1}`)
  })

  test('startTakt(): abgebrochenes Signal beendet das Warten', async () => {
    const takt = par.startTakt(1, 10_000)
    await takt()
    const ac = new AbortController()
    ac.abort(new Error('Zeitgrenze'))
    await assert.rejects(takt(ac.signal), /Zeitgrenze/)
  })
})

describe('Verdrahtung (Quelltext)', () => {
  test('maxDuration = 800 in beiden Cron-Routen (Literal), Budget mit Reserve', () => {
    for (const p of ['src/app/api/cron/taeglich/route.ts', 'src/app/api/cron/morgenbericht/route.ts']) {
      const s = quelle(p)
      assert.match(s, /^export const maxDuration = 800$/m, p)
      assert.equal((s.match(/export const maxDuration/g) ?? []).length, 1, p)
      assert.match(s, /maxDuration \* 1000 - LAUF_RESERVE_MS - \(Date\.now\(\) - start\)/, p)
      assert.doesNotMatch(s, /Vercel Hobby erlaubt|\(maxDuration - \d+\) \* 1000/, p)
    }
  })

  test('täglicher Cron: Zeitmangel zählt als Fehler, Zwei-Faktor- und Schreibsperre-Kommentare unverändert', () => {
    const s = quelle('src/app/api/cron/taeglich/route.ts')
    assert.match(s, /const mb = laufBilanz\(morgenbericht\.ergebnis\)/)
    assert.match(s, /emailSpiegel\.fehler\.length \+ mb\.alsFehler/)
    assert.match(s, /\/\/ schreibsperre-ausnahme: Cron bzw\. manueller Lauf nur für Super-Admins/)
    assert.match(s, /const zweiFaktor = await pruefeZweiFaktor\(\)\s+if \(zweiFaktor\) return zweiFaktor/)
    assert.match(s, /spiegleMailboxen\(22000\)/)
  })

  test('KI: Zeitlimit 20 s, keine Wiederholungen, Zeitprüfung vor der Zählung', () => {
    const s = quelle('src/lib/morgenbericht/ki.ts')
    assert.match(s, /new Anthropic\(\{ apiKey: process\.env\.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 0 \}\)/)
    const pruefung = s.indexOf('if (!kiStartErlaubt(opts.deadline))')
    const zaehlung = s.indexOf("'check_und_increment_ki_abfrage'")
    assert.ok(pruefung > 0 && zaehlung > pruefung, 'Zeitprüfung muss vor check_und_increment_ki_abfrage stehen')
    assert.ok(z.KI_MINDESTZEIT_MS > 20_000, 'Mindestzeit muss das Zeitlimit des Aufrufs übersteigen')
  })

  test('GeoSphere: Timeout 10 s, externes Signal, Takt unter dem Rate-Limit', () => {
    const s = quelle('src/lib/wetter/geosphere.ts')
    assert.match(s, /const ABRUF_TIMEOUT_MS = 10_000/)
    assert.match(s, /AbortSignal\.any\(\[signal, zeitlimit\]\)/)
    assert.match(s, /request-limit\.html/)
    assert.doesNotMatch(s, /AbortSignal\.timeout\(25000\)/)
    const takt = s.match(/startTakt\((\d+), 1000\)/)
    assert.ok(takt && Number(takt[1]) < 5, 'höchstens 4 Starts je Sekunde (Limit 5/s)')
  })

  test('Wetter: höchstens 3 Punkte gleichzeitig, Grenze durchgereicht', () => {
    const d = quelle('src/lib/wetter/daten.ts')
    assert.match(d, /const PUNKTE_PARALLEL = 3\b/)
    assert.match(d, /mitHoechstens\(punkte\.slice\(0, 12\), PUNKTE_PARALLEL/)
    assert.match(d, /holeRueckblick\([^)]*, signal\)/)
    assert.match(d, /holePrognose\([^)]*, signal\)/)
    assert.match(quelle('src/lib/wetter/auswertung.ts'), /deadline: opts\.deadline/)
    assert.match(quelle('src/lib/morgenbericht/erstellen.ts'), /deadline: wetterDeadline\(opts\.deadline\)/)
    assert.equal(z.BETRIEBE_PARALLEL, 2)
  })

  test('Lauf: Demo-Betrieb ausgelassen, Zeitgrenze je Betrieb, Pool, faire Reihenfolge', () => {
    const s = quelle('src/lib/morgenbericht/lauf.ts')
    assert.match(s, /if \(t\.id === DEMO_TENANT_ID\) return \{ tenant: t\.name, uebersprungen: GRUND\.demo \}/)
    assert.ok(s.indexOf('GRUND.demo') < s.indexOf('erstelleMorgenbericht({'), 'Demo-Auslassung vor dem Bericht')
    assert.match(s, /mitHoechstens\(reihe, BETRIEBE_PARALLEL/)
    assert.match(s, /fairReihenfolge\(/)
    assert.match(s, /'cron', new Date\(\), \{ deadline \}\)/)
    assert.match(s, /tenant-isolation-ignore: letzter Cron-Bericht/)
    assert.match(s, /\.eq\('ausloeser', 'cron'\)/)
  })

  test('Manueller Bericht unverändert (ohne Zeitgrenze), Cron-Zeitplan unverändert', () => {
    assert.match(quelle('src/app/(dashboard)/dashboard/morgenbericht/actions.ts'), /erstelleMorgenbericht\(\{ id: \(t as R\)\.id, name: \(t as R\)\.name, stripe_plan: \(t as R\)\.stripe_plan \}, 'manuell'\)/)
    const vercel = JSON.parse(quelle('vercel.json'))
    assert.deepEqual(vercel.crons.find(c => c.path === '/api/cron/taeglich'), { path: '/api/cron/taeglich', schedule: '0 5 * * *' })
  })

  test('Systembericht: Vortag in pruefungen.ts, Hinweis auf /admin/system', () => {
    const p = quelle('src/lib/morgenbericht/pruefungen.ts')
    assert.match(p, /key: 'system:morgenbericht-vortag', bereich: 'System', stufe: 'mittel'/)
    assert.match(p, /href: '\/admin\/system',/)
    const v = quelle('src/lib/morgenbericht/vortag.ts')
    assert.match(v, /\.from\('morgenberichte'\) as any\)\.select\('tenant_id'\)\.eq\('datum', vortag\)/)
    assert.doesNotMatch(v, /\.eq\('ausloeser'/, 'jede Zeile des Vortags zählt, auch eine manuelle')
    const a = quelle('src/app/(dashboard)/admin/system/page.tsx')
    assert.match(a, /cronProtokollFehlt\(jetzt,/)
    assert.match(a, /\{cronOhneProtokoll && \(/)
  })
})
