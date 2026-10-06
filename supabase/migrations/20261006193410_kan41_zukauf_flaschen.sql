-- KAN-41 Paket 2b (06.10.2026): Zukauf Flaschen als Handelsware.
-- Entscheidungen Jörgen (06.10.2026, „alles wie empfohlen“):
--  E1 jeder Flaschenzukauf legt eine eigene Füllung (Weinlager-Artikel) an, E2 Prüfnummer des Erzeugers ab
--  Qualitätswein beim Zukauf Pflicht, E3 nach einer Bewegung der Füllung (Verkauf, Bruch, Inventur …) kein Storno des
--  Zukaufs mehr, E4 EMCS/Verbrauchsteuer später, E5 bestehende Füllungen ohne Charge bleiben unverändert.
--  1. zukauf_posten.art: + 'flaschen'.
--  2. fuellungen.zukauf_posten_id: Bezug der Füllung auf ihren Zukauf (je Zukauf höchstens eine Füllung), Fremdverweis.
--  3. Journal: die Füllung eines Flaschenzukaufs bucht ZK_FLA mit Bezug auf den Zukauf; der Zukauf selbst bucht nichts
--     (s112_journal_zeilen_zukauf kennt nur Wein/Most). Füllungen ohne Charge und ohne Zukauf: unverändert (Rückfall).
--  4. s112_zukauf_buchen: neuer Parameter p_fuellung – Zukauf und Füllung in einer Transaktion; Merkmale der Füllung
--     kommen aus dem Zukauf, Bestand = Anzahl, Einstandspreis je Flasche = Gesamtpreis ÷ Anzahl.
--  5. Freeze: Merkmale eines Flaschenzukaufs sind ab dem Speichern fest (wie die Füllung selbst, KAN-101) –
--     Tippfehler: Storno + Neuanlage, solange die Füllung keine Bewegung hat.
--  6. Storno: Zukauf-Storno storniert die Füllung mit; mit Bewegung abgelehnt (42501, HINT flaschenzukauf_bewegung).
--     Die Füllung eines Flaschenzukaufs lässt sich nicht allein stornieren (HINT flaschenzukauf_ueber_zukauf).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Art ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.zukauf_posten DROP CONSTRAINT zukauf_posten_art_check;
ALTER TABLE public.zukauf_posten ADD CONSTRAINT zukauf_posten_art_check
  CHECK (art = ANY (ARRAY['wein'::text, 'trauben'::text, 'most'::text, 'maische'::text, 'flaschen'::text]));

-- 2. Bezug Füllung → Zukauf ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellungen ADD COLUMN zukauf_posten_id uuid REFERENCES public.zukauf_posten (id);
COMMENT ON COLUMN public.fuellungen.zukauf_posten_id IS
  'KAN-41 Paket 2b: Flaschenzukauf (Handelsware), aus dem die Füllung stammt – nur über s112_zukauf_buchen gesetzt';
CREATE UNIQUE INDEX fuellungen_zukauf_posten_uq ON public.fuellungen (zukauf_posten_id) WHERE zukauf_posten_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_zukauf_posten_id BEFORE INSERT OR UPDATE OF zukauf_posten_id, tenant_id ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zukauf_posten_id', 'zukauf_posten', '', '', '');

