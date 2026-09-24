-- ============================================================================
-- Migration kan35_datenintegritaet (KAN-35, Übergangslösung bis zum Journal in AP3)
--
-- Grundsatz: keine Storno-Kennzeichen mit Leser-Filtern, sondern
--   (1) lückenloses DB-Protokoll aller Löschungen und bestandsrelevanten Änderungen
--       (auch Service-Role, FK-Kaskaden, unbekannte Pfade),
--   (2) Sperren statt Löschen, wo Folgebuchungen existieren (FK NO ACTION),
--   (3) datierte Zeilen für Schwund (keller_umzuege) und Flaschenkorrekturen
--       (fuellung_bewegungen) über atomare RPCs,
--   (4) Belegmengen nie mehr herabsetzen (CHECKs; der CHECK „Tankverkauf nur aus
--       Chargen“ folgt erst in der Folge-Migration, siehe Ende der Datei).
-- Die Server Actions werden in einem eigenen Schritt umgestellt.
--
-- EINSPIELBAR VOR DER APP-ANPASSUNG: Diese Migration enthält nichts, woran ein
-- heutiger App-Pfad über die UI scheitert (verkauf_positionen_nur_charge_check ist
-- deshalb bewusst NICHT enthalten – das Verkaufsformular bietet Zukauf-/Pressungs-
-- quellen noch an, ein CHECK würde createVerkauf nach dem Posten-Insert abbrechen
-- und verwaiste Belege mit verbrauchter Rechnungsnummer hinterlassen).
--
-- Reihenfolge in der Datei: M1, M2, M5 (Tabelle vor ihrem Trigger), M3+M4,
-- M6–M12. Läuft komplett in der Transaktion von apply_migration; wiederholbar
-- (IF NOT EXISTS, DROP … IF EXISTS, M10 erkennt bereits gepatchte Funktionen).
--
-- Danach: Security Advisor (Lint 0028/0029, search_path), `npx supabase migration list`,
-- Demo-Reset wie im Betrieb über die Service-Role testen (Hohenstein Suite /demo →
-- „Zurücksetzen“, ruft zuruecksetzen() und y2_kette() als zwei RPCs). Erwartung danach:
--   select count(*) from bestandsprotokoll where tenant_id = '33333333-3333-4333-8333-333333333333';  → 0
--   select count(*) from fuellung_bewegungen where tenant_id = '33333333-…';                          → 2
-- Zusätzlich mit einem authenticated-JWT (App) eine Charge ändern und prüfen, dass
-- db_rolle = 'authenticated' und benutzer_id gesetzt sind.
-- Die Quelle der Demo-Funktionen (Hohenstein Suite supabase/s112/demo_musterhof.sql)
-- muss im selben Zug nachgezogen werden, sonst macht ein erneutes Einspielen M10 rückgängig.
-- ============================================================================


-- ─── M1 Tabelle bestandsprotokoll ───────────────────────────────────────────
-- tenant_id bewusst ohne FK: Mandanten-Kaskaden dürfen nie an Protokoll-Inserts
-- scheitern. Nach dem Löschen eines Mandanten bleiben seine Zeilen bis zur
-- kontrollierten Löschung über bestandsprotokoll_mandant_loeschen() stehen.
CREATE TABLE IF NOT EXISTS public.bestandsprotokoll (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          uuid,
  tabelle            text        NOT NULL,
  datensatz_id       uuid,
  aktion             text        NOT NULL CONSTRAINT bestandsprotokoll_aktion_check CHECK (aktion IN ('DELETE', 'UPDATE')),
  alt                jsonb,
  neu                jsonb,
  geaenderte_spalten text[],
  db_rolle           text,
  benutzer_id        uuid,
  erstellt_am        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bestandsprotokoll_tenant_idx    ON public.bestandsprotokoll (tenant_id, erstellt_am DESC);
CREATE INDEX IF NOT EXISTS bestandsprotokoll_datensatz_idx ON public.bestandsprotokoll (tabelle, datensatz_id);

ALTER TABLE public.bestandsprotokoll ENABLE ROW LEVEL SECURITY;

-- Lesen: Betriebsleiter (system_admin/tenant_admin, aktive Mitgliedschaft) des Mandanten –
-- zusätzlich über get_user_tenant_ids(), damit KI-Abfragen (app.active_tenant_id) auf
-- dem aktiven Betrieb bleiben – sowie Plattform-Admins (auch Zeilen ohne tenant_id).
-- Keine INSERT/UPDATE/DELETE-Policies.
DROP POLICY IF EXISTS bestandsprotokoll_select ON public.bestandsprotokoll;
CREATE POLICY bestandsprotokoll_select ON public.bestandsprotokoll
  FOR SELECT TO authenticated
  USING (
    (tenant_id IN (
       SELECT m.tenant_id FROM public.tenant_memberships m
        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
          AND m.role = ANY (ARRAY['system_admin', 'tenant_admin']))
     AND tenant_id IN (SELECT public.get_user_tenant_ids()))
    OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))
  );

-- Konvention seit Migration 221 (NULL-sicher, weil tenant_id hier NULL sein darf)
DROP POLICY IF EXISTS mitgliedschaft_aktiv ON public.bestandsprotokoll;
CREATE POLICY mitgliedschaft_aktiv ON public.bestandsprotokoll
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (tenant_id IS NULL OR tenant_id NOT IN (SELECT public.s112_gesperrte_tenants()))
  WITH CHECK (tenant_id IS NULL OR tenant_id NOT IN (SELECT public.s112_gesperrte_tenants()));

-- Rechte: nur lesen (authenticated, service_role); geschrieben wird ausschließlich vom
-- SECURITY-DEFINER-Trigger (M2), gelöscht nur über die Funktionen unten bzw. den Demo-Reset.
-- REVOKE ALL entzieht auch MAINTAIN/TRIGGER/REFERENCES aus dem Default-ACL.
REVOKE ALL ON public.bestandsprotokoll FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT ON public.bestandsprotokoll TO authenticated, service_role;
DO $m1$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated, service_role',
                 pg_get_serial_sequence('public.bestandsprotokoll', 'id'));
END $m1$;

