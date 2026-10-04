-- KAN-101 (04.10.2026): Füllung – DB-Sperre der Merkmale per Freeze-Trigger, Charge und Prüfnummer einmal nachtragbar.
-- R22 „bei füllung muss alles ausser produktname gefroren sein“; Matrix KAN-85: nach dem Speichern alles außer Produktname,
-- Preise, KN-Code, Notizen. Entscheidungen Jörgen (04.10.2026):
--   * Charge einer Füllung ohne Charge (Import/Altbestand) einmal nachtragbar (leer → Wert, protokolliert).
--   * Tippfehler bei Anzahl, Flaschengröße oder Abfülldatum: Storno + Neuanlage (sonst Betriebsleitung mit Grund,
--     s112_freeze_korrektur).
--
--  1. a_freeze auf fuellungen: nicht stornierte Füllungen nur noch in name, vk_preis_brutto, einstandspreis, mwst_pct,
--     zolltarifnummer, notizen, aktiv, aktualisiert_am und den Storno-Spalten änderbar (Positivliste – auch die
--     KAN-40-Spalten weinart, erzeugnis, zusatzbezeichnung, land_iso sind damit gesperrt).
--  2. Bestandsbuchungen (fuellung_bestand_buchen, s112_fuellung_verkauf_buchen) setzen s112.freeze_frei = 'fuellungen'.
--  3. s112_fuellung_nachtragen(tenant, füllung, charge, dac_antrag): Charge nur von leer auf einen Wert; DAC-Antrag nur
--     von leer auf einen Antrag DERSELBEN Charge (eingereicht, in Prüfung, zugeteilt; aktiv, nicht storniert); Prüfnummer
--     nur von leer auf die Nummer des Antrags, wenn er zugeteilt ist (bzw. erloschen/aufgebraucht – die Flaschen behalten
--     sie, KAN-97). Ein zweiter Nachtrag endet mit 42501. Grund im Bestandsprotokoll (s112.aenderung_grund).
--     Die Datumsregeln aus KAN-72 (Nummer gilt am Abfülldatum) prüft die Server Action vorher.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Sperre ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Füllung gespeichert',
    $$o.storniert_am IS NULL$$,
    'name,vk_preis_brutto,einstandspreis,mwst_pct,zolltarifnummer,notizen,aktiv,aktualisiert_am,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'erstellt_am');

