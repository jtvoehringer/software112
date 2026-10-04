-- @bereich: Generischer Freeze-Trigger und Korrektur durch den Betriebsleiter (KAN-96)
-- @ziel: s112_freeze sperrt nach der Bedingung (über die bisherige Zeile) jede nicht erlaubte Spalte und das Löschen mit 42501
-- @ziel: (HINT freeze, DETAIL als JSON, Meldung mit Grund und Datum), ohne Teil-Updates; erlaubte Spalten bleiben änderbar,
-- @ziel: vor der Sperre ist alles frei. s112.freeze_frei (Tabelle bzw. '*') hebt die Sperre transaktionslokal auf.
-- @ziel: s112_freeze_korrektur: nur Betriebsleiter (system_admin/tenant_admin) des eigenen Betriebs, Grund ≥ 10 Zeichen,
-- @ziel: nur Tabellen mit Freeze-Trigger, nur echte Spalten (nie id/tenant_id), nur Zeilen des eigenen Betriebs (IDOR);
-- @ziel: protokolliert Alt/Neu und Grund im Bestandsprotokoll.
-- @mutation freeze_aus: s112_freeze lässt alles durch | rot: gesperrt_.*
-- @mutation korrektur_ohne_rolle: s112_freeze_korrektur lässt auch Winzer korrigieren | rot: korrektur_winzer
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 27 (Stand 04.10.2026, KAN-96). Testtabelle public.s112test_freeze
-- nur in dieser Transaktion – alles zurückgerollt.