-- Löschweg (DSGVO Art. 5 Abs. 1 lit. e, Art. 28 Abs. 3 lit. g): Protokoll eines
-- gelöschten Mandanten entfernen – nur Service-Role/SQL-Editor, nur für Mandanten,
-- die in tenants nicht mehr existieren. Aufbewahrungsfrist legt der Betreiber fest.
CREATE OR REPLACE FUNCTION public.bestandsprotokoll_mandant_loeschen(p_tenant_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n bigint;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin']);

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Bitte einen Mandanten angeben' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Mandant % existiert noch – das Bestandsprotokoll wird erst nach dem Löschen des Mandanten entfernt', p_tenant_id
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.bestandsprotokoll WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bestandsprotokoll_mandant_loeschen(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bestandsprotokoll_mandant_loeschen(uuid) TO service_role;


-- ─── M2 Trigger-Funktion bestandsprotokoll_schreiben() ──────────────────────
-- AFTER-Trigger (DELETE bzw. UPDATE OF …) und BEFORE-TRUNCATE-Sperre. Überwachte
-- Spalten kommen als Trigger-Argumente; ohne Argumente werden alle Spalten verglichen.
-- db_rolle: current_user wäre in SECURITY DEFINER immer postgres; deshalb die API-Rolle
-- aus dem GUC role (PostgREST: authenticated/anon/service_role), sonst session_user.
--
-- Mandant: direkt aus der Zeile; sonst (1) Elternzeile, (2) Protokollzeile der Eltern-
-- Löschung – bei FK-Kaskaden ist die Elternzeile immer schon weg, ihre Protokollzeile
-- aber schon geschrieben (Kind-Ereignisse hängen hinter den AFTER-Triggern der Eltern-
-- zeile) –, (3) noch vorhandene Verweise (Charge, Weingarten, Zukauf, Grundstück).
-- Bewusst nicht über behaelter (Kellergemeinschaft: Gebinde eines anderen Betriebs).
--
-- Bypass nur für den Demo-Reset: s112.protokoll_aus = UUID des Demo-Mandanten, Zeile
-- gehört zum Demo-Mandanten und die Änderung kommt nicht von einem API-Benutzer
-- (service_role aus dem Hohenstein-Suite-Cron/-Button bzw. postgres im SQL-Editor).
-- Echte Mandantendaten sind damit nie ausgenommen, auch wenn der GUC gefälscht wird.
CREATE OR REPLACE FUNCTION public.bestandsprotokoll_schreiben()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_demo      constant uuid := '33333333-3333-4333-8333-333333333333';
  v_rolle     text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_alt       jsonb;
  v_neu       jsonb;
  v_alt_diff  jsonb;
  v_neu_diff  jsonb;
  v_spalten   text[];
  v_tenant    uuid;
  v_eltern    text;
  v_eltern_id uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'TRUNCATE auf „%“ ist gesperrt (KAN-35 Bestandsprotokoll) – bitte zeilenweise mit DELETE löschen', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Datenminimierung: Versand-E-Mail-Adresse ist nicht bestandsrelevant
    v_alt := to_jsonb(OLD) - 'rechnung_versendet_an';
  ELSIF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    v_neu := to_jsonb(NEW);
    SELECT array_agg(s.k ORDER BY s.k),
           jsonb_object_agg(s.k, v_alt -> s.k),
           jsonb_object_agg(s.k, v_neu -> s.k)
      INTO v_spalten, v_alt_diff, v_neu_diff
      FROM unnest(CASE WHEN TG_NARGS > 0 THEN TG_ARGV
                       ELSE ARRAY(SELECT jsonb_object_keys(v_neu)) END) AS s(k)
     WHERE (v_alt -> s.k) IS DISTINCT FROM (v_neu -> s.k);
    IF v_spalten IS NULL THEN
      RETURN NULL;  -- keine überwachte Spalte hat sich tatsächlich geändert
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  v_tenant := COALESCE((v_alt ->> 'tenant_id')::uuid, (v_neu ->> 'tenant_id')::uuid);

  IF v_tenant IS NULL THEN
    -- (1) Elternzeile
    CASE TG_TABLE_NAME
      WHEN 'pressung_behaelter', 'pressung_weingaerten' THEN
        v_eltern := 'pressungen';
        v_eltern_id := COALESCE((v_alt ->> 'pressung_id')::uuid, (v_neu ->> 'pressung_id')::uuid);
        SELECT p.tenant_id INTO v_tenant FROM public.pressungen p WHERE p.id = v_eltern_id;
      WHEN 'verschneidung_quellen' THEN
        v_eltern := 'verschneidungen';
        v_eltern_id := COALESCE((v_alt ->> 'verschneidung_id')::uuid, (v_neu ->> 'verschneidung_id')::uuid);
        SELECT v.tenant_id INTO v_tenant FROM public.verschneidungen v WHERE v.id = v_eltern_id;
      WHEN 'ama_meldepositionen' THEN
        v_eltern := 'ama_erntemeldungen';
        v_eltern_id := COALESCE((v_alt ->> 'meldung_id')::uuid, (v_neu ->> 'meldung_id')::uuid);
        SELECT a.tenant_id INTO v_tenant FROM public.ama_erntemeldungen a WHERE a.id = v_eltern_id;
      WHEN 'ernte_parzellen' THEN
        v_eltern := 'weinjahrgaenge';
        v_eltern_id := COALESCE((v_alt ->> 'jahrgang_id')::uuid, (v_neu ->> 'jahrgang_id')::uuid);
        SELECT j.tenant_id INTO v_tenant FROM public.weinjahrgaenge j WHERE j.id = v_eltern_id;
      ELSE
        NULL;
    END CASE;

    -- (2) Protokollzeile der Eltern-Löschung (FK-Kaskade)
    IF v_tenant IS NULL AND v_eltern_id IS NOT NULL THEN
      SELECT b.tenant_id INTO v_tenant
        FROM public.bestandsprotokoll b
       WHERE b.tabelle = v_eltern AND b.datensatz_id = v_eltern_id
         AND b.aktion = 'DELETE' AND b.tenant_id IS NOT NULL
       ORDER BY b.id DESC
       LIMIT 1;
    END IF;

    -- (3) noch vorhandene Verweise
    IF v_tenant IS NULL THEN
      CASE TG_TABLE_NAME
        WHEN 'pressung_behaelter' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'weinausbau_id')::uuid;
        WHEN 'verschneidung_quellen' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'quell_weinausbau_id')::uuid;
        WHEN 'pressung_weingaerten' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g    WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT z.tenant_id FROM public.zukauf_posten z WHERE z.id = (v_alt ->> 'zukauf_posten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s  WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        WHEN 'ernte_parzellen' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g   WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        ELSE
          NULL;
      END CASE;
    END IF;
  END IF;

  -- Bypass Demo-Reset (siehe Kopfkommentar); nie für API-Benutzer, nie für echte Mandanten
  IF v_tenant = c_demo
     AND current_setting('s112.protokoll_aus', true) = c_demo::text
     AND v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.bestandsprotokoll
    (tenant_id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id)
  VALUES
    (v_tenant, TG_TABLE_NAME, COALESCE((v_alt ->> 'id')::uuid, (v_neu ->> 'id')::uuid), TG_OP,
     CASE WHEN TG_OP = 'DELETE' THEN v_alt ELSE v_alt_diff END,
     v_neu_diff, v_spalten, v_rolle, auth.uid());

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bestandsprotokoll_schreiben() FROM PUBLIC, anon, authenticated;

-- Protokoll selbst: TRUNCATE sperren (Zeilen-Trigger gibt es hier nicht)
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.bestandsprotokoll;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.bestandsprotokoll
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();


-- ─── M5 Tabelle fuellung_bewegungen (append-only Flaschenbewegungen) ────────
-- ON DELETE CASCADE auf fuellungen (Konzeptentscheidung): die App löscht Füllungen
-- nicht hart (nur deaktivieren); Hilfsskripte sql/cleanup_*.sql und Mandanten-
-- Kaskaden löschen sie. Jede Kaskade auf fuellung_bewegungen wird per M3 mit
-- vollständiger Zeile protokolliert – die Historie geht also nicht verloren.
CREATE TABLE IF NOT EXISTS public.fuellung_bewegungen (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fuellung_id     uuid        NOT NULL REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  datum           date        NOT NULL,
  art             text        NOT NULL,
  menge_stk       integer     NOT NULL,
  bestand_vorher  integer,
  bestand_nachher integer,
  grund           text,
  erstellt_von    uuid        DEFAULT auth.uid(),
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fuellung_bewegungen_art_check
    CHECK (art IN ('inventur', 'bruch', 'eigenverbrauch', 'schwund', 'korrektur', 'anfangsbestand')),
  CONSTRAINT fuellung_bewegungen_menge_check CHECK (menge_stk <> 0),
  CONSTRAINT fuellung_bewegungen_abgang_check
    CHECK (art NOT IN ('bruch', 'eigenverbrauch', 'schwund') OR menge_stk < 0),
  CONSTRAINT fuellung_bewegungen_bestand_check
    CHECK ((bestand_vorher  IS NULL OR bestand_vorher  >= 0)
       AND (bestand_nachher IS NULL OR bestand_nachher >= 0)
       AND (bestand_vorher IS NULL OR bestand_nachher IS NULL OR bestand_nachher = bestand_vorher + menge_stk))
);

CREATE INDEX IF NOT EXISTS fuellung_bewegungen_tenant_fuellung_datum_idx
  ON public.fuellung_bewegungen (tenant_id, fuellung_id, datum);
CREATE INDEX IF NOT EXISTS fuellung_bewegungen_fuellung_idx
  ON public.fuellung_bewegungen (fuellung_id);   -- FK-Kaskade aus fuellungen

ALTER TABLE public.fuellung_bewegungen ENABLE ROW LEVEL SECURITY;

-- Lesen für Mitglieder; get_user_tenant_ids() beachtet app.active_tenant_id und hält
-- damit auch KI-Abfragen (ki_readonly_query) auf dem aktiven Betrieb.
DROP POLICY IF EXISTS fuellung_bewegungen_select ON public.fuellung_bewegungen;
CREATE POLICY fuellung_bewegungen_select ON public.fuellung_bewegungen
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS mitgliedschaft_aktiv ON public.fuellung_bewegungen;
CREATE POLICY mitgliedschaft_aktiv ON public.fuellung_bewegungen
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (tenant_id NOT IN (SELECT public.s112_gesperrte_tenants()))
  WITH CHECK (tenant_id NOT IN (SELECT public.s112_gesperrte_tenants()));

-- Schreiben nur per RPC fuellung_bestand_buchen (M6, läuft als Owner) bzw. Demo-Reset;
-- append-only auch für die Service-Role (kein INSERT am RPC vorbei → Bestand und
-- Bewegungen bleiben deckungsgleich, tenant_id immer = Mandant der Füllung).
REVOKE ALL ON public.fuellung_bewegungen FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT ON public.fuellung_bewegungen TO authenticated, service_role;


-- ─── M3 Protokoll-Trigger + M4 TRUNCATE sperren ────────────────────────────
-- Je Tabelle: z_protokoll_loeschen (AFTER DELETE), wo Spalten angegeben sind
-- z_protokoll_aendern (AFTER UPDATE OF <Spalten>, dieselben Spalten als Argumente)
-- und z_protokoll_truncate (BEFORE TRUNCATE → Fehler, gilt auch für Service-Role
-- und postgres). Präfix z_ → feuert nach den übrigen AFTER-Triggern (derzeit nur
-- trg_pressung_weinausbau_weingaerten). Alle Spalten im Katalog geprüft (24.09.2026);
-- CREATE TRIGGER bricht bei einer unbekannten Spalte ab.
-- M4: TRUNCATE umgeht RLS und Zeilen-Trigger → zusätzlich entziehen (auch service_role;
-- kein Code im Repo und keine DB-Funktion nutzt TRUNCATE). TRIGGER/REFERENCES braucht
-- die Data API nicht (wie im Nachschliff Paketfelder-Schutz; MAINTAIN bleibt wie dort).
DO $m3$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('weinausbau'::text, ARRAY['menge_liter', 'anfangsbestand_liter', 'behaelter_id', 'aktiv', 'status',
                                 'qualitaetsstufe', 'herkunft_code', 'weinart', 'rebsorte', 'jahrgang',
                                 'ist_eroeffnungsbestand', 'tenant_id']::text[]),
      ('keller_umzuege',        ARRAY['datum', 'menge_liter', 'schwund_liter', 'brutto_liter',
                                      'von_weinausbau_id', 'nach_weinausbau_id', 'von_behaelter_id',
                                      'nach_behaelter_id', 'umzug_typ', 'zeilen_typ', 'umzug_batch_id', 'tenant_id']),
      ('verschneidungen',       ARRAY['datum', 'ziel_weinausbau_id', 'tenant_id']),
      ('verschneidung_quellen', ARRAY['menge_liter', 'quell_weinausbau_id', 'verschneidung_id']),
      ('keller_behandlungen',   ARRAY['datum', 'menge', 'einheit', 'volumen_liter_ist', 'typ_id',
                                      'weinausbau_id', 'behaelter_id', 'tenant_id']),
      ('fuellungen',            ARRAY['bestand_flaschen', 'anzahl_flaschen', 'menge_liter_gefuellt',
                                      'flaschengroesse_ml', 'aktiv', 'weinausbau_id', 'datum',
                                      'qualitaet', 'jahrgang', 'rebsorte', 'herkunft_code', 'pruefnummer',
                                      'anbaugebiet', 'tenant_id']),
      ('fuellung_chargen',      ARRAY['anteil_liter', 'weinausbau_id', 'fuellung_id', 'tenant_id']),
      ('fuellung_bewegungen',   NULL),
      ('zukauf_posten',         ARRAY['menge', 'einheit', 'art', 'aktiv', 'ziel_weinausbau_id', 'datum', 'tenant_id']),
      ('pressungen',            ARRAY['datum', 'jahrgang_id', 'most_liter_gesamt', 'tenant_id']),
      ('pressung_behaelter',    ARRAY['menge_liter', 'behaelter_id', 'weinausbau_id', 'pressung_id']),
      ('pressung_weingaerten',  ARRAY['trauben_kg', 'weingarten_id', 'grundstueck_id', 'zukauf_posten_id', 'pressung_id']),
      ('ernte_parzellen',       ARRAY['menge_kg', 'menge_hl', 'jahrgang_id', 'weingarten_id', 'grundstueck_id']),
      ('traubenverkauf',        ARRAY['menge_kg', 'datum', 'jahrgang_id', 'weingarten_id', 'grundstueck_id',
                                      'zukauf_posten_id', 'verkaufsposten_id', 'tenant_id']),
      ('verkaufsposten',        ARRAY['aktiv', 'storniert', 'storniert_am', 'datum', 'tenant_id']),
      ('verkauf_positionen',    ARRAY['menge', 'einheit', 'typ', 'weinausbau_id', 'fuellung_id', 'zukauf_id',
                                      'pressung_behaelter_id', 'traubenverkauf_id', 'verkaufsposten_id', 'tenant_id']),
      ('ama_erntemeldungen',    ARRAY['status', 'gesamtmenge_kg', 'gesamtmenge_hl', 'jahrgang_id', 'tenant_id']),
      ('ama_meldepositionen',   ARRAY['menge_kg', 'menge_hl', 'meldung_id']),
      ('weinjahrgaenge',        NULL)
    ) AS t(tabelle, spalten)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.%I', r.tabelle);
    EXECUTE format('CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', r.tabelle);

    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.%I', r.tabelle);
    IF r.spalten IS NOT NULL THEN
      EXECUTE format('CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF %s ON public.%I '
                     'FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben(%s)',
                     (SELECT string_agg(format('%I', s), ', ') FROM unnest(r.spalten) AS s),
                     r.tabelle,
                     (SELECT string_agg(quote_literal(s), ', ') FROM unnest(r.spalten) AS s));
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.%I', r.tabelle);
    EXECUTE format('CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', r.tabelle);

    -- M4
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated', r.tabelle);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM service_role', r.tabelle);
  END LOOP;
