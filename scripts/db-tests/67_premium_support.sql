-- @bereich: Premium-Support als Zusatzpaket – Kennzeichen am Betrieb (KAN-226)
-- @ziel: tenants.premium_support_seit/_bis: Ende nie vor dem Beginn und nie ohne Beginn; Benutzer (auch
-- @ziel: Betriebsleiter) können Premium-Support nicht selbst setzen oder verlängern – nur Service-Role/Plattform-Admin.
-- @mutation zeitraum_frei: CHECK für den Zeitraum fehlt | rot: ende_vor_beginn
-- @mutation schutz_frei: Plattformfelder-Schutz auf tenants fehlt | rot: benutzer_bucht_nicht
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 67 (Stand 08.10.2026, KAN-226). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '67_premium_support';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_mta   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_a := pg_temp.s112_aufbau(true);
  v_m := (v_a ->> 'm')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  UPDATE public.tenants SET premium_support_seit = NULL, premium_support_bis = NULL WHERE id = v_m;

  PERFORM pg_temp.s112_mutiere('zeitraum_frei', $m$ALTER TABLE public.tenants DROP CONSTRAINT tenants_premium_support_chk$m$);
  PERFORM pg_temp.s112_mutiere('schutz_frei', $m$DROP TRIGGER a_schutz_plattformfelder ON public.tenants$m$);

  -- ── 1. Zeitraum (Service-Kontext) ──────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('buchen_unbefristet',
    pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_seit = DATE ''2026-10-01'' WHERE id = %L', v_m)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kuendigen_monatsende',
    pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_bis = DATE ''2026-10-31'' WHERE id = %L', v_m)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ein_tag',
    pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_bis = premium_support_seit WHERE id = %L', v_m)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ende_vor_beginn',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_bis = DATE ''2026-09-30'' WHERE id = %L', v_m)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ende_ohne_beginn',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_seit = NULL WHERE id = %L', v_m)), 5), '23514');

  -- ── 2. Benutzer setzen nichts (Plattformfelder-Schutz) ─────────────────────────────────────────────────
  UPDATE public.tenants SET premium_support_seit = DATE '2026-10-01', premium_support_bis = DATE '2026-10-31' WHERE id = v_m;
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('benutzer_verlaengert_nicht',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_bis = NULL WHERE id = %L', v_m)), 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('benutzer_bucht_nicht',
    left(pg_temp.s112_fehlertext(format('UPDATE public.tenants SET premium_support_seit = DATE ''2026-01-01'' WHERE id = %L', v_m)), 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('benutzer_liest',
    (SELECT premium_support_bis::text FROM public.tenants WHERE id = v_m), '2026-10-31');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('unveraendert',
    (SELECT premium_support_seit::text || '|' || premium_support_bis::text FROM public.tenants WHERE id = v_m), '2026-10-01|2026-10-31');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
