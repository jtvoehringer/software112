-- KAN-102 (08.10.2026): Rechnung vom Lieferschein trennen – Etappe 1 (Datenmodell, ohne Verhaltensänderung).
-- Entscheidungen Jörgen (06.10.2026, KAN-102/103/104/105): eigener Lieferschein-Nummernkreis, Stornorechnung ohne eigene
-- Nummer, Export-Rechnungen im selben Nummernkreis, Preise erst auf der Rechnung, Sammelrechnung mit einem Empfänger.
--  1. Lieferschein-Nummernkreis (tenant_einstellungen.lieferschein_*), Vergabe nur im Insert (wie KAN-21).
--  2. Tabelle rechnungen: Nummer eindeutig je Betrieb, Datum, Leistungszeitraum, Empfänger (Momentaufnahme), Skonto, Storno,
--     bezahlt, Versand, BMD-Export. Lesen für Mitglieder; geschrieben nur von Triggern/RPCs bzw. der Service-Role.
--  3. verkaufsposten = Lieferschein: lieferscheinnummer (eindeutig je Betrieb) und rechnung_id.
--  4. Übergang 1:1 – bis zur Umstellung der Folgesysteme (KAN-103/105) entsteht die Rechnung im selben Insert wie der
--     Lieferschein (Trigger b_rechnung_anlegen, Nummer aus a_rechnungsnummer), und der Spiegel-Trigger z_rechnung_spiegeln
--     überträgt Datum, Kunde, Storno, bezahlt, Versand und BMD-Export auf die Rechnung, solange sie genau einen Lieferschein
--     umfasst. verkaufsposten.rechnungsnummer bleibt als Spiegel, damit alle Leser unverändert laufen.
--  5. Wird ein Lieferschein in der Wartung gelöscht (Demo-Reset, Mandant löschen), geht die Rechnung ohne Lieferschein mit
--     (sonst stieße der nächste Demo-Reset auf die bestehenden RE-Nummern).
--  6. Altbelege: je Lieferschein genau eine Rechnung (gleiche Nummer, gleiches Datum) und eine Lieferscheinnummer in der
--     Reihenfolge Datum, Anlage.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 67, dann Produktion.

-- 1. Lieferschein-Nummernkreis ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN lieferschein_prefix  text    NOT NULL DEFAULT 'LS' CHECK (lieferschein_prefix ~ '^[A-Za-z0-9]{1,8}$'),
  ADD COLUMN lieferschein_stellen integer NOT NULL DEFAULT 4 CHECK (lieferschein_stellen BETWEEN 3 AND 8),
  ADD COLUMN lieferschein_zaehler integer NOT NULL DEFAULT 1 CHECK (lieferschein_zaehler >= 1);
GRANT SELECT (lieferschein_prefix, lieferschein_stellen, lieferschein_zaehler) ON public.tenant_einstellungen TO authenticated, anon;

