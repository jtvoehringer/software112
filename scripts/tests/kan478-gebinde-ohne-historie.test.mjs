// KAN-478 (BKI-Sitzung 16.11.2026, Folge von KAN-475): Ein Gebinde zeigt nur, was jetzt drin liegt. Ist die Charge zur
// Gänze gefüllt oder umgezogen, ist das Gebinde leer – keine Historie am Gebinde. Das „Bewegungsbuch je Gebinde“ und die
// Umzugs-Historie entfallen (Weiterleitung), die Meldung ebenso; an ihre Stelle tritt das Weinbuch der Charge.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { letzteMassnahmen } from '../../src/lib/keller/schnellerfassung.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const G = 'g-1'

describe('KAN-478: letzte Maßnahmen führen zur Charge', () => {
  test('Behandlung der Charge → Kellerbehandlungen der Charge; Gebindepflege ohne Charge → Gebindepflege', () => {
    const m = letzteMassnahmen(G, [
      { id: 1, datum: '2026-11-10', typ_name_snapshot: 'Schwefelung', menge: 30, einheit: 'g', weinausbau_id: 'c-1' },
      { id: 2, datum: '2026-11-09', typ_name_snapshot: 'Reinigung', weinausbau_id: null },
    ], [], [], 5, l => l + ' L', new Set(['c-1']))
    assert.deepEqual(m.map(x => x.href), ['/kellerbuch/weinausbau/c-1/behandlungen', '/kellerbuch/behaelter/g-1/behandlungen'])
  })
  test('Umzug → Weinbuch der Charge, die jetzt im Gebinde liegt (Ziel vor Quelle); ohne Bezug zur Gebinde-Seite', () => {
    const umz = [
      { id: 3, datum: '2026-11-08', umzug_typ: 'normal', menge_liter: 500, von_behaelter_id: 'x', nach_behaelter_id: G, von_weinausbau_id: 'alt', nach_weinausbau_id: 'c-1' },
      { id: 4, datum: '2026-11-07', umzug_typ: 'schwund', schwund_liter: 2, von_behaelter_id: G, von_weinausbau_id: 'c-1', nach_weinausbau_id: null },
      { id: 5, datum: '2026-11-06', umzug_typ: 'normal', menge_liter: 10, von_behaelter_id: G, nach_behaelter_id: 'y', von_weinausbau_id: 'fremd', nach_weinausbau_id: 'fremd2' },
    ]
    const m = letzteMassnahmen(G, [], umz, [], 5, l => l + ' L', new Set(['c-1']))
    assert.deepEqual(m.map(x => x.href), ['/kellerbuch/weinausbau/c-1/buch', '/kellerbuch/weinausbau/c-1/buch', '/kellerbuch/behaelter/g-1'])
    assert.ok(!m.some(x => x.href.includes('/bewegungen') || x.href.includes('/umzuege')))
  })
})

describe('KAN-478: Gebinde-Seite lädt nur Daten der Chargen, die jetzt drin liegen', () => {
  const s = quelle('src/app/(dashboard)/kellerbuch/behaelter/[id]/page.tsx')
  test('Behandlungen: der aktuellen Chargen oder Gebindepflege ohne Charge – nie frühere Chargen des Gebindes', () => {
    assert.ok(s.includes('.or(chargenIds.length > 0 ? `weinausbau_id.in.(${liste}),and(weinausbau_id.is.null,behaelter_id.eq.${id})` : `and(weinausbau_id.is.null,behaelter_id.eq.${id})`)'))
    assert.ok(!s.includes(".eq('tenant_id', tenantId).eq('behaelter_id', id).is('storniert_am', null)"), 'kein Laden aller Behandlungen des Gebindes mehr')
  })
  test('Umzüge: nur der aktuellen Chargen; leeres Gebinde lädt keine Umzüge und keine Analysen', () => {
    assert.ok(s.includes('.or(`von_weinausbau_id.in.(${liste}),nach_weinausbau_id.in.(${liste})`)'))
    assert.ok(!s.includes('von_behaelter_id.eq.${id},nach_behaelter_id.eq.${id}'), 'kein Laden aller Umzüge des Gebindes mehr')
    assert.equal((s.match(/chargenIds\.length === 0 \? Promise\.resolve\(\{ data: \[\] \}\) :/g) ?? []).length, 2)
    assert.ok(s.includes('new Set(chargenIds))'))
    // weiterhin nur nicht stornierte Zeilen des eigenen Betriebs
    assert.equal((s.match(/\.is\('storniert_am', null\)/g) ?? []).length, 3)
  })
})

