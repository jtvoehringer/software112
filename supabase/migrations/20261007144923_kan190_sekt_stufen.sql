-- KAN-190 (07.10.2026): Sekt – Stufen Sekt Austria (Klassik) / Reserve / Große Reserve und Hefelagerung im Kellerbuch.
-- Entscheidung Jörgen 06.10.2026: „umsetzen wie im Vorschlag beschrieben“.
--  1. fuellungen += tirage_datum (Beginn der Zweitgärung = Stichtag der Hefelagerung), gaermethode (flaschengaerung |
--     tankgaerung), sekt_stufe (klassik | reserve | grosse_reserve), degorgiert_am, sekt_lagenrein. Tirage-Angaben nur bei
--     Erzeugnis SEKTGU (Sekt g.U.); beim Anlegen gesetzt, danach wie alle Merkmale gesperrt (Freeze-Positivliste a_freeze).
--  2. RPC s112_sekt_stufe_setzen: Stufe vergeben bzw. degorgieren – Hefelagerung ≥ 9 / 18 / 36 Monate ab Tirage (bis zum
--     Degorgieren, sonst bis heute), Reserve und Große Reserve nur mit traditioneller Flaschengärung, Große Reserve nur
--     lagenrein (die App ermittelt das aus der Zusammensetzung der Füllung: 100 % eine Ried); Abstufen ja, Aufwerten nein;
--     Degorgieren einmal. Schreibt über set_config('s112.freeze_frei', 'fuellungen').
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 62, dann Produktion.

-- 1. Spalten ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellungen
  ADD COLUMN tirage_datum   date,
  ADD COLUMN gaermethode    text CHECK (gaermethode IS NULL OR gaermethode IN ('flaschengaerung', 'tankgaerung')),
  ADD COLUMN sekt_stufe     text CHECK (sekt_stufe IS NULL OR sekt_stufe IN ('klassik', 'reserve', 'grosse_reserve')),
  ADD COLUMN degorgiert_am  date,
  ADD COLUMN sekt_lagenrein boolean;
ALTER TABLE public.fuellungen ADD CONSTRAINT fuellungen_tirage_nur_sekt
  CHECK ((tirage_datum IS NULL AND gaermethode IS NULL AND sekt_stufe IS NULL AND degorgiert_am IS NULL) OR erzeugnis = 'SEKTGU');
ALTER TABLE public.fuellungen ADD CONSTRAINT fuellungen_tirage_vollstaendig
  CHECK ((tirage_datum IS NULL) = (gaermethode IS NULL));
ALTER TABLE public.fuellungen ADD CONSTRAINT fuellungen_sekt_stufe_mit_tirage
  CHECK ((sekt_stufe IS NULL AND degorgiert_am IS NULL) OR tirage_datum IS NOT NULL);
ALTER TABLE public.fuellungen ADD CONSTRAINT fuellungen_degorgiert_nach_tirage
  CHECK (degorgiert_am IS NULL OR degorgiert_am >= tirage_datum);
COMMENT ON COLUMN public.fuellungen.tirage_datum IS 'KAN-190: Beginn der Zweitgärung (Tirage) – Stichtag der Hefelagerung; nur bei Sekt g.U.';
COMMENT ON COLUMN public.fuellungen.sekt_stufe IS 'KAN-190: Sekt Austria (klassik ≥ 9 Monate), Reserve (≥ 18, Flaschengärung), Große Reserve (≥ 36, Flaschengärung, lagenrein) – nur über s112_sekt_stufe_setzen';

