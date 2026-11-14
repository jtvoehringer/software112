-- @bereich: Leserechte je Profil (KAN-459) – wer einen Bereich nicht liest, schreibt dort auch nicht
-- @ziel: Die Sperr-Policy „lesebereich“ gilt auf jeder Tabelle für alle Befehle (RESTRICTIVE FOR ALL, USING = WITH
-- @ziel: CHECK), ebenso auf storage.objects. Befund: Sie galt nur für SELECT – „Extern“ (Schreibmodul Rieden) konnte in
-- @ziel: 25 Tabellen außerhalb seiner Lesebereiche anlegen (grundstueck_recht, Mittel, Kostenstellen …) und Zeilen ohne
-- @ziel: Filter ändern oder löschen, weil ein UPDATE/DELETE ohne WHERE keine Spalte liest und die SELECT-Policy dann
-- @ziel: nicht greift. Im eigenen Bereich und ohne Profil ändert sich nichts.
-- @mutation nur_lesen_recht: lesebereich auf grundstueck_recht wieder nur für SELECT | rot: extern_recht_.*|katalog_.*
-- @mutation nur_lesen_psm: lesebereich auf pflanzenschutzmittel wieder nur für SELECT | rot: extern_psm_.*|katalog_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 07 (Stand 14.11.2026, KAN-459). Alles zurückgerollt.

