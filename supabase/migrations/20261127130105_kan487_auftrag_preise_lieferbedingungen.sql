-- KAN-487 (27.11.2026): Auftragsbestätigung mit Preisen und Lieferbedingungen.
--
-- Entscheidungen Jörgen (Ticket und Chat, 27.11.2026) – sie lösen zwei Entscheidungen aus KAN-418 ab („Preise entstehen
-- bei der Lieferung“, „keine Preise auf der Auftragsbestätigung“):
--   1A Preise werden beim Auftrag erfasst (vorbelegt wie im Angebot) und als Momentaufnahme an den Positionen gespeichert
--   2A bei „Liefern“ sind sie vorbelegt und bleiben änderbar (unverändert: lieferVorschlag liest die Positionen)
--   3A bestehende offene Aufträge ohne Preise bzw. Lieferbedingungen werden einmal ergänzt (s112_auftrag_ergaenzen);
--      vorher gibt es kein PDF und keinen Versand (prüft die App)
--   4  „Incoterms“ war nur der Arbeitstitel: ein Pflicht-Freitextfeld ohne Vorgabe für das, was bei der Beauftragung
--      vereinbart wurde – Spalte lieferbedingungen, bis 300 Zeichen; mit den Incoterms des Weinexports hat es nichts zu tun
-- Die Preisspalten an auftrag_positionen gibt es seit KAN-418 Teil 4 (bisher nur bei Aufträgen aus einem Angebot gefüllt).
-- Keine neue Tabelle, keine neue Policy: geschrieben wird weiter nur über SECURITY-DEFINER-RPCs.

-- ── 1. Spalte ────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.auftraege
  ADD COLUMN lieferbedingungen text
    CONSTRAINT auftraege_lieferbedingungen_chk
    CHECK (lieferbedingungen IS NULL OR (lieferbedingungen = btrim(lieferbedingungen) AND char_length(lieferbedingungen) BETWEEN 1 AND 300));
COMMENT ON COLUMN public.auftraege.lieferbedingungen IS
  'KAN-487: Freitext – was bei der Beauftragung zur Lieferung vereinbart wurde; Pflicht bei neuen Aufträgen, gedruckt auf der Auftragsbestätigung. NULL nur bei Aufträgen vor KAN-487 und bei Angeboten.';

