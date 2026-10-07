// Sweep Los & QR (07.10.2026) – KAN-92 Los-/Chargennummer und Weinpass-Code, KAN-122 Weinpass-QR lokal,
// KAN-116 QR-Etiketten für Gebinde; dazu Rückmeldungen Jörgen 07.10.2026 (DAC-Einreichen, Umzug abgeschlossen)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 56 (Eindeutigkeit je Betrieb, Weinpass-Code, unveränderlich).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan92_losnummer_weinpass_code.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan92_losnummer_weinpass_code.sql')
}

describe('KAN-92: Los-/Chargennummer', nurMitHooks, () => {
  test('losnummerFehler: leer = automatisch, Format', async () => {
    const l = await laden('lib/handel/losnummer.ts')
    assert.equal(l.losnummerFehler(''), null)
    assert.equal(l.losnummerFehler('  '), null)
    assert.equal(l.losnummerFehler('L-2026-012'), null)
    assert.equal(l.losnummerFehler('Los 12/26'), null)
    assert.match(l.losnummerFehler('-L1'), /1–40 Zeichen/)
    assert.match(l.losnummerFehler('L<1>'), /1–40 Zeichen/)
    assert.match(l.losnummerFehler('x'.repeat(41)), /1–40 Zeichen/)
  })
  test('losnummerVorschau wie get_next_chargennummer', async () => {
    const l = await laden('lib/handel/losnummer.ts')
    assert.equal(l.losnummerVorschau({ prefix: 'CH', stellen: 3, zaehler: 13 }, 2026), 'CH-2026-013')
    assert.equal(l.losnummerVorschau({ prefix: 'L', stellen: 4, zaehler: 7 }, 2026), 'L-2026-0007')
    assert.equal(l.losnummerVorschau({ prefix: null, stellen: null, zaehler: 1 }, 2026), 'CH-2026-001')
    assert.equal(l.losnummerVorschau({ zaehler: null }, 2026), null)
  })
  test('losText: PN, Los und Abfülldatum (Entscheidung Jörgen 06.10.2026)', async () => {
    const l = await laden('lib/handel/losnummer.ts')
    assert.equal(l.losText({ pruefnummer: 'N 1234/26', chargennummer: 'CH-2026-012', datum: '2026-03-01' }), 'PN N 1234/26 · Los CH-2026-012 · abgefüllt 01.03.2026')
    assert.equal(l.losText({ chargennummer: 'CH-2026-012', datum: null }), 'Los CH-2026-012')
    assert.equal(l.losText({ pruefnummer: null, chargennummer: null, datum: '2026-03-01' }), null)
    assert.equal(l.losText(null), null)
  })
  test('Weinpass-Pfad: Code vor Chargennummer, Code-Erkennung', async () => {
    const l = await laden('lib/handel/losnummer.ts')
    assert.equal(l.weinpassPfad({ weinpass_code: '0a1b2c3d4e5f', chargennummer: 'CH-2026-004' }), '/w/0a1b2c3d4e5f')
    assert.equal(l.weinpassPfad({ weinpass_code: null, chargennummer: 'CH 1/26' }), '/w/CH%201%2F26')
    assert.equal(l.istWeinpassCode('0a1b2c3d4e5f'), true)
    assert.equal(l.istWeinpassCode('CH-2026-004'), false)
  })
  test('Server Action: Format und Eindeutigkeit vor der Vergabe; Formular mit Vorschau', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    const i = (x) => a.indexOf(x)
    assert.ok(i('const losFehler = losnummerFehler(chargennummer)') > 0)
    assert.ok(i("gibt es in diesem Betrieb schon") < i("rpc as any)('get_next_chargennummer'"))
    assert.match(a, /\.eq\('tenant_id', tenantId\)\n\s+\.eq\('chargennummer', chargennummer\)/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx'), /<label className=\{labelCls\}>Los-\/Chargennummer<\/label>/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/page.tsx'), /losVorschau=\{losVorschau\}/)
  })
  test('Belege: Lieferschein/Rechnung und E-Mail-Versand mit PN, Los und Datum', () => {
    for (const p of ['src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx', 'src/app/api/weinhandel/verkauf/[id]/send/route.ts']) {
      const s = quelle(p)
      assert.match(s, /fuellung:fuellungen\([^)]*pruefnummer, chargennummer, datum\)/, p)
      assert.match(s, /const los = losText\(pos\.fuellung\)\n\s+if \(los\) sub\.push\(los\)/, p)
    }
  })
  test('Weinpass: zuerst Code, alte URL nur bei eindeutigem Treffer (keine fremden Daten)', () => {
    const w = quelle('src/app/w/[charge]/page.tsx')
    assert.match(w, /\.eq\('weinpass_code', schluessel\)/)
    assert.match(w, /\.eq\('chargennummer', schluessel\)\n\s+\.limit\(2\)/)
    assert.match(w, /if \(treffer\.length > 1\) return <WeinpassMehrdeutig nummer=\{schluessel\} \/>/)
    assert.doesNotMatch(w, /\.single\(\)/)
  })
  test('Migration: UNIQUE je Betrieb (partiell), Code mit Default, CHECK und UNIQUE', () => {
    const m = migration()
    assert.match(m, /CREATE UNIQUE INDEX fuellungen_chargennummer_eindeutig ON public\.fuellungen \(tenant_id, chargennummer\)\n\s+WHERE chargennummer IS NOT NULL;/)
    assert.match(m, /ADD COLUMN weinpass_code text NOT NULL DEFAULT lower\(substr\(replace\(gen_random_uuid\(\)::text, '-', ''\), 1, 12\)\)/)
    assert.match(m, /CHECK \(weinpass_code ~ '\^\[0-9a-f\]\{12\}\$'\)/)
    assert.match(m, /ADD CONSTRAINT fuellungen_weinpass_code_eindeutig UNIQUE \(weinpass_code\)/)
  })
})

