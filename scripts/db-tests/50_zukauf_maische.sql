-- @bereich: Zukauf Maische (KAN-41 Paket 2a) – Art, Journal der Pressung, Genealogie
-- @ziel: zukauf_posten.art kennt 'maische'. Eine Pressung aus eigenen Trauben, zugekauften Trauben und zugekaufter
-- @ziel: Maische bucht den Most anteilig nach kg: ERNTE (eigene), ZK_TRAUB (Trauben-Zukauf) und ZK_MAISC (Maische-Zukauf)
-- @ziel: – jeweils mit dem Zukauf als Bezug. In charge_herkunft ist ZK_MAISC wie ZK_TRAUB eine Wurzel ohne Quell-Charge.
-- @mutation maische_als_trauben: Zeilenfunktion bucht Maische als ZK_TRAUB | rot: journal_split
-- @mutation herkunft_ohne_maische: charge_herkunft ohne ZK_MAISC | rot: herkunft_wurzel
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 50 (Stand 06.10.2026, KAN-41). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t50_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't50_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t50_view_ohne_maische() RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_def text := pg_get_viewdef('public.charge_herkunft'::regclass);
  v_neu text := replace(v_def, '''ZK_MAISC''::text, ', '');
BEGIN
  IF v_neu = v_def THEN
    RAISE EXCEPTION 't50_view_ohne_maische: ZK_MAISC nicht in charge_herkunft gefunden';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.charge_herkunft WITH (security_invoker = true) AS ' || v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '50_zukauf_maische';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_wa    uuid;
  v_zt    uuid;
  v_zm    uuid;
  v_p     uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('maische_als_trauben',
    $m$SELECT pg_temp.t50_ersetze('public.s112_journal_zeilen_pressung(jsonb, numeric, numeric, numeric, uuid, uuid)'::regprocedure,
      $r$'code', 'ZK_MAISC'$r$, $r$'code', 'ZK_TRAUB'$r$)$m$);
  PERFORM pg_temp.s112_mutiere('herkunft_ohne_maische', $m$SELECT pg_temp.t50_view_ohne_maische()$m$);

  -- ── 0. Aufbau (als postgres): Journal ab vor 30 Tagen, Most-Charge, je ein Zukauf Trauben und Maische ──────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "0", "status": "ernte", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_zt := (pg_temp.s112_beispiel('zukauf_posten', v_b, NULL, jsonb_build_object('art', 'trauben', 'einheit', 'kg', 'menge', 300,
    'datum', v_heute - 3, 'ziel_weinausbau_id', NULL)) ->> 'id')::uuid;
  v_zm := (pg_temp.s112_beispiel('zukauf_posten', v_b, NULL, jsonb_build_object('art', 'maische', 'einheit', 'kg', 'menge', 300,
    'datum', v_heute - 3, 'ziel_weinausbau_id', NULL)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('art_check',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET art = %L WHERE id = %L', 'saft', v_zm)), ':', 1), '23514');

  -- ── 1. Pressung 1.200 l aus 600 kg eigenen Trauben, 300 kg Trauben- und 300 kg Maische-Zukauf ─────────────
  v_p := (pg_temp.s112_beispiel('pressungen', v_b, NULL, jsonb_build_object('datum', v_heute - 2, 'storniert_am', NULL)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('pressung_weingaerten', v_b, NULL, jsonb_build_object('pressung_id', v_p, 'trauben_kg', 600, 'storniert_am', NULL));
  PERFORM pg_temp.s112_beispiel('pressung_weingaerten', v_b, NULL, jsonb_build_object('pressung_id', v_p, 'trauben_kg', 300, 'storniert_am', NULL,
    'weingarten_id', NULL, 'zukauf_posten_id', v_zt));
  PERFORM pg_temp.s112_beispiel('pressung_weingaerten', v_b, NULL, jsonb_build_object('pressung_id', v_p, 'trauben_kg', 300, 'storniert_am', NULL,
    'weingarten_id', NULL, 'zukauf_posten_id', v_zm));
  PERFORM pg_temp.s112_beispiel('pressung_behaelter', v_b, NULL, jsonb_build_object('pressung_id', v_p, 'weinausbau_id', v_wa,
    'menge_liter', 1200, 'storniert_am', NULL));

  v_erg := v_erg || pg_temp.s112_erwarte('journal_split',
    (SELECT string_agg(k.buchungsart_code || '=' || k.menge_liter::numeric(10, 0)::text, ',' ORDER BY k.buchungsart_code)
       FROM public.kellerbuch_buchungen k WHERE k.weinausbau_id = v_wa AND k.quelle_tabelle = 'pressung_behaelter'),
    'ERNTE=600,ZK_MAISC=300,ZK_TRAUB=300');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_bezug',
    (SELECT string_agg(k.buchungsart_code || ':' || (k.zukauf_posten_id = CASE k.buchungsart_code WHEN 'ZK_MAISC' THEN v_zm ELSE v_zt END)::text,
                       ',' ORDER BY k.buchungsart_code)
       FROM public.kellerbuch_buchungen k WHERE k.weinausbau_id = v_wa AND k.buchungsart_code IN ('ZK_TRAUB', 'ZK_MAISC')),
    'ZK_MAISC:true,ZK_TRAUB:true');
  v_erg := v_erg || pg_temp.s112_erwarte('herkunft_wurzel',
    (SELECT string_agg(h.art || ':' || (h.von_weinausbau_id IS NULL)::text, ',' ORDER BY h.art)
       FROM public.charge_herkunft h WHERE h.nach_weinausbau_id = v_wa AND h.zukauf_posten_id = v_zm),
    'ZK_MAISC:true');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 4);
END $test$;
