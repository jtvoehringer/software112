-- @bereich: PSM-Übermittlung (KAN-120) – behandlungen.version, psm_uebermittlungen, s112_psm_uebermittlung_protokollieren
-- @ziel: Eine Maßnahme beginnt mit Version 1; jede inhaltliche Änderung zählt hoch, Notizen nicht, direkt setzen geht nicht.
-- @ziel: Der Export-Lauf protokolliert je Maßnahme Version, Kanal, Hash und Zeilen; ein erneuter Export ist „korrektur“.
-- @ziel: Das Protokoll ist per API nur lesbar (kein INSERT/UPDATE/DELETE), Leser dürfen nicht protokollieren, fremde
-- @ziel: Maßnahmen und ungültige Hashes/Kanäle werden abgelehnt.
-- @mutation ohne_korrektur: erneuter Export wird nicht als Korrektur erkannt | rot: zweiter_export_korrektur
-- @mutation version_starr: Version zählt bei Änderung nicht hoch | rot: version_nach_aenderung
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 72 (Stand 08.10.2026, KAN-120). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t72_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't72_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei constant text := '72_psm_uebermittlungen';
  c_rpc   constant text := 'SELECT public.s112_psm_uebermittlung_protokollieren(%L::uuid, %L, %L::jsonb)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_m     uuid;
  v_beh   uuid;
  v_mbeh  uuid;
  v_ex1   uuid;
  v_ex2   uuid;
  v_hash  text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_hash := repeat('a', 64);

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_beh := (pg_temp.s112_beispiel('behandlungen', v_b, v_bw, '{"storniert_am": null, "aufwandmenge": 1}') ->> 'id')::uuid;
  v_mbeh := (pg_temp.s112_beispiel('behandlungen', v_m, NULL, '{"storniert_am": null}') ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_korrektur',
    $m$SELECT pg_temp.t72_ersetze('public.s112_psm_uebermittlung_protokollieren(uuid, text, jsonb)'::regprocedure,
      $r$THEN 'korrektur' ELSE 'exportiert' END$r$, $r$THEN 'exportiert' ELSE 'exportiert' END$r$)$m$);
  PERFORM pg_temp.s112_mutiere('version_starr',
    $m$SELECT pg_temp.t72_ersetze('public.s112_behandlung_version()'::regprocedure,
      $r$NEW\.version := OLD\.version \+ 1;$r$, $r$NEW.version := OLD.version;$r$)$m$);

  -- ── 1. Version ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('version_neu', (SELECT version FROM public.behandlungen WHERE id = v_beh), 1);
  UPDATE public.behandlungen SET aufwandmenge = 2 WHERE id = v_beh;
  v_erg := v_erg || pg_temp.s112_erwarte('version_nach_aenderung', (SELECT version FROM public.behandlungen WHERE id = v_beh), 2);
  UPDATE public.behandlungen SET notizen = 'S112TEST nur Notiz' WHERE id = v_beh;
  v_erg := v_erg || pg_temp.s112_erwarte('version_notiz_gleich', (SELECT version FROM public.behandlungen WHERE id = v_beh), 2);
  UPDATE public.behandlungen SET version = 99 WHERE id = v_beh;
  v_erg := v_erg || pg_temp.s112_erwarte('version_nicht_setzbar', (SELECT version FROM public.behandlungen WHERE id = v_beh), 2);

  -- ── 2. Export-Lauf: exportiert, dann Korrektur ────────────────────────────────────────────────────────
  v_ex1 := public.s112_psm_uebermittlung_protokollieren(v_b, 'csv-datei',
    jsonb_build_array(jsonb_build_object('behandlung_id', v_beh, 'hash', v_hash, 'zeilen', 3)));
  v_erg := v_erg || pg_temp.s112_erwarte('erster_export',
    (SELECT concat_ws('|', u.status, u.version, u.kanal, u.zeilen, u.exportiert_von = v_bw, u.export_id = v_ex1)
       FROM public.psm_uebermittlungen u WHERE u.behandlung_id = v_beh), 'exportiert|2|csv-datei|3|t|t');
  UPDATE public.behandlungen SET aufwandmenge = 3 WHERE id = v_beh;
  v_ex2 := public.s112_psm_uebermittlung_protokollieren(v_b, 'csv-datei',
    jsonb_build_array(jsonb_build_object('behandlung_id', v_beh, 'hash', repeat('b', 64), 'zeilen', 3)));
  v_erg := v_erg || pg_temp.s112_erwarte('zweiter_export_korrektur',
    (SELECT concat_ws('|', u.status, u.version) FROM public.psm_uebermittlungen u WHERE u.export_id = v_ex2), 'korrektur|3');

  -- ── 3. Protokoll per API nur lesbar ───────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('lesen',
    pg_temp.s112_versuch(format('SELECT 1 FROM public.psm_uebermittlungen WHERE behandlung_id = %L', v_beh)), 'k2');
  v_erg := v_erg || pg_temp.s112_erwarte('insert_verboten',
    pg_temp.s112_versuch(format('INSERT INTO public.psm_uebermittlungen (tenant_id, behandlung_id, export_id, version, kanal, status, hash, zeilen) VALUES (%L, %L, gen_random_uuid(), 1, %L, %L, %L, 1)',
      v_b, v_beh, 'csv-datei', 'exportiert', v_hash)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('update_wirkungslos',
    pg_temp.s112_versuch(format('UPDATE public.psm_uebermittlungen SET zeilen = 9 WHERE behandlung_id = %L', v_beh)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('delete_wirkungslos',
    pg_temp.s112_versuch(format('DELETE FROM public.psm_uebermittlungen WHERE behandlung_id = %L', v_beh)), 'k0');

  -- ── 4. Ablehnungen: ungültiger Hash, Kanal, fremde Maßnahme, Leser ────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('hash_ungueltig',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, 'csv-datei', jsonb_build_array(jsonb_build_object('behandlung_id', v_beh, 'hash', 'abc', 'zeilen', 1)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('kanal_unbekannt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, 'api', jsonb_build_array(jsonb_build_object('behandlung_id', v_beh, 'hash', v_hash, 'zeilen', 1)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_massnahme',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, 'csv-datei', jsonb_build_array(jsonb_build_object('behandlung_id', v_mbeh, 'hash', v_hash, 'zeilen', 1)))), ':', 1), 'P0002');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, 'csv-datei', jsonb_build_array(jsonb_build_object('behandlung_id', v_beh, 'hash', v_hash, 'zeilen', 1)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 14);
END $test$;
