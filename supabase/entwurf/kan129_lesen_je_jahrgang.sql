-- KAN-129 (29.09.2026): Lesen je Jahrgang mit laufender Nummer (2026/1, 2026/2 …)
--
-- Entscheidung Jörgen 26.09./29.09.2026: Der Jahrgang bleibt einmal je Betrieb (UNIQUE tenant_id, jahrgang).
-- Darunter beliebig viele Lesen (Klammer der Lesekampagne) mit eigener lfd. Nr., Art, Beginn und Ende –
-- z. B. 2026/1 Hauptlese, 2026/2 Eiswein im Jänner 2027. Lese-Einträge (ernte_parzellen) und Pressungen
-- hängen an genau einer Lese, Traubenverkäufe optional (Zukauf-Trauben nie). jahrgang_id bleibt überall.
--
-- Übergang: Jeder bestehende Jahrgang bekommt Lese 1 (Beginn/Ende aus ernte_beginn/ernte_ende), alle
-- vorhandenen Zeilen werden ihr zugeordnet. Ein neuer Jahrgang bekommt Lese 1 per Trigger. Setzt die (alte)
-- App keine lese_id, ordnet der Trigger a_lese_zuordnen zu: eine Lese → diese; mehrere → die Lese mit dem
-- spätesten Beginn ≤ Datum der Zeile; sonst Fehler 23502 mit HINT 'lese_waehlen'. So bleibt die alte App
-- lauffähig und die Migration darf vor dem App-Deploy kommen.
--
-- Die lfd. Nr. vergibt immer der Trigger (Sperre auf die Jahrgangszeile, max + 1); Nummer, Jahrgang und
-- Betrieb einer Lese sind unveränderlich. Gelöscht wird nur die höchste, nie die einzige Lese; Lesen mit
-- Einträgen, Pressungen oder Traubenverkäufen verhindert der FK (23503). Kaskaden (Jahrgang, Betrieb) laufen.
-- Rechte wie weinjahrgaenge (Rolle, Modul rieden/kellerbuch, Abo-Sperre, Mitgliedschaft, Zwei-Faktor).
-- Keine RPC. Staging zuerst.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── 1. Tabelle ─────────────────────────────────────────────────────────────
ALTER TABLE public.weinjahrgaenge ADD CONSTRAINT weinjahrgaenge_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE public.lesen (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL,
  jahrgang_id uuid NOT NULL,
  lfd_nr      integer NOT NULL,
  art         text NOT NULL DEFAULT 'hauptlese',
  bezeichnung text,
  beginn      date,
  ende        date,
  notizen     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesen_jahrgang_fkey FOREIGN KEY (jahrgang_id, tenant_id)
    REFERENCES public.weinjahrgaenge (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT lesen_jahrgang_lfd_nr_key UNIQUE (jahrgang_id, lfd_nr),
  CONSTRAINT lesen_id_jahrgang_key UNIQUE (id, jahrgang_id),
  CONSTRAINT lesen_id_jahrgang_tenant_key UNIQUE (id, jahrgang_id, tenant_id),
  CONSTRAINT lesen_lfd_nr_check CHECK (lfd_nr BETWEEN 1 AND 99),
  CONSTRAINT lesen_zeitraum_check CHECK (ende >= beginn),
  CONSTRAINT lesen_art_check CHECK (art IN ('hauptlese', 'vorlese', 'nachlese', 'eiswein', 'sonstige'))
);
CREATE INDEX lesen_tenant_id_idx ON public.lesen (tenant_id);
CREATE INDEX lesen_jahrgang_tenant_idx ON public.lesen (jahrgang_id, tenant_id);
COMMENT ON TABLE public.lesen IS
  'KAN-129: Lesen (Lesekampagnen) je Jahrgang mit laufender Nummer (2026/1 Hauptlese, 2026/2 Eiswein …). '
  'lfd_nr vergibt der Trigger a_lesen_vor_schreiben; Einträge, Pressungen und Traubenverkäufe hängen über lese_id daran.';

-- ─── 2. Trigger der Tabelle ─────────────────────────────────────────────────
CREATE FUNCTION public.lesen_vor_schreiben() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Nummern je Jahrgang lückenlos in Erfassungsreihenfolge; die Sperre verhindert doppelte Nummern
    PERFORM 1 FROM weinjahrgaenge WHERE id = NEW.jahrgang_id FOR NO KEY UPDATE;
    SELECT COALESCE(max(lfd_nr), 0) + 1 INTO NEW.lfd_nr FROM lesen WHERE jahrgang_id = NEW.jahrgang_id;
    RETURN NEW;
  END IF;
  IF NEW.lfd_nr IS DISTINCT FROM OLD.lfd_nr OR NEW.jahrgang_id IS DISTINCT FROM OLD.jahrgang_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Nummer, Jahrgang und Betrieb einer Lese lassen sich nicht ändern.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.lesen_vor_schreiben() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.lesen_vor_loeschen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_anzahl int;
  v_max    int;
BEGIN
  -- Kaskade (Jahrgang bzw. Betrieb wird gelöscht): der Jahrgang ist dann nicht mehr sichtbar → erlaubt
  IF NOT EXISTS (SELECT 1 FROM weinjahrgaenge WHERE id = OLD.jahrgang_id) THEN
    RETURN OLD;
  END IF;
  SELECT count(*), max(lfd_nr) INTO v_anzahl, v_max FROM lesen WHERE jahrgang_id = OLD.jahrgang_id;
  IF v_anzahl <= 1 THEN
    RAISE EXCEPTION 'Die einzige Lese eines Jahrgangs kann nicht gelöscht werden.' USING ERRCODE = '42501';
  END IF;
  IF OLD.lfd_nr < v_max THEN
    RAISE EXCEPTION 'Nur die Lese mit der höchsten Nummer (%) kann gelöscht werden.', v_max USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $f$;
REVOKE EXECUTE ON FUNCTION public.lesen_vor_loeschen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_lesen_vor_schreiben BEFORE INSERT OR UPDATE ON public.lesen
  FOR EACH ROW EXECUTE FUNCTION public.lesen_vor_schreiben();
CREATE TRIGGER a_lesen_vor_loeschen BEFORE DELETE ON public.lesen
  FOR EACH ROW EXECUTE FUNCTION public.lesen_vor_loeschen();
CREATE TRIGGER lesen_updated_at BEFORE UPDATE ON public.lesen
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── 3. Spalten und Übernahme der bestehenden Daten ─────────────────────────
ALTER TABLE public.ernte_parzellen ADD COLUMN lese_id uuid;
ALTER TABLE public.pressungen      ADD COLUMN lese_id uuid;
ALTER TABLE public.traubenverkauf  ADD COLUMN lese_id uuid;

INSERT INTO public.lesen (tenant_id, jahrgang_id, beginn, ende)
  SELECT tenant_id, id, ernte_beginn, CASE WHEN ernte_ende >= ernte_beginn OR ernte_beginn IS NULL THEN ernte_ende END
    FROM public.weinjahrgaenge;

UPDATE public.ernte_parzellen e SET lese_id = l.id FROM public.lesen l WHERE l.jahrgang_id = e.jahrgang_id;
UPDATE public.pressungen p      SET lese_id = l.id FROM public.lesen l WHERE l.jahrgang_id = p.jahrgang_id;
UPDATE public.traubenverkauf t  SET lese_id = l.id FROM public.lesen l
 WHERE l.jahrgang_id = t.jahrgang_id AND t.zukauf_posten_id IS NULL;

-- ─── 4. Neuer Jahrgang → Lese 1 ─────────────────────────────────────────────
-- Läuft nach der RLS-Prüfung des Jahrgangs (inkl. Abo-Sperre); übernimmt im Übergang ernte_beginn/ernte_ende
CREATE FUNCTION public.weinjahrgang_erste_lese() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  INSERT INTO lesen (tenant_id, jahrgang_id, beginn, ende)
  VALUES (NEW.tenant_id, NEW.id, NEW.ernte_beginn,
          CASE WHEN NEW.ernte_ende >= NEW.ernte_beginn OR NEW.ernte_beginn IS NULL THEN NEW.ernte_ende END);
  RETURN NULL;
END $f$;
REVOKE EXECUTE ON FUNCTION public.weinjahrgang_erste_lese() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_erste_lese AFTER INSERT ON public.weinjahrgaenge
  FOR EACH ROW EXECUTE FUNCTION public.weinjahrgang_erste_lese();

-- ─── 5. Pflicht, Fremdschlüssel, Indizes ────────────────────────────────────
ALTER TABLE public.ernte_parzellen ALTER COLUMN lese_id SET NOT NULL,
  ADD CONSTRAINT ernte_parzellen_lese_fkey FOREIGN KEY (lese_id, jahrgang_id) REFERENCES public.lesen (id, jahrgang_id);
ALTER TABLE public.pressungen ALTER COLUMN lese_id SET NOT NULL,
  ADD CONSTRAINT pressungen_lese_fkey FOREIGN KEY (lese_id, jahrgang_id, tenant_id)
    REFERENCES public.lesen (id, jahrgang_id, tenant_id);
ALTER TABLE public.traubenverkauf
  ADD CONSTRAINT traubenverkauf_lese_fkey FOREIGN KEY (lese_id, jahrgang_id, tenant_id)
    REFERENCES public.lesen (id, jahrgang_id, tenant_id),
  ADD CONSTRAINT traubenverkauf_lese_jahrgang_check CHECK (lese_id IS NULL OR jahrgang_id IS NOT NULL),
  ADD CONSTRAINT traubenverkauf_lese_zukauf_check CHECK (zukauf_posten_id IS NULL OR lese_id IS NULL);
CREATE INDEX ernte_parzellen_lese_idx ON public.ernte_parzellen (lese_id, jahrgang_id);
CREATE INDEX pressungen_lese_idx      ON public.pressungen (lese_id, jahrgang_id, tenant_id);
CREATE INDEX traubenverkauf_lese_idx  ON public.traubenverkauf (lese_id, jahrgang_id, tenant_id);

-- ─── 6. Automatische Zuordnung (Übergang, alte App) ─────────────────────────
-- TG_ARGV[0]: Datumsspalte der Zeile ('ernte_datum' bzw. 'datum')
CREATE FUNCTION public.lese_zuordnen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_datum  date;
  v_jahr   int;
  v_anzahl int;
  v_lese   uuid;
BEGIN
  IF NEW.jahrgang_id IS NULL THEN NEW.lese_id := NULL; RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'traubenverkauf' AND (to_jsonb(NEW) ->> 'zukauf_posten_id') IS NOT NULL THEN
    NEW.lese_id := NULL; RETURN NEW;
  END IF;
  -- Jahrgangswechsel ohne neue Lese: neu zuordnen
  IF TG_OP = 'UPDATE' AND NEW.jahrgang_id IS DISTINCT FROM OLD.jahrgang_id AND NEW.lese_id IS NOT DISTINCT FROM OLD.lese_id THEN
    NEW.lese_id := NULL;
  END IF;
  IF NEW.lese_id IS NOT NULL THEN RETURN NEW; END IF;   -- gesetzte Lese prüft der Fremdschlüssel

  SELECT count(*) INTO v_anzahl FROM lesen WHERE jahrgang_id = NEW.jahrgang_id;
  IF v_anzahl = 1 THEN
    SELECT id INTO NEW.lese_id FROM lesen WHERE jahrgang_id = NEW.jahrgang_id;
    RETURN NEW;
  END IF;
  v_datum := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::date;
  SELECT jahrgang INTO v_jahr FROM weinjahrgaenge WHERE id = NEW.jahrgang_id;
  IF v_datum IS NOT NULL THEN
    SELECT id INTO v_lese FROM lesen
     WHERE jahrgang_id = NEW.jahrgang_id AND COALESCE(beginn, make_date(v_jahr, 1, 1)) <= v_datum
     ORDER BY COALESCE(beginn, make_date(v_jahr, 1, 1)) DESC, lfd_nr DESC LIMIT 1;
  END IF;
  IF v_lese IS NULL THEN
    RAISE EXCEPTION 'Der Jahrgang hat mehrere Lesen – bitte die Lese wählen.'
      USING ERRCODE = '23502', HINT = 'lese_waehlen';
  END IF;
  NEW.lese_id := v_lese;
  RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.lese_zuordnen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_lese_zuordnen BEFORE INSERT OR UPDATE OF jahrgang_id, lese_id ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.lese_zuordnen('ernte_datum');
CREATE TRIGGER a_lese_zuordnen BEFORE INSERT OR UPDATE OF jahrgang_id, lese_id ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.lese_zuordnen('datum');
CREATE TRIGGER a_lese_zuordnen BEFORE INSERT OR UPDATE OF jahrgang_id, lese_id, zukauf_posten_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.lese_zuordnen('datum');

-- ─── 7. Änderungsprotokoll (Muster kan35_datenintegritaet; Spaltenlisten aus pg_trigger ergänzen) ─────
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.lesen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.lesen
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF beginn, ende, art, lfd_nr, jahrgang_id, tenant_id ON public.lesen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('beginn', 'ende', 'art', 'lfd_nr', 'jahrgang_id', 'tenant_id');

DO $protokoll$
DECLARE
  r_tab     record;
  v_args    text[];
  v_update  text[];
  v_spalten text[];
BEGIN
  FOR r_tab IN SELECT * FROM (VALUES ('ernte_parzellen'::text), ('pressungen'), ('traubenverkauf')) AS t(tabelle) LOOP
    SELECT array_remove(string_to_array(encode(tg.tgargs, 'escape'), '\000'), ''),
           ARRAY(SELECT a.attname::text FROM unnest(tg.tgattr::int2[]) WITH ORDINALITY AS u(attnum, nr)
                   JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = u.attnum ORDER BY u.nr)
      INTO v_args, v_update
      FROM pg_trigger tg
     WHERE tg.tgrelid = format('public.%I', r_tab.tabelle)::regclass AND tg.tgname = 'z_protokoll_aendern';
    IF v_args IS NULL OR cardinality(v_args) = 0 THEN
      RAISE EXCEPTION 'KAN-129: z_protokoll_aendern auf % fehlt oder hat keine Spalten', r_tab.tabelle;
    END IF;
    IF v_update IS DISTINCT FROM v_args THEN
      RAISE EXCEPTION 'KAN-129: z_protokoll_aendern auf %: UPDATE OF (%) ≠ Argumente (%)',
        r_tab.tabelle, array_to_string(v_update, ', '), array_to_string(v_args, ', ');
    END IF;
    CONTINUE WHEN 'lese_id' = ANY (v_args);
    v_spalten := v_args || ARRAY['lese_id'];
    EXECUTE format('DROP TRIGGER z_protokoll_aendern ON public.%I', r_tab.tabelle);
    EXECUTE format('CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF %s ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben(%s)',
                   (SELECT string_agg(format('%I', s), ', ' ORDER BY nr) FROM unnest(v_spalten) WITH ORDINALITY AS n(s, nr)),
                   r_tab.tabelle,
                   (SELECT string_agg(quote_literal(s), ', ' ORDER BY nr) FROM unnest(v_spalten) WITH ORDINALITY AS n(s, nr)));
  END LOOP;
END $protokoll$;

-- ─── 8. Rechte und RLS (wie weinjahrgaenge) ─────────────────────────────────
ALTER TABLE public.lesen ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesen TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.lesen TO service_role;
REVOKE TRUNCATE ON public.lesen FROM anon, authenticated;

CREATE POLICY "lesen: members can select" ON public.lesen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids() AS get_user_tenant_ids));
CREATE POLICY "lesen: winzer+ can insert" ON public.lesen FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (SELECT auth.uid() AS uid) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])));
CREATE POLICY "lesen: winzer+ can update" ON public.lesen FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (SELECT auth.uid() AS uid) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])));
CREATE POLICY "lesen: admin can delete" ON public.lesen FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (SELECT auth.uid() AS uid) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin'])));
CREATE POLICY mitgliedschaft_aktiv ON public.lesen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT s112_gesperrte_tenants() AS s112_gesperrte_tenants)))
  WITH CHECK (NOT (tenant_id IN (SELECT s112_gesperrte_tenants() AS s112_gesperrte_tenants)));