describe('KAN-122/KAN-116: QR lokal', nurMitHooks, () => {
  test('kein externer QR-Dienst mehr im Code (grep „qrserver“ leer)', () => {
    const src = fileURLToPath(new URL('../../src', import.meta.url))
    const funde = []
    const lauf = (d) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n)
        if (statSync(p).isDirectory()) lauf(p)
        else if (/\.(ts|tsx)$/.test(n) && readFileSync(p, 'utf8').includes('qrserver')) funde.push(p)
      }
    }
    lauf(src)
    assert.deepEqual(funde, [])
  })
  test('Weinpass-QR auf der Füllung kodiert /w/<Code>; SVG und PNG lokal', () => {
    const e = quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx')
    assert.match(e, /svg: await qrSvg\(`\$\{appBasisUrl\(\)\}\$\{weinpassPfadF\}`\)/)
    assert.match(e, /png: await qrPngDataUrl\(`\$\{appBasisUrl\(\)\}\$\{weinpassPfadF\}`\)/)
    assert.match(quelle('src/lib/qr.ts'), /import QRCode from 'qrcode'/)
  })
  test('Etiketten-Auswahl: nur gewählter Standort bzw. Kellerplan, natürlich sortiert', async () => {
    const { etikettenAuswahl } = await laden('lib/keller/qrEtiketten.ts')
    const g = [
      { id: 'a', name: 'Tank 10', standort: 'Halle' },
      { id: 'b', name: 'Tank 2', standort: 'Halle' },
      { id: 'c', name: 'Barrique 1', standort: 'Keller' },
    ]
    assert.deepEqual(etikettenAuswahl(g, [], { standort: null, plan: null }).map(x => x.id), ['c', 'b', 'a'])
    assert.deepEqual(etikettenAuswahl(g, [], { standort: 'Halle', plan: null }).map(x => x.id), ['b', 'a'])
    assert.deepEqual(etikettenAuswahl(g, [{ kellerplan_id: 'P1', behaelter_id: 'a' }, { kellerplan_id: 'P2', behaelter_id: 'c' }], { standort: null, plan: 'P1' }).map(x => x.id), ['a'])
  })
  test('Etikettenbogen: nur eigene Gebinde, Link auf die Gebindeseite (Subdomain des Betriebs)', () => {
    const p = quelle('src/app/(dashboard)/kellerbuch/gebinde/qr-etiketten/page.tsx')
    assert.match(p, /const eigene = gebinde\.filter\(g => !g\.fremd\)/)
    assert.match(p, /subdomainUrl\(sub, `\/kellerbuch\/behaelter\/\$\{id\}`\) \?\? `\$\{appBasisUrl\(\)\}\/kellerbuch\/behaelter\/\$\{id\}`/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/gebinde/page.tsx'), /href="\/kellerbuch\/gebinde\/qr-etiketten"/)
  })
})

describe('Rückmeldungen Jörgen 07.10.2026', () => {
  test('DAC: Checkliste vor dem Einreichen mit Link zum Antragsformular; Bezeichnung in der Liste anklickbar', () => {
    const k = quelle('src/components/dac/DacStatusKarte.tsx')
    assert.match(k, /\{schreiben && !storniert && status === 'entwurf' && einreichFehlend\.length > 0 && \(/)
    assert.match(k, /<Link href=\{antragHref\} className="font-semibold underline">Antragsformular öffnen<\/Link>/)
    assert.match(quelle('src/app/(dashboard)/dac/[id]/page.tsx'), /einreichFehlend=\{einreichFehlend\} antragHref=\{`\/dac\/\$\{id\}\/antrag`\}/)
    assert.match(quelle('src/app/(dashboard)/dac/page.tsx'), /<Link href=\{`\/dac\/\$\{a\.id\}`\} className="hover:text-s112-blue-700 hover:underline">\{a\.bezeichnung\}<\/Link>/)
    assert.match(quelle('src/app/(dashboard)/dac/actions.ts'), /Das Antragsformular öffnest du oben über „Prüfnummernantrag“/)
  })
  test('Umzug: Bestätigung „abgeschlossen“, Charge bearbeiten eingeklappt', () => {
    const w = quelle('src/components/kellerbuch/UmziehenWidget.tsx')
    assert.match(w, /Der Vorgang ist abgeschlossen – es ist nichts weiter zu speichern\./)
    assert.ok(w.indexOf('setErfolg(gebucht)') > 0)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/weinausbau/[id]/page.tsx'), /<details id="bearbeiten" open=\{openForm === 'bearbeiten'\}/)
  })
  test('Hinweistext Korrektur nach oben verweist auf „Zugang korrigieren“ statt Support (KAN-53)', async () => {
    const { KORREKTUR_NACH_OBEN_HINWEIS } = await import('../../src/lib/kellerbuch/hinweise.ts')
    assert.match(KORREKTUR_NACH_OBEN_HINWEIS, /„Zugang korrigieren“/)
    assert.doesNotMatch(KORREKTUR_NACH_OBEN_HINWEIS, /Support/)
  })
})