CREATE FUNCTION public.s112_lieferscheinnummer_ziehen(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix  text;
  v_stellen integer;
  v_nummer  integer;
BEGIN
  SELECT lieferschein_prefix, lieferschein_stellen, lieferschein_zaehler INTO v_prefix, v_stellen, v_nummer
    FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE tenant_einstellungen SET lieferschein_zaehler = v_nummer + 1 WHERE tenant_id = p_tenant_id;
  RETURN v_prefix || '-' || to_char((now() AT TIME ZONE 'Europe/Vienna')::date, 'YYYY') || '-' || lpad(v_nummer::text, v_stellen, '0');
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lieferscheinnummer_ziehen(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_lieferscheinnummer_ziehen(uuid) IS
  'KAN-102: nächste Lieferscheinnummer (LS-JJJJ-0001, Zähler ohne Jahreswechsel) – intern, nur Trigger a_lieferscheinnummer';

-- 2. Rechnungen ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.rechnungen (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rechnungsnummer       text NOT NULL,
  datum                 date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date),
  leistung_von          date,
  leistung_bis          date,
  kontakt_id            uuid REFERENCES public.kontakte(id) ON DELETE SET NULL,
  firma_id              uuid REFERENCES public.firmen(id) ON DELETE SET NULL,
  zh_kontakt_id         uuid REFERENCES public.kontakte(id) ON DELETE SET NULL,
  partner_daten         jsonb,
  skonto_pct            numeric,
  skonto_tage           integer,
  skonto_aktiv          boolean,
  notizen               text,
  aktiv                 boolean NOT NULL DEFAULT true,
  storniert             boolean NOT NULL DEFAULT false,
  storniert_am          timestamptz,
  storniert_von         uuid,
  storniert_von_name    text,
  storno_grund          text,
  bezahlt               boolean NOT NULL DEFAULT false,
  bezahlt_am            timestamptz,
  rechnung_versendet_am timestamptz,
  rechnung_versendet_an text,
  bmd_export_id         uuid REFERENCES public.buchhaltung_export_protokoll(id) ON DELETE SET NULL,
  erstellt_am           timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rechnungen_leistungszeitraum CHECK (leistung_von IS NULL OR leistung_bis IS NULL OR leistung_von <= leistung_bis)
);
CREATE UNIQUE INDEX rechnungen_nummer_eindeutig ON public.rechnungen (tenant_id, rechnungsnummer);
CREATE INDEX rechnungen_tenant_datum_idx ON public.rechnungen (tenant_id, datum);
CREATE INDEX rechnungen_kontakt_idx ON public.rechnungen (kontakt_id) WHERE kontakt_id IS NOT NULL;
CREATE INDEX rechnungen_firma_idx ON public.rechnungen (firma_id) WHERE firma_id IS NOT NULL;
COMMENT ON TABLE public.rechnungen IS
  'KAN-102: Ausgangsrechnungen (eine Rechnung umfasst einen oder mehrere Lieferscheine = verkaufsposten.rechnung_id); Nummer lückenlos aus dem Rechnungs-Nummernkreis';

ALTER TABLE public.rechnungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rechnungen FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rechnungen FROM authenticated;
GRANT SELECT ON public.rechnungen TO authenticated;
CREATE POLICY rechnungen_select ON public.rechnungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.rechnungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.rechnungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.rechnungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.rechnungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.rechnungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY keine_direktloeschung ON public.rechnungen AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
CREATE TRIGGER rechnungen_aktualisiert_am BEFORE UPDATE ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.verkaufsposten_aktualisiert_am();   -- setzt aktualisiert_am (ausdrücklich gesetzter Wert bleibt)
-- KAN-178 / KAN-212: Verweise nur in den eigenen Betrieb bzw. auf freigegebene CRM-Partner
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', 'crm', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', 'crm', '', '');
CREATE TRIGGER z_fremdverweis_zh_kontakt_id BEFORE INSERT OR UPDATE OF zh_kontakt_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zh_kontakt_id', 'kontakte', 'crm', '', '');
CREATE TRIGGER z_fremdverweis_bmd_export_id BEFORE INSERT OR UPDATE OF bmd_export_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('bmd_export_id', 'buchhaltung_export_protokoll', '', '', '');
-- KAN-35: Änderungsprotokoll
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF rechnungsnummer, datum, kontakt_id, firma_id, zh_kontakt_id, aktiv, storniert,
  storniert_am, storniert_von, storno_grund, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('rechnungsnummer', 'datum', 'kontakt_id', 'firma_id', 'zh_kontakt_id',
  'aktiv', 'storniert', 'storniert_am', 'storniert_von', 'storno_grund', 'tenant_id');
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.rechnungen FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.rechnungen FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();

