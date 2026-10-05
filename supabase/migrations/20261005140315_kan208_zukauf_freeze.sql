-- KAN-208 (05.10.2026): Zukauf-Merkmale nach Folgebuchung, Demo-Sekt mit Prüfnummer (Matrix KAN-85).
--  1. s112_zukauf_hat_folgebuchung(charge, zukauf): wie s112_charge_hat_folgebuchung (KAN-205), aber ohne den Zukauf
--     selbst (er ist der Zugang der Charge, keine Folgebuchung).
--  2. a_freeze auf zukauf_posten: hängt an der Zielcharge eine Folgebuchung, sind die Merkmale (Datum, Art, Weinart,
--     Sorte, Jahrgang, Qualität, Herkunft, Land, Mostgewicht, Alkohol, Anreicherung, Menge, Einheit) fest; Beleg-
--     und Transportangaben, Lieferant, Preise, Notizen und Storno bleiben. App: updateZukauf (merkmaleFest).
--  3. Demo-Reset: „Musterhof Brut Sekt“ bekommt eine Prüfnummer wie die anderen Füllungen – ein Flaschenverkauf ab
--     Qualitätswein ohne zugeteilte Prüfnummer wird jetzt abgelehnt (Entscheidung Jörgen 05.10.2026).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Folgebuchungen der Zielcharge eines Zukaufs
CREATE OR REPLACE FUNCTION public.s112_zukauf_hat_folgebuchung(p_charge uuid, p_zukauf uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.keller_umzuege u WHERE u.storniert_am IS NULL AND (u.von_weinausbau_id = p_charge OR u.nach_weinausbau_id = p_charge))
      OR EXISTS (SELECT 1 FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id
                  WHERE q.quell_weinausbau_id = p_charge AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = p_charge AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.weinausbau_id = p_charge AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.fuellung_chargen fc JOIN public.fuellungen f ON f.id = fc.fuellung_id WHERE fc.weinausbau_id = p_charge AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.verkaufsposten k ON k.id = vp.verkaufsposten_id
                  WHERE vp.weinausbau_id = p_charge AND vp.typ = 'tank' AND NOT coalesce(k.storniert, false))
      OR EXISTS (SELECT 1 FROM public.keller_behandlungen b WHERE b.weinausbau_id = p_charge AND b.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.weinanalysen a WHERE a.weinausbau_id = p_charge)
      OR EXISTS (SELECT 1 FROM public.dac_antrag d WHERE d.weinausbau_id = p_charge)
      OR EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.aktiv AND z.id <> p_zukauf)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zukauf_hat_folgebuchung(uuid, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_zukauf_hat_folgebuchung(uuid, uuid) IS
  'KAN-208: Folgebuchung an der Zielcharge eines Zukaufs (ohne den Zukauf selbst) – Freeze-Bedingung zukauf_posten';

-- 2. Zukauf-Merkmale fest nach Folgebuchung
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Folgebuchung an der Charge des Zukaufs',
    $$o.storniert_am IS NULL AND o.aktiv AND o.ziel_weinausbau_id IS NOT NULL
      AND public.s112_zukauf_hat_folgebuchung(o.ziel_weinausbau_id, o.id)$$,
    'lieferant_kontakt_id,lieferant_firma_id,zh_kontakt_id,partner_daten,eingangsrechnungsnummer,lieferung_uhrzeit,transport_zugmaschine,transport_anhaenger1,transport_anhaenger2,preis_gesamt,einstandspreis_pro_liter,staatliche_pruefnummer,notizen,ziel_weinausbau_id,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');

-- 3. Demo-Reset: Sekt mit Prüfnummer
DO $$
DECLARE
  c_alt constant text := $a$'Kremstal', 750, 1600, 19.90, false, null, null, 7.90$a$;
  c_neu constant text := $a$'Kremstal', 750, 1600, 19.90, false, 'N ' || (10933 + y1 % 100) || '/' || (y1 % 100), null, 7.90$a$;
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-208: Stelle „%“ im Demo-Reset nicht genau einmal gefunden', c_alt;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END $$;
