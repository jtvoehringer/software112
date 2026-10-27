-- KAN-379 (27.10.2026): Storno einer Rechnung als Stornobeleg (Gegenbuchung) im offenen Zeitraum
--
-- Entscheidung Jörgen (Jira KAN-379, 27.10.2026: 1A 2A 3B 4A 5A 6A 7A): Ein Storno erzeugt immer einen eigenen
-- Stornobeleg – eine Zeile in rechnungen mit art = 'storno', eigener Nummer (Nummernkreis „ST-JJJJ-0001“), Verweis auf
-- das Original (storno_von_id) und einem Datum im offenen Zeitraum (wählbar, nicht vor dem Rechnungsdatum, nicht in der
-- Zukunft). Das Original bleibt mit seinen Beträgen in seinem Zeitraum wirksam (storniert_durch_id, Momentaufnahme
-- storno_positionen); abgeschlossene Monate und übermittelte UVAs ändern sich nicht. Gilt auch im offenen Zeitraum
-- (einheitlich) und für bereits an BMD übergebene Rechnungen (der Stornobeleg geht mit der nächsten Übergabe mit).
-- Nur Vollstorno. Bestand und Kellerbuch werden beim Verkaufsstorno am Datum des Stornobelegs zurückgebucht.
--
--  1. rechnungen: art, storno_von_id (Stornobeleg → Original, je Original höchstens einer), storniert_durch_id
--     (Original → Stornobeleg), FK-Prüf-Trigger und Indizes. Altfälle (storniert ohne Stornobeleg) bleiben unverändert.
--  2. Nummernkreis storno_prefix/_stellen/_zaehler in tenant_einstellungen, s112_stornonummer_ziehen (intern).
--  3. s112_stornobeleg_anlegen (intern): Datumsprüfung, Momentaufnahme, Stornobeleg, Original kennzeichnen – der eine Weg
--     für Rechnungsstorno, Verkauf samt Rechnung und Verkaufsstorno über den Spiegel.
--  4. s112_rechnung_stornieren(tenant, rechnung, grund, datum DEFAULT heute): ohne BMD-Sperre; Zahlungen weiter zuerst
--     stornieren; gibt die ID des Stornobelegs zurück.
--  5. s112_verkauf_samt_rechnung_stornieren(…, datum DEFAULT heute): Bestand und Kellerbuch am Datum des Stornobelegs.
--  6. Spiegel (Verkauf mit „Rechnung sofort“): Storno des Lieferscheins legt den Stornobeleg mit Datum heute an.
--  7. Periodensperre (KAN-355): die vorläufige Sperre periodensperre_storno entfällt; stattdessen lässt sich eine
--     Rechnung nur noch über den Stornobeleg stornieren (HINT stornobeleg). Deaktivieren im gesperrten Zeitraum bleibt
--     gesperrt. Wartung (s112_wartung_frei) wie bisher.
--  8. berechne_ea_uva (Doppik): Original mit Stornobeleg zählt in seinem Zeitraum aus der Momentaufnahme, der Stornobeleg
--     negativ im Zeitraum seines Datums; Altfälle bleiben außen vor wie bisher.
-- Keine Datenänderung an bestehenden Zeilen. Kein session_replication_role (KAN-124).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 85 (und 70, 83), dann Produktion.

-- 1. Spalten ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rechnungen
  ADD COLUMN art                text NOT NULL DEFAULT 'rechnung',
  ADD COLUMN storno_von_id      uuid REFERENCES public.rechnungen(id) ON DELETE CASCADE,
  ADD COLUMN storniert_durch_id uuid REFERENCES public.rechnungen(id) ON DELETE SET NULL,
  ADD CONSTRAINT rechnungen_art CHECK (art IN ('rechnung', 'storno')),
  ADD CONSTRAINT rechnungen_storno_verweis CHECK ((art = 'storno') = (storno_von_id IS NOT NULL)),
  ADD CONSTRAINT rechnungen_stornobeleg_endgueltig CHECK (art = 'rechnung' OR (NOT storniert AND storniert_durch_id IS NULL));
