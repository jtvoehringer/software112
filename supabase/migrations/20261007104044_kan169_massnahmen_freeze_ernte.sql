-- KAN-169 (07.10.2026): Maßnahmen einer Ried nach der Ernte sperren.
-- Ticket: „wenn eine Ried das erste Mal geerntet wurde, dürfen Maßnahmen, die diese Ried betreffen, nicht mehr
-- storniert/bearbeitet werden können.“ Umsetzung mit dem Freeze-Baustein (KAN-96, s112_freeze, Positivliste):
--   Eine nicht stornierte Maßnahme (behandlungen) ist gesperrt, sobald ihre Ried – die Ried der Maßnahme selbst oder
--   die Ried eines ihrer Grundstücke (behandlung_grundstuecke) – eine nicht stornierte Lese (ernte_parzellen, Ried
--   direkt oder über das Grundstück) mit Lesedatum am oder nach dem Datum der Maßnahme hat. Maßnahmen nach der Lese
--   (z. B. Winterschnitt) bleiben bis zur nächsten Lese bearbeitbar.
--   Änderbar bleiben nur Notizen; Stornieren (storniert_*) ist gesperrt. Grundstücke der Maßnahme: keine Änderung.
--   Korrektur nur durch die Betriebsleitung über s112_freeze_korrektur (mit Grund, Bestandsprotokoll) – die RPC
--   akzeptiert jede Tabelle mit s112_freeze-Trigger, also auch behandlungen; Wartung (s112.loeschen_erlaubt) passiert.
--   Wird die Lese storniert, ist die Maßnahme wieder frei.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 57, dann Produktion.

-- Bedingung je Maßnahme (Alias o = bisherige Zeile von behandlungen)
CREATE OR REPLACE FUNCTION public.s112_massnahme_geerntet(p_behandlung_id uuid, p_weingarten_id uuid, p_datum date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p_datum IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.ernte_parzellen ep
      LEFT JOIN public.grundstuecke eg ON eg.id = ep.grundstueck_id
     WHERE ep.storniert_am IS NULL
       AND ep.ernte_datum >= p_datum
       AND coalesce(ep.weingarten_id, eg.weingarten_id) IN (
             SELECT p_weingarten_id WHERE p_weingarten_id IS NOT NULL
             UNION
             SELECT g.weingarten_id
               FROM public.behandlung_grundstuecke bg
               JOIN public.grundstuecke g ON g.id = bg.grundstueck_id
              WHERE bg.behandlung_id = p_behandlung_id AND g.weingarten_id IS NOT NULL))
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_massnahme_geerntet(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_freeze_ernte ON public.behandlungen;
CREATE TRIGGER a_freeze_ernte BEFORE UPDATE OR DELETE ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Ried nach der Maßnahme geerntet',
    'o.storniert_am IS NULL AND public.s112_massnahme_geerntet(o.id, o.weingarten_id, o.datum)',
    'notizen,updated_at',
    '');

DROP TRIGGER IF EXISTS a_freeze_ernte ON public.behandlung_grundstuecke;
CREATE TRIGGER a_freeze_ernte BEFORE UPDATE OR DELETE ON public.behandlung_grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Ried nach der Maßnahme geerntet',
    'EXISTS (SELECT 1 FROM public.behandlungen b WHERE b.id = o.behandlung_id AND b.storniert_am IS NULL
              AND public.s112_massnahme_geerntet(b.id, b.weingarten_id, b.datum))',
    '',
    '');