END $m3$;


-- ─── M6 RPC fuellung_bestand_buchen ─────────────────────────────────────────
-- Einziger Weg, bestand_flaschen außerhalb von Verkauf/Storno zu ändern: datierte Zeile
-- in fuellung_bewegungen + Bestand in einer Transaktion, Füllung gesperrt (FOR UPDATE).
-- Inventur: Delta = Ist-Bestand − Bestand (p_ist_bestand); sonst Delta = p_menge_stk.
-- Parameter so geordnet, dass PostgREST den Aufruf auch ohne den jeweils nicht
-- benötigten Mengenparameter findet (Aufruf mit Namen; p_datum bleibt Pflicht, das
-- Datum kommt aus der App in Ortszeit).
-- SECURITY DEFINER umgeht RLS → Mandant, Rolle und Schreibmodul werden hier geprüft
-- (Modulprüfung wie RLS modul_update auf fuellungen). Mit dem Benutzer-Client
-- aufrufen, sonst fehlen erstellt_von und benutzer_id im Protokoll.
CREATE OR REPLACE FUNCTION public.fuellung_bestand_buchen(
  p_tenant_id   uuid,
  p_fuellung_id uuid,
  p_art         text,
  p_datum       date,
  p_menge_stk   integer DEFAULT NULL,
  p_ist_bestand integer DEFAULT NULL,
  p_grund       text    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alt   integer;
  v_delta bigint;
  v_neu   bigint;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);

  IF NOT public.ist_service_kontext()
     AND NOT public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft') THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Füllungen in diesem Betrieb' USING ERRCODE = '42501';
  END IF;

  IF p_art IS NULL OR p_art NOT IN ('inventur', 'bruch', 'eigenverbrauch', 'schwund', 'korrektur', 'anfangsbestand') THEN
    RAISE EXCEPTION 'Unbekannte Buchungsart „%“ (erlaubt: inventur, bruch, eigenverbrauch, schwund, korrektur, anfangsbestand)',
      COALESCE(p_art, '') USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Buchungsdatum angeben' USING ERRCODE = '22023';
  END IF;

  SELECT f.bestand_flaschen INTO v_alt
    FROM public.fuellungen f
   WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden' USING ERRCODE = 'P0002';
  END IF;

  IF p_art = 'inventur' THEN
    IF p_ist_bestand IS NULL OR p_ist_bestand < 0 THEN
      RAISE EXCEPTION 'Für eine Inventur bitte den gezählten Ist-Bestand (0 oder mehr Flaschen) angeben' USING ERRCODE = '22023';
    END IF;
    v_delta := p_ist_bestand::bigint - v_alt;
    IF v_delta = 0 THEN
      RAISE EXCEPTION 'Keine Differenz: Der gezählte Bestand entspricht dem aktuellen Bestand (% Flaschen)', v_alt
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_menge_stk IS NULL OR p_menge_stk = 0 THEN
      RAISE EXCEPTION 'Bitte eine Menge in Stück (ungleich 0) angeben' USING ERRCODE = '22023';
    END IF;
    IF p_art IN ('bruch', 'eigenverbrauch', 'schwund') AND p_menge_stk > 0 THEN
      RAISE EXCEPTION 'Bei „%“ ist die Menge ein Abgang und muss negativ sein', p_art USING ERRCODE = '22023';
    END IF;
    v_delta := p_menge_stk;
  END IF;

  v_neu := v_alt::bigint + v_delta;   -- bigint: kein „integer out of range“
  IF v_neu < 0 THEN
    RAISE EXCEPTION 'Der Flaschenbestand darf nicht negativ werden (aktuell % Flaschen, Buchung % Flaschen)', v_alt, v_delta
      USING ERRCODE = '22023';
  END IF;
  IF v_neu > 2147483647 THEN
    RAISE EXCEPTION 'Der neue Flaschenbestand (% Flaschen) ist unplausibel groß – bitte die Menge prüfen', v_neu
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fuellung_bewegungen
    (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_von)
  VALUES
    (p_tenant_id, p_fuellung_id, p_datum, p_art, v_delta::integer, v_alt, v_neu::integer,
     NULLIF(btrim(p_grund), ''), auth.uid());

  UPDATE public.fuellungen
     SET bestand_flaschen = v_neu::integer
   WHERE id = p_fuellung_id AND tenant_id = p_tenant_id;

  RETURN v_neu::integer;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fuellung_bestand_buchen(uuid, uuid, text, date, integer, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fuellung_bestand_buchen(uuid, uuid, text, date, integer, integer, text) TO authenticated, service_role;


-- ─── M7 RPC schwund_buchen ──────────────────────────────────────────────────
-- Schreibt die Schwund-Zeile in der bestehenden App-Konvention (createFuellung,
-- manuellSchwundBuchen, Demo-Funktionen): umzug_typ 'schwund', von_weinausbau_id =
-- Charge, nach_behaelter_id = Gebinde der Charge (NULL nur ohne Gebinde),
-- menge_liter 0, brutto_liter = schwund_liter = Schwund, zeilen_typ Default
-- 'transfer', ohne Batch und ohne transaktions_nr (vergibt die App für Schwund nie).
--
-- p_bestand_mindern = true (Standard): menge_liter −= Schwund (höchstens der Bestand).
--   Bleiben danach ≤ 0,01 L, wird der Rest mit ausgebucht und die Charge wie in allen
--   übrigen App-Pfaden abgeschlossen (menge_liter 0, status 'abgeschlossen', aktiv
--   false) – keine aktiven 0-L-Chargen. p_abschliessen = true verlangt genau das und
--   bricht ab, wenn mehr übrig bliebe (so wie schwundAusbuchen es heute tut).
-- p_bestand_mindern = false: Nachbuchung (Behälter-Bewegungsbuch „Schwund ausbuchen“,
--   heute manuellSchwundBuchen): nur die datierte Zeile, menge_liter bleibt, auch für
--   abgeschlossene Chargen mit 0 L; braucht ein Gebinde, p_abschliessen nicht erlaubt.
-- weinausbau_gebinde_pruefen: das Update senkt nur die Menge bzw. setzt aktiv=false,
-- der Trigger kehrt dann sofort zurück (kein Konflikt mit Fremdbelegung).
-- Modulprüfung wie RLS: weinausbau (kellerbuch|rieden) nur beim Mindern, keller_umzuege
-- (kellerbuch|warenwirtschaft) immer. Mit dem Benutzer-Client aufrufen.
CREATE OR REPLACE FUNCTION public.schwund_buchen(
  p_tenant_id       uuid,
  p_weinausbau_id   uuid,
  p_liter           numeric,
  p_datum           date,
  p_notiz           text    DEFAULT NULL,
  p_abschliessen    boolean DEFAULT false,
  p_bestand_mindern boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mindern   boolean := COALESCE(p_bestand_mindern, true);
  v_abschl    boolean := COALESCE(p_abschliessen, false);
  v_liter     numeric;
  v_menge     numeric;
  v_rest      numeric;
  v_behaelter uuid;
  v_name      text;
  v_id        uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);

  IF NOT public.ist_service_kontext()
     AND NOT (public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')
              AND (NOT v_mindern OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'rieden'))) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb' USING ERRCODE = '42501';
  END IF;

  v_liter := round(p_liter, 2);   -- keller_umzuege/weinausbau speichern numeric(10,2)
  IF v_liter IS NULL OR v_liter <= 0 THEN
    RAISE EXCEPTION 'Die Schwundmenge muss größer als 0 L sein' USING ERRCODE = '22023';
  END IF;
  IF v_liter >= 100000000 THEN
    RAISE EXCEPTION 'Die Schwundmenge ist unplausibel groß – bitte prüfen' USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Buchungsdatum für den Schwund angeben' USING ERRCODE = '22023';
  END IF;
  IF v_abschl AND NOT v_mindern THEN
    RAISE EXCEPTION 'Eine Nachbuchung ohne Bestandsminderung kann die Charge nicht abschließen' USING ERRCODE = '22023';
  END IF;

  SELECT w.menge_liter, w.behaelter_id, w.name
    INTO v_menge, v_behaelter, v_name
    FROM public.weinausbau w
   WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden' USING ERRCODE = 'P0002';
  END IF;
  v_menge := COALESCE(v_menge, 0);

  IF v_mindern THEN
    IF v_liter > v_menge + 0.005 THEN
      RAISE EXCEPTION 'Schwund von % L übersteigt den Bestand der Charge „%“ (% L)',
        replace(to_char(v_liter, 'FM999999990.00'), '.', ','), v_name,
        replace(to_char(v_menge, 'FM999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;
    v_rest := GREATEST(v_menge - v_liter, 0);
    IF v_rest <= 0.01 THEN
      v_liter := v_liter + v_rest;   -- Restmenge ≤ 0,01 L mit ausbuchen, dann abschließen
      v_rest  := 0;
    ELSIF v_abschl THEN
      RAISE EXCEPTION 'Charge „%“ kann nicht abgeschlossen werden: nach dem Schwund verbleiben noch % L',
        v_name, replace(to_char(v_rest, 'FM999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_behaelter IS NULL THEN
    RAISE EXCEPTION 'Charge „%“ ist keinem Gebinde zugeordnet – eine Nachbuchung ins Bewegungsbuch ist nicht möglich', v_name
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.keller_umzuege
    (tenant_id, datum, von_weinausbau_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter, umzug_typ, notizen)
  VALUES
    (p_tenant_id, p_datum, p_weinausbau_id, v_behaelter, 0, v_liter, v_liter, 'schwund',
     COALESCE(NULLIF(btrim(p_notiz), ''), CASE WHEN v_mindern THEN 'Schwund' ELSE 'Manueller Schwund' END))
  RETURNING id INTO v_id;

  IF v_mindern THEN
    IF v_rest = 0 THEN
      UPDATE public.weinausbau
         SET menge_liter = 0, status = 'abgeschlossen', aktiv = false
       WHERE id = p_weinausbau_id AND tenant_id = p_tenant_id;
    ELSE
      UPDATE public.weinausbau
         SET menge_liter = v_rest
       WHERE id = p_weinausbau_id AND tenant_id = p_tenant_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.schwund_buchen(uuid, uuid, numeric, date, text, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.schwund_buchen(uuid, uuid, numeric, date, text, boolean, boolean) TO authenticated, service_role;


-- ─── M8 CHECK-Constraints ───────────────────────────────────────────────────
-- Vorprüfung (Stand 24.09.2026: überall 0 Verstöße); bei Altdaten Abbruch mit Zählung.
-- Alle hier angelegten CHECKs sind über die UI nicht erreichbar (Formulare/KI-Tools
-- prüfen > 0 bzw. min-Attribute); nur Direkt-POSTs scheitern künftig mit 23514.
-- Der CHECK „Tankverkauf nur aus Chargen“ (zukauf_id/pressung_behaelter_id IS NULL)
-- kommt erst in der Folge-Migration nach dem App-Deploy (siehe Ende der Datei);
-- hier nur ein Hinweis, falls inzwischen solche Positionen entstanden sind.
DO $m8$
DECLARE
  n_vp_menge integer;
  n_vp_bezug integer;
  n_vq       integer;
  n_wa_menge integer;
  n_wa_anf   integer;
  n_ku       integer;
BEGIN
  SELECT count(*) INTO n_vp_menge FROM public.verkauf_positionen
   WHERE typ IN ('flasche', 'tank', 'trauben') AND NOT (menge > 0);
  SELECT count(*) INTO n_vp_bezug FROM public.verkauf_positionen
   WHERE zukauf_id IS NOT NULL OR pressung_behaelter_id IS NOT NULL;
  SELECT count(*) INTO n_vq FROM public.verschneidung_quellen
   WHERE menge_liter IS NULL OR menge_liter <= 0;
  SELECT count(*) INTO n_wa_menge FROM public.weinausbau WHERE menge_liter < 0;
  SELECT count(*) INTO n_wa_anf   FROM public.weinausbau WHERE anfangsbestand_liter < 0;
  SELECT count(*) INTO n_ku FROM public.keller_umzuege
   WHERE menge_liter < 0 OR schwund_liter < 0 OR brutto_liter < 0;

  IF n_vp_menge + n_vq + n_wa_menge + n_wa_anf + n_ku > 0 THEN
    RAISE EXCEPTION 'KAN-35: Altdaten verletzen die neuen Prüfregeln – verkauf_positionen Menge ≤ 0: %, verschneidung_quellen Menge fehlt/≤ 0: %, weinausbau.menge_liter < 0: %, weinausbau.anfangsbestand_liter < 0: %, keller_umzuege mit negativer Menge: %. Bitte zuerst bereinigen.',
      n_vp_menge, n_vq, n_wa_menge, n_wa_anf, n_ku;
  END IF;
  IF n_vp_bezug > 0 THEN
    RAISE NOTICE 'KAN-35: % Verkaufsposition(en) mit Zukauf-/Pressungsbezug – vor der Folge-Migration (nur_charge_check) rekonstruieren (Bereich A).', n_vp_bezug;
  END IF;
END $m8$;

-- Verkaufsmengen positiv (sonstiges bleibt frei, z. B. Gutschriften)
ALTER TABLE public.verkauf_positionen DROP CONSTRAINT IF EXISTS verkauf_positionen_menge_positiv_check;
ALTER TABLE public.verkauf_positionen ADD CONSTRAINT verkauf_positionen_menge_positiv_check
  CHECK (typ NOT IN ('flasche', 'tank', 'trauben') OR menge > 0);

-- Verschnitt-Quellen: Menge Pflicht und positiv (Spalte menge_liter, nullable → NULL ausdrücklich ausgeschlossen)
ALTER TABLE public.verschneidung_quellen DROP CONSTRAINT IF EXISTS verschneidung_quellen_menge_positiv_check;
ALTER TABLE public.verschneidung_quellen ADD CONSTRAINT verschneidung_quellen_menge_positiv_check
  CHECK (menge_liter IS NOT NULL AND menge_liter > 0);

ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_menge_liter_nicht_negativ_check;
ALTER TABLE public.weinausbau ADD CONSTRAINT weinausbau_menge_liter_nicht_negativ_check
  CHECK (menge_liter IS NULL OR menge_liter >= 0);

ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_anfangsbestand_nicht_negativ_check;
ALTER TABLE public.weinausbau ADD CONSTRAINT weinausbau_anfangsbestand_nicht_negativ_check
  CHECK (anfangsbestand_liter IS NULL OR anfangsbestand_liter >= 0);

ALTER TABLE public.keller_umzuege DROP CONSTRAINT IF EXISTS keller_umzuege_mengen_nicht_negativ_check;
ALTER TABLE public.keller_umzuege ADD CONSTRAINT keller_umzuege_mengen_nicht_negativ_check
  CHECK (menge_liter >= 0 AND schwund_liter >= 0 AND (brutto_liter IS NULL OR brutto_liter >= 0));


-- ─── M9 FK-Umstellungen: Sperren statt still Löschen/Abkoppeln ─────────────
-- NO ACTION wird erst nach den Kaskaden derselben Ebene geprüft: weinausbau,
-- keller_behandlungen und verschneidungen hängen direkt an tenants und werden bei
-- einer Mandanten-Löschung vor der Prüfung mitgelöscht – für diese drei FKs bleibt die
-- Mandanten-Kaskade also unverändert. Ausnahme Kellergemeinschaft: liegen Chargen eines
-- ANDEREN Betriebs in den Gebinden (Stand 24.09.2026: 19 Spaetrot-Chargen in Gebinden
-- des Mandanten 097f67ed…), ist dieser Mandant nicht mehr löschbar (bisher wurden die
-- fremden Chargen still abgekoppelt). Hinweis: Mandanten mit Pressungen oder Verschnitten
-- sind voraussichtlich schon heute nicht per DELETE FROM tenants löschbar
-- (pressung_behaelter_behaelter_id_fkey und verschneidung_quellen_quell_weinausbau_id_fkey
-- sind NO ACTION und werden vor der Kaskade pressungen/verschneidungen → Kinder geprüft) –
-- Mandanten-Löschung braucht ein eigenes Ticket mit expliziter Löschreihenfolge.
-- Demo-Reset: löscht keller_behandlungen, verschneidung_* und weinausbau vor behaelter
-- bzw. weinausbau; demo_musterhof_y2_kette löscht nur Chargen ohne Verschneidung.
-- (a) Gebinde mit (auch inaktiven oder fremden) Chargen nicht mehr löschbar.
ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_behaelter_id_fkey;
ALTER TABLE public.weinausbau ADD CONSTRAINT weinausbau_behaelter_id_fkey
  FOREIGN KEY (behaelter_id) REFERENCES public.behaelter(id) ON DELETE NO ACTION;

-- (b) Gebinde löschen löscht keine Kellerbehandlungen mehr mit
ALTER TABLE public.keller_behandlungen DROP CONSTRAINT IF EXISTS keller_behandlungen_behaelter_id_fkey;
ALTER TABLE public.keller_behandlungen ADD CONSTRAINT keller_behandlungen_behaelter_id_fkey
  FOREIGN KEY (behaelter_id) REFERENCES public.behaelter(id) ON DELETE NO ACTION;

-- (c) Charge löschen löscht keine Verschnitt-Belege mehr mit (Quellen würden nicht zurückgebucht)
ALTER TABLE public.verschneidungen DROP CONSTRAINT IF EXISTS verschneidungen_ziel_weinausbau_id_fkey;
ALTER TABLE public.verschneidungen ADD CONSTRAINT verschneidungen_ziel_weinausbau_id_fkey
  FOREIGN KEY (ziel_weinausbau_id) REFERENCES public.weinausbau(id) ON DELETE NO ACTION;


-- ─── M10 Demo-Funktionen patchen (Muster wie Migration 216/217) ────────────
-- Beide Funktionen:
--   (a) direkt nach dem ersten BEGIN: PERFORM set_config('s112.protokoll_aus', c_t::text, true);
--       (transaktionslokal; wirkt auch für die aufgerufenen INVOKER-Helfer; der Trigger
--       nimmt nur Zeilen des Demo-Mandanten aus, siehe M2)
-- Nur demo_musterhof_zuruecksetzen:
--   (b) Frist „Bestandsmeldung Wein“ verlinkt /reports/ama statt /reports/keller
--       (einziges Vorkommen, Zeile der Frist-VALUES),
--   (c) vor dem ersten Löschen: Protokollzeilen der Demo-Nutzung verwerfen,
--   (d) die zwei direkten Bestands-Überschreibungen der Altbestands-Füllungen
--       (19,2 → 1400, 19,3 → 700) zusätzlich als fuellung_bewegungen 'anfangsbestand'
--       buchen, damit die Bestands-Identität (M12) auch im Demo-Mandanten gilt.
-- Beide Funktionen: keine Argumente, RETURNS void, SECURITY DEFINER, Owner postgres,
-- EXECUTE nur postgres/service_role. CREATE OR REPLACE behält Owner und Rechte; sie
-- werden unten trotzdem noch einmal gesetzt. Die Quelle in Hohenstein Suite
-- (supabase/s112/demo_musterhof.sql) muss gleich nachgezogen werden.
DO $m10$
DECLARE
  v_fn     text;
  v_def    text;
  v_neu    text;
  v_n      integer;
  v_secdef boolean;
  v_res    text;
  v_args   text;
  c_anker  constant text := E'\nbegin\n';
  c_bypass constant text := E'\nbegin\n  PERFORM set_config(''s112.protokoll_aus'', c_t::text, true);  -- KAN-35: Demo-Reset nicht protokollieren (nur Demo-Mandant)\n';
  c_sumup  constant text := E'\n  delete from sumup_transaktionen where tenant_id = c_t;\n';
  c_purge  constant text := E'\n  delete from bestandsprotokoll where tenant_id = c_t;  -- KAN-35: Protokoll der Demo-Nutzung verwerfen\n  delete from sumup_transaktionen where tenant_id = c_t;\n';
  c_best_re  constant text := E'\\n  update fuellungen set bestand_flaschen = ([0-9]+) +where id = (demo_musterhof_id\\(19,[0-9]+\\)) and tenant_id = c_t;';
  c_best_neu constant text :=
       E'\n  insert into fuellung_bewegungen (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund)  -- KAN-35\n'
    || E'    select c_t, fu.id, coalesce(fu.datum, d), ''anfangsbestand'', \\1 - fu.bestand_flaschen, fu.bestand_flaschen, \\1, ''Restbestand bei Systemstart (Verkäufe vor Einführung)''\n'
    || E'      from fuellungen fu where fu.id = \\2 and fu.tenant_id = c_t and fu.bestand_flaschen <> \\1;\n'
    || E'  update fuellungen set bestand_flaschen = \\1 where id = \\2 and tenant_id = c_t;';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.demo_musterhof_zuruecksetzen()', 'public.demo_musterhof_y2_kette()'] LOOP
    SELECT p.prosecdef, pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
      INTO v_secdef, v_res, v_args, v_def
      FROM pg_proc p
     WHERE p.oid = v_fn::regprocedure;
    IF NOT v_secdef OR v_res <> 'void' OR v_args <> '' THEN
      RAISE EXCEPTION 'KAN-35/M10: % hat eine unerwartete Signatur (security definer %, Rückgabe %, Argumente „%“)',
        v_fn, v_secdef, v_res, v_args;
    END IF;
    IF v_def !~ E'\n  c_t [^\n]*uuid := ''33333333-3333-4333-8333-333333333333'';' THEN
      RAISE EXCEPTION 'KAN-35/M10: % deklariert c_t nicht als Demo-Mandanten 33333333-… – Text prüfen', v_fn;
    END IF;

    v_neu := v_def;

    -- (a) Bypass einfügen, sofern noch nicht vorhanden
    IF position('s112.protokoll_aus' IN v_neu) = 0 THEN
      v_n := (length(v_neu) - length(replace(v_neu, c_anker, ''))) / length(c_anker);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'KAN-35/M10: In % wurde der Anker „begin“ % mal gefunden (erwartet genau 1)', v_fn, v_n;
      END IF;
      v_neu := replace(v_neu, c_anker, c_bypass);
    END IF;

    IF v_fn = 'public.demo_musterhof_zuruecksetzen()' THEN
      -- (b) Frist-Link
      v_n := (length(v_neu) - length(replace(v_neu, '''/reports/keller''', ''))) / length('''/reports/keller''');
      IF v_n = 1 AND v_neu ~ '''Bestandsmeldung Wein[^\n]*''/reports/keller''' THEN
        v_neu := replace(v_neu, '''/reports/keller''', '''/reports/ama''');
      ELSIF v_n = 0 AND v_neu ~ '''Bestandsmeldung Wein[^\n]*''/reports/ama''' THEN
        NULL;  -- bereits umgestellt
      ELSE
        RAISE EXCEPTION 'KAN-35/M10: ''/reports/keller'' kommt in % % mal vor bzw. nicht in der Frist „Bestandsmeldung Wein“ – Text prüfen', v_fn, v_n;
      END IF;

      -- (c) Demo-Protokoll verwerfen
      IF position('delete from bestandsprotokoll' IN v_neu) = 0 THEN
        v_n := (length(v_neu) - length(replace(v_neu, c_sumup, ''))) / length(c_sumup);
        IF v_n <> 1 THEN
          RAISE EXCEPTION 'KAN-35/M10: In % wurde der Anker „delete from sumup_transaktionen“ % mal gefunden (erwartet genau 1)', v_fn, v_n;
        END IF;
        v_neu := replace(v_neu, c_sumup, c_purge);
      END IF;

      -- (d) Altbestands-Überschreibungen als Bewegung buchen
      IF position('fuellung_bewegungen' IN v_neu) = 0 THEN
        SELECT count(*) INTO v_n FROM regexp_matches(v_neu, c_best_re, 'g');
        IF v_n <> 2 THEN
          RAISE EXCEPTION 'KAN-35/M10: In % wurden % direkte Bestands-Überschreibungen gefunden (erwartet genau 2)', v_fn, v_n;
        END IF;
        v_neu := regexp_replace(v_neu, c_best_re, c_best_neu, 'g');
      END IF;
    END IF;

    IF v_neu <> v_def THEN
      EXECUTE v_neu;
    END IF;
  END LOOP;
END $m10$;

REVOKE EXECUTE ON FUNCTION public.demo_musterhof_zuruecksetzen() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.demo_musterhof_zuruecksetzen() TO service_role;
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_y2_kette()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.demo_musterhof_y2_kette()      TO service_role;


-- ─── M11 Datenkorrektur Frist-Link ──────────────────────────────────────────
-- Vorlage (vorlage.ts) heißt „Bestandsmeldung Wein“, der Demo-Reset „Bestandsmeldung Wein
-- (Stichtag 31.07.)“ → LIKE statt Gleichheit (Stand 24.09.2026: 1 Zeile, Demo, erledigt).
-- vorlage.ts und fristErledigen legen bis zum App-Deploy weiter '/reports/keller' an →
-- dasselbe UPDATE in der Folge-Migration wiederholen.
UPDATE public.fristen
   SET href = '/reports/ama', aktualisiert_am = now()
 WHERE href = '/reports/keller'
   AND bezeichnung LIKE 'Bestandsmeldung Wein%';


-- ─── M12 Kommentare ─────────────────────────────────────────────────────────
COMMENT ON TABLE public.bestandsprotokoll IS
  'KAN-35 (Übergang bis AP3): lückenloses Protokoll aller Löschungen und bestandsrelevanten Änderungen an Kellerbuch-, Lese- und Verkaufstabellen. Wird ausschließlich vom Trigger bestandsprotokoll_schreiben() befüllt (auch Service-Role und FK-Kaskaden; TRUNCATE ist gesperrt). Unveränderlich; lesbar für Betriebsleiter des Mandanten und Plattform-Admins. tenant_id ohne FK, damit Mandanten-Kaskaden nie scheitern. Löschkonzept: Zeilen eines gelöschten Mandanten nach Ablauf der Aufbewahrungsfrist über bestandsprotokoll_mandant_loeschen() (nur Service-Role) entfernen; Demo-Mandant wird beim Demo-Reset geleert.';
COMMENT ON COLUMN public.bestandsprotokoll.tenant_id IS
  'Mandant der Zeile; bei Tabellen ohne tenant_id über Elternzeile, Protokollzeile der Eltern-Löschung (Kaskade) oder noch vorhandene Verweise. NULL nur, wenn nichts davon auflösbar ist (sichtbar nur für Plattform-Admins).';
COMMENT ON COLUMN public.bestandsprotokoll.alt IS
  'DELETE: vollständige gelöschte Zeile (ohne rechnung_versendet_an). UPDATE: nur die geänderten überwachten Spalten (alte Werte).';
COMMENT ON COLUMN public.bestandsprotokoll.neu IS
  'UPDATE: nur die geänderten überwachten Spalten (neue Werte); bei DELETE NULL.';
COMMENT ON COLUMN public.bestandsprotokoll.db_rolle IS
  'API-Rolle aus dem GUC role (authenticated, anon, service_role), sonst der Sitzungsbenutzer (postgres = SQL-Editor, pg_cron, Migration).';
COMMENT ON COLUMN public.bestandsprotokoll.benutzer_id IS
  'auth.uid() des angemeldeten Benutzers; NULL bei Service-Role und direkten DB-Sitzungen.';

COMMENT ON FUNCTION public.bestandsprotokoll_schreiben() IS
  'KAN-35 (Übergang bis AP3): AFTER-DELETE/UPDATE-Trigger (z_protokoll_*), schreibt nach bestandsprotokoll; BEFORE TRUNCATE → Fehler. Trigger-Argumente = überwachte Spalten. Bypass nur für Zeilen des Demo-Mandanten, wenn s112.protokoll_aus = dessen UUID und die Rolle nicht authenticated/anon ist (Demo-Reset).';

COMMENT ON FUNCTION public.bestandsprotokoll_mandant_loeschen(uuid) IS
  'KAN-35: entfernt das Bestandsprotokoll eines Mandanten, der in tenants nicht mehr existiert (DSGVO-Löschweg nach Vertragsende und Ablauf der Aufbewahrungsfrist). Nur Service-Role/SQL-Editor. Rückgabe: Anzahl gelöschter Zeilen.';

COMMENT ON TABLE public.fuellung_bewegungen IS
  'KAN-35 (Übergang bis AP3): append-only Flaschenbewegungen außerhalb von Verkauf/Storno (Inventur, Bruch, Eigenverbrauch, Schwund, Korrektur, Anfangsbestand) mit Datum, Menge ± Stück und Bestand vorher/nachher. Schreiben nur über fuellung_bestand_buchen() (bzw. Demo-Reset). Identität: bestand_flaschen = anzahl_flaschen − Σ nicht stornierte Flaschenverkäufe + Σ menge_stk (Stand 24.09.2026 in allen Mandanten erfüllt bzw. ab dem nächsten Demo-Reset).';

COMMENT ON FUNCTION public.fuellung_bestand_buchen(uuid, uuid, text, date, integer, integer, text) IS
  'KAN-35 (Übergang bis AP3): bucht eine datierte Flaschenbewegung und setzt fuellungen.bestand_flaschen atomar (Füllung gesperrt). Inventur: p_ist_bestand (Delta wird berechnet); sonst p_menge_stk (bei bruch/eigenverbrauch/schwund negativ). Aufruf mit Parameternamen über den Benutzer-Client. Rückgabe: neuer Bestand.';

COMMENT ON FUNCTION public.schwund_buchen(uuid, uuid, numeric, date, text, boolean, boolean) IS
  'KAN-35 (Übergang bis AP3): bucht Liter-Schwund einer Charge als datierte keller_umzuege-Zeile (umzug_typ schwund, menge_liter 0, brutto = schwund = Liter). p_bestand_mindern (Standard): senkt weinausbau.menge_liter atomar, Rest ≤ 0,01 L wird mit ausgebucht und die Charge abgeschlossen; p_abschliessen verlangt Rest ≤ 0,01 L. p_bestand_mindern = false: nur Nachbuchung ins Bewegungsbuch des Gebindes (auch für abgeschlossene Chargen). Rückgabe: id der keller_umzuege-Zeile.';


-- ============================================================================
-- FOLGE-MIGRATION (NICHT hier ausführen) – erst NACH dem App-Deploy, der
-- /api/verkauf-stammdaten, das Verkaufsformular und createVerkauf auf „Tank nur aus
-- Charge“ umstellt und vorlage.ts auf '/reports/ama' ändert. Name z. B.
-- kan35_nur_charge:
--
--   DO $g$ BEGIN
--     IF EXISTS (SELECT 1 FROM public.verkauf_positionen
--                 WHERE zukauf_id IS NOT NULL OR pressung_behaelter_id IS NOT NULL) THEN
--       RAISE EXCEPTION 'KAN-35: Verkaufspositionen mit Zukauf-/Pressungsbezug vorhanden – zuerst rekonstruieren (Bereich A)';
--     END IF;
--   END $g$;
--   ALTER TABLE public.verkauf_positionen ADD CONSTRAINT verkauf_positionen_nur_charge_check
--     CHECK (zukauf_id IS NULL AND pressung_behaelter_id IS NULL);
--   UPDATE public.fristen SET href = '/reports/ama', aktualisiert_am = now()
--    WHERE href = '/reports/keller' AND bezeichnung LIKE 'Bestandsmeldung Wein%';
-- ============================================================================
