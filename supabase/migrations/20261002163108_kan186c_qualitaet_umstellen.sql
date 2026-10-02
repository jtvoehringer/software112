-- KAN-186 Etappe 2b/2c (02.10.2026): Reserve, Erste Lage, Großes Gewächs, Sekt und Perlwein raus aus dem Qualitätsfeld
-- Entscheidungen Jörgen 02.10.2026: Grundstufe bei Reserve/Erste Lage/Großes Gewächs/Große Reserve immer Qualitätswein;
-- „Große Reserve“ wird Zusatzbezeichnung (Stillwein; Sekt-Stufen eigenes Ticket KAN-190); Sekt = Qualitätswein + Erzeugnis
-- SEKTGU; Perlwein = Qualitätswein + Erzeugnis PERLWEIN (Abstufung auf Landwein/Wein möglich).
-- Einzuspielen direkt nach dem Deploy des App-Teils (der liest Altwerte tolerant und schreibt nur noch normalisiert).
--
--  1. Momentaufnahmen für Storno: keller_umzuege.zusatz_vorher/_nachher, erzeugnis_vorher/_nachher;
--     verschneidungen.ziel_zusatz_vorher, ziel_erzeugnis_vorher (ältere Buchungen: Altwert im Qualitäts-Snapshot).
--  2. Zusatzbezeichnung += grosse_reserve (weinausbau, fuellungen, zukauf_posten).
--  3. s112_katalog_ableiten normalisiert jetzt: ein Altwert im Qualitätsfeld (z. B. aus einer alten Storno-Momentaufnahme
--     oder den Demo-Daten) wird beim Schreiben zu Qualitätswein + Zusatzbezeichnung bzw. + Erzeugnis; sonst bleiben die
--     ausdrücklich geschriebenen Felder unverändert (Zukauf Most ohne Erzeugnis → MOST).
--  4. Bestand umstellen (UPDATE auf sich selbst, der Trigger normalisiert; Bestandsprotokoll schreibt mit).
--  5. CHECKs von weinausbau.qualitaetsstufe und fuellungen.qualitaet ohne die fünf Altwerte.

-- 1. Momentaufnahmen ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.keller_umzuege
  ADD COLUMN zusatz_vorher text, ADD COLUMN zusatz_nachher text,
  ADD COLUMN erzeugnis_vorher text, ADD COLUMN erzeugnis_nachher text;
ALTER TABLE public.verschneidungen
  ADD COLUMN ziel_zusatz_vorher text, ADD COLUMN ziel_erzeugnis_vorher text;

-- 2. Große Reserve ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.weinausbau DROP CONSTRAINT weinausbau_zusatzbezeichnung_check,
  ADD CONSTRAINT weinausbau_zusatzbezeichnung_check CHECK (zusatzbezeichnung IN ('reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'));
ALTER TABLE public.fuellungen DROP CONSTRAINT fuellungen_zusatzbezeichnung_check,
  ADD CONSTRAINT fuellungen_zusatzbezeichnung_check CHECK (zusatzbezeichnung IN ('reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'));
ALTER TABLE public.zukauf_posten DROP CONSTRAINT zukauf_posten_zusatzbezeichnung_check,
  ADD CONSTRAINT zukauf_posten_zusatzbezeichnung_check CHECK (zusatzbezeichnung IN ('reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs'));

-- 3. Normalisierung beim Schreiben ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_katalog_ableiten()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q   text := CASE TG_TABLE_NAME WHEN 'fuellungen' THEN to_jsonb(NEW) ->> 'qualitaet' ELSE to_jsonb(NEW) ->> 'qualitaetsstufe' END;
  v_art text := CASE TG_TABLE_NAME WHEN 'zukauf_posten' THEN to_jsonb(NEW) ->> 'art' END;
BEGIN
  -- KAN-186 2c: Altwerte im Qualitätsfeld (alte Storno-Momentaufnahmen, Demo-Daten, Importe) → Qualitätswein + Zusatz/Erzeugnis
  IF v_q IN ('reserve', 'grosse_reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein') THEN
    IF v_q IN ('sekt', 'perlwein') THEN
      NEW.erzeugnis := CASE v_q WHEN 'sekt' THEN 'SEKTGU' ELSE 'PERLWEIN' END;
      NEW.zusatzbezeichnung := NULL;
    ELSE
      NEW.zusatzbezeichnung := v_q;
    END IF;
    IF TG_TABLE_NAME = 'fuellungen' THEN
      NEW.qualitaet := 'qualitaetswein';
    ELSE
      NEW.qualitaetsstufe := 'qualitaetswein';
    END IF;
  END IF;
  IF v_art = 'most' AND NEW.erzeugnis IS NULL THEN
    NEW.erzeugnis := 'MOST';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_katalog_ableiten() FROM PUBLIC, anon, authenticated;

-- 4. Bestand umstellen (der Trigger normalisiert) ───────────────────────────────────────────────────────────────
UPDATE public.weinausbau SET qualitaetsstufe = qualitaetsstufe
 WHERE qualitaetsstufe IN ('reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein');
UPDATE public.fuellungen SET qualitaet = qualitaet
 WHERE qualitaet IN ('reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein');
UPDATE public.zukauf_posten SET qualitaetsstufe = qualitaetsstufe
 WHERE qualitaetsstufe IN ('reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein');

-- 5. Qualitätsfeld ohne Altwerte ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.weinausbau DROP CONSTRAINT weinausbau_qualitaetsstufe_check,
  ADD CONSTRAINT weinausbau_qualitaetsstufe_check CHECK (qualitaetsstufe IS NULL OR qualitaetsstufe IN ('wein', 'landwein', 'qualitaetswein',
    'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch', 'trockenbeerenauslese', 'eiswein', 'strohwein', 'dac', 'sonstiges'));
ALTER TABLE public.fuellungen DROP CONSTRAINT fuellungen_qualitaet_check,
  ADD CONSTRAINT fuellungen_qualitaet_check CHECK (qualitaet IN ('wein', 'landwein', 'qualitaetswein',
    'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch', 'trockenbeerenauslese', 'eiswein', 'strohwein', 'dac', 'sonstiges'));