describe('KAN-478: Historie am Gebinde entfällt', () => {
  test('Bewegungen und Umzüge am Gebinde sind reine Weiterleitungen zur Gebinde-Seite', () => {
    for (const f of ['bewegungen', 'umzuege']) {
      const p = quelle(`src/app/(dashboard)/kellerbuch/behaelter/[id]/${f}/page.tsx`)
      assert.ok(p.includes('redirect(`/kellerbuch/behaelter/${encodeURIComponent(id)}`)'), f)
      assert.ok(!/supabase|from\(/.test(p), f + ': lädt nichts mehr')
      assert.ok(p.split('\n').length < 15, f)
    }
  })
  test('kein Verweis mehr auf …/bewegungen oder …/umzuege eines Gebindes', () => {
    for (const f of [
      'src/app/(dashboard)/kellerbuch/page.tsx', 'src/app/(dashboard)/kellerbuch/actions.ts', 'src/app/(dashboard)/kellerbuch/sammelbehandlung/actions.ts',
      'src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx', 'src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx',
      'src/app/(dashboard)/kellerbuch/_behandlungen/Kellerbehandlungen.tsx', 'src/app/(dashboard)/reports/(controlling)/keller/KellerAuswertungenClient.tsx',
      'src/components/kellerbuch/Schnellerfassung.tsx', 'src/components/kellerbuch/UmziehenWidget.tsx', 'src/lib/keller/schnellerfassung.ts',
      'src/lib/behoerden/uebersicht.ts', 'src/lib/behoerden/katalog/kellerbuch.ts',
    ]) {
      assert.ok(!/behaelter\/(\$\{[^}]+\}|\[id\])\/(bewegungen|umzuege)/.test(quelle(f)), f)
    }
  })
  test('Gebinde-Seite verweist auf das Weinbuch der Charge und die Gebindepflege; Kellerplan „Umziehen“ öffnet das Formular', () => {
    const sf = quelle('src/components/kellerbuch/Schnellerfassung.tsx')
    assert.ok(sf.includes('href={`/kellerbuch/weinausbau/${c.id}/buch`}'))
    assert.ok(sf.includes('>Gebindepflege</Link>') && !sf.includes('>Bewegungsbuch</Link>'))
    assert.ok(quelle('src/app/(dashboard)/kellerbuch/kellerplan/[id]/KellerplanEditor.tsx').includes('href={`/kellerbuch/umziehen?neu=1&von=${dialogBehaelter.id}`}'))
    const k = quelle('src/app/(dashboard)/kellerbuch/_behandlungen/Kellerbehandlungen.tsx')
    assert.ok(!k.includes('Tabs (nur am Gebinde)') && !k.includes('BarChart3'))
  })
  test('Meldung „Bewegungsbuch je Gebinde“ ist aus Katalog, Register, Stellen und Einstieg entfernt; das Weinbuch bleibt', () => {
    const kat = quelle('src/lib/behoerden/katalog/kellerbuch.ts')
    assert.ok(!/^  bewegungsbuch: \{/m.test(kat))
    assert.ok(/^  weinbuch: \{/m.test(kat) && kat.includes("'weinbuch-sammlung': {"))
    assert.ok(!quelle('src/lib/behoerden/register/kellerbuch.ts').includes('ladeBewegungsbuch'))
    assert.ok(!quelle('src/lib/behoerden/stellen.ts').includes('bewegungsbuch'))
    // die Rechnung bleibt Baustein für Belegung, Bestandsmeldung und Chargen-Saldo
    assert.ok(quelle('src/lib/behoerden/bewegungsbuch.ts').includes('export async function ladeBewegungsbuch('))
  })
})
