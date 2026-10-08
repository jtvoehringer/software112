-- @bereich: Sonstige Produkte löschen (KAN-242) – DELETE-Policy auf sonstige_artikel
-- @ziel: Mitarbeiter mit Freigabe Warenwirtschaft und Betriebsleitung löschen ein unbenutztes Produkt; Leser, Mitarbeiter
-- @ziel: ohne Freigabe und fremde Betriebe löschen nichts (0 Zeilen); ein Produkt mit Lagerbewegung sperrt der FK (23503).
-- @mutation ohne_modul: DELETE ohne die RESTRICTIVE Policy modul_delete | rot: ohne_freigabe
-- @mutation ohne_policy: keine PERMISSIVE DELETE-Policy (Stand vor KAN-242) | rot: winzer_loescht
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 75 (Stand 08.10.2026, KAN-242). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '75_produkt_loeschen';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bta   uuid;
  v_bwc   uuid;
  v_mw    uuid;
  v_p1    uuid;
  v_p2    uuid;
  v_p3    uuid;
  v_del   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_bwc := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm', 'rieden']);

  PERFORM pg_temp.s112_mutiere('ohne_modul', $m$DROP POLICY modul_delete ON public.sonstige_artikel$m$);
  PERFORM pg_temp.s112_mutiere('ohne_policy', $m$DROP POLICY sonstige_artikel_delete ON public.sonstige_artikel$m$);

  INSERT INTO public.sonstige_artikel (tenant_id, name) VALUES (v_b, 'S112TEST Traubensaft') RETURNING id INTO v_p1;
  INSERT INTO public.sonstige_artikel (tenant_id, name) VALUES (v_b, 'S112TEST Essig') RETURNING id INTO v_p2;
  INSERT INTO public.sonstige_artikel (tenant_id, name) VALUES (v_b, 'S112TEST Destillat') RETURNING id INTO v_p3;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge)
  VALUES (v_b, v_p2, (now() AT TIME ZONE 'Europe/Vienna')::date, 'anfangsbestand', 10);

  v_del := format('DELETE FROM public.sonstige_artikel WHERE id = %L', v_p1);

  -- ── 1. Ohne Recht: 0 Zeilen (RLS filtert still) ───────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser', pg_temp.s112_versuch(v_del), 'k0');
  PERFORM pg_temp.s112_als(v_bwc);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_freigabe', pg_temp.s112_versuch(v_del), 'k0');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb', pg_temp.s112_versuch(v_del), 'k0');

  -- ── 2. Mit Freigabe: Mitarbeiter und Betriebsleitung löschen ──────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_loescht', pg_temp.s112_versuch(v_del), 'k1');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('admin_loescht',
    pg_temp.s112_versuch(format('DELETE FROM public.sonstige_artikel WHERE id = %L', v_p3)), 'k1');

  -- ── 3. Mit Lagerbewegung: FK sperrt (App meldet „bitte deaktivieren“) ─────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mit_bewegung',
    pg_temp.s112_versuch(format('DELETE FROM public.sonstige_artikel WHERE id = %L', v_p2)), 'E23503');

  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 6);
END $test$;
