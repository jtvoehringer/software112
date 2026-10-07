-- KAN-219 (07.10.2026): E-Label D – Umleitung eines gedruckten QR-Codes (z. B. auf die Nachfolgefüllung), mit Protokoll.
--  1. elabels += umleitung_auf (anderes E-Label desselben Betriebs, SET NULL); die öffentliche Seite zeigt dann das Ziel
--     (sofern freigegeben; Kette höchstens 5 Schritte, keine Schleifen).
--  2. Ändern nur über die RPC s112_elabel_umleiten(tenant, elabel, ziel, grund) – Grund ≥ 10 Zeichen, nur freigegebene
--     E-Labels (gedruckt), Ziel freigegeben und im eigenen Betrieb, keine Schleife. Direktes Setzen sperrt der Trigger
--     b_elabel_umleitung (auch im Entwurf); die Freeze-Sperre hebt die RPC mit s112.freeze_frei auf.
--  3. elabel_umleitungen: Protokoll (wer, wann, von, nach, Grund) – nur lesbar, geschrieben nur von der RPC.
--  4. elabel_archiv: beim Löschen eines Betriebs (s112_mandant_loeschen) bleiben freigegebene E-Labels 5 Jahre als
--     schreibgeschützte Kopie öffentlich erreichbar (Entscheidung Jörgen 07.10.2026, Regel für die AGB).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 65, dann Produktion.

-- 1. Spalte ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.elabels
  ADD COLUMN umleitung_auf uuid REFERENCES public.elabels(id) ON DELETE SET NULL,
  ADD CONSTRAINT elabels_umleitung_nicht_selbst CHECK (umleitung_auf IS DISTINCT FROM id);
COMMENT ON COLUMN public.elabels.umleitung_auf IS
  'KAN-219: der QR-Code dieses E-Labels zeigt auf ein anderes (freigegebenes) E-Label desselben Betriebs – nur über s112_elabel_umleiten';
CREATE INDEX elabels_umleitung_idx ON public.elabels (umleitung_auf) WHERE umleitung_auf IS NOT NULL;
CREATE TRIGGER z_fremdverweis_umleitung_auf BEFORE INSERT OR UPDATE OF umleitung_auf, tenant_id ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('umleitung_auf', 'elabels', '', '', '');

CREATE FUNCTION public.s112_elabel_umleitung_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.umleitung_auf IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.umleitung_auf IS DISTINCT FROM OLD.umleitung_auf) THEN
    IF coalesce(current_setting('s112.elabel_umleitung', true), '') <> 'an' AND NOT public.ist_service_kontext() THEN
      RAISE EXCEPTION 'Die Umleitung eines E-Labels ändert nur „Umleiten“ (mit Grund, protokolliert).' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_umleitung_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_elabel_umleitung BEFORE INSERT OR UPDATE ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_elabel_umleitung_schutz();

-- 2. Protokoll ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.elabel_umleitungen (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  elabel_id        uuid NOT NULL REFERENCES public.elabels(id) ON DELETE CASCADE,
  von_elabel_id    uuid REFERENCES public.elabels(id) ON DELETE SET NULL,
  nach_elabel_id   uuid REFERENCES public.elabels(id) ON DELETE SET NULL,
  grund            text NOT NULL CHECK (length(btrim(grund)) >= 10),
  geaendert_am     timestamptz NOT NULL DEFAULT now(),
  geaendert_von    uuid,
  geaendert_von_name text
);
CREATE INDEX elabel_umleitungen_elabel_idx ON public.elabel_umleitungen (elabel_id, geaendert_am DESC);
CREATE INDEX elabel_umleitungen_tenant_idx ON public.elabel_umleitungen (tenant_id);
COMMENT ON TABLE public.elabel_umleitungen IS 'KAN-219: Protokoll der Umleitungen gedruckter E-Label-QR-Codes – nur lesbar, geschrieben von s112_elabel_umleiten';