CREATE POLICY zwei_faktor_aal ON public.lesen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT s112_aal_ok() AS s112_aal_ok)) WITH CHECK ((SELECT s112_aal_ok() AS s112_aal_ok));
CREATE POLICY abo_schreibsperre_ins ON public.lesen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT s112_schreibgesperrte_tenants() AS s112_schreibgesperrte_tenants)));
CREATE POLICY abo_schreibsperre_upd ON public.lesen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT s112_schreibgesperrte_tenants() AS s112_schreibgesperrte_tenants)))
  WITH CHECK (NOT (tenant_id IN (SELECT s112_schreibgesperrte_tenants() AS s112_schreibgesperrte_tenants)));
CREATE POLICY abo_schreibsperre_del ON public.lesen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT s112_schreibgesperrte_tenants() AS s112_schreibgesperrte_tenants)));
CREATE POLICY modul_insert ON public.lesen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'kellerbuch']));
CREATE POLICY modul_update ON public.lesen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'kellerbuch']))
  WITH CHECK (s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'kellerbuch']));
CREATE POLICY modul_delete ON public.lesen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'kellerbuch']));

-- ─── 9. KI-Abfragen dürfen lesen lesen ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ki_erlaubte_tabellen()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Bewusst nicht enthalten u. a.: tenants, tenant_memberships, tenant_einstellungen,
  -- profiles, plattform_admins, user_email_connections, bestandsprotokoll, sumup_*,
  -- assistent_*.
  SELECT ARRAY[
    -- Rieden / Weingärten
    'weingarten', 'grundstuecke', 'rebsorten', 'weingarten_rebsorten', 'lagen', 'weinbaugebiete_custom',
    -- Behandlungen / Pflanzenschutz / Düngung
    'behandlungen', 'behandlung_grundstuecke', 'saetze_massnahmen', 'pflanzenschutzmittel',
    'duengemittel', 'duengemittel_lager_bewegungen', 'psm_lager_bewegungen',
    -- Ernte / Jahrgänge (KAN-129: lesen)
    'ernte_parzellen', 'weinjahrgaenge', 'lesen', 'ama_erntemeldungen', 'ama_meldepositionen',
    -- Kellerbuch / Weinausbau
    'weinausbau', 'weinausbau_weingaerten', 'pressungen', 'pressung_behaelter', 'pressung_weingaerten',
    'keller_umzuege', 'keller_behandlungen', 'keller_behandlungstypen', 'weinanalysen',
    'verschneidungen', 'verschneidung_quellen', 'behaelter', 'kellerplaene', 'kellerplan_positionen',
    'dac_antrag', 'pruefnummernantraege', 'transportbescheinigungen',
    -- Füllungen / Lager
    'fuellungen', 'fuellung_chargen', 'fuellung_bewegungen',
    -- CRM
    'kontakte', 'firmen', 'kontakt_firmen', 'kontakt_praeferenzen', 'aktivitaeten',
    'aktivitaet_dokumente', 'pipeline_eintraege', 'pipeline_verlauf', 'rabattgruppen',
    -- Verkauf
    'verkaufsposten', 'verkauf_positionen', 'sonstige_artikel',
    'bestellungen', 'bestellung_positionen',
    -- Einkauf
    'zukauf_posten', 'traubenverkauf',
    -- Export
    'exportauftraege', 'exportauftrag_positionen', 'export_dokumente',
    -- Controlling
    'kostenstellen', 'kostenarten', 'kosteneintraege', 'kosteneintrag_behaelter', 'kosteneintrag_weingaerten',
    -- Buchhaltung
    'ea_transaktionen', 'ea_kategorien', 'ea_dauerauftraege', 'ea_uva', 'zahlungen',
    -- Sonstiges
    'zeiterfassung', 'release_notes'
  ]::text[]
