-- @bereich: Füllstand je Gebinde (KAN-44 Teil 2) – v_behaelter_fuellstand
-- @ziel: Füllstand = Summe der Bestände der nicht stornierten Chargen im Gebinde (wie das Bewegungsjournal), auch ohne
-- @ziel: Bewegungen (direkt angelegte Charge, Bestandskorrektur); leeres Gebinde mit 0 L; Chargen mit 0 L zählen nicht;
-- @ziel: security_invoker: ein fremder Betrieb sieht keine Zeilen.
-- @mutation mit_storno: stornierte Chargen zählen mit | rot: storno
-- @mutation ohne_leere: leere Gebinde fehlen in der Sicht | rot: leer
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 74 (Stand 08.10.2026, KAN-44). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t74_ersetze_view(p_view text, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_viewdef(p_view::regclass, true);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't74_ersetze_view: Muster % greift nicht in %', p_muster, p_view;
  END IF;
  EXECUTE format('CREATE OR REPLACE VIEW %s WITH (security_invoker = true) AS %s', p_view, v_neu);
END $f$;

CREATE FUNCTION pg_temp.t74_liter(p_beh uuid, p_tenant uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(f.liter_aktuell::numeric(12, 2)::text, ','), '-')
    FROM public.v_behaelter_fuellstand f WHERE f.behaelter_id = p_beh AND f.tenant_id = p_tenant
$f$;

DO $test$
DECLARE
  c_datei constant text := '74_fuellstand';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_mw    uuid;
  v_g1    uuid;
  v_g2    uuid;
  v_c1    uuid;
  v_c3    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;

  PERFORM pg_temp.s112_mutiere('mit_storno',
    $m$SELECT pg_temp.t74_ersetze_view('public.v_behaelter_fuellstand', $r$\s+AND w\.storniert_am IS NULL$r$, '')$m$);
  PERFORM pg_temp.s112_mutiere('ohne_leere',
    $m$SELECT pg_temp.t74_ersetze_view('public.v_behaelter_fuellstand', $r$\s+UNION\s+SELECT b\.id,\s+b\.tenant_id\s+FROM behaelter b$r$, '')$m$);

  INSERT INTO public.behaelter (tenant_id, name, volumen_liter) VALUES (v_b, 'S112TEST Tank 1', 2000) RETURNING id INTO v_g1;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter) VALUES (v_b, 'S112TEST Tank leer', 1000) RETURNING id INTO v_g2;
  -- zwei Chargen im Tank 1 (direkt angelegt, ohne Pressung/Zukauf – die alte Sicht kannte sie nicht), eine leere, eine stornierte
  INSERT INTO public.weinausbau (tenant_id, name, jahrgang, behaelter_id, menge_liter) VALUES (v_b, 'S112TEST GV', 2025, v_g1, 700) RETURNING id INTO v_c1;
  INSERT INTO public.weinausbau (tenant_id, name, jahrgang, behaelter_id, menge_liter) VALUES (v_b, 'S112TEST Rest', 2025, v_g1, 0);
  INSERT INTO public.weinausbau (tenant_id, name, jahrgang, behaelter_id, menge_liter) VALUES (v_b, 'S112TEST storniert', 2025, v_g1, 300) RETURNING id INTO v_c3;
  UPDATE public.weinausbau SET storniert_am = now(), storno_grund = 'S112TEST falsch angelegt' WHERE id = v_c3;
  INSERT INTO public.weinausbau (tenant_id, name, jahrgang, behaelter_id, menge_liter) VALUES (v_b, 'S112TEST RG', 2025, v_g1, 250.5);

  -- ── 1. Füllstand = Bestand der Chargen ────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno', pg_temp.t74_liter(v_g1, v_b), '950.50');
  v_erg := v_erg || pg_temp.s112_erwarte('leer', pg_temp.t74_liter(v_g2, v_b), '0.00');

  -- ── 2. Mengenänderung ohne Bewegung (Bestandskorrektur) wirkt sofort ──────────────────────────────────
  UPDATE public.weinausbau SET menge_liter = 680 WHERE id = v_c1;
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur', pg_temp.t74_liter(v_g1, v_b), '930.50');

  -- ── 3. Als Mitarbeiter ja, fremder Betrieb sieht nichts ──────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mitglied', pg_temp.t74_liter(v_g1, v_b), '930.50');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb', pg_temp.t74_liter(v_g1, v_b), '-');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 5);
END $test$;
