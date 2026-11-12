-- KAN-418 Teil 4 (12.11.2026): Angebot.
--
-- Entscheidungen Jörgen (Ticket, 12.11.2026 – alle Fragen A):
--   1A Angebot MIT Preisen als Momentaufnahme (Bruttopreis je Flasche, Kunden- und Sonderrabatt, USt. je Position)
--   2A bearbeitbar, solange „offen“ (Kopf und Positionen in einem Zug)
--   3A ein Auftrag aus einem Angebot trägt dessen Preise an seinen Positionen – „Liefern“ belegt sie vor (änderbar)
--   4A Übernahme einmal und als Ganzes; danach ist das Angebot „angenommen“
-- Ein Angebot liegt in derselben Tabelle wie die Aufträge (art = 'angebot'), reserviert nichts und ist nicht lieferbar
-- (s112_fuellung_reserviert, s112_auftrag_liefern und die Lader filtern auf art = 'auftrag'). Eigener Nummernkreis
-- AN-JJJJ-NNNN. „Abgelaufen“ ist kein Status, nur ein Hinweis der App (gueltig_bis vor heute).
-- Der Versandvermerk nutzt ab_versendet_am/_an und s112_auftrag_ab_vermerken (Teil 3) unverändert.

-- ── 1. Spalten ──────────────────────────────────────────────────────────────────
ALTER TABLE public.auftraege
  ADD COLUMN gueltig_bis      date,
  ADD COLUMN angebot_id       uuid REFERENCES public.auftraege(id),
  ADD COLUMN abgelehnt_am     timestamptz,
  ADD COLUMN abgelehnt_grund  text CONSTRAINT auftraege_abgelehnt_grund_chk CHECK (abgelehnt_grund IS NULL OR char_length(abgelehnt_grund) <= 500);
COMMENT ON COLUMN public.auftraege.gueltig_bis IS 'KAN-418: Angebot gültig bis (nur art = angebot); abgelaufen ist ein Hinweis, kein Status';
COMMENT ON COLUMN public.auftraege.angebot_id IS 'KAN-418: Auftrag stammt aus diesem Angebot (ein Angebot wird genau einmal übernommen)';

ALTER TABLE public.auftraege DROP CONSTRAINT auftraege_status_chk;
ALTER TABLE public.auftraege ADD CONSTRAINT auftraege_status_chk CHECK (
  (art = 'auftrag' AND status IN ('offen', 'teilgeliefert', 'geliefert', 'abgeschlossen', 'storniert'))
  OR (art = 'angebot' AND status IN ('offen', 'angenommen', 'abgelehnt', 'storniert')));
ALTER TABLE public.auftraege
  ADD CONSTRAINT auftraege_abgelehnt_chk CHECK ((status = 'abgelehnt') = (abgelehnt_am IS NOT NULL)),
  ADD CONSTRAINT auftraege_angebot_art_chk CHECK (angebot_id IS NULL OR art = 'auftrag');
-- ein Angebot wird höchstens einmal übernommen (NULL zählt nicht); zugleich der Index des Fremdschlüssels
CREATE UNIQUE INDEX auftraege_angebot_idx ON public.auftraege (angebot_id);
CREATE TRIGGER z_fremdverweis_angebot_id BEFORE INSERT OR UPDATE OF angebot_id, tenant_id ON public.auftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('angebot_id', 'auftraege', '', '', '');

ALTER TABLE public.auftrag_positionen
  ADD COLUMN preis_brutto      numeric(12,2) CONSTRAINT auftrag_positionen_preis_chk CHECK (preis_brutto IS NULL OR preis_brutto BETWEEN 0 AND 1000000),
  ADD COLUMN rabatt_pct        numeric(5,2)  CONSTRAINT auftrag_positionen_rabatt_chk CHECK (rabatt_pct IS NULL OR rabatt_pct BETWEEN 0 AND 100),
  ADD COLUMN sonderrabatt_pct  numeric(5,2)  CONSTRAINT auftrag_positionen_sonderrabatt_chk CHECK (sonderrabatt_pct IS NULL OR sonderrabatt_pct BETWEEN 0 AND 100),
  ADD COLUMN ust_satz          numeric(5,2)  CONSTRAINT auftrag_positionen_ust_chk CHECK (ust_satz IS NULL OR ust_satz BETWEEN 0 AND 100);
COMMENT ON COLUMN public.auftrag_positionen.preis_brutto IS
  'KAN-418: Bruttopreis je Flasche laut Angebot (Momentaufnahme). Am Auftrag nur gefüllt, wenn er aus einem Angebot stammt – Vorschlag für die Lieferung.';

