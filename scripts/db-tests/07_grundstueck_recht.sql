-- @bereich: Leserechte je Profil (KAN-458) – Rechtsverhältnis, Einheitswert und SVS-Zurechnung in grundstueck_recht
-- @ziel: Die fünf Werte liegen je Grundstück in grundstueck_recht (Lesebereich ea). „Extern“ liest die Grundstücke
-- @ziel: seiner Rieden (auch eingebettet in Maßnahmen), aber keine Zeile von grundstueck_recht; „Vertrieb“ ebenso wenig.
-- @ziel: Ohne Profil lesen Mitglieder beides; schreiben dürfen Betriebsleitung und Mitarbeiter mit Modul Rieden oder
-- @ziel: E&A, der Leser nicht. Bis kan458b gleicht ein Trigger Änderungen der alten Spalten von grundstuecke ab –
-- @ziel: nur diese, die neue Tabelle wird sonst nicht überschrieben. Ein Grundstück bleibt löschbar (Zeile fällt mit).
-- @mutation ohne_lesebereich: grundstueck_recht ohne Sperr-Policy | rot: extern_recht_.*|vertrieb_recht_leer
-- @mutation ohne_abgleich: Abgleich-Trigger auf grundstuecke entfernt | rot: abgleich_.*
-- @mutation leser_schreibt: Schreibmodul-Policy für UPDATE entfernt und Rollenprüfung offen | rot: leser_aendert_nicht
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 07 (Stand 14.11.2026, KAN-458). Alles zurückgerollt.

