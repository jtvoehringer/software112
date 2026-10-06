-- KAN-212 (06.10.2026): CRM-Gemeinschaft – CRM zwischen Mandanten gemeinsam nutzen (Muster: Kellergemeinschaft, Migration 203).
-- Entscheidungen Jörgen (Kommentar KAN-212): Der Eigentümer gibt frei, der Partner liest Kontakte, Firmen, Aktivitäten
-- (ohne private) und Pipeline und verwendet Kontakte/Firmen in eigenen Belegen (Verkauf, Zukauf, Traubenverkauf);
-- ändern darf nur der Eigentümer. Kundennummer/Debitor/Kreditor des Eigentümers gehen nicht auf Belege des Partners.
--  1. Tabelle crm_freigaben (eigentuemer → nutzer, aktiv) wie keller_freigaben: lesen beide Seiten, schreiben nur
--     Plattform-Admin per Service-Role (keine Schreib-Policy).
--  2. s112_crm_partner_tenants(): Betriebe, die einen meiner aktiven Betriebe als Partner freigegeben haben.
--  3. Zusätzliche PERMISSIVE SELECT-Policies *_crm_partner auf kontakte, firmen, aktivitaeten (NOT ist_privat),
--     pipeline_eintraege, kontakt_firmen, pipeline_verlauf. Schreib-Policies bleiben beim Eigentümer. Die KI-Abfrage
--     bleibt beim aktiven Betrieb (ki_aktiver_betrieb).
--  4. Fremdverweis-Modus 'crm': Belege des Partners dürfen auf freigegebene Kontakte/Firmen zeigen (verkaufsposten,
--     zukauf_posten, traubenverkauf).
--  5. Momentaufnahme: bei einem Kontakt/einer Firma aus einem anderen Betrieb Kundennummer, Debitor und Kreditor leer.
--  6. lade_crmgemeinschaft(p_tenant_id) wie lade_kellergemeinschaft.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Freigaben
CREATE TABLE public.crm_freigaben (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eigentuemer_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nutzer_tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  aktiv                 boolean NOT NULL DEFAULT true,
  notizen               text,
  erstellt_von          uuid,
  erstellt_am           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_freigaben_paar_uq UNIQUE (eigentuemer_tenant_id, nutzer_tenant_id),
  CONSTRAINT crm_freigaben_verschieden_chk CHECK (eigentuemer_tenant_id <> nutzer_tenant_id)
);
COMMENT ON TABLE public.crm_freigaben IS 'KAN-212: CRM-Gemeinschaft – der Eigentümer gibt Kontakte, Firmen, Aktivitäten und Pipeline für den Nutzer-Betrieb frei (lesen und in Belegen verwenden). Pflege nur Plattform-Admin (Service-Role).';
CREATE INDEX crm_freigaben_nutzer_idx ON public.crm_freigaben (nutzer_tenant_id) WHERE aktiv;
ALTER TABLE public.crm_freigaben ENABLE ROW LEVEL SECURITY;
-- Rechte wie keller_freigaben (explizite Data-API-Rechte, ohne TRUNCATE); RLS lässt nur lesen, anon bekommt 0 Zeilen
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.crm_freigaben TO anon, authenticated;
GRANT ALL ON public.crm_freigaben TO service_role;
CREATE POLICY crm_freigaben_select ON public.crm_freigaben FOR SELECT TO authenticated
  USING (eigentuemer_tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid()))
         OR nutzer_tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid())));
CREATE POLICY zwei_faktor_aal ON public.crm_freigaben AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- 2. Partner-Betriebe des angemeldeten Benutzers (für die Policies)
CREATE OR REPLACE FUNCTION public.s112_crm_partner_tenants()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT f.eigentuemer_tenant_id FROM public.crm_freigaben f
   WHERE f.aktiv
     AND f.nutzer_tenant_id IN (SELECT public.s112_meine_tenants())
     AND NOT public.s112_betrieb_gesperrt(f.eigentuemer_tenant_id)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_crm_partner_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_crm_partner_tenants() TO authenticated;
COMMENT ON FUNCTION public.s112_crm_partner_tenants() IS 'KAN-212: Eigentümer-Betriebe, die einen aktiven Betrieb des Benutzers in der CRM-Gemeinschaft freigegeben haben (RLS-Hilfe)';

