-- @bereich: Los-/Chargennummer der Füllung und Weinpass-Code (KAN-92)
-- @ziel: Die Los-/Chargennummer ist je Betrieb eindeutig (zweite gleiche Nummer im selben Betrieb → 23505), in einem
-- @ziel: anderen Betrieb erlaubt. Jede Füllung bekommt automatisch einen zufälligen, global eindeutigen Weinpass-Code
-- @ziel: (12 Hex-Zeichen). Nummer und Code sind nach dem Speichern per API nicht mehr änderbar (Freeze, 42501).
-- @mutation ohne_eindeutigkeit: Index fehlt – doppelte Nummer im selben Betrieb geht durch | rot: doppelt_im_betrieb
-- @mutation code_doppelt: Weinpass-Code nicht eindeutig | rot: code_global_eindeutig
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 56 (Stand 07.10.2026, KAN-92). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '56_losnummer_weinpass';
  c_fue   constant text := 'INSERT INTO public.fuellungen (tenant_id, name, datum, anzahl_flaschen, bestand_flaschen, flaschengroesse_ml, chargennummer, import_quelle) VALUES (%L, %L, current_date, 6, 6, 750, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_f1    uuid;
  v_fm    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_f1 := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, jsonb_build_object('chargennummer', 'S112TEST-L-1', 'storniert_am', NULL)) ->> 'id')::uuid;
  v_fm := (pg_temp.s112_beispiel('fuellungen', v_m, NULL, jsonb_build_object('chargennummer', 'S112TEST-L-9', 'storniert_am', NULL)) ->> 'id')::uuid;

  -- ── Mutation ──────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('ohne_eindeutigkeit', $m$DROP INDEX public.fuellungen_chargennummer_eindeutig$m$);
  PERFORM pg_temp.s112_mutiere('code_doppelt', $m$ALTER TABLE public.fuellungen DROP CONSTRAINT fuellungen_weinpass_code_eindeutig$m$);

  -- ── 1. Eindeutigkeit je Betrieb ───────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('doppelt_im_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST doppelt', 'S112TEST-L-1', 'eroeffnungsbestand')), ':', 1), '23505');
  v_erg := v_erg || pg_temp.s112_erwarte('neue_nummer_ok',
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST neu', 'S112TEST-L-2', 'eroeffnungsbestand')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_nummer_mehrfach_ok',
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST ohne', NULL, 'eroeffnungsbestand')) || '|' ||
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST ohne 2', NULL, 'eroeffnungsbestand')), 'ok|ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('andere_betrieb_gleiche_nummer_ok',
    pg_temp.s112_fehlertext(format(c_fue, v_m, 'S112TEST fremd', 'S112TEST-L-1', 'eroeffnungsbestand')), 'ok');

  -- ── 2. Weinpass-Code ──────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('code_automatisch',
    (SELECT (f.weinpass_code ~ '^[0-9a-f]{12}$')::text FROM public.fuellungen f WHERE f.id = v_f1), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('code_verschieden',
    (SELECT (a.weinpass_code <> b.weinpass_code)::text FROM public.fuellungen a, public.fuellungen b WHERE a.id = v_f1 AND b.id = v_fm), 'true');
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);   -- Wartung: Freeze aus, damit die Eindeutigkeit greift
  v_erg := v_erg || pg_temp.s112_erwarte('code_global_eindeutig',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.fuellungen SET weinpass_code = (SELECT weinpass_code FROM public.fuellungen WHERE id = %L) WHERE id = %L', v_fm, v_f1)), ':', 1), '23505');
  PERFORM set_config('s112.freeze_frei', '', true);

  -- ── 3. Unveränderlich per API (Freeze, KAN-101) ───────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_unveraenderlich',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.fuellungen SET chargennummer = %L WHERE id = %L', 'S112TEST-L-7', v_f1)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('code_unveraenderlich',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.fuellungen SET weinpass_code = %L WHERE id = %L', 'abcdefabcdef', v_f1)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
