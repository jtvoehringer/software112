-- KAN-413 (11.11.2026): Sammelmaßnahme im Kellerbuch – dieselbe Kellerbehandlung für mehrere Gebinde auf einmal.
--
-- Je Charge entsteht eine eigene Zeile in keller_behandlungen (Weinbuch, Kellerbuch, Prüfnummer und Periodensperre
-- greifen je Zeile wie bisher), verbunden über sammel_id. Die Aufteilung von Menge und Stoff rechnet die App
-- (src/lib/kellerbuch/sammelbehandlung.ts); die RPC schreibt alle Behandlungen und die Verwendungen im Stoffkonto in
-- EINER Transaktion: Scheitert eine Zeile (abgeschlossener Zeitraum, Fremdverweis, Modulrecht), wird nichts gespeichert.
--
-- SECURITY INVOKER: Die Funktion schreibt mit den Rechten des Benutzers – RLS (Mitgliedschaft, Modul Kellerbuch,
-- Abo-Schreibsperre, Zwei-Faktor) und alle Trigger der Tabellen gelten unverändert.
-- sammel_id ist nach dem Anlegen unveränderlich, sobald die Charge eine Prüfnummer hat (a_freeze: Positivliste).

ALTER TABLE public.keller_behandlungen ADD COLUMN sammel_id uuid;
COMMENT ON COLUMN public.keller_behandlungen.sammel_id IS
  'KAN-413: verbindet die Behandlungen einer Sammelmaßnahme (mehrere Gebinde, eine Erfassung); NULL = Einzelbehandlung';

CREATE INDEX keller_behandlungen_sammel_idx ON public.keller_behandlungen (tenant_id, sammel_id) WHERE sammel_id IS NOT NULL;

CREATE FUNCTION public.s112_kellerbehandlung_sammel(p_tenant_id uuid, p_kopf jsonb, p_zeilen jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $f$
DECLARE
  v_sammel      uuid := gen_random_uuid();
  v_datum       date;
  v_typ         uuid;
  v_typ_name    text;
  v_einheit     text;
  v_notizen     text;
  v_stoff       uuid;
  v_anzahl      integer;
  v_zeile       jsonb;
  v_charge      uuid;
  v_behaelter   uuid;
  v_liter       numeric;
  v_menge       numeric;
  v_stoff_menge numeric;
  v_id          uuid;
  v_gesehen     uuid[] := '{}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  IF p_kopf IS NULL OR jsonb_typeof(p_kopf) <> 'object' OR p_zeilen IS NULL OR jsonb_typeof(p_zeilen) <> 'array' THEN
    RAISE EXCEPTION 'Sammelmaßnahme: ungültige Angaben.' USING ERRCODE = '22023';
  END IF;
  v_anzahl := jsonb_array_length(p_zeilen);
  IF v_anzahl < 2 OR v_anzahl > 200 THEN
    RAISE EXCEPTION 'Eine Sammelmaßnahme umfasst 2 bis 200 Chargen (angegeben: %).', v_anzahl USING ERRCODE = '22023';
  END IF;

  v_datum   := NULLIF(p_kopf ->> 'datum', '')::date;
  v_typ     := NULLIF(p_kopf ->> 'typ_id', '')::uuid;
  v_einheit := NULLIF(p_kopf ->> 'einheit', '');
  v_notizen := NULLIF(btrim(COALESCE(p_kopf ->> 'notizen', '')), '');
  v_stoff   := NULLIF(p_kopf ->> 'kellermittel_id', '')::uuid;
  IF v_datum IS NULL OR v_typ IS NULL THEN
    RAISE EXCEPTION 'Sammelmaßnahme: Datum und Behandlungstyp sind Pflicht.' USING ERRCODE = '22023';
  END IF;

  SELECT t.name INTO v_typ_name FROM public.keller_behandlungstypen t WHERE t.id = v_typ AND t.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Behandlungstyp nicht gefunden.' USING ERRCODE = '22023';
  END IF;
  IF v_stoff IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.kellermittel k WHERE k.id = v_stoff AND k.tenant_id = p_tenant_id AND k.aktiv) THEN
    RAISE EXCEPTION 'Stoff nicht gefunden oder nicht aktiv.' USING ERRCODE = '22023';
  END IF;

  FOR v_zeile IN SELECT e.value FROM jsonb_array_elements(p_zeilen) AS e(value) LOOP
    v_charge := NULLIF(v_zeile ->> 'weinausbau_id', '')::uuid;
    IF v_charge IS NULL THEN
      RAISE EXCEPTION 'Sammelmaßnahme: Zeile ohne Charge.' USING ERRCODE = '22023';
    END IF;
    IF v_charge = ANY (v_gesehen) THEN
      RAISE EXCEPTION 'Sammelmaßnahme: Eine Charge ist doppelt angegeben.' USING ERRCODE = '22023';
    END IF;
    v_gesehen := v_gesehen || v_charge;

    -- Gebinde und Volumen kommen aus der Charge selbst, nicht aus der Anfrage
    SELECT w.behaelter_id, w.menge_liter INTO v_behaelter, v_liter
      FROM public.weinausbau w WHERE w.id = v_charge AND w.tenant_id = p_tenant_id AND w.aktiv;
    IF NOT FOUND OR v_behaelter IS NULL THEN
      RAISE EXCEPTION 'Sammelmaßnahme: Charge nicht gefunden, nicht aktiv oder ohne Gebinde.' USING ERRCODE = '22023';
    END IF;

    v_menge := NULLIF(v_zeile ->> 'menge', '')::numeric;
    IF v_einheit IS DISTINCT FROM '-' AND (v_menge IS NULL OR v_menge <= 0) THEN
      RAISE EXCEPTION 'Sammelmaßnahme: Jede Charge braucht eine Menge über 0 (oder die Einheit „-“).' USING ERRCODE = '22023';
    END IF;
    IF v_einheit = '-' THEN
      v_menge := NULL;
    END IF;

    INSERT INTO public.keller_behandlungen
           (tenant_id, behaelter_id, weinausbau_id, datum, typ_id, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, sammel_id)
    VALUES (p_tenant_id, v_behaelter, v_charge, v_datum, v_typ, v_typ_name, v_menge, v_einheit,
            CASE WHEN v_liter > 0 THEN v_liter END, v_notizen, v_sammel)
    RETURNING id INTO v_id;

    IF v_stoff IS NOT NULL THEN
      v_stoff_menge := NULLIF(v_zeile ->> 'stoff_menge', '')::numeric;
      IF v_stoff_menge IS NULL OR v_stoff_menge <= 0 THEN
        RAISE EXCEPTION 'Sammelmaßnahme: Jede Charge braucht einen Anteil des Stoffs über 0.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.kellermittel_buchungen
             (tenant_id, kellermittel_id, datum, art, menge, keller_behandlung_id, weinausbau_id, behaelter_id, zweck)
      VALUES (p_tenant_id, v_stoff, v_datum, 'verwendung', -round(v_stoff_menge, 3), v_id, v_charge, v_behaelter, v_typ_name);
    END IF;
  END LOOP;

  RETURN v_sammel;
END
$f$;

COMMENT ON FUNCTION public.s112_kellerbehandlung_sammel(uuid, jsonb, jsonb) IS
  'KAN-413: Sammelmaßnahme – legt je Charge eine Kellerbehandlung (gleiche sammel_id) und die Verwendung im Stoffkonto an, alles in einer Transaktion; läuft mit den Rechten des Benutzers';

REVOKE EXECUTE ON FUNCTION public.s112_kellerbehandlung_sammel(uuid, jsonb, jsonb) FROM PUBLIC, anon;
