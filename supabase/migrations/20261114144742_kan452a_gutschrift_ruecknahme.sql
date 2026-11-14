-- KAN-452 G2 (14.11.2026, Plan freigegeben von Jörgen: Fragen 1–4 und 6 A, 5 B): Gutschrift mit Rücknahme in den Bestand.
--
-- Bisher (KAN-419 G1) berichtigt eine Gutschrift nur den Betrag – der Bestand bleibt unberührt. Neu: je Position der
-- Gutschrift „Ware kommt zurück“ (p_positionen[].ruecknahme = true). Dann bucht s112_gutschrift_anlegen die ganze
-- gutgeschriebene Menge der Position in derselben Transaktion wie den Beleg am Datum der Gutschrift wieder ein:
--   * Flaschen einer Füllung: fuellung_bewegungen art 'ruecknahme' (Zugang, mit Verkaufsbezug) + bestand_flaschen;
--     im Kellerbuch-Journal wie ein Verkaufsstorno: Buchungsart des Verkaufs (VK_FL_AT/AU) mit positivem Vorzeichen,
--     Hinweis „Rücknahme zu Gutschrift GS-…“ (Entscheidung 1 A)
--   * Produkte mit Lagerbestand: sonstige_artikel_bewegungen art 'ruecknahme' (Zugang)
--   * beide Bewegungen tragen gutschrift_id → Gutschrift (für den Storno einer Gutschrift, KAN-453)
--   * nicht für Tankwein, Weintrauben, freie Positionen, Produkte ohne Lagerbestand
--   * Füllung storniert bzw. Produkt deaktiviert → Ablehnung (4 A); Datum im abgeschlossenen Kellerbuch-Zeitraum →
--     Ablehnung (3 A); scheitert die Rückbuchung, entsteht auch keine Gutschrift
--   * die Momentaufnahme gutschrift_positionen merkt je Zeile ruecknahme (true/false)
-- Ohne Rücknahme ändert sich nichts. Rechte wie die Gutschrift selbst (6 A).

-- 1. Flaschen: Bewegungsart 'ruecknahme' mit Verweis auf die Gutschrift ──────────────────────────────────────────
ALTER TABLE public.fuellung_bewegungen
  ADD COLUMN gutschrift_id uuid REFERENCES public.rechnungen(id) ON DELETE CASCADE,
  DROP CONSTRAINT fuellung_bewegungen_art_check,
  DROP CONSTRAINT fuellung_bewegungen_verkauf_check,
  DROP CONSTRAINT fuellung_bewegungen_zugang_check,
  ADD CONSTRAINT fuellung_bewegungen_art_check CHECK (art IN ('inventur', 'bruch', 'eigenverbrauch', 'schwund', 'korrektur',
    'anfangsbestand', 'verkauf', 'verkauf_storno', 'ruecknahme')),
  ADD CONSTRAINT fuellung_bewegungen_verkauf_check CHECK ((art IN ('verkauf', 'verkauf_storno', 'ruecknahme')) = (verkaufsposten_id IS NOT NULL)),
  ADD CONSTRAINT fuellung_bewegungen_zugang_check CHECK (art NOT IN ('verkauf_storno', 'ruecknahme') OR menge_stk > 0),
  ADD CONSTRAINT fuellung_bewegungen_gutschrift_check CHECK ((art = 'ruecknahme') = (gutschrift_id IS NOT NULL));
COMMENT ON COLUMN public.fuellung_bewegungen.gutschrift_id IS 'KAN-452: Rücknahme → Gutschrift (rechnungen.art = gutschrift); nur bei art = ruecknahme';
CREATE INDEX fuellung_bewegungen_gutschrift_idx ON public.fuellung_bewegungen (gutschrift_id) WHERE gutschrift_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_gutschrift_id BEFORE INSERT OR UPDATE OF gutschrift_id, tenant_id ON public.fuellung_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('gutschrift_id', 'rechnungen', '', '', '');