-- 3. Lieferschein ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verkaufsposten
  ADD COLUMN lieferscheinnummer text,
  ADD COLUMN rechnung_id uuid REFERENCES public.rechnungen(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.verkaufsposten.lieferscheinnummer IS 'KAN-102: Lieferscheinnummer (eigener Nummernkreis, vergibt das System)';
COMMENT ON COLUMN public.verkaufsposten.rechnung_id IS 'KAN-102: Rechnung, die diesen Lieferschein umfasst (NULL = nicht berechnet)';
COMMENT ON COLUMN public.verkaufsposten.rechnungsnummer IS
  'Spiegel der Rechnungsnummer (rechnungen.rechnungsnummer) – bis KAN-105 lesen die Folgesysteme die Nummer hier';
CREATE INDEX verkaufsposten_rechnung_idx ON public.verkaufsposten (rechnung_id) WHERE rechnung_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_rechnung_id BEFORE INSERT OR UPDATE OF rechnung_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('rechnung_id', 'rechnungen', '', '', '');

-- Lieferscheinnummer: Vergabe im Insert, keine fremde oder geänderte Nummer per API (wie a_rechnungsnummer)
CREATE FUNCTION public.s112_lieferscheinnummer_vergeben()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_api boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lieferscheinnummer IS NOT NULL AND v_api THEN
      RAISE EXCEPTION 'Die Lieferscheinnummer vergibt das System – bitte ohne Nummer speichern.'
        USING ERRCODE = '42501', HINT = 'lieferscheinnummer';
    END IF;
    IF NEW.lieferscheinnummer IS NULL THEN
      NEW.lieferscheinnummer := public.s112_lieferscheinnummer_ziehen(NEW.tenant_id);
    END IF;
  ELSIF NEW.lieferscheinnummer IS DISTINCT FROM OLD.lieferscheinnummer AND v_api THEN
    RAISE EXCEPTION 'Die Lieferscheinnummer eines Belegs ist unveränderlich.' USING ERRCODE = '42501', HINT = 'lieferscheinnummer';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lieferscheinnummer_vergeben() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_lieferscheinnummer BEFORE INSERT OR UPDATE OF lieferscheinnummer ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_lieferscheinnummer_vergeben();

-- Rechnung zum Lieferschein (Übergang 1:1): läuft nach a_momentaufnahme und a_rechnungsnummer (alphabetisch)
CREATE FUNCTION public.s112_rechnung_aus_lieferschein()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_api boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  IF NEW.rechnung_id IS NOT NULL THEN
    IF v_api THEN
      RAISE EXCEPTION 'Die Rechnung eines Lieferscheins setzt das System.' USING ERRCODE = '42501', HINT = 'rechnung_id';
    END IF;
    RETURN NEW;   -- Wartung/Import: Rechnung schon vorhanden
  END IF;
  IF NEW.rechnungsnummer IS NULL THEN
    RETURN NEW;   -- ohne Nummer (kein Nummernkreis) – keine Rechnung
  END IF;
  INSERT INTO public.rechnungen (tenant_id, rechnungsnummer, datum, leistung_von, leistung_bis, kontakt_id, firma_id, zh_kontakt_id,
                                 partner_daten, skonto_pct, skonto_tage, skonto_aktiv, aktiv, storniert, storniert_am, storniert_von,
                                 storniert_von_name, storno_grund, bezahlt, bezahlt_am, rechnung_versendet_am, rechnung_versendet_an,
                                 bmd_export_id, erstellt_am)
  VALUES (NEW.tenant_id, NEW.rechnungsnummer, coalesce(NEW.datum, (now() AT TIME ZONE 'Europe/Vienna')::date), NEW.datum, NEW.datum,
          NEW.kontakt_id, NEW.firma_id, NEW.zh_kontakt_id, NEW.partner_daten, NEW.skonto_pct, NEW.skonto_tage, NEW.skonto_aktiv,
          coalesce(NEW.aktiv, true), coalesce(NEW.storniert, false), NEW.storniert_am, NEW.storniert_von, NEW.storniert_von_name,
          NEW.storno_grund, coalesce(NEW.bezahlt, false), NEW.bezahlt_am, NEW.rechnung_versendet_am, NEW.rechnung_versendet_an,
          NEW.bmd_export_id, coalesce(NEW.erstellt_am, now()))
  RETURNING id INTO NEW.rechnung_id;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_aus_lieferschein() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_rechnung_anlegen BEFORE INSERT ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnung_aus_lieferschein();
-- rechnung_id per API nie ändern
CREATE FUNCTION public.s112_rechnung_id_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.rechnung_id IS DISTINCT FROM OLD.rechnung_id AND coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Die Rechnung eines Lieferscheins setzt das System.' USING ERRCODE = '42501', HINT = 'rechnung_id';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_id_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_rechnung_id_schutz BEFORE UPDATE OF rechnung_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnung_id_schutz();

-- Spiegel Lieferschein → Rechnung, solange die Rechnung genau diesen einen Lieferschein umfasst (Übergang bis KAN-103/105)
CREATE FUNCTION public.s112_rechnung_spiegeln()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.rechnung_id IS NULL
     OR EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = NEW.rechnung_id AND v.id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  UPDATE public.rechnungen r
     SET rechnungsnummer = coalesce(NEW.rechnungsnummer, r.rechnungsnummer),
         datum = NEW.datum, leistung_von = NEW.datum, leistung_bis = NEW.datum,
         kontakt_id = NEW.kontakt_id, firma_id = NEW.firma_id, zh_kontakt_id = NEW.zh_kontakt_id, partner_daten = NEW.partner_daten,
         skonto_pct = NEW.skonto_pct, skonto_tage = NEW.skonto_tage, skonto_aktiv = NEW.skonto_aktiv,
         aktiv = coalesce(NEW.aktiv, true), storniert = coalesce(NEW.storniert, false), storniert_am = NEW.storniert_am,
         storniert_von = NEW.storniert_von, storniert_von_name = NEW.storniert_von_name, storno_grund = NEW.storno_grund,
         bezahlt = coalesce(NEW.bezahlt, false), bezahlt_am = NEW.bezahlt_am,
         rechnung_versendet_am = NEW.rechnung_versendet_am, rechnung_versendet_an = NEW.rechnung_versendet_an,
         bmd_export_id = NEW.bmd_export_id
   WHERE r.id = NEW.rechnung_id
     AND (r.rechnungsnummer, r.datum, r.kontakt_id, r.firma_id, r.zh_kontakt_id, r.partner_daten, r.skonto_pct, r.skonto_tage,
          r.skonto_aktiv, r.aktiv, r.storniert, r.storniert_am, r.storniert_von, r.storniert_von_name, r.storno_grund, r.bezahlt,
          r.bezahlt_am, r.rechnung_versendet_am, r.rechnung_versendet_an, r.bmd_export_id)
         IS DISTINCT FROM
         (coalesce(NEW.rechnungsnummer, r.rechnungsnummer), NEW.datum, NEW.kontakt_id, NEW.firma_id, NEW.zh_kontakt_id, NEW.partner_daten,
          NEW.skonto_pct, NEW.skonto_tage, NEW.skonto_aktiv, coalesce(NEW.aktiv, true), coalesce(NEW.storniert, false), NEW.storniert_am,
          NEW.storniert_von, NEW.storniert_von_name, NEW.storno_grund, coalesce(NEW.bezahlt, false), NEW.bezahlt_am,
          NEW.rechnung_versendet_am, NEW.rechnung_versendet_an, NEW.bmd_export_id);
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_spiegeln() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_rechnung_spiegeln AFTER UPDATE ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnung_spiegeln();

-- Wartung: Rechnung ohne Lieferschein mitlöschen (Demo-Reset, Mandant löschen – die Löschsperre prüft dieselbe Freigabe)
CREATE FUNCTION public.s112_rechnung_aufraeumen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.rechnung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = OLD.rechnung_id) THEN
    DELETE FROM public.rechnungen WHERE id = OLD.rechnung_id;   -- storno-ausnahme: Rechnung des gelöschten Lieferscheins (nur Wartung, Löschsperre)
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_aufraeumen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_rechnung_aufraeumen AFTER DELETE ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnung_aufraeumen();

