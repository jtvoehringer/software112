-- KAN-192 Etappe A (Entwurf 03.10.2026, Entscheidungen Jörgen 03.10.2026): Kellerbuch-Abschluss (Periodensperre),
-- Chargennummer für Chargen, Genealogie charge_herkunft als Sicht über das Bewegungsjournal.
--
--  1. Chargennummer (R5 aus der BKI-Sitzung 24.09.2026): weinausbau.chargennummer, eigener Nummernkreis je Betrieb
--     (tenant_einstellungen.weinausbau_prefix/_stellen/_zaehler, Format WA-JJJJ-nnn wie die Füllungs-Lose CH-JJJJ-nnn).
--     Vergabe automatisch beim Anlegen (Trigger a_chargennummer, SECURITY DEFINER wegen des Plattformfelder-Schutzes an
--     tenant_einstellungen); bestehende Chargen werden nach Anlagezeitpunkt nachnummeriert. Einmal vergeben unveränderlich.
--  2. Periodensperre: kellerbuch_abschluesse (je Abschluss eine Zeile, wirksam ist das späteste abgeschlossen_bis).
--     Abschluss nur über kellerbuch_abschliessen (Betriebsleitung: system_admin/tenant_admin), unwiderruflich, höchstens bis
--     gestern (Gegenbuchungen von Stornos landen am Storno-Tag und damit immer im offenen Zeitraum).
--     Trigger a_periodensperre (BEFORE) an den Bewegungstabellen lehnt ab (42501): Anlegen mit Datum ≤ Abschluss, Löschen
--     einer Zeile mit Datum ≤ Abschluss, Ändern einer mengenrelevanten Spalte (TG_ARGV[1], wie die Journal-Trigger) einer
--     Zeile, deren altes oder neues Datum ≤ Abschluss liegt. Storno-Felder, Notizen, Bestandszähler usw. bleiben frei.
--     Kindtabellen (pressung_behaelter, verschneidung_quellen, verkauf_positionen) prüfen das Datum des Kopfes.
--     Verkäufe nur mit Tank-/Flaschenpositionen. Wartung (s112_wartung_frei: Mandanten-Löschung, Pilotabschluss, Demo-Reset) frei.
--     journal_abgleichen bucht Korrekturen frühestens am Tag nach dem Abschluss.
--  3. charge_herkunft: Sicht (security_invoker) über kellerbuch_buchungen – Kanten Quell-Charge → Ziel-Charge bzw. Füllung
--     je Beleg (Umzug/Filtration auch n:m im Batch, Verschnitt, Füllung; Liter anteilig nach den Abgängen des Belegs) und
--     Wurzeln (Ernte, Zukauf, Eröffnung, Inventur-Mehrmenge) ohne Quell-Charge. Gegenbuchungen mit negativem Vorzeichen (gegenbuchung = true).
--     Die Mischungsrechnung (KAN-76) liest sie in Etappe B.
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

-- 1. Chargennummer ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN weinausbau_prefix  text    NOT NULL DEFAULT 'WA' CHECK (weinausbau_prefix ~ '^[A-Za-z0-9]{1,10}$'),
  ADD COLUMN weinausbau_stellen integer NOT NULL DEFAULT 3 CHECK (weinausbau_stellen BETWEEN 1 AND 8),
  ADD COLUMN weinausbau_zaehler integer NOT NULL DEFAULT 1 CHECK (weinausbau_zaehler > 0);
COMMENT ON COLUMN public.tenant_einstellungen.weinausbau_prefix IS 'KAN-192: Nummernkreis Chargennummer (weinausbau.chargennummer), Format PREFIX-JJJJ-nnn';
GRANT SELECT (weinausbau_prefix, weinausbau_stellen, weinausbau_zaehler) ON public.tenant_einstellungen TO authenticated, anon;

ALTER TABLE public.weinausbau ADD COLUMN chargennummer text;
COMMENT ON COLUMN public.weinausbau.chargennummer IS 'KAN-192: Chargennummer (Los) der Charge, automatisch vergeben, unveränderlich';
CREATE UNIQUE INDEX weinausbau_chargennummer_key ON public.weinausbau (tenant_id, chargennummer) WHERE chargennummer IS NOT NULL;