COMMENT ON COLUMN public.rechnungen.art IS 'KAN-379: rechnung | storno (Stornobeleg mit negativen Beträgen aus der Momentaufnahme des Originals)';
COMMENT ON COLUMN public.rechnungen.storno_von_id IS 'KAN-379: Stornobeleg → stornierte Rechnung';
COMMENT ON COLUMN public.rechnungen.storniert_durch_id IS 'KAN-379: stornierte Rechnung → ihr Stornobeleg (NULL bei Altfällen vor KAN-379)';
CREATE UNIQUE INDEX rechnungen_storno_von_idx ON public.rechnungen (storno_von_id);
CREATE INDEX rechnungen_storniert_durch_idx ON public.rechnungen (storniert_durch_id);

CREATE TRIGGER z_fremdverweis_storno_von_id BEFORE INSERT OR UPDATE OF storno_von_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('storno_von_id', 'rechnungen', '', '', '');
CREATE TRIGGER z_fremdverweis_storniert_durch_id BEFORE INSERT OR UPDATE OF storniert_durch_id, tenant_id ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('storniert_durch_id', 'rechnungen', '', '', '');

-- 2. Nummernkreis Stornobeleg ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN storno_prefix  text    NOT NULL DEFAULT 'ST' CHECK (storno_prefix ~ '^[A-Za-z0-9]{1,8}$'),
  ADD COLUMN storno_stellen integer NOT NULL DEFAULT 4 CHECK (storno_stellen BETWEEN 3 AND 8),
  ADD COLUMN storno_zaehler integer NOT NULL DEFAULT 1 CHECK (storno_zaehler >= 1);
GRANT SELECT (storno_prefix, storno_stellen, storno_zaehler) ON public.tenant_einstellungen TO authenticated, anon;

