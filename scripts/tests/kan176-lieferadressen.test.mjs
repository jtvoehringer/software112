// KAN-176 (07.10.2026) – mehrere Lieferadressen je Kontakt bzw. Firma; Verkauf mit abweichender Lieferadresse
// (Momentaufnahme am Verkauf), Ausgabe auf Rechnung, Lieferschein, Rechnungs-PDF und Transportbescheinigung.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 64 (genau ein Partner, eigener Betrieb, kein Löschen, Leser ohne Schreibrecht, Momentaufnahme).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  lieferadresseAus, lieferadresseFehler, lieferadresseMoment, lieferadresseZeilen, lieferadresseKurz, gleicheLieferadresse,
} from '../../src/lib/crm/lieferadressen.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan176_lieferadressen.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan176_lieferadressen.sql')
}

describe('KAN-176: Lieferadresse – Prüfung und Darstellung', () => {
  test('Eingabe wird getrimmt, leere Bezeichnung/Empfänger werden null', () => {
    const a = lieferadresseAus({ bezeichnung: '  ', empfaenger: ' Hr. Huber ', strasse: ' Lagerweg 3 ', plz: '3500', ort: 'Krems ' }, 'AT')
    assert.deepEqual(a, { bezeichnung: null, empfaenger: 'Hr. Huber', strasse: 'Lagerweg 3', plz: '3500', ort: 'Krems', land: 'AT' })
  })
  test('Pflichtfelder Straße, PLZ, Ort; Längen wie die CHECKs; Land ISO', () => {
    const ok = lieferadresseAus({ strasse: 'Lagerweg 3', plz: '3500', ort: 'Krems' }, 'AT')
    assert.equal(lieferadresseFehler(ok), null)
    assert.match(lieferadresseFehler({ ...ok, strasse: '' }), /Straße/)
    assert.match(lieferadresseFehler({ ...ok, plz: '' }), /PLZ/)
    assert.match(lieferadresseFehler({ ...ok, ort: '' }), /Ort/)
    assert.match(lieferadresseFehler({ ...ok, strasse: 'x'.repeat(121) }), /zu lang/)
    assert.match(lieferadresseFehler({ ...ok, bezeichnung: 'x'.repeat(81) }), /zu lang/)
    assert.match(lieferadresseFehler({ ...ok, land: 'Österreich' }), /Land/)
  })
  test('Momentaufnahme ohne id', () => {
    const m = lieferadresseMoment({ id: 'x', bezeichnung: 'Lager', empfaenger: null, strasse: 'A 1', plz: '1010', ort: 'Wien', land: 'AT' })
    assert.equal('id' in m, false)
    assert.equal(m.bezeichnung, 'Lager')
  })
  test('Druckzeilen: Empfänger, Straße, PLZ Ort, Land nur außerhalb Österreichs; leer ohne Adresse', () => {
    assert.deepEqual(lieferadresseZeilen(null), [])
    assert.deepEqual(lieferadresseZeilen({ strasse: '' }), [])
    assert.deepEqual(lieferadresseZeilen({ empfaenger: null, strasse: 'A 1', plz: '1010', ort: 'Wien', land: 'AT' }), ['A 1', '1010 Wien'])
    assert.deepEqual(lieferadresseZeilen({ empfaenger: 'Fr. Maier', strasse: 'B 2', plz: '80331', ort: 'München', land: 'DE' }, iso => iso === 'DE' ? 'Deutschland' : iso),
      ['Fr. Maier', 'B 2', '80331 München', 'Deutschland'])
  })
  test('Kurzform für Auswahllisten', () => {
    assert.equal(lieferadresseKurz({ bezeichnung: 'Lager', strasse: 'A 1', plz: '1010', ort: 'Wien', land: 'AT' }), 'Lager – A 1, 1010 Wien')
    assert.equal(lieferadresseKurz({ bezeichnung: null, strasse: 'B 2', plz: '80331', ort: 'München', land: 'DE' }), 'B 2, 80331 München, DE')
  })
  test('Gleiche Adresse: Schreibweise und Leerraum egal, Empfänger zählt', () => {
    const a = { strasse: 'Lagerweg  3', plz: '3500', ort: 'krems', empfaenger: null }
    assert.equal(gleicheLieferadresse(a, { strasse: 'Lagerweg 3', plz: '3500', ort: 'Krems', land: 'AT' }), true)
    assert.equal(gleicheLieferadresse(a, { strasse: 'Lagerweg 3', plz: '3500', ort: 'Krems', empfaenger: 'Hr. X' }), false)
  })
})

