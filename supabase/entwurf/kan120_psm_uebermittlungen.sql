-- KAN-120 (08.10.2026): PSM-Übermittlung vorbereiten – Übermittlungsstatus je Aufzeichnung.
-- Entscheidungen Jörgen (Kommentar 06.10.2026): Empfänger Prüfstelle, Format CSV/PDF, Identifikation über die
-- Betriebsnummer, Korrekturweg = nochmalige Vorlage des Berichts, Übermittlung manuell.
--
--  1. behandlungen.version: beginnt mit 1, der Trigger c_version zählt bei jeder inhaltlichen Änderung hoch (alles außer
--     notizen/updated_at; per API nicht direkt setzbar). Grundstücke der Maßnahme ändern die Version nicht – ob eine
--     exportierte Aufzeichnung geändert wurde, erkennt die App am Hash der Exportzeilen.
--  2. psm_uebermittlungen: append-only Protokoll je exportierter Maßnahme (Export-Lauf, Version, Kanal, Status
--     exportiert/korrektur, Hash, Zeilen, Zeitpunkt, Benutzer, referenz_extern) – per API nur lesbar.
--  3. RPC s112_psm_uebermittlung_protokollieren(tenant, kanal, eintraege): schreibt einen Export-Lauf (Betriebsleitung
--     und Mitarbeiter, Abo-Schreibsperre), Status „korrektur“, wenn die Maßnahme schon exportiert war.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Version der Maßnahme ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.behandlungen ADD COLUMN version integer NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.behandlungen.version IS
  'KAN-120: Version der Aufzeichnung – Trigger c_version zählt bei inhaltlicher Änderung hoch (nicht bei notizen)';

CREATE OR REPLACE FUNCTION public.s112_behandlung_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF (to_jsonb(NEW) - 'version' - 'updated_at' - 'notizen') IS DISTINCT FROM (to_jsonb(OLD) - 'version' - 'updated_at' - 'notizen') THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_version() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER c_version BEFORE INSERT OR UPDATE ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_version();

-- 2. Protokoll ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.psm_uebermittlungen (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  behandlung_id         uuid NOT NULL REFERENCES public.behandlungen(id) ON DELETE CASCADE,
  export_id             uuid NOT NULL,
  version               integer NOT NULL,
  kanal                 text NOT NULL CHECK (kanal IN ('csv-datei')),
  status                text NOT NULL CHECK (status IN ('exportiert', 'korrektur')),
  hash                  text NOT NULL,   -- SHA-256 (hex) der Exportzeilen; Format prüft die RPC
  zeilen                integer NOT NULL CHECK (zeilen >= 0),
  referenz_extern       text,
  exportiert_am         timestamptz NOT NULL DEFAULT now(),
  exportiert_von        uuid,
  exportiert_von_name   text
);
CREATE INDEX psm_uebermittlungen_behandlung_idx ON public.psm_uebermittlungen (behandlung_id, exportiert_am DESC);
CREATE INDEX psm_uebermittlungen_tenant_idx ON public.psm_uebermittlungen (tenant_id, exportiert_am DESC);
CREATE INDEX psm_uebermittlungen_export_idx ON public.psm_uebermittlungen (export_id);
COMMENT ON TABLE public.psm_uebermittlungen IS
  'KAN-120: Export-Protokoll der PSM-Aufzeichnungen (append-only) – nur über s112_psm_uebermittlung_protokollieren';

ALTER TABLE public.psm_uebermittlungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.psm_uebermittlungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.psm_uebermittlungen FROM anon;
CREATE POLICY psm_uebermittlungen_select ON public.psm_uebermittlungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.psm_uebermittlungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.psm_uebermittlungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.psm_uebermittlungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.psm_uebermittlungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.psm_uebermittlungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- KAN-178: Verweis nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_behandlung_id BEFORE INSERT OR UPDATE OF behandlung_id, tenant_id ON public.psm_uebermittlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behandlung_id', 'behandlungen', '', '', '');

-- 3. RPC ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_eintraege: [{ "behandlung_id": uuid, "hash": "<sha256 hex>", "zeilen": n }, …] – ein Export-Lauf
CREATE OR REPLACE FUNCTION public.s112_psm_uebermittlung_protokollieren(p_tenant_id uuid, p_kanal text, p_eintraege jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_export uuid := gen_random_uuid();
  v_e      jsonb;
  v_id     uuid;
  v_version integer;
  v_name   text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden');   -- Pflanzenschutz-Aufzeichnungen = Modul Weingarten

  IF p_kanal IS DISTINCT FROM 'csv-datei' THEN
    RAISE EXCEPTION 'Unbekannter Übermittlungskanal „%“', p_kanal USING ERRCODE = '22023';
  END IF;
  IF p_eintraege IS NULL OR jsonb_typeof(p_eintraege) <> 'array' OR jsonb_array_length(p_eintraege) = 0 THEN
    RAISE EXCEPTION 'Keine Aufzeichnungen zum Protokollieren' USING ERRCODE = '22023';
  END IF;

  v_name := public.s112_storno_benutzername(auth.uid());
  FOR v_e IN SELECT * FROM jsonb_array_elements(p_eintraege) LOOP
    v_id := (v_e ->> 'behandlung_id')::uuid;
    IF coalesce(v_e ->> 'hash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Ungültiger Hash der Aufzeichnung' USING ERRCODE = '22023';
    END IF;
    SELECT b.version INTO v_version FROM public.behandlungen b WHERE b.id = v_id AND b.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Maßnahme nicht gefunden' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.psm_uebermittlungen (tenant_id, behandlung_id, export_id, version, kanal, status, hash, zeilen,
      exportiert_von, exportiert_von_name)
    VALUES (p_tenant_id, v_id, v_export, v_version, p_kanal,
      CASE WHEN EXISTS (SELECT 1 FROM public.psm_uebermittlungen u WHERE u.behandlung_id = v_id) THEN 'korrektur' ELSE 'exportiert' END,
      v_e ->> 'hash', coalesce((v_e ->> 'zeilen')::integer, 0), auth.uid(), v_name);
  END LOOP;
  RETURN v_export;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_psm_uebermittlung_protokollieren(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_psm_uebermittlung_protokollieren(uuid, text, jsonb) TO authenticated;
