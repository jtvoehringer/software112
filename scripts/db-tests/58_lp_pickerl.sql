-- @bereich: Gebinde – LP-Pickerl (Hinweis Lohnproduktion, KAN-174 F)
-- @ziel: behaelter.lp_pickerl ist ein reiner Hinweis: 1–60 Zeichen oder leer (CHECK), setzen und entfernen darf wer das
-- @ziel: Gebinde bearbeiten darf (Winzer mit Kellerbuch), nicht der Leser; lade_behaelter liefert den Wert mit.
-- @mutation ohne_pruefung: CHECK behaelter_lp_pickerl_chk entfernt | rot: pruefung_.*
-- @mutation rpc_ohne_pickerl: lade_behaelter liefert NULL statt lp_pickerl | rot: rpc_liefert_pickerl
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 58 (Stand 07.10.2026, KAN-174). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '58_lp_pickerl';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_beh   uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_beh := (pg_temp.s112_beispiel('behaelter', v_b) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_pruefung', $m$ALTER TABLE public.behaelter DROP CONSTRAINT behaelter_lp_pickerl_chk$m$);
  PERFORM pg_temp.s112_mutiere('rpc_ohne_pickerl', $m$
    CREATE OR REPLACE FUNCTION public.lade_behaelter(p_tenant_id uuid)
     RETURNS TABLE(id uuid, tenant_id uuid, name text, typ text, volumen_liter numeric, standort text, aktiv boolean, gemeinsam boolean, stapler boolean, notizen text, import_quelle text, eigentuemer_name text, fremd boolean, eigen_liter numeric, fremd_liter numeric, fremd_betrieb text, lp_pickerl text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
      SELECT b.id, b.tenant_id, b.name, b.typ, b.volumen_liter, b.standort, b.aktiv, b.gemeinsam, b.stapler, b.notizen, b.import_quelle,
             ''::text, false, 0::numeric, 0::numeric, NULL::text, NULL::text
        FROM behaelter b WHERE b.tenant_id = p_tenant_id
    $f$$m$);

  -- ── 1. Prüfregel ──────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('pruefung_leer',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.behaelter SET lp_pickerl = %L WHERE id = %L', '   ', v_beh)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('pruefung_zu_lang',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.behaelter SET lp_pickerl = %L WHERE id = %L', repeat('x', 61), v_beh)), ':', 1), '23514');

  -- ── 2. Setzen/Entfernen: Winzer ja, Leser nein ───────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_setzt_nicht',
    pg_temp.s112_versuch(format('UPDATE public.behaelter SET lp_pickerl = %L WHERE id = %L', 'Huber', v_beh)) <> 'k1', true);
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.behaelter SET lp_pickerl = %L WHERE id = %L', 'Huber', v_beh));
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_setzt', v_txt, 'ok');

  -- ── 3. lade_behaelter liefert den Wert ───────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_liefert_pickerl',
    (SELECT r.lp_pickerl FROM public.lade_behaelter(v_b) r WHERE r.id = v_beh), 'Huber');
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_entfernt',
    pg_temp.s112_versuch(format('UPDATE public.behaelter SET lp_pickerl = NULL WHERE id = %L', v_beh)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 6);
END $test$;
