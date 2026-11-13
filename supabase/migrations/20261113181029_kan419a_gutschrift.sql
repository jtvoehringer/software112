-- KAN-419 G1 (13.11.2026): Gutschrift zur Rechnung – eigener Beleg mit eigenen Positionen.
--
-- Bisher gab es nur den Vollstorno (KAN-379). Eine Gutschrift berichtigt eine Rechnung teilweise: einzelne Positionen
-- bzw. Mengen und/oder ein freier Betrag (Preisnachlass, Bonus). Entscheidungen Jörgen (Jira KAN-419, 11.11. und
-- 13.11.2026, Fragen 1–7 jeweils A):
--   * eigener Beleg rechnungen.art = 'gutschrift', Nummernkreis GS-JJJJ-NNNN, Verweis gutschrift_zu_id → Rechnung
--   * Datum wie beim Storno: nicht vor dem Rechnungsdatum, nicht in der Zukunft, nicht im abgeschlossenen Zeitraum
--   * mehrere Gutschriften je Rechnung, je Position höchstens die Restmenge, in Summe höchstens der Rechnungsbetrag
--   * der freie Betrag wird anteilig auf die Steuersätze der Rechnung aufgeteilt (3A)
--   * die Gutschrift mindert den offenen Betrag; ist damit alles ausgeglichen, gilt die Rechnung als bezahlt
--   * eine Rechnung mit Gutschrift lässt sich nicht mehr voll stornieren (2A)
--   * Betriebsleitung und Mitarbeiter mit Schreibrecht Warenwirtschaft (5A); Grund mindestens 10 Zeichen (7A)
-- Der Beleg trägt seine Positionen als Momentaufnahme (gutschrift_positionen, positive Mengen und Preise); alle Leser
-- rechnen sie negativ. Noch ohne Rücknahme in den Bestand (KAN-452) und ohne Storno der Gutschrift (KAN-453).
-- UVA: eigene Migration kan419b. Keine Datenänderung an bestehenden Zeilen. Kein session_replication_role (KAN-124).

-- 1. Spalten und Regeln ──────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rechnungen
  ADD COLUMN gutschrift_zu_id      uuid REFERENCES public.rechnungen(id) ON DELETE CASCADE,
  ADD COLUMN gutschrift_positionen jsonb,
  DROP CONSTRAINT rechnungen_art,
  ADD CONSTRAINT rechnungen_art CHECK (art IN ('rechnung', 'storno', 'gutschrift')),
  ADD CONSTRAINT rechnungen_gutschrift_verweis CHECK ((art = 'gutschrift') = (gutschrift_zu_id IS NOT NULL)),
  ADD CONSTRAINT rechnungen_gutschrift_positionen CHECK (
    (art = 'gutschrift') = (gutschrift_positionen IS NOT NULL)
    AND (gutschrift_positionen IS NULL
         OR (jsonb_typeof(gutschrift_positionen) = 'array' AND jsonb_array_length(gutschrift_positionen) BETWEEN 1 AND 200)));
COMMENT ON COLUMN public.rechnungen.art IS 'rechnung | storno (Stornobeleg, KAN-379) | gutschrift (Teilberichtigung mit eigenen Positionen, KAN-419)';
COMMENT ON COLUMN public.rechnungen.gutschrift_zu_id IS 'KAN-419: Gutschrift → berichtigte Rechnung';
COMMENT ON COLUMN public.rechnungen.gutschrift_positionen IS
  'KAN-419: Momentaufnahme der gutgeschriebenen Zeilen [{position_id, lieferschein_id, typ, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz, frei}] – Mengen und Preise positiv, Leser rechnen negativ';
CREATE INDEX rechnungen_gutschrift_zu_idx ON public.rechnungen (gutschrift_zu_id);
CREATE TRIGGER z_fremdverweis_gutschrift_zu_id BEFORE INSERT OR UPDATE OF gutschrift_zu_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('gutschrift_zu_id', 'rechnungen', '', '', '');

-- 2. Nummernkreis Gutschrift ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN gutschrift_prefix  text    NOT NULL DEFAULT 'GS' CONSTRAINT tenant_einstellungen_gutschrift_prefix_chk CHECK (gutschrift_prefix ~ '^[A-Za-z0-9]{1,8}$'),
  ADD COLUMN gutschrift_stellen integer NOT NULL DEFAULT 4 CONSTRAINT tenant_einstellungen_gutschrift_stellen_chk CHECK (gutschrift_stellen BETWEEN 3 AND 8),
  ADD COLUMN gutschrift_zaehler integer NOT NULL DEFAULT 1 CONSTRAINT tenant_einstellungen_gutschrift_zaehler_chk CHECK (gutschrift_zaehler >= 1);
GRANT SELECT (gutschrift_prefix, gutschrift_stellen, gutschrift_zaehler) ON public.tenant_einstellungen TO authenticated, anon;