-- 2. Bestandsbuchungen ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fuellung_bestand_buchen(p_tenant_id uuid, p_fuellung_id uuid, p_art text, p_datum date, p_menge_stk integer DEFAULT NULL::integer, p_ist_bestand integer DEFAULT NULL::integer, p_grund text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt   integer;
  v_delta bigint;
  v_neu   bigint;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus

  IF NOT public.ist_service_kontext()
     AND NOT public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft') THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Füllungen in diesem Betrieb' USING ERRCODE = '42501';
  END IF;

  IF p_art IS NULL OR p_art NOT IN ('inventur', 'bruch', 'eigenverbrauch', 'schwund', 'korrektur', 'anfangsbestand') THEN
    RAISE EXCEPTION 'Unbekannte Buchungsart „%“ (erlaubt: inventur, bruch, eigenverbrauch, schwund, korrektur, anfangsbestand)',
      COALESCE(p_art, '') USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Buchungsdatum angeben' USING ERRCODE = '22023';
  END IF;

  SELECT f.bestand_flaschen INTO v_alt
    FROM public.fuellungen f
   WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden' USING ERRCODE = 'P0002';
  END IF;

  IF p_art = 'inventur' THEN
    IF p_ist_bestand IS NULL OR p_ist_bestand < 0 THEN
      RAISE EXCEPTION 'Für eine Inventur bitte den gezählten Ist-Bestand (0 oder mehr Flaschen) angeben' USING ERRCODE = '22023';
    END IF;
    v_delta := p_ist_bestand::bigint - v_alt;
    IF v_delta = 0 THEN
      RAISE EXCEPTION 'Keine Differenz: Der gezählte Bestand entspricht dem aktuellen Bestand (% Flaschen)', v_alt
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_menge_stk IS NULL OR p_menge_stk = 0 THEN
      RAISE EXCEPTION 'Bitte eine Menge in Stück (ungleich 0) angeben' USING ERRCODE = '22023';
    END IF;
    IF p_art IN ('bruch', 'eigenverbrauch', 'schwund') AND p_menge_stk > 0 THEN
      RAISE EXCEPTION 'Bei „%“ ist die Menge ein Abgang und muss negativ sein', p_art USING ERRCODE = '22023';
    END IF;
    v_delta := p_menge_stk;
  END IF;

  v_neu := v_alt::bigint + v_delta;   -- bigint: kein „integer out of range“
  IF v_neu < 0 THEN
    RAISE EXCEPTION 'Der Flaschenbestand darf nicht negativ werden (aktuell % Flaschen, Buchung % Flaschen)', v_alt, v_delta
      USING ERRCODE = '22023';
  END IF;
  IF v_neu > 2147483647 THEN
    RAISE EXCEPTION 'Der neue Flaschenbestand (% Flaschen) ist unplausibel groß – bitte die Menge prüfen', v_neu
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fuellung_bewegungen
    (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_von)
  VALUES
    (p_tenant_id, p_fuellung_id, p_datum, p_art, v_delta::integer, v_alt, v_neu::integer,
     NULLIF(btrim(p_grund), ''), auth.uid());

  -- KAN-101: Bestand trotz Freeze-Sperre (nur diese Buchung)
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen
     SET bestand_flaschen = v_neu::integer
   WHERE id = p_fuellung_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.freeze_frei', '', true);

  RETURN v_neu::integer;
END;
$function$;

CREATE OR REPLACE FUNCTION public.s112_fuellung_verkauf_buchen(p_tenant_id uuid, p_fuellung_id uuid, p_verkaufsposten_id uuid, p_menge_stk integer, p_datum date, p_grund text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt  integer;
  v_name text;
  v_neu  bigint;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);

  IF NOT public.ist_service_kontext()
     AND NOT public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft') THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für den Flaschenbestand in diesem Betrieb' USING ERRCODE = '42501';
  END IF;
  IF p_verkaufsposten_id IS NULL THEN
    RAISE EXCEPTION 'Verkauf fehlt' USING ERRCODE = '22023';
  END IF;
  -- Ein vorhandener Beleg muss zum Betrieb gehören (vor dem Anlegen gibt es ihn noch nicht, KAN-35)
  IF EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.id = p_verkaufsposten_id AND v.tenant_id <> p_tenant_id) THEN
    RAISE EXCEPTION 'Verkauf nicht gefunden' USING ERRCODE = 'P0002';
  END IF;
  IF p_menge_stk IS NULL OR p_menge_stk = 0 THEN
    RAISE EXCEPTION 'Bitte eine Menge in Stück (ungleich 0) angeben' USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Buchungsdatum angeben' USING ERRCODE = '22023';
  END IF;

  SELECT f.bestand_flaschen, f.name INTO v_alt, v_name
    FROM public.fuellungen f
   WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden – bitte Seite neu laden' USING ERRCODE = 'P0002';
  END IF;
  v_alt := COALESCE(v_alt, 0);
  v_neu := v_alt::bigint + p_menge_stk;
  IF v_neu < 0 THEN
    RAISE EXCEPTION '„%“: nur noch % Flaschen verfügbar, % angefragt.', COALESCE(v_name, 'Füllung'), v_alt, -p_menge_stk
      USING ERRCODE = '22023';
  END IF;
  IF v_neu > 2147483647 THEN
    RAISE EXCEPTION 'Der neue Flaschenbestand (% Flaschen) ist unplausibel groß – bitte die Menge prüfen', v_neu USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fuellung_bewegungen
    (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_von, verkaufsposten_id)
  VALUES
    (p_tenant_id, p_fuellung_id, p_datum, CASE WHEN p_menge_stk < 0 THEN 'verkauf' ELSE 'verkauf_storno' END,
     p_menge_stk, v_alt, v_neu::integer, NULLIF(btrim(p_grund), ''), auth.uid(), p_verkaufsposten_id);

  -- KAN-101: Bestand trotz Freeze-Sperre (nur diese Buchung)
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen
     SET bestand_flaschen = v_neu::integer
   WHERE id = p_fuellung_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.freeze_frei', '', true);

  RETURN v_neu::integer;
END;
$function$;

