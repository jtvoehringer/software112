-- KAN-37 Etappe B (02.10.2026): Zeilen-Snapshot der abgegebenen Meldung – die eingereichte CSV bleibt byte-gleich erhalten
-- Ergänzung aus Epic KAN-55 (24.09.2026): „Beim Einreichen/Einfrieren einer Meldung den Zeilen-Snapshot speichern, nicht nur
-- Kopfdaten: Register-id, Parameter (jsonb), die von laden() gelieferten Zeilen (jsonb), Spalten-Version und SHA-256 der
-- erzeugten CSV, erstellt_von, eingereicht_am. So lässt sich die abgegebene CSV jederzeit byte-gleich wiederherstellen.“
--
--  1. Tabelle meldung_abgaben (allgemein für alle Behördenmeldungen; derzeit schreibt nur die AMA-Erntemeldung):
--     Register-id, Parameter, Zeilen, Warnungen, Spalten (Kopf, Typ, Stellen) samt SHA-256 als Spalten-Version, Profil,
--     Dateiname, die CSV selbst (UTF-8 mit BOM, wie ausgeliefert) und ihr SHA-256. Beide Prüfsummen rechnet die Datenbank
--     beim Anlegen selbst (Trigger) – ein mitgeschickter Wert zählt nicht.
--  2. Unveränderlich für JEDE Rolle (auch Service-Role, SQL-Editor, Wartung): kein UPDATE, kein TRUNCATE; DELETE nur als
--     Wartung im Demo-Betrieb Musterhof (wie KAN-37 Etappe A – der nächtliche Reset löscht dessen Meldungen samt Abgaben).
--     Benutzer lesen die Abgaben ihres Betriebs; Schreiben nur über die RPC.
--  3. s112_ama_einreichen: setzt die Meldung auf „eingereicht“ (über s112_ama_status_setzen) und speichert die Abgabe in
--     EINER Transaktion. Der Jahrgang in den Parametern muss der der Meldung sein.
--  4. s112_ama_status_setzen: „eingereicht“ nur noch über s112_ama_einreichen (jede Abgabe hat ihren Snapshot);
--     bestätigt/abgelehnt unverändert.
--  5. s112_mandant_loeschen: bricht auch bei gespeicherten Abgaben ab (sonst endete die Kaskade am Trigger).

-- 1. Tabelle ───────────────────────────────────────────────────────────────────────────────────────────────
-- Verbund-FK (tenant_id, ama_meldung_id): die Abgabe gehört sicher zur Meldung desselben Betriebs
ALTER TABLE public.ama_erntemeldungen ADD CONSTRAINT ama_erntemeldungen_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.meldung_abgaben (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  meldung         text NOT NULL CHECK (meldung ~ '^[a-z0-9-]{2,60}$'),
  ama_meldung_id  uuid,
  meldungs_version integer CHECK (meldungs_version IS NULL OR meldungs_version >= 1),
  eingereicht_am  date NOT NULL,
  parameter       jsonb NOT NULL CHECK (jsonb_typeof(parameter) = 'object'),
  zeilen          jsonb NOT NULL CHECK (jsonb_typeof(zeilen) = 'array'),
  zeilen_anzahl   integer NOT NULL,
  warnungen       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnungen) = 'array'),
  spalten         jsonb NOT NULL CHECK (jsonb_typeof(spalten) = 'array' AND jsonb_array_length(spalten) > 0),
  spalten_sha256  text NOT NULL,
  profil          text NOT NULL,
  dateiname       text NOT NULL CHECK (length(btrim(dateiname)) BETWEEN 1 AND 200),
  csv_text        text NOT NULL CHECK (length(csv_text) BETWEEN 1 AND 5000000),
  csv_sha256      text NOT NULL,
  csv_bytes       integer NOT NULL,
  erstellt_von    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meldung_abgaben_ama_fk FOREIGN KEY (tenant_id, ama_meldung_id)
    REFERENCES public.ama_erntemeldungen (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT meldung_abgaben_ama_chk CHECK ((meldung = 'erntemeldung') = (ama_meldung_id IS NOT NULL)),
  CONSTRAINT meldung_abgaben_ama_eindeutig UNIQUE (ama_meldung_id)
);
CREATE INDEX meldung_abgaben_tenant_idx ON public.meldung_abgaben (tenant_id, meldung, eingereicht_am DESC);
COMMENT ON TABLE public.meldung_abgaben IS
  'KAN-37 B: Snapshot je abgegebener Behördenmeldung (Zeilen, Parameter, Spalten, CSV mit SHA-256) – unveränderlich, nur per RPC';

