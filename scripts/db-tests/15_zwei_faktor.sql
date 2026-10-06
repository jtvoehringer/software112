-- software:112 – SQL-Testsuite gegen STAGING: Zwei-Faktor in der Datenbank (KAN-136)
-- Stand 28.09.2026. Läuft nur über `npm run test:db` (Rahmen _helfer.sql davor, Ergebnis per RAISE,
-- alles wird zurückgerollt).
--
-- @bereich: Zwei-Faktor in der Datenbank (KAN-136)
-- @ziel: Hat ein Benutzer einen bestätigten Faktor und trägt die Sitzung nur aal1, sieht und schreibt sie
-- @ziel: nichts – nicht über RLS (jede Tabelle in public, RESTRICTIVE zwei_faktor_aal), nicht über RPCs
-- @ziel: (pruefe_tenant_zugriff), nicht über Storage und nicht über den PostgREST-Pre-Request (PT401).
-- @ziel: Jede Tabelle wird auch ISOLIERT geprüft (nur ihre eigene zwei_faktor_aal wirkt), damit die Policy auf
-- @ziel: tenant_memberships eine aufgeweichte Policy anderswo nicht verdeckt.
-- @ziel: aal2 und Benutzer ohne (bestätigten) Faktor sind nicht betroffen; die 2FA-Pflicht bleibt App-Sache.
-- @mutation aal_ok_immer_wahr: s112_aal_ok() liefert immer true (Notfall-Schalter) | rot: lesen_aal1_.*|aal_ok_.*|pre_request_aal1_mit_faktor|pruefe_tenant_zugriff_aal1|rechnungsnummer_aal1|storage_.*_aal1
-- @mutation aal_ok_immer_falsch: s112_aal_ok() liefert immer false (Vakuitätsschutz: aal2 sähe nichts mehr) | rot: lesen_aal2_.*|positiv_.*|aal_ok_aal2|aal_ok_ohne_faktor|aal_ok_unverifiziert|.*_aal2
-- @mutation aal_ok_invoker: s112_aal_ok() als SECURITY INVOKER (liest auth.mfa_factors mit Benutzerrechten) | rot: aal_ok_security_definer
-- @mutation kontakte_ohne_policy: RESTRICTIVE-Policy zwei_faktor_aal auf kontakte entfernt | rot: lesen_aal1_isoliert_kontakte|insert_aal1_kontakte|update_aal1_kontakte|delete_aal1_kontakte|zwei_faktor_policy_fehlt
-- @mutation kontakte_oder_true: zwei_faktor_aal auf kontakte mit „OR true“ aufgeweicht (USING und WITH CHECK) | rot: zwei_faktor_policy_fehlt|lesen_aal1_isoliert_kontakte|insert_aal1_kontakte
-- @mutation kontakte_check_oder_true: nur WITH CHECK von zwei_faktor_aal auf kontakte mit „OR true“ aufgeweicht | rot: zwei_faktor_policy_fehlt|insert_aal1_kontakte
-- @mutation weingarten_permissiv: zwei_faktor_aal auf weingarten als PERMISSIVE neu angelegt (wirkt dann nicht mehr) | rot: zwei_faktor_policy_fehlt|lesen_aal1_isoliert_weingarten|insert_aal1_weingarten
-- @mutation pre_request_leer: s112_pre_request() prüft nichts mehr | rot: pre_request_aal1_mit_faktor
-- @mutation aal_ok_ohne_status: s112_aal_ok() zählt auch unbestätigte Faktoren | rot: aal_ok_unverifiziert|unverifiziert_.*
-- @mutation aal_ok_gross_klein: s112_aal_ok() vergleicht die Stufe ohne Groß-/Kleinschreibung | rot: aal_ok_grossbuchstaben
-- @mutation aal_ok_fehlender_claim: fehlt 'aal' im JWT, gilt aal2 | rot: aal_ok_ohne_aal_claim|ohne_aal_claim_.*
-- @mutation pruefe_ohne_stufe: pruefe_tenant_zugriff prüft die Zwei-Faktor-Stufe nicht mehr | rot: pruefe_tenant_zugriff_aal1|rechnungsnummer_aal1
-- @mutation aal_ok_fuer_anon: anon darf s112_aal_ok() ausführen | rot: execute_anon_s112_aal_ok.*
--
-- Prüfungen (Persona b_ta = tenant_admin in Betrieb B mit bestätigtem TOTP-Faktor):
--   1. Aufbau: auth.mfa_factors (verified) für b_ta und den Test-Plattform-Admin, (unverified) für b_l;
--      je Tabelle in public mit RLS eine Zeile, die die Persona bei aal2 sehen muss (T/K: s112_beispiel in B,
--      G: tenants-Zeile B, eigenes Profil, rebsorten, svs_parameter, release_notes …).
--   2. Lesen im echten Zustand: bei aal2 ist genau diese Zeile sichtbar (Positivkontrolle), bei aal1 liefert
--      count(*) über die GANZE Tabelle 0 (auch globale Zeilen wie rebsorten, profiles, svs_parameter).
--   3. Isoliert (Unterblock, danach zurückgerollt): jede zwei_faktor_aal in public bekommt als postgres den
--      Zusatz „OR s112.iso_tab <> '<eigene Tabelle>'“ auf ihren AKTUELLEN Ausdruck. Mit iso_tab = '' ist keine
--      wirksam (Positivkontrolle bei aal1: Zeile sichtbar, INSERT-Klon von der RLS zugelassen), mit iso_tab =
--      <Tabelle> nur die eigene: aal1 sieht die Zeile nicht (lesen_aal1_isoliert_*), INSERT → R (insert_aal1_*).
--      Ohne diese Isolierung blendete die zwei_faktor_aal auf tenant_memberships bei aal1 schon alles aus, und
--      eine aufgeweichte Policy z. B. auf kontakte fiele nicht auf. UPDATE/DELETE nur als Stichprobe
--      (c_stichprobe) – bei cmd = ALL wirkt derselbe USING-Ausdruck wie beim Lesen (statisch in 9 geprüft).
--   4. s112_aal_ok(): aal1 → false, aal2 → true, Claim ohne 'aal' → false, 'AAL2' → false,
--      unbestätigter Faktor → true, Winzer ohne Faktor → true (und sieht seine Daten).
--   5. RPC: pruefe_tenant_zugriff(B) bei aal1 → 42501 „Zwei-Faktor-Anmeldung erforderlich“, bei aal2 ok;
--      get_next_rechnungsnummer(B) bei aal1 → 42501, bei aal2 Nummer.
--   6. Pre-Request: aal1 mit Faktor → PT401 mit HINT; aal2, anon, ohne Faktor → ok; an authenticator gesetzt.
--   7. s112_aal_ok: SECURITY DEFINER mit search_path; EXECUTE nur authenticated (anon → 42501),
--      s112_pre_request für anon und authenticated.
--   8. Storage (Bucket dokumente): B-Objekt bei aal1 unsichtbar, Upload → R; bei aal2 sichtbar, Upload k1.
--   9. Statisch: zwei_faktor_aal auf jeder RLS-Tabelle in public und auf storage.objects – RESTRICTIVE, ALL,
--      TO authenticated und USING/WITH CHECK EXAKT „(SELECT s112_aal_ok())“ (Leerraum/Schema normalisiert;
--      „… OR true“ fällt auf); Tabellen ohne Lesepfad (c_ohne_lesepfad) haben wirklich keine permissive
--      Lese-Policy; die sechs RPCs mit eigener Mitgliedsprüfung (Einstufung session_user) prüfen die Stufe
--      selbst (s112_aal_ok, B15 seit KAN-159 Teil 2 hart) – zusätzlich zum Pre-Request.