-- 2. RPC ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_sekt_stufe_setzen(p_tenant_id uuid, p_fuellung_id uuid, p_stufe text, p_degorgiert_am date,
  p_lagenrein boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_f       public.fuellungen%ROWTYPE;
  v_heute   date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_stufe   text;
  v_degorg  date;
  v_stich   date;
  v_monate  integer;
  v_min     integer;
  v_rang    jsonb := '{"klassik": 1, "reserve": 2, "grosse_reserve": 3}';
  v_label   jsonb := '{"klassik": "Sekt Austria", "reserve": "Sekt Austria Reserve", "grosse_reserve": "Sekt Austria Große Reserve"}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Kellerbuch bzw. Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_f FROM public.fuellungen f WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_f.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Füllung ist storniert.' USING ERRCODE = '22023';
  END IF;
  IF v_f.erzeugnis IS DISTINCT FROM 'SEKTGU' OR v_f.tirage_datum IS NULL THEN
    RAISE EXCEPTION 'Sekt-Stufen gibt es nur für Sekt g.U. mit erfasster Tirage (Beginn der Zweitgärung).' USING ERRCODE = '22023';
  END IF;
  IF p_stufe IS NOT NULL AND NOT (v_rang ? p_stufe) THEN
    RAISE EXCEPTION 'Unbekannte Sekt-Stufe „%“.', p_stufe USING ERRCODE = '22023';
  END IF;
  v_stufe := coalesce(p_stufe, v_f.sekt_stufe);
  IF v_stufe IS NULL AND p_degorgiert_am IS NULL THEN
    RAISE EXCEPTION 'Bitte eine Sekt-Stufe wählen oder das Datum des Degorgierens angeben.' USING ERRCODE = '22023';
  END IF;
  -- nur abstufen, nie aufwerten
  IF v_f.sekt_stufe IS NOT NULL AND (v_rang ->> v_stufe)::int > (v_rang ->> v_f.sekt_stufe)::int THEN
    RAISE EXCEPTION '„%“ ist schon vergeben – eine Aufwertung auf „%“ ist nicht möglich (nur Abstufen).',
      v_label ->> v_f.sekt_stufe, v_label ->> v_stufe USING ERRCODE = '22023';
  END IF;
  -- Degorgieren einmal, nicht vor der Tirage, nicht in der Zukunft
  IF p_degorgiert_am IS NOT NULL THEN
    IF v_f.degorgiert_am IS NOT NULL AND v_f.degorgiert_am <> p_degorgiert_am THEN
      RAISE EXCEPTION 'Die Füllung ist bereits am % degorgiert.', to_char(v_f.degorgiert_am, 'DD.MM.YYYY') USING ERRCODE = '22023';
    END IF;
    IF p_degorgiert_am > v_heute OR p_degorgiert_am < v_f.tirage_datum THEN
      RAISE EXCEPTION 'Das Datum des Degorgierens muss zwischen der Tirage (%) und heute liegen.', to_char(v_f.tirage_datum, 'DD.MM.YYYY')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_degorg := coalesce(p_degorgiert_am, v_f.degorgiert_am);
  -- Regeln der Stufe: Hefelagerung bis zum Degorgieren (sonst bis heute), Gärmethode, Lagenreinheit
  IF v_stufe IS NOT NULL THEN
    v_stich := coalesce(v_degorg, v_heute);
    v_monate := (extract(year FROM age(v_stich, v_f.tirage_datum)) * 12 + extract(month FROM age(v_stich, v_f.tirage_datum)))::int;
    v_min := CASE v_stufe WHEN 'klassik' THEN 9 WHEN 'reserve' THEN 18 ELSE 36 END;
    IF v_monate < v_min THEN
      RAISE EXCEPTION '„%“ verlangt mindestens % Monate Hefelagerung – seit der Tirage am % sind es % Monate.',
        v_label ->> v_stufe, v_min, to_char(v_f.tirage_datum, 'DD.MM.YYYY'), v_monate USING ERRCODE = '22023', HINT = 'sekt_hefelagerung';
    END IF;
    IF v_stufe IN ('reserve', 'grosse_reserve') AND v_f.gaermethode <> 'flaschengaerung' THEN
      RAISE EXCEPTION '„%“ verlangt die traditionelle Flaschengärung.', v_label ->> v_stufe USING ERRCODE = '22023';
    END IF;
    IF v_stufe = 'grosse_reserve' AND NOT coalesce(p_lagenrein, false) THEN
      RAISE EXCEPTION '„Sekt Austria Große Reserve“ verlangt lagenreine Trauben (100 %% aus einer Ried).' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen
     SET sekt_stufe = v_stufe, degorgiert_am = v_degorg,
         sekt_lagenrein = CASE WHEN v_stufe IS NOT NULL THEN coalesce(p_lagenrein, false) ELSE sekt_lagenrein END
   WHERE id = p_fuellung_id;
  PERFORM set_config('s112.freeze_frei', '', true);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_sekt_stufe_setzen(uuid, uuid, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_sekt_stufe_setzen(uuid, uuid, text, date, boolean) TO authenticated;
COMMENT ON FUNCTION public.s112_sekt_stufe_setzen(uuid, uuid, text, date, boolean) IS
  'KAN-190: Sekt-Stufe vergeben bzw. degorgieren – Hefelagerung ≥ 9/18/36 Monate ab Tirage, Reserve/Große Reserve nur Flaschengärung, Große Reserve lagenrein; nur abstufen, Degorgieren einmal';
