-- KAN-112 (Entwurf 03.10.2026, Entscheidungen Jörgen 03.10.2026): Verschnitt aus Gebinde atomar, Gebinde-Snapshot,
-- Zwischencharge entfällt.
--
--  1. Gebinde-Snapshot: verschneidungen.ziel_behaelter_id, verschneidung_quellen.quell_behaelter_id (+ je
--     gebinde_rekonstruiert). Nachbefüllung der Altdaten mit der Regel aus KAN-77 (lib/kellerbuch/quellGebindeKern.ts):
--     Gebinde am Verschnitt-Tag aus den Umzügen, bei einer Zwischencharge im Ziel-Gebinde das Herkunftsgebinde des
--     letzten Umzugs in die Quelle – alle nachbefüllten Zeilen mit gebinde_rekonstruiert = true (Anzeige als Hinweis).
--  2. Schwund beim Verschnitt: eigene Schwundbuchung (keller_umzuege, umzug_typ 'schwund', wie schwund_buchen) je Quelle,
--     verknüpft über verschneidung_quellen.schwund_umzug_id – Bewegungsbuch, BSM und Journal kennen sie schon; der
--     Storno des Verschnitts storniert sie mit.
--  3. Mandantenschutz der neuen Verweise (keine neue Fremd-FK-Ausnahme): Trigger a_verschnitt_verweise – Gebinde nur
--     eigene bzw. freigegebene Gemeinschaftsgebinde (behaelter_nutzbar), Schwundbuchung nur aus dem eigenen Betrieb.
--  4. RPC s112_verschnitt_buchen(p_tenant_id, p_kopf, p_quellen): bucht den Verschnitt in EINER Transaktion –
--     Ziel und Quellen gesperrt (FOR UPDATE, Reihenfolge nach id), Bestandsprüfung, Momentaufnahme des Ziels vorher aus
--     der gesperrten Zeile, Verschnitt mit Gebinden, Quellen, Schwundbuchungen, Quellbestände (leer → abgeschlossen),
--     Zielbestand und die von der App nach den Fachregeln berechneten Merkmale (Sortenangabe 85-%-Regel, Qualität,
--     Herkunft, Mostgewicht; nur erlaubte Felder). Optimistische Prüfung: erwartete Bestände aus p_kopf/p_quellen
--     (die Grundlage der Fachregeln) – weicht der Bestand ab, Fehler 40001 („bitte erneut buchen“).
--     Genutzt vom Verschneiden-Formular, vom Umzug in ein befülltes Gebinde mit abweichenden Merkmalen (statt
--     Zwischencharge) und vom Assistenten.
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

-- 1. Spalten ───────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verschneidungen
  ADD COLUMN ziel_behaelter_id uuid REFERENCES public.behaelter(id),
  ADD COLUMN gebinde_rekonstruiert boolean NOT NULL DEFAULT false;
ALTER TABLE public.verschneidung_quellen
  ADD COLUMN quell_behaelter_id uuid REFERENCES public.behaelter(id),
  ADD COLUMN gebinde_rekonstruiert boolean NOT NULL DEFAULT false,
  ADD COLUMN schwund_umzug_id uuid REFERENCES public.keller_umzuege(id);
COMMENT ON COLUMN public.verschneidungen.ziel_behaelter_id IS 'KAN-112: Gebinde der Ziel-Charge beim Verschnitt (Momentaufnahme)';
COMMENT ON COLUMN public.verschneidung_quellen.quell_behaelter_id IS 'KAN-112: Gebinde, aus dem die Quelle kam (Momentaufnahme)';
COMMENT ON COLUMN public.verschneidung_quellen.gebinde_rekonstruiert IS 'KAN-112: Gebinde nachträglich aus den Umzügen ermittelt (Altdaten)';
COMMENT ON COLUMN public.verschneidung_quellen.schwund_umzug_id IS 'KAN-112: Schwundbuchung (keller_umzuege, schwund) dieser Quelle beim Verschnitt';
CREATE INDEX verschneidung_quellen_schwund_idx ON public.verschneidung_quellen (schwund_umzug_id) WHERE schwund_umzug_id IS NOT NULL;