ALTER TABLE public.elabel_umleitungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.elabel_umleitungen FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.elabel_umleitungen FROM PUBLIC, authenticated;
CREATE POLICY elabel_umleitungen_select ON public.elabel_umleitungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.elabel_umleitungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.elabel_umleitungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.elabel_umleitungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.elabel_umleitungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.elabel_umleitungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- 3. RPC ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_elabel_umleiten(p_tenant_id uuid, p_elabel_id uuid, p_ziel_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_e      public.elabels%ROWTYPE;
  v_z      public.elabels%ROWTYPE;
  v_schritt uuid;
  v_n      integer := 0;
  v_uid    uuid := auth.uid();
  v_name   text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Kellerbuch bzw. Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Umleitung angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_e FROM public.elabels e WHERE e.id = p_elabel_id AND e.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E-Label nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_e.status <> 'freigegeben' THEN
    RAISE EXCEPTION 'Umleiten lassen sich nur freigegebene E-Labels (der QR-Code ist gedruckt).' USING ERRCODE = '22023';
  END IF;
  IF p_ziel_id IS NOT DISTINCT FROM v_e.umleitung_auf THEN
    RAISE EXCEPTION 'Die Umleitung ist bereits so eingestellt.' USING ERRCODE = '22023';
  END IF;
  IF p_ziel_id IS NOT NULL THEN
    IF p_ziel_id = p_elabel_id THEN
      RAISE EXCEPTION 'Ein E-Label kann nicht auf sich selbst umgeleitet werden.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_z FROM public.elabels e WHERE e.id = p_ziel_id AND e.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ziel-E-Label nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    IF v_z.status <> 'freigegeben' THEN
      RAISE EXCEPTION 'Das Ziel muss ein freigegebenes E-Label sein.' USING ERRCODE = '22023';
    END IF;
    -- keine Schleife: der Weg ab dem Ziel darf nicht zurück zu diesem E-Label führen
    v_schritt := v_z.umleitung_auf;
    WHILE v_schritt IS NOT NULL LOOP
      v_n := v_n + 1;
      IF v_schritt = p_elabel_id OR v_n > 5 THEN
        RAISE EXCEPTION 'Diese Umleitung ergäbe eine Schleife bzw. eine zu lange Kette (höchstens 5 Schritte).' USING ERRCODE = '22023';
      END IF;
      SELECT e.umleitung_auf INTO v_schritt FROM public.elabels e WHERE e.id = v_schritt;
    END LOOP;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
    INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
  IF v_name IS NULL AND v_uid IS NOT NULL THEN
    SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
  END IF;

  PERFORM set_config('s112.freeze_frei', 'elabels', true);
  PERFORM set_config('s112.elabel_umleitung', 'an', true);
  UPDATE public.elabels SET umleitung_auf = p_ziel_id WHERE id = p_elabel_id;
  PERFORM set_config('s112.elabel_umleitung', '', true);
  PERFORM set_config('s112.freeze_frei', '', true);

  INSERT INTO public.elabel_umleitungen (tenant_id, elabel_id, von_elabel_id, nach_elabel_id, grund, geaendert_von, geaendert_von_name)
  VALUES (p_tenant_id, p_elabel_id, v_e.umleitung_auf, p_ziel_id, btrim(p_grund), v_uid, v_name);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_umleiten(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_elabel_umleiten(uuid, uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_elabel_umleiten(uuid, uuid, uuid, text) IS
  'KAN-219: QR-Code eines freigegebenen E-Labels auf ein anderes freigegebenes E-Label desselben Betriebs umleiten (NULL = aufheben), Grund ≥ 10 Zeichen, protokolliert';


-- 4. Archiv nach der Löschung eines Betriebs (Entscheidung Jörgen 07.10.2026: 5 Jahre, Regel in den AGB) ───────────
-- Eigenes, nicht über die Data-API veröffentlichtes Schema: kein Mandanten-, Rollen- oder anon-Zugriff; lesen nur über
-- s112_elabel_archiv_lesen (Service-Role, öffentliche E-Label-Seite)
CREATE SCHEMA s112_archiv;
REVOKE ALL ON SCHEMA s112_archiv FROM PUBLIC, anon, authenticated;
COMMENT ON SCHEMA s112_archiv IS 'KAN-219: Archive außerhalb der Data-API (nur SECURITY-DEFINER-Funktionen und Service-Role)';

CREATE TABLE s112_archiv.elabel_archiv (
  code          text PRIMARY KEY CHECK (code ~ '^[2-9A-HJKMNP-Z]{10}$'),
  inhalt        jsonb NOT NULL CHECK (jsonb_typeof(inhalt) = 'object'),
  betrieb       text,
  quelle_tenant uuid,
  archiviert_am timestamptz NOT NULL DEFAULT now(),
  gueltig_bis   date NOT NULL
);
COMMENT ON TABLE s112_archiv.elabel_archiv IS
  'KAN-219: schreibgeschützte Kopie freigegebener E-Labels gelöschter Betriebe (Inhalt des Umleitungsziels), öffentlich bis gueltig_bis – nur Service-Role';
ALTER TABLE s112_archiv.elabel_archiv ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON s112_archiv.elabel_archiv FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_elabel_archivieren(p_tenant_id uuid, p_jahre integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r         record;
  v_ziel    uuid;
  v_naechst uuid;
  v_id      uuid;
  v_weiter  uuid;
  v_i       integer;
  v_n       integer := 0;
  v_betrieb text;
  v_inhalt  jsonb;
  v_bis     date := ((now() AT TIME ZONE 'Europe/Vienna')::date + make_interval(years => greatest(coalesce(p_jahre, 5), 1)))::date;
BEGIN
  SELECT t.name INTO v_betrieb FROM public.tenants t WHERE t.id = p_tenant_id;
  FOR r IN SELECT e.id, e.code, e.umleitung_auf FROM public.elabels e WHERE e.tenant_id = p_tenant_id AND e.status = 'freigegeben' LOOP
    -- Umleitung wie die öffentliche Seite: freigegebene Ziele im selben Betrieb, höchstens 5 Schritte
    v_ziel := r.id;
    v_naechst := r.umleitung_auf;
    v_i := 0;
    WHILE v_naechst IS NOT NULL AND v_i < 5 LOOP
      SELECT e.id, e.umleitung_auf INTO v_id, v_weiter FROM public.elabels e
       WHERE e.id = v_naechst AND e.tenant_id = p_tenant_id AND e.status = 'freigegeben';
      EXIT WHEN NOT FOUND OR v_id = r.id;
      v_ziel := v_id;
      v_naechst := v_weiter;
      v_i := v_i + 1;
    END LOOP;
    SELECT jsonb_build_object(
             'e', jsonb_build_object('zutaten_ids', to_jsonb(e.zutaten_ids), 'alkohol_vol', e.alkohol_vol, 'energie_kj', e.energie_kj,
                    'energie_kcal', e.energie_kcal, 'fett_g', e.fett_g, 'fett_gesaettigt_g', e.fett_gesaettigt_g,
                    'kohlenhydrate_g', e.kohlenhydrate_g, 'zucker_g', e.zucker_g, 'eiweiss_g', e.eiweiss_g, 'salz_g', e.salz_g),
             'f', (SELECT jsonb_build_object('name', f.name, 'jahrgang', f.jahrgang, 'rebsorte', f.rebsorte, 'qualitaet', f.qualitaet,
                     'zusatzbezeichnung', f.zusatzbezeichnung, 'erzeugnis', f.erzeugnis, 'sekt_stufe', f.sekt_stufe,
                     'flaschengroesse_ml', f.flaschengroesse_ml) FROM public.fuellungen f WHERE f.id = e.fuellung_id),
             'katalog', coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'kategorie', k.kategorie, 'name_de', k.name_de,
                     'name_en', k.name_en, 'e_nummer', k.e_nummer, 'allergen', k.allergen, 'sortierung', k.sortierung) ORDER BY k.sortierung, k.id)
                   FROM public.elabel_zutaten k WHERE k.id = ANY (e.zutaten_ids)), '[]'::jsonb))
      INTO v_inhalt FROM public.elabels e WHERE e.id = v_ziel;
    INSERT INTO s112_archiv.elabel_archiv (code, inhalt, betrieb, quelle_tenant, gueltig_bis)
    VALUES (r.code, v_inhalt, v_betrieb, p_tenant_id, v_bis)
    ON CONFLICT (code) DO UPDATE SET inhalt = EXCLUDED.inhalt, betrieb = EXCLUDED.betrieb, quelle_tenant = EXCLUDED.quelle_tenant,
                                     archiviert_am = now(), gueltig_bis = EXCLUDED.gueltig_bis;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_archivieren(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_elabel_archiv_lesen(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT a.inhalt || jsonb_build_object('betrieb', a.betrieb)
    FROM s112_archiv.elabel_archiv a
   WHERE a.code = p_code AND a.gueltig_bis >= (now() AT TIME ZONE 'Europe/Vienna')::date
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_archiv_lesen(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.s112_elabel_archiv_lesen(text) TO service_role;
COMMENT ON FUNCTION public.s112_elabel_archiv_lesen(text) IS
  'KAN-219: archiviertes E-Label (gelöschter Betrieb) bis gueltig_bis – nur Service-Role (öffentliche E-Label-Seite)';
COMMENT ON FUNCTION public.s112_elabel_archivieren(uuid, integer) IS
  'KAN-219: freigegebene E-Labels eines Betriebs (Inhalt des Umleitungsziels) ins Archiv kopieren – aufgerufen von s112_mandant_loeschen';

-- Mandanten-Löschung: vor der Kaskade archivieren
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

  -- KAN-219 (07.10.2026): freigegebene E-Labels bleiben 5 Jahre öffentlich erreichbar (gedruckte QR-Codes im Handel) –
  -- schreibgeschützte Kopie in elabel_archiv, bevor die Kaskade die E-Labels entfernt
  PERFORM public.s112_elabel_archivieren(p_tenant_id, 5);

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