describe('KAN-176: Datenbank und Verdrahtung', () => {
  test('Migration: genau ein Partner, kein DELETE, Fremdverweise, Momentaufnahme mit CHECK', () => {
    const m = migration()
    assert.match(m, /CONSTRAINT lieferadressen_ein_partner CHECK \(num_nonnulls\(kontakt_id, firma_id\) = 1\)/)
    assert.match(m, /REVOKE DELETE ON public\.lieferadressen FROM authenticated/)
    for (const s of ['z_fremdverweis_kontakt_id', 'z_fremdverweis_firma_id', 'z_fremdverweis_lieferadresse_id']) assert.ok(m.includes(s), s)
    for (const p of ['mitgliedschaft_aktiv', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del', 'zwei_faktor_aal']) {
      assert.ok(m.includes(`CREATE POLICY ${p} ON public.lieferadressen`), p)
    }
    assert.match(m, /ADD COLUMN lieferadresse\s+jsonb CHECK/)
    assert.match(m, /lieferadresse_id uuid REFERENCES public\.lieferadressen\(id\) ON DELETE SET NULL/)
  })
  test('Verkauf: gespeicherte Adresse muss zum Kunden gehören und aktiv sein; Momentaufnahme und id werden gespeichert', () => {
    const s = quelle(`${D}/weinhandel/verkauf/actions.ts`)
    assert.match(s, /a\.firma_id !== firmaId : a\.kontakt_id !== kontaktId/)
    assert.match(s, /!a\.aktiv/)
    assert.match(s, /lieferadresse:\s+liefer\?\.moment \?\? null/)
    assert.match(s, /lieferadresse_id: liefer\?\.id \?\? null/)
  })
  test('Ausgabe: Rechnung/Lieferschein, PDF und Mail-Versand lesen die Momentaufnahme', () => {
    assert.match(quelle(`${D}/weinhandel/verkauf/[id]/page.tsx`), /partner_daten, lieferadresse,/)
    assert.match(quelle('src/app/api/weinhandel/verkauf/[id]/send/route.ts'), /lieferadresse: lieferadresseZeilen\(posten\.lieferadresse/)
    const pdf = quelle('src/lib/pdf/verkaufRechnungPdf.tsx')
    assert.match(pdf, /lieferadresse\?: string\[\]/)
    assert.match(pdf, /Lieferadresse:/)
  })
  test('Transportbescheinigung: Ort/PLZ der Einlagerung aus der Lieferadresse, sonst Kunde', () => {
    const tb = quelle('src/lib/behoerden/transportbescheinigung.ts')
    assert.match(tb, /e_ort_einlagerung: feld\(liefer\?\.ort \?\? kunde\.ort\)/)
    assert.match(tb, /e_plz_einlagerung: feld\(liefer\?\.plz \?\? kunde\.plz\)/)
    assert.match(tb, /storno_grund, partner_daten, lieferadresse,/)
  })
  test('CRM: Lieferadressen auf Kontakt- und Firmenseite', () => {
    assert.match(quelle(`${D}/crm/kontakte/[id]/KontaktDetailClient.tsx`), /<LieferadressenKarte adressen=\{lieferadressen\} kontaktId=/)
    assert.match(quelle(`${D}/crm/firmen/[id]/FirmaDetailClient.tsx`), /<LieferadressenKarte adressen=\{lieferadressen\} firmaId=/)
  })
})
