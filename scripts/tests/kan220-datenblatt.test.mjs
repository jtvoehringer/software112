// KAN-220 (07.10.2026) – E-Label E: Produktdatenblatt (PDF) und Bilder je Füllung (Flasche, Etikett), Händler-Sammelexport.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 19 (Bucket fuellung-bilder: Lesen Mitglieder, Hochladen/Löschen kellerbuch|warenwirtschaft) und 01.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  analyseWerte, bildArtAusName, bildFehler, bildPfad, datenblattCsv, datenblattDateiname, istBildArt, wertText, BILD_MAX_BYTES,
} from '../../src/lib/handel/datenblatt.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan220_fuellung_bilder.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan220_fuellung_bilder.sql')
}

describe('KAN-220: Bilder', () => {
  test('Pfad: Betrieb als erster Ordner, Art als Dateiname, Endung aus dem Typ', () => {
    assert.equal(bildPfad('t1', 'f1', 'flasche', 'image/png'), 't1/f1/flasche.png')
    assert.equal(bildPfad('t1', 'f1', 'etikett', 'image/jpeg'), 't1/f1/etikett.jpg')
    assert.equal(bildArtAusName('etikett.jpg'), 'etikett')
    assert.equal(bildArtAusName('anderes.png'), null)
    assert.equal(istBildArt('flasche'), true)
    assert.equal(istBildArt('logo'), false)
  })
  test('Prüfung: nur JPEG/PNG (PDF kann kein WebP), höchstens 4 MB, nicht leer', () => {
    assert.equal(bildFehler({ type: 'image/png', size: 1000 }), null)
    assert.match(bildFehler({ type: 'image/webp', size: 1000 }), /JPEG- oder PNG/)
    assert.match(bildFehler({ type: 'image/jpeg', size: BILD_MAX_BYTES + 1 }), /zu groß/)
    assert.match(bildFehler({ type: 'image/jpeg', size: 0 }), /wählen/)
    assert.match(bildFehler(null), /wählen/)
    assert.ok(BILD_MAX_BYTES <= 4.5 * 1024 * 1024, 'unter dem Vercel-Limit von 4,5 MB')
  })
})

describe('KAN-220: Analysewerte und Ausgabe', () => {
  const analysen = [
    { analyse_datum: '2026-03-01', alkohol_vol: '12.5', restzucker_gl: '2.1', gesamtsaeure_gl: '6.0' },
    { analyse_datum: '2026-05-10', alkohol_vol: '12.8', restzucker_gl: '1.9', gesamtsaeure_gl: '5.8' },
    { analyse_datum: '2026-06-01', alkohol_vol: '13.0', storniert_am: '2026-06-02' },
  ]
  test('freigegebenes E-Label geht vor', () => {
    const w = analyseWerte({ status: 'freigegeben', alkohol_vol: 12.6, restzucker_gl: 2, gesamtsaeure_gl: 5.9 }, analysen)
    assert.deepEqual(w, { alkohol: 12.6, restzucker: 2, saeure: 5.9, quelle: { art: 'elabel' } })
  })
  test('sonst die jüngste nicht stornierte Analyse; Entwurf zählt nicht', () => {
    const w = analyseWerte({ status: 'entwurf', alkohol_vol: 11 }, analysen)
    assert.deepEqual(w, { alkohol: 12.8, restzucker: 1.9, saeure: 5.8, quelle: { art: 'analyse', datum: '2026-05-10' } })
    assert.deepEqual(analyseWerte(null, []), { alkohol: null, restzucker: null, saeure: null, quelle: null })
  })
  test('Werttext mit deutschem Komma; Dateiname ohne Sonderzeichen', () => {
    assert.equal(wertText(12.5, 1, '% vol'), '12,5 % vol')
    assert.equal(wertText(null, 1, 'g/l'), '–')
    assert.equal(datenblattDateiname('Grüner Veltliner „Ried Spiegel“', 2025), 'datenblatt-gruner-veltliner-ried-spiegel-2025.pdf')
    assert.equal(datenblattDateiname(null, null), 'datenblatt-wein.pdf')
  })
  test('CSV: Kopfzeile mit Einheiten, Dezimalkomma', () => {
    const csv = datenblattCsv([{ name: 'GV', jahrgang: 2025, rebsorte: 'Grüner Veltliner', qualitaet: 'Qualitätswein', herkunft: 'Kremstal',
      flaschengroesse: '0,75 L', alkohol: 12.5, restzucker: 1.9, saeure: 5.8, pruefnummer: 'N 1234/26', chargennummer: 'L25-01', elabel: null }])
    assert.equal(csv.zeilen, 1)
    assert.match(csv.text, /Name;Jahrgang;Rebsorte;Qualität;Herkunft;Flaschengröße;Alkohol \(% vol\);Restzucker \(g\/l\);Säure \(g\/l\);Prüfnummer;Chargennummer;E-Label/)
    assert.match(csv.text, /;12,5;1,9;5,8;/)
  })
})

describe('KAN-220: Datenbank und Verdrahtung', () => {
  test('Bucket privat, JPEG/PNG, Hochladen/Löschen nur mit Schreibrecht kellerbuch|warenwirtschaft, kein UPDATE', () => {
    const m = migration()
    assert.match(m, /VALUES \('fuellung-bilder', 'fuellung-bilder', false, 5242880, ARRAY\['image\/jpeg', 'image\/png'\]\)/)
    assert.equal((m.match(/s112_darf_schreiben\(m\.tenant_id, VARIADIC ARRAY\['kellerbuch', 'warenwirtschaft'\]\)/g) ?? []).length, 2)
    assert.doesNotMatch(m, /FOR UPDATE/)
  })
  test('Routen: Zwei-Faktor, Bilder mit Seiten-Betrieb, Abo-Sperre, Rechten und Füllung im eigenen Betrieb', () => {
    const b = quelle('src/app/api/weinhandel/fuellungen/[id]/bilder/route.ts')
    for (const s of ['pruefeZweiFaktor()', 'seitenBetriebKonflikt(m.tenantId)', 'schreibSperreKonflikt(m)', "canWrite(m, 'kellerbuch') || canWrite(m, 'warenwirtschaft')", ".eq('tenant_id', m.tenantId)", 'upsert: false']) {
      assert.ok(b.includes(s), s)
    }
    const d = quelle('src/app/api/weinhandel/fuellungen/[id]/datenblatt/route.ts')
    assert.ok(d.includes('pruefeZweiFaktor()'))
    assert.match(d, /'Content-Type': 'application\/pdf'/)
    const l = quelle('src/lib/handel/datenblattLaden.ts')
    assert.ok(l.includes(".eq('id', fuellungId).eq('tenant_id', tenantId)"))
    const c = quelle('src/app/api/export/datenblaetter/route.ts')
    assert.ok(c.includes('darfDatenexport(membership)'))
    assert.ok(c.includes(".is('storniert_am', null)"))
  })
})
