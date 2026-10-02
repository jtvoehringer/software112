-- KAN-186 Etappe 2a (02.10.2026): Erzeugnis, Zusatzbezeichnung und Ursprungsland an Charge, Füllung und Zukauf
-- Risikoarm (Analyse 02.10.2026, Kommentar KAN-186): die neuen Spalten werden per Trigger aus dem heutigen Qualitätswert
-- abgeleitet; die Werte im Qualitätsfeld (reserve, erste_lage, grosses_gewachs, sekt, perlwein) bleiben unverändert, damit
-- Verschnitt, Umzug, Füllung, Zukauf, Storno und alle Berichte wie bisher laufen. Bestandsmeldung und BKI-Export können die
-- neuen Spalten sofort lesen. Etappe 2b lässt die Oberfläche die Felder ausdrücklich schreiben, Etappe 2c nimmt die fünf
-- Werte aus dem Qualitätsfeld (offene Entscheidungen: Grundstufe QUW/DAC, „Große Reserve“, Stufe von Perlwein).
--
--  1. weinausbau, fuellungen, zukauf_posten:
--     erzeugnis         → kat_erzeugnis(code), NULL = noch nicht bestimmt
--     zusatzbezeichnung → reserve | erste_lage | grosses_gewachs
--     land_iso          → kat_land(iso2), Standard 'AT' (Ursprungsland des Weins; Zukauf aus EU/Drittland in Etappe 2b)
--  2. s112_katalog_ableiten (BEFORE INSERT bzw. UPDATE OF Qualitätsfeld/art): Zusatz aus reserve/erste_lage/grosses_gewachs,
--     Erzeugnis sekt → SEKTGU, perlwein → PERLWEIN, Zukauf art 'most' → MOST; ein abgeleitetes Erzeugnis verschwindet wieder,
--     wenn das Qualitätsfeld nicht mehr Sekt/Perlwein ist. Ausdrücklich gesetzte andere Erzeugnisse bleiben.
--  3. Bestand nachtragen (nur die neuen Spalten) und die Spalten ins Bestandsprotokoll aufnehmen (z_protokoll_aendern),
--     bei fuellungen zusätzlich weinart (KAN-39 Etappe 1).

-- 1. Spalten ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.weinausbau
  ADD COLUMN erzeugnis text REFERENCES public.kat_erzeugnis(code),
  ADD COLUMN zusatzbezeichnung text CONSTRAINT weinausbau_zusatzbezeichnung_check CHECK (zusatzbezeichnung IN ('reserve', 'erste_lage', 'grosses_gewachs')),
  ADD COLUMN land_iso text NOT NULL DEFAULT 'AT' REFERENCES public.kat_land(iso2);
ALTER TABLE public.fuellungen
  ADD COLUMN erzeugnis text REFERENCES public.kat_erzeugnis(code),
  ADD COLUMN zusatzbezeichnung text CONSTRAINT fuellungen_zusatzbezeichnung_check CHECK (zusatzbezeichnung IN ('reserve', 'erste_lage', 'grosses_gewachs')),
  ADD COLUMN land_iso text NOT NULL DEFAULT 'AT' REFERENCES public.kat_land(iso2);
ALTER TABLE public.zukauf_posten
  ADD COLUMN erzeugnis text REFERENCES public.kat_erzeugnis(code),
  ADD COLUMN zusatzbezeichnung text CONSTRAINT zukauf_posten_zusatzbezeichnung_check CHECK (zusatzbezeichnung IN ('reserve', 'erste_lage', 'grosses_gewachs')),
  ADD COLUMN land_iso text NOT NULL DEFAULT 'AT' REFERENCES public.kat_land(iso2);

-- 2. Ableitung ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_katalog_ableiten()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q   text := CASE TG_TABLE_NAME WHEN 'fuellungen' THEN to_jsonb(NEW) ->> 'qualitaet' ELSE to_jsonb(NEW) ->> 'qualitaetsstufe' END;
  v_art text := CASE TG_TABLE_NAME WHEN 'zukauf_posten' THEN to_jsonb(NEW) ->> 'art' END;
  v_erz text;
BEGIN
  -- KAN-186 Etappe 2a: Zusatzbezeichnung und Erzeugnis aus dem Qualitätswert (bis die Oberfläche sie selbst schreibt)
  NEW.zusatzbezeichnung := CASE WHEN v_q IN ('reserve', 'erste_lage', 'grosses_gewachs') THEN v_q END;
  v_erz := CASE WHEN v_q = 'sekt' THEN 'SEKTGU' WHEN v_q = 'perlwein' THEN 'PERLWEIN' WHEN v_art = 'most' THEN 'MOST' END;
  IF v_erz IS NOT NULL THEN
    NEW.erzeugnis := v_erz;
  ELSIF NEW.erzeugnis IN ('SEKTGU', 'PERLWEIN', 'MOST') THEN
    NEW.erzeugnis := NULL;   -- früher abgeleitet, Qualitätswert/Art passt nicht mehr
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_katalog_ableiten() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_katalog_ableiten BEFORE INSERT OR UPDATE OF qualitaetsstufe ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_katalog_ableiten();
CREATE TRIGGER a_katalog_ableiten BEFORE INSERT OR UPDATE OF qualitaet ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_katalog_ableiten();
CREATE TRIGGER a_katalog_ableiten BEFORE INSERT OR UPDATE OF qualitaetsstufe, art ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_katalog_ableiten();