-- 2. Produkte: Bewegungsart 'ruecknahme' mit Verweis auf die Gutschrift ─────────────────────────────────────────
ALTER TABLE public.sonstige_artikel_bewegungen
  ADD COLUMN gutschrift_id uuid REFERENCES public.rechnungen(id) ON DELETE CASCADE,
  DROP CONSTRAINT sonstige_artikel_bewegungen_art_check,
  DROP CONSTRAINT sonstige_artikel_bewegungen_vorzeichen,
  ADD CONSTRAINT sonstige_artikel_bewegungen_art_check CHECK (art IN ('anfangsbestand', 'zugang', 'verarbeitung', 'verkauf', 'inventur',
    'storno', 'ruecknahme')),
  ADD CONSTRAINT sonstige_artikel_bewegungen_vorzeichen CHECK (
    (art IN ('anfangsbestand', 'zugang', 'verarbeitung', 'ruecknahme') AND menge > 0)
    OR (art = 'verkauf' AND menge < 0)
    OR art IN ('inventur', 'storno')),
  ADD CONSTRAINT sonstige_artikel_bewegungen_gutschrift CHECK ((art = 'ruecknahme') = (gutschrift_id IS NOT NULL));
COMMENT ON COLUMN public.sonstige_artikel_bewegungen.gutschrift_id IS 'KAN-452: Rücknahme → Gutschrift (rechnungen.art = gutschrift); nur bei art = ruecknahme';
CREATE INDEX sonstige_artikel_bewegungen_gutschrift_idx ON public.sonstige_artikel_bewegungen (gutschrift_id) WHERE gutschrift_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_gutschrift_id BEFORE INSERT OR UPDATE OF gutschrift_id, tenant_id ON public.sonstige_artikel_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('gutschrift_id', 'rechnungen', '', '', '');

