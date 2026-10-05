-- KAN-204 (05.10.2026): Charge gesperrt, solange ein Prüfnummernantrag eingereicht bzw. in Prüfung ist (Matrix KAN-85,
-- Soll „ab PN-Antrag Eingereicht alles“). Merkmale (Jahrgang, Rebsorte, Weinart, Qualität, Zusatz, Erzeugnis, Herkunft,
-- Mostgewicht, Rieden …) per API nicht änderbar; Bestand, Gebinde (Umzug), Status, Aktiv, Bezeichnung, Notizen,
-- Einstandspreis und Storno bleiben änderbar – Umzug, Füllung, Verkauf und Schwund laufen weiter. Nach dem Bescheid
-- (zugeteilt) endet die DB-Sperre; die App sperrt dann Jahrgang, Rebsorte, Weinart, Mostgewicht und Rieden weiter,
-- Abstufen bleibt möglich und beendet die Prüfnummer (KAN-100). Korrektur durch die Betriebsleitung über
-- s112_freeze_korrektur. App: chargePnSperre (src/lib/kellerbuch/chargeRegeln.ts).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Prüfnummernantrag eingereicht',
    $$o.storniert_am IS NULL AND EXISTS (
        SELECT 1 FROM public.dac_antrag d
         WHERE d.weinausbau_id = o.id AND d.storniert_am IS NULL AND d.status IN ('eingereicht', 'in_pruefung'))$$,
    'name,behaelter_id,menge_liter,status,aktiv,notizen,einstandspreis_pro_liter,updated_at,storniert_am,storniert_von,storniert_von_name,storno_grund',
    '');