-- Nächste Nummer (intern, SECURITY DEFINER: schreibt tenant_einstellungen am Plattformfelder-Schutz vorbei)
CREATE OR REPLACE FUNCTION public.s112_naechste_weinausbau_nummer(p_tenant_id uuid, p_zeit timestamptz)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix  text;
  v_stellen integer;
  v_zaehler integer;
BEGIN
  UPDATE public.tenant_einstellungen SET weinausbau_zaehler = weinausbau_zaehler + 1
   WHERE tenant_id = p_tenant_id
   RETURNING weinausbau_prefix, weinausbau_stellen, weinausbau_zaehler - 1 INTO v_prefix, v_stellen, v_zaehler;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_prefix || '-' || to_char(coalesce(p_zeit, now()) AT TIME ZONE 'Europe/Vienna', 'YYYY') || '-' || lpad(v_zaehler::text, v_stellen, '0');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_naechste_weinausbau_nummer(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_chargennummer_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.chargennummer IS NULL THEN
      NEW.chargennummer := public.s112_naechste_weinausbau_nummer(NEW.tenant_id, NEW.created_at);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.chargennummer IS NOT NULL AND NEW.chargennummer IS DISTINCT FROM OLD.chargennummer AND NOT coalesce(public.s112_wartung_frei(NEW.tenant_id), false) THEN
    RAISE EXCEPTION 'Die Chargennummer % ist vergeben und lässt sich nicht ändern.', OLD.chargennummer USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_chargennummer_trg() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_chargennummer BEFORE INSERT OR UPDATE OF chargennummer ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_chargennummer_trg();

-- Bestand nachnummerieren (je Betrieb nach Anlagezeitpunkt)
DO $nachnummerieren$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT w.id, w.tenant_id, w.created_at FROM public.weinausbau w
            WHERE w.chargennummer IS NULL ORDER BY w.tenant_id, w.created_at, w.id LOOP
    UPDATE public.weinausbau SET chargennummer = public.s112_naechste_weinausbau_nummer(r.tenant_id, r.created_at) WHERE id = r.id;
  END LOOP;
END $nachnummerieren$;

-- 2. Periodensperre ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.kellerbuch_abschluesse (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  abgeschlossen_bis date NOT NULL,
  abgeschlossen_am  timestamptz NOT NULL DEFAULT now(),
  abgeschlossen_von uuid,
  bemerkung         text CHECK (bemerkung IS NULL OR length(bemerkung) <= 500),
  CONSTRAINT kellerbuch_abschluesse_bis_key UNIQUE (tenant_id, abgeschlossen_bis)
);
COMMENT ON TABLE public.kellerbuch_abschluesse IS
  'KAN-192: Kellerbuch-Abschlüsse (Periodensperre); wirksam ist das späteste abgeschlossen_bis. Nur über kellerbuch_abschliessen, unwiderruflich.';

CREATE OR REPLACE FUNCTION public.s112_kellerbuch_abschluss_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Kellerbuch-Abschlüsse werden nie geleert (KAN-192).' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('s112.kb_abschluss', true), '') <> 'an' AND NOT coalesce(public.s112_wartung_frei(NEW.tenant_id), false)
       AND COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Abschließen nur über kellerbuch_abschliessen (KAN-192).' USING ERRCODE = '42501';
    END IF;
    NEW.abgeschlossen_am := now();
    NEW.abgeschlossen_von := coalesce(NEW.abgeschlossen_von, auth.uid());
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(public.s112_wartung_frei(OLD.tenant_id), false) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Ein Kellerbuch-Abschluss ist unwiderruflich (KAN-192).' USING ERRCODE = '42501';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kellerbuch_abschluss_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_abschluss_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.kellerbuch_abschluesse
  FOR EACH ROW EXECUTE FUNCTION public.s112_kellerbuch_abschluss_schutz();
CREATE TRIGGER a_abschluss_schutz_truncate BEFORE TRUNCATE ON public.kellerbuch_abschluesse
  FOR EACH STATEMENT EXECUTE FUNCTION public.s112_kellerbuch_abschluss_schutz();

ALTER TABLE public.kellerbuch_abschluesse ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.kellerbuch_abschluesse FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kellerbuch_abschluesse FROM anon;
CREATE POLICY abschluss_select ON public.kellerbuch_abschluesse FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.kellerbuch_abschluesse AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.kellerbuch_abschluesse AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.kellerbuch_abschluesse AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.kellerbuch_abschluesse AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.kellerbuch_abschluesse AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY ki_aktiver_betrieb ON public.kellerbuch_abschluesse AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((SELECT NULLIF(current_setting('app.active_tenant_id', true), '')) IS NULL) OR (tenant_id IS NULL)
         OR (tenant_id = (SELECT NULLIF(current_setting('app.active_tenant_id', true), '')::uuid)));