-- 3. Kellerbuch-Journal: Rücknahme = Buchungsart des Verkaufs mit positivem Vorzeichen ──────────────────────────
-- Verkauf und Verkaufsstorno bucht weiter die Verkaufsposition (s112_journal_trg_verkauf_position); die Rücknahme hat
-- keine eigene Position und entsteht deshalb aus der Flaschenbewegung. Kundenland wie beim Verkauf (KAN-439:
-- Bestimmungsland vor dem Land des Käufers). STABLE statt IMMUTABLE, weil der Verkauf nachgeschlagen wird.
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_flaschenbuchung(fb jsonb, p_ml integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_stk     integer := coalesce((fb ->> 'menge_stk')::integer, 0);
  v_art     text := fb ->> 'art';
  v_code    text;
  v_vp      jsonb;
  v_partner jsonb;
BEGIN
  IF v_stk = 0 OR v_art IN ('verkauf', 'verkauf_storno') THEN
    RETURN '[]'::jsonb;
  END IF;
  IF v_art = 'ruecknahme' THEN
    SELECT to_jsonb(v) INTO v_vp FROM public.verkaufsposten v
     WHERE v.id = (fb ->> 'verkaufsposten_id')::uuid AND v.tenant_id = (fb ->> 'tenant_id')::uuid;
    v_partner := public.s112_journal_partner(v_vp -> 'partner_daten', 'firma', 'kontakt', (v_vp ->> 'firma_id')::uuid, (v_vp ->> 'kontakt_id')::uuid);
    IF NULLIF(btrim(coalesce(v_vp ->> 'lieferland', '')), '') IS NOT NULL THEN
      v_partner := v_partner || jsonb_build_object('land', upper(btrim(v_vp ->> 'lieferland')));
    END IF;
    RETURN jsonb_build_array(jsonb_build_object(
      'code', CASE WHEN coalesce(v_partner ->> 'land', 'AT') <> 'AT' THEN 'VK_FL_AU' ELSE 'VK_FL_AT' END, 'bestand', 'flasche',
      'fuellung_id', fb ->> 'fuellung_id', 'stk', v_stk, 'liter', round(v_stk * coalesce(NULLIF(p_ml, 0), 750) / 1000.0, 3),
      'partner_name', v_partner ->> 'name', 'partner_land', v_partner ->> 'land',
      'hinweis', coalesce(NULLIF(fb ->> 'grund', ''), 'Rücknahme zu einer Gutschrift')));
  END IF;
  v_code := CASE
    WHEN v_art IN ('bruch', 'eigenverbrauch', 'schwund') THEN 'SCHWUND'
    WHEN v_art = 'anfangsbestand' AND v_stk < 0 THEN 'SCHWUND'
    WHEN v_art = 'anfangsbestand' THEN 'EROEFF'
    WHEN v_stk > 0 THEN 'INV_PLUS'
    ELSE 'INV_MIN' END;
  RETURN jsonb_build_array(jsonb_build_object('code', v_code, 'bestand', 'flasche', 'fuellung_id', fb ->> 'fuellung_id', 'stk', v_stk,
    'liter', round(v_stk * coalesce(NULLIF(p_ml, 0), 750) / 1000.0, 3),
    'hinweis', concat_ws(': ', initcap(v_art), NULLIF(fb ->> 'grund', ''))
      || CASE WHEN v_art = 'anfangsbestand' AND v_stk < 0 THEN ' · Altbestand-Korrektur (−): Abgang' ELSE '' END));
END;
$$;

-- 4. Gutschrift ausstellen: je Position ruecknahme ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_gutschrift_anlegen(p_tenant_id uuid, p_rechnung_id uuid, p_datum date, p_grund text, p_positionen jsonb, p_betrag numeric DEFAULT NULL::numeric, p_betrag_text text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r        public.rechnungen%ROWTYPE;
  v_heute    date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_grund    text := btrim(coalesce(p_grund, ''));
  v_text     text := nullif(btrim(coalesce(p_betrag_text, '')), '');
  v_pos      jsonb := coalesce(p_positionen, '[]'::jsonb);
  v_betrag   numeric(12,2) := round(coalesce(p_betrag, 0), 2);
  v_zeilen   jsonb := '[]'::jsonb;
  v_e        jsonb;
  v_p        record;
  v_menge    numeric;
  v_bisher   numeric;
  v_sperre   text;
  v_gesamt   numeric(12,2);
  v_gut      numeric(12,2);
  v_neu      numeric(12,2);
  v_gezahlt  numeric(12,2);
  v_rest     numeric(12,2);
  v_anteil   numeric(12,2);
  v_satz     record;
  v_n        integer;
  v_i        integer := 0;
  v_nummer   text;
  v_id       uuid;
  v_bezahlt  boolean;
  v_rueck    boolean;
  v_flaschen boolean := false;
  v_kb       date;
  v_a        record;
  v_b        record;
  v_alt      integer;
  v_stk      integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Gutschrift angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  IF length(v_grund) > 300 OR length(coalesce(v_text, '')) > 120 THEN
    RAISE EXCEPTION 'Grund (höchstens 300 Zeichen) bzw. Bezeichnung des Betrags (höchstens 120 Zeichen) sind zu lang.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v_pos) <> 'array' OR jsonb_array_length(v_pos) > 150 THEN
    RAISE EXCEPTION 'Die Positionen der Gutschrift sind ungültig.' USING ERRCODE = '22023';
  END IF;
  IF v_betrag < 0 THEN
    RAISE EXCEPTION 'Der Betrag der Gutschrift darf nicht negativ sein.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(v_pos) = 0 AND v_betrag = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Position oder einen Betrag angeben.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = p_rechnung_id AND r.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rechnung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.art <> 'rechnung' THEN
    RAISE EXCEPTION 'Zu % lässt sich keine Gutschrift ausstellen (Stornobeleg bzw. Gutschrift).', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF v_r.storniert OR NOT v_r.aktiv THEN
    RAISE EXCEPTION 'Die Rechnung % ist storniert bzw. nicht aktiv.', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Datum für die Gutschrift angeben.' USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF p_datum < v_r.datum THEN
    RAISE EXCEPTION 'Das Datum der Gutschrift (%) liegt vor dem Rechnungsdatum der Rechnung % (%).',
      to_char(p_datum, 'DD.MM.YYYY'), v_r.rechnungsnummer, to_char(v_r.datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF p_datum > greatest(v_heute, v_r.datum) THEN
    RAISE EXCEPTION 'Das Datum der Gutschrift (%) liegt in der Zukunft.', to_char(p_datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF NOT public.s112_wartung_frei(p_tenant_id) THEN
    v_sperre := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
    IF v_sperre IS NOT NULL THEN
      RAISE EXCEPTION 'Gutschrift mit Datum % nicht möglich: % Bitte ein Datum im offenen Zeitraum wählen.',
        to_char(p_datum, 'DD.MM.YYYY'), v_sperre USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
  END IF;

  -- Positionen: Preise und Sätze kommen aus der Rechnung, nie aus dem Aufruf; je Position höchstens die Restmenge
  FOR v_e IN SELECT e FROM jsonb_array_elements(v_pos) AS t(e) LOOP
    IF jsonb_typeof(v_e) <> 'object' OR coalesce(v_e ->> 'position_id', '') !~ '^[0-9a-fA-F-]{36}$'
       OR coalesce(v_e ->> 'menge', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
       OR (v_e ? 'ruecknahme' AND jsonb_typeof(v_e -> 'ruecknahme') <> 'boolean') THEN
      RAISE EXCEPTION 'Die Positionen der Gutschrift sind ungültig.' USING ERRCODE = '22023';
    END IF;
    v_menge := (v_e ->> 'menge')::numeric;
    IF v_menge <= 0 THEN
      RAISE EXCEPTION 'Die Menge einer Gutschrift-Position muss größer als 0 sein.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_zeilen) AS z(e) WHERE z.e ->> 'position_id' = lower(v_e ->> 'position_id')) THEN
      RAISE EXCEPTION 'Eine Position ist in der Gutschrift doppelt angegeben.' USING ERRCODE = '22023';
    END IF;
    SELECT p.id, p.typ, p.name, p.menge, p.einheit, p.preis_brutto, p.rabatt_pct, p.sonderrabatt_pct, p.ust_satz,
           p.fuellung_id, p.sonstige_artikel_id, v.id AS lieferschein_id, v.lieferscheinnummer
      INTO v_p
      FROM public.verkauf_positionen p JOIN public.verkaufsposten v ON v.id = p.verkaufsposten_id
     WHERE p.id = (v_e ->> 'position_id')::uuid AND v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Eine Position gehört nicht zur Rechnung %.', v_r.rechnungsnummer USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(sum((x.pos ->> 'menge')::numeric), 0) INTO v_bisher
      FROM public.rechnungen g CROSS JOIN LATERAL jsonb_array_elements(g.gutschrift_positionen) AS x(pos)
     WHERE g.tenant_id = p_tenant_id AND g.gutschrift_zu_id = v_r.id AND g.art = 'gutschrift' AND g.aktiv
       AND x.pos ->> 'position_id' = v_p.id::text;
    IF v_menge > coalesce(v_p.menge, 0) - v_bisher THEN
      RAISE EXCEPTION 'Position „%“: höchstens % gutschreibbar (verrechnet %, bereits gutgeschrieben %).',
        v_p.name, trim_scale(greatest(coalesce(v_p.menge, 0) - v_bisher, 0)), trim_scale(coalesce(v_p.menge, 0)), trim_scale(v_bisher)
        USING ERRCODE = '23514', HINT = 'gutschrift_menge';
    END IF;
    -- KAN-452: Rücknahme in den Bestand – nur Flaschen einer Füllung und Produkte mit Lagerbestand; immer die ganze
    -- gutgeschriebene Menge der Position (gemischte Fälle über zwei Gutschriften)
    v_rueck := coalesce((v_e ->> 'ruecknahme')::boolean, false);
    IF v_rueck THEN
      IF v_p.typ = 'flasche' AND v_p.fuellung_id IS NOT NULL THEN
        IF v_menge <> trunc(v_menge) THEN
          RAISE EXCEPTION 'Position „%“: Flaschen lassen sich nur in ganzen Stück zurücknehmen.', v_p.name USING ERRCODE = '23514', HINT = 'ruecknahme';
        END IF;
        PERFORM 1 FROM public.fuellungen f
          WHERE f.id = v_p.fuellung_id AND f.tenant_id = p_tenant_id AND coalesce(f.aktiv, true) AND f.storniert_am IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Position „%“: Die Füllung ist storniert bzw. nicht mehr aktiv – eine Rücknahme in den Bestand ist nicht möglich. Die Gutschrift lässt sich ohne Rücknahme ausstellen.', v_p.name
            USING ERRCODE = '22023', HINT = 'ruecknahme';
        END IF;
        v_flaschen := true;
      ELSIF v_p.typ = 'sonstiges' AND v_p.sonstige_artikel_id IS NOT NULL THEN
        SELECT a.aktiv, a.bestand_fuehren INTO v_a FROM public.sonstige_artikel a
         WHERE a.id = v_p.sonstige_artikel_id AND a.tenant_id = p_tenant_id;
        IF NOT FOUND OR NOT v_a.aktiv THEN
          RAISE EXCEPTION 'Position „%“: Das Produkt ist deaktiviert – eine Rücknahme in den Bestand ist nicht möglich. Die Gutschrift lässt sich ohne Rücknahme ausstellen.', v_p.name
            USING ERRCODE = '22023', HINT = 'ruecknahme';
        END IF;
        IF NOT v_a.bestand_fuehren THEN
          RAISE EXCEPTION 'Position „%“: Für das Produkt wird kein Lagerbestand geführt – eine Rücknahme in den Bestand gibt es nicht.', v_p.name
            USING ERRCODE = '22023', HINT = 'ruecknahme';
        END IF;
      ELSE
        RAISE EXCEPTION 'Position „%“: Eine Rücknahme in den Bestand gibt es nur für Flaschen und für Produkte mit Lagerbestand – nicht für Tankwein, Weintrauben und freie Positionen.', v_p.name
          USING ERRCODE = '22023', HINT = 'ruecknahme';
      END IF;
    END IF;
    v_zeilen := v_zeilen || jsonb_build_object(
      'position_id', v_p.id, 'lieferschein_id', v_p.lieferschein_id, 'lieferscheinnummer', v_p.lieferscheinnummer,
      'typ', v_p.typ, 'name', v_p.name, 'menge', v_menge, 'einheit', v_p.einheit, 'preis_brutto', v_p.preis_brutto,
      'rabatt_pct', v_p.rabatt_pct, 'sonderrabatt_pct', v_p.sonderrabatt_pct, 'ust_satz', v_p.ust_satz, 'frei', false,
      'ruecknahme', v_rueck);
  END LOOP;

  -- KAN-452: Flaschen kommen am Datum der Gutschrift zurück – im abgeschlossenen Kellerbuch-Zeitraum nicht möglich
  IF v_flaschen AND NOT public.s112_wartung_frei(p_tenant_id) THEN
    v_kb := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
    IF v_kb IS NOT NULL AND p_datum <= v_kb THEN
      RAISE EXCEPTION 'Rücknahme mit Datum % nicht möglich: Das Kellerbuch ist bis % abgeschlossen. Bitte ein späteres Datum wählen oder die Gutschrift ohne Rücknahme ausstellen.',
        to_char(p_datum, 'DD.MM.YYYY'), to_char(v_kb, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
  END IF;

  -- Rechnungsbetrag (Summe der gerundeten Zeilen, wie sync_verkaufsposten_bezahlt)
  SELECT coalesce(sum(round(p.menge * coalesce(p.preis_brutto, 0)
           * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100), 2)), 0)
    INTO v_gesamt
    FROM public.verkauf_positionen p JOIN public.verkaufsposten v ON v.id = p.verkaufsposten_id
   WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id;

  -- freier Betrag: anteilig nach dem Bruttobetrag je Steuersatz der Rechnung; der Rundungsrest geht auf den größten Anteil
  IF v_betrag > 0 THEN
    IF v_gesamt <= 0 THEN
      RAISE EXCEPTION 'Die Rechnung % hat keinen Betrag – ein Preisnachlass ist nicht möglich.', v_r.rechnungsnummer USING ERRCODE = '23514';
    END IF;
    v_rest := v_betrag;
    SELECT count(*) INTO v_n FROM (
      SELECT 1 FROM public.verkauf_positionen p JOIN public.verkaufsposten v ON v.id = p.verkaufsposten_id
       WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id
       GROUP BY coalesce(p.ust_satz, 13)
      HAVING sum(round(p.menge * coalesce(p.preis_brutto, 0) * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100), 2)) > 0) s;
    FOR v_satz IN
      SELECT coalesce(p.ust_satz, 13) AS satz,
             sum(round(p.menge * coalesce(p.preis_brutto, 0) * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100), 2)) AS brutto
        FROM public.verkauf_positionen p JOIN public.verkaufsposten v ON v.id = p.verkaufsposten_id
       WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id
       GROUP BY coalesce(p.ust_satz, 13)
      HAVING sum(round(p.menge * coalesce(p.preis_brutto, 0) * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100), 2)) > 0
       ORDER BY 2, 1
    LOOP
      v_i := v_i + 1;
      v_anteil := CASE WHEN v_i = v_n THEN v_rest ELSE round(v_betrag * v_satz.brutto / v_gesamt, 2) END;
      v_rest := v_rest - v_anteil;
      IF v_anteil > 0 THEN
        v_zeilen := v_zeilen || jsonb_build_object(
          'position_id', NULL, 'lieferschein_id', NULL, 'lieferscheinnummer', NULL, 'typ', 'sonstiges',
          'name', coalesce(v_text, 'Preisnachlass'), 'menge', 1, 'einheit', NULL, 'preis_brutto', v_anteil,
          'rabatt_pct', 0, 'sonderrabatt_pct', 0, 'ust_satz', v_satz.satz, 'frei', true, 'ruecknahme', false);
      END IF;
    END LOOP;
  END IF;

  -- Obergrenze: alle Gutschriften zusammen höchstens der Rechnungsbetrag
  SELECT coalesce(sum(round((z.e ->> 'menge')::numeric * coalesce((z.e ->> 'preis_brutto')::numeric, 0)
           * (1 - coalesce((z.e ->> 'rabatt_pct')::numeric, 0) / 100) * (1 - coalesce((z.e ->> 'sonderrabatt_pct')::numeric, 0) / 100), 2)), 0)
    INTO v_neu FROM jsonb_array_elements(v_zeilen) AS z(e);
  v_gut := public.s112_gutschrift_summe(p_tenant_id, v_r.id);
  IF v_neu <= 0 THEN
    RAISE EXCEPTION 'Die Gutschrift hat keinen Betrag.' USING ERRCODE = '23514';
  END IF;
  IF v_gut + v_neu > v_gesamt THEN
    RAISE EXCEPTION 'Die Gutschrift (% €) übersteigt den noch gutschreibbaren Betrag der Rechnung % (% € von % €).',
      replace(to_char(v_neu, 'FM999999990.00'), '.', ','), v_r.rechnungsnummer, replace(to_char(greatest(v_gesamt - v_gut, 0), 'FM999999990.00'), '.', ','), replace(to_char(v_gesamt, 'FM999999990.00'), '.', ',')
      USING ERRCODE = '23514', HINT = 'gutschrift_betrag';
  END IF;

  v_nummer := public.s112_gutschriftnummer_ziehen(p_tenant_id, p_datum);
  IF v_nummer IS NULL THEN
    RAISE EXCEPTION 'Für den Betrieb fehlen die Einstellungen – Gutschriftnummer nicht möglich.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('s112.aenderung_grund', v_grund, true);
  INSERT INTO public.rechnungen (tenant_id, art, gutschrift_zu_id, gutschrift_positionen, rechnungsnummer, datum, leistung_von, leistung_bis,
                                 kontakt_id, firma_id, zh_kontakt_id, partner_daten, skonto_aktiv, notizen, spiegel)
  VALUES (p_tenant_id, 'gutschrift', v_r.id, v_zeilen, v_nummer, p_datum, v_r.leistung_von, v_r.leistung_bis,
          v_r.kontakt_id, v_r.firma_id, v_r.zh_kontakt_id, v_r.partner_daten, false, v_grund, false)
  RETURNING id INTO v_id;
  PERFORM set_config('s112.aenderung_grund', '', true);

  -- KAN-452: Rücknahme buchen – in derselben Transaktion wie der Beleg, am Datum der Gutschrift, mit Verweis auf sie.
  -- Feste Reihenfolge (Füllung, Produkt), damit zwei gleichzeitige Gutschriften einander nicht blockieren.
  FOR v_b IN
    SELECT p.id, p.typ, p.fuellung_id, p.sonstige_artikel_id, p.verkaufsposten_id, (z.e ->> 'menge')::numeric AS menge
      FROM jsonb_array_elements(v_zeilen) AS z(e)
      JOIN public.verkauf_positionen p ON p.id = (z.e ->> 'position_id')::uuid AND p.tenant_id = p_tenant_id
     WHERE coalesce((z.e ->> 'ruecknahme')::boolean, false)
     ORDER BY p.fuellung_id NULLS LAST, p.sonstige_artikel_id, p.id
  LOOP
    IF v_b.typ = 'flasche' THEN
      SELECT coalesce(f.bestand_flaschen, 0) INTO v_alt FROM public.fuellungen f
       WHERE f.id = v_b.fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
      v_stk := v_b.menge::integer;
      IF v_alt::bigint + v_stk > 2147483647 THEN
        RAISE EXCEPTION 'Der neue Flaschenbestand ist unplausibel groß – bitte die Menge prüfen.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.fuellung_bewegungen
        (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_von, verkaufsposten_id, gutschrift_id)
      VALUES
        (p_tenant_id, v_b.fuellung_id, p_datum, 'ruecknahme', v_stk, v_alt, v_alt + v_stk, 'Rücknahme zu Gutschrift ' || v_nummer,
         auth.uid(), v_b.verkaufsposten_id, v_id);
      -- KAN-101: Bestand trotz Freeze-Sperre (nur diese Buchung)
      PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
      UPDATE public.fuellungen SET bestand_flaschen = v_alt + v_stk WHERE id = v_b.fuellung_id AND tenant_id = p_tenant_id;
      PERFORM set_config('s112.freeze_frei', '', true);
    ELSE
      PERFORM 1 FROM public.sonstige_artikel a WHERE a.id = v_b.sonstige_artikel_id AND a.tenant_id = p_tenant_id FOR UPDATE;
      INSERT INTO public.sonstige_artikel_bewegungen
        (tenant_id, artikel_id, datum, art, menge, verkauf_position_id, verkaufsposten_id, gutschrift_id, notizen, erstellt_von, erstellt_von_name)
      VALUES
        (p_tenant_id, v_b.sonstige_artikel_id, p_datum, 'ruecknahme', round(v_b.menge, 3), v_b.id, v_b.verkaufsposten_id, v_id,
         'Rücknahme zu Gutschrift ' || v_nummer, auth.uid(), public.s112_storno_benutzername(auth.uid()));
    END IF;
  END LOOP;

  -- Ausgleich: Zahlungen + Gutschriften decken den Rechnungsbetrag → nichts mehr offen
  SELECT coalesce(sum(z.betrag), 0) INTO v_gezahlt
    FROM public.zahlungen z WHERE z.rechnung_id = v_r.id AND z.tenant_id = p_tenant_id AND z.storniert_am IS NULL;
  v_bezahlt := v_gezahlt + v_gut + v_neu >= v_gesamt AND v_gesamt > 0;
  IF v_bezahlt IS DISTINCT FROM v_r.bezahlt THEN
    UPDATE public.rechnungen SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
     WHERE id = v_r.id AND tenant_id = p_tenant_id;
    UPDATE public.verkaufsposten SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
     WHERE rechnung_id = v_r.id AND tenant_id = p_tenant_id;
  END IF;
  RETURN v_id;
END
$function$;
COMMENT ON FUNCTION public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text) IS
  'KAN-419/KAN-452: Gutschrift zur Rechnung ausstellen; p_positionen [{position_id, menge, ruecknahme?}] – mit ruecknahme kommt die Menge am Datum der Gutschrift zurück in den Bestand (Flaschen, Produkte mit Lagerbestand)';

-- 5. Selbstprüfung ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fuellung_bewegungen WHERE (art = 'ruecknahme') <> (gutschrift_id IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen WHERE (art = 'ruecknahme') <> (gutschrift_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'KAN-452: Bewegung mit Rücknahme ohne Gutschrift bzw. umgekehrt';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.s112_journal_zeilen_flaschenbuchung(jsonb, integer)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'KAN-452: s112_journal_zeilen_flaschenbuchung ist nicht STABLE';
  END IF;
END
$$;