-- 4. Altbelege: je Lieferschein eine Rechnung und eine Lieferscheinnummer ──────────────────────────────────────────
DO $alt$
DECLARE
  r      record;
  v_rid  uuid;
BEGIN
  -- rechnung_id/lieferscheinnummer stehen nicht im Änderungsprotokoll von verkaufsposten; aktualisiert_am der Altbelege wird
  -- dabei auf den Übernahmezeitpunkt gesetzt (nur Sandbox und Musterhof haben Verkäufe, der Musterhof setzt nachts neu auf)
  FOR r IN
    SELECT v.*, row_number() OVER (PARTITION BY v.tenant_id ORDER BY v.datum, v.erstellt_am, v.id) AS lfd
      FROM public.verkaufsposten v
     WHERE v.rechnung_id IS NULL
     ORDER BY v.tenant_id, v.datum, v.erstellt_am, v.id
  LOOP
    v_rid := NULL;
    IF r.rechnungsnummer IS NOT NULL THEN
      INSERT INTO public.rechnungen (tenant_id, rechnungsnummer, datum, leistung_von, leistung_bis, kontakt_id, firma_id, zh_kontakt_id,
                                     partner_daten, skonto_pct, skonto_tage, skonto_aktiv, aktiv, storniert, storniert_am, storniert_von,
                                     storniert_von_name, storno_grund, bezahlt, bezahlt_am, rechnung_versendet_am, rechnung_versendet_an,
                                     bmd_export_id, erstellt_am)
      VALUES (r.tenant_id, r.rechnungsnummer, r.datum, r.datum, r.datum, r.kontakt_id, r.firma_id, r.zh_kontakt_id, r.partner_daten,
              r.skonto_pct, r.skonto_tage, r.skonto_aktiv, coalesce(r.aktiv, true), coalesce(r.storniert, false), r.storniert_am,
              r.storniert_von, r.storniert_von_name, r.storno_grund, coalesce(r.bezahlt, false), r.bezahlt_am, r.rechnung_versendet_am,
              r.rechnung_versendet_an, r.bmd_export_id, coalesce(r.erstellt_am, now()))
      RETURNING id INTO v_rid;
    END IF;
    UPDATE public.verkaufsposten
       SET rechnung_id = v_rid,
           lieferscheinnummer = coalesce(lieferscheinnummer,
             'LS-' || to_char(r.datum, 'YYYY') || '-' || lpad(r.lfd::text, 4, '0'))
     WHERE id = r.id;
  END LOOP;
  -- Zähler hinter die vergebenen Lieferscheinnummern setzen
  UPDATE public.tenant_einstellungen t
     SET lieferschein_zaehler = 1 + (SELECT count(*) FROM public.verkaufsposten v WHERE v.tenant_id = t.tenant_id);