-- ── 2. Auftrag anlegen: Lieferbedingungen und Preise je Position sind Pflicht ────────────────────────────────────────
-- Vollständige Neufassung (Stand nach KAN-418 Teil 1, 4 und 5). Geändert: Lieferbedingungen, Preisprüfung, Preise im
-- INSERT der Positionen; bei der Übernahme aus einem Angebot werden dessen Preise nicht mehr nachträglich kopiert –
-- sie kommen vorbelegt aus dem Formular und dürfen dort geändert werden.
CREATE OR REPLACE FUNCTION public.s112_auftrag_anlegen(p_tenant_id uuid, p_kopf jsonb, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_heute    date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_kontakt  uuid := NULLIF(p_kopf ->> 'kontakt_id', '')::uuid;
  v_firma    uuid := NULLIF(p_kopf ->> 'firma_id', '')::uuid;
  v_datum    date := COALESCE(NULLIF(p_kopf ->> 'datum', '')::date, v_heute);
  v_bis      date := COALESCE(NULLIF(p_kopf ->> 'reserviert_bis', '')::date, v_datum + COALESCE((SELECT e.auftrag_reservierung_tage FROM public.tenant_einstellungen e WHERE e.tenant_id = p_tenant_id), 14));
  v_notizen  text := NULLIF(btrim(COALESCE(p_kopf ->> 'notizen', '')), '');
  v_lb       text := NULLIF(btrim(COALESCE(p_kopf ->> 'lieferbedingungen', '')), '');
  v_id       uuid;
  v_nummer   text;
  v_z        record;
  v_f        record;
  v_res      integer;
  v_falsch   integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF v_kontakt IS NULL AND v_firma IS NULL THEN
    RAISE EXCEPTION 'Bitte einen Kunden wählen.' USING ERRCODE = '23514';
  END IF;
  IF v_kontakt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.kontakte k WHERE k.id = v_kontakt AND k.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Kontakt nicht gefunden.' USING ERRCODE = '23503';
  END IF;
  IF v_firma IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = v_firma AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Firma nicht gefunden.' USING ERRCODE = '23503';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Auftragsdatum darf nicht in der Zukunft liegen.' USING ERRCODE = '23514';
  END IF;
  IF v_bis < v_heute THEN
    RAISE EXCEPTION 'Die Reservierung muss mindestens bis heute gelten.' USING ERRCODE = '23514';
  END IF;
  -- KAN-487: Lieferbedingungen sind Pflicht (Freitext)
  IF v_lb IS NULL THEN
    RAISE EXCEPTION 'Bitte die Lieferbedingungen angeben.' USING ERRCODE = '23514', HINT = 'lieferbedingungen';
  END IF;
  IF char_length(v_lb) > 300 THEN
    RAISE EXCEPTION 'Die Lieferbedingungen dürfen höchstens 300 Zeichen lang sein.' USING ERRCODE = '23514', HINT = 'lieferbedingungen';
  END IF;
  IF p_positionen IS NULL OR jsonb_typeof(p_positionen) <> 'array' OR jsonb_array_length(p_positionen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Position angeben.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_positionen) > 100 THEN
    RAISE EXCEPTION 'Höchstens 100 Positionen je Auftrag.' USING ERRCODE = '23514';
  END IF;

  -- je Füllung die Summe der Positionen; Füllungen in fester Reihenfolge sperren (kein Deadlock zweier Aufträge)
  FOR v_z IN
    SELECT (e ->> 'fuellung_id')::uuid AS fuellung_id, SUM((e ->> 'menge')::integer) AS menge, bool_or((e ->> 'menge')::integer < 1) AS ungueltig
      FROM jsonb_array_elements(p_positionen) e
     GROUP BY 1 ORDER BY 1
  LOOP
    IF v_z.fuellung_id IS NULL OR v_z.ungueltig THEN
      RAISE EXCEPTION 'Bitte je Position eine Füllung und eine Menge ab 1 Flasche angeben.' USING ERRCODE = '23514';
    END IF;
    SELECT f.id, f.name, f.jahrgang, COALESCE(f.bestand_flaschen, 0) AS bestand, f.aktiv, f.storniert_am INTO v_f
      FROM public.fuellungen f WHERE f.id = v_z.fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND OR v_f.storniert_am IS NOT NULL THEN
      RAISE EXCEPTION 'Füllung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = '23503';
    END IF;
    v_res := public.s112_fuellung_reserviert(v_z.fuellung_id);
    IF v_z.menge > v_f.bestand - v_res THEN
      RAISE EXCEPTION '„%“: nur noch % Flaschen verfügbar (Bestand %, reserviert %), % angefragt.',
        v_f.name, GREATEST(v_f.bestand - v_res, 0), v_f.bestand, v_res, v_z.menge
        USING ERRCODE = '22023', HINT = 'reserviert';
    END IF;
  END LOOP;

  -- KAN-487: Preise je Position (dieselben Grenzen wie am Angebot)
  SELECT count(*) INTO v_falsch
    FROM jsonb_array_elements(p_positionen) e
   WHERE COALESCE(e ->> 'preis_brutto', '') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
      OR COALESCE(e ->> 'rabatt_pct', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR COALESCE(e ->> 'rabatt_pct', '0')::numeric > 100
      OR COALESCE(e ->> 'sonderrabatt_pct', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR COALESCE(e ->> 'sonderrabatt_pct', '0')::numeric > 100
      OR COALESCE(e ->> 'ust_satz', '') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR (e ->> 'ust_satz')::numeric > 100;
  IF v_falsch > 0 THEN
    RAISE EXCEPTION 'Bitte je Position einen Preis und den Steuersatz angeben (Rabatte 0 bis 100 %%).' USING ERRCODE = '23514', HINT = 'preise';
  END IF;

  v_nummer := public.s112_auftragsnummer_ziehen(p_tenant_id);
  INSERT INTO public.auftraege (tenant_id, art, nummer, datum, kontakt_id, firma_id, status, reserviert_bis, notizen, lieferbedingungen, erstellt_von)
  VALUES (p_tenant_id, 'auftrag', v_nummer, v_datum, v_kontakt, v_firma, 'offen', v_bis, v_notizen, v_lb, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  INSERT INTO public.auftrag_positionen (tenant_id, auftrag_id, fuellung_id, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz)
  SELECT p_tenant_id, v_id, f.id, left(concat_ws(' ', f.name, f.jahrgang::text), 300), (e ->> 'menge')::integer,
         (e ->> 'preis_brutto')::numeric, COALESCE(e ->> 'rabatt_pct', '0')::numeric, COALESCE(e ->> 'sonderrabatt_pct', '0')::numeric, (e ->> 'ust_satz')::numeric
    FROM jsonb_array_elements(p_positionen) WITH ORDINALITY AS x(e, nr)
    JOIN public.fuellungen f ON f.id = (e ->> 'fuellung_id')::uuid AND f.tenant_id = p_tenant_id
   ORDER BY nr;

  -- KAN-418 Teil 4: Auftrag aus einem Angebot – das Angebot wird genau einmal übernommen.
  -- KAN-487: seine Preise kommen vorbelegt aus dem Formular (änderbar) und werden nicht mehr nachträglich kopiert.
  IF NULLIF(p_kopf ->> 'angebot_id', '') IS NOT NULL THEN
    DECLARE
      v_an record;
    BEGIN
      SELECT id, nummer, art, status, kontakt_id, firma_id INTO v_an
        FROM public.auftraege WHERE id = (p_kopf ->> 'angebot_id')::uuid AND tenant_id = p_tenant_id FOR UPDATE;
      IF NOT FOUND OR v_an.art <> 'angebot' THEN
        RAISE EXCEPTION 'Angebot nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
      END IF;
      IF v_an.status <> 'offen' THEN
        RAISE EXCEPTION 'Das Angebot % ist nicht mehr offen und lässt sich nicht übernehmen.', v_an.nummer USING ERRCODE = '23514', HINT = 'angebot_gesperrt';
      END IF;
      IF v_an.kontakt_id IS DISTINCT FROM v_kontakt OR v_an.firma_id IS DISTINCT FROM v_firma THEN
        RAISE EXCEPTION 'Der Auftrag muss an den Kunden des Angebots % gehen.', v_an.nummer USING ERRCODE = '23514';
      END IF;
      PERFORM set_config('s112.auftrag_frei', 'ja', true);
      UPDATE public.auftraege SET angebot_id = v_an.id WHERE id = v_id AND tenant_id = p_tenant_id;
      UPDATE public.auftraege SET status = 'angenommen', aktualisiert_am = now() WHERE id = v_an.id AND tenant_id = p_tenant_id;
      PERFORM set_config('s112.auftrag_frei', '', true);
    END;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'nummer', v_nummer, 'reserviert_bis', v_bis);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_anlegen(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_anlegen(uuid, jsonb, jsonb) TO authenticated, service_role;

-- ── 3. Bestehenden Auftrag ergänzen (Entscheidung 3A) ────────────────────────────────────────────────────────────────
-- Nur für einen Auftrag, der noch Flaschen reserviert (offen, teilgeliefert) und dem etwas fehlt (Lieferbedingungen
-- oder ein Preis). Alle Positionen in einem Zug; ein vollständiger Auftrag bleibt unveränderlich – Preise ändern heißt
-- weiterhin stornieren und neu erfassen.
CREATE FUNCTION public.s112_auftrag_ergaenzen(p_tenant_id uuid, p_auftrag_id uuid, p_lieferbedingungen text, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a       record;
  v_lb      text := NULLIF(btrim(COALESCE(p_lieferbedingungen, '')), '');
  v_anzahl  integer;
  v_falsch  integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  SELECT id, nummer, status, lieferbedingungen INTO v_a
    FROM public.auftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id AND art = 'auftrag' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status NOT IN ('offen', 'teilgeliefert') THEN
    RAISE EXCEPTION 'Der Auftrag % ist nicht mehr offen – Preise und Lieferbedingungen lassen sich nicht mehr ergänzen.', v_a.nummer
      USING ERRCODE = '23514', HINT = 'auftrag_gesperrt';
  END IF;
  SELECT count(*) INTO v_anzahl FROM public.auftrag_positionen p WHERE p.auftrag_id = v_a.id AND p.tenant_id = p_tenant_id;
  IF v_a.lieferbedingungen IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.auftrag_positionen p
        WHERE p.auftrag_id = v_a.id AND p.tenant_id = p_tenant_id AND (p.preis_brutto IS NULL OR p.ust_satz IS NULL)) THEN
    RAISE EXCEPTION 'Am Auftrag % sind Preise und Lieferbedingungen schon erfasst – zum Ändern bitte stornieren und neu erfassen.', v_a.nummer
      USING ERRCODE = '23514', HINT = 'auftrag_vollstaendig';
  END IF;

  IF v_lb IS NULL THEN
    RAISE EXCEPTION 'Bitte die Lieferbedingungen angeben.' USING ERRCODE = '23514', HINT = 'lieferbedingungen';
  END IF;
  IF char_length(v_lb) > 300 THEN
    RAISE EXCEPTION 'Die Lieferbedingungen dürfen höchstens 300 Zeichen lang sein.' USING ERRCODE = '23514', HINT = 'lieferbedingungen';
  END IF;
  IF p_positionen IS NULL OR jsonb_typeof(p_positionen) <> 'array' THEN
    RAISE EXCEPTION 'Die Positionen konnten nicht gelesen werden – bitte die Seite neu laden.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_falsch
    FROM jsonb_array_elements(p_positionen) e
   WHERE COALESCE(e ->> 'position_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR COALESCE(e ->> 'preis_brutto', '') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
      OR COALESCE(e ->> 'rabatt_pct', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR COALESCE(e ->> 'rabatt_pct', '0')::numeric > 100
      OR COALESCE(e ->> 'sonderrabatt_pct', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR COALESCE(e ->> 'sonderrabatt_pct', '0')::numeric > 100
      OR COALESCE(e ->> 'ust_satz', '') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR (e ->> 'ust_satz')::numeric > 100;
  IF v_falsch > 0 THEN
    RAISE EXCEPTION 'Bitte je Position einen Preis und den Steuersatz angeben (Rabatte 0 bis 100 %%).' USING ERRCODE = '23514', HINT = 'preise';
  END IF;
  -- genau die Positionen dieses Auftrags, jede einmal
  IF jsonb_array_length(p_positionen) <> v_anzahl
     OR (SELECT count(DISTINCT p.id) FROM jsonb_array_elements(p_positionen) e
           JOIN public.auftrag_positionen p ON p.id = (e ->> 'position_id')::uuid AND p.auftrag_id = v_a.id AND p.tenant_id = p_tenant_id) <> v_anzahl THEN
    RAISE EXCEPTION 'Die Positionen passen nicht zum Auftrag % – bitte die Seite neu laden.', v_a.nummer USING ERRCODE = '23514';
  END IF;

  UPDATE public.auftrag_positionen p
     SET preis_brutto = (e ->> 'preis_brutto')::numeric, rabatt_pct = COALESCE(e ->> 'rabatt_pct', '0')::numeric,
         sonderrabatt_pct = COALESCE(e ->> 'sonderrabatt_pct', '0')::numeric, ust_satz = (e ->> 'ust_satz')::numeric
    FROM jsonb_array_elements(p_positionen) e
   WHERE p.id = (e ->> 'position_id')::uuid AND p.auftrag_id = v_a.id AND p.tenant_id = p_tenant_id;

  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege SET lieferbedingungen = v_lb, aktualisiert_am = now() WHERE id = v_a.id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.auftrag_frei', '', true);

  RETURN jsonb_build_object('id', v_a.id, 'nummer', v_a.nummer);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_ergaenzen(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_ergaenzen(uuid, uuid, text, jsonb) TO authenticated, service_role;