CREATE FUNCTION public.s112_stornonummer_ziehen(p_tenant_id uuid, p_datum date)
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
  SELECT storno_prefix, storno_stellen, storno_zaehler INTO v_prefix, v_stellen, v_nummer
    FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE tenant_einstellungen SET storno_zaehler = v_nummer + 1 WHERE tenant_id = p_tenant_id;
  RETURN v_prefix || '-' || to_char(p_datum, 'YYYY') || '-' || lpad(v_nummer::text, v_stellen, '0');
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_stornonummer_ziehen(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_stornonummer_ziehen(uuid, date) IS
  'KAN-379: nächste Nummer eines Stornobelegs (ST-JJJJ-0001, Jahr des Belegdatums, Zähler ohne Jahreswechsel) – intern';

-- 3. Stornobeleg anlegen (intern) ──────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_stornobeleg_anlegen(p_tenant_id uuid, p_rechnung_id uuid, p_grund text, p_datum date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_r      public.rechnungen%ROWTYPE;
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_grund  text := btrim(coalesce(p_grund, ''));
  v_sperre text;
  v_nummer text;
  v_id     uuid;
BEGIN
  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = p_rechnung_id AND r.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rechnung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.art = 'storno' THEN
    RAISE EXCEPTION '% ist ein Stornobeleg und lässt sich nicht stornieren.', v_r.rechnungsnummer USING ERRCODE = '22023', HINT = 'stornobeleg';
  END IF;
  IF v_r.storniert THEN
    RAISE EXCEPTION 'Die Rechnung % ist bereits storniert.', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Storno-Datum angeben.' USING ERRCODE = '23514';
  END IF;
  IF p_datum < v_r.datum THEN
    RAISE EXCEPTION 'Das Storno-Datum (%) liegt vor dem Rechnungsdatum der Rechnung % (%).',
      to_char(p_datum, 'DD.MM.YYYY'), v_r.rechnungsnummer, to_char(v_r.datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF p_datum > greatest(v_heute, v_r.datum) THEN
    RAISE EXCEPTION 'Das Storno-Datum (%) liegt in der Zukunft.', to_char(p_datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF NOT public.s112_wartung_frei(p_tenant_id) THEN
    v_sperre := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
    IF v_sperre IS NOT NULL THEN
      RAISE EXCEPTION 'Storno mit Datum % nicht möglich: % Bitte ein Storno-Datum im offenen Zeitraum wählen.',
        to_char(p_datum, 'DD.MM.YYYY'), v_sperre USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
  END IF;

  v_nummer := public.s112_stornonummer_ziehen(p_tenant_id, p_datum);
  IF v_nummer IS NULL THEN
    RAISE EXCEPTION 'Für den Betrieb fehlen die Einstellungen – Stornonummer nicht möglich.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.rechnungen (tenant_id, art, storno_von_id, rechnungsnummer, datum, leistung_von, leistung_bis,
                                 kontakt_id, firma_id, zh_kontakt_id, partner_daten, skonto_aktiv, notizen, spiegel)
  VALUES (p_tenant_id, 'storno', v_r.id, v_nummer, p_datum, v_r.leistung_von, v_r.leistung_bis,
          v_r.kontakt_id, v_r.firma_id, v_r.zh_kontakt_id, v_r.partner_daten, false, nullif(v_grund, ''), false)
  RETURNING id INTO v_id;

  -- Original: storniert, Momentaufnahme der Positionen (UVA, Journal, Stornobeleg rechnen daraus), Verweis
  PERFORM set_config('s112.rechnung_storno', v_r.id::text, true);
  UPDATE public.rechnungen
     SET storniert = true, storniert_am = now(), storniert_von = auth.uid(),
         storniert_von_name = public.s112_storno_benutzername(auth.uid()), storno_grund = nullif(v_grund, ''),
         spiegel = false, storniert_durch_id = v_id,
         storno_positionen = (
           SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'lieferschein_id', v.id, 'lieferscheinnummer', v.lieferscheinnummer, 'lieferdatum', v.datum,
                    'typ', p.typ, 'name', p.name, 'menge', p.menge, 'einheit', p.einheit, 'preis_brutto', p.preis_brutto,
                    'rabatt_pct', p.rabatt_pct, 'sonderrabatt_pct', p.sonderrabatt_pct, 'ust_satz', p.ust_satz,
                    'traubenverkauf_id', p.traubenverkauf_id)
                  ORDER BY v.datum, v.lieferscheinnummer, p.erstellt_am, p.id), '[]'::jsonb)
             FROM public.verkaufsposten v JOIN public.verkauf_positionen p ON p.verkaufsposten_id = v.id
            WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id)
   WHERE id = v_r.id;
  PERFORM set_config('s112.rechnung_storno', '', true);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_stornobeleg_anlegen(uuid, uuid, text, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_stornobeleg_anlegen(uuid, uuid, text, date) IS
  'KAN-379: Stornobeleg zu einer Rechnung anlegen und das Original kennzeichnen – intern (Rechnungsstorno, Verkauf samt Rechnung, Spiegel)';

-- 4. Rechnungsstorno ──────────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text);
CREATE FUNCTION public.s112_rechnung_stornieren(p_tenant_id uuid, p_rechnung_id uuid, p_grund text, p_datum date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_r     public.rechnungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
  v_id    uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = p_rechnung_id AND r.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rechnung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.storniert THEN
    RAISE EXCEPTION 'Die Rechnung % ist bereits storniert.', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.zahlungen z WHERE z.rechnung_id = p_rechnung_id AND z.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Zur Rechnung % gibt es Zahlungen – bitte zuerst die Zahlungen stornieren.', v_r.rechnungsnummer
      USING ERRCODE = '22023', HINT = 'rechnung_zahlungen';
  END IF;

  v_id := public.s112_stornobeleg_anlegen(p_tenant_id, p_rechnung_id, v_grund,
                                          coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date));
  -- Lieferscheine wieder „nicht berechnet“ (Bestand bleibt); stornierte Zahlungen bleiben an der Rechnung
  PERFORM set_config('s112.rechnung_rpc', 'an', true);
  UPDATE public.verkaufsposten SET rechnung_id = NULL, rechnungsnummer = NULL, bezahlt = false, bezahlt_am = NULL
   WHERE rechnung_id = p_rechnung_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.rechnung_rpc', '', true);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text, date) TO authenticated;