-- Wirksamer Abschluss (NULL = offen)
CREATE OR REPLACE FUNCTION public.s112_kellerbuch_gesperrt_bis(p_tenant_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT max(a.abgeschlossen_bis) FROM public.kellerbuch_abschluesse a WHERE a.tenant_id = p_tenant_id
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kellerbuch_gesperrt_bis(uuid) FROM PUBLIC, anon, authenticated;

-- Abschließen (Betriebsleitung)
CREATE OR REPLACE FUNCTION public.kellerbuch_abschliessen(p_tenant_id uuid, p_bis date, p_bemerkung text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vorher date;
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF p_bis IS NULL OR p_bis >= v_heute THEN
    RAISE EXCEPTION 'Abschließen ist höchstens bis gestern (%) möglich.', to_char(v_heute - 1, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_kb_abschluss:' || p_tenant_id::text, 0));
  v_vorher := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_vorher IS NOT NULL AND p_bis <= v_vorher THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bereits bis % abgeschlossen.', to_char(v_vorher, 'DD.MM.YYYY') USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('s112.kb_abschluss', 'an', true);
  INSERT INTO public.kellerbuch_abschluesse (tenant_id, abgeschlossen_bis, bemerkung)
  VALUES (p_tenant_id, p_bis, NULLIF(btrim(coalesce(p_bemerkung, '')), ''));
  PERFORM set_config('s112.kb_abschluss', '', true);
  RETURN jsonb_build_object('abgeschlossen_bis', p_bis, 'vorher', v_vorher);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.kellerbuch_abschliessen(uuid, date, text) FROM PUBLIC, anon;

-- Sperr-Trigger an den Bewegungstabellen. TG_ARGV[0]: Datumsquelle ('datum' oder 'kopf:<tabelle>:<fk-spalte>'),
-- TG_ARGV[1]: mengenrelevante Spalten (kommagetrennt) – nur deren Änderung zählt bei UPDATE.
CREATE OR REPLACE FUNCTION public.s112_kellerbuch_periodensperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quelle  text[] := string_to_array(coalesce(TG_ARGV[0], 'datum'), ':');
  v_spalten text[] := string_to_array(coalesce(TG_ARGV[1], ''), ',');
  v_alt     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_neu     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_z       jsonb := coalesce(v_neu, v_alt);
  v_tenant  uuid;
  v_bis     date;
  v_d_alt   date;
  v_d_neu   date;
  v_k       text;
  v_geaendert boolean := false;
  v_kopf    record;
BEGIN
  -- Mandant und Datum (Kindtabellen über den Kopf)
  IF v_quelle[1] = 'kopf' THEN
    EXECUTE format('SELECT tenant_id, datum::date AS datum FROM public.%I WHERE id = $1', v_quelle[2])
      INTO v_kopf USING (v_z ->> v_quelle[3])::uuid;
    v_tenant := v_kopf.tenant_id;
    v_d_neu := v_kopf.datum;
    v_d_alt := v_kopf.datum;
    IF TG_OP = 'UPDATE' AND (v_alt ->> v_quelle[3]) IS DISTINCT FROM (v_neu ->> v_quelle[3]) THEN
      EXECUTE format('SELECT datum::date FROM public.%I WHERE id = $1', v_quelle[2]) INTO v_d_alt USING (v_alt ->> v_quelle[3])::uuid;
    END IF;
  ELSE
    v_tenant := (v_z ->> 'tenant_id')::uuid;
    v_d_alt := (v_alt ->> 'datum')::date;
    v_d_neu := (v_neu ->> 'datum')::date;
  END IF;
  IF v_tenant IS NULL OR coalesce(public.s112_wartung_frei(v_tenant), false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(v_tenant);
  IF v_bis IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Verkäufe: nur Tank-/Flaschenpositionen bzw. Köpfe mit solchen Positionen
  IF TG_TABLE_NAME = 'verkauf_positionen'
     AND coalesce(v_alt ->> 'typ', '') NOT IN ('tank', 'flasche') AND coalesce(v_neu ->> 'typ', '') NOT IN ('tank', 'flasche') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'verkaufsposten' AND NOT EXISTS (
       SELECT 1 FROM public.verkauf_positionen p WHERE p.verkaufsposten_id = (v_z ->> 'id')::uuid AND p.typ IN ('tank', 'flasche')) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_d_neu IS NOT NULL AND v_d_neu <= v_bis THEN
      RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – eine Bewegung vom % ist nicht mehr möglich. Bitte ein Datum nach dem Abschluss wählen.',
        to_char(v_bis, 'DD.MM.YYYY'), to_char(v_d_neu, 'DD.MM.YYYY') USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_d_alt IS NOT NULL AND v_d_alt <= v_bis THEN
      RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Bewegung vom % lässt sich nicht löschen, nur stornieren.',
        to_char(v_bis, 'DD.MM.YYYY'), to_char(v_d_alt, 'DD.MM.YYYY') USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  FOREACH v_k IN ARRAY v_spalten LOOP
    IF (v_alt -> v_k) IS DISTINCT FROM (v_neu -> v_k) THEN
      v_geaendert := true;
    END IF;
  END LOOP;
  IF v_geaendert AND ((v_d_alt IS NOT NULL AND v_d_alt <= v_bis) OR (v_d_neu IS NOT NULL AND v_d_neu <= v_bis)) THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – Bewegungen in diesem Zeitraum lassen sich nicht ändern (Datum %). Berichtigungen bitte stornieren und neu buchen.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(CASE WHEN v_d_alt <= v_bis THEN v_d_alt ELSE v_d_neu END, 'DD.MM.YYYY') USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kellerbuch_periodensperre() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.keller_umzuege FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum,menge_liter,brutto_liter,schwund_liter,umzug_typ,zeilen_typ,von_weinausbau_id,nach_weinausbau_id');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.pressungen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.pressung_behaelter FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('kopf:pressungen:pressung_id', 'menge_liter,weinausbau_id,pressung_id');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.zukauf_posten FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum,art,menge,einheit,ziel_weinausbau_id');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.verschneidungen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum,ziel_weinausbau_id');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.verschneidung_quellen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('kopf:verschneidungen:verschneidung_id', 'menge_liter,quell_weinausbau_id,verschneidung_id');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.fuellungen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum,weinausbau_id,anzahl_flaschen,menge_liter_gefuellt,flaschengroesse_ml');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.fuellung_bewegungen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum,art,menge_stk,fuellung_id');
CREATE TRIGGER a_periodensperre BEFORE UPDATE OR DELETE ON public.verkaufsposten FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.verkauf_positionen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('kopf:verkaufsposten:verkaufsposten_id', 'typ,menge,einheit,weinausbau_id,fuellung_id,verkaufsposten_id');

-- journal_abgleichen: Korrekturen frühestens am Tag nach dem Abschluss
CREATE OR REPLACE FUNCTION public.journal_abgleichen(p_tenant_id uuid, p_mindestalter interval DEFAULT '00:15:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab    date;
  v_frei  date;
  r       record;
  v_n     integer := 0;
  v_beleg integer;
  v_ml    integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch', 'warenwirtschaft');   -- Bestände: Kellerbuch oder Warenwirtschaft
  v_ab := public.s112_journal_ab(p_tenant_id);
  IF v_ab IS NULL THEN
    RETURN 0;
  END IF;
  IF p_mindestalter IS NULL OR p_mindestalter < interval '0' THEN
    RAISE EXCEPTION 'Mindestalter ungültig.' USING ERRCODE = '22023';
  END IF;
  -- KAN-192: frühestens am Tag nach dem Kellerbuch-Abschluss
  v_frei := greatest(v_ab, coalesce(public.s112_kellerbuch_gesperrt_bis(p_tenant_id) + 1, v_ab));
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  FOR r IN SELECT * FROM public.s112_journal_abweichungen(p_tenant_id) a
            WHERE a.letzte_aenderung IS NULL OR a.letzte_aenderung <= now() - p_mindestalter
            ORDER BY a.art, a.bezeichnung, a.id LOOP
    v_beleg := public.s112_journal_beleg(p_tenant_id, NULL);
    IF r.art = 'charge' THEN
      PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg,
        greatest(coalesce((r.stamm_geaendert AT TIME ZONE 'Europe/Vienna')::date, (now() AT TIME ZONE 'Europe/Vienna')::date), v_frei),
        jsonb_build_object('code', CASE WHEN r.differenz > 0 THEN 'INV_PLUS' ELSE 'INV_MIN' END, 'bestand', 'offen', 'weinausbau_id', r.id,
                           'liter', r.differenz),
        'weinausbau_bestand', r.id, r.id, false, 'Bestandskorrektur ohne Bewegung (Abgleich Ist ↔ Journal)');
    ELSE
      SELECT f.flaschengroesse_ml INTO v_ml FROM public.fuellungen f WHERE f.id = r.id AND f.tenant_id = p_tenant_id;
      PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg,
        greatest(coalesce((r.stamm_geaendert AT TIME ZONE 'Europe/Vienna')::date, (now() AT TIME ZONE 'Europe/Vienna')::date), v_frei),
        jsonb_build_object('code', CASE WHEN r.differenz > 0 THEN 'INV_PLUS' ELSE 'INV_MIN' END, 'bestand', 'flasche', 'fuellung_id', r.id,
                           'stk', r.differenz::integer, 'liter', round(r.differenz * coalesce(NULLIF(v_ml, 0), 750) / 1000.0, 3)),
        'fuellungen_bestand', r.id, r.id, false, 'Bestandskorrektur ohne Bewegung (Abgleich Ist ↔ Journal)');
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.journal_abgleichen(uuid, interval) FROM PUBLIC, anon;

-- 3. Genealogie: Sicht über das Journal ──────────────────────────────────────────────────────────────────────────
CREATE VIEW public.charge_herkunft WITH (security_invoker = true) AS
WITH z AS (
  SELECT k.*, (k.storno_von_id IS NOT NULL) AS gb
    FROM public.kellerbuch_buchungen k
   WHERE k.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU', 'VS_AB', 'FUELLUNG')
)
SELECT n.tenant_id, n.beleg_nr, n.datum, n.buchungsart_code AS art,
       CASE WHEN n.bestand = 'offen' THEN n.weinausbau_id END AS nach_weinausbau_id,
       CASE WHEN n.bestand = 'flasche' THEN n.fuellung_id END AS nach_fuellung_id,
       v.weinausbau_id AS von_weinausbau_id,
       NULL::uuid AS zukauf_posten_id,
       round(n.menge_liter * v.menge_liter / NULLIF(sum(v.menge_liter) OVER (PARTITION BY n.id), 0), 3) AS liter,
       n.gb AS gegenbuchung, n.quelle_tabelle, n.quelle_id, n.gruppe_id, n.erstellt_am, n.id AS buchung_id
  FROM z n
  JOIN z v ON v.tenant_id = n.tenant_id AND v.beleg_nr = n.beleg_nr AND v.gb = n.gb AND v.bestand = 'offen'
          AND v.buchungsart_code = CASE n.buchungsart_code WHEN 'VS_ZU' THEN 'VS_AB' ELSE n.buchungsart_code END
          AND sign(v.menge_liter) = -sign(n.menge_liter) AND v.weinausbau_id IS DISTINCT FROM n.weinausbau_id
 WHERE ((n.menge_liter > 0) <> n.gb)
   AND ((n.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU') AND n.bestand = 'offen') OR (n.buchungsart_code = 'FUELLUNG' AND n.bestand = 'flasche'))
UNION ALL
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, k.weinausbau_id, NULL::uuid, NULL::uuid, k.zukauf_posten_id,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'offen' AND k.buchungsart_code IN ('ERNTE', 'ZK_TRAUB', 'ZK_MOST', 'ZK_FASS', 'EROEFF', 'INV_PLUS');
COMMENT ON VIEW public.charge_herkunft IS
  'KAN-192: Genealogie aus dem Bewegungsjournal – Kante von_weinausbau_id → nach_weinausbau_id bzw. nach_fuellung_id je Beleg (Liter anteilig), Wurzeln ohne Quell-Charge; Gegenbuchungen negativ';
REVOKE ALL ON public.charge_herkunft FROM PUBLIC, anon;
GRANT SELECT ON public.charge_herkunft TO authenticated;