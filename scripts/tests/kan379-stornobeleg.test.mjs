// KAN-379 (27.10.2026): Storno einer Rechnung als Stornobeleg (Gegenbuchung) im offenen Zeitraum – Migration
// (supabase/migrations/*_kan379_stornobeleg.sql bzw. lokal der Entwurf), DB-Test 86 und Einstufung in _helfer.sql.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const quelle = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const mig = readdirSync(new URL('../../supabase/migrations', import.meta.url)).find(n => n.endsWith('_kan379_stornobeleg.sql'))
const pfad = mig ? `supabase/migrations/${mig}` : 'supabase/entwurf/kan379_stornobeleg.sql'
const da = existsSync(new URL(`../../${pfad}`, import.meta.url))
const ohne = da ? false : 'Entwurf nur lokal (supabase/entwurf ist nicht eingecheckt)'
const s = da ? quelle(pfad) : ''
const funktion = name => {
  const a = s.indexOf(`FUNCTION public.${name}(`)
  assert.ok(a >= 0, name)
  return s.slice(a, s.indexOf('$function$;', a))
}

describe('KAN-379: Migration', () => {
  test('Spalten, Prüfungen, Indizes und Fremdverweis-Trigger an rechnungen', { skip: ohne }, () => {
    assert.match(s, /ADD COLUMN art +text NOT NULL DEFAULT 'rechnung'/)
    assert.match(s, /ADD COLUMN storno_von_id +uuid REFERENCES public\.rechnungen\(id\) ON DELETE CASCADE/)
    assert.match(s, /ADD COLUMN storniert_durch_id uuid REFERENCES public\.rechnungen\(id\) ON DELETE SET NULL/)
    assert.match(s, /CHECK \(\(art = 'storno'\) = \(storno_von_id IS NOT NULL\)\)/)
    assert.match(s, /CHECK \(art = 'rechnung' OR \(NOT storniert AND storniert_durch_id IS NULL\)\)/)
    assert.match(s, /CREATE UNIQUE INDEX rechnungen_storno_von_idx ON public\.rechnungen \(storno_von_id\);/)
    assert.match(s, /CREATE INDEX rechnungen_storniert_durch_idx ON public\.rechnungen \(storniert_durch_id\);/)
    for (const sp of ['storno_von_id', 'storniert_durch_id']) {
      assert.match(s, new RegExp(`CREATE TRIGGER z_fremdverweis_${sp} BEFORE INSERT OR UPDATE OF ${sp}, tenant_id ON public\\.rechnungen\\s+FOR EACH ROW EXECUTE FUNCTION public\\.s112_fremdverweis_pruefen\\('${sp}', 'rechnungen', '', '', ''\\);`), sp)
    }
    assert.match(s, /GRANT SELECT \(storno_prefix, storno_stellen, storno_zaehler\) ON public\.tenant_einstellungen TO authenticated, anon;/)
    // Muster zusammengesetzt, damit check-replica diese Testdatei nicht selbst meldet
    assert.doesNotMatch(s.replace(/--.*$/gm, ''), new RegExp('session_' + 'replication_role|DISABLE ' + 'TRIGGER'))
  })

  test('Interne Funktionen ohne EXECUTE für Benutzer, RPCs mit Zugriffs-, Abo- und Modulprüfung', { skip: ohne }, () => {
    for (const f of ['s112_stornonummer_ziehen(uuid, date)', 's112_stornobeleg_anlegen(uuid, uuid, text, date)']) {
      assert.ok(s.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f)
    }
    for (const f of ['s112_rechnung_stornieren(uuid, uuid, text, date)', 's112_verkauf_samt_rechnung_stornieren(uuid, uuid, text, date)']) {
      assert.ok(s.includes(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`), f)
      assert.ok(s.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`), f)
    }
    for (const fn of ['s112_rechnung_stornieren', 's112_verkauf_samt_rechnung_stornieren']) {
      const b = funktion(fn)
      assert.match(b, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, ARRAY\['system_admin', 'tenant_admin', 'winzer'\]\);\s+PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);\s+PERFORM public\.s112_pruefe_schreibmodul\(p_tenant_id, 'warenwirtschaft'\);/, fn)
      assert.match(b, /p_datum date DEFAULT NULL/, fn)
    }
    for (const fn of ['s112_stornonummer_ziehen', 's112_stornobeleg_anlegen', 's112_rechnung_stornieren', 's112_verkauf_samt_rechnung_stornieren']) {
      assert.match(funktion(fn), /SECURITY DEFINER\s+SET search_path = public/, fn)
    }
  })

  test('Rechnungsstorno: Zahlungen weiter zuerst, BMD-Sperre entfällt, Stornobeleg über den einen Weg', { skip: ohne }, () => {
    const r = funktion('s112_rechnung_stornieren')
    assert.match(r, /HINT = 'rechnung_zahlungen'/)
    assert.doesNotMatch(r, /bmd_export_id|rechnung_bmd/)
    assert.match(r, /v_id := public\.s112_stornobeleg_anlegen\(p_tenant_id, p_rechnung_id, v_grund,\s+coalesce\(p_datum, \(now\(\) AT TIME ZONE 'Europe\/Vienna'\)::date\)\);/)
    assert.match(funktion('s112_verkauf_samt_rechnung_stornieren'), /s112_rechnung_stornieren\(p_tenant_id, v_r\.id, v_grund, v_datum\)[\s\S]*s112_fuellung_verkauf_buchen\(p_tenant_id, v_pos\.fuellung_id, p_verkaufsposten_id, v_pos\.stueck, v_datum, v_grund\)/)
    assert.match(funktion('s112_rechnung_spiegeln'), /PERFORM public\.s112_stornobeleg_anlegen\(NEW\.tenant_id, NEW\.rechnung_id, NEW\.storno_grund,/)
  })

  test('Stornobeleg: Datum im offenen Zeitraum, nicht vor der Rechnung, nicht in der Zukunft; Original mit Momentaufnahme', { skip: ohne }, () => {
    const b = funktion('s112_stornobeleg_anlegen')
    assert.match(b, /IF p_datum < v_r\.datum THEN/)
    assert.match(b, /IF p_datum > greatest\(v_heute, v_r\.datum\) THEN/)
    assert.match(b, /v_sperre := public\.s112_ea_zeitraum_sperrgrund\(p_tenant_id, p_datum\);/)
    assert.match(b, /'Storno mit Datum % nicht möglich: % Bitte ein Storno-Datum im offenen Zeitraum wählen\.'/)
    assert.match(b, /IF v_r\.art = 'storno' THEN/)
    assert.match(b, /PERFORM set_config\('s112\.rechnung_storno', v_r\.id::text, true\);[\s\S]*storniert_durch_id = v_id,[\s\S]*storno_positionen = \([\s\S]*PERFORM set_config\('s112\.rechnung_storno', '', true\);/)
    assert.match(funktion('s112_stornonummer_ziehen'), /RETURN v_prefix \|\| '-' \|\| to_char\(p_datum, 'YYYY'\) \|\| '-' \|\| lpad\(v_nummer::text, v_stellen, '0'\);/)
  })

  test('Periodensperre: Storno nur über den Stornobeleg, die vorläufige Sperre aus KAN-355 entfällt', { skip: ohne }, () => {
    const p = funktion('s112_rechnung_periodensperre')
    assert.match(p, /current_setting\('s112\.rechnung_storno', true\) IS DISTINCT FROM OLD\.id::text/)
    assert.match(p, /HINT = 'stornobeleg'/)
    assert.doesNotMatch(p, /periodensperre_storno|folgt mit KAN-379/)
    assert.match(p, /IF OLD\.aktiv AND NOT NEW\.aktiv THEN/)
  })

  test('UVA (Doppik): Original aus der Momentaufnahme in seinem Zeitraum, Stornobeleg negativ in seinem', { skip: ohne }, () => {
    const u = funktion('berechne_ea_uva')
    assert.match(u, /AND r\.art = 'rechnung'\s+AND r\.aktiv AND NOT r\.storniert/)
    assert.match(u, /AND o\.storniert AND o\.storniert_durch_id IS NOT NULL\s+AND o\.datum BETWEEN v_von AND v_bis/)
    assert.match(u, /SELECT s\.id, -1, x\.pos[\s\S]*AND s\.art = 'storno' AND s\.aktiv\s+AND s\.datum BETWEEN v_von AND v_bis/)
  })
})