-- 2. Unveränderlichkeit ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_meldung_abgabe_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Abgegebene Meldungen werden nie gelöscht (KAN-37).' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Prüfsummen rechnet die Datenbank selbst; API-Rollen legen nur über die RPC an
    IF v_rolle IN ('authenticated', 'anon') AND coalesce(current_setting('s112.abgabe_rpc', true), '') <> 'an' THEN
      RAISE EXCEPTION 'Abgaben entstehen nur beim Einreichen der Meldung (KAN-37).' USING ERRCODE = '42501';
    END IF;
    NEW.csv_sha256     := encode(sha256(convert_to(NEW.csv_text, 'UTF8')), 'hex');
    NEW.csv_bytes      := octet_length(convert_to(NEW.csv_text, 'UTF8'));
    NEW.spalten_sha256 := encode(sha256(convert_to(NEW.spalten::text, 'UTF8')), 'hex');
    NEW.zeilen_anzahl  := jsonb_array_length(NEW.zeilen);
    NEW.erstellt_am    := now();
    RETURN NEW;
  END IF;
  -- Einzige Ausnahme (wie KAN-37 Etappe A): Wartung im Demo-Betrieb Musterhof darf löschen (Reset)
  IF TG_OP = 'DELETE' AND OLD.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid AND v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Eine abgegebene Meldung bleibt unverändert und wird nie gelöscht (KAN-37); Korrekturen bitte als Korrekturmeldung (neue Version).'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_meldung_abgabe_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_abgabe_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.meldung_abgaben
  FOR EACH ROW EXECUTE FUNCTION public.s112_meldung_abgabe_schutz();
CREATE TRIGGER a_abgabe_schutz_truncate BEFORE TRUNCATE ON public.meldung_abgaben
  FOR EACH STATEMENT EXECUTE FUNCTION public.s112_meldung_abgabe_schutz();

ALTER TABLE public.meldung_abgaben ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.meldung_abgaben FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.meldung_abgaben FROM anon;
-- Schreiben: keine Policy für INSERT/UPDATE/DELETE – nur die RPC (SECURITY DEFINER); der Trigger sperrt zusätzlich jede Rolle

CREATE POLICY abgaben_select ON public.meldung_abgaben FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.meldung_abgaben AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.meldung_abgaben AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.meldung_abgaben AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.meldung_abgaben AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.meldung_abgaben AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY ki_aktiver_betrieb ON public.meldung_abgaben AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((SELECT NULLIF(current_setting('app.active_tenant_id', true), '')) IS NULL) OR (tenant_id IS NULL)
         OR (tenant_id = (SELECT NULLIF(current_setting('app.active_tenant_id', true), '')::uuid)));

