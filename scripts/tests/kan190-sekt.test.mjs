// KAN-190 (07.10.2026) – Sekt: Stufen Sekt Austria (Klassik) / Reserve / Große Reserve und Hefelagerung.
// Entscheidung Jörgen 06.10.2026: „umsetzen wie im Vorschlag beschrieben“.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 62 (RPC s112_sekt_stufe_setzen, CHECKs, Freeze, IDOR).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan190_sekt_stufen.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan190_sekt_stufen.sql')
}
const s = () => laden('lib/wein/sekt.ts')

describe('KAN-190: Regeln', nurMitHooks, () => {
  test('volle Monate wie age(): erst am selben Tag ein voller Monat', async () => {
    const { volleMonate } = await s()
    assert.equal(volleMonate('2025-01-15', '2025-10-14'), 8)
    assert.equal(volleMonate('2025-01-15', '2025-10-15'), 9)
    assert.equal(volleMonate('2023-01-31', '2026-01-31'), 36)
  })
  test('Hefelagerung 9/18/36, Flaschengärung ab Reserve, lagenrein bei Große Reserve, nur abstufen', async () => {
    const { sektStufeFehler } = await s()
    const g = { alt: null, tirage: '2023-01-01', gaermethode: 'flaschengaerung', stichtag: '2026-01-01', lagenrein: true }
    assert.equal(sektStufeFehler({ ...g, stufe: 'grosse_reserve' }), null)
    assert.match(sektStufeFehler({ ...g, stufe: 'grosse_reserve', lagenrein: false }), /lagenreine/)
    assert.match(sektStufeFehler({ ...g, stufe: 'grosse_reserve', stichtag: '2025-12-31' }), /mindestens 36 Monate/)
    assert.match(sektStufeFehler({ ...g, stufe: 'reserve', gaermethode: 'tankgaerung' }), /Flaschengärung/)
    assert.equal(sektStufeFehler({ ...g, stufe: 'klassik', gaermethode: 'tankgaerung', tirage: '2025-04-01' }), null)
    assert.match(sektStufeFehler({ ...g, stufe: 'klassik', tirage: '2025-04-02' }), /mindestens 9 Monate/)
    assert.match(sektStufeFehler({ ...g, stufe: 'grosse_reserve', alt: 'reserve' }), /Aufwertung/)
    assert.equal(sektStufeFehler({ ...g, stufe: 'klassik', alt: 'reserve' }), null)
    assert.match(sektStufeFehler({ ...g, stufe: 'klassik', tirage: null }), /Tirage/)
  })
  test('möglich-Hinweis, Lagenreinheit, Tirage aus dem Formular', async () => {
    const { moeglicheSektStufe, istLagenrein, tirageAusFormular } = await s()
    assert.equal(moeglicheSektStufe({ tirage: '2024-01-01', gaermethode: 'flaschengaerung', stichtag: '2026-01-01', lagenrein: false }), 'reserve')
    assert.equal(istLagenrein([{ ried: 'Ried Kogl', liter: 300 }, { ried: 'ried kogl ', liter: 200 }]), true)
    assert.equal(istLagenrein([{ ried: 'Ried Kogl', liter: 300 }, { ried: 'Ried Berg', liter: 1 }]), false)
    assert.equal(istLagenrein([{ ried: null, liter: 300 }]), false)
    assert.deepEqual(tirageAusFormular('', '', 'SEKTGU', '2026-10-07', '2026-10-07'), { spalten: { tirage_datum: null, gaermethode: null } })
    assert.deepEqual(tirageAusFormular('flaschengaerung', '', 'SEKTGU', '2026-10-07', '2026-10-07'), { spalten: { tirage_datum: '2026-10-07', gaermethode: 'flaschengaerung' } })
    assert.match(tirageAusFormular('flaschengaerung', '', 'WEINGU', '2026-10-07', '2026-10-07').fehler, /nur bei Erzeugnis „Sekt g.U.“/)
    assert.match(tirageAusFormular('tankgaerung', '2026-10-08', 'SEKTGU', '2026-10-07', '2026-10-08').fehler, /nach der Füllung/)
  })
  test('Anzeige: „Sekt Austria Reserve (Qualitätswein)“ statt „Sekt g.U. …“', async () => {
    const { qualitaetAnzeige, qualitaetAnzeigeOderNull } = await laden('lib/wein/qualitaet.ts')
    const f = { qualitaet: 'qualitaetswein', erzeugnis: 'SEKTGU', zusatzbezeichnung: null }
    assert.equal(qualitaetAnzeigeOderNull({ ...f, sekt_stufe: 'reserve' }), 'Sekt Austria Reserve (Qualitätswein)')
    assert.equal(qualitaetAnzeige(f), 'Sekt g.U. (Qualitätswein)')
  })
})

describe('KAN-190: Datenbank und Verdrahtung', () => {
  test('Migration: Spalten, CHECKs, RPC mit freeze_frei', () => {
    const m = migration()
    assert.match(m, /ADD CONSTRAINT fuellungen_tirage_nur_sekt/)
    assert.match(m, /CREATE FUNCTION public\.s112_sekt_stufe_setzen\(p_tenant_id uuid, p_fuellung_id uuid, p_stufe text, p_degorgiert_am date,\n\s+p_lagenrein boolean\)/)
    assert.match(m, /PERFORM set_config\('s112\.freeze_frei', 'fuellungen', true\)/)
    assert.match(m, /WHEN 'klassik' THEN 9 WHEN 'reserve' THEN 18 ELSE 36/)
  })
  test('Füllung anlegen mit Tirage; Füllungsseite mit Sekt-Abschnitt; BKI-Lager weist die Stufe aus', () => {
    const a = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    assert.match(a, /tirageAusFormular\(formData\.get\('gaermethode'\), formData\.get\('tirage_datum'\)/)
    assert.match(a, /\.\.\.tirage\.spalten,/)
    assert.match(a, /'s112_sekt_stufe_setzen', \{/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/neu/FuellungFormClient.tsx'), /erzeugnisVal === 'SEKTGU' && <SektTirageFelder/)
    assert.match(quelle('src/app/(dashboard)/weinhandel/fuellungen/[id]/edit/page.tsx'), /<SektStufeForm fuellungId=\{id\}/)
    assert.match(quelle('src/lib/behoerden/lagerstand.ts'), /zusatz: text\(r\.zusatzbezeichnung\) \?\? sektStufeLabel\(sektStufe\)/)
  })
})