COMMENT ON FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text, date) IS
  'KAN-103/KAN-379: Rechnung stornieren – Stornobeleg im offenen Zeitraum (Datum, Standard heute), Lieferscheine wieder offen';

-- 5. Verkauf samt Rechnung (KAN-356) mit Storno-Datum ─────────────────────────────────────────────────────────────
DROP FUNCTION public.s112_verkauf_samt_rechnung_stornieren(uuid, uuid, text);
CREATE FUNCTION public.s112_verkauf_samt_rechnung_stornieren(p_tenant_id uuid, p_verkaufsposten_id uuid, p_grund text, p_datum date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_datum   date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_v       public.verkaufsposten%ROWTYPE;
  v_r       public.rechnungen%ROWTYPE;
  v_anzahl  integer;
  v_pos     record;
  v_w       record;
  v_neu     numeric;
  v_flaschen integer := 0;
  v_liter   numeric := 0;
  v_tv      integer := 0;
  v_storno  uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_v FROM public.verkaufsposten v WHERE v.id = p_verkaufsposten_id AND v.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verkauf nicht gefunden – bitte Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_v.storniert THEN
    RAISE EXCEPTION 'Dieser Verkauf ist bereits storniert – der Bestand wurde schon zurückgebucht.' USING ERRCODE = '22023';
  END IF;
  IF v_v.rechnung_id IS NULL THEN
    RAISE EXCEPTION 'Der Lieferschein % ist nicht berechnet – bitte „Verkauf stornieren“ verwenden.', coalesce(v_v.lieferscheinnummer, '')
      USING ERRCODE = '22023', HINT = 'nicht_berechnet';
  END IF;
  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = v_v.rechnung_id AND r.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_r.storniert THEN
    RAISE EXCEPTION 'Der Lieferschein % ist nicht (mehr) berechnet – bitte Seite neu laden.', coalesce(v_v.lieferscheinnummer, '')
      USING ERRCODE = '22023', HINT = 'nicht_berechnet';
  END IF;
  IF v_r.spiegel THEN
    RAISE EXCEPTION 'Rechnung % gehört 1:1 zum Verkauf – bitte „Verkauf stornieren“ verwenden.', v_r.rechnungsnummer
      USING ERRCODE = '22023', HINT = 'spiegel';
  END IF;
  SELECT count(*) INTO v_anzahl FROM public.verkaufsposten v WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id;
  IF v_anzahl <> 1 THEN
    RAISE EXCEPTION 'Die Rechnung % umfasst % Lieferscheine – bitte zuerst die Rechnung stornieren, dann den Verkauf.', v_r.rechnungsnummer, v_anzahl
      USING ERRCODE = '22023', HINT = 'sammelrechnung';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transportbescheinigungen t
              WHERE t.verkaufsposten_id = p_verkaufsposten_id AND t.tenant_id = p_tenant_id
                AND t.status = 'ausgestellt' AND t.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Zum Lieferschein % gibt es eine ausgestellte Transportbescheinigung – bitte zuerst die Transportbescheinigung stornieren.',
      coalesce(v_v.lieferscheinnummer, '') USING ERRCODE = '22023', HINT = 'transportbescheinigung';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verkauf_positionen p
              WHERE p.verkaufsposten_id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id AND p.typ = 'tank' AND p.weinausbau_id IS NOT NULL)
     AND NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'rieden')) THEN
    RAISE EXCEPTION 'Die Rechnung % enthält offenen Wein (Tank): Beim Storno werden die Liter auf die Kellerbuch-Charge zurückgebucht – das dürfen nur Betriebs-Manager und Mitarbeiter mit Freigabe Kellerbuch (oder Rieden).',
      v_r.rechnungsnummer USING ERRCODE = '42501';
  END IF;

  -- 3. Rechnung → Stornobeleg am Storno-Datum (Zahlungen, Datum und Periodensperre prüfen die RPC bzw. s112_stornobeleg_anlegen)
  v_storno := public.s112_rechnung_stornieren(p_tenant_id, v_r.id, v_grund, v_datum);

  -- 4a. Flaschen je Füllung (gerundet wie bei der Abbuchung) – am Storno-Datum
  FOR v_pos IN
    SELECT p.fuellung_id, sum(round(coalesce(p.menge, 0)))::integer AS stueck
      FROM public.verkauf_positionen p
     WHERE p.verkaufsposten_id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id AND p.typ = 'flasche' AND p.fuellung_id IS NOT NULL
     GROUP BY p.fuellung_id ORDER BY p.fuellung_id
  LOOP
    CONTINUE WHEN v_pos.stueck = 0;
    PERFORM public.s112_fuellung_verkauf_buchen(p_tenant_id, v_pos.fuellung_id, p_verkaufsposten_id, v_pos.stueck, v_datum, v_grund);
    v_flaschen := v_flaschen + v_pos.stueck;
  END LOOP;

  -- 4b. Offener Wein je Charge
  FOR v_pos IN
    SELECT p.weinausbau_id, sum(coalesce(p.menge, 0)) AS liter
      FROM public.verkauf_positionen p
     WHERE p.verkaufsposten_id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id AND p.typ = 'tank' AND p.weinausbau_id IS NOT NULL
     GROUP BY p.weinausbau_id ORDER BY p.weinausbau_id
  LOOP
    CONTINUE WHEN abs(v_pos.liter) < 0.0005;
    SELECT w.name, w.menge_liter, w.aktiv, w.status INTO v_w
      FROM public.weinausbau w WHERE w.id = v_pos.weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kellerbuch-Charge des Verkaufs nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    v_neu := coalesce(v_w.menge_liter, 0) + v_pos.liter;
    IF v_neu < 0 THEN
      RAISE EXCEPTION '„%“: nur noch % L verfügbar.', v_w.name, coalesce(v_w.menge_liter, 0) USING ERRCODE = '22023';
    END IF;
    IF v_neu < 0.005 THEN
      UPDATE public.weinausbau SET menge_liter = 0 WHERE id = v_pos.weinausbau_id AND tenant_id = p_tenant_id;
    ELSIF v_w.aktiv IS FALSE OR v_w.status = 'abgeschlossen' THEN
      UPDATE public.weinausbau
         SET menge_liter = v_neu, aktiv = true, status = CASE WHEN v_w.status = 'abgeschlossen' THEN 'ausbau' ELSE v_w.status END
       WHERE id = v_pos.weinausbau_id AND tenant_id = p_tenant_id;
    ELSE
      UPDATE public.weinausbau SET menge_liter = v_neu WHERE id = v_pos.weinausbau_id AND tenant_id = p_tenant_id;
    END IF;
    v_liter := v_liter + v_pos.liter;
  END LOOP;

  -- 5. Lieferschein, Sonstige Produkte, Traubenverkäufe
  UPDATE public.verkaufsposten SET storniert = true, storno_grund = v_grund
   WHERE id = p_verkaufsposten_id AND tenant_id = p_tenant_id AND NOT storniert;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dieser Verkauf wurde soeben bereits storniert – bitte Seite neu laden.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verkauf_positionen p
              WHERE p.verkaufsposten_id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id AND p.typ = 'sonstiges' AND p.sonstige_artikel_id IS NOT NULL) THEN
    PERFORM public.s112_artikel_verkauf_stornieren(p_tenant_id, p_verkaufsposten_id, v_grund);
  END IF;
  UPDATE public.traubenverkauf t
     SET storniert_am = now(), storno_grund = 'Rechnung ' || v_r.rechnungsnummer || ' storniert: ' || v_grund
   WHERE t.tenant_id = p_tenant_id AND t.storniert_am IS NULL
     AND (t.verkaufsposten_id = p_verkaufsposten_id
          OR t.id IN (SELECT p.traubenverkauf_id FROM public.verkauf_positionen p
                       WHERE p.verkaufsposten_id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id AND p.traubenverkauf_id IS NOT NULL));
  GET DIAGNOSTICS v_tv = ROW_COUNT;

  RETURN jsonb_build_object('rechnungsnummer', v_r.rechnungsnummer, 'lieferscheinnummer', v_v.lieferscheinnummer,
                            'stornonummer', (SELECT r.rechnungsnummer FROM public.rechnungen r WHERE r.id = v_storno),
                            'flaschen', v_flaschen, 'liter', v_liter, 'traubenverkaeufe', v_tv);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verkauf_samt_rechnung_stornieren(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_verkauf_samt_rechnung_stornieren(uuid, uuid, text, date) TO authenticated;

-- 6. Spiegel: Storno des Lieferscheins (Verkauf mit „Rechnung sofort“) → Stornobeleg mit Datum heute ─────────────
CREATE OR REPLACE FUNCTION public.s112_rechnung_spiegeln()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rechnung_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.rechnungen r WHERE r.id = NEW.rechnung_id AND r.spiegel)
     OR EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = NEW.rechnung_id AND v.id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  -- KAN-379: Storno nur über den Stornobeleg (Datum heute bzw. Rechnungsdatum, falls dieses in der Zukunft liegt)
  IF coalesce(NEW.storniert, false) AND EXISTS (SELECT 1 FROM public.rechnungen r WHERE r.id = NEW.rechnung_id AND NOT r.storniert) THEN
    PERFORM public.s112_stornobeleg_anlegen(NEW.tenant_id, NEW.rechnung_id, NEW.storno_grund,
      greatest((now() AT TIME ZONE 'Europe/Vienna')::date, (SELECT r.datum FROM public.rechnungen r WHERE r.id = NEW.rechnung_id)));
    RETURN NULL;
  END IF;
  UPDATE public.rechnungen r
     SET rechnungsnummer = coalesce(NEW.rechnungsnummer, r.rechnungsnummer),
         datum = NEW.datum, leistung_von = NEW.datum, leistung_bis = NEW.datum,
         kontakt_id = NEW.kontakt_id, firma_id = NEW.firma_id, zh_kontakt_id = NEW.zh_kontakt_id, partner_daten = NEW.partner_daten,
         skonto_pct = NEW.skonto_pct, skonto_tage = NEW.skonto_tage, skonto_aktiv = NEW.skonto_aktiv,
         aktiv = coalesce(NEW.aktiv, true), storniert = coalesce(NEW.storniert, false), storniert_am = NEW.storniert_am,
         storniert_von = NEW.storniert_von, storniert_von_name = NEW.storniert_von_name, storno_grund = NEW.storno_grund,
         bezahlt = coalesce(NEW.bezahlt, false), bezahlt_am = NEW.bezahlt_am,
         rechnung_versendet_am = NEW.rechnung_versendet_am, rechnung_versendet_an = NEW.rechnung_versendet_an,
         bmd_export_id = NEW.bmd_export_id
   WHERE r.id = NEW.rechnung_id
     AND (r.rechnungsnummer, r.datum, r.kontakt_id, r.firma_id, r.zh_kontakt_id, r.partner_daten, r.skonto_pct, r.skonto_tage,
          r.skonto_aktiv, r.aktiv, r.storniert, r.storniert_am, r.storniert_von, r.storniert_von_name, r.storno_grund, r.bezahlt,
          r.bezahlt_am, r.rechnung_versendet_am, r.rechnung_versendet_an, r.bmd_export_id)
         IS DISTINCT FROM
         (coalesce(NEW.rechnungsnummer, r.rechnungsnummer), NEW.datum, NEW.kontakt_id, NEW.firma_id, NEW.zh_kontakt_id, NEW.partner_daten,
          NEW.skonto_pct, NEW.skonto_tage, NEW.skonto_aktiv, coalesce(NEW.aktiv, true), coalesce(NEW.storniert, false), NEW.storniert_am,
          NEW.storniert_von, NEW.storniert_von_name, NEW.storno_grund, coalesce(NEW.bezahlt, false), NEW.bezahlt_am,
          NEW.rechnung_versendet_am, NEW.rechnung_versendet_an, NEW.bmd_export_id);
  RETURN NULL;
