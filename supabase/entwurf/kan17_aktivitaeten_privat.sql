-- KAN-17 (06.10.2026): Private Aktivitäten per RLS schützen.
-- Entscheidung Jörgen (Kommentar KAN-17): Andere Mitglieder sehen von einer privaten Aktivität nur den Zeitblock „Privat“
-- im Kalender; Betreff, Beschreibung, Kontakt/Firma und Anhänge sieht nur der Ersteller.
--  1. RESTRICTIVE SELECT-Policy akt_privat auf aktivitaeten: private Zeilen nur für den Ersteller – deckt alle Lesepfade
--     ab (Listen, Detailseiten, Dashboard, KI-Abfrage, CRM-Gemeinschaft). Ändern/Löschen fremder privater Zeilen ist
--     damit ebenfalls ausgeschlossen (nicht sichtbar). Private Einträge ohne Ersteller (gelöscht) sieht niemand.
--  2. RESTRICTIVE SELECT-Policy akt_dok_privat auf aktivitaet_dokumente: Anhänge nur zu sichtbaren Aktivitäten.
--  3. RPC s112_privat_bloecke(p_tenant_id): nur Zeitangaben fremder privater Termine (Datum, Uhrzeit, Ersteller) für den
--     Kalender – ohne Betreff, Beschreibung, Kontakt.
-- Stand Staging 06.10.2026: 0 private Aktivitäten.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Private Aktivitäten nur für den Ersteller
CREATE POLICY akt_privat ON public.aktivitaeten AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT coalesce(ist_privat, false) OR erstellt_von = (SELECT auth.uid()));

-- 2. Anhänge nur zu sichtbaren Aktivitäten (die Unterabfrage läuft mit RLS, also mit akt_privat)
CREATE POLICY akt_dok_privat ON public.aktivitaet_dokumente AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.aktivitaeten a WHERE a.id = aktivitaet_id));

-- 3. Zeitblöcke fremder privater Termine für den Kalender
CREATE OR REPLACE FUNCTION public.s112_privat_bloecke(p_tenant_id uuid)
RETURNS TABLE(id uuid, datum date, bis_datum date, ganztags boolean, uhrzeit_von time, uhrzeit_bis time, erledigt boolean, erstellt_von uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  RETURN QUERY
    SELECT a.id, a.datum, a.bis_datum, a.ganztags, a.uhrzeit_von, a.uhrzeit_bis, a.erledigt, a.erstellt_von
      FROM public.aktivitaeten a
     WHERE a.tenant_id = p_tenant_id
       AND a.ist_privat
       AND a.erstellt_von IS DISTINCT FROM auth.uid()
       AND a.datum IS NOT NULL
       AND a.art NOT IN ('verkauf', 'notiz', 'email')
     ORDER BY a.datum, a.id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_privat_bloecke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_privat_bloecke(uuid) TO authenticated;
COMMENT ON FUNCTION public.s112_privat_bloecke(uuid) IS 'KAN-17: Zeitblöcke privater Termine anderer Mitglieder (ohne Inhalt) für den Kalender';