-- 2. Nachbefüllung der Altdaten (Regel KAN-77) ──────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.k112_gebinde_am_tag(p_charge uuid, p_datum date) RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    (SELECT u.nach_behaelter_id FROM public.keller_umzuege u
      WHERE u.nach_weinausbau_id = p_charge AND u.storniert_am IS NULL AND u.datum <= p_datum AND u.nach_behaelter_id IS NOT NULL
      ORDER BY u.datum DESC, u.erstellt_am DESC, u.id DESC LIMIT 1),
    (SELECT u.von_behaelter_id FROM public.keller_umzuege u
      WHERE u.von_weinausbau_id = p_charge AND u.storniert_am IS NULL AND u.datum > p_datum AND u.von_behaelter_id IS NOT NULL
      ORDER BY u.datum, u.erstellt_am, u.id LIMIT 1),
    (SELECT w.behaelter_id FROM public.weinausbau w WHERE w.id = p_charge))
$f$;

CREATE FUNCTION pg_temp.k112_quellgebinde(p_quelle uuid, p_ziel uuid, p_datum date) RETURNS uuid LANGUAGE plpgsql STABLE AS $f$
DECLARE
  v_q   uuid := pg_temp.k112_gebinde_am_tag(p_quelle, p_datum);
  v_z   uuid := CASE WHEN p_ziel IS NULL THEN NULL ELSE pg_temp.k112_gebinde_am_tag(p_ziel, p_datum) END;
  v_ein record;
  v_h   uuid;
BEGIN
  IF v_q IS NULL OR v_z IS NULL OR v_q <> v_z THEN
    RETURN v_q;
  END IF;
  -- Zwischencharge im Ziel-Gebinde: Herkunftsgebinde des letzten Umzugs in die Quelle
  SELECT u.* INTO v_ein FROM public.keller_umzuege u
   WHERE u.nach_weinausbau_id = p_quelle AND u.storniert_am IS NULL AND u.datum <= p_datum
   ORDER BY u.datum DESC, u.erstellt_am DESC, u.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN v_q;
  END IF;
  v_h := v_ein.von_behaelter_id;
  IF v_h IS NULL AND v_ein.umzug_batch_id IS NOT NULL THEN
    SELECT CASE WHEN count(DISTINCT q.von_behaelter_id) = 1 THEN min(q.von_behaelter_id::text)::uuid END INTO v_h
      FROM public.keller_umzuege q
     WHERE q.umzug_batch_id = v_ein.umzug_batch_id AND q.zeilen_typ = 'quelle' AND q.storniert_am IS NULL AND q.von_behaelter_id IS NOT NULL;
  END IF;
  IF v_h IS NULL AND v_ein.von_weinausbau_id IS NOT NULL THEN
    v_h := pg_temp.k112_gebinde_am_tag(v_ein.von_weinausbau_id, v_ein.datum);
  END IF;
  RETURN coalesce(v_h, v_q);
END $f$;

UPDATE public.verschneidungen v
   SET ziel_behaelter_id = pg_temp.k112_gebinde_am_tag(v.ziel_weinausbau_id, v.datum), gebinde_rekonstruiert = true
 WHERE v.ziel_behaelter_id IS NULL AND v.ziel_weinausbau_id IS NOT NULL;
UPDATE public.verschneidung_quellen q
   SET quell_behaelter_id = pg_temp.k112_quellgebinde(q.quell_weinausbau_id, v.ziel_weinausbau_id, v.datum), gebinde_rekonstruiert = true
  FROM public.verschneidungen v
 WHERE v.id = q.verschneidung_id AND q.quell_behaelter_id IS NULL AND q.quell_weinausbau_id IS NOT NULL;

-- 3. Mandantenschutz der neuen Verweise ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_verschnitt_verweise_pruefen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_neu    jsonb := to_jsonb(NEW);
  v_alt    jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_beh    uuid;
  v_schw   uuid;
