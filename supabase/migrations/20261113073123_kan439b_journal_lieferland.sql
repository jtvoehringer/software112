-- KAN-439 Teil 2 (13.11.2026): Kellerbuch-Journal – Inland/Ausland nach dem Bestimmungsland des Verkaufs.
--
-- Das Bewegungsjournal bucht einen Flaschen- bzw. Fassverkauf als „im Inland“ (VK_FL_AT …) oder „ins Ausland“
-- (VK_FL_AU …) nach dem Land des Käufers. Bei einer Rechnung aus dem Exportauftrag (KAN-436) kann der Käufer im Inland
-- sitzen und die Ware trotzdem ins Ausland gehen – und umgekehrt. Entscheidung Jörgen 13.11.2026 (Frage 5A):
-- Ist am Verkauf ein Bestimmungsland gespeichert (verkaufsposten.lieferland), entscheidet es; sonst wie bisher das
-- Land des Käufers. Gilt für neue Buchungen; bestehende Journalzeilen bleiben, wie sie sind.
-- Alle Wege (Trigger an Verkauf und Position, Rückbefüllen) laufen über diese eine Funktion.

CREATE OR REPLACE FUNCTION public.s112_journal_verkauf_stand(p jsonb, vp jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ml      integer;
  v_partner jsonb;
BEGIN
  IF p ->> 'typ' = 'flasche' AND p ->> 'fuellung_id' IS NOT NULL THEN
    SELECT f.flaschengroesse_ml INTO v_ml FROM public.fuellungen f WHERE f.id = (p ->> 'fuellung_id')::uuid;
  END IF;
  v_partner := public.s112_journal_partner(vp -> 'partner_daten', 'firma', 'kontakt', (vp ->> 'firma_id')::uuid, (vp ->> 'kontakt_id')::uuid);
  -- KAN-439: Bestimmungsland des Verkaufs vor dem Land des Käufers
  IF NULLIF(btrim(coalesce(vp ->> 'lieferland', '')), '') IS NOT NULL THEN
    v_partner := v_partner || jsonb_build_object('land', upper(btrim(vp ->> 'lieferland')));
  END IF;
  RETURN jsonb_build_object('wirksam', NOT coalesce((vp ->> 'storniert')::boolean, false), 'datum', vp ->> 'datum',
    'zeilen', public.s112_journal_zeilen_verkauf(p, v_partner, v_ml));
END;
$function$;
