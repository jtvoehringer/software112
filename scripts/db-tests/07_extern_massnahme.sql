-- @bereich: Leserechte je Profil (KAN-456, R4) – Mittelauswahl für „Extern“ und Maßnahme speichern
-- @ziel: Ein Mitarbeiter mit Profil „Extern“ liest den Bereich betriebsmittel nicht (Lager, Einkauf, Preise), muss aber
-- @ziel: eine Maßnahme mit Mittel erfassen können. Die Funktionen s112_psm_ohne_preis, s112_duengemittel_ohne_preis und
-- @ziel: s112_betriebsmittel_ohne_preis liefern die Mittel des Betriebs (und des Katalogs) mit allen Spalten außer dem
-- @ziel: Preis – nur für Mitglieder mit Lesebereich massnahmen. „Extern“ legt damit eine Maßnahme samt Grundstück an;
-- @ziel: die Tabellen der Mittel bleiben für ihn leer. Der Morgenbericht liegt im Bereich verwaltung (kein Profil).
-- @mutation mit_preis: s112_psm_ohne_preis liefert den Preis mit | rot: spalten:pflanzenschutzmittel
-- @mutation ohne_lesepruefung: s112_pruefe_lesen prüft nichts mehr | rot: vertrieb_.*
-- @mutation morgenbericht_ki: Morgenbericht wieder im Bereich ki | rot: morgenbericht_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 07 (Stand 13.11.2026, KAN-456). Alles zurückgerollt.