-- 3. Nachtrag Charge / DAC-Antrag / Prüfnummer ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_fuellung_nachtragen(p_tenant_id uuid, p_fuellung_id uuid, p_weinausbau_id uuid, p_dac_antrag_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_f      public.fuellungen%ROWTYPE;
  v_a      public.dac_antrag%ROWTYPE;
  v_charge uuid;
  v_neu_wa uuid;
  v_neu_da uuid;
  v_neu_pn text;
  v_teile  text[] := '{}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.ist_service_kontext()
     AND NOT public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft') THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Füllungen in diesem Betrieb' USING ERRCODE = '42501';
  END IF;
  IF p_weinausbau_id IS NULL AND p_dac_antrag_id IS NULL THEN
    RAISE EXCEPTION 'Nichts nachzutragen – bitte Charge oder DAC-Antrag wählen.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_f FROM public.fuellungen f WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_f.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Füllung ist storniert und kann nicht mehr geändert werden.' USING ERRCODE = '42501';
  END IF;
  v_neu_wa := v_f.weinausbau_id;
  v_neu_da := v_f.dac_antrag_id;
  v_neu_pn := v_f.pruefnummer;

  -- Charge: nur von leer auf einen Wert
  IF p_weinausbau_id IS NOT NULL AND p_weinausbau_id IS DISTINCT FROM v_f.weinausbau_id THEN
    IF v_f.weinausbau_id IS NOT NULL THEN
      RAISE EXCEPTION 'Die Charge der Füllung ist bereits eingetragen – Korrekturen nur durch die Betriebsleitung (mit Grund).'
        USING ERRCODE = '42501', HINT = 'nachtrag';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Die gewählte Kellerbuch-Charge wurde nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    v_neu_wa := p_weinausbau_id;
    v_teile := v_teile || 'Charge'::text;
  END IF;

  -- DAC-Antrag / Prüfnummer: nur aus einem Antrag derselben Charge
  IF p_dac_antrag_id IS NOT NULL THEN
    IF v_f.dac_antrag_id IS NOT NULL AND v_f.dac_antrag_id IS DISTINCT FROM p_dac_antrag_id THEN
      RAISE EXCEPTION 'Die Füllung ist bereits mit einem anderen DAC-Antrag verknüpft – Korrekturen nur durch die Betriebsleitung (mit Grund).'
        USING ERRCODE = '42501', HINT = 'nachtrag';
    END IF;
    IF v_f.pruefnummer IS NOT NULL THEN
      RAISE EXCEPTION 'Die Prüfnummer der Füllung ist bereits eingetragen (%) – Korrekturen nur durch die Betriebsleitung (mit Grund).', v_f.pruefnummer
        USING ERRCODE = '42501', HINT = 'nachtrag';
    END IF;
    SELECT * INTO v_a FROM public.dac_antrag a WHERE a.id = p_dac_antrag_id AND a.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DAC-Antrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
    END IF;
    v_charge := v_neu_wa;
    IF v_charge IS NULL OR v_a.weinausbau_id IS DISTINCT FROM v_charge THEN
      RAISE EXCEPTION 'Der DAC-Antrag gehört nicht zur Charge der Füllung.' USING ERRCODE = '42501', HINT = 'nachtrag';
    END IF;
    IF v_a.storniert_am IS NOT NULL OR NOT v_a.aktiv
       OR v_a.status NOT IN ('eingereicht', 'in_pruefung', 'genehmigt', 'erloschen', 'aufgebraucht') THEN
      RAISE EXCEPTION 'Der DAC-Antrag ist nicht eingereicht bzw. zugeteilt (Status „%“) und kann nicht verknüpft werden.', v_a.status
        USING ERRCODE = '42501', HINT = 'nachtrag';
    END IF;
    IF v_f.dac_antrag_id IS NULL THEN
      v_neu_da := v_a.id;
      v_teile := v_teile || 'DAC-Antrag'::text;
    END IF;
    IF v_a.status IN ('genehmigt', 'erloschen', 'aufgebraucht') AND nullif(btrim(coalesce(v_a.pruefnummer, '')), '') IS NOT NULL THEN
      v_neu_pn := btrim(v_a.pruefnummer);
      v_teile := v_teile || ('Prüfnummer ' || v_neu_pn);
    ELSIF v_f.dac_antrag_id IS NOT NULL THEN
      RAISE EXCEPTION 'Der DAC-Antrag hat noch keine zugeteilte Prüfnummer – bitte nach dem Bescheid erneut nachtragen.'
        USING ERRCODE = '42501', HINT = 'nachtrag';
    END IF;
  END IF;

  IF cardinality(v_teile) = 0 THEN
    RAISE EXCEPTION 'Nichts nachzutragen – die Angaben sind bereits eingetragen.' USING ERRCODE = '42501', HINT = 'nachtrag';
  END IF;

  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  PERFORM set_config('s112.aenderung_grund', 'Nachtrag ' || array_to_string(v_teile, ', '), true);
  UPDATE public.fuellungen f
     SET weinausbau_id = v_neu_wa, dac_antrag_id = v_neu_da, pruefnummer = v_neu_pn
   WHERE f.id = v_f.id;
  PERFORM set_config('s112.aenderung_grund', '', true);
  PERFORM set_config('s112.freeze_frei', '', true);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_nachtragen(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_fuellung_nachtragen(uuid, uuid, uuid, uuid) TO authenticated;
