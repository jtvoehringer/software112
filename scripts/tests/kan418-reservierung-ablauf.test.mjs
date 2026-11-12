// KAN-418 Teil 5 (12.11.2026): Standardfrist der Reservierung je Betrieb und Hinweis „Reservierungen abgelaufen“.
// Bisher galt fest „14 Tage“, und eine abgelaufene Reservierung fiel nur in der Auftragsliste auf – die Flaschen
// fehlten im verfügbaren Bestand, ohne dass jemand darauf gestoßen wurde.
//
// Aufruf:  npm run -s test:csv
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RESERVIERUNG_TAGE, abgelaufenText, reserviertBisVorschlag, reservierungAbgelaufen, reservierungTage, tageZwischen,
} from '../../src/lib/auftrag/regeln.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
function migration(name) {
  const dir = path.join(WURZEL, 'supabase', 'migrations')
  const datei = readdirSync(dir).find(d => d.endsWith(`_${name}.sql`))
  if (datei) return quelle(path.join('supabase', 'migrations', datei))
  const entwurf = path.join('supabase', 'entwurf', `${name}.sql`)
  assert.ok(existsSync(path.join(WURZEL, entwurf)), `Migration ${name} fehlt in supabase/migrations`)
  return quelle(entwurf)
}

describe('KAN-418 Teil 5: Standardfrist je Betrieb', () => {
  test('gültige Frist 1–365 Tage, sonst 14', () => {
    assert.equal(RESERVIERUNG_TAGE, 14)
    assert.equal(reservierungTage(30), 30)
    assert.equal(reservierungTage('7'), 7)
    assert.equal(reservierungTage(1), 1)
    assert.equal(reservierungTage(365), 365)
    for (const w of [0, 366, -3, 2.5, '', 'abc', null, undefined, NaN, '1e2']) assert.equal(reservierungTage(w), 14, String(w))
  })
  test('Vorschlag „Reserviert bis“ rechnet mit der Frist des Betriebs', () => {
    assert.equal(reserviertBisVorschlag('2026-11-12'), '2026-11-26')
    assert.equal(reserviertBisVorschlag('2026-11-12', 30), '2026-12-12')
    assert.equal(reserviertBisVorschlag('2026-12-20', 21), '2027-01-10')
    assert.equal(reserviertBisVorschlag('2026-11-12', 0), '2026-11-26')
  })
  test('Tage seit Ablauf – auch über die Zeitumstellung und den Jahreswechsel', () => {
    assert.equal(tageZwischen('2026-11-11', '2026-11-12'), 1)
    assert.equal(tageZwischen('2026-10-20', '2026-10-30'), 10)   // Zeitumstellung 25.10.2026
    assert.equal(tageZwischen('2026-12-30', '2027-01-02'), 3)
    assert.equal(tageZwischen('2026-11-12', '2026-11-12'), 0)
  })
  test('abgelaufen nur bei reservierendem Status und Frist vor heute', () => {
    assert.equal(reservierungAbgelaufen({ status: 'offen', reserviert_bis: '2026-11-11' }, '2026-11-12'), true)
    assert.equal(reservierungAbgelaufen({ status: 'teilgeliefert', reserviert_bis: '2026-11-11' }, '2026-11-12'), true)
    assert.equal(reservierungAbgelaufen({ status: 'offen', reserviert_bis: '2026-11-12' }, '2026-11-12'), false)
    assert.equal(reservierungAbgelaufen({ status: 'geliefert', reserviert_bis: '2026-11-01' }, '2026-11-12'), false)
    assert.equal(reservierungAbgelaufen({ status: 'storniert', reserviert_bis: '2026-11-01' }, '2026-11-12'), false)
  })
  test('Hinweistext mit Einzahl und Mehrzahl', () => {
    assert.equal(abgelaufenText(1), '1 Reservierung abgelaufen')
    assert.equal(abgelaufenText(3), '3 Reservierungen abgelaufen')
  })
})

describe('KAN-418 Teil 5: Migration', () => {
  const m = migration('kan418e_reservierung_standardfrist')
  test('Spalte mit Grenzen wie im Formular, lesbar per Spaltenrecht', () => {
    assert.match(m, /ADD COLUMN auftrag_reservierung_tage integer NOT NULL DEFAULT 14/)
    assert.match(m, /CHECK \(auftrag_reservierung_tage BETWEEN 1 AND 365\)/)
    assert.match(m, /GRANT SELECT \(auftrag_reservierung_tage\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    assert.doesNotMatch(m, /GRANT UPDATE/)
  })
  test('s112_auftrag_anlegen nimmt die Frist des Betriebs (genau eine Stelle, sonst Abbruch)', () => {
    assert.match(m, /c_alt constant text := 'v_datum \+ 14\);'/)
    assert.match(m, /SELECT e\.auftrag_reservierung_tage FROM public\.tenant_einstellungen e WHERE e\.tenant_id = p_tenant_id\), 14\)/)
    assert.match(m, /<> 1 THEN\s+RAISE EXCEPTION/)
  })
})