END
$alt$;

CREATE UNIQUE INDEX verkaufsposten_lieferscheinnummer_eindeutig ON public.verkaufsposten (tenant_id, lieferscheinnummer)
  WHERE lieferscheinnummer IS NOT NULL;

-- Selbstprüfung: jeder Lieferschein mit Rechnungsnummer hat genau eine Rechnung mit derselben Nummer, Summen unverändert
DO $pruefung$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.verkaufsposten v
   WHERE v.rechnungsnummer IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rechnungen r WHERE r.id = v.rechnung_id AND r.rechnungsnummer = v.rechnungsnummer
                        AND r.tenant_id = v.tenant_id AND r.storniert = v.storniert AND r.datum = v.datum);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'KAN-102: % Lieferschein(e) ohne passende Rechnung', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.verkaufsposten v WHERE v.lieferscheinnummer IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'KAN-102: % Lieferschein(e) ohne Lieferscheinnummer', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.rechnungen r
   WHERE NOT EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = r.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'KAN-102: % Rechnung(en) ohne Lieferschein', v_n;
  END IF;
END
$pruefung$;

-- 5. Demo-Musterhof: feste Lieferscheinnummern (LS-JJJJ-<lfd. Nr. wie RE>) und Zähler danach – sonst liefe der Zähler mit jedem
--    nächtlichen Reset weiter (der Reset setzt nur die übrigen Zähler zurück) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demo_musterhof_verkauf(p_id uuid, p_nr integer, p_datum date, p_kontakt uuid, p_firma uuid, p_pos jsonb, p_zahlung jsonb, p_storno boolean, p_notiz text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_re text := 'RE-' || lpad(p_nr::text, 4, '0');
  v_ls text := 'LS-' || to_char(p_datum, 'YYYY') || '-' || lpad(p_nr::text, 4, '0');   -- KAN-102: feste Lieferscheinnummer wie RE
  v_tx text; v_p jsonb; v_f record; v_w record; v_s record; v_n integer := 0;
  v_name text; v_menge numeric; v_preis numeric; v_ust numeric; v_rab numeric; v_typ text; v_fid uuid; v_wid uuid; v_einheit text;
  v_summe numeric; v_zdatum date; v_konto uuid; v_kat uuid; v_grp record;
begin
  if p_datum > current_date then return; end if;
  v_tx := demo_musterhof_txnr('verkauf', extract(year from p_datum)::int);
  insert into verkaufsposten (id, tenant_id, datum, rechnungsnummer, lieferscheinnummer, transaktions_nr, kontakt_id, firma_id, notizen, storniert, storniert_am,
    erstellt_am, aktualisiert_am, updated_at)
  values (p_id, c_t, p_datum, v_re, v_ls, v_tx, p_kontakt, p_firma, p_notiz, p_storno,
    case when p_storno then (p_datum + 2)::timestamptz end, p_datum::timestamptz, p_datum::timestamptz, p_datum::timestamptz);

  for v_p in select * from jsonb_array_elements(p_pos) loop
    v_typ := v_p->>'t'; v_fid := null; v_wid := null; v_einheit := 'Stk';
    v_menge := (v_p->>'m')::numeric; v_rab := coalesce((v_p->>'r')::numeric, 0);
    if v_typ = 'f' then
      select * into v_f from fuellungen where id = demo_musterhof_id(19, (v_p->>'f')::int) and tenant_id = c_t;
      if v_f.id is null or v_f.datum > p_datum then continue; end if;
      if not p_storno and v_f.bestand_flaschen < v_menge then continue; end if;
      v_typ := 'flasche'; v_fid := v_f.id;
      v_name := v_f.name || ' ' || coalesce(v_f.jahrgang::text, '') || ' (' || v_f.flaschengroesse_ml || ' ml)';
      v_preis := coalesce((v_p->>'p')::numeric, v_f.vk_preis_brutto); v_ust := coalesce((v_p->>'u')::numeric, 13);
    elsif v_typ = 'w' then
      select * into v_w from weinausbau where id = (v_p->>'w')::uuid and tenant_id = c_t;
      if v_w.id is null or v_w.created_at::date > p_datum then continue; end if;
      if not p_storno and coalesce(v_w.menge_liter, 0) < v_menge then continue; end if;
      v_typ := 'tank'; v_wid := v_w.id; v_einheit := 'l';
      v_name := 'Tankwein ' || v_w.name || ' ' || coalesce(v_w.jahrgang::text, '');
      v_preis := (v_p->>'p')::numeric; v_ust := coalesce((v_p->>'u')::numeric, 13);
    else
      select * into v_s from sonstige_artikel where id = demo_musterhof_id(20, (v_p->>'s')::int) and tenant_id = c_t;
      if v_s.id is null then continue; end if;
      v_typ := 'sonstiges'; v_name := v_s.name; v_einheit := v_s.einheit;
      v_preis := coalesce((v_p->>'p')::numeric, v_s.default_preis); v_ust := coalesce((v_p->>'u')::numeric, 20);
    end if;

    insert into verkauf_positionen (tenant_id, verkaufsposten_id, typ, fuellung_id, weinausbau_id, name, menge, einheit, preis_brutto, ust_satz, rabatt_pct, sonderrabatt_pct, erstellt_am)
    values (c_t, p_id, v_typ, v_fid, v_wid, v_name, v_menge, v_einheit, v_preis, v_ust, v_rab, 0, p_datum::timestamptz);
    v_n := v_n + 1;

    if not p_storno then
      if v_fid is not null then
        update fuellungen set bestand_flaschen = greatest(0, bestand_flaschen - round(v_menge)::int), aktualisiert_am = p_datum::timestamptz
        where id = v_fid and tenant_id = c_t;
      elsif v_wid is not null then
        update weinausbau set menge_liter = greatest(0, coalesce(menge_liter, 0) - v_menge) where id = v_wid and tenant_id = c_t;
      end if;
    end if;
  end loop;

  if v_n = 0 then
    delete from verkaufsposten where id = p_id and tenant_id = c_t;  -- storno-ausnahme: Demo-Musterhof, Verkauf ohne Positionen wieder entfernen
    return;
  end if;

  -- KAN-102: Lieferschein-Zähler hinter die höchste Demo-Nummer (der Reset löscht vorher alle Lieferscheine)
  update tenant_einstellungen
     set lieferschein_zaehler = 1 + coalesce((select max(substring(v.lieferscheinnummer from '(\d+)$')::int) from verkaufsposten v where v.tenant_id = c_t), 0)
   where tenant_id = c_t;

  select coalesce(sum(round(menge * coalesce(preis_brutto, 0) * (1 - coalesce(rabatt_pct, 0) / 100), 2)), 0) into v_summe
  from verkauf_positionen where verkaufsposten_id = p_id and tenant_id = c_t;

  insert into aktivitaeten (tenant_id, kontakt_id, firma_id, art, betreff, beschreibung, datum, erledigt, erstellt_am)
  values (c_t, p_kontakt, p_firma, 'verkauf',
    'Verkauf ' || v_re || case when p_storno then ' · STORNIERT' else ' · ' || replace(to_char(v_summe, 'FM9999990.00'), '.', ',') || ' €' end,
    'Verkaufsposten: ' || p_id, p_datum, true, p_datum::timestamptz);

  if p_kontakt is not null then update kontakte set is_lead = false where id = p_kontakt and tenant_id = c_t and is_lead = true; end if;
  if p_firma   is not null then update firmen   set is_lead = false where id = p_firma   and tenant_id = c_t and is_lead = true; end if;

  if p_zahlung is not null and not p_storno then
    v_zdatum := least(current_date, p_datum + coalesce((p_zahlung->>'tage')::int, 0));
    v_konto := (p_zahlung->>'konto')::uuid;
    insert into zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum, konto_id, abgeglichen, erstellt_am)
    values (c_t, p_id, v_summe, (p_zahlung->>'art')::zahlungsart, v_zdatum, v_konto, true, v_zdatum::timestamptz);
    update verkaufsposten set bezahlt_am = v_zdatum::timestamptz where id = p_id and tenant_id = c_t;
    for v_grp in
      select ust_satz, sum(menge * coalesce(preis_brutto, 0) * (1 - coalesce(rabatt_pct, 0) / 100)) as brutto
      from verkauf_positionen where verkaufsposten_id = p_id and tenant_id = c_t and preis_brutto is not null group by ust_satz
    loop
      if round(v_grp.brutto / (1 + v_grp.ust_satz / 100), 2) <= 0 then continue; end if;
      v_kat := case when v_grp.ust_satz = 0 then demo_musterhof_kat('Weinverkauf Export') else demo_musterhof_kat('Weinverkauf Ab Hof (13 %)') end;
      insert into ea_transaktionen (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, import_quelle, verkaufsposten_id,
        konto_id, firma_id, abgeglichen, notizen, erstellt_am, aktualisiert_am)
      values (c_t, 'einnahme', v_zdatum, 'Zahlungseingang RE ' || v_re, v_kat, round(v_grp.brutto / (1 + v_grp.ust_satz / 100), 2), v_grp.ust_satz,
        'verkauf', p_id, v_konto, p_firma, true, 'Automatisch erzeugt aus Zahlungseingang (Verkauf)', v_zdatum::timestamptz, v_zdatum::timestamptz);
    end loop;
  end if;
  -- Rückdatierten Änderungszeitpunkt wiederherstellen: Zahlungs-Sync und bezahlt_am-Update
  -- oben lösen den Trigger verkaufsposten_updated_at aus (24.09.2026)
  update verkaufsposten set aktualisiert_am = p_datum::timestamptz
  where id = p_id and tenant_id = c_t and aktualisiert_am is distinct from p_datum::timestamptz;
end $function$;
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_verkauf(uuid, integer, date, uuid, uuid, jsonb, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
