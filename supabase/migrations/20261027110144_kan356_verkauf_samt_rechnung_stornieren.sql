-- KAN-356 (27.10.2026): Verkauf samt Rechnung stornieren – in einer Transaktion
--
-- Bisher zwei Schritte: erst „Rechnung stornieren“ (s112_rechnung_stornieren – Lieferschein wieder offen, Bestand bleibt),
-- dann „Verkauf stornieren“ (App-Code: Bestand zurück, Kennzeichen, Sonstige Produkte, Traubenverkauf). Scheitert der
-- zweite Schritt, bleibt ein offener Lieferschein ohne Rechnung stehen. Entscheidung Jörgen (Jira KAN-356): ein Knopf
-- „Verkauf samt Rechnung stornieren“, nur für eine eigene Rechnung mit genau einem Lieferschein, abgelehnt, solange
-- zum Lieferschein eine ausgestellte Transportbescheinigung gilt; alles in einer Transaktion.
--
-- s112_verkauf_samt_rechnung_stornieren(p_tenant_id, p_verkaufsposten_id, p_grund) → jsonb
--   { rechnungsnummer, lieferscheinnummer, flaschen, liter, traubenverkaeufe }
--   1. Zugriff, Abo-Sperre, Schreibmodul Warenwirtschaft, Grund ≥ 10 Zeichen
--   2. Lieferschein (gesperrt) nicht storniert; eigene Rechnung (kein Spiegel), nicht storniert, genau ein Lieferschein;
--      keine gültige ausgestellte Transportbescheinigung; Tank-Positionen nur mit Kellerbuch oder Rieden
--   3. s112_rechnung_stornieren (prüft Zahlungen, BMD, Periodensperre; Momentaufnahme der Positionen; Lieferschein offen)
--   4. Bestand zurück: Flaschen über s112_fuellung_verkauf_buchen (Zeile verkauf_storno), offener Wein auf die Charge
--      (wie chargeBestandAendern: abgeschlossene/inaktive Charge wird wieder aktiv, Status „ausbau“)
--   5. Lieferschein storniert (Zeitpunkt, Benutzer setzt a_verkauf_storno_schutz), Sonstige Produkte zurück
--      (s112_artikel_verkauf_stornieren), Traubenverkäufe storniert
--   Jeder Fehler rollt alles zurück. Erstattung entfällt: s112_rechnung_stornieren verlangt, dass keine gültige Zahlung
--   besteht. Den CRM-Betreff setzt die App danach (nicht kritisch).

CREATE OR REPLACE FUNCTION public.s112_verkauf_samt_rechnung_stornieren(p_tenant_id uuid, p_verkaufsposten_id uuid, p_grund text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_heute   date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_v       public.verkaufsposten%ROWTYPE;
  v_r       public.rechnungen%ROWTYPE;
  v_anzahl  integer;
  v_pos     record;
  v_w       record;
  v_neu     numeric;
  v_flaschen integer := 0;
  v_liter   numeric := 0;
  v_tv      integer := 0;
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

  -- 3. Rechnung (Zahlungen, BMD und Periodensperre prüft die RPC bzw. ihr Trigger)
  PERFORM public.s112_rechnung_stornieren(p_tenant_id, v_r.id, v_grund);

  -- 4a. Flaschen je Füllung (gerundet wie bei der Abbuchung)
  FOR v_pos IN
    SELECT p.fuellung_id, sum(round(coalesce(p.menge, 0)))::integer AS stueck
      FROM public.verkauf_positionen p
     WHERE p.verkaufsposten_id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id AND p.typ = 'flasche' AND p.fuellung_id IS NOT NULL
     GROUP BY p.fuellung_id ORDER BY p.fuellung_id
  LOOP
    CONTINUE WHEN v_pos.stueck = 0;
    PERFORM public.s112_fuellung_verkauf_buchen(p_tenant_id, v_pos.fuellung_id, p_verkaufsposten_id, v_pos.stueck, v_heute, v_grund);
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
                            'flaschen', v_flaschen, 'liter', v_liter, 'traubenverkaeufe', v_tv);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.s112_verkauf_samt_rechnung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_verkauf_samt_rechnung_stornieren(uuid, uuid, text) TO authenticated;