BEGIN
  IF TG_TABLE_NAME = 'verschneidungen' THEN
    v_tenant := NEW.tenant_id;
    v_beh := (v_neu ->> 'ziel_behaelter_id')::uuid;
    IF v_beh IS NOT NULL AND (v_alt IS NULL OR (v_alt ->> 'ziel_behaelter_id') IS DISTINCT FROM (v_neu ->> 'ziel_behaelter_id'))
       AND NOT public.behaelter_nutzbar(v_beh, v_tenant) THEN
      RAISE EXCEPTION 'Gebinde gehört nicht zu diesem Betrieb (KAN-112).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT v.tenant_id INTO v_tenant FROM public.verschneidungen v WHERE v.id = NEW.verschneidung_id;
  v_beh := (v_neu ->> 'quell_behaelter_id')::uuid;
  IF v_beh IS NOT NULL AND (v_alt IS NULL OR (v_alt ->> 'quell_behaelter_id') IS DISTINCT FROM (v_neu ->> 'quell_behaelter_id'))
     AND (v_tenant IS NULL OR NOT public.behaelter_nutzbar(v_beh, v_tenant)) THEN
    RAISE EXCEPTION 'Gebinde gehört nicht zu diesem Betrieb (KAN-112).' USING ERRCODE = '42501';
  END IF;
  v_schw := (v_neu ->> 'schwund_umzug_id')::uuid;
  IF v_schw IS NOT NULL AND (v_alt IS NULL OR (v_alt ->> 'schwund_umzug_id') IS DISTINCT FROM (v_neu ->> 'schwund_umzug_id'))
     AND NOT EXISTS (SELECT 1 FROM public.keller_umzuege u WHERE u.id = v_schw AND u.tenant_id = v_tenant AND u.umzug_typ = 'schwund') THEN
    RAISE EXCEPTION 'Schwundbuchung gehört nicht zu diesem Verschnitt (KAN-112).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verschnitt_verweise_pruefen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_verschnitt_verweise BEFORE INSERT OR UPDATE OF ziel_behaelter_id ON public.verschneidungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_verschnitt_verweise_pruefen();
CREATE TRIGGER a_verschnitt_verweise BEFORE INSERT OR UPDATE OF quell_behaelter_id, schwund_umzug_id, verschneidung_id ON public.verschneidung_quellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_verschnitt_verweise_pruefen();