-- 3. Einreichen mit Snapshot ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_einreichen(p_tenant_id uuid, p_meldung_id uuid, p_datum date, p_referenznr text, p_abgabe jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m  record;
  v_jg integer;
  v_id uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  IF p_abgabe IS NULL OR jsonb_typeof(p_abgabe) <> 'object' OR p_abgabe ->> 'meldung' IS DISTINCT FROM 'erntemeldung'
     OR jsonb_typeof(p_abgabe -> 'parameter') IS DISTINCT FROM 'object' OR jsonb_typeof(p_abgabe -> 'zeilen') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_abgabe -> 'spalten') IS DISTINCT FROM 'array' OR coalesce(p_abgabe ->> 'csv', '') = ''
     OR coalesce(btrim(p_abgabe ->> 'dateiname'), '') = '' OR coalesce(p_abgabe ->> 'profil', '') = '' THEN
    RAISE EXCEPTION 'Die Abgabe ist unvollständig (Meldung, Parameter, Zeilen, Spalten, Profil, Dateiname und CSV sind Pflicht).' USING ERRCODE = '22023';
  END IF;
  SELECT m.id, m.jahrgang_id, m.version INTO v_m FROM public.ama_erntemeldungen m WHERE m.id = p_meldung_id AND m.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMA-Erntemeldung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT j.jahrgang INTO v_jg FROM public.weinjahrgaenge j WHERE j.id = v_m.jahrgang_id AND j.tenant_id = p_tenant_id;
  IF (p_abgabe -> 'parameter' ->> 'jahrgang') IS DISTINCT FROM v_jg::text THEN
    RAISE EXCEPTION 'Die Abgabe gehört nicht zu dieser Meldung (Jahrgang %).', v_jg USING ERRCODE = '22023';
  END IF;

  -- Status (Zugriff, Abo-Sperre, Schreibmodul, neueste Version, nur vorwärts prüft s112_ama_status_setzen)
  PERFORM set_config('s112.ama_einreichen', 'an', true);
  PERFORM public.s112_ama_status_setzen(p_tenant_id, p_meldung_id, 'eingereicht', p_datum, p_referenznr);
  PERFORM set_config('s112.ama_einreichen', '', true);

  PERFORM set_config('s112.abgabe_rpc', 'an', true);
  INSERT INTO public.meldung_abgaben (tenant_id, meldung, ama_meldung_id, meldungs_version, eingereicht_am, parameter, zeilen,
                                      warnungen, spalten, spalten_sha256, profil, dateiname, csv_text, csv_sha256, csv_bytes,
                                      zeilen_anzahl, erstellt_von)
  VALUES (p_tenant_id, 'erntemeldung', p_meldung_id, v_m.version, p_datum, p_abgabe -> 'parameter', p_abgabe -> 'zeilen',
          CASE WHEN jsonb_typeof(p_abgabe -> 'warnungen') = 'array' THEN p_abgabe -> 'warnungen' ELSE '[]'::jsonb END,
          p_abgabe -> 'spalten', '', p_abgabe ->> 'profil', btrim(p_abgabe ->> 'dateiname'), p_abgabe ->> 'csv', '', 0, 0, auth.uid())
  RETURNING id INTO v_id;
  PERFORM set_config('s112.abgabe_rpc', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_einreichen(uuid, uuid, date, text, jsonb) FROM PUBLIC, anon;

-- 4. Status setzen: „eingereicht“ nur noch mit Snapshot ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_status_setzen(p_tenant_id uuid, p_meldung_id uuid, p_status text, p_datum date, p_referenznr text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('eingereicht', 'bestaetigt', 'abgelehnt') THEN
    RAISE EXCEPTION 'Unbekannter Status „%“.', coalesce(p_status, '–') USING ERRCODE = '22023';
  END IF;
  -- KAN-37 B: jede Abgabe hat ihren Snapshot – „eingereicht“ nur über s112_ama_einreichen
  IF p_status = 'eingereicht' AND coalesce(current_setting('s112.ama_einreichen', true), '') <> 'an' THEN
    RAISE EXCEPTION 'Eingereicht wird über „Einreichen“ (s112_ama_einreichen) – dabei wird die abgegebene CSV gespeichert (KAN-37).' USING ERRCODE = '42501';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte das Datum angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_datum > current_date THEN
    RAISE EXCEPTION 'Das Datum liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  SELECT m.* INTO v_m FROM public.ama_erntemeldungen m WHERE m.id = p_meldung_id AND m.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMA-Erntemeldung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ama_erntemeldungen x WHERE x.tenant_id = p_tenant_id AND x.jahrgang_id = v_m.jahrgang_id AND x.version > v_m.version) THEN
    RAISE EXCEPTION 'Das ist nicht die neueste Version der Meldung – bitte die Seite neu laden.' USING ERRCODE = '42501';
  END IF;
  IF NOT ((v_m.status = 'bereit' AND p_status = 'eingereicht')
          OR (v_m.status = 'eingereicht' AND p_status IN ('bestaetigt', 'abgelehnt'))) THEN
    RAISE EXCEPTION 'Der Status kann nur vorwärts gesetzt werden (bereit → eingereicht → bestätigt/abgelehnt), nicht von „%“ auf „%“.', v_m.status, p_status
      USING ERRCODE = '42501';
  END IF;
  IF p_status <> 'eingereicht' AND p_datum < v_m.eingereicht_am::date THEN
    RAISE EXCEPTION 'Die Rückmeldung kann nicht vor dem Einreichen (%) liegen.', to_char(v_m.eingereicht_am, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('s112.ama_rpc', 'an', true);
  IF p_status = 'eingereicht' THEN
    UPDATE public.ama_erntemeldungen SET status = 'eingereicht', eingereicht_am = p_datum,
           ama_referenznr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_referenznr)
     WHERE id = p_meldung_id;
    UPDATE public.weinjahrgaenge SET ama_gemeldet = true, ama_meldedatum = p_datum,
           ama_meldungsnr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_meldungsnr)
     WHERE id = v_m.jahrgang_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.ama_erntemeldungen SET status = p_status, bestaetigt_am = p_datum,
           ama_referenznr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_referenznr)
     WHERE id = p_meldung_id;
  END IF;
  PERFORM set_config('s112.ama_rpc', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_status_setzen(uuid, uuid, text, date, text) FROM PUBLIC, anon;

-- 5. Mandanten-Löschung ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_mandant_loeschen(p_tenant_id uuid, p_bestaetigung text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit tenant_id ohne FK auf tenants, in Löschreihenfolge (zukauf_posten nach der Kaskade, die Pressungen
  -- und Traubenverkäufe schon entfernt hat – sonst bricht chk_pressung_wg_quelle bzw. chk_traubenverkauf_quelle)
  c_ohne_fk constant text[] := ARRAY['exportauftraege', 'pruefnummernantraege', 'transportbescheinigungen', 'sonstige_artikel',
                                     'weinbaugebiete_custom', 'zukauf_posten', 'system_ereignisse', 'aktivitaet_dokumente'];
  v_name    text;
  v_fremd   bigint;
  v_tab     text;
  v_n       bigint;
  v_zeilen  jsonb := '{}';
  v_rest    jsonb := '{}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin']);
  -- bewusst ohne s112_pruefe_abo_schreibsperre: gekündigte Betriebe (Nur-Lesen-Modus) müssen löschbar sein

  SELECT t.name INTO v_name FROM public.tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betrieb % nicht gefunden.', p_tenant_id USING ERRCODE = 'P0002';
  END IF;
  IF p_bestaetigung IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'Bestätigung stimmt nicht: bitte den Namen des Betriebs exakt angeben („%“).', v_name USING ERRCODE = '22023';
  END IF;

  -- Kellergemeinschaft: Buchungen anderer Betriebe in eigenen Gebinden blockieren das Löschen
  SELECT (SELECT count(*) FROM public.weinausbau w JOIN public.behaelter b ON b.id = w.behaelter_id
           WHERE b.tenant_id = p_tenant_id AND w.tenant_id <> p_tenant_id)
       + (SELECT count(*) FROM public.keller_umzuege u JOIN public.behaelter b ON b.id IN (u.von_behaelter_id, u.nach_behaelter_id)
           WHERE b.tenant_id = p_tenant_id AND u.tenant_id <> p_tenant_id)
       + (SELECT count(*) FROM public.keller_behandlungen k JOIN public.behaelter b ON b.id = k.behaelter_id
           WHERE b.tenant_id = p_tenant_id AND k.tenant_id <> p_tenant_id)
       + (SELECT count(*) FROM public.pressung_behaelter pb JOIN public.behaelter b ON b.id = pb.behaelter_id
           JOIN public.pressungen p ON p.id = pb.pressung_id
           WHERE b.tenant_id = p_tenant_id AND p.tenant_id <> p_tenant_id)
    INTO v_fremd;
  IF v_fremd > 0 THEN
    RAISE EXCEPTION 'In Gebinden des Betriebs liegen % Buchungen anderer Betriebe (Kellergemeinschaft) – bitte zuerst dort umziehen bzw. bereinigen. Nichts geändert.', v_fremd
      USING ERRCODE = '55000';
  END IF;

  -- KAN-37 (02.10.2026): abgegebene AMA-Erntemeldungen werden nie gelöscht (Aufbewahrung, Sperre auch für die
  -- Service-Role) – Betrieb mit abgegebenen Meldungen ist nicht löschbar; Demo-Betrieb Musterhof ausgenommen
  IF p_tenant_id <> '33333333-3333-4333-8333-333333333333'::uuid AND (EXISTS (
       SELECT 1 FROM public.ama_erntemeldungen m WHERE m.tenant_id = p_tenant_id AND m.status NOT IN ('entwurf', 'bereit'))
     OR EXISTS (SELECT 1 FROM public.meldung_abgaben a WHERE a.tenant_id = p_tenant_id)) THEN   -- KAN-37 B: gespeicherte Abgaben
    RAISE EXCEPTION 'Der Betrieb hat abgegebene Meldungen (AMA-Erntemeldung bzw. gespeicherte Abgaben) – sie werden aufbewahrt und nie gelöscht (KAN-37). Der Betrieb kann deshalb nicht gelöscht werden; bitte stattdessen deaktivieren. Nichts geändert.'
      USING ERRCODE = '55000';
  END IF;

  -- Zählung vorab (alle Tabellen mit tenant_id außer bestandsprotokoll)
  FOR v_tab IN
    SELECT c.relname::text FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname NOT IN ('bestandsprotokoll', 'tenants')
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', v_tab) INTO v_n USING p_tenant_id;
    IF v_n > 0 THEN v_zeilen := v_zeilen || jsonb_build_object(v_tab, v_n); END IF;
  END LOOP;

  -- Wartungs-Kennzeichen nur für diesen Betrieb (transaktionslokal)
  PERFORM set_config('s112.loeschen_erlaubt', p_tenant_id::text, true);

  -- RESTRICT-Bezüge vorab (werden nicht am Ende der Anweisung geprüft)
  DELETE FROM public.ea_transaktionen WHERE tenant_id = p_tenant_id AND storno_von_id IS NOT NULL;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Gegenbuchungen vor den Originalen
  DELETE FROM public.ea_transaktionen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), vor ea_anlagen (RESTRICT)
  DELETE FROM public.konto_umbuchungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt

  -- Bewegungen in NO-ACTION-Reihenfolge (Kaskaden prüfen NO ACTION je Ebene, nicht erst am Ende): Verschnitt samt
  -- Quellen, Kellerbehandlungen, Umzüge, Füllungs-Chargen, Pressungen samt Kindern, Traubenverkäufe, Lesedaten,
  -- Maßnahmen – vor Chargen, Gebinden, Rieden, Lesen, Jahrgängen und Mitteln; Kinder ohne tenant_id ausdrücklich (KAN-124)
  DELETE FROM public.verschneidung_quellen WHERE verschneidung_id IN (SELECT id FROM public.verschneidungen WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.verschneidungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.keller_behandlungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.keller_umzuege WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.fuellung_chargen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.pressung_behaelter WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.pressung_weingaerten WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.pressungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.traubenverkauf WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.ernte_parzellen WHERE jahrgang_id IN (SELECT id FROM public.weinjahrgaenge WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.behandlungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.weinausbau WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  UPDATE public.kontakte SET rabattgruppe_id = NULL WHERE tenant_id = p_tenant_id AND rabattgruppe_id IS NOT NULL;
  UPDATE public.firmen SET rabattgruppe_id = NULL WHERE tenant_id = p_tenant_id AND rabattgruppe_id IS NOT NULL;

  DELETE FROM public.tenants WHERE id = p_tenant_id;

  FOREACH v_tab IN ARRAY c_ohne_fk LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_tab) USING p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  END LOOP;

  -- Restprüfung
  FOR v_tab IN
    SELECT c.relname::text FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname NOT IN ('bestandsprotokoll', 'tenants')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', v_tab) INTO v_n USING p_tenant_id;
    IF v_n > 0 THEN v_rest := v_rest || jsonb_build_object(v_tab, v_n); END IF;
  END LOOP;
  IF v_rest <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Mandanten-Löschung unvollständig, zurückgerollt: %', v_rest USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  INSERT INTO public.system_ereignisse (art, quelle, meldung, tenant_id, user_id, details)
  VALUES ('db', 's112_mandant_loeschen', 'Betrieb gelöscht (KAN-151)', NULL, NULL,
          jsonb_build_object('tenant_id', p_tenant_id, 'zeilen', v_zeilen));

  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'zeilen', v_zeilen,
                            'gesamt', (SELECT coalesce(sum(value::bigint), 0) FROM jsonb_each_text(v_zeilen)));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_mandant_loeschen(uuid, text) FROM PUBLIC, anon;