-- 'ok' bzw. '<SQLSTATE>|<HINT>' einer Anweisung als gerade aktive Rolle
CREATE FUNCTION pg_temp.t07g(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
  c_datei constant text := '07_grundstueck_recht';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bta   uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_mta   uuid;
  v_ext   uuid;
  v_ver   uuid;
  v_gst   uuid;
  v_gst2  uuid;
  v_n     bigint;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_ext := pg_temp.s112_benutzer('winzer', v_b);
  v_ver := pg_temp.s112_benutzer('winzer', v_b);
  UPDATE public.tenant_memberships SET profil = 'extern' WHERE tenant_id = v_b AND user_id = v_ext;
  UPDATE public.tenant_memberships SET profil = 'vertrieb' WHERE tenant_id = v_b AND user_id = v_ver;

  PERFORM pg_temp.s112_mutiere('ohne_lesebereich', $m$DROP POLICY lesebereich ON public.grundstueck_recht$m$);
  PERFORM pg_temp.s112_mutiere('ohne_abgleich', $m$DROP TRIGGER a_recht_abgleich ON public.grundstuecke$m$);
  PERFORM pg_temp.s112_mutiere('leser_schreibt', $m$DO $d$ BEGIN
    DROP POLICY modul_update ON public.grundstueck_recht;
    DROP POLICY grundstueck_recht_update ON public.grundstueck_recht;
    CREATE POLICY grundstueck_recht_update ON public.grundstueck_recht FOR UPDATE TO authenticated
      USING (tenant_id IN (SELECT public.s112_meine_tenants())) WITH CHECK (tenant_id IN (SELECT public.s112_meine_tenants()));
  END $d$$m$);

  -- ── 1. Katalog ────────────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('eine_zeile_je_grundstueck',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.grundstueck_recht'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (grundstueck_id)'), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('lesebereich_ea',
    (SELECT p.qual LIKE '%s112_lesegesperrte_tenants(''ea''::text)%' FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'grundstueck_recht' AND p.policyname = 'lesebereich'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_in_ki_liste', 'grundstueck_recht' = ANY (public.ki_erlaubte_tabellen()), false);

  -- ── 2. Abgleich der alten Spalten (bis kan458b) ───────────────────────────────────────────────────────────────
  v_gst := (pg_temp.s112_beispiel('grundstuecke', v_b, v_bta) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_neues_grundstueck',
    (SELECT concat_ws('|', count(*), max(r.svs_zurechnung), max(r.tenant_id::text) = v_b::text) FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), '1|eigen|t');
  UPDATE public.grundstuecke SET rechtsverhaeltnis = 'pacht', einheitswert = 1234.5, svs_zurechnung = 'pacht_fremd', einheitswert_quelle = 'manuell' WHERE id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_aenderung',
    (SELECT concat_ws('|', r.rechtsverhaeltnis, r.einheitswert, r.svs_zurechnung, r.einheitswert_quelle) FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), 'pacht|1234.50|pacht_fremd|manuell');
  -- die neue App schreibt nur die neue Tabelle; eine andere Änderung am Grundstück überschreibt sie nicht
  UPDATE public.grundstueck_recht SET rechtsverhaeltnis = 'eigentum' WHERE grundstueck_id = v_gst;
  UPDATE public.grundstuecke SET notizen = 'S112TEST' WHERE id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('neue_tabelle_bleibt',
    (SELECT r.rechtsverhaeltnis FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), 'eigentum');

  -- ── 3. Extern: Grundstück ja (auch über die Maßnahme), Rechtsverhältnis und Einheitswert nein ─────────────────
  PERFORM pg_temp.s112_als(v_ext);
  SELECT count(*) INTO v_n FROM public.grundstuecke WHERE id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_grundstueck_lesbar', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.grundstueck_recht WHERE grundstueck_id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_recht_leer', v_n, 0::bigint);
  SELECT count(r.id) INTO v_n FROM public.grundstuecke g LEFT JOIN public.grundstueck_recht r ON r.grundstueck_id = g.id WHERE g.id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_recht_eingebettet_leer', v_n, 0::bigint);
  -- Ändern ohne Leserecht trifft keine Zeile – der Wert bleibt
  UPDATE public.grundstueck_recht SET rechtsverhaeltnis = 'nutzung' WHERE grundstueck_id = v_gst;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('extern_recht_aendert_nicht',
    (SELECT r.rechtsverhaeltnis FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), 'eigentum');

  -- ── 4. Vertrieb: weder Grundstück noch Recht; ohne Profil: beides ─────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_ver);
  SELECT count(*) INTO v_n FROM public.grundstueck_recht WHERE grundstueck_id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_recht_leer', v_n, 0::bigint);
  PERFORM pg_temp.s112_als(v_bw);
  SELECT count(*) INTO v_n FROM public.grundstuecke g JOIN public.grundstueck_recht r ON r.grundstueck_id = g.id WHERE g.id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_liest_beides', v_n, 1::bigint);

  -- ── 5. Schreiben: Mitarbeiter mit Modul ja, Leser nein, fremder Betrieb nein ──────────────────────────────────
  UPDATE public.grundstueck_recht SET einheitswert = 99 WHERE grundstueck_id = v_gst;
  PERFORM pg_temp.s112_als(v_bl);
  UPDATE public.grundstueck_recht SET einheitswert = 1 WHERE grundstueck_id = v_gst;
  PERFORM pg_temp.s112_als(v_mta);
  UPDATE public.grundstueck_recht SET einheitswert = 2 WHERE grundstueck_id = v_gst;
  SELECT count(*) INTO v_n FROM public.grundstueck_recht WHERE grundstueck_id = v_gst;
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_liest_nicht', v_n, 0::bigint);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('mitarbeiter_aendert', (SELECT r.einheitswert FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst) IN (99, 1), true);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_aendert_nicht', (SELECT r.einheitswert FROM public.grundstueck_recht r WHERE r.grundstueck_id = v_gst), 99::numeric);
  -- eine zweite Zeile je Grundstück und ein Grundstück eines fremden Betriebs werden abgelehnt
  v_erg := v_erg || pg_temp.s112_erwarte('zweite_zeile_abgelehnt',
    split_part(pg_temp.t07g(format('INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id) VALUES (%L, %L)', v_b, v_gst)), '|', 1), '23505');
  v_erg := v_erg || pg_temp.s112_erwarte('fremdes_grundstueck_abgelehnt',
    pg_temp.t07g(format('UPDATE public.grundstueck_recht SET tenant_id = %L WHERE grundstueck_id = %L', (v_a ->> 'm')::uuid, v_gst)) = 'ok', false);

  -- ── 6. Ein Grundstück bleibt löschbar – die Zeile ist kein Bezug, sie fällt mit ───────────────────────────────
  v_gst2 := (pg_temp.s112_beispiel('grundstuecke', v_b, v_bta) ->> 'id')::uuid;
  PERFORM pg_temp.s112_als(v_bta);
  v_txt := pg_temp.t07g(format('DELETE FROM public.grundstuecke WHERE id = %L', v_gst2));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('grundstueck_loeschbar',
    concat_ws('|', v_txt, (SELECT count(*) FROM public.grundstuecke WHERE id = v_gst2), (SELECT count(*) FROM public.grundstueck_recht WHERE grundstueck_id = v_gst2)), 'ok|0|0');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 18);
END
$test$;