END
$function$;

-- 7. Periodensperre: Storno nur über den Stornobeleg ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_rechnung_periodensperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_grund text;
BEGIN
  IF public.s112_wartung_frei(CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_grund := public.s112_ea_zeitraum_sperrgrund(NEW.tenant_id, NEW.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Rechnung mit Datum % nicht möglich: % Bitte ein Rechnungsdatum im offenen Zeitraum wählen.',
        to_char(NEW.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, OLD.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Die Rechnung % vom % lässt sich nicht löschen: % Berichtigungen bitte stornieren.',
        OLD.rechnungsnummer, to_char(OLD.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
    RETURN OLD;
  END IF;

  -- KAN-379: Storno nur über den Stornobeleg (s112_stornobeleg_anlegen) – das Original bleibt in seinem Zeitraum wirksam
  IF NEW.storniert AND NOT OLD.storniert
     AND current_setting('s112.rechnung_storno', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'Die Rechnung % lässt sich nur über „Stornieren“ stornieren – dabei entsteht ein Stornobeleg im offenen Zeitraum.',
      OLD.rechnungsnummer USING ERRCODE = '42501', HINT = 'stornobeleg';
  END IF;
  -- Deaktivieren nähme die Rechnung rückwirkend aus der UVA ihres Zeitraums
  IF OLD.aktiv AND NOT NEW.aktiv THEN
    v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, OLD.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Die Rechnung % liegt im abgeschlossenen Zeitraum % und lässt sich nicht deaktivieren – bitte stornieren.',
        OLD.rechnungsnummer, to_char(OLD.datum, 'MM/YYYY') USING ERRCODE = '42501', HINT = 'periodensperre', DETAIL = v_grund;
    END IF;
  END IF;
  -- sonst zählen nur das Rechnungsdatum (und der Betrieb) – bezahlt, Versand, BMD bleiben frei
  IF NEW.datum IS NOT DISTINCT FROM OLD.datum AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, OLD.datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Das Datum der Rechnung % (%) lässt sich nicht ändern: % Berichtigungen bitte stornieren.',
      OLD.rechnungsnummer, to_char(OLD.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(NEW.tenant_id, NEW.datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Rechnung mit Datum % nicht möglich: % Bitte ein Rechnungsdatum im offenen Zeitraum wählen.',
      to_char(NEW.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
  END IF;
  RETURN NEW;
END;
$function$;

-- 8. UVA (Doppik): Original aus der Momentaufnahme in seinem Zeitraum, Stornobeleg negativ in seinem ───────────────
CREATE OR REPLACE FUNCTION public.berechne_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
 RETURNS TABLE(bmgl_0 numeric, bmgl_10 numeric, bmgl_13 numeric, bmgl_20 numeric, ust_10 numeric, ust_13 numeric, ust_20 numeric, vst_10 numeric, vst_13 numeric, vst_20 numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von    date;
  v_bis    date;
  v_doppik boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
  END IF;

  SELECT coalesce(e.buchhaltungsart = 'doppik', false) INTO v_doppik
  FROM tenant_einstellungen e WHERE e.tenant_id = p_tenant_id;
  v_doppik := coalesce(v_doppik, false);

  RETURN QUERY
  WITH ea AS (
    SELECT t.typ, t.ust_satz::numeric AS satz, t.betrag_netto AS netto, t.ust_betrag AS ust
    FROM ea_transaktionen t
    WHERE t.tenant_id = p_tenant_id
      AND t.datum BETWEEN v_von AND v_bis
      AND NOT (v_doppik AND t.typ = 'einnahme' AND t.import_quelle = 'verkauf')
  ),
  -- Doppik: Rechnungen nach Rechnungsdatum, Netto je Rechnung und Satz gerundet
  re AS (
    SELECT r.id, coalesce(p.ust_satz, 13)::numeric AS satz,
           round(sum(p.preis_brutto * p.menge * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100)
                     / (1 + coalesce(p.ust_satz, 13)::numeric / 100)), 2) AS netto
    FROM rechnungen r
    JOIN verkaufsposten v ON v.rechnung_id = r.id AND v.tenant_id = r.tenant_id
    JOIN verkauf_positionen p ON p.verkaufsposten_id = v.id
    WHERE v_doppik
      AND r.tenant_id = p_tenant_id
      AND r.art = 'rechnung'
      AND r.aktiv AND NOT r.storniert
      AND r.datum BETWEEN v_von AND v_bis
      AND p.preis_brutto IS NOT NULL
    GROUP BY r.id, coalesce(p.ust_satz, 13)
  ),
  -- KAN-379: Positionen stornierter Rechnungen mit Stornobeleg (Momentaufnahme) – Original +1 in seinem Zeitraum,
  -- Stornobeleg −1 im Zeitraum seines Datums; Altfälle (storniert ohne Stornobeleg) zählen wie bisher nicht
  mp AS (
    SELECT o.id AS beleg, 1 AS vz, x.pos
    FROM rechnungen o CROSS JOIN LATERAL jsonb_array_elements(o.storno_positionen) AS x(pos)
    WHERE v_doppik AND o.tenant_id = p_tenant_id AND o.art = 'rechnung' AND o.aktiv
      AND o.storniert AND o.storniert_durch_id IS NOT NULL
      AND o.datum BETWEEN v_von AND v_bis
    UNION ALL
    SELECT s.id, -1, x.pos
    FROM rechnungen s
    JOIN rechnungen o ON o.id = s.storno_von_id AND o.tenant_id = s.tenant_id
    CROSS JOIN LATERAL jsonb_array_elements(o.storno_positionen) AS x(pos)
    WHERE v_doppik AND s.tenant_id = p_tenant_id AND s.art = 'storno' AND s.aktiv
      AND s.datum BETWEEN v_von AND v_bis
  ),
  st AS (
    SELECT m.beleg, coalesce((m.pos ->> 'ust_satz')::numeric, 13) AS satz,
           m.vz * round(sum((m.pos ->> 'preis_brutto')::numeric * (m.pos ->> 'menge')::numeric
                            * (1 - coalesce((m.pos ->> 'rabatt_pct')::numeric, 0) / 100)
                            * (1 - coalesce((m.pos ->> 'sonderrabatt_pct')::numeric, 0) / 100)
                            / (1 + coalesce((m.pos ->> 'ust_satz')::numeric, 13) / 100)), 2) AS netto
    FROM mp m
    WHERE m.pos ->> 'preis_brutto' IS NOT NULL
    GROUP BY m.beleg, m.vz, coalesce((m.pos ->> 'ust_satz')::numeric, 13)
  ),
  alle_zeilen AS (
    SELECT typ, satz, netto, ust FROM ea
    UNION ALL
    SELECT 'einnahme', satz, netto, round(netto * satz / 100, 2) FROM re
    UNION ALL
    SELECT 'einnahme', satz, netto, round(netto * satz / 100, 2) FROM st
  )
  SELECT
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=0  THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=10 THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=13 THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=20 THEN a.netto ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=10 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=13 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='einnahme' AND a.satz=20 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=10 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=13 THEN a.ust ELSE 0 END),
    SUM(CASE WHEN a.typ='ausgabe' AND a.satz=20 THEN a.ust ELSE 0 END)
  FROM alle_zeilen a;
END;
$function$;
