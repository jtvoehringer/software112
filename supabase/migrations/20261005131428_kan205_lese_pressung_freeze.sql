-- KAN-205 (05.10.2026): Lese und Pressung – Sperre nach Verpressung/Verkauf bzw. Folgebuchung (Matrix KAN-85).
--  1. s112_charge_hat_folgebuchung(charge): dieselbe Regel wie die App (lib/kellerbuch/folgebuchungen.ts) – Umzug,
--     Schwund, Verschnitt (Quelle/Ziel), Füllung, Tankverkauf, Zukauf, Kellerbehandlung, Analyse, DAC-Antrag.
--  2. a_freeze auf ernte_parzellen: verpresst bzw. als Trauben verkauft (dieselbe Lese und Ried, Grundstück gleich
--     oder auf einer Seite offen) → Ort, Lesedatum, Qualität, Herkunft, Lese und Jahrgang fest; Menge, Mostgewicht,
--     Lesemethode, Notizen und Storno bleiben (die Deckung der Menge prüft die App).
--  3. a_freeze auf pressungen und pressung_weingaerten: hängt an einer Charge der Pressung eine Folgebuchung, sind
--     Kopf und Traubenzeilen fest (nur Notizen und Storno). Korrektur durch die Betriebsleitung (s112_freeze_korrektur).
-- App: lesePflicht.ts (LESE_/PRESSUNG_FREEZE_GRUND/_ERLAUBT), leseVerbraucht und pressungFest in erntemeldung/actions.ts.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Folgebuchungen einer Charge
CREATE OR REPLACE FUNCTION public.s112_charge_hat_folgebuchung(p_charge uuid)
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
      OR EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.aktiv)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_hat_folgebuchung(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_charge_hat_folgebuchung(uuid) IS
  'KAN-205: hängt an der Charge eine Folgebuchung? (Regel wie lib/kellerbuch/folgebuchungen.ts) – für die Freeze-Bedingungen der Pressung';

-- 2. Lese verpresst bzw. verkauft
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Lese verpresst bzw. als Trauben verkauft',
    $$o.storniert_am IS NULL AND (
        EXISTS (SELECT 1 FROM public.pressung_weingaerten pw JOIN public.pressungen p ON p.id = pw.pressung_id
                 WHERE p.lese_id = o.lese_id AND p.storniert_am IS NULL AND pw.storniert_am IS NULL
                   AND pw.weingarten_id = o.weingarten_id
                   AND (o.grundstueck_id IS NULL OR pw.grundstueck_id IS NULL OR pw.grundstueck_id = o.grundstueck_id))
     OR EXISTS (SELECT 1 FROM public.traubenverkauf tv
                 WHERE tv.lese_id = o.lese_id AND tv.storniert_am IS NULL AND tv.weingarten_id = o.weingarten_id
                   AND (o.grundstueck_id IS NULL OR tv.grundstueck_id IS NULL OR tv.grundstueck_id = o.grundstueck_id)))$$,
    'menge_kg,menge_hl,klosterneuburger,oechsle,mostgewicht_einheit,lesemethode,notizen,weinbezeichnung,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'ernte_datum');

-- 3. Pressung mit Folgebuchung an einer ihrer Chargen
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Folgebuchung an einer Charge der Pressung',
    $$o.storniert_am IS NULL AND EXISTS (
        SELECT 1 FROM public.pressung_behaelter pb
         WHERE pb.pressung_id = o.id AND pb.storniert_am IS NULL AND pb.weinausbau_id IS NOT NULL
           AND public.s112_charge_hat_folgebuchung(pb.weinausbau_id))$$,
    'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.pressung_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Folgebuchung an einer Charge der Pressung',
    $$o.storniert_am IS NULL AND EXISTS (
        SELECT 1 FROM public.pressung_behaelter pb
         WHERE pb.pressung_id = o.pressung_id AND pb.storniert_am IS NULL AND pb.weinausbau_id IS NOT NULL
           AND public.s112_charge_hat_folgebuchung(pb.weinausbau_id))$$,
    'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'ernte_datum');