CREATE FUNCTION pg_temp.t27_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't27_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei constant text := '27_freeze';
  c_korr  constant text := 'SELECT public.s112_freeze_korrektur(%L::uuid, %L, %L::uuid, %L::jsonb, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_z     uuid;
  v_zm    uuid;
  v_k     uuid;
  v_txt   text;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Testtabelle mit Freeze-Trigger ────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  CREATE TABLE public.s112test_freeze (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, status text NOT NULL DEFAULT 'entwurf',
    betrag numeric, notizen text, eingereicht_am timestamptz);
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.s112test_freeze TO authenticated;
  CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.s112test_freeze FOR EACH ROW
    EXECUTE FUNCTION public.s112_freeze('Prüfnummernantrag eingereicht', $$o.status <> 'entwurf'$$, 'notizen, status', 'eingereicht_am');
  INSERT INTO public.s112test_freeze (tenant_id, betrag) VALUES (v_b, 10) RETURNING id INTO v_z;
  INSERT INTO public.s112test_freeze (tenant_id, betrag, status, eingereicht_am) VALUES (v_m, 5, 'eingereicht', now()) RETURNING id INTO v_zm;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_aus',
    $m$CREATE OR REPLACE FUNCTION public.s112_freeze() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
       BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('korrektur_ohne_rolle',
    $m$SELECT pg_temp.t27_ersetze('public.s112_freeze_korrektur(uuid, text, uuid, jsonb, text)'::regprocedure,
         $r$ARRAY\['system_admin', 'tenant_admin'\]$r$, $r$ARRAY['system_admin', 'tenant_admin', 'winzer']$r$)$m$);

  -- ── 1. Rechte der Bausteine ───────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('freeze_nicht_ausfuehrbar_authenticated',
    has_function_privilege('authenticated', 'public.s112_freeze()', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_nicht_fuer_anon',
    has_function_privilege('anon', 'public.s112_freeze_korrektur(uuid, text, uuid, jsonb, text)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_freeze_korrektur(uuid, text, uuid, jsonb, text)', 'EXECUTE'), true);

  -- ── 2. Vor der Sperre (Entwurf): alles frei, Einreichen setzt Status und Datum in einem Zug ─────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('entwurf_frei',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET betrag = 20 WHERE id = %L', v_z)), 'k1');
  -- s112_versuch rollt zurück – bleibende Zustandswechsel über s112_fehlertext ('ok')
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen',
    pg_temp.s112_fehlertext(format('UPDATE public.s112test_freeze SET status = %L, eingereicht_am = %L WHERE id = %L',
      'eingereicht', '2026-10-04 10:00+02', v_z)), 'ok');

  -- ── 3. Gesperrt: erlaubte Spalten ja, alles andere 42501 – ganze Anweisung ───────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_notizen',
    pg_temp.s112_fehlertext(format('UPDATE public.s112test_freeze SET notizen = %L WHERE id = %L', 'S112TEST', v_z)), 'ok');
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.s112test_freeze SET betrag = 99 WHERE id = %L', v_z));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_betrag',
    v_txt LIKE '42501: Gesperrt: Prüfnummernantrag eingereicht am 04.10.2026 – änderbar sind nur notizen, status (nicht: betrag).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_gemischt',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET notizen = %L, betrag = 99 WHERE id = %L', 'S112TEST neu', v_z)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_loeschen',
    split_part(pg_temp.s112_fehlertext(format('DELETE FROM public.s112test_freeze WHERE id = %L', v_z)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('keine_teilupdates',
    (SELECT notizen || '/' || betrag FROM public.s112test_freeze WHERE id = v_z), 'S112TEST/10');
  -- Sperre gilt für jede Rolle, auch postgres (Wartung nur über das Kennzeichen)
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_postgres',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET betrag = 99 WHERE id = %L', v_z)), 'T');

  -- ── 4. Kennzeichen s112.freeze_frei (nur RPCs setzen es) ──────────────────────────────────────────────
  PERFORM set_config('s112.freeze_frei', 'andere_tabelle', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_kennzeichen_andere_tabelle',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET betrag = 99 WHERE id = %L', v_z)), 'T');
  PERFORM set_config('s112.freeze_frei', 's112test_freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_tabelle',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET betrag = 21 WHERE id = %L', v_z)), 'k1');
  PERFORM set_config('s112.freeze_frei', '*', true);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_alle',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET betrag = 20 WHERE id = %L', v_z)), 'k1');
  PERFORM set_config('s112.freeze_frei', '', true);

  -- ── 5. Korrektur durch den Betriebsleiter ─────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_winzer',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 's112test_freeze', v_z, '{"betrag": 30}', 'Tippfehler im Betrag')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 's112test_freeze', v_z, '{"betrag": 30}', 'kurz')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_ohne_freeze_tabelle',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 'kontakte', v_z, '{"nachname": "x"}', 'Tippfehler im Namen')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_tenant_id',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 's112test_freeze', v_z, format('{"tenant_id": "%s"}', v_m), 'Betrieb umhängen versucht')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_unbekannte_spalte',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 's112test_freeze', v_z, '{"gibtsnicht": 1}', 'Spalte gibt es nicht')), ':', 1), '22023');
  -- IDOR: Zeile des Musterhofs über den eigenen Betrieb bzw. über den fremden Betrieb
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_idor_fremde_zeile',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 's112test_freeze', v_zm, '{"betrag": 30}', 'fremde Zeile ändern')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_m, 's112test_freeze', v_zm, '{"betrag": 30}', 'fremden Betrieb ändern')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_betriebsleiter',
    pg_temp.s112_fehlertext(format(c_korr, v_b, 's112test_freeze', v_z, '{"betrag": 30}', 'Tippfehler im Betrag')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_wert', (SELECT betrag FROM public.s112test_freeze WHERE id = v_z), 30::numeric);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_danach_wieder_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.s112test_freeze SET betrag = 99 WHERE id = %L', v_z)), 'T');
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll p
   WHERE p.tabelle = 's112test_freeze' AND p.datensatz_id = v_z AND p.tenant_id = v_b AND p.aktion = 'UPDATE'
     AND p.grund = 'Korrektur trotz Sperre (Betriebsleiter): Tippfehler im Betrag' AND p.geaenderte_spalten = ARRAY['betrag']
     AND (p.alt ->> 'betrag')::numeric = 10 AND (p.neu ->> 'betrag')::numeric = 30 AND p.benutzer_id = v_bta;
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_protokoll', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_nach_korrektur_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 22);
END $test$;
