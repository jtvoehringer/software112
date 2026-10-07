-- KAN-174 F (07.10.2026): „LP-Pickerl“ an einem Gebinde – Hinweis für Lohnproduktion.
-- Ticket: Für Lohnproduktion Gebinde manuell „blockieren“ können – ein Buchungselement „LP + <Bezeichnung>“ (z. B.
-- Name), das nur als Hinweis für die Sachbearbeiter dient, wie ein „Pickerl“: es findet in keiner weiteren Aufzeichnung,
-- keinem Bericht und keinem Lagerstand Einzug und ist mit einem einfachen Löschvorgang entfernbar.
-- Umsetzung: eine Textspalte am Gebinde (kein Bestand, kein Journal, kein Protokoll-relevanter Vorgang); gesetzt und
-- entfernt über die Gebinde-Bearbeitung bzw. das × auf der Kellerbuch-Übersicht. lade_behaelter liefert sie mit
-- (Rückgabetyp erweitert → DROP + CREATE, Rechte wie bisher: authenticated, service_role).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 58, dann Produktion.

ALTER TABLE public.behaelter ADD COLUMN IF NOT EXISTS lp_pickerl text;
ALTER TABLE public.behaelter DROP CONSTRAINT IF EXISTS behaelter_lp_pickerl_chk;
ALTER TABLE public.behaelter ADD CONSTRAINT behaelter_lp_pickerl_chk
  CHECK (lp_pickerl IS NULL OR length(btrim(lp_pickerl)) BETWEEN 1 AND 60);
COMMENT ON COLUMN public.behaelter.lp_pickerl IS
  'KAN-174 F: Hinweis Lohnproduktion („LP + …“) – nur Anzeige, kein Bestand, keine Meldung; leer = kein Pickerl';

DROP FUNCTION IF EXISTS public.lade_behaelter(uuid);
CREATE FUNCTION public.lade_behaelter(p_tenant_id uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, name text, typ text, volumen_liter numeric, standort text, aktiv boolean, gemeinsam boolean, stapler boolean, notizen text, import_quelle text, eigentuemer_name text, fremd boolean, eigen_liter numeric, fremd_liter numeric, fremd_betrieb text, lp_pickerl text)
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
         b.lp_pickerl
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