describe('KAN-418 Teil 5: Verdrahtung', () => {
  test('Lader: nur reservierende, nicht stornierte Aufträge mit Frist vor heute, vollständig und in fester Reihenfolge', () => {
    const l = quelle('src/lib/auftrag/laden.ts')
    const f = l.slice(l.indexOf('export async function ladeAbgelaufeneReservierungen'))
    assert.match(f, /\.eq\('tenant_id', tenantId\)\.eq\('art', 'auftrag'\)\.in\('status', \[\.\.\.RESERVIERT_STATUS\]\)\.is\('storniert_am', null\)/)
    assert.match(f, /\.lt\('reserviert_bis', heute\)\.order\('reserviert_bis'\)\.order\('erstellt_am'\)\.order\('id'\)/)
    assert.match(f, /alle<R>\(/)
    assert.match(f, /inBloecken<R>\(ids/)
    // jeder Lesefehler führt zum Abbruch, nicht zu einer leeren Liste („keine abgelaufenen“)
    assert.match(f, /if \(aErr\) throw new AktionsFehler/)
    assert.match(f, /const fehler = pos\.error \?\? kon\.error \?\? fir\.error\s+if \(fehler\) throw new AktionsFehler/)
    assert.match(l, /export async function ladeReservierungTage[\s\S]*?if \(error\) throw new AktionsFehler/)
  })
  test('neuer Auftrag: Vorschlag aus der Frist des Betriebs', () => {
    const p = quelle('src/app/(dashboard)/weinhandel/auftraege/neu/page.tsx')
    assert.match(p, /ladeReservierungTage\(supabase, tenantId\)/)
    assert.match(p, /reserviertBisVorschlag\(heute, fristTage\)/)
  })
  test('Mein Betrieb: Feld, Laden und Speichern mit denselben Grenzen', () => {
    const c = quelle('src/app/(dashboard)/betrieb/einstellungen/EinstellungenClient.tsx')
    assert.match(c, /name="auftrag_reservierung_tage" type="number" step="1" min="1" max="365" required/)
    const a = quelle('src/app/(dashboard)/betrieb/einstellungen/actions.ts')
    assert.match(a, /auftrag_reservierung_tage:\s+Math\.min\(365, Math\.max\(1, num\('auftrag_reservierung_tage'\)\s+\?\? 14\)\)/)
    assert.match(quelle('src/app/(dashboard)/betrieb/einstellungen/page.tsx'), /psm_erfassungsfrist_h, auftrag_reservierung_tage,/)
  })
  test('Dashboard: Karte nur im Verkaufsteil, Verlängern nur mit Schreibrecht Warenwirtschaft', () => {
    const s = quelle('src/app/(dashboard)/dashboard/_shared/VerkaufCrmSicht.tsx')
    assert.match(s, /mitVerkauf && tenantId\s+\? await Promise\.all\(\[ladeAbgelaufeneReservierungen\(supabase, tenantId, heuteStr\), ladeReservierungTage\(supabase, tenantId\)\]\)/)
    assert.match(s, /\{mitVerkauf && <ReservierungenAbgelaufenKarte auftraege=\{abgelaufen\}/)
    assert.match(s, /verlaengernBis=\{tagPlus\(heuteStr, fristTage\)\} schreiben=\{!!membership && canWrite\(membership, 'warenwirtschaft'\)\}/)
    const k = quelle('src/app/(dashboard)/dashboard/_shared/ReservierungenAbgelaufenKarte.tsx')
    assert.match(k, /if \(auftraege\.length === 0\) return null/)
    assert.match(k, /\{schreiben && \(/)
    assert.match(k, /await setzeReservierungBis\(a\.id, verlaengernBis\)/)
    // Ladezustand mit finally, Fehler am Ort (Sweep 82 / KAN-359)
    assert.match(k, /\} finally \{\s+setLaeuft\(null\)/)
    assert.match(k, /role="alert"/)
    // Stornieren braucht einen Grund → über den Auftrag, nicht per Knopf im Dashboard
    assert.doesNotMatch(k, /stornoAuftrag/)
  })
  test('Glocke: ein Sammelhinweis statt je Auftrag einer', () => {
    const r = quelle('src/app/api/dashboard/hinweise/route.ts')
    assert.match(r, /ladeAbgelaufeneReservierungen\(ctx\.supabase, ctx\.tenantId, ctx\.heuteStr\)/)
    assert.match(r, /if \(abgelaufen\.length > 0\) \{\s+hinweise\.push\(\{\s+key: 'reservierung:abgelaufen', titel: abgelaufenText\(abgelaufen\.length\)/)
    assert.match(r, /href: '\/weinhandel\/uebersicht'/)
  })
})
