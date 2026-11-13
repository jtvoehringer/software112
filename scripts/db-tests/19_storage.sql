-- @bereich: Storage – Ordner-Policies der 7 Buckets (storage.objects)
-- @ziel: Objekte liegen je Betrieb im Ordner <tenant_id>/…; niemand liest, legt an, verschiebt oder löscht im
-- @ziel: Ordner eines fremden Betriebs. Schreibrechte je Bucket folgen Rolle und Schreibmodul (aktivitaet-dokumente
-- @ziel: crm|warenwirtschaft, analysen kellerbuch (Löschen niemand, KAN-150 F2a), dokumente jeder Winzer, ea-belege ea,
-- @ziel: fuellung-bilder kellerbuch|warenwirtschaft (KAN-220), etiketten
-- @ziel: SA/TA); kein Bucket hat eine UPDATE-Policy außer mandant-logos (nur Plattform-Admin). mandant-logos ist
-- @ziel: öffentlich lesbar (auch anon, auch fremde Logos), schreiben darf dort nur der Plattform-Admin. Objekte ohne
-- @ziel: Mandantenordner sieht niemand (NULL-sicher, ohne Fehler); Stichproben zu Abo-Sperre, inaktiver
-- @ziel: Mitgliedschaft und Zwei-Faktor; Pfad-Randfälle ('..', UUID in Großbuchstaben) festgehalten. Rechte gelten
-- @ziel: je Betrieb: wer in B tenant_admin, in M aber nur Leser bzw. Winzer ohne Modul ist, schreibt in M nichts.
-- @ziel: storage.buckets hat keine Policy; Benutzer ändern, legen an oder löschen keine Buckets.
-- @mutation meine_tenants_alle: s112_meine_tenants liefert alle Betriebe statt der eigenen aktiven | rot: sel_(akt|ana|dok|ea|eti)_.*_fremd|sel_.*_ohne_betrieb|inaktiv_.*|mix_sel_ea_m
-- @mutation darf_schreiben_offen: s112_darf_schreiben prüft nur noch die aktive Mitgliedschaft (Rolle und Modul egal) | rot: ins_.*_eigen|del_.*_eigen
-- @mutation rolle_offen: user_has_role_in_tenant liefert immer true (etiketten-Upload; analysen-Löschen seit KAN-150 F2a ohne Policy) | rot: ins_eti_.*
-- @mutation pa_fuer_alle: alle Test-Benutzer werden Plattform-Admin (mandant-logos schreibbar) | rot: ins_logo_.*|upd_logo_.*|del_logo_.*|abo_.*
-- @mutation darf_schreiben_ohne_tenant: s112_darf_schreiben ignoriert p_tenant (Rolle/Modul aus irgendeinem eigenen Betrieb genügt) | rot: (ins|del)_.*_x0?_in_m
-- @mutation rolle_ohne_tenant: user_has_role_in_tenant ignoriert p_tenant_id (SA/TA in irgendeinem Betrieb genügt) | rot: ins_eti_x0?_in_m
--
-- software:112 – SQL-Testrahmen, Datei 19 (Stand 28.09.2026). Nur Staging; eine Transaktion, endet mit
-- pg_temp.s112_ende(…) = RAISE → alles zurückgerollt, auch die Test-Objekte in storage.objects.
--
-- Staging hat 0 Storage-Objekte: der Test legt als postgres je Bucket ein Objekt im Ordner von B und von M an,
-- dazu je eines mit Nicht-UUID-Ordner ('s112test-ohne-mandant/…') und eines ganz ohne Ordner. Die Policies auf
-- storage.objects gehören supabase_storage_admin (postgres darf sie nicht ändern) – die Mutationen laufen deshalb
-- über die Hilfsfunktionen s112_meine_tenants, s112_darf_schreiben, user_has_role_in_tenant bzw. plattform_admins.
--
-- Soll je Bucket (Policies auf Staging, 28.09.2026; identisch mit der Produktion):
--   Bucket                 Lesen          Hochladen                 Löschen                  Ändern/Verschieben
--   aktivitaet-dokumente   Mitglieder     crm | warenwirtschaft     crm | warenwirtschaft    niemand
--   analysen               Mitglieder     kellerbuch                niemand (KAN-150 F2a)    niemand
--   dokumente              Mitglieder     jeder Winzer ('betrieb')  niemand                  niemand
--   ea-belege              Mitglieder     ea                        ea                       niemand
--   etiketten              Mitglieder     SA/TA                     niemand                  niemand
--   export-nachweise       Mitglieder     warenwirtschaft           warenwirtschaft          niemand   (KAN-440)
--   fuellung-bilder        Mitglieder     kellerbuch | warenwirtschaft  kellerbuch | warenwirtschaft  niemand   (KAN-220)
--   mandant-logos          alle, auch anon Plattform-Admin          Plattform-Admin          Plattform-Admin
-- SA/TA dürfen über s112_darf_schreiben jedes Modul; der Leser nirgends. Mitglied = s112_meine_tenants (nur aktiv).
-- Löschen braucht zusätzlich den Schalter storage.allow_delete_query (sonst 42501 aus storage.protect_delete);
-- s112_als setzt ihn zurück – deshalb NACH s112_als setzen.