CREATE FUNCTION public.s112_gutschriftnummer_ziehen(p_tenant_id uuid, p_datum date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix  text;
  v_stellen integer;
  v_nummer  integer;
BEGIN
  SELECT gutschrift_prefix, gutschrift_stellen, gutschrift_zaehler INTO v_prefix, v_stellen, v_nummer
    FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE tenant_einstellungen SET gutschrift_zaehler = v_nummer + 1 WHERE tenant_id = p_tenant_id;
  RETURN v_prefix || '-' || to_char(p_datum, 'YYYY') || '-' || lpad(v_nummer::text, v_stellen, '0');
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_gutschriftnummer_ziehen(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_gutschriftnummer_ziehen(uuid, date) IS
  'KAN-419: nächste Nummer einer Gutschrift (GS-JJJJ-0001, Jahr des Belegdatums, Zähler ohne Jahreswechsel) – intern';

-- 3. Summe der Gutschriften einer Rechnung (brutto, positiv) – intern ─────────────────────────────────────────────
CREATE FUNCTION public.s112_gutschrift_summe(p_tenant_id uuid, p_rechnung_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT coalesce(sum(round((x.pos ->> 'menge')::numeric * coalesce((x.pos ->> 'preis_brutto')::numeric, 0)
           * (1 - coalesce((x.pos ->> 'rabatt_pct')::numeric, 0) / 100) * (1 - coalesce((x.pos ->> 'sonderrabatt_pct')::numeric, 0) / 100), 2)), 0)
    FROM public.rechnungen g CROSS JOIN LATERAL jsonb_array_elements(g.gutschrift_positionen) AS x(pos)
   WHERE g.tenant_id = p_tenant_id AND g.gutschrift_zu_id = p_rechnung_id AND g.art = 'gutschrift' AND g.aktiv
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_gutschrift_summe(uuid, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_gutschrift_summe(uuid, uuid) IS
  'KAN-419: Summe aller Gutschriften einer Rechnung, brutto und positiv (Summe der gerundeten Zeilen) – intern';

-- 4. Gutschrift ausstellen ───────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_gutschrift_anlegen(p_tenant_id uuid, p_rechnung_id uuid, p_datum date, p_grund text,
                                               p_positionen jsonb, p_betrag numeric DEFAULT NULL, p_betrag_text text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
       OR coalesce(v_e ->> 'menge', '') !~ '^[0-9]+([.][0-9]{1,4})?$' THEN
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
           v.id AS lieferschein_id, v.lieferscheinnummer
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
    v_zeilen := v_zeilen || jsonb_build_object(
      'position_id', v_p.id, 'lieferschein_id', v_p.lieferschein_id, 'lieferscheinnummer', v_p.lieferscheinnummer,
      'typ', v_p.typ, 'name', v_p.name, 'menge', v_menge, 'einheit', v_p.einheit, 'preis_brutto', v_p.preis_brutto,
      'rabatt_pct', v_p.rabatt_pct, 'sonderrabatt_pct', v_p.sonderrabatt_pct, 'ust_satz', v_p.ust_satz, 'frei', false);
  END LOOP;

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
          'rabatt_pct', 0, 'sonderrabatt_pct', 0, 'ust_satz', v_satz.satz, 'frei', true);
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
REVOKE EXECUTE ON FUNCTION public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text) TO authenticated;
COMMENT ON FUNCTION public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text) IS
  'KAN-419: Gutschrift zu einer Rechnung ausstellen – Positionen [{position_id, menge}] und/oder freier Bruttobetrag; gibt die ID der Gutschrift zurück';

-- 5. Zahlungen: Gutschriften zählen beim Abgleich „bezahlt“ mit ───────────────────────────────────────────────────
DO $kan419a$
DECLARE
  v_def text;
  c_alt constant text := '        FROM zahlungen WHERE rechnung_id = v_re AND tenant_id = v_tenant AND storniert_am IS NULL;
      v_bezahlt := v_gezahlt >= v_gesamt AND v_gesamt > 0;';
  c_neu constant text := '        FROM zahlungen WHERE rechnung_id = v_re AND tenant_id = v_tenant AND storniert_am IS NULL;
      -- KAN-419: Gutschriften mindern den offenen Betrag
      v_gezahlt := v_gezahlt + public.s112_gutschrift_summe(v_tenant, v_re);
      v_bezahlt := v_gezahlt >= v_gesamt AND v_gesamt > 0;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'sync_verkaufsposten_bezahlt';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-419: sync_verkaufsposten_bezahlt – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan419a$;

-- 6. Storno: weder eine Gutschrift noch eine Rechnung mit Gutschrift (Entscheidung 2A) ────────────────────────────
DO $kan419a$
DECLARE
  v_def text;
  c_alt constant text := '  IF p_datum IS NULL THEN
    RAISE EXCEPTION ''Bitte ein Storno-Datum angeben.'' USING ERRCODE = ''23514'';';
  c_neu constant text := '  IF v_r.art = ''gutschrift'' THEN
    RAISE EXCEPTION ''% ist eine Gutschrift und lässt sich nicht stornieren.'', v_r.rechnungsnummer USING ERRCODE = ''22023'', HINT = ''gutschrift'';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rechnungen g WHERE g.gutschrift_zu_id = v_r.id AND g.tenant_id = p_tenant_id AND g.art = ''gutschrift'' AND g.aktiv) THEN
    RAISE EXCEPTION ''Zur Rechnung % gibt es eine Gutschrift – sie lässt sich nicht mehr stornieren. Den Rest bitte über eine weitere Gutschrift berichtigen.'', v_r.rechnungsnummer
      USING ERRCODE = ''22023'', HINT = ''gutschrift'';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION ''Bitte ein Storno-Datum angeben.'' USING ERRCODE = ''23514'';';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_stornobeleg_anlegen';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-419: s112_stornobeleg_anlegen – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan419a$;