-- 3. Journal der Füllung ─────────────────────────────────────────────────────────────────────────────────────
-- Füllung: Abgang offen (Flascheninhalt FUELLUNG, Rest Füllverlust SCHWUND), Zugang Flasche FUELLUNG;
-- ohne Charge: Eröffnungsbestand (import_quelle 'eroeffnungsbestand') EROEFF, Flaschenzukauf (zukauf_posten_id) ZK_FLA
-- mit Bezug, sonst ZK_FLA als Rückfall mit Prüfhinweis
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_fuellung(f jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wa   uuid := (f ->> 'weinausbau_id')::uuid;
  v_ml   integer := coalesce(NULLIF((f ->> 'flaschengroesse_ml')::integer, 0), 750);
  v_stk  integer := greatest(coalesce((f ->> 'anzahl_flaschen')::integer, 0), 0);
  v_fl   numeric := round(greatest(coalesce((f ->> 'anzahl_flaschen')::integer, 0), 0) * v_ml / 1000.0, 3);
  v_tank numeric;
  z      jsonb := '[]'::jsonb;
BEGIN
  IF v_wa IS NOT NULL THEN
    v_tank := coalesce((f ->> 'menge_liter_gefuellt')::numeric, v_fl);
    IF least(v_fl, v_tank) > 0 THEN
      z := z || jsonb_build_object('code', 'FUELLUNG', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -least(v_fl, v_tank));
    END IF;
    IF v_tank - v_fl > 0.0005 THEN
      z := z || jsonb_build_object('code', 'SCHWUND', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -(v_tank - v_fl),
                                   'hinweis', 'Füllverlust (Tankabgang − Flascheninhalt)');
    END IF;
    IF v_stk > 0 THEN
      z := z || jsonb_build_object('code', 'FUELLUNG', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'gegen_weinausbau_id', v_wa);
    END IF;
    RETURN z;
  END IF;
  IF v_stk > 0 THEN
    IF f ->> 'import_quelle' = 'eroeffnungsbestand' THEN
      z := z || jsonb_build_object('code', 'EROEFF', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'hinweis', 'Eröffnungsbestand Flaschen');
    ELSIF f ->> 'zukauf_posten_id' IS NOT NULL THEN
      z := z || jsonb_build_object('code', 'ZK_FLA', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'zukauf_posten_id', f ->> 'zukauf_posten_id', 'hinweis', 'Flaschenzukauf (Handelsware)');
    ELSE
      z := z || jsonb_build_object('code', 'ZK_FLA', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'hinweis', 'Füllung ohne Charge – als Flaschenzukauf gebucht');
    END IF;
  END IF;
  RETURN z;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_fuellung(jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Zukauf atomar – jetzt auch Flaschen mit Füllung ────────────────────────────────────────────────────────
DROP FUNCTION public.s112_zukauf_buchen(uuid, jsonb, jsonb, jsonb);
CREATE FUNCTION public.s112_zukauf_buchen(p_tenant_id uuid, p_zukauf jsonb, p_charge jsonb DEFAULT NULL, p_verschnitt jsonb DEFAULT NULL,
  p_fuellung jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_zukauf constant text[] := ARRAY['datum', 'lieferung_uhrzeit', 'art', 'lieferant_kontakt_id', 'lieferant_firma_id', 'zh_kontakt_id',
    'eingangsrechnungsnummer', 'tbs_nummer_lieferant', 'tbs_jahr_lieferant', 'transport_zugmaschine', 'transport_anhaenger1',
    'transport_anhaenger2', 'weinart', 'rebsorte',
    'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'land_iso', 'jahrgang', 'herkunft', 'anreicherung', 'kmw', 'oechsle',
    'mostgewicht_einheit', 'alkohol_pct', 'staatliche_pruefnummer', 'menge', 'einheit', 'preis_gesamt', 'einstandspreis_pro_liter', 'notizen'];
  c_charge constant text[] := ARRAY['name', 'rebsorte', 'behaelter_id', 'jahrgang', 'menge_liter', 'einstandspreis_pro_liter', 'weinart',
    'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'land_iso', 'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit'];
  -- KAN-41 Paket 2b: Angaben des Weinlager-Artikels; Merkmale, Datum, Anzahl, Prüfnummer und Einstandspreis kommen aus dem Zukauf
  c_fuellung constant text[] := ARRAY['name', 'flaschengroesse_ml', 'vk_preis_brutto', 'mwst_pct', 'zolltarifnummer', 'notizen'];
  v_k        text;
  v_spalten  text;
  v_charge   uuid;
  v_menge    numeric;
  v_zukauf   uuid;
  v_fuellung uuid;
  v_vs       jsonb;
  v_json     jsonb;
  v_flaschen boolean := p_zukauf ->> 'art' = 'flaschen';
  v_stk      numeric;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF p_zukauf IS NULL OR jsonb_typeof(p_zukauf) <> 'object' THEN
    RAISE EXCEPTION 'Bitte die Angaben zum Zukauf übergeben.' USING ERRCODE = '22023';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(p_zukauf) LOOP
    IF NOT v_k = ANY (c_zukauf) THEN
      RAISE EXCEPTION 'Feld „%“ kann beim Zukauf nicht gesetzt werden.', v_k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (p_zukauf ->> 'datum') IS NULL OR (p_zukauf ->> 'art') IS NULL OR coalesce((p_zukauf ->> 'menge')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'Bitte Datum, Art und eine Menge über 0 angeben.' USING ERRCODE = '22023';
  END IF;
  -- Verweise nur aus dem eigenen Betrieb
  IF (p_zukauf ->> 'lieferant_kontakt_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.kontakte k WHERE k.id = (p_zukauf ->> 'lieferant_kontakt_id')::uuid AND k.tenant_id = p_tenant_id)
     OR (p_zukauf ->> 'zh_kontakt_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.kontakte k WHERE k.id = (p_zukauf ->> 'zh_kontakt_id')::uuid AND k.tenant_id = p_tenant_id)
     OR (p_zukauf ->> 'lieferant_firma_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.firmen f WHERE f.id = (p_zukauf ->> 'lieferant_firma_id')::uuid AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Lieferant gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
  END IF;

  -- 0. Flaschenzukauf: nur mit Weinlager-Artikel, nie in ein Gebinde (KAN-41 Paket 2b)
  IF v_flaschen THEN
    IF p_charge IS NOT NULL OR p_verschnitt IS NOT NULL THEN
      RAISE EXCEPTION 'Zugekaufte Flaschen kommen ins Weinlager, nicht in ein Gebinde.' USING ERRCODE = '22023';
    END IF;
    IF p_fuellung IS NULL OR jsonb_typeof(p_fuellung) <> 'object' OR NULLIF(btrim(p_fuellung ->> 'name'), '') IS NULL
       OR (p_fuellung ->> 'flaschengroesse_ml') IS NULL THEN
      RAISE EXCEPTION 'Bitte Produktname und Flaschengröße für das Weinlager angeben.' USING ERRCODE = '22023';
    END IF;
    FOR v_k IN SELECT jsonb_object_keys(p_fuellung) LOOP
      IF NOT v_k = ANY (c_fuellung) THEN
        RAISE EXCEPTION 'Feld „%“ kann für den Weinlager-Artikel nicht gesetzt werden.', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_stk := (p_zukauf ->> 'menge')::numeric;
    IF v_stk <> trunc(v_stk) OR coalesce(p_zukauf ->> 'einheit', 'Stk') <> 'Stk' THEN
      RAISE EXCEPTION 'Zugekaufte Flaschen bitte als ganze Stückzahl (Einheit Stk) angeben.' USING ERRCODE = '22023';
    END IF;
    -- E2: Prüfnummer des Erzeugers ab Qualitätswein, mit Zusatzbezeichnung oder als Sekt g.U. (wie fuellungBrauchtPruefnummer)
    IF (p_zukauf ->> 'qualitaetsstufe' IN ('qualitaetswein', 'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch',
          'trockenbeerenauslese', 'eiswein', 'strohwein', 'dac')
        OR NULLIF(p_zukauf ->> 'zusatzbezeichnung', '') IS NOT NULL OR p_zukauf ->> 'erzeugnis' IN ('SEKTGU', 'sekt'))
       AND NULLIF(btrim(p_zukauf ->> 'staatliche_pruefnummer'), '') IS NULL THEN
      RAISE EXCEPTION 'Für zugekaufte Flaschen ab Qualitätswein bitte die staatliche Prüfnummer des Erzeugers angeben.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_fuellung IS NOT NULL THEN
    RAISE EXCEPTION 'Ein Weinlager-Artikel entsteht nur beim Zukauf von Flaschen.' USING ERRCODE = '22023';
  END IF;

  -- 1. Zukauf-Charge
  IF p_charge IS NOT NULL AND jsonb_typeof(p_charge) = 'object' THEN
    FOR v_k IN SELECT jsonb_object_keys(p_charge) LOOP
      IF NOT v_k = ANY (c_charge) THEN
        RAISE EXCEPTION 'Feld „%“ kann für die Zukauf-Charge nicht gesetzt werden.', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_menge := round(coalesce((p_charge ->> 'menge_liter')::numeric, 0), 2);
    IF (p_charge ->> 'behaelter_id') IS NULL OR v_menge <= 0 THEN
      RAISE EXCEPTION 'Für die Zukauf-Charge bitte Gebinde und Menge angeben.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.behaelter_nutzbar((p_charge ->> 'behaelter_id')::uuid, p_tenant_id) THEN
      RAISE EXCEPTION 'Gebinde gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
    END IF;
    v_json := p_charge || jsonb_build_object('tenant_id', p_tenant_id, 'status', 'ausbau', 'aktiv', true,
                                             'name', coalesce(NULLIF(btrim(p_charge ->> 'name'), ''), NULLIF(btrim(p_charge ->> 'rebsorte'), ''), 'Zukauf'));
    SELECT string_agg(quote_ident(k), ', ') INTO v_spalten FROM jsonb_object_keys(v_json) k;
    EXECUTE format('INSERT INTO public.weinausbau (%s) SELECT %s FROM jsonb_populate_record(NULL::public.weinausbau, $1) RETURNING id', v_spalten, v_spalten)
      INTO v_charge USING v_json;
  ELSIF p_verschnitt IS NOT NULL THEN
    RAISE EXCEPTION 'Ein Verschnitt braucht die Zukauf-Charge.' USING ERRCODE = '22023';
  END IF;

  -- 2. Zukauf-Beleg
  v_json := p_zukauf || jsonb_build_object('tenant_id', p_tenant_id) || CASE WHEN v_charge IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('ziel_weinausbau_id', v_charge) END;
  SELECT string_agg(quote_ident(k), ', ') INTO v_spalten FROM jsonb_object_keys(v_json) k;
  EXECUTE format('INSERT INTO public.zukauf_posten (%s) SELECT %s FROM jsonb_populate_record(NULL::public.zukauf_posten, $1) RETURNING id', v_spalten, v_spalten)
    INTO v_zukauf USING v_json;

  -- 3. Verschnitt der ganzen Zukauf-Charge in die vorhandene Charge
  IF p_verschnitt IS NOT NULL AND jsonb_typeof(p_verschnitt) = 'object' THEN
    IF p_verschnitt ? 'datum' OR p_verschnitt ? 'neue_ziel_charge' THEN
      RAISE EXCEPTION 'Datum und neue Charge kommen beim Zukauf-Verschnitt nicht aus dem Kopf.' USING ERRCODE = '22023';
    END IF;
    v_vs := public.s112_verschnitt_buchen(p_tenant_id,
      p_verschnitt || jsonb_build_object('datum', p_zukauf ->> 'datum'),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_charge, 'menge_liter', v_menge, 'menge_erwartet', v_menge)));
  END IF;

  -- 4. Weinlager-Artikel des Flaschenzukaufs (Journal ZK_FLA über den Trigger der Füllung)
  IF v_flaschen THEN
    SELECT p_fuellung || jsonb_strip_nulls(jsonb_build_object('tenant_id', p_tenant_id, 'zukauf_posten_id', v_zukauf,
             'datum', z.datum, 'anzahl_flaschen', v_stk::integer, 'bestand_flaschen', v_stk::integer,
             'jahrgang', z.jahrgang, 'rebsorte', z.rebsorte, 'qualitaet', z.qualitaetsstufe, 'weinart', z.weinart,
             'zusatzbezeichnung', z.zusatzbezeichnung, 'erzeugnis', z.erzeugnis, 'land_iso', z.land_iso, 'herkunft_code', z.herkunft,
             'pruefnummer', NULLIF(btrim(z.staatliche_pruefnummer), ''),
             'einstandspreis', CASE WHEN z.preis_gesamt IS NOT NULL THEN round(z.preis_gesamt / v_stk, 2) END, 'aktiv', true))
      INTO v_json
      FROM public.zukauf_posten z WHERE z.id = v_zukauf;
    SELECT string_agg(quote_ident(k), ', ') INTO v_spalten FROM jsonb_object_keys(v_json) k;
    EXECUTE format('INSERT INTO public.fuellungen (%s) SELECT %s FROM jsonb_populate_record(NULL::public.fuellungen, $1) RETURNING id', v_spalten, v_spalten)
      INTO v_fuellung USING v_json;
  END IF;

  RETURN jsonb_build_object('zukauf_id', v_zukauf, 'charge_id', v_charge, 'verschnitt', v_vs, 'fuellung_id', v_fuellung);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zukauf_buchen(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;

-- 5. Freeze: Merkmale eines Flaschenzukaufs ab dem Speichern fest ──────────────────────────────────────────
DROP TRIGGER a_freeze ON public.zukauf_posten;
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Folgebuchung an der Charge bzw. Weinlager-Artikel des Zukaufs',
    $$o.storniert_am IS NULL AND o.aktiv AND (o.art = 'flaschen' OR o.ziel_weinausbau_id IS NOT NULL
      AND public.s112_zukauf_hat_folgebuchung(o.ziel_weinausbau_id, o.id))$$,
    'lieferant_kontakt_id,lieferant_firma_id,zh_kontakt_id,partner_daten,eingangsrechnungsnummer,tbs_nummer_lieferant,tbs_jahr_lieferant,lieferung_uhrzeit,transport_zugmaschine,transport_anhaenger1,transport_anhaenger2,preis_gesamt,einstandspreis_pro_liter,staatliche_pruefnummer,notizen,ziel_weinausbau_id,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');

-- 6. Storno: Zukauf storniert die Füllung mit – nur ohne Bewegung ────────────────────────────────────────────
CREATE FUNCTION public.s112_flaschenzukauf_storno()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.art IS DISTINCT FROM 'flaschen' OR NOT ((OLD.storniert_am IS NULL AND NEW.storniert_am IS NOT NULL) OR (OLD.aktiv AND NOT NEW.aktiv)) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.fuellungen f
              WHERE f.zukauf_posten_id = NEW.id AND f.storniert_am IS NULL
                AND (f.bestand_flaschen <> f.anzahl_flaschen
                     OR EXISTS (SELECT 1 FROM public.fuellung_bewegungen b WHERE b.fuellung_id = f.id))) THEN
    RAISE EXCEPTION 'Aus diesem Flaschenzukauf wurde schon verkauft oder gebucht – Stornieren ist nicht mehr möglich. Korrektur über die Bestandskorrektur des Weinlager-Artikels.'
      USING ERRCODE = '42501', HINT = 'flaschenzukauf_bewegung';
  END IF;
  PERFORM set_config('s112.flaschenzukauf_storno', NEW.id::text, true);
  UPDATE public.fuellungen
     SET aktiv = false, aktualisiert_am = now(), storniert_am = coalesce(NEW.storniert_am, now()),
         storno_grund = coalesce(NULLIF(btrim(NEW.storno_grund), ''), 'Storno des Flaschenzukaufs')
   WHERE zukauf_posten_id = NEW.id AND storniert_am IS NULL;
  PERFORM set_config('s112.flaschenzukauf_storno', '', true);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_flaschenzukauf_storno() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_flaschenzukauf_storno AFTER UPDATE OF aktiv, storniert_am ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_flaschenzukauf_storno();

-- Die Füllung eines Flaschenzukaufs nur über den Zukauf stornieren (Wartung mit s112.loeschen_erlaubt ausgenommen)
CREATE FUNCTION public.s112_flaschenzukauf_fuellung_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.zukauf_posten_id IS NOT NULL AND OLD.storniert_am IS NULL AND NEW.storniert_am IS NOT NULL
     AND current_setting('s112.flaschenzukauf_storno', true) IS DISTINCT FROM OLD.zukauf_posten_id::text
     AND current_setting('s112.loeschen_erlaubt', true) IS DISTINCT FROM OLD.tenant_id::text THEN
    RAISE EXCEPTION 'Dieser Weinlager-Artikel stammt aus einem Flaschenzukauf – bitte den Zukauf stornieren (Weinhandel › Zukauf).'
      USING ERRCODE = '42501', HINT = 'flaschenzukauf_ueber_zukauf';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_flaschenzukauf_fuellung_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_flaschenzukauf_schutz BEFORE UPDATE OF storniert_am ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_flaschenzukauf_fuellung_schutz();