-- 4. RPC Verschnitt buchen ──────────────────────────────────────────────────────────────────────────────────────
-- p_kopf:    { datum, ziel_weinausbau_id | neue_ziel_charge, notizen?, ziel_menge_erwartet?, ziel: { rebsorte, jahrgang,
--              qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, kmw, oechsle, mostgewicht_einheit }? }
--            neue_ziel_charge (Umzug gemischter Quellen in ein leeres Gebinde): { name, behaelter_id, rebsorte?, jahrgang?,
--              weinart?, herkunft_code?, land_iso?, qualitaetsstufe?, zusatzbezeichnung?, erzeugnis?, status?, notizen? } –
--              wird in derselben Transaktion mit 0 L angelegt und ist dann das Ziel.
-- p_quellen: [ { weinausbau_id, menge_liter (in das Ziel), schwund_liter?, menge_erwartet? } ]
CREATE OR REPLACE FUNCTION public.s112_verschnitt_buchen(p_tenant_id uuid, p_kopf jsonb, p_quellen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_ziel_felder constant text[] := ARRAY['rebsorte', 'jahrgang', 'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis',
                                         'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit'];
  c_neu_felder  constant text[] := ARRAY['name', 'behaelter_id', 'rebsorte', 'jahrgang', 'weinart', 'herkunft_code', 'land_iso',
                                         'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'status', 'notizen'];
  v_nz      jsonb := p_kopf -> 'neue_ziel_charge';
  v_datum   date;
  v_ziel_id uuid;
  v_ziel    public.weinausbau%ROWTYPE;
  v_q       public.weinausbau%ROWTYPE;
  v_zf      jsonb := coalesce(p_kopf -> 'ziel', '{}'::jsonb);
  v_e       jsonb;
  v_id      uuid;
  v_vid     uuid;
  v_schw_id uuid;
  v_menge   numeric;
  v_schwund numeric;
  v_rest    numeric;
  v_summe   numeric := 0;
  v_k       text;
  v_n       integer := 0;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch');

  v_datum := (p_kopf ->> 'datum')::date;
  v_ziel_id := (p_kopf ->> 'ziel_weinausbau_id')::uuid;
  -- Neue Ziel-Charge (leeres Gebinde, gemischte Quellen) – in derselben Transaktion
  IF v_ziel_id IS NULL AND jsonb_typeof(v_nz) = 'object' AND v_datum IS NOT NULL THEN
    FOR v_k IN SELECT jsonb_object_keys(v_nz) LOOP
      IF NOT v_k = ANY (c_neu_felder) THEN
        RAISE EXCEPTION 'Feld „%“ kann für die neue Charge nicht gesetzt werden.', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF NULLIF(btrim(coalesce(v_nz ->> 'name', '')), '') IS NULL OR (v_nz ->> 'behaelter_id') IS NULL THEN
      RAISE EXCEPTION 'Bitte Name und Gebinde der neuen Charge angeben.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.behaelter_nutzbar((v_nz ->> 'behaelter_id')::uuid, p_tenant_id) THEN
      RAISE EXCEPTION 'Gebinde gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.weinausbau (tenant_id, name, behaelter_id, menge_liter, aktiv, rebsorte, jahrgang, weinart, herkunft_code,
        land_iso, qualitaetsstufe, zusatzbezeichnung, erzeugnis, status, notizen)
    VALUES (p_tenant_id, btrim(v_nz ->> 'name'), (v_nz ->> 'behaelter_id')::uuid, 0, true, v_nz ->> 'rebsorte', (v_nz ->> 'jahrgang')::integer,
        v_nz ->> 'weinart', v_nz ->> 'herkunft_code', coalesce(v_nz ->> 'land_iso', 'AT'), v_nz ->> 'qualitaetsstufe', v_nz ->> 'zusatzbezeichnung',
        v_nz ->> 'erzeugnis', coalesce(v_nz ->> 'status', 'ausbau'), v_nz ->> 'notizen')
    RETURNING id INTO v_ziel_id;
  END IF;
  IF v_datum IS NULL OR v_ziel_id IS NULL THEN
    RAISE EXCEPTION 'Bitte Datum und Ziel-Charge angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_quellen IS NULL OR jsonb_typeof(p_quellen) <> 'array' OR jsonb_array_length(p_quellen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Quell-Charge angeben.' USING ERRCODE = '22023';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(v_zf) LOOP
    IF NOT v_k = ANY (c_ziel_felder) THEN
      RAISE EXCEPTION 'Feld „%“ kann beim Verschnitt nicht gesetzt werden.', v_k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Sperren in fester Reihenfolge (Ziel und Quellen nach id) gegen Verklemmungen
  PERFORM 1 FROM public.weinausbau w
   WHERE w.tenant_id = p_tenant_id
     AND w.id IN (SELECT v_ziel_id UNION SELECT (e ->> 'weinausbau_id')::uuid FROM jsonb_array_elements(p_quellen) e)
   ORDER BY w.id FOR UPDATE;

  SELECT * INTO v_ziel FROM public.weinausbau w WHERE w.id = v_ziel_id AND w.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ziel-Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ziel.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Ziel-Charge „%“ ist storniert.', v_ziel.name USING ERRCODE = '22023';
  END IF;
  IF p_kopf ? 'ziel_menge_erwartet'
     AND abs(coalesce(v_ziel.menge_liter, 0) - coalesce((p_kopf ->> 'ziel_menge_erwartet')::numeric, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Der Bestand der Ziel-Charge „%“ hat sich inzwischen geändert – bitte erneut buchen.', v_ziel.name USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.verschneidungen (tenant_id, datum, ziel_weinausbau_id, notizen, ziel_behaelter_id,
      ziel_qualitaet_vorher, ziel_zusatz_vorher, ziel_erzeugnis_vorher, ziel_herkunft_code_vorher, ziel_rebsorte_vorher,
      ziel_jahrgang_vorher, ziel_kmw_vorher, ziel_oechsle_vorher, ziel_mostgewicht_einheit_vorher)
  VALUES (p_tenant_id, v_datum, v_ziel_id, NULLIF(btrim(coalesce(p_kopf ->> 'notizen', '')), ''), v_ziel.behaelter_id,
      v_ziel.qualitaetsstufe, v_ziel.zusatzbezeichnung, v_ziel.erzeugnis, v_ziel.herkunft_code, v_ziel.rebsorte,
      v_ziel.jahrgang, v_ziel.kmw, v_ziel.oechsle, v_ziel.mostgewicht_einheit)
  RETURNING id INTO v_vid;

  FOR v_e IN SELECT e FROM jsonb_array_elements(p_quellen) e LOOP
    v_id := (v_e ->> 'weinausbau_id')::uuid;
    v_menge := round(coalesce((v_e ->> 'menge_liter')::numeric, 0), 2);
    v_schwund := round(greatest(coalesce((v_e ->> 'schwund_liter')::numeric, 0), 0), 2);
    IF v_id IS NULL OR v_id = v_ziel_id THEN
      RAISE EXCEPTION 'Quelle und Ziel müssen verschiedene Chargen sein.' USING ERRCODE = '22023';
    END IF;
    IF v_menge < 0.01 THEN
      RAISE EXCEPTION 'Jede Quelle braucht mindestens 0,01 L.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_q FROM public.weinausbau w WHERE w.id = v_id AND w.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quell-Charge nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    IF v_q.storniert_am IS NOT NULL OR NOT coalesce(v_q.aktiv, false) THEN
      RAISE EXCEPTION 'Die Quell-Charge „%“ ist nicht aktiv.', v_q.name USING ERRCODE = '22023';
    END IF;
    IF v_e ? 'menge_erwartet' AND abs(coalesce(v_q.menge_liter, 0) - coalesce((v_e ->> 'menge_erwartet')::numeric, 0)) > 0.005 THEN
      RAISE EXCEPTION 'Der Bestand der Quell-Charge „%“ hat sich inzwischen geändert – bitte erneut buchen.', v_q.name USING ERRCODE = '40001';
    END IF;
    IF v_menge + v_schwund > coalesce(v_q.menge_liter, 0) + 0.005 THEN
      RAISE EXCEPTION 'Quell-Charge „%“: % L übersteigen den Bestand von % L.', v_q.name,
        replace(to_char(v_menge + v_schwund, 'FM999999990.00'), '.', ','), replace(to_char(coalesce(v_q.menge_liter, 0), 'FM999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;

    v_schw_id := NULL;
    IF v_schwund >= 0.01 THEN
      INSERT INTO public.keller_umzuege (tenant_id, datum, von_weinausbau_id, von_behaelter_id, nach_behaelter_id, menge_liter,
          brutto_liter, schwund_liter, umzug_typ, notizen)
      VALUES (p_tenant_id, v_datum, v_id, v_q.behaelter_id, v_q.behaelter_id, 0, v_schwund, v_schwund, 'schwund',
          format('Schwund beim Verschnitt in „%s“', v_ziel.name))
      RETURNING id INTO v_schw_id;
    END IF;

    INSERT INTO public.verschneidung_quellen (verschneidung_id, quell_weinausbau_id, menge_liter, anteil_pct, quell_behaelter_id, schwund_umzug_id)
    VALUES (v_vid, v_id, v_menge, NULL, v_q.behaelter_id, v_schw_id);

    v_rest := coalesce(v_q.menge_liter, 0) - v_menge - v_schwund;
    IF v_rest <= 0.01 THEN
      UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen' WHERE id = v_id AND tenant_id = p_tenant_id;
    ELSE
      UPDATE public.weinausbau SET menge_liter = round(v_rest, 2) WHERE id = v_id AND tenant_id = p_tenant_id;
    END IF;
    v_summe := v_summe + v_menge;
    v_n := v_n + 1;
  END LOOP;

  -- Anteil am Verschnitt (wie bisher: Anteil der Quelle an allen Quellen)
  UPDATE public.verschneidung_quellen q SET anteil_pct = round(q.menge_liter / v_summe * 100, 1)
   WHERE q.verschneidung_id = v_vid AND v_summe > 0;

  UPDATE public.weinausbau w SET
      menge_liter         = round(coalesce(v_ziel.menge_liter, 0) + v_summe, 2),
      rebsorte            = CASE WHEN v_zf ? 'rebsorte' THEN v_zf ->> 'rebsorte' ELSE w.rebsorte END,
      jahrgang            = CASE WHEN v_zf ? 'jahrgang' THEN (v_zf ->> 'jahrgang')::integer ELSE w.jahrgang END,
      qualitaetsstufe     = CASE WHEN v_zf ? 'qualitaetsstufe' THEN v_zf ->> 'qualitaetsstufe' ELSE w.qualitaetsstufe END,
      zusatzbezeichnung   = CASE WHEN v_zf ? 'zusatzbezeichnung' THEN v_zf ->> 'zusatzbezeichnung' ELSE w.zusatzbezeichnung END,
      erzeugnis           = CASE WHEN v_zf ? 'erzeugnis' THEN v_zf ->> 'erzeugnis' ELSE w.erzeugnis END,
      herkunft_code       = CASE WHEN v_zf ? 'herkunft_code' THEN v_zf ->> 'herkunft_code' ELSE w.herkunft_code END,
      kmw                 = CASE WHEN v_zf ? 'kmw' THEN (v_zf ->> 'kmw')::numeric ELSE w.kmw END,
      oechsle             = CASE WHEN v_zf ? 'oechsle' THEN (v_zf ->> 'oechsle')::numeric ELSE w.oechsle END,
      mostgewicht_einheit = CASE WHEN v_zf ? 'mostgewicht_einheit' THEN v_zf ->> 'mostgewicht_einheit' ELSE w.mostgewicht_einheit END
   WHERE w.id = v_ziel_id AND w.tenant_id = p_tenant_id;

  RETURN jsonb_build_object('verschneidung_id', v_vid, 'ziel_weinausbau_id', v_ziel_id, 'quellen', v_n, 'liter', v_summe,
                            'ziel_menge', round(coalesce(v_ziel.menge_liter, 0) + v_summe, 2));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verschnitt_buchen(uuid, jsonb, jsonb) FROM PUBLIC, anon;