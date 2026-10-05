-- Hotfix (05.10.2026): Titel in der Anschrift – die Momentaufnahme des Kontakts auf Belegen (Verkauf, Traubenverkauf,
-- Zukauf, Export; KAN-150 F1c) hält auch Titel und nachgestellten Titel fest, damit eine spätere Titeländerung alte
-- Belege nicht verändert. Bestehende Momentaufnahmen bleiben, wie sie sind (dort gilt der aktuelle Titel, weil die
-- App fehlende Felder aus den Stammdaten ergänzt).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE OR REPLACE FUNCTION public.s112_kontakt_momentaufnahme(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('titel', k.titel, 'vorname', k.vorname, 'nachname', k.nachname, 'titel_nachgestellt', k.titel_nachgestellt,
           'strasse', k.strasse, 'plz', k.plz, 'ort', k.ort,
           'land', k.land, 'telefon', k.telefon, 'telefon_vorwahl', k.telefon_vorwahl, 'betrieb_nr', k.betrieb_nr,
           'accountnummer', k.accountnummer, 'debitor_nr', k.debitor_nr, 'zahlungsziel_tage', k.zahlungsziel_tage)
    FROM public.kontakte k WHERE k.id = p_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kontakt_momentaufnahme(uuid) FROM PUBLIC, anon, authenticated;
