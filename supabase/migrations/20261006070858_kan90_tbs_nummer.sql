-- KAN-90 (06.10.2026): Transportscheinnummer (TBS-Nr.) bei Verkauf und Zukauf.
--  1. transportbescheinigungen += tbs_nummer, tbs_jahr – abgeleitet aus formular_daten (laufende_nr, jahr) durch den
--     Trigger b_tbs_spalten (Spalte und Formular stimmen immer überein; direkte Schreibversuche überschreibt er).
--     Partieller UNIQUE (tenant_id, tbs_jahr, tbs_nummer) für nicht stornierte Bescheinigungen mit Nummer:
--     ein Duplikat im selben Jahr lehnt die Datenbank ab (23505).
--  2. zukauf_posten += tbs_nummer_lieferant, tbs_jahr_lieferant (Transportbescheinigung des Lieferanten) – Belegangabe
--     wie die Eingangsrechnungsnummer: auch nach einer Folgebuchung änderbar (Positivliste a_freeze), protokolliert
--     (z_protokoll_aendern), von s112_zukauf_buchen angenommen.
-- Der Protokolltrigger auf transportbescheinigungen besteht schon (formular_daten, Storno); tbs_* sind daraus abgeleitet.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. TBS-Nr. der eigenen Transportbescheinigung
ALTER TABLE public.transportbescheinigungen
  ADD COLUMN tbs_nummer text,
  ADD COLUMN tbs_jahr integer;
COMMENT ON COLUMN public.transportbescheinigungen.tbs_nummer IS 'KAN-90: laufende Nummer der TBS (= formular_daten.laufende_nr, Trigger b_tbs_spalten)';
COMMENT ON COLUMN public.transportbescheinigungen.tbs_jahr IS 'KAN-90: Jahr der TBS-Nummer (= formular_daten.jahr, vierstellig, Trigger b_tbs_spalten)';

CREATE OR REPLACE FUNCTION public.s112_tbs_spalten()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_jahr text := btrim(coalesce(NEW.formular_daten ->> 'jahr', ''));
BEGIN
  NEW.tbs_nummer := NULLIF(btrim(coalesce(NEW.formular_daten ->> 'laufende_nr', '')), '');
  NEW.tbs_jahr := CASE WHEN v_jahr ~ '^\d{4}$' THEN v_jahr::integer END;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_tbs_spalten() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_tbs_spalten BEFORE INSERT OR UPDATE ON public.transportbescheinigungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_tbs_spalten();

-- Bestand nachziehen (ausgestellte sind fest – Sperre nur für diese Anweisung aufheben)
SELECT set_config('s112.freeze_frei', 'transportbescheinigungen', true);
UPDATE public.transportbescheinigungen SET tbs_nummer = NULL;   -- der Trigger leitet beide Spalten neu ab (kein Protokolleintrag)
SELECT set_config('s112.freeze_frei', '', true);

CREATE UNIQUE INDEX transportbescheinigungen_tbs_nummer_uq ON public.transportbescheinigungen (tenant_id, tbs_jahr, tbs_nummer)
  WHERE storniert_am IS NULL AND tbs_nummer IS NOT NULL;

-- 2. TBS-Nr. des Lieferanten beim Zukauf
ALTER TABLE public.zukauf_posten
  ADD COLUMN tbs_nummer_lieferant text CONSTRAINT zukauf_posten_tbs_nummer_chk CHECK (tbs_nummer_lieferant IS NULL OR length(btrim(tbs_nummer_lieferant)) BETWEEN 1 AND 30),
  ADD COLUMN tbs_jahr_lieferant integer CONSTRAINT zukauf_posten_tbs_jahr_chk CHECK (tbs_jahr_lieferant IS NULL OR tbs_jahr_lieferant BETWEEN 2000 AND 2100);
COMMENT ON COLUMN public.zukauf_posten.tbs_nummer_lieferant IS 'KAN-90: laufende Nummer der Transportbescheinigung des Lieferanten';
COMMENT ON COLUMN public.zukauf_posten.tbs_jahr_lieferant IS 'KAN-90: Jahr der Transportbescheinigung des Lieferanten';

DROP TRIGGER a_freeze ON public.zukauf_posten;
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Folgebuchung an der Charge des Zukaufs',
    $$o.storniert_am IS NULL AND o.aktiv AND o.ziel_weinausbau_id IS NOT NULL
      AND public.s112_zukauf_hat_folgebuchung(o.ziel_weinausbau_id, o.id)$$,
    'lieferant_kontakt_id,lieferant_firma_id,zh_kontakt_id,partner_daten,eingangsrechnungsnummer,tbs_nummer_lieferant,tbs_jahr_lieferant,lieferung_uhrzeit,transport_zugmaschine,transport_anhaenger1,transport_anhaenger2,preis_gesamt,einstandspreis_pro_liter,staatliche_pruefnummer,notizen,ziel_weinausbau_id,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');

DROP TRIGGER z_protokoll_aendern ON public.zukauf_posten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge, einheit, art, aktiv, ziel_weinausbau_id, datum, tenant_id, kmw, oechsle,
    mostgewicht_einheit, storniert_am, storno_grund, lieferant_kontakt_id, lieferant_firma_id, zh_kontakt_id, erzeugnis,
    zusatzbezeichnung, land_iso, tbs_nummer_lieferant, tbs_jahr_lieferant ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge', 'einheit', 'art', 'aktiv', 'ziel_weinausbau_id', 'datum',
    'tenant_id', 'kmw', 'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund', 'lieferant_kontakt_id', 'lieferant_firma_id',
    'zh_kontakt_id', 'erzeugnis', 'zusatzbezeichnung', 'land_iso', 'tbs_nummer_lieferant', 'tbs_jahr_lieferant');

-- 3. s112_zukauf_buchen nimmt die TBS-Nr. des Lieferanten an (sonst unverändert, Stand KAN-193)
CREATE OR REPLACE FUNCTION public.s112_zukauf_buchen(p_tenant_id uuid, p_zukauf jsonb, p_charge jsonb DEFAULT NULL, p_verschnitt jsonb DEFAULT NULL)
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
  v_k        text;
  v_spalten  text;
  v_charge   uuid;
  v_menge    numeric;
  v_zukauf   uuid;
  v_vs       jsonb;
  v_json     jsonb;
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

  RETURN jsonb_build_object('zukauf_id', v_zukauf, 'charge_id', v_charge, 'verschnitt', v_vs);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zukauf_buchen(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;