-- 3. Lesen für Partner (zusätzlich zu den bestehenden *_select; Schreiben unverändert nur Eigentümer)
CREATE POLICY kontakte_crm_partner ON public.kontakte FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_crm_partner_tenants()));
CREATE POLICY firmen_crm_partner ON public.firmen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_crm_partner_tenants()));
CREATE POLICY akt_crm_partner ON public.aktivitaeten FOR SELECT TO authenticated
  USING (NOT coalesce(ist_privat, false) AND tenant_id IN (SELECT public.s112_crm_partner_tenants()));
CREATE POLICY pipe_crm_partner ON public.pipeline_eintraege FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_crm_partner_tenants()));
CREATE POLICY kf_crm_partner ON public.kontakt_firmen FOR SELECT TO authenticated
  USING (kontakt_id IN (SELECT k.id FROM public.kontakte k WHERE k.tenant_id IN (SELECT public.s112_crm_partner_tenants())));
CREATE POLICY pipeverlauf_crm_partner ON public.pipeline_verlauf FOR SELECT TO authenticated
  USING (pipeline_id IN (SELECT p.id FROM public.pipeline_eintraege p WHERE p.tenant_id IN (SELECT public.s112_crm_partner_tenants())));

-- 4. Fremdverweis-Modus 'crm'
CREATE OR REPLACE FUNCTION public.s112_fremdverweis_pruefen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_spalte        text := TG_ARGV[0];
  v_ziel          text := TG_ARGV[1];
  v_modus         text := coalesce(TG_ARGV[2], '');
  v_eltern_spalte text := nullif(coalesce(TG_ARGV[3], ''), '');
  v_eltern        text := nullif(coalesce(TG_ARGV[4], ''), '');
  v_neu           jsonb := to_jsonb(NEW);
  v_alt           jsonb;
  v_id            uuid := (v_neu ->> v_spalte)::uuid;
  v_eigen         uuid;
  v_fremd         uuid;
  v_gefunden      boolean;
BEGIN
  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    IF (v_neu ->> v_spalte) IS NOT DISTINCT FROM (v_alt ->> v_spalte)
       AND (v_neu ->> coalesce(v_eltern_spalte, 'tenant_id')) IS NOT DISTINCT FROM (v_alt ->> coalesce(v_eltern_spalte, 'tenant_id')) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_eltern IS NULL THEN
    v_eigen := (v_neu ->> 'tenant_id')::uuid;
  ELSE
    EXECUTE format('SELECT p.tenant_id FROM public.%I p WHERE p.id = $1', v_eltern)
      INTO v_eigen USING (v_neu ->> v_eltern_spalte)::uuid;
  END IF;
  IF v_eigen IS NULL THEN
    RETURN NEW;   -- Elternzeile fehlt: meldet die FK selbst
  END IF;

  EXECUTE format('SELECT true, z.tenant_id FROM public.%I z WHERE z.id = $1', v_ziel) INTO v_gefunden, v_fremd USING v_id;
  IF v_gefunden IS NULL OR v_fremd = v_eigen THEN
    RETURN NEW;   -- fehlendes Ziel meldet die FK selbst
  END IF;
  IF v_modus = 'global' AND v_fremd IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_modus = 'keller' AND EXISTS (
       SELECT 1 FROM public.behaelter b
         JOIN public.keller_freigaben f ON f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = v_eigen AND f.aktiv
        WHERE b.id = v_id AND b.gemeinsam) THEN
    RETURN NEW;
  END IF;
  -- KAN-212: Kontakt/Firma eines Betriebs, der den eigenen in der CRM-Gemeinschaft freigegeben hat
  IF v_modus = 'crm' AND EXISTS (
       SELECT 1 FROM public.crm_freigaben f
        WHERE f.eigentuemer_tenant_id = v_fremd AND f.nutzer_tenant_id = v_eigen AND f.aktiv) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Verweis auf einen Datensatz eines anderen Betriebs (%.% → %).', TG_TABLE_NAME, v_spalte, v_ziel
    USING ERRCODE = '42501', HINT = 'fremdverweis';
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fremdverweis_pruefen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER z_fremdverweis_kontakt_id ON public.verkaufsposten;
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', 'crm', '', '');
DROP TRIGGER z_fremdverweis_firma_id ON public.verkaufsposten;
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', 'crm', '', '');
DROP TRIGGER z_fremdverweis_zh_kontakt_id ON public.verkaufsposten;
CREATE TRIGGER z_fremdverweis_zh_kontakt_id BEFORE INSERT OR UPDATE OF zh_kontakt_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zh_kontakt_id', 'kontakte', 'crm', '', '');
DROP TRIGGER z_fremdverweis_lieferant_kontakt_id ON public.zukauf_posten;
CREATE TRIGGER z_fremdverweis_lieferant_kontakt_id BEFORE INSERT OR UPDATE OF lieferant_kontakt_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferant_kontakt_id', 'kontakte', 'crm', '', '');
DROP TRIGGER z_fremdverweis_lieferant_firma_id ON public.zukauf_posten;
CREATE TRIGGER z_fremdverweis_lieferant_firma_id BEFORE INSERT OR UPDATE OF lieferant_firma_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferant_firma_id', 'firmen', 'crm', '', '');
DROP TRIGGER z_fremdverweis_zh_kontakt_id ON public.zukauf_posten;
CREATE TRIGGER z_fremdverweis_zh_kontakt_id BEFORE INSERT OR UPDATE OF zh_kontakt_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zh_kontakt_id', 'kontakte', 'crm', '', '');
DROP TRIGGER z_fremdverweis_kontakt_id ON public.traubenverkauf;
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', 'crm', '', '');
DROP TRIGGER z_fremdverweis_firma_id ON public.traubenverkauf;
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', 'crm', '', '');