-- 'ok' bzw. '<SQLSTATE>|<HINT>' einer Anweisung als gerade aktive Rolle
CREATE FUNCTION pg_temp.t07s(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_state text;
  v_hint  text;
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
  RETURN v_state || '|' || coalesce(v_hint, '');
END $f$;

DO $test$
DECLARE
  c_datei constant text := '07_lesebereich_schreiben';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bta   uuid;
  v_bw    uuid;
  v_ext   uuid;
  v_ver   uuid;
  v_gst   uuid;
  v_gst2  uuid;
  v_gst3  uuid;
  v_psm   uuid;
  v_ks    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_ext := pg_temp.s112_benutzer('winzer', v_b);
  v_ver := pg_temp.s112_benutzer('winzer', v_b);
  UPDATE public.tenant_memberships SET profil = 'extern' WHERE tenant_id = v_b AND user_id = v_ext;
  UPDATE public.tenant_memberships SET profil = 'vertrieb' WHERE tenant_id = v_b AND user_id = v_ver;

  PERFORM pg_temp.s112_mutiere('nur_lesen_recht', $m$DO $d$ BEGIN
    DROP POLICY lesebereich ON public.grundstueck_recht;
    CREATE POLICY lesebereich ON public.grundstueck_recht AS RESTRICTIVE FOR SELECT TO authenticated
      USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('ea'))));
  END $d$$m$);
  PERFORM pg_temp.s112_mutiere('nur_lesen_psm', $m$DO $d$ BEGIN
    DROP POLICY lesebereich ON public.pflanzenschutzmittel;
    CREATE POLICY lesebereich ON public.pflanzenschutzmittel AS RESTRICTIVE FOR SELECT TO authenticated
      USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('betriebsmittel'))));
  END $d$$m$);

  -- ── 1. Katalog: jede Sperr-Policy gilt für alle Befehle, Prüfung beim Schreiben = Prüfung beim Lesen ──────────
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_alle_befehle',
    (SELECT concat_ws('|', count(*), count(*) FILTER (WHERE p.cmd = 'ALL' AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}' AND p.with_check IS NOT DISTINCT FROM p.qual))
       FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'lesebereich'), '126|126');
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_storage',
    (SELECT concat_ws('|', count(*), bool_and(p.cmd = 'ALL' AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}' AND p.with_check IS NOT DISTINCT FROM p.qual))
       FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname = 'lesebereich'), '1|t');

  -- ── Daten als Betriebsleitung ─────────────────────────────────────────────────────────────────────────────────
  v_gst := (pg_temp.s112_beispiel('grundstuecke', v_b, v_bta) ->> 'id')::uuid;
  v_gst2 := (pg_temp.s112_beispiel('grundstuecke', v_b, v_bta) ->> 'id')::uuid;
  v_gst3 := (pg_temp.s112_beispiel('grundstuecke', v_b, v_bta) ->> 'id')::uuid;
  v_psm := (pg_temp.s112_beispiel('pflanzenschutzmittel', v_b, v_bta, '{"preis_pro_einheit": 12.5, "aktiv": true}') ->> 'id')::uuid;
  v_ks := (pg_temp.s112_beispiel('kostenstellen', v_b, v_bta, '{"aktiv": true}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis, einheitswert) VALUES (v_b, v_gst, 'eigentum', 100);

  -- ── 2. Extern (liest Rieden und Maßnahmen, Schreibmodul Rieden) ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_ext);
  v_txt := pg_temp.t07s(format('INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis) VALUES (%L, %L, ''pacht'')', v_b, v_gst2));
  v_erg := v_erg || pg_temp.s112_erwarte('extern_recht_anlegen', split_part(v_txt, '|', 1), '42501');
  -- ohne Filter: liest keine Spalte – die SELECT-Policy allein hielte das nicht auf
  UPDATE public.grundstueck_recht SET einheitswert = 7;
  DELETE FROM public.grundstueck_recht;
  UPDATE public.pflanzenschutzmittel SET preis_pro_einheit = 999;
  v_txt := pg_temp.t07s(format('INSERT INTO public.kostenstellen (tenant_id, name) VALUES (%L, ''S112TEST extern'')', v_b));
  v_erg := v_erg || pg_temp.s112_erwarte('extern_kostenstelle_anlegen', split_part(v_txt, '|', 1), '42501');
  -- im eigenen Bereich schreibt er weiter
  v_txt := pg_temp.t07s(format('UPDATE public.grundstuecke SET notizen = ''S112TEST extern'' WHERE id = %L', v_gst));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('extern_recht_aendern_loeschen',
    (SELECT concat_ws('|', count(*), max(r.einheitswert)) FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), '1|100.00');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_recht_keine_neue_zeile',
    (SELECT count(*) FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst2), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_psm_preis_bleibt',
    (SELECT p.preis_pro_einheit FROM public.pflanzenschutzmittel p WHERE p.id = v_psm), 12.5::numeric);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_eigener_bereich',
    concat_ws('|', v_txt, (SELECT g.notizen FROM public.grundstuecke g WHERE g.id = v_gst)), 'ok|S112TEST extern');

  -- ── 3. Vertrieb (liest Controlling, Schreibmodul Auswertungen; Rieden und E&A nicht) ──────────────────────────
  PERFORM pg_temp.s112_als(v_ver);
  UPDATE public.grundstuecke SET notizen = 'S112TEST vertrieb';
  v_txt := pg_temp.t07s(format('UPDATE public.kostenstellen SET beschreibung = ''S112TEST vertrieb'' WHERE id = %L', v_ks));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_fremder_bereich',
    (SELECT g.notizen FROM public.grundstuecke g WHERE g.id = v_gst), 'S112TEST extern');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_eigener_bereich',
    concat_ws('|', v_txt, (SELECT k.beschreibung FROM public.kostenstellen k WHERE k.id = v_ks)), 'ok|S112TEST vertrieb');

  -- ── 4. Ohne Profil ändert sich nichts ─────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.t07s(format('INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis) VALUES (%L, %L, ''pacht'')', v_b, v_gst3));
  UPDATE public.grundstueck_recht SET einheitswert = 55 WHERE grundstueck_id = v_gst;
  UPDATE public.pflanzenschutzmittel SET preis_pro_einheit = 13 WHERE id = v_psm;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_schreibt',
    concat_ws('|', v_txt, (SELECT r.rechtsverhaeltnis FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst3),
      (SELECT r.einheitswert FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), (SELECT p.preis_pro_einheit FROM public.pflanzenschutzmittel p WHERE p.id = v_psm)),
    'ok|pacht|55.00|13.0000');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 11);
END
$test$;