-- Kurzname eines Buckets für die Prüfnamen.
CREATE FUNCTION pg_temp.t19_kurz(p_bucket text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE p_bucket
    WHEN 'aktivitaet-dokumente' THEN 'akt'
    WHEN 'analysen' THEN 'ana'
    WHEN 'dokumente' THEN 'dok'
    WHEN 'ea-belege' THEN 'ea'
    WHEN 'etiketten' THEN 'eti'
    WHEN 'export-nachweise' THEN 'exn'
    WHEN 'fuellung-bilder' THEN 'fb'
    WHEN 'mandant-logos' THEN 'logo'
  END
$f$;

-- Objektname im Test-Unterordner eines Ordners (Ordner = tenant_id als Text).
CREATE FUNCTION pg_temp.t19_pfad(p_ordner text, p_datei text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT p_ordner || '/s112test/' || p_datei
$f$;

-- Sichtbare Objekte mit genau diesem Namen (als aktive Rolle) → '0', '1' … oder Fehlercode.
CREATE FUNCTION pg_temp.t19_zahl(p_bucket text, p_name text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', p_bucket, p_name));
END $f$;

-- Hochladen (INSERT), sofort zurückgerollt → k1 | R | G | T | E…
CREATE FUNCTION pg_temp.t19_ins(p_bucket text, p_name text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.s112_versuch(format(
    'INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (%L, %L, auth.uid(), auth.uid()::text)', p_bucket, p_name));
END $f$;

-- Umbenennen/Verschieben (UPDATE name), sofort zurückgerollt → k<n> | …
CREATE FUNCTION pg_temp.t19_upd(p_bucket text, p_alt text, p_neu text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.s112_versuch(format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L', p_neu, p_bucket, p_alt));
END $f$;

-- Löschen, sofort zurückgerollt → k<n> | … (Schalter storage.allow_delete_query setzt der Aufrufer)
CREATE FUNCTION pg_temp.t19_del(p_bucket text, p_name text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.s112_versuch(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', p_bucket, p_name));
END $f$;

-- Soll im EIGENEN Ordner (B) je Aktion, Bucket-Kurzname und Persona (Tabelle im Dateikopf).
--   Personas: b_ta, b_w (alle 6 Module), b_w_crm, b_w_ww (nur warenwirtschaft), b_w_leer ('{}'), b_l, pa
CREATE FUNCTION pg_temp.t19_soll(p_aktion text, p_kurz text, p_persona text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE p_aktion
    WHEN 'ins' THEN CASE
      WHEN p_kurz = 'logo' THEN CASE WHEN p_persona = 'pa' THEN 'k1' ELSE 'R' END
      WHEN p_persona IN ('b_ta', 'pa') THEN 'k1'
      WHEN p_persona = 'b_l' THEN 'R'
      WHEN p_kurz = 'akt' THEN CASE WHEN p_persona IN ('b_w', 'b_w_crm', 'b_w_ww') THEN 'k1' ELSE 'R' END
      WHEN p_kurz IN ('fb', 'exn') THEN CASE WHEN p_persona IN ('b_w', 'b_w_ww') THEN 'k1' ELSE 'R' END   -- KAN-220: kellerbuch | warenwirtschaft; KAN-440: warenwirtschaft
      WHEN p_kurz IN ('ana', 'ea') THEN CASE WHEN p_persona = 'b_w' THEN 'k1' ELSE 'R' END
      WHEN p_kurz = 'dok' THEN 'k1'          -- Modul 'betrieb': jeder Winzer, auch ohne Schreibmodul
      WHEN p_kurz = 'eti' THEN 'R'           -- nur SA/TA
    END
    WHEN 'del' THEN CASE
      WHEN p_kurz = 'logo' THEN CASE WHEN p_persona = 'pa' THEN 'k1' ELSE 'k0' END
      WHEN p_kurz IN ('dok', 'eti', 'ana') THEN 'k0'   -- keine DELETE-Policy (ana: KAN-150 F2a, „analysen: Admins löschen“ entfallen)
      WHEN p_persona IN ('b_ta', 'pa') THEN 'k1'
      WHEN p_persona = 'b_l' THEN 'k0'
      WHEN p_kurz = 'akt' THEN CASE WHEN p_persona IN ('b_w', 'b_w_crm', 'b_w_ww') THEN 'k1' ELSE 'k0' END
      WHEN p_kurz IN ('fb', 'exn') THEN CASE WHEN p_persona IN ('b_w', 'b_w_ww') THEN 'k1' ELSE 'k0' END   -- KAN-220, KAN-440
      WHEN p_kurz = 'ea' THEN CASE WHEN p_persona = 'b_w' THEN 'k1' ELSE 'k0' END
    END
    WHEN 'upd' THEN CASE WHEN p_kurz = 'logo' AND p_persona = 'pa' THEN 'k1' ELSE 'k0' END
  END
$f$;

DO $test$
DECLARE
  c_datei   constant text := '19_storage';
  c_buckets constant text[] := ARRAY['aktivitaet-dokumente', 'analysen', 'dokumente', 'ea-belege', 'etiketten', 'export-nachweise', 'fuellung-bilder', 'mandant-logos'];
  c_schreiber constant text[] := ARRAY['b_ta', 'b_w', 'b_w_crm', 'b_w_ww', 'b_w_leer', 'b_l', 'pa'];
  v_t0      timestamptz := clock_timestamp();
  v_erg     text[] := '{}';
  v_a       jsonb;
  v_p       jsonb;
  v_m       text;
  v_b       text;
  v_bucket  text;
  v_k       text;
  v_pers    text;
  v_obj_b   text;
  v_obj_m   text;
  v_eigen   text;
  v_fremd   text;
  v_ohne    text;
  v_wurzel  text;
  v_pfad_pp text;
  v_pfad_gr text;
  v_n       bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── Aufbau (als postgres) ────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := v_a ->> 'm';
  v_b := v_a ->> 'b';
  v_p := v_a || jsonb_build_object(
    'b_w_crm', pg_temp.s112_benutzer('winzer', v_b::uuid, ARRAY['crm']),
    'b_w_ww', pg_temp.s112_benutzer('winzer', v_b::uuid, ARRAY['warenwirtschaft']),
    'b_w_leer', pg_temp.s112_benutzer('winzer', v_b::uuid, '{}'::text[]),
    -- Rechte je Betrieb verschieden: x = tenant_admin in B, aber nur leser in M;
    -- x0 = tenant_admin in B, aber winzer ohne Schreibmodul ('{}') in M (beide Mitgliedschaften aktiv)
    'x', pg_temp.s112_benutzer('tenant_admin', v_b::uuid),
    'x0', pg_temp.s112_benutzer('tenant_admin', v_b::uuid));
  PERFORM pg_temp.s112_mitglied((v_p ->> 'x')::uuid, v_m::uuid, 'leser');
  PERFORM pg_temp.s112_mitglied((v_p ->> 'x0')::uuid, v_m::uuid, 'winzer', '{}'::text[]);
  SELECT count(*) INTO v_n FROM public.tenant_memberships
   WHERE aktiv AND ((user_id = (v_p ->> 'x')::uuid AND ((tenant_id = v_b::uuid AND role = 'tenant_admin') OR (tenant_id = v_m::uuid AND role = 'leser')))
                 OR (user_id = (v_p ->> 'x0')::uuid AND ((tenant_id = v_b::uuid AND role = 'tenant_admin')
                                                       OR (tenant_id = v_m::uuid AND role = 'winzer' AND schreibmodule = '{}'::text[]))));
  v_erg := v_erg || pg_temp.s112_erwarte('x_personas_zwei_rollen_je_betrieb', v_n, 4);

  SELECT count(*) INTO v_n FROM storage.buckets WHERE id = ANY (c_buckets) AND public = (id = 'mandant-logos');
  v_erg := v_erg || pg_temp.s112_erwarte('buckets_vorhanden_nur_logos_oeffentlich', v_n, 8);   -- +1 KAN-440 (export-nachweise)   -- +1 KAN-220 (fuellung-bilder)

  FOREACH v_bucket IN ARRAY c_buckets LOOP
    v_k := pg_temp.t19_kurz(v_bucket);
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      (v_bucket, pg_temp.t19_pfad(v_b, v_k || '-b.dat'), (v_p ->> 'b_ta')::uuid),
      (v_bucket, pg_temp.t19_pfad(v_m, v_k || '-m.dat'), (v_p ->> 'm_ta')::uuid),
      (v_bucket, 's112test-ohne-mandant/' || v_k || '.dat', NULL),
      (v_bucket, 's112test-wurzel-' || v_k || '.dat', NULL);
  END LOOP;
  -- Pfad-Randfälle (ea-belege): '<B>/../<M>/…' und B in Großbuchstaben
  v_pfad_pp := v_b || '/../' || v_m || '/s112test/punktpunkt.dat';
  v_pfad_gr := pg_temp.t19_pfad(upper(v_b), 'gross.dat');
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('ea-belege', v_pfad_pp, NULL), ('ea-belege', v_pfad_gr, NULL);

  -- ── Mutationen (nur im Mutationsmodus von run.mjs) ──────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('meine_tenants_alle',
    $m$CREATE OR REPLACE FUNCTION public.s112_meine_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'public' AS $x$ SELECT t.id FROM public.tenants t $x$$m$);
  PERFORM pg_temp.s112_mutiere('darf_schreiben_offen',
    $m$CREATE OR REPLACE FUNCTION public.s112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[]) RETURNS boolean
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$
       SELECT EXISTS (SELECT 1 FROM public.tenant_memberships m
                       WHERE m.tenant_id = p_tenant AND m.user_id = (SELECT auth.uid()) AND m.aktiv) $x$$m$);
  PERFORM pg_temp.s112_mutiere('rolle_offen',
    $m$CREATE OR REPLACE FUNCTION public.user_has_role_in_tenant(p_tenant_id uuid, p_roles text[]) RETURNS boolean
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$ SELECT true $x$$m$);
  PERFORM pg_temp.s112_mutiere('pa_fuer_alle',
    $m$INSERT INTO public.plattform_admins (user_id, hinweis)
       SELECT u.id, 'S112TEST Mutation' FROM auth.users u WHERE u.email LIKE 's112test-%'
       ON CONFLICT DO NOTHING$m$);
  PERFORM pg_temp.s112_mutiere('darf_schreiben_ohne_tenant',
    $m$CREATE OR REPLACE FUNCTION public.s112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[]) RETURNS boolean
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$
       SELECT EXISTS (SELECT 1 FROM public.tenant_memberships m
                       WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
                         AND (m.role IN ('system_admin', 'tenant_admin')
                              OR (m.role = 'winzer' AND ('betrieb' = ANY (p_module) OR COALESCE(m.schreibmodule, '{}') && p_module)))) $x$$m$);
  PERFORM pg_temp.s112_mutiere('rolle_ohne_tenant',
    $m$CREATE OR REPLACE FUNCTION public.user_has_role_in_tenant(p_tenant_id uuid, p_roles text[]) RETURNS boolean
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$
       SELECT EXISTS (SELECT 1 FROM public.tenant_memberships
                       WHERE user_id = (SELECT auth.uid()) AND role = ANY (p_roles) AND aktiv) $x$$m$);

  -- ── 1. Bestand als postgres belegen (Grundlage jeder „0 sichtbar“-Wertung) ──────────────────────────
  FOREACH v_bucket IN ARRAY c_buckets LOOP
    v_k := pg_temp.t19_kurz(v_bucket);
    SELECT count(*) INTO v_n FROM storage.objects
     WHERE bucket_id = v_bucket
       AND name IN (pg_temp.t19_pfad(v_b, v_k || '-b.dat'), pg_temp.t19_pfad(v_m, v_k || '-m.dat'),
                    's112test-ohne-mandant/' || v_k || '.dat', 's112test-wurzel-' || v_k || '.dat');
    v_erg := v_erg || pg_temp.s112_erwarte('existiert_' || v_k || '_b_m_ohne_wurzel', v_n, 4);
  END LOOP;
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'ea-belege' AND name IN (v_pfad_pp, v_pfad_gr);
  v_erg := v_erg || pg_temp.s112_erwarte('existiert_pfad_randfaelle', v_n, 2);
  v_erg := v_erg || pg_temp.s112_erwarte('foldername_ohne_ordner_null',
    (storage.foldername('s112test-wurzel-ea.dat'))[1] IS NULL AND (storage.foldername('s112test-ohne-mandant/ea.dat'))[1] = 's112test-ohne-mandant', true);

  -- ── 2. Lesen je Bucket × Persona ────────────────────────────────────────────────────────────────────
  FOREACH v_bucket IN ARRAY c_buckets LOOP
    v_k := pg_temp.t19_kurz(v_bucket);
    v_obj_b := pg_temp.t19_pfad(v_b, v_k || '-b.dat');
    v_obj_m := pg_temp.t19_pfad(v_m, v_k || '-m.dat');
    v_ohne := format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name IN (%L, %L)',
                     v_bucket, 's112test-ohne-mandant/' || v_k || '.dat', 's112test-wurzel-' || v_k || '.dat');
    FOREACH v_pers IN ARRAY ARRAY['b_ta', 'b_w', 'b_l', 'm_ta'] LOOP
      IF v_pers LIKE 'm\_%' THEN v_eigen := v_obj_m; v_fremd := v_obj_b; ELSE v_eigen := v_obj_b; v_fremd := v_obj_m; END IF;
      PERFORM pg_temp.s112_als((v_p ->> v_pers)::uuid);
      v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_%s_eigen', v_k, v_pers), pg_temp.t19_zahl(v_bucket, v_eigen), '1');
      -- mandant-logos: fremde Logos sind gewollt lesbar (öffentlicher Bucket)
      v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_%s_fremd', v_k, v_pers), pg_temp.t19_zahl(v_bucket, v_fremd),
                                             CASE WHEN v_k = 'logo' THEN '1' ELSE '0' END);
      v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_%s_ohne_mandantenordner', v_k, v_pers), pg_temp.s112_zaehle(v_ohne),
                                             CASE WHEN v_k = 'logo' THEN '2' ELSE '0' END);
    END LOOP;
    PERFORM pg_temp.s112_als((v_p ->> 'ohne')::uuid);
    v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_ohne_betrieb', v_k), pg_temp.t19_zahl(v_bucket, v_obj_b),
                                           CASE WHEN v_k = 'logo' THEN '1' ELSE '0' END);
    PERFORM pg_temp.s112_als(NULL, 'anon');
    v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_anon_b', v_k), pg_temp.t19_zahl(v_bucket, v_obj_b), CASE WHEN v_k = 'logo' THEN '1' ELSE '0' END);
    v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_anon_m', v_k), pg_temp.t19_zahl(v_bucket, v_obj_m), CASE WHEN v_k = 'logo' THEN '1' ELSE '0' END);
    v_erg := v_erg || pg_temp.s112_erwarte(format('sel_%s_anon_ohne_mandantenordner', v_k), pg_temp.s112_zaehle(v_ohne), CASE WHEN v_k = 'logo' THEN '2' ELSE '0' END);
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;

  -- ── 3. Hochladen: eigener Ordner gegen das Soll, fremder Ordner (M) immer R ─────────────────────────
  FOREACH v_bucket IN ARRAY c_buckets LOOP
    v_k := pg_temp.t19_kurz(v_bucket);
    FOREACH v_pers IN ARRAY c_schreiber LOOP
      PERFORM pg_temp.s112_als((v_p ->> v_pers)::uuid);
      v_erg := v_erg || pg_temp.s112_erwarte(format('ins_%s_%s_eigen', v_k, v_pers),
        pg_temp.t19_ins(v_bucket, pg_temp.t19_pfad(v_b, 'neu-' || v_k || '.dat')), pg_temp.t19_soll('ins', v_k, v_pers));
      -- pa ist (wie jeder Plattform-Admin) system_admin in JEDEM Betrieb, also auch in M – kein fremder Ordner
      IF v_pers <> 'pa' THEN
        v_erg := v_erg || pg_temp.s112_erwarte(format('ins_%s_%s_fremd', v_k, v_pers),
          pg_temp.t19_ins(v_bucket, pg_temp.t19_pfad(v_m, 'neu-' || v_k || '.dat')), 'R');
      END IF;
    END LOOP;
    -- ohne Mandantenordner: NULL-sicher abgelehnt (bzw. bei mandant-logos für den PA erlaubt)
    PERFORM pg_temp.s112_als((v_p ->> CASE WHEN v_k = 'logo' THEN 'pa' ELSE 'b_ta' END)::uuid);
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_%s_ohne_mandantenordner', v_k),
      pg_temp.t19_ins(v_bucket, 's112test-ohne-mandant/neu-' || v_k || '.dat'), CASE WHEN v_k = 'logo' THEN 'k1' ELSE 'R' END);
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_%s_wurzel', v_k),
      pg_temp.t19_ins(v_bucket, 's112test-wurzel-neu-' || v_k || '.dat'), CASE WHEN v_k = 'logo' THEN 'k1' ELSE 'R' END);
    PERFORM pg_temp.s112_als(NULL, 'anon');
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_%s_anon', v_k),
      pg_temp.t19_ins(v_bucket, pg_temp.t19_pfad(v_b, 'anon-' || v_k || '.dat')), 'R');
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;

  -- ── 3b. Rechte je Betrieb: TA in B zählt nicht in M (x: leser in M, x0: winzer ohne Modul in M) ─────
  -- Mitglied in M sind beide (Lesen = Positivkontrolle), schreiben dürfen sie dort nur, was die M-Rolle erlaubt.
  FOREACH v_pers IN ARRAY ARRAY['x', 'x0'] LOOP
    PERFORM pg_temp.s112_als((v_p ->> v_pers)::uuid);
    v_erg := v_erg || pg_temp.s112_erwarte(format('sel_ea_%s_m_sichtbar', v_pers), pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_m, 'ea-m.dat')), '1');
    v_erg := v_erg || pg_temp.s112_erwarte(format('sel_eti_%s_m_sichtbar', v_pers), pg_temp.t19_zahl('etiketten', pg_temp.t19_pfad(v_m, 'eti-m.dat')), '1');
    -- Gegenprobe im eigenen Ordner B (dort TA)
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_eti_%s_in_b', v_pers), pg_temp.t19_ins('etiketten', pg_temp.t19_pfad(v_b, 'x-eti.dat')), 'k1');
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_ea_%s_in_b', v_pers), pg_temp.t19_ins('ea-belege', pg_temp.t19_pfad(v_b, 'x-ea.dat')), 'k1');
    -- in M: nur Leser bzw. Winzer ohne Modul
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_eti_%s_in_m', v_pers), pg_temp.t19_ins('etiketten', pg_temp.t19_pfad(v_m, 'x-eti.dat')), 'R');
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_ea_%s_in_m', v_pers), pg_temp.t19_ins('ea-belege', pg_temp.t19_pfad(v_m, 'x-ea.dat')), 'R');
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_ana_%s_in_m', v_pers), pg_temp.t19_ins('analysen', pg_temp.t19_pfad(v_m, 'x-ana.dat')), 'R');
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_akt_%s_in_m', v_pers), pg_temp.t19_ins('aktivitaet-dokumente', pg_temp.t19_pfad(v_m, 'x-akt.dat')), 'R');
    -- dokumente (Modul 'betrieb'): Leser nein, jeder Winzer ja – auch ohne Schreibmodul
    v_erg := v_erg || pg_temp.s112_erwarte(format('ins_dok_%s_in_m', v_pers), pg_temp.t19_ins('dokumente', pg_temp.t19_pfad(v_m, 'x-dok.dat')),
                                           CASE WHEN v_pers = 'x0' THEN 'k1' ELSE 'R' END);
    PERFORM set_config('storage.allow_delete_query', 'true', true);   -- NACH s112_als
    v_erg := v_erg || pg_temp.s112_erwarte(format('del_ana_%s_in_b', v_pers), pg_temp.t19_del('analysen', pg_temp.t19_pfad(v_b, 'ana-b.dat')), 'k0');   -- KAN-150 F2a: vorher k1 (TA in B)
    v_erg := v_erg || pg_temp.s112_erwarte(format('del_ana_%s_in_m', v_pers), pg_temp.t19_del('analysen', pg_temp.t19_pfad(v_m, 'ana-m.dat')), 'k0');
    v_erg := v_erg || pg_temp.s112_erwarte(format('del_ea_%s_in_m', v_pers), pg_temp.t19_del('ea-belege', pg_temp.t19_pfad(v_m, 'ea-m.dat')), 'k0');
    v_erg := v_erg || pg_temp.s112_erwarte(format('del_akt_%s_in_m', v_pers), pg_temp.t19_del('aktivitaet-dokumente', pg_temp.t19_pfad(v_m, 'akt-m.dat')), 'k0');
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 4. Umbenennen/Verschieben (UPDATE name): nur mandant-logos hat eine UPDATE-Policy (PA) ───────────
  FOREACH v_bucket IN ARRAY c_buckets LOOP
    v_k := pg_temp.t19_kurz(v_bucket);
    v_obj_b := pg_temp.t19_pfad(v_b, v_k || '-b.dat');
    v_obj_m := pg_temp.t19_pfad(v_m, v_k || '-m.dat');
    FOREACH v_pers IN ARRAY ARRAY['b_ta', 'b_w', 'b_l', 'pa'] LOOP
      PERFORM pg_temp.s112_als((v_p ->> v_pers)::uuid);
      v_erg := v_erg || pg_temp.s112_erwarte(format('upd_%s_%s_umbenennen_eigen', v_k, v_pers),
        pg_temp.t19_upd(v_bucket, v_obj_b, pg_temp.t19_pfad(v_b, 'umbenannt-' || v_k || '.dat')), pg_temp.t19_soll('upd', v_k, v_pers));
      v_erg := v_erg || pg_temp.s112_erwarte(format('upd_%s_%s_verschieben_nach_m', v_k, v_pers),
        pg_temp.t19_upd(v_bucket, v_obj_b, pg_temp.t19_pfad(v_m, 'verschoben-' || v_k || '.dat')), pg_temp.t19_soll('upd', v_k, v_pers));
      IF v_pers <> 'pa' THEN
        v_erg := v_erg || pg_temp.s112_erwarte(format('upd_%s_%s_fremd_nach_b', v_k, v_pers),
          pg_temp.t19_upd(v_bucket, v_obj_m, pg_temp.t19_pfad(v_b, 'geholt-' || v_k || '.dat')), 'k0');
      END IF;
    END LOOP;
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;
  -- Bucket wechseln (UPDATE bucket_id) im eigenen Ordner: kein Bucket außer mandant-logos hat eine UPDATE-Policy
  PERFORM pg_temp.s112_als((v_p ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('upd_ea_b_ta_bucket_wechsel', pg_temp.s112_versuch(format(
    'UPDATE storage.objects SET bucket_id = %L WHERE bucket_id = %L AND name = %L', 'dokumente', 'ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat'))), 'k0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 5. Löschen (mit Schalter storage.allow_delete_query) ────────────────────────────────────────────
  FOREACH v_bucket IN ARRAY c_buckets LOOP
    v_k := pg_temp.t19_kurz(v_bucket);
    v_obj_b := pg_temp.t19_pfad(v_b, v_k || '-b.dat');
    v_obj_m := pg_temp.t19_pfad(v_m, v_k || '-m.dat');
    FOREACH v_pers IN ARRAY c_schreiber LOOP
      PERFORM pg_temp.s112_als((v_p ->> v_pers)::uuid);
      PERFORM set_config('storage.allow_delete_query', 'true', true);   -- NACH s112_als (das setzt ihn zurück)
      v_erg := v_erg || pg_temp.s112_erwarte(format('del_%s_%s_eigen', v_k, v_pers),
        pg_temp.t19_del(v_bucket, v_obj_b), pg_temp.t19_soll('del', v_k, v_pers));
      IF v_pers IN ('b_ta', 'b_w', 'b_l') THEN
        v_erg := v_erg || pg_temp.s112_erwarte(format('del_%s_%s_fremd', v_k, v_pers), pg_temp.t19_del(v_bucket, v_obj_m), 'k0');
      END IF;
    END LOOP;
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;
  -- Sanity: ohne Schalter lehnt storage.protect_delete (Statement-Trigger, 42501) ab – auch bei erlaubtem Objekt
  PERFORM pg_temp.s112_als((v_p ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('del_ohne_schalter_protect_delete',
    pg_temp.t19_del('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('del_ohne_schalter_meldung',
    pg_temp.s112_fehlertext(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L',
      'ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat'))) LIKE '42501: Direct deletion from storage tables is not allowed%', true);
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'ea-belege' AND name = pg_temp.t19_pfad(v_b, 'ea-b.dat');
  v_erg := v_erg || pg_temp.s112_erwarte('del_versuche_zurueckgerollt', v_n, 1);

  -- ── 6. Querschnitt (Stichproben; Details in 13–15) ──────────────────────────────────────────────────
  -- Abo-Schreibsperre: B 'canceled' → Hochladen R, Lesen weiter 1, Löschen 0; PA ausgenommen
  UPDATE public.tenants SET stripe_status = 'canceled' WHERE id = v_b::uuid;
  PERFORM pg_temp.s112_als((v_p ->> 'b_w')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('abo_ins_ea_b_w', pg_temp.t19_ins('ea-belege', pg_temp.t19_pfad(v_b, 'abo.dat')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('abo_ins_dok_b_w', pg_temp.t19_ins('dokumente', pg_temp.t19_pfad(v_b, 'abo.dat')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('abo_sel_ea_b_w', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), '1');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('abo_del_ea_b_w', pg_temp.t19_del('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), 'k0');
  PERFORM pg_temp.s112_als((v_p ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('abo_ins_eti_b_ta', pg_temp.t19_ins('etiketten', pg_temp.t19_pfad(v_b, 'abo.dat')), 'R');
  PERFORM pg_temp.s112_als((v_p ->> 'pa')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('abo_ins_ea_pa_ausgenommen', pg_temp.t19_ins('ea-belege', pg_temp.t19_pfad(v_b, 'abo.dat')), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenants SET stripe_status = NULL WHERE id = v_b::uuid;

  -- Inaktive Mitgliedschaft: m_inak (winzer M, inaktiv) sieht nichts; mix (aktiv B, inaktiv M) nur B
  PERFORM pg_temp.s112_als((v_p ->> 'm_inak')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('inaktiv_sel_ea_m', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_m, 'ea-m.dat')), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('inaktiv_sel_dok_m', pg_temp.t19_zahl('dokumente', pg_temp.t19_pfad(v_m, 'dok-m.dat')), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('inaktiv_ins_dok_m', pg_temp.t19_ins('dokumente', pg_temp.t19_pfad(v_m, 'inaktiv.dat')), 'R');
  PERFORM pg_temp.s112_als((v_p ->> 'mix')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('mix_sel_ea_b', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('mix_sel_ea_m', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_m, 'ea-m.dat')), '0');
  PERFORM pg_temp.s112_als_postgres();

  -- Zwei-Faktor: bestätigter Faktor + aal1 → nichts sichtbar (auch das öffentliche Logo nicht als authenticated)
  PERFORM pg_temp.s112_faktor((v_p ->> 'b_w')::uuid);
  PERFORM pg_temp.s112_als((v_p ->> 'b_w')::uuid, 'authenticated', 'aal1');
  v_erg := v_erg || pg_temp.s112_erwarte('aal1_sel_ea_b_w', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('aal1_sel_logo_b_w', pg_temp.t19_zahl('mandant-logos', pg_temp.t19_pfad(v_b, 'logo-b.dat')), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('aal1_ins_dok_b_w', pg_temp.t19_ins('dokumente', pg_temp.t19_pfad(v_b, 'aal.dat')), 'R');
  PERFORM pg_temp.s112_als((v_p ->> 'b_w')::uuid, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('aal2_sel_ea_b_w', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('aal2_ins_dok_b_w', pg_temp.t19_ins('dokumente', pg_temp.t19_pfad(v_b, 'aal.dat')), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 7. Pfad-Randfälle (ea-belege) ───────────────────────────────────────────────────────────────────
  -- '<B>/../<M>/…': foldername nimmt das erste Segment wörtlich → Ordner B; kein Zugriff auf M-Objekte.
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_punktpunkt_ordner_ist_b', (storage.foldername(v_pfad_pp))[1], v_b);
  -- b_ta (nicht b_w: der hat seit Abschnitt 6 einen bestätigten Faktor und sähe mit aal1 nichts)
  PERFORM pg_temp.s112_als((v_p ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_kontrolle_eigenes_objekt_sichtbar', pg_temp.t19_zahl('ea-belege', pg_temp.t19_pfad(v_b, 'ea-b.dat')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_punktpunkt_sichtbar_fuer_b', pg_temp.t19_zahl('ea-belege', v_pfad_pp), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_punktpunkt_kein_m_objekt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND (storage.foldername(name))[1] = %L', 'ea-belege', v_m)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_punktpunkt_ins_b_gilt_als_b',
    pg_temp.t19_ins('ea-belege', v_b || '/../' || v_m || '/s112test/neu-pp.dat'), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_punktpunkt_ins_m_zuerst_R',
    pg_temp.t19_ins('ea-belege', v_m || '/../' || v_b || '/s112test/neu-pp.dat'), 'R');
  -- UUID in Großbuchstaben: kein eigener Ordner (Vergleich mit tenant_id::text in Kleinbuchstaben)
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_gross_sichtbar_0', pg_temp.t19_zahl('ea-belege', v_pfad_gr), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_gross_ins_R', pg_temp.t19_ins('ea-belege', pg_temp.t19_pfad(upper(v_b), 'neu-gross.dat')), 'R');
  PERFORM pg_temp.s112_als((v_p ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_punktpunkt_unsichtbar_fuer_m', pg_temp.t19_zahl('ea-belege', v_pfad_pp), '0');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('pfad_gross_unterscheidet_sich', upper(v_b) <> v_b, true);

  -- ── storage.buckets: keine Policies, Benutzer ändern keine Buckets ──────────────────────────────────
  -- Eine Policy TO authenticated auf storage.buckets (z. B. FOR UPDATE USING (true)) fiele sonst keiner Prüfung
  -- auf (policy_rolle in 01 meldet nur fremde Rollen). Soll: gar keine Policy – Buckets pflegt nur die Service-Role.
  PERFORM pg_temp.s112_als_postgres();
  SELECT coalesce(string_agg(p.policyname || '(' || p.cmd || ' ' || array_to_string(p.roles, ',') || ')', ', ' ORDER BY p.policyname), '')
    INTO v_eigen FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'buckets';
  v_erg := v_erg || pg_temp.s112_erwarte('buckets_keine_policies', v_eigen, '');
  SELECT count(*) INTO v_n FROM pg_class c WHERE c.oid = 'storage.buckets'::regclass AND c.relrowsecurity;
  v_erg := v_erg || pg_temp.s112_erwarte('buckets_rls_aktiv', v_n, 1);
  SELECT count(*) INTO v_n FROM storage.buckets WHERE id = 'ea-belege' AND NOT public;
  v_erg := v_erg || pg_temp.s112_erwarte('buckets_ea_belege_privat_vorhanden', v_n, 1);
  FOREACH v_pers IN ARRAY ARRAY['b_ta', 'pa'] LOOP
    PERFORM pg_temp.s112_als((v_p ->> v_pers)::uuid);
    v_eigen := pg_temp.s112_versuch($s$UPDATE storage.buckets SET public = true WHERE id = 'ea-belege'$s$);
    v_erg := v_erg || pg_temp.s112_erwarte('buckets_update_' || v_pers, CASE WHEN v_eigen IN ('k0', 'R', 'G', 'T') THEN 'verweigert' ELSE v_eigen END, 'verweigert');
    v_eigen := pg_temp.s112_versuch($s$UPDATE storage.buckets SET file_size_limit = 1, allowed_mime_types = ARRAY['text/html'] WHERE id = 'dokumente'$s$);
    v_erg := v_erg || pg_temp.s112_erwarte('buckets_update_grenzen_' || v_pers, CASE WHEN v_eigen IN ('k0', 'R', 'G', 'T') THEN 'verweigert' ELSE v_eigen END, 'verweigert');
    v_eigen := pg_temp.s112_versuch($s$INSERT INTO storage.buckets (id, name, public) VALUES ('s112test-bucket', 's112test-bucket', true)$s$);
    v_erg := v_erg || pg_temp.s112_erwarte('buckets_insert_' || v_pers, CASE WHEN v_eigen IN ('R', 'G', 'T') THEN 'verweigert' ELSE v_eigen END, 'verweigert');
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    v_eigen := pg_temp.s112_versuch($s$DELETE FROM storage.buckets WHERE id = 'etiketten'$s$);
    v_erg := v_erg || pg_temp.s112_erwarte('buckets_delete_' || v_pers, CASE WHEN v_eigen IN ('k0', 'R', 'G', 'T') THEN 'verweigert' ELSE v_eigen END, 'verweigert');
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 300);
END
$test$;