-- 5. Momentaufnahme: Nummern eines anderen Betriebs nicht auf den Beleg
CREATE OR REPLACE FUNCTION public.s112_momentaufnahme_fremd(p_teil jsonb, p_tabelle text, p_id uuid, p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_teil IS NULL OR p_id IS NULL THEN
    RETURN p_teil;
  END IF;
  EXECUTE format('SELECT z.tenant_id FROM public.%I z WHERE z.id = $1', p_tabelle) INTO v_tenant USING p_id;
  IF v_tenant IS NULL OR v_tenant = p_tenant THEN
    RETURN p_teil;
  END IF;
  -- KAN-212: Kundennummer, Debitor und Kreditor gehören dem Eigentümer – auf dem Beleg des Partners leer
  -- (ausdrücklich null, damit die App sie nicht aus den Stammdaten ergänzt), dazu der Hinweis auf die Gemeinschaft
  RETURN p_teil || jsonb_build_object('accountnummer', NULL, 'debitor_nr', NULL, 'kreditor_nr', NULL, 'crm_gemeinschaft', true);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_momentaufnahme_fremd(jsonb, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_momentaufnahme()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_neu jsonb := to_jsonb(NEW);
  v_alt jsonb;
  v     jsonb;
  v_t   uuid := (to_jsonb(NEW) ->> 'tenant_id')::uuid;
  v_fk  text[] := CASE TG_TABLE_NAME
    WHEN 'verkaufsposten'   THEN ARRAY['kontakt_id', 'firma_id', 'zh_kontakt_id']
    WHEN 'zukauf_posten'    THEN ARRAY['lieferant_kontakt_id', 'lieferant_firma_id', 'zh_kontakt_id']
    WHEN 'ea_transaktionen' THEN ARRAY['kategorie_id', 'firma_id']
    ELSE ARRAY['kontakt_id', 'firma_id'] END;
  v_spalte text := CASE WHEN TG_TABLE_NAME = 'ea_transaktionen' THEN 'stamm_daten' ELSE 'partner_daten' END;
BEGIN
  -- Umhängen durch Zusammenführen/Umwandeln: Belege behalten ihre Momentaufnahme
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('s112.momentaufnahme_behalten', true), '') = 'an' THEN
    IF TG_TABLE_NAME = 'ea_transaktionen' THEN NEW.stamm_daten := OLD.stamm_daten; ELSE NEW.partner_daten := OLD.partner_daten; END IF;
    RETURN NEW;
  END IF;
  -- Nur bei echtem Wechsel eines Verweises neu – sonst (auch bei direktem Setzen) bleibt die bestehende Momentaufnahme;
  -- leere (Altzeilen) werden befüllt
  IF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    IF COALESCE(v_alt -> v_spalte, 'null'::jsonb) <> 'null'::jsonb
       AND NOT EXISTS (SELECT 1 FROM unnest(v_fk) k WHERE v_neu -> k IS DISTINCT FROM v_alt -> k) THEN
      IF TG_TABLE_NAME = 'ea_transaktionen' THEN NEW.stamm_daten := OLD.stamm_daten; ELSE NEW.partner_daten := OLD.partner_daten; END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'verkaufsposten' THEN
    v := jsonb_build_object(
      'kontakt', public.s112_momentaufnahme_fremd(public.s112_kontakt_momentaufnahme((v_neu ->> 'kontakt_id')::uuid), 'kontakte', (v_neu ->> 'kontakt_id')::uuid, v_t),
      'firma', public.s112_momentaufnahme_fremd(public.s112_firma_momentaufnahme((v_neu ->> 'firma_id')::uuid), 'firmen', (v_neu ->> 'firma_id')::uuid, v_t),
      'zh_kontakt', public.s112_momentaufnahme_fremd(public.s112_kontakt_momentaufnahme((v_neu ->> 'zh_kontakt_id')::uuid), 'kontakte', (v_neu ->> 'zh_kontakt_id')::uuid, v_t));
    NEW.partner_daten := v;
  ELSIF TG_TABLE_NAME IN ('traubenverkauf', 'exportauftraege') THEN
    v := jsonb_build_object(
      'kontakt', public.s112_momentaufnahme_fremd(public.s112_kontakt_momentaufnahme((v_neu ->> 'kontakt_id')::uuid), 'kontakte', (v_neu ->> 'kontakt_id')::uuid, v_t),
      'firma', public.s112_momentaufnahme_fremd(public.s112_firma_momentaufnahme((v_neu ->> 'firma_id')::uuid), 'firmen', (v_neu ->> 'firma_id')::uuid, v_t));
    NEW.partner_daten := v;
  ELSIF TG_TABLE_NAME = 'zukauf_posten' THEN
    v := jsonb_build_object(
      'lieferant_kontakt', public.s112_momentaufnahme_fremd(public.s112_kontakt_momentaufnahme((v_neu ->> 'lieferant_kontakt_id')::uuid), 'kontakte', (v_neu ->> 'lieferant_kontakt_id')::uuid, v_t),
      'lieferant_firma', public.s112_momentaufnahme_fremd(public.s112_firma_momentaufnahme((v_neu ->> 'lieferant_firma_id')::uuid), 'firmen', (v_neu ->> 'lieferant_firma_id')::uuid, v_t),
      'zh_kontakt', public.s112_momentaufnahme_fremd(public.s112_kontakt_momentaufnahme((v_neu ->> 'zh_kontakt_id')::uuid), 'kontakte', (v_neu ->> 'zh_kontakt_id')::uuid, v_t));
    NEW.partner_daten := v;
  ELSIF TG_TABLE_NAME = 'ea_transaktionen' THEN
    -- Gegenbuchung: Momentaufnahme des Originals (gleiche Bezeichnungen wie die stornierte Buchung)
    IF TG_OP = 'INSERT' AND (v_neu ->> 'storno_von_id') IS NOT NULL THEN
      SELECT e.stamm_daten INTO v FROM public.ea_transaktionen e WHERE e.id = (v_neu ->> 'storno_von_id')::uuid;
    END IF;
    IF v IS NULL THEN
      v := jsonb_build_object(
        'kategorie', (SELECT jsonb_build_object('name', k.name, 'konto_nr', k.konto_nr) FROM public.ea_kategorien k
                       WHERE k.id = (v_neu ->> 'kategorie_id')::uuid),
        'firma', public.s112_firma_momentaufnahme((v_neu ->> 'firma_id')::uuid));
    END IF;
    NEW.stamm_daten := v;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_momentaufnahme() FROM PUBLIC, anon, authenticated;

-- 6. Partner der CRM-Gemeinschaft (Namen der anderen Seite – über RLS nicht lesbar)
CREATE OR REPLACE FUNCTION public.lade_crmgemeinschaft(p_tenant_id uuid)
 RETURNS TABLE(rolle text, partner_tenant_id uuid, partner_name text, notizen text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN 'eigentuemer' ELSE 'nutzer' END AS rolle,
         CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN f.nutzer_tenant_id ELSE f.eigentuemer_tenant_id END AS partner_tenant_id,
         coalesce(nullif(btrim(e.anzeigename), ''), t.name) AS partner_name, f.notizen
  FROM crm_freigaben f
  JOIN tenants t ON t.id = CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN f.nutzer_tenant_id ELSE f.eigentuemer_tenant_id END
  LEFT JOIN tenant_einstellungen e ON e.tenant_id = t.id
  WHERE f.aktiv
    AND (f.eigentuemer_tenant_id = p_tenant_id OR f.nutzer_tenant_id = p_tenant_id)
    AND (session_user = 'postgres'
         OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
         OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
             AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id)))
  ORDER BY 1, 3
$function$;
REVOKE EXECUTE ON FUNCTION public.lade_crmgemeinschaft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lade_crmgemeinschaft(uuid) TO authenticated;
