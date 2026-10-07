// KAN-203 (07.10.2026) – Mostgewicht Teil D: Reife-Messungen je Ried und Mostgewicht im Gärverlauf (Laboranalyse),
// beide über MostgewichtEingabe (Messwert + Einheit, beide Werte gespeichert), Anzeige über MostgewichtAnzeige.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
// DB-Seite: DB-Test 60 (Abgleich-Trigger an beiden Tabellen, Pflicht-Mostgewicht, Bereich, Leser ohne Schreibrecht).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks } from './buchung-attrappe.mjs'

hooksRegistrieren()
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'
const migration = () => {
  const f = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan203_reife_gaer_mostgewicht.sql'))
  return quelle(f ? `supabase/migrations/${f}` : 'supabase/entwurf/kan203_reife_gaer_mostgewicht.sql')
}
const r = () => laden('lib/wein/reifemessung.ts')

describe('KAN-203: Reife-Messungen – Prüfung und Verlauf', nurMitHooks, () => {
  test('Verlauf: neueste zuerst, Zuwachs in °KMW gegenüber der vorigen Messung, Tage dazwischen', async () => {
    const { reifeVerlauf } = await r()
    const v = reifeVerlauf([
      { id: 'b', datum: '2026-09-08', kmw: 16.5, oechsle: 80.7, mostgewicht_einheit: 'kmw' },
      { id: 'a', datum: '2026-09-01', kmw: '15.70', oechsle: 76.8, mostgewicht_einheit: 'kmw' },
      { id: 'c', datum: '2026-09-15', kmw: 17.07, oechsle: 84, mostgewicht_einheit: 'oechsle' },
    ])
    assert.deepEqual(v.map(z => [z.messung.id, z.zuwachsKmw, z.tage]), [['c', 0.57, 7], ['b', 0.8, 7], ['a', null, null]])
  })
  test('Felder: Datum Pflicht und nicht in der Zukunft, Säure 0–50, pH 0–14; Zahlen mit Komma', async () => {
    const { reifeFelderFehler, reifeZahl } = await r()
    assert.equal(reifeZahl('6,8'), 6.8)
    assert.equal(reifeZahl(''), null)
    assert.ok(Number.isNaN(reifeZahl('abc')))
    assert.equal(reifeFelderFehler({ datum: '2026-10-07', gesamtsaeure_gl: 7.2, ph_wert: 3.25 }, '2026-10-07'), null)
    assert.match(reifeFelderFehler({ datum: '', gesamtsaeure_gl: null, ph_wert: null }, '2026-10-07'), /Datum/)
    assert.match(reifeFelderFehler({ datum: '2026-10-08', gesamtsaeure_gl: null, ph_wert: null }, '2026-10-07'), /Zukunft/)
    assert.match(reifeFelderFehler({ datum: '2026-10-01', gesamtsaeure_gl: 51, ph_wert: null }, '2026-10-07'), /Gesamtsäure/)
    assert.match(reifeFelderFehler({ datum: '2026-10-01', gesamtsaeure_gl: null, ph_wert: 15 }, '2026-10-07'), /pH/)
  })
})

describe('KAN-203: Datenbank und Verdrahtung', () => {
  test('Migration: reifemessungen mit Abgleich-Trigger, Pflicht-Mostgewicht und Schreibrecht Rieden; weinanalysen += Mostgewicht', () => {
    const m = migration()
    assert.match(m, /CREATE TABLE public\.reifemessungen/)
    assert.match(m, /CONSTRAINT reifemessungen_mostgewicht_pflicht CHECK \(kmw IS NOT NULL AND oechsle IS NOT NULL\)/)
    assert.match(m, /public\.s112_darf_schreiben\(tenant_id, 'rieden'\)/)
    assert.match(m, /CREATE POLICY zwei_faktor_aal ON public\.reifemessungen/)
    assert.match(m, /BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public\.reifemessungen\n\s+FOR EACH ROW EXECUTE FUNCTION public\.s112_mostgewicht_abgleichen\('kmw', 'oechsle', 'mostgewicht_einheit'\)/)
    assert.match(m, /BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public\.weinanalysen\n\s+FOR EACH ROW EXECUTE FUNCTION public\.s112_mostgewicht_abgleichen/)
    assert.match(m, /CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public\.reifemessungen/)
  })
  test('Ried: Reife-Messungen über MostgewichtEingabe, Server Action rechnet selbst', () => {
    const k = quelle(`${D}/weingarten/[id]/ReifeMessungen.tsx`)
    assert.match(k, /<MostgewichtEingabe name="mostgewicht" required/)
    assert.match(k, /<MostgewichtAnzeige wert=\{\{ kmw: r\.kmw, oechsle: r\.oechsle, einheit: r\.mostgewicht_einheit \}\} \/>/)
    const a = quelle(`${D}/weingarten/actions.ts`)
    assert.match(a, /export async function reifemessungSpeichern[\s\S]{0,400}await requireWrite\(\)[\s\S]{0,200}mostgewichtAusFormular\(formData, 'mostgewicht'\)/)
    assert.match(a, /\.\.\.mostgewichtSpalten\(mg\.wert, 'kmw'\)/)
    assert.match(quelle(`${D}/weingarten/[id]/page.tsx`), /<ReifeMessungen weingartenId=\{id\}/)
  })
  test('Gärkontrolle: Laboranalyse mit Mostgewicht – Formular, Action, Liste, Dashboard', () => {
    const f = quelle(`${D}/kellerbuch/weinausbau/[id]/analysen/neu/page.tsx`)
    assert.match(f, /<MostgewichtEingabe name="mostgewicht"/)
    assert.match(f, /!key\.startsWith\('mostgewicht_'\) \? dezimal\(value\) : value/)   // Messwert unverändert an die Action
    assert.match(quelle(`${D}/kellerbuch/actions.ts`), /if \(mg\.uebermittelt\) Object\.assign\(payload, mostgewichtSpalten\(mg\.wert, 'kmw'\)\)/)
    assert.match(quelle(`${D}/kellerbuch/weinausbau/[id]/analysen/page.tsx`), /<MostgewichtAnzeige wert=\{\{ kmw: a\.kmw, oechsle: a\.oechsle, einheit: a\.mostgewicht_einheit \}\} \/>/)
    assert.match(quelle(`${D}/dashboard/_shared/data.ts`), /gesamtsaeure_gl, kmw, oechsle, mostgewicht_einheit'\)/)
    assert.match(quelle(`${D}/dashboard/kellerbuch/ChargenKanban.tsx`), /<Kv k="Mostgewicht">/)
  })
})
