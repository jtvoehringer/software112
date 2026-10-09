-- KAN-48 AP11 (09.10.2026): Betriebsdaten und Gebindeverzeichnis für die BKI-Schnittstelle
--
-- Blatt „Betriebsdaten“: Betriebsnummer, Vorname/Firmenname, Nachname/Firmenname, Bez. Betriebsstätte, PLZ, Ort, Straße,
-- Hausnummer (varchar 20), Bio (boolean). Blatt „GebindeVerzeichnis“: Bezeichnung (50), Bezeichnung lang, Material,
-- Aufstellungsort, Nenninhalt (decimal, 3 Stellen).
--
-- 1. tenant_einstellungen: Rechtsform, Vor-/Nachname (natürliche Person), Bezeichnung der Betriebsstätte.
--    betrieb_strasse bleibt „Straße Nr.“ (52 Stellen zeigen sie so an: Briefkopf, Rechnung, Formulare) – Straße und
--    Hausnummer trennt erst der Export mit strasseHausnummer() (src/lib/adresse/strasse.ts).
--    Spaltenrechte wie die übrigen betrieb_*-Spalten (SELECT authenticated/anon, UPDATE authenticated) – geschrieben wird
--    über die Service-Role (saveBetriebOwn bzw. Mandantenverwaltung), der Trigger a_schutz_plattformfelder bleibt.
-- 2. behaelter: material (Vorbelegung aus typ), bezeichnung_lang; Gebindename eindeutig je Betrieb (ohne Groß-/Klein-
--    schreibung und Leerzeichen am Rand) – die Bezeichnung ist der Schlüssel zum Abgleich mit dem Kellerbuch.

BEGIN;

-- ── 1. Betriebsdaten ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN betrieb_rechtsform     text,
  ADD COLUMN betrieb_vorname        text,
  ADD COLUMN betrieb_nachname       text,
  ADD COLUMN betrieb_betriebsstaette text;

ALTER TABLE public.tenant_einstellungen
  ADD CONSTRAINT tenant_einstellungen_rechtsform_check
    CHECK (betrieb_rechtsform IS NULL OR betrieb_rechtsform IN ('natuerliche_person', 'personengesellschaft', 'kapitalgesellschaft', 'sonstige'));

GRANT SELECT (betrieb_rechtsform, betrieb_vorname, betrieb_nachname, betrieb_betriebsstaette)
  ON public.tenant_einstellungen TO authenticated, anon;
GRANT UPDATE (betrieb_rechtsform, betrieb_vorname, betrieb_nachname, betrieb_betriebsstaette)
  ON public.tenant_einstellungen TO authenticated;

-- ── 2. Gebinde ───────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.behaelter
  ADD COLUMN material          text,
  ADD COLUMN bezeichnung_lang  text;

ALTER TABLE public.behaelter
  ADD CONSTRAINT behaelter_material_laenge CHECK (material IS NULL OR length(material) <= 255),
  ADD CONSTRAINT behaelter_bezeichnung_lang_laenge CHECK (bezeichnung_lang IS NULL OR length(bezeichnung_lang) <= 255);

-- Vorbelegung aus dem Typ (nur eindeutige Fälle; Bottich, Gärständer, Lagertank, Presse, Sonstiges bleiben offen)
UPDATE public.behaelter SET material = CASE typ
    WHEN 'stahltank'      THEN 'Edelstahl'
    WHEN 'immervolltank'  THEN 'Edelstahl'
    WHEN 'holzfass'       THEN 'Holz'
    WHEN 'barrique'       THEN 'Holz'
    WHEN 'doppelbarrique' THEN 'Holz'
    WHEN 'betonei'        THEN 'Beton'
    WHEN 'amphore'        THEN 'Ton'
  END
 WHERE material IS NULL;

CREATE UNIQUE INDEX behaelter_name_je_betrieb ON public.behaelter (tenant_id, lower(trim(name)));

-- lade_behaelter liefert Material und Langbezeichnung mit (Gebindeverzeichnis inkl. mitbenutzter Gebinde der
-- Kellergemeinschaft). Neuer Rückgabetyp → DROP + CREATE; Körper sonst unverändert, Rechte wie bisher.
DROP FUNCTION public.lade_behaelter(uuid);
CREATE FUNCTION public.lade_behaelter(p_tenant_id uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, name text, typ text, volumen_liter numeric, standort text, aktiv boolean, gemeinsam boolean, stapler boolean, notizen text, import_quelle text, eigentuemer_name text, fremd boolean, eigen_liter numeric, fremd_liter numeric, fremd_betrieb text, lp_pickerl text, material text, bezeichnung_lang text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id, b.tenant_id, b.name, b.typ, b.volumen_liter, b.standort, b.aktiv,
         b.gemeinsam, b.stapler, b.notizen, b.import_quelle,
         t.name AS eigentuemer_name,
         (b.tenant_id <> p_tenant_id) AS fremd,
         COALESCE((SELECT SUM(w.menge_liter) FROM weinausbau w
                   WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id = p_tenant_id), 0) AS eigen_liter,
         COALESCE((SELECT SUM(w.menge_liter) FROM weinausbau w
                   WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id <> p_tenant_id AND COALESCE(w.menge_liter, 0) > 0), 0) AS fremd_liter,
         (SELECT t2.name FROM weinausbau w JOIN tenants t2 ON t2.id = w.tenant_id
          WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id <> p_tenant_id AND COALESCE(w.menge_liter, 0) > 0
          ORDER BY w.updated_at DESC LIMIT 1) AS fremd_betrieb,
         b.lp_pickerl,
         b.material,
         b.bezeichnung_lang
  FROM behaelter b
  JOIN tenants t ON t.id = b.tenant_id
  WHERE (
          session_user = 'postgres'
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
          OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id))
        )
    AND (
          b.tenant_id = p_tenant_id
          OR (b.gemeinsam AND EXISTS (
                SELECT 1 FROM keller_freigaben f
                WHERE f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = p_tenant_id AND f.aktiv))
        )
  ORDER BY b.name
$function$;
REVOKE EXECUTE ON FUNCTION public.lade_behaelter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lade_behaelter(uuid) TO authenticated, service_role;

-- ── Selbstprüfung ────────────────────────────────────────────────────────────────────────────────────────────────
DO $p$
BEGIN
  IF has_column_privilege('authenticated', 'public.tenant_einstellungen', 'betrieb_betriebsstaette', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'KAN-48: SELECT auf betrieb_betriebsstaette fehlt';
  END IF;
  IF has_function_privilege('anon', 'public.lade_behaelter(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.lade_behaelter(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-48: Rechte auf lade_behaelter falsch';
  END IF;
END $p$;

COMMIT;