-- 3. Bestand nachtragen (nur die neuen Spalten) ─────────────────────────────────────────────────────────────────
UPDATE public.weinausbau SET
  zusatzbezeichnung = CASE WHEN qualitaetsstufe IN ('reserve', 'erste_lage', 'grosses_gewachs') THEN qualitaetsstufe END,
  erzeugnis = CASE qualitaetsstufe WHEN 'sekt' THEN 'SEKTGU' WHEN 'perlwein' THEN 'PERLWEIN' END
 WHERE qualitaetsstufe IN ('reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein');
UPDATE public.fuellungen SET
  zusatzbezeichnung = CASE WHEN qualitaet IN ('reserve', 'erste_lage', 'grosses_gewachs') THEN qualitaet END,
  erzeugnis = CASE qualitaet WHEN 'sekt' THEN 'SEKTGU' WHEN 'perlwein' THEN 'PERLWEIN' END
 WHERE qualitaet IN ('reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein');
UPDATE public.zukauf_posten SET
  zusatzbezeichnung = CASE WHEN qualitaetsstufe IN ('reserve', 'erste_lage', 'grosses_gewachs') THEN qualitaetsstufe END,
  erzeugnis = CASE WHEN qualitaetsstufe = 'sekt' THEN 'SEKTGU' WHEN qualitaetsstufe = 'perlwein' THEN 'PERLWEIN' WHEN art = 'most' THEN 'MOST' END
 WHERE qualitaetsstufe IN ('reserve', 'erste_lage', 'grosses_gewachs', 'sekt', 'perlwein') OR art = 'most';

-- 4. Bestandsprotokoll: neue Spalten aufnehmen (Listen wie bisher + neue Spalten) ───────────────────────────────
DROP TRIGGER z_protokoll_aendern ON public.weinausbau;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_liter, anfangsbestand_liter, behaelter_id, aktiv, status, qualitaetsstufe,
  herkunft_code, weinart, rebsorte, jahrgang, ist_eroeffnungsbestand, tenant_id, kmw, oechsle, mostgewicht_einheit, storniert_am,
  storno_grund, weingarten_id, erzeugnis, zusatzbezeichnung, land_iso ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_liter', 'anfangsbestand_liter', 'behaelter_id', 'aktiv',
  'status', 'qualitaetsstufe', 'herkunft_code', 'weinart', 'rebsorte', 'jahrgang', 'ist_eroeffnungsbestand', 'tenant_id', 'kmw',
  'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund', 'weingarten_id', 'erzeugnis', 'zusatzbezeichnung', 'land_iso');
DROP TRIGGER z_protokoll_aendern ON public.fuellungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF bestand_flaschen, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, aktiv,
  weinausbau_id, datum, qualitaet, jahrgang, rebsorte, herkunft_code, pruefnummer, anbaugebiet, tenant_id, storniert_am, storno_grund,
  dac_antrag_id, weinart, erzeugnis, zusatzbezeichnung, land_iso ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('bestand_flaschen', 'anzahl_flaschen', 'menge_liter_gefuellt',
  'flaschengroesse_ml', 'aktiv', 'weinausbau_id', 'datum', 'qualitaet', 'jahrgang', 'rebsorte', 'herkunft_code', 'pruefnummer',
  'anbaugebiet', 'tenant_id', 'storniert_am', 'storno_grund', 'dac_antrag_id', 'weinart', 'erzeugnis', 'zusatzbezeichnung', 'land_iso');
DROP TRIGGER z_protokoll_aendern ON public.zukauf_posten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge, einheit, art, aktiv, ziel_weinausbau_id, datum, tenant_id, kmw, oechsle,
  mostgewicht_einheit, storniert_am, storno_grund, lieferant_kontakt_id, lieferant_firma_id, zh_kontakt_id, erzeugnis, zusatzbezeichnung,
  land_iso ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge', 'einheit', 'art', 'aktiv', 'ziel_weinausbau_id', 'datum',
  'tenant_id', 'kmw', 'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund', 'lieferant_kontakt_id', 'lieferant_firma_id',
  'zh_kontakt_id', 'erzeugnis', 'zusatzbezeichnung', 'land_iso');