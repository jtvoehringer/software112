-- KAN-35 Schritt 3 (nach dem App-Deploy ba0a4a9, 24.09.2026): Tankverkauf nur noch aus
-- Chargen. Die App schreibt verkauf_positionen.zukauf_id / pressung_behaelter_id nicht mehr;
-- die Datenbank erzwingt das jetzt. Fristen-Link erneut (vorlage.ts/fristErledigen haben bis
-- zum Deploy noch '/reports/keller' angelegt).
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM public.verkauf_positionen
              WHERE zukauf_id IS NOT NULL OR pressung_behaelter_id IS NOT NULL) THEN
    RAISE EXCEPTION 'KAN-35: Verkaufspositionen mit Zukauf-/Pressungsbezug vorhanden – zuerst rekonstruieren (Bereich A)';
  END IF;
END $g$;

ALTER TABLE public.verkauf_positionen ADD CONSTRAINT verkauf_positionen_nur_charge_check
  CHECK (zukauf_id IS NULL AND pressung_behaelter_id IS NULL);

UPDATE public.fristen SET href = '/reports/ama', aktualisiert_am = now()
 WHERE href = '/reports/keller' AND bezeichnung LIKE 'Bestandsmeldung Wein%';
