-- KAN-439 (13.11.2026): UVA – Steuerfall stornierter Rechnungen aus der Momentaufnahme.
--
-- kan439a holte den Steuerfall einer stornierten Rechnung (und ihres Stornobelegs) über den Lieferschein, der an der
-- Rechnung hängt. Wird nur die Rechnung storniert (nicht der Verkauf), ist der Lieferschein danach wieder „nicht
-- berechnet“ und hängt nicht mehr an ihr – der Steuerfall fehlte, das Storno-Paar stand in der Zeile ohne Kennzahl
-- statt in Kz 011 bzw. 017 (Doppik-Vorschau; fällt auf, wenn Rechnung und Stornobeleg in verschiedenen Zeiträumen liegen).
-- Die Momentaufnahme (storno_positionen) nennt je Position den Lieferschein – darüber kommt der Steuerfall jetzt.

DO $kan439c$
DECLARE
  v_def text;
  c_alt constant text := '(SELECT max(v.steuerfall) FROM verkaufsposten v WHERE v.rechnung_id = o.id AND v.tenant_id = o.tenant_id)';
  c_neu constant text := '(SELECT v.steuerfall FROM verkaufsposten v WHERE v.id = (x.pos ->> ''lieferschein_id'')::uuid AND v.tenant_id = o.tenant_id)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'berechne_ea_uva';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 2 THEN
    RAISE EXCEPTION 'KAN-439: berechne_ea_uva – Ankerstelle nicht genau zweimal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan439c$;