-- 'ok' bzw. '<SQLSTATE>|<HINT>' einer Anweisung als gerade aktive Rolle
CREATE FUNCTION pg_temp.t07e(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
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
  c_datei constant text := '07_extern_massnahme';
  -- Funktion=Tabelle=ausgelassene Spalten
  c_fn constant text[] := ARRAY[
    's112_psm_ohne_preis=pflanzenschutzmittel=preis_pro_einheit',
    's112_duengemittel_ohne_preis=duengemittel=preis_pro_einheit',
    's112_betriebsmittel_ohne_preis=betriebsmittel=ea_kategorie_id,preis_pro_einheit'];
  v_t0    timestamptz;
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bta   uuid;
  v_bw    uuid;
  v_mta   uuid;
  v_ext   uuid;
  v_ver   uuid;
  v_e     text;
  v_fn    text;
  v_tab   text;
  v_psm   uuid;
  v_psm_m uuid;
  v_due   uuid;
  v_bm    uuid;
  v_gst   uuid;
  v_wg    uuid;
  v_beh   uuid;
  v_n     bigint;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_ext := pg_temp.s112_benutzer('winzer', v_b);
  v_ver := pg_temp.s112_benutzer('winzer', v_b);
  UPDATE public.tenant_memberships SET profil = 'extern' WHERE tenant_id = v_b AND user_id = v_ext;
  UPDATE public.tenant_memberships SET profil = 'vertrieb' WHERE tenant_id = v_b AND user_id = v_ver;
  v_psm := (pg_temp.s112_beispiel('pflanzenschutzmittel', v_b, v_bta, '{"preis_pro_einheit": 12.5, "aktiv": true}') ->> 'id')::uuid;
  v_due := (pg_temp.s112_beispiel('duengemittel', v_b, v_bta, '{"preis_pro_einheit": 3.2, "aktiv": true}') ->> 'id')::uuid;
  v_bm  := (pg_temp.s112_beispiel('betriebsmittel', v_b, v_bta, '{"preis_pro_einheit": 0.4, "aktiv": true}') ->> 'id')::uuid;
  v_gst := (pg_temp.s112_beispiel('grundstuecke', v_b, v_bta) ->> 'id')::uuid;
  SELECT g.weingarten_id INTO v_wg FROM public.grundstuecke g WHERE g.id = v_gst;
  PERFORM pg_temp.s112_beispiel('morgenberichte', v_b, v_bta);
  v_psm_m := (pg_temp.s112_beispiel('pflanzenschutzmittel', v_m, v_mta) ->> 'id')::uuid;   -- fremder Betrieb: darf nie mitkommen

  PERFORM pg_temp.s112_mutiere('mit_preis', $m$DO $d$ BEGIN
    DROP FUNCTION public.s112_psm_ohne_preis(uuid);
    CREATE FUNCTION public.s112_psm_ohne_preis(p_tenant_id uuid) RETURNS SETOF public.pflanzenschutzmittel LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = public AS $x$ SELECT m.* FROM public.pflanzenschutzmittel m WHERE m.tenant_id = p_tenant_id OR m.tenant_id IS NULL $x$;
    GRANT EXECUTE ON FUNCTION public.s112_psm_ohne_preis(uuid) TO authenticated;
  END $d$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_lesepruefung', $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_lesen(p_tenant_id uuid, p_bereich text)
    RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $x$ BEGIN RETURN; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('morgenbericht_ki', $m$DO $d$ BEGIN
    DROP POLICY lesebereich ON public.morgenberichte;
    CREATE POLICY lesebereich ON public.morgenberichte AS RESTRICTIVE FOR SELECT TO authenticated
      USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('ki'))));
  END $d$$m$);

  -- ── 1. Katalog: Spalten = Tabelle ohne die ausgelassenen; Rechte ─────────────────────────────────────────────
  FOREACH v_e IN ARRAY c_fn LOOP
    v_fn := split_part(v_e, '=', 1);
    v_tab := split_part(v_e, '=', 2);
    -- Spalten der Tabelle, die die Funktion NICHT liefert (eine neue Spalte der Tabelle fällt hier auf)
    SELECT coalesce(string_agg(c.column_name, ',' ORDER BY c.column_name), '') INTO v_txt
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = v_tab
       AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, unnest(p.proargnames, p.proargmodes) AS a(name, modus)
                        WHERE n.nspname = 'public' AND p.proname = v_fn AND a.modus = 't' AND a.name = c.column_name);
    v_erg := v_erg || pg_temp.s112_erwarte('spalten:' || v_tab, v_txt, split_part(v_e, '=', 3));
    v_erg := v_erg || pg_temp.s112_erwarte('rechte:' || v_fn,
      concat_ws('|', has_function_privilege('authenticated', ('public.' || v_fn || '(uuid)')::regprocedure, 'EXECUTE'),
        has_function_privilege('anon', ('public.' || v_fn || '(uuid)')::regprocedure, 'EXECUTE')), 't|f');
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('morgenbericht_policy',
    (SELECT p.qual LIKE '%s112_lesegesperrte_tenants(''verwaltung''::text)%' FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'morgenberichte' AND p.policyname = 'lesebereich'), true);

  -- ── 2. Extern: Tabellen leer, Funktionen liefern eigene Mittel und Katalog – nie die eines fremden Betriebs ───────
  PERFORM pg_temp.s112_als(v_ext);
  SELECT count(*) INTO v_n FROM public.pflanzenschutzmittel WHERE id = v_psm;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_tabelle_psm_leer', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM public.betriebsmittel WHERE id = v_bm;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_tabelle_betriebsmittel_leer', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM public.s112_psm_ohne_preis(v_b) WHERE id = v_psm;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_psm', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.s112_duengemittel_ohne_preis(v_b) WHERE id = v_due;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_duengemittel', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.s112_betriebsmittel_ohne_preis(v_b) WHERE id = v_bm;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_betriebsmittel', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.s112_psm_ohne_preis(v_b) WHERE tenant_id IS NOT NULL AND tenant_id <> v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_psm_nur_eigener_betrieb', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM public.s112_betriebsmittel_ohne_preis(v_b) WHERE tenant_id <> v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_betriebsmittel_nur_eigener_betrieb', v_n, 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_fremder_betrieb', split_part(pg_temp.t07e(format('SELECT * FROM public.s112_psm_ohne_preis(%L)', v_m)), '|', 1), '42501');

  -- ── 3. Extern legt eine Maßnahme mit Mittel und Grundstück an und liest sie wieder ───────────────────────────
  v_beh := gen_random_uuid();
  v_erg := v_erg || pg_temp.s112_erwarte('extern_massnahme_anlegen',
    pg_temp.t07e(format('INSERT INTO public.behandlungen (id, tenant_id, datum, weingarten_id, psm_id, art) VALUES (%L, %L, %L, %L, %L, %L)', v_beh, v_b, v_heute, v_wg, v_psm, 'spritzung')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_massnahme_grundstueck',
    pg_temp.t07e(format('INSERT INTO public.behandlung_grundstuecke (behandlung_id, grundstueck_id, flaeche_ha) VALUES (%L, %L, 0.5)', v_beh, v_gst)), 'ok');
  SELECT count(*) INTO v_n FROM public.behandlungen b JOIN public.behandlung_grundstuecke bg ON bg.behandlung_id = b.id WHERE b.id = v_beh AND b.psm_id = v_psm;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_massnahme_lesbar', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_massnahme_duengung',
    pg_temp.t07e(format('INSERT INTO public.behandlungen (tenant_id, datum, weingarten_id, duengemittel_id, art) VALUES (%L, %L, %L, %L, %L)', v_b, v_heute, v_wg, v_due, 'duengung')), 'ok');
  -- ein Mittel eines fremden Betriebs lässt sich weiterhin nicht eintragen
  v_erg := v_erg || pg_temp.s112_erwarte('extern_massnahme_fremdes_mittel',
    pg_temp.t07e(format('INSERT INTO public.behandlungen (tenant_id, datum, weingarten_id, psm_id, art) VALUES (%L, %L, %L, %L, %L)', v_b, v_heute, v_wg, v_psm_m, 'spritzung')) = 'ok', false);
  -- Lager, Einkauf und Kosten bleiben für Extern unlesbar
  SELECT count(*) INTO v_n FROM public.psm_lager_bewegungen;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_lager_leer', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM public.kosteneintraege;
  v_erg := v_erg || pg_temp.s112_erwarte('extern_kosten_leer', v_n, 0::bigint);

  -- ── 4. Vertrieb (ohne Bereich massnahmen): Funktionen gesperrt ────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_ver);
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_psm', pg_temp.t07e(format('SELECT * FROM public.s112_psm_ohne_preis(%L)', v_b)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_duengemittel', pg_temp.t07e(format('SELECT * FROM public.s112_duengemittel_ohne_preis(%L)', v_b)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_betriebsmittel', pg_temp.t07e(format('SELECT * FROM public.s112_betriebsmittel_ohne_preis(%L)', v_b)), '42501|lesebereich');
  SELECT count(*) INTO v_n FROM public.morgenberichte WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('morgenbericht_vertrieb', v_n, 0::bigint);

  -- ── 5. Ohne Profil: Tabelle und Funktion; der Morgenbericht ist lesbar ───────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  SELECT count(*) INTO v_n FROM public.pflanzenschutzmittel WHERE id = v_psm;
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_tabelle', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.s112_psm_ohne_preis(v_b) WHERE id = v_psm;
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_funktion', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.morgenberichte WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('morgenbericht_ohne_profil', v_n, 1::bigint);
  PERFORM pg_temp.s112_als(v_ext);
  SELECT count(*) INTO v_n FROM public.morgenberichte WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('morgenbericht_extern', v_n, 0::bigint);
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 30);
END
$test$;
