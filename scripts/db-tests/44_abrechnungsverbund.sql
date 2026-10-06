-- @bereich: Abrechnungsverbund – Nebenmandanten über einen Hauptmandanten abrechnen (KAN-215)
-- @ziel: tenants.abrechnung_ueber verweist auf den Hauptmandanten; keine Selbstreferenz, keine Ketten (ein Hauptmandant
-- @ziel: ist nie selbst Nebenmandant, ein Nebenmandant nie Hauptmandant); individueller Preis nur mit Verbund und
-- @ziel: plausibel; Benutzer (auch Betriebsleiter) können Verbund und Preis nicht setzen – nur Service-Role/Plattform-Admin.
-- @mutation ketten_frei: Trigger a_abrechnungsverbund fehlt | rot: keine_kette_haupt_ist_neben
-- @mutation preis_frei: CHECK für den Preis fehlt | rot: preis_ohne_verbund
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 44 (Stand 06.10.2026, KAN-215). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '44_abrechnungsverbund';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_c     uuid;
  v_bta   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_a := pg_temp.s112_aufbau(true);
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_c := (v_a ->> 'c')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  UPDATE public.tenants SET abrechnung_ueber = NULL, zusatz_preis_cent = NULL WHERE id IN (v_m, v_b, v_c);

  PERFORM pg_temp.s112_mutiere('ketten_frei', $m$DROP TRIGGER a_abrechnungsverbund ON public.tenants$m$);
  PERFORM pg_temp.s112_mutiere('preis_frei', $m$ALTER TABLE public.tenants DROP CONSTRAINT tenants_zusatz_preis_chk$m$);

  -- ── 1. Verbund anlegen (Service-Kontext) ───────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('neben_anlegen',
    pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = %L, zusatz_preis_cent = 9900 WHERE id = %L', v_m, v_b)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zweiter_neben',
    pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = %L WHERE id = %L', v_m, v_c)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_selbst',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = id WHERE id = %L', v_m)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('keine_kette_haupt_ist_neben',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = %L WHERE id = %L', v_b, v_m)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('keine_kette_ueber_neben',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = %L WHERE id = %L', v_b, v_c)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('preis_ohne_verbund',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = NULL, zusatz_preis_cent = 5000 WHERE id = %L', v_c)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('preis_plausibel',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET zusatz_preis_cent = 0 WHERE id = %L', v_b)), 5), '23514');

  -- ── 2. Benutzer setzen nichts (Plattformfelder-Schutz) ─────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('benutzer_verlaesst_nicht',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET abrechnung_ueber = NULL WHERE id = %L', v_b)), 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('benutzer_preis_nicht',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET zusatz_preis_cent = 100 WHERE id = %L', v_b)), 5), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('verbund_unveraendert',
    (SELECT abrechnung_ueber::text || '|' || zusatz_preis_cent FROM public.tenants WHERE id = v_b), v_m::text || '|9900');

  -- ── 3. Hauptmandant gelöscht → Nebenmandant ohne Verbund (ON DELETE SET NULL, nur Struktur) ────────────
  v_erg := v_erg || pg_temp.s112_erwarte('fk_set_null',
    (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.tenants'::regclass AND contype = 'f'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tenants'::regclass AND attname = 'abrechnung_ueber')]::int2[])::text, 'n');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 11);
END $test$;
