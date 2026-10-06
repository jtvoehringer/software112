-- @bereich: Datierter Statuswechsel Most ↔ Wein (KAN-41 Paket 1) – RPC s112_charge_status_setzen
-- @ziel: Der Status einer Charge lässt sich zu einem Datum setzen; der Wechsel Most/Sturm → Wein bucht das
-- @ziel: Umstufungspaar AB_ABW/ZU_ABW im Kellerbuch-Journal an genau diesem Tag (nicht heute). Abgelehnt werden ein
-- @ziel: Datum in der Zukunft, im abgeschlossenen Kellerbuch-Zeitraum oder vor der letzten Bewegung der Charge, ein
-- @ziel: unbekannter Status, eine fremde Charge und Benutzer ohne Schreibrecht Kellerbuch.
-- @mutation datum_ignoriert: RPC setzt s112.umstufung_datum nicht | rot: paar_am_datum
-- @mutation ohne_letzte_bewegung: Prüfung „nicht vor die letzte Bewegung“ fehlt | rot: vor_letzter_bewegung
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 49 (Stand 06.10.2026, KAN-41). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t49_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't49_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei constant text := '49_charge_status_datiert';
  c_rpc   constant text := 'SELECT public.s112_charge_status_setzen(%L::uuid, %L::uuid, %L, %L::date)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_wa    uuid;
  v_wm    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Journal ab vor 30 Tagen, Most-Charge mit Bestand (Buchung vor 5 Tagen) ──────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = current_date - 30 WHERE tenant_id = v_b;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "status": "gaerung", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_wm := (pg_temp.s112_beispiel('weinausbau', v_m, NULL, '{"menge_liter": "100", "status": "gaerung"}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('kellerbuch_buchungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 500,
    'datum', current_date - 5, 'charge_status', 'gaerung', 'qualitaetsstufe', 'qualitaetswein'));

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('datum_ignoriert',
    $m$SELECT pg_temp.t49_ersetze('public.s112_charge_status_setzen(uuid, uuid, text, date)'::regprocedure,
      $r$PERFORM set_config\('s112.umstufung_datum', v_datum::text, true\);$r$, $r$NULL;$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_letzte_bewegung',
    $m$SELECT pg_temp.t49_ersetze('public.s112_charge_status_setzen(uuid, uuid, text, date)'::regprocedure,
      $r$IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Ablehnungen ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, 'ausbau', current_date + 1)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('vor_letzter_bewegung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, 'ausbau', current_date - 10)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('unbekannter_status',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, 'fertig', current_date)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wm, 'ausbau', current_date)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_wm, 'ausbau', current_date)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, 'ausbau', current_date)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.kellerbuch_abschluesse (tenant_id, abgeschlossen_bis, bemerkung) VALUES (v_b, current_date - 4, 'S112TEST');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_gesperrt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, 'ausbau', current_date - 4)), ':', 1), '42501');

  -- ── 2. Wechsel Gärung → Ausbau vor 3 Tagen ────────────────────────────────────────────────────────────
  EXECUTE format(c_rpc, v_b, v_wa, 'ausbau', current_date - 3);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('status_gesetzt',
    (SELECT status FROM public.weinausbau WHERE id = v_wa), 'ausbau');
  v_erg := v_erg || pg_temp.s112_erwarte('paar_am_datum',
    (SELECT string_agg(k.buchungsart_code || '@' || (current_date - k.datum)::text, ',' ORDER BY k.buchungsart_code)
       FROM public.kellerbuch_buchungen k WHERE k.weinausbau_id = v_wa AND k.buchungsart_code IN ('AB_ABW', 'ZU_ABW')),
    'AB_ABW@3,ZU_ABW@3');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