describe('KAN-379: DB-Tests', () => {
  test('DB-Test 86 mit den Kernprüfungen und Mutationen; 70, 83, 85 auf die neue Signatur', () => {
    const t = quelle('scripts/db-tests/86_stornobeleg.sql')
    assert.match(t, /c_datei constant text := '86_stornobeleg'/)
    for (const n of ['datum_gesperrt', 'datum_vor_rechnung', 'datum_zukunft', 'beleg', 'spiegel_beleg', 'uva_alt_unveraendert',
      'uva_neu_negativ', 'bmd_storno_ok', 'stornobeleg_nicht_stornierbar', 'direkt_abgelehnt', 'samt_rechnung_datum', 'leser_abgelehnt']) {
      assert.match(t, new RegExp(`'${n}'`), n)
    }
    for (const m of ['ohne_momentaufnahme', 'ohne_gegenbuchung', 'ohne_datumspruefung']) assert.match(t, new RegExp(`s112_mutiere\\('${m}'`), m)
    assert.match(quelle('scripts/db-tests/70_rechnung_spaeter.sql'), /public\.s112_rechnung_stornieren\(uuid, uuid, text, date\)'::regprocedure/)
    assert.match(quelle('scripts/db-tests/85_verkauf_samt_rechnung_storno.sql'), /public\.s112_verkauf_samt_rechnung_stornieren\(uuid,uuid,text,date\)'/)
    assert.match(quelle('scripts/db-tests/83_rechnung_periodensperre.sql'), /'storno_direkt_abgelehnt'/)
  })
  test('Einstufung der Funktionen in _helfer.sql', () => {
    const h = quelle('scripts/db-tests/_helfer.sql')
    assert.match(h, /\('intern', +'--S', false, 's112_stornonummer_ziehen\(p_tenant_id uuid, p_datum date\)'\)/)
    assert.match(h, /\('intern', +'--S', false, 's112_stornobeleg_anlegen\(p_tenant_id uuid, p_rechnung_id uuid, p_grund text, p_datum date\)'\)/)
    assert.match(h, /\('mandant', +'-US', true , 's112_rechnung_stornieren\(p_tenant_id uuid, p_rechnung_id uuid, p_grund text, p_datum date\)'\)/)
    assert.match(h, /\('mandant', +'-US', true , 's112_verkauf_samt_rechnung_stornieren\(p_tenant_id uuid, p_verkaufsposten_id uuid, p_grund text, p_datum date\)'\)/)
  })
})