-- ── 2. Nummernkreis AN-JJJJ-NNNN ────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN angebot_prefix  text NOT NULL DEFAULT 'AN' CONSTRAINT tenant_einstellungen_angebot_prefix_chk CHECK (char_length(angebot_prefix) BETWEEN 1 AND 10),
  ADD COLUMN angebot_stellen integer NOT NULL DEFAULT 4 CONSTRAINT tenant_einstellungen_angebot_stellen_chk CHECK (angebot_stellen BETWEEN 1 AND 8),
  ADD COLUMN angebot_zaehler integer NOT NULL DEFAULT 1 CONSTRAINT tenant_einstellungen_angebot_zaehler_chk CHECK (angebot_zaehler >= 1);
GRANT SELECT (angebot_prefix, angebot_stellen, angebot_zaehler) ON public.tenant_einstellungen TO authenticated, anon;

CREATE FUNCTION public.s112_angebotsnummer_ziehen(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix  text;
  v_stellen integer;
  v_nummer  integer;
BEGIN
  SELECT angebot_prefix, angebot_stellen, angebot_zaehler INTO v_prefix, v_stellen, v_nummer
    FROM public.tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Für diesen Betrieb fehlen die Einstellungen (Nummernkreis Angebot).' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.tenant_einstellungen SET angebot_zaehler = v_nummer + 1 WHERE tenant_id = p_tenant_id;
  RETURN v_prefix || '-' || to_char((now() AT TIME ZONE 'Europe/Vienna')::date, 'YYYY') || '-' || public.s112_nummer_text(v_nummer, v_stellen);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_angebotsnummer_ziehen(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Kopf und Positionen prüfen und schreiben (intern, gemeinsam für Anlegen und Ändern) ──────────────────────────────
-- p_angebot_id NULL = anlegen (Nummer ziehen), sonst Kopf ändern und Positionen ersetzen. Kein Bestandsabgleich:
-- ein Angebot reserviert nichts.
CREATE FUNCTION public.s112_angebot_schreiben_intern(p_tenant_id uuid, p_angebot_id uuid, p_kopf jsonb, p_positionen jsonb)
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
  v_tage     integer := COALESCE((SELECT e.auftrag_reservierung_tage FROM public.tenant_einstellungen e WHERE e.tenant_id = p_tenant_id), 14);
  v_bis      date := COALESCE(NULLIF(p_kopf ->> 'gueltig_bis', '')::date, v_datum + v_tage);
  v_notizen  text := NULLIF(btrim(COALESCE(p_kopf ->> 'notizen', '')), '');
  v_id       uuid := p_angebot_id;
  v_nummer   text;
  v_falsch   integer;
BEGIN
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
    RAISE EXCEPTION 'Das Angebotsdatum darf nicht in der Zukunft liegen.' USING ERRCODE = '23514';
  END IF;
  IF v_bis < v_datum THEN
    RAISE EXCEPTION '„Gültig bis“ darf nicht vor dem Angebotsdatum liegen.' USING ERRCODE = '23514';
  END IF;
  IF char_length(COALESCE(v_notizen, '')) > 2000 THEN
    RAISE EXCEPTION 'Die Notiz darf höchstens 2.000 Zeichen lang sein.' USING ERRCODE = '23514';
  END IF;
  IF p_positionen IS NULL OR jsonb_typeof(p_positionen) <> 'array' OR jsonb_array_length(p_positionen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Position angeben.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_positionen) > 100 THEN
    RAISE EXCEPTION 'Höchstens 100 Positionen je Angebot.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_falsch
    FROM jsonb_array_elements(p_positionen) e
   WHERE NULLIF(e ->> 'fuellung_id', '') IS NULL
      OR COALESCE(e ->> 'menge', '') !~ '^[0-9]{1,7}$' OR (e ->> 'menge')::integer NOT BETWEEN 1 AND 1000000
      OR COALESCE(e ->> 'preis_brutto', '') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
      OR COALESCE(e ->> 'rabatt_pct', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR COALESCE(e ->> 'rabatt_pct', '0')::numeric > 100
      OR COALESCE(e ->> 'sonderrabatt_pct', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR COALESCE(e ->> 'sonderrabatt_pct', '0')::numeric > 100
      OR COALESCE(e ->> 'ust_satz', '') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR (e ->> 'ust_satz')::numeric > 100;
  IF v_falsch > 0 THEN
    RAISE EXCEPTION 'Bitte je Position eine Füllung, eine Menge ab 1 Flasche, einen Preis und den Steuersatz angeben (Rabatte 0 bis 100 %%).' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_positionen) e
              WHERE NOT EXISTS (SELECT 1 FROM public.fuellungen f
                                 WHERE f.id = (e ->> 'fuellung_id')::uuid AND f.tenant_id = p_tenant_id AND f.storniert_am IS NULL)) THEN
    RAISE EXCEPTION 'Füllung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = '23503';
  END IF;

  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  IF v_id IS NULL THEN
    v_nummer := public.s112_angebotsnummer_ziehen(p_tenant_id);
    INSERT INTO public.auftraege (tenant_id, art, nummer, datum, kontakt_id, firma_id, status, gueltig_bis, notizen, erstellt_von)
    VALUES (p_tenant_id, 'angebot', v_nummer, v_datum, v_kontakt, v_firma, 'offen', v_bis, v_notizen, (SELECT auth.uid()))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.auftraege
       SET datum = v_datum, kontakt_id = v_kontakt, firma_id = v_firma, gueltig_bis = v_bis, notizen = v_notizen, aktualisiert_am = now()
     WHERE id = v_id AND tenant_id = p_tenant_id
    RETURNING nummer INTO v_nummer;
    DELETE FROM public.auftrag_positionen WHERE auftrag_id = v_id AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO public.auftrag_positionen (tenant_id, auftrag_id, fuellung_id, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz, erstellt_am)
  SELECT p_tenant_id, v_id, f.id, left(concat_ws(' ', f.name, f.jahrgang::text), 300), (e ->> 'menge')::integer,
         (e ->> 'preis_brutto')::numeric, COALESCE(e ->> 'rabatt_pct', '0')::numeric, COALESCE(e ->> 'sonderrabatt_pct', '0')::numeric, (e ->> 'ust_satz')::numeric,
         clock_timestamp()
    FROM jsonb_array_elements(p_positionen) WITH ORDINALITY AS x(e, nr)
    JOIN public.fuellungen f ON f.id = (e ->> 'fuellung_id')::uuid AND f.tenant_id = p_tenant_id
   ORDER BY nr;
  PERFORM set_config('s112.auftrag_frei', '', true);

  RETURN jsonb_build_object('id', v_id, 'nummer', v_nummer, 'gueltig_bis', v_bis);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_angebot_schreiben_intern(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_angebot_anlegen(p_tenant_id uuid, p_kopf jsonb, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  RETURN public.s112_angebot_schreiben_intern(p_tenant_id, NULL, p_kopf, p_positionen);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_angebot_anlegen(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_angebot_anlegen(uuid, jsonb, jsonb) TO authenticated, service_role;

CREATE FUNCTION public.s112_angebot_aendern(p_tenant_id uuid, p_angebot_id uuid, p_kopf jsonb, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  SELECT id, nummer, art, status INTO v_a FROM public.auftraege WHERE id = p_angebot_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_a.art <> 'angebot' THEN
    RAISE EXCEPTION 'Angebot nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status <> 'offen' THEN
    RAISE EXCEPTION 'Das Angebot % ist nicht mehr offen und lässt sich nicht mehr ändern.', v_a.nummer USING ERRCODE = '23514', HINT = 'angebot_gesperrt';
  END IF;
  RETURN public.s112_angebot_schreiben_intern(p_tenant_id, p_angebot_id, p_kopf, p_positionen);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_angebot_aendern(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_angebot_aendern(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;

-- Ablehnen (Grund freiwillig) bzw. Stornieren (Grund Pflicht) – nur ein offenes Angebot
CREATE FUNCTION public.s112_angebot_status_setzen(p_tenant_id uuid, p_angebot_id uuid, p_status text, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a     record;
  v_grund text := btrim(coalesce(p_grund, ''));
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF p_status IS NULL OR p_status NOT IN ('abgelehnt', 'storniert') THEN
    RAISE EXCEPTION 'Unbekannter Status.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'storniert' AND length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT id, nummer, art, status INTO v_a FROM public.auftraege WHERE id = p_angebot_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_a.art <> 'angebot' THEN
    RAISE EXCEPTION 'Angebot nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status <> 'offen' THEN
    RAISE EXCEPTION 'Das Angebot % ist nicht mehr offen.', v_a.nummer USING ERRCODE = '23514', HINT = 'angebot_gesperrt';
  END IF;
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  IF p_status = 'abgelehnt' THEN
    UPDATE public.auftraege SET status = 'abgelehnt', abgelehnt_am = now(), abgelehnt_grund = NULLIF(left(v_grund, 500), ''), aktualisiert_am = now()
     WHERE id = p_angebot_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.auftraege
       SET status = 'storniert', storniert_am = now(), storniert_von = (SELECT auth.uid()), storno_grund = left(v_grund, 500), aktualisiert_am = now()
     WHERE id = p_angebot_id AND tenant_id = p_tenant_id;
  END IF;
  PERFORM set_config('s112.auftrag_frei', '', true);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_angebot_status_setzen(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_angebot_status_setzen(uuid, uuid, text, text) TO authenticated, service_role;

-- ── 4. Bestehende Funktionen ergänzen (je genau eine Stelle, sonst Abbruch) ─────────────────────────────────────────
DO $kan418f$
DECLARE
  v_def text;
  c_anlegen_alt constant text := '  RETURN jsonb_build_object(''id'', v_id, ''nummer'', v_nummer, ''reserviert_bis'', v_bis);';
  c_anlegen_neu constant text := '  -- KAN-418 Teil 4: Auftrag aus einem Angebot – das Angebot wird genau einmal übernommen, seine Preise wandern als
  -- Vorschlag für die Lieferung an die Auftragspositionen derselben Füllung
  IF NULLIF(p_kopf ->> ''angebot_id'', '''') IS NOT NULL THEN
    DECLARE
      v_an record;
    BEGIN
      SELECT id, nummer, art, status, kontakt_id, firma_id INTO v_an
        FROM public.auftraege WHERE id = (p_kopf ->> ''angebot_id'')::uuid AND tenant_id = p_tenant_id FOR UPDATE;
      IF NOT FOUND OR v_an.art <> ''angebot'' THEN
        RAISE EXCEPTION ''Angebot nicht gefunden – bitte die Seite neu laden.'' USING ERRCODE = ''P0002'';
      END IF;
      IF v_an.status <> ''offen'' THEN
        RAISE EXCEPTION ''Das Angebot % ist nicht mehr offen und lässt sich nicht übernehmen.'', v_an.nummer USING ERRCODE = ''23514'', HINT = ''angebot_gesperrt'';
      END IF;
      IF v_an.kontakt_id IS DISTINCT FROM v_kontakt OR v_an.firma_id IS DISTINCT FROM v_firma THEN
        RAISE EXCEPTION ''Der Auftrag muss an den Kunden des Angebots % gehen.'', v_an.nummer USING ERRCODE = ''23514'';
      END IF;
      PERFORM set_config(''s112.auftrag_frei'', ''ja'', true);
      UPDATE public.auftraege SET angebot_id = v_an.id WHERE id = v_id AND tenant_id = p_tenant_id;
      UPDATE public.auftraege SET status = ''angenommen'', aktualisiert_am = now() WHERE id = v_an.id AND tenant_id = p_tenant_id;
      UPDATE public.auftrag_positionen p
         SET preis_brutto = q.preis_brutto, rabatt_pct = q.rabatt_pct, sonderrabatt_pct = q.sonderrabatt_pct, ust_satz = q.ust_satz
        FROM (SELECT DISTINCT ON (fuellung_id) fuellung_id, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz
                FROM public.auftrag_positionen WHERE auftrag_id = v_an.id AND tenant_id = p_tenant_id
               ORDER BY fuellung_id, erstellt_am, id) q
       WHERE p.auftrag_id = v_id AND p.tenant_id = p_tenant_id AND p.fuellung_id = q.fuellung_id;
      PERFORM set_config(''s112.auftrag_frei'', '''', true);
    END;
  END IF;

  RETURN jsonb_build_object(''id'', v_id, ''nummer'', v_nummer, ''reserviert_bis'', v_bis);';
  c_storno_alt constant text := '  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION ''Der Auftrag % ist bereits storniert.'', v_a.nummer USING ERRCODE = ''23514'';';
  c_storno_neu constant text := '  -- KAN-418 Teil 4: Angebote storniert s112_angebot_status_setzen
  IF EXISTS (SELECT 1 FROM public.auftraege x WHERE x.id = p_auftrag_id AND x.art <> ''auftrag'') THEN
    RAISE EXCEPTION ''Auftrag nicht gefunden – bitte die Seite neu laden.'' USING ERRCODE = ''P0002'';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION ''Der Auftrag % ist bereits storniert.'', v_a.nummer USING ERRCODE = ''23514'';';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_auftrag_anlegen';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_anlegen_alt, ''))) / length(c_anlegen_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-418: s112_auftrag_anlegen – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_anlegen_alt, c_anlegen_neu);

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_auftrag_stornieren';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_storno_alt, ''))) / length(c_storno_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-418: s112_auftrag_stornieren – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_storno_alt, c_storno_neu);
END
$kan418f$;