DO $test$
DECLARE
  c_datei          constant text := '15_zwei_faktor';
  -- Tabellen, die auch bei aal2 für KEINE Persona lesbar sind (keine permissive SELECT-Policy): dort beweist
  -- die aal1-Leseprüfung nichts – stattdessen wird statisch belegt, dass es wirklich keinen Lesepfad gibt.
  c_ohne_lesepfad  constant text[] := ARRAY['stripe_zahlungen_log', 'system_ereignisse'];
  -- UPDATE/DELETE-Stichprobe im isolierten Durchlauf (bei aal2 bzw. ohne wirksame 2FA-Policy k1)
  c_stichprobe     constant text[] := ARRAY['kontakte', 'firmen', 'weingarten', 'aktivitaeten', 'pipeline_eintraege'];
  -- Mindestanteil der T-Tabellen, deren INSERT-Klon ohne wirksame 2FA-Policy von der RLS zugelassen wird
  c_min_anteil     constant numeric := 0.8;
  c_iso_fehler     constant text := 'S1I15';
  c_aal_ok_soll    constant text := '(SELECTs112_aal_ok()ASs112_aal_ok)';
  v_t0             timestamptz := clock_timestamp();
  v_erg            text[] := '{}';
  v_a              jsonb;
  v_b              uuid;
  v_bta            uuid;
  v_bw             uuid;
  v_bl             uuid;
  v_pa             uuid;
  v_rn             uuid;
  v_ziele          jsonb := '{}';   -- tabelle → {w: PK-Bedingung, p: Persona, k: Klasse, z: Zeile, u: UPDATE-Spalte}
  v_z              jsonb;
  v_ziel           jsonb;
  r                record;
  v_tab            text;
  v_w              text;
  v_x              text;
  v_soll           text;
  v_rel_s          text;
  v_rel_i          text;
  v_rel_u          text;
  v_rel_d          text;
  v_n              bigint;
  v_iso_n          int := 0;
  v_ins_k1         int := 0;
  v_t_tabellen     int := 0;
  v_stich_n        int := 0;
  v_obj            text;
  v_state          text;
  v_msg            text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ═══ 1. Aufbau (als postgres) ═══════════════════════════════════════════════════════════════════════
  v_a   := pg_temp.s112_aufbau();
  v_b   := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw  := (v_a ->> 'b_w')::uuid;
  v_bl  := (v_a ->> 'b_l')::uuid;
  v_pa  := (v_a ->> 'pa')::uuid;
  PERFORM pg_temp.s112_faktor(v_bta);                 -- bestätigter TOTP-Faktor
  PERFORM pg_temp.s112_faktor(v_pa);                  -- für plattform_admins (nur die eigene Zeile lesbar)
  PERFORM pg_temp.s112_faktor(v_bl, 'unverified');    -- zählt nicht
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_faktoren',
    (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id IN (v_bta, v_pa, v_bl)), 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_w_ohne_faktor',
    (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id = v_bw), 0::bigint);

  -- Je Tabelle eine Zeile, die die Persona bei aal2 sehen muss
  FOR r IN SELECT * FROM pg_temp.s112_mandantentabellen() LOOP
    v_z := NULL;
    v_x := 'b_ta';
    BEGIN
      IF r.klasse IN ('T', 'K') THEN
        v_z := pg_temp.s112_beispiel(r.tabelle, v_b, v_bta);
      ELSIF r.tabelle = 'tenants' THEN
        SELECT to_jsonb(t.*) INTO v_z FROM public.tenants t WHERE t.id = v_b;
      ELSIF r.tabelle = 'profiles' THEN
        SELECT to_jsonb(p.*) INTO v_z FROM public.profiles p WHERE p.id = v_bta;
      ELSIF r.tabelle = 'rebsorten' THEN
        SELECT to_jsonb(x.*) INTO v_z FROM public.rebsorten x WHERE x.aktiv ORDER BY x.id LIMIT 1;
      ELSIF r.tabelle = 'svs_parameter' THEN
        SELECT to_jsonb(x.*) INTO v_z FROM public.svs_parameter x ORDER BY x.jahr LIMIT 1;
      ELSIF r.tabelle IN ('kat_buchungsart', 'kat_erzeugnis', 'kat_farbe', 'kat_land', 'kat_qualitaetsstufe', 'katalog_mapping') THEN   -- KAN-39: Kataloge (per Migration befüllt)
        EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x LIMIT 1', r.tabelle) INTO v_z;
      ELSIF r.tabelle = 'release_notes' THEN
        v_z := pg_temp.s112_zeile('release_notes', NULL,
                 jsonb_build_object('version', 's112test', 'titel', 'S112TEST Zwei-Faktor', 'aktiv', true));
        v_rn := (v_z ->> 'id')::uuid;
      ELSIF r.tabelle = 'release_notes_gesehen' THEN
        IF v_rn IS NULL THEN
          v_rn := (pg_temp.s112_zeile('release_notes', NULL,
                     jsonb_build_object('version', 's112test', 'titel', 'S112TEST Zwei-Faktor', 'aktiv', true)) ->> 'id')::uuid;
        END IF;
        v_z := pg_temp.s112_zeile('release_notes_gesehen', NULL, jsonb_build_object('user_id', v_bta, 'release_note_id', v_rn));
      ELSIF r.tabelle IN ('keller_freigaben', 'crm_freigaben') THEN
        v_z := pg_temp.s112_zeile(r.tabelle, NULL,
                 jsonb_build_object('eigentuemer_tenant_id', v_a ->> 'm', 'nutzer_tenant_id', v_b, 'aktiv', true));
      ELSIF r.tabelle = 'plattform_admins' THEN
        SELECT to_jsonb(x.*) INTO v_z FROM public.plattform_admins x WHERE x.user_id = v_pa;
        v_x := 'pa';
      ELSE
        v_erg := v_erg || pg_temp.s112_fehler('g_tabelle_ohne_beispiel_' || r.tabelle,
                   'neue G-Tabelle – im Aufbau von 15_zwei_faktor eine sichtbare Zeile ergänzen');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('aufbau_' || r.tabelle, SQLSTATE || ': ' || SQLERRM);
      v_z := NULL;
    END;
    IF v_z IS NOT NULL THEN
      v_ziele := v_ziele || jsonb_build_object(r.tabelle, jsonb_build_object(
        'w', pg_temp.s112_pk_where(r.tabelle, v_z), 'p', v_x, 'k', r.klasse, 'z', v_z,
        'u', coalesce(r.upd_spalte, r.pk[1]), 'ohne_upd_recht', r.upd_spalte IS NULL));
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_alle_tabellen',
    (SELECT count(*) FROM jsonb_object_keys(v_ziele)), (SELECT count(*) FROM pg_temp.s112_mandantentabellen()));
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_stichprobe_vorhanden',
    (SELECT count(*) FROM unnest(c_stichprobe) s WHERE v_ziele -> s ->> 'k' = 'T'), cardinality(c_stichprobe)::bigint);

  -- Storage-Objekt im Ordner von B (Bucket dokumente: lesen alle Mitglieder, hochladen mit „betrieb“)
  v_obj := v_b::text || '/s112test/zwei-faktor-b.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('dokumente', v_obj, v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('storage_objekt_existiert',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'dokumente', v_obj)), '1');

  -- ═══ Mutationen (nach dem Aufbau, vor den Prüfungen) ════════════════════════════════════════════════
  PERFORM pg_temp.s112_mutiere('aal_ok_immer_wahr', $m$
    CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $f$ SELECT true $f$ $m$);
  PERFORM pg_temp.s112_mutiere('aal_ok_immer_falsch', $m$
    CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $f$ SELECT false $f$ $m$);
  PERFORM pg_temp.s112_mutiere('aal_ok_invoker', $m$
    CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path TO 'public' AS $f$
      SELECT CASE
        WHEN coalesce((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2' THEN true
        WHEN (SELECT auth.uid()) IS NULL THEN true
        ELSE NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = (SELECT auth.uid()) AND f.status = 'verified')
      END $f$ $m$);
  PERFORM pg_temp.s112_mutiere('kontakte_ohne_policy', $m$DROP POLICY zwei_faktor_aal ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('kontakte_oder_true', $m$
    ALTER POLICY zwei_faktor_aal ON public.kontakte
      USING ((SELECT public.s112_aal_ok()) OR true) WITH CHECK ((SELECT public.s112_aal_ok()) OR true)$m$);
  PERFORM pg_temp.s112_mutiere('kontakte_check_oder_true', $m$
    ALTER POLICY zwei_faktor_aal ON public.kontakte WITH CHECK ((SELECT public.s112_aal_ok()) OR true)$m$);
  PERFORM pg_temp.s112_mutiere('weingarten_permissiv', $m$
    DROP POLICY zwei_faktor_aal ON public.weingarten;
    CREATE POLICY zwei_faktor_aal ON public.weingarten AS PERMISSIVE FOR ALL TO authenticated
      USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()))$m$);
  PERFORM pg_temp.s112_mutiere('pre_request_leer', $m$
    CREATE OR REPLACE FUNCTION public.s112_pre_request() RETURNS void LANGUAGE plpgsql
    SET search_path TO 'public' AS $f$ BEGIN NULL; END $f$ $m$);
  PERFORM pg_temp.s112_mutiere('aal_ok_ohne_status', $m$
    CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $f$
      SELECT CASE
        WHEN coalesce((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2' THEN true
        WHEN (SELECT auth.uid()) IS NULL THEN true
        ELSE NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = (SELECT auth.uid()))
      END $f$ $m$);
  PERFORM pg_temp.s112_mutiere('aal_ok_gross_klein', $m$
    CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $f$
      SELECT CASE
        WHEN lower(coalesce((SELECT auth.jwt()) ->> 'aal', 'aal1')) = 'aal2' THEN true
        WHEN (SELECT auth.uid()) IS NULL THEN true
        ELSE NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = (SELECT auth.uid()) AND f.status = 'verified')
      END $f$ $m$);
  PERFORM pg_temp.s112_mutiere('aal_ok_fehlender_claim', $m$
    CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $f$
      SELECT CASE
        WHEN coalesce((SELECT auth.jwt()) ->> 'aal', 'aal2') = 'aal2' THEN true
        WHEN (SELECT auth.uid()) IS NULL THEN true
        ELSE NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = (SELECT auth.uid()) AND f.status = 'verified')
      END $f$ $m$);
  PERFORM pg_temp.s112_mutiere('pruefe_ohne_stufe', $m$
    CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL::text[])
    RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
    BEGIN
      IF public.ist_service_kontext() THEN
        RETURN;
      END IF;
      IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Nicht angemeldet' USING ERRCODE = '42501';
      END IF;
      IF p_tenant_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM tenant_memberships
         WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND aktiv = true
           AND (p_rollen IS NULL OR role = ANY(p_rollen))) THEN
        RAISE EXCEPTION 'Kein Zugriff auf diesen Betrieb' USING ERRCODE = '42501';
      END IF;
    END $f$ $m$);
  PERFORM pg_temp.s112_mutiere('aal_ok_fuer_anon', $m$GRANT EXECUTE ON FUNCTION public.s112_aal_ok() TO anon$m$);

  -- ═══ 2. Lesen im echten Zustand: aal2 sieht die Zeile, aal1 sieht in der ganzen Tabelle nichts ═══════
  FOR v_tab, v_ziel IN SELECT key, value FROM jsonb_each(v_ziele) ORDER BY key LOOP
    PERFORM pg_temp.s112_als((v_a ->> (v_ziel ->> 'p'))::uuid, 'authenticated', 'aal2');
    v_x := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_ziel ->> 'w'));
    IF v_tab = ANY (c_ohne_lesepfad) THEN
      v_erg := v_erg || pg_temp.s112_erwarte('lesen_aal2_ohne_lesepfad_' || v_tab, v_x, '0');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('lesen_aal2_' || v_tab, v_x, '1');
    END IF;
    PERFORM pg_temp.s112_als((v_a ->> (v_ziel ->> 'p'))::uuid);   -- aal1, Faktor bestätigt
    v_erg := v_erg || pg_temp.s112_erwarte('lesen_aal1_' || v_tab,
               pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I', v_tab)), '0');
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ═══ 3. Isoliert: je Tabelle wirkt nur ihre eigene zwei_faktor_aal (Unterblock, wird zurückgerollt) ═══
  -- Der Zusatz hängt am AKTUELLEN Ausdruck der Policy – eine aufgeweichte (mutierte) Policy bleibt aufgeweicht.
  -- Die Ergebnisse landen in v_erg (PL/pgSQL-Variablen überstehen das Zurückrollen des Unterblocks).
  BEGIN
    FOR r IN SELECT p.tablename, p.qual, p.with_check FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.policyname = 'zwei_faktor_aal' LOOP
      EXECUTE format('ALTER POLICY zwei_faktor_aal ON public.%I USING ((%s) OR coalesce(current_setting(%L, true), %L) <> %L) WITH CHECK ((%s) OR coalesce(current_setting(%L, true), %L) <> %L)',
        r.tablename, coalesce(r.qual, 'true'), 's112.iso_tab', '', r.tablename,
        coalesce(r.with_check, r.qual, 'true'), 's112.iso_tab', '', r.tablename);
      v_iso_n := v_iso_n + 1;
    END LOOP;

    FOR v_tab, v_ziel IN SELECT key, value FROM jsonb_each(v_ziele) ORDER BY key LOOP
      v_w := v_ziel ->> 'w';
      PERFORM pg_temp.s112_als((v_a ->> (v_ziel ->> 'p'))::uuid);   -- aal1, Faktor bestätigt
      -- a) keine 2FA-Policy wirksam: Positivkontrolle
      PERFORM set_config('s112.iso_tab', '', true);
      v_rel_s := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_w));
      IF v_ziel ->> 'k' = 'T' THEN
        v_rel_i := pg_temp.s112_versuch(pg_temp.s112_klon_sql(v_tab, v_ziel -> 'z'));
        IF v_tab = ANY (c_stichprobe) THEN
          v_rel_u := pg_temp.s112_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', v_tab, v_ziel ->> 'u', v_ziel ->> 'u', v_w));
          v_rel_d := pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tab, v_w));
        END IF;
      END IF;
      -- b) nur die eigene zwei_faktor_aal wirksam
      PERFORM set_config('s112.iso_tab', v_tab, true);
      IF v_tab = ANY (c_ohne_lesepfad) THEN
        v_erg := v_erg || pg_temp.s112_erwarte('positiv_lesen_isoliert_ohne_lesepfad_' || v_tab, v_rel_s, '0');
      ELSE
        v_erg := v_erg || pg_temp.s112_erwarte('positiv_lesen_isoliert_' || v_tab, v_rel_s, '1');
      END IF;
      v_erg := v_erg || pg_temp.s112_erwarte('lesen_aal1_isoliert_' || v_tab,
                 pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_w)), '0');
      IF v_ziel ->> 'k' = 'T' THEN
        -- KAN-97: nur Tabellen, in die laut Soll-Matrix überhaupt jemand per API einfügen darf (nicht z. B. meldung_abgaben,
        -- pruefnummer_ereignisse – dort schreibt nur die RPC); sonst sänke jede neue RPC-Tabelle den Anteil
        v_t_tabellen := v_t_tabellen + (EXISTS (SELECT 1 FROM pg_temp.s112_soll() so
                                                 WHERE so.tabelle = v_tab AND so.aktion = 'INSERT' AND cardinality(so.rollen) > 0))::int;
        -- k1 oder Schlüsselkonflikt (23505 greift erst NACH der RLS-Prüfung) = RLS hat die Zeile zugelassen;
        -- ein fehlendes Recht bzw. ein Trigger-Fehler VOR der RLS-Prüfung darf dann auch hier erscheinen.
        v_ins_k1 := v_ins_k1 + (v_rel_i IN ('k1', 'E23505'))::int;
        v_soll := CASE WHEN v_rel_i IN ('G', 'T') THEN v_rel_i ELSE 'R' END;
        v_erg := v_erg || pg_temp.s112_erwarte('insert_aal1_' || v_tab,
                   pg_temp.s112_versuch(pg_temp.s112_klon_sql(v_tab, v_ziel -> 'z')), v_soll);
        IF v_tab = ANY (c_stichprobe) THEN
          v_stich_n := v_stich_n + 1;
          v_erg := v_erg || pg_temp.s112_erwarte('positiv_update_isoliert_' || v_tab, v_rel_u, 'k1');
          v_erg := v_erg || pg_temp.s112_erwarte('update_aal1_' || v_tab,
                     pg_temp.s112_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', v_tab, v_ziel ->> 'u', v_ziel ->> 'u', v_w)), 'k0');
          v_erg := v_erg || pg_temp.s112_erwarte('positiv_delete_isoliert_' || v_tab, v_rel_d, 'k1');
          v_erg := v_erg || pg_temp.s112_erwarte('delete_aal1_' || v_tab,
                     pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tab, v_w)), 'k0');
        END IF;
      END IF;
    END LOOP;
    PERFORM pg_temp.s112_als_postgres();
    RAISE EXCEPTION USING ERRCODE = c_iso_fehler, MESSAGE = 'isolierter Durchlauf fertig';
  EXCEPTION
    WHEN SQLSTATE 'S1I15' THEN
      NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      v_erg := v_erg || pg_temp.s112_fehler('isoliert_abbruch', v_state || ': ' || v_msg);
  END;
  -- Positivkontrollen des isolierten Durchlaufs (sonst prüfte er ins Leere)
  v_erg := v_erg || pg_temp.s112_erwarte('isoliert_policies_angepasst', v_iso_n::bigint,
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'zwei_faktor_aal'));
  v_erg := v_erg || pg_temp.s112_erwarte('isoliert_stichprobe_geprueft', v_stich_n, cardinality(c_stichprobe));
  IF v_t_tabellen > 0 AND v_ins_k1 >= ceil(c_min_anteil * v_t_tabellen) THEN
    v_erg := v_erg || pg_temp.s112_ok('positiv_insert_isoliert');
  ELSE
    v_erg := v_erg || pg_temp.s112_fehler('positiv_insert_isoliert', 'nur ' || v_ins_k1 || ' von ' || v_t_tabellen
               || ' T-Tabellen ohne wirksame 2FA-Policy von der RLS zugelassen, soll >= ' || ceil(c_min_anteil * v_t_tabellen));
  END IF;
  -- Der Unterblock ist zurückgerollt: die Policies tragen den Zusatz nicht mehr
  v_erg := v_erg || pg_temp.s112_erwarte('isoliert_zurueckgerollt',
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'zwei_faktor_aal'
        AND (p.qual LIKE '%s112.iso_tab%' OR p.with_check LIKE '%s112.iso_tab%')), 0::bigint);

  -- tenants (G): UPDATE des eigenen Betriebs (bio_status ist für Benutzer freigegeben)
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_update_aal2',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = bio_status WHERE id = %L', v_b)), 'k1');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_update_aal1',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = bio_status WHERE id = %L', v_b)), 'k0');

  -- ═══ 4. s112_aal_ok() (über s112_zaehle: ein Fehler wird zum Code statt zum Abbruch) ═══════════════
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_aal1_mit_faktor', pg_temp.s112_zaehle('SELECT public.s112_aal_ok()::int'), '0');
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_aal2', pg_temp.s112_zaehle('SELECT public.s112_aal_ok()::int'), '1');
  -- Claim ohne 'aal' → wie aal1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bta, 'role', 'authenticated')::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_ohne_aal_claim', pg_temp.s112_zaehle('SELECT public.s112_aal_ok()::int'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_aal_claim_tenants',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', v_b)), '0');
  -- 'AAL2' in Großbuchstaben → wie aal1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bta, 'role', 'authenticated', 'aal', 'AAL2')::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_grossbuchstaben', pg_temp.s112_zaehle('SELECT public.s112_aal_ok()::int'), '0');
  -- unbestätigter Faktor zählt nicht
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_unverifiziert', pg_temp.s112_zaehle('SELECT public.s112_aal_ok()::int'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('unverifiziert_tenants',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', v_b)), '1');
  -- Winzer ohne Faktor bei aal1: nicht betroffen
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_ohne_faktor', pg_temp.s112_zaehle('SELECT public.s112_aal_ok()::int'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_faktor_tenants',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_faktor_kontakte',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE %s', v_ziele -> 'kontakte' ->> 'w')), '1');

  -- ═══ 5. RPCs ════════════════════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('pruefe_tenant_zugriff_aal1',
    pg_temp.s112_fehlertext(format('SELECT public.pruefe_tenant_zugriff(%L, ARRAY[''system_admin'',''tenant_admin'',''winzer''])', v_b)),
    '42501: Zwei-Faktor-Anmeldung erforderlich');
  v_erg := v_erg || pg_temp.s112_erwarte('rechnungsnummer_aal1',
    pg_temp.s112_fehlertext(format('SELECT public.get_next_rechnungsnummer(%L)', v_b)),
    '42501: Zwei-Faktor-Anmeldung erforderlich');
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('pruefe_tenant_zugriff_aal2',
    pg_temp.s112_fehlertext(format('SELECT public.pruefe_tenant_zugriff(%L, ARRAY[''system_admin'',''tenant_admin'',''winzer''])', v_b)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('rechnungsnummer_aal2',
    pg_temp.s112_versuch(format('SELECT public.get_next_rechnungsnummer(%L)', v_b)), 'k1');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('pruefe_tenant_zugriff_ohne_faktor',
    pg_temp.s112_fehlertext(format('SELECT public.pruefe_tenant_zugriff(%L, ARRAY[''system_admin'',''tenant_admin'',''winzer''])', v_b)), 'ok');

  -- ═══ 6. Pre-Request (PostgREST ruft ihn vor jeder Data-API-Anfrage auf) ═════════════════════════════
  PERFORM pg_temp.s112_als(v_bta);
  v_x := pg_temp.s112_fehlertext('SELECT public.s112_pre_request()');
  IF v_x LIKE 'PT401: Zwei-Faktor-Anmeldung erforderlich | HINT: %aal2%' THEN
    v_erg := v_erg || pg_temp.s112_ok('pre_request_aal1_mit_faktor');
  ELSE
    v_erg := v_erg || pg_temp.s112_fehler('pre_request_aal1_mit_faktor', 'ist=' || v_x);
  END IF;
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_aal2', pg_temp.s112_fehlertext('SELECT public.s112_pre_request()'), 'ok');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_anon', pg_temp.s112_fehlertext('SELECT public.s112_pre_request()'), 'ok');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_ohne_faktor', pg_temp.s112_fehlertext('SELECT public.s112_pre_request()'), 'ok');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_unverifiziert', pg_temp.s112_fehlertext('SELECT public.s112_pre_request()'), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_an_authenticator',
    EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles ro ON ro.oid = s.setrole
             WHERE ro.rolname = 'authenticator' AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
               AND 'pgrst.db_pre_request=public.s112_pre_request' = ANY (s.setconfig)), true);

  -- ═══ 7. s112_aal_ok: Definer und EXECUTE-Rechte ═════════════════════════════════════════════════════
  -- Als INVOKER läse s112_aal_ok auth.mfa_factors mit den Rechten des Benutzers (kein Zugriff → jede Policy
  -- scheitert bzw. hängt an fremden Rechten)
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_security_definer',
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.s112_aal_ok()'::regprocedure), true);
  v_erg := v_erg || pg_temp.s112_erwarte('aal_ok_search_path',
    (SELECT 'search_path=public' = ANY (coalesce(p.proconfig, '{}')) FROM pg_proc p WHERE p.oid = 'public.s112_aal_ok()'::regprocedure), true);
  v_erg := v_erg || pg_temp.s112_erwarte('execute_authenticated_s112_aal_ok',
    has_function_privilege('authenticated', 'public.s112_aal_ok()', 'EXECUTE'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('execute_anon_s112_aal_ok_recht',
    has_function_privilege('anon', 'public.s112_aal_ok()', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('execute_anon_s112_pre_request',
    has_function_privilege('anon', 'public.s112_pre_request()', 'EXECUTE'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('execute_authenticated_s112_pre_request',
    has_function_privilege('authenticated', 'public.s112_pre_request()', 'EXECUTE'), true);
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('execute_anon_s112_aal_ok_aufruf',
    pg_temp.s112_versuch('SELECT public.s112_aal_ok()'), 'G');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('execute_authenticated_s112_aal_ok_aufruf',
    pg_temp.s112_versuch('SELECT public.s112_aal_ok()'), 'k1');

  -- ═══ 8. Storage ═════════════════════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_lesen_aal2',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'dokumente', v_obj)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_aal2',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
      'dokumente', v_b::text || '/s112test/zwei-faktor-neu-aal2.pdf', v_bta)), 'k1');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('storage_lesen_aal1',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'dokumente', v_obj)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_alle_aal1',
    pg_temp.s112_zaehle('SELECT count(*) FROM storage.objects'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_aal1',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
      'dokumente', v_b::text || '/s112test/zwei-faktor-neu-aal1.pdf', v_bta)), 'R');
  PERFORM pg_temp.s112_als_postgres();

  -- ═══ 9. Statisch ════════════════════════════════════════════════════════════════════════════════════
  -- Prüfabfrage aus dem KAN-136-Entwurf, verschärft: jede RLS-Tabelle in public und storage.objects hat
  -- zwei_faktor_aal als RESTRICTIVE ALL TO authenticated, USING und WITH CHECK EXAKT „(SELECT s112_aal_ok())“
  -- (ohne Leerraum und ohne Schema-Präfix verglichen) – „(SELECT s112_aal_ok()) OR true“ fällt damit auf.
  SELECT count(*), string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY n.nspname, c.relname) INTO v_n, v_x
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
     AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
     AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = n.nspname AND p.tablename = c.relname AND p.policyname = 'zwei_faktor_aal'
                        AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL' AND p.roles = '{authenticated}'
                        AND replace(regexp_replace(p.qual, '\s+', '', 'g'), 'public.', '') = c_aal_ok_soll
                        AND replace(regexp_replace(p.with_check, '\s+', '', 'g'), 'public.', '') = c_aal_ok_soll);
  IF v_n = 0 THEN
    v_erg := v_erg || pg_temp.s112_ok('zwei_faktor_policy_fehlt');
  ELSE
    v_erg := v_erg || pg_temp.s112_fehler('zwei_faktor_policy_fehlt', v_n || ' Tabellen ohne exakte zwei_faktor_aal: ' || v_x);
  END IF;
  v_erg := v_erg || pg_temp.s112_erwarte('zwei_faktor_policy_tabellen',
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'zwei_faktor_aal'),
    (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity));
  -- Tabellen ohne Lesepfad: wirklich keine permissive SELECT-/ALL-Policy für authenticated bzw. public
  FOREACH v_tab IN ARRAY c_ohne_lesepfad LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('ohne_lesepfad_' || v_tab,
      (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_tab
          AND p.permissive = 'PERMISSIVE' AND p.cmd IN ('SELECT', 'ALL')
          AND p.roles && ARRAY['authenticated', 'public', 'anon']::name[]), 0::bigint);
  END LOOP;

  -- B15: RPCs mit eigener Mitgliedsprüfung (Einstufung session_user) ohne eigene Stufenprüfung
  SELECT count(*) FILTER (WHERE p.oid IS NULL) INTO v_n
    FROM pg_temp.s112_soll_rpc() s
    LEFT JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace
                       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s.funktion
   WHERE s.einstufung = 'session_user';
  v_erg := v_erg || pg_temp.s112_erwarte('session_user_rpcs_vorhanden', v_n, 0::bigint);
  SELECT count(*), string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_n, v_x
    FROM pg_temp.s112_soll_rpc() s
    JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace
                  AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s.funktion
   WHERE s.einstufung = 'session_user'
     AND p.prosrc NOT ILIKE '%s112_aal_ok%' AND p.prosrc NOT ILIKE '%pruefe_tenant_zugriff%';
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_eigene_mitgliedspruefung_ohne_stufe', coalesce(v_x, ''), '');   -- B15 seit KAN-159 Teil 2 hart

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 400);
END
$test$;
