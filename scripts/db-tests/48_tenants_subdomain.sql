-- @bereich: Betriebs-Subdomain (KAN-31)
-- @ziel: tenants.subdomain legen nur Plattform-Admins bzw. die Service-Role fest (Betriebsleiter: 42501 über
-- @ziel: a_schutz_plattformfelder); gültig sind nur Kurznamen nach Muster ohne reservierte Namen, je Betrieb eindeutig;
-- @ziel: Mitglieder lesen die Subdomain ihres Betriebs (für die Betriebswahl), fremde nicht.
-- @mutation check_weg: kein CHECK tenants_subdomain_check | rot: reserviert_abgelehnt|muster_abgelehnt
-- @mutation index_weg: kein eindeutiger Index tenants_subdomain_uidx | rot: doppelt_abgelehnt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 48 (Stand 06.10.2026, KAN-31). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '48_tenants_subdomain';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_mta   uuid;
  v_bta   uuid;
  v_pa    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_pa := (v_a ->> 'pa')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('check_weg', $m$ALTER TABLE public.tenants DROP CONSTRAINT tenants_subdomain_check$m$);
  PERFORM pg_temp.s112_mutiere('index_weg', $m$DROP INDEX public.tenants_subdomain_uidx$m$);

  -- ── 1. Wartung: gültig, reserviert, Muster, doppelt ─────────────────────────────────────────────────────
  UPDATE public.tenants SET subdomain = 's112test-b' WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('reserviert_abgelehnt',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET subdomain = %L WHERE id = %L', 'admin', v_m)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('muster_abgelehnt',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET subdomain = %L WHERE id = %L', 'Gebes_Huber', v_m)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('doppelt_abgelehnt',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET subdomain = %L WHERE id = %L', 's112test-b', v_m)), 'E23505');

  -- ── 2. Betriebsleiter: lesen ja, setzen nein ──────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('mitglied_liest',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L AND subdomain = %L', v_b, 's112test-b')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('betriebsleiter_setzt_nicht',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET subdomain = %L WHERE id = %L', 's112test-x', v_b)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_lesen_nicht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L AND subdomain IS NOT DISTINCT FROM subdomain', v_m)), '0');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_subdomain_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE subdomain = %L', 's112test-b')), '0');

  -- ── 3. Plattform-Admin darf ───────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('plattform_admin_setzt',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET subdomain = %L WHERE id = %L', 's112test-m', v_m)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 8);
END $test$;