$function$;

-- ─── 10. Selbstprüfung ──────────────────────────────────────────────────────
DO $pruefung$
DECLARE
  v_jg int; v_lesen int; v_ep int; v_pr int; v_tv_ohne int; v_pol int;
BEGIN
  SELECT count(*) INTO v_jg FROM weinjahrgaenge;
  SELECT count(*) INTO v_lesen FROM lesen;
  IF v_lesen <> v_jg THEN RAISE EXCEPTION 'KAN-129: % Lesen für % Jahrgänge', v_lesen, v_jg; END IF;
  IF EXISTS (SELECT 1 FROM lesen WHERE lfd_nr <> 1) THEN RAISE EXCEPTION 'KAN-129: Lese ohne Nr. 1'; END IF;
  SELECT count(*) INTO v_ep FROM ernte_parzellen;
  SELECT count(*) INTO v_pr FROM pressungen;
  SELECT count(*) INTO v_tv_ohne FROM traubenverkauf WHERE jahrgang_id IS NOT NULL AND zukauf_posten_id IS NULL AND lese_id IS NULL;
  IF v_tv_ohne > 0 THEN RAISE EXCEPTION 'KAN-129: % Traubenverkäufe ohne Lese', v_tv_ohne; END IF;
  SELECT count(*) INTO v_pol FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesen';
  IF v_pol <> 12 THEN RAISE EXCEPTION 'KAN-129: % Policies auf lesen (erwartet 12)', v_pol; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesen' AND roles <> '{authenticated}') THEN
    RAISE EXCEPTION 'KAN-129: Policy auf lesen nicht TO authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.lesen', 'TRUNCATE') OR has_table_privilege('authenticated', 'public.lesen', 'TRUNCATE') THEN
    RAISE EXCEPTION 'KAN-129: TRUNCATE-Recht auf lesen';
  END IF;
  RAISE NOTICE 'KAN-129: % Jahrgänge → % Lesen, % Lese-Einträge und % Pressungen zugeordnet', v_jg, v_lesen, v_ep, v_pr;
END $pruefung$;
