-- @bereich: Lückenlose Rechnungsnummern (KAN-21)
-- @ziel: Die Rechnungsnummer vergibt die Datenbank beim Anlegen des Belegs (Trigger a_rechnungsnummer, gleiche Transaktion
-- @ziel: wie der Zähler) – fortlaufend; per API lässt sich weder eine Nummer mitschicken noch ändern, und der Zähler ist
-- @ziel: per RPC nicht mehr erreichbar. Wartung/Import (Service-Role) darf Nummern setzen, aber keine doppelten.
-- @mutation trigger_weg: kein Trigger a_rechnungsnummer | rot: vergabe_im_insert|api_nummer_abgelehnt|api_aendern_abgelehnt
-- @mutation rpc_wieder_frei: authenticated darf get_next_rechnungsnummer wieder ausführen | rot: rpc_gesperrt
-- @mutation index_weg: kein eindeutiger Index je Betrieb | rot: doppelt_abgelehnt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 47 (Stand 06.10.2026, KAN-21). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '47_rechnungsnummer';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_mw    uuid;
  v_z0    integer;
  v_z1    integer;
  v_nr1   text;
  v_nr2   text;
  v_id1   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  SELECT rechnung_zaehler INTO v_z0 FROM public.tenant_einstellungen WHERE tenant_id = v_m;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('trigger_weg', $m$DROP TRIGGER a_rechnungsnummer ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('rpc_wieder_frei', $m$GRANT EXECUTE ON FUNCTION public.get_next_rechnungsnummer(uuid) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('index_weg', $m$DROP INDEX public.verkaufsposten_rechnungsnummer_eindeutig$m$);

  -- ── 1. Vergabe im Insert durch den Mitarbeiter ────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mw);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_m, v_heute, 'S112TEST KAN-21 a')
    RETURNING id, rechnungsnummer INTO v_id1, v_nr1;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_m, v_heute, 'S112TEST KAN-21 b')
    RETURNING rechnungsnummer INTO v_nr2;
  v_erg := v_erg || pg_temp.s112_erwarte('vergabe_im_insert', v_nr1 IS NOT NULL AND v_nr2 IS NOT NULL AND v_nr1 <> v_nr2, true);
  v_erg := v_erg || pg_temp.s112_erwarte('api_nummer_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.verkaufsposten (tenant_id, datum, rechnungsnummer) VALUES (%L, pg_temp.s112_heute(), %L)', v_m, 'S112TEST-1')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('api_aendern_abgelehnt',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET rechnungsnummer = %L WHERE id = %L', 'S112TEST-2', v_id1)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('api_andere_felder_ok',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET notizen = %L WHERE id = %L', 'S112TEST geändert', v_id1)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_gesperrt',
    pg_temp.s112_versuch(format('SELECT public.get_next_rechnungsnummer(%L)', v_m)), 'G');
  PERFORM pg_temp.s112_als_postgres();

  -- fortlaufend: der Zähler steht genau zwei weiter, die zweite Nummer folgt auf die erste
  SELECT rechnung_zaehler INTO v_z1 FROM public.tenant_einstellungen WHERE tenant_id = v_m;
  v_erg := v_erg || pg_temp.s112_erwarte('zaehler_plus_zwei', v_z1 - v_z0, 2);
  v_erg := v_erg || pg_temp.s112_erwarte('fortlaufend',
    (regexp_replace(v_nr2, '^.*?-0*([0-9]+).*$', '\1'))::integer - (regexp_replace(v_nr1, '^.*?-0*([0-9]+).*$', '\1'))::integer, 1);

  -- ── 2. Wartung (postgres/Service-Role): eigene Nummer erlaubt, doppelte nicht ───────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_eigene_nummer',
    pg_temp.s112_versuch(format('INSERT INTO public.verkaufsposten (tenant_id, datum, rechnungsnummer) VALUES (%L, pg_temp.s112_heute(), %L)', v_m, 'S112TEST-WARTUNG')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('doppelt_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.verkaufsposten (tenant_id, datum, rechnungsnummer) VALUES (%L, pg_temp.s112_heute(), %L)', v_m, v_nr1)), 'E23505');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
