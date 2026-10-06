-- KAN-41 Paket 3d/3e (06.10.2026): Etikettierung (unetikettiert → etikettiert) und Aufwertungssperre der Charge.
-- Entscheidung Jörgen (06.10.2026): Umsetzung nach bestem Wissen ohne BKI-Abnahme.
--
-- 3e Aufwertungssperre (BKI R8 „händisch downgraden … aber nicht upgraden“):
--  1. s112_qualitaet_rang: Rang der Qualitätsstufe wie src/lib/wein/qualitaetsrang.ts (wein 0 … trockenbeerenauslese 8;
--     Zusätze/DAC/Sekt = Qualitätswein; perlwein 0; sonstiges ohne Rang wie beim Mischen in der App).
--  2. Trigger a_aufwertung auf weinausbau: hat die Charge Folgebuchungen (s112_charge_hat_folgebuchung), lehnt die
--     Datenbank eine höhere oder entfernte Qualitätsstufe ab (42501, HINT aufwertung). Erlaubt bleiben: Abstufungen,
--     Änderungen ohne Folgebuchung (Tippfehler an einer frischen Charge), die Rücknahme der Stufe beim Storno eines
--     Verschnitts bzw. Umzugs (Wert = ziel_qualitaet_vorher bzw. qualitaet_vorher der noch aktiven Buchung), die
--     Korrektur durch die Betriebsleitung (s112_freeze_korrektur) und die Wartung (s112.loeschen_erlaubt).
--     Zusatzbezeichnung und Herkunft prüft weiterhin die App (Abstufen-Regeln); das Umstufungspaar AB_ABW/ZU_ABW im
--     Journal bleibt unverändert.
--
-- 3d Etikettierung (BKI-Blatt „Lagerstand zum Zeitraum“: etikettiert / unetikettiert):
--  3. fuellungen.anzahl_unetikettiert (bei der Füllung unetikettiert abgefüllt) und bestand_unetikettiert (davon noch
--     ohne Etikett). Unetikettierte Flaschen dürfen weder verkauft noch ausgebucht werden: der Flaschenbestand bleibt
--     ≥ dem unetikettierten Bestand (Trigger a_etikett_bestand, 23514, HINT etikettierung).
--  4. fuellung_etikettierungen: datierter Vorgang „Etikettieren“ mit Storno – nur über die RPCs
--     s112_fuellung_etikettieren / s112_etikettierung_stornieren. BSM-neutral (kein Journal).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Rang der Qualitätsstufe ────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_qualitaet_rang(p_stufe text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_stufe
    WHEN 'wein' THEN 0 WHEN 'perlwein' THEN 0
    WHEN 'landwein' THEN 1
    WHEN 'qualitaetswein' THEN 2 WHEN 'dac' THEN 2 WHEN 'reserve' THEN 2 WHEN 'erste_lage' THEN 2 WHEN 'grosses_gewachs' THEN 2
    WHEN 'sekt' THEN 2
    WHEN 'kabinett' THEN 3 WHEN 'spaetlese' THEN 4 WHEN 'auslese' THEN 5
    WHEN 'beerenauslese' THEN 6 WHEN 'eiswein' THEN 6 WHEN 'strohwein' THEN 6
    WHEN 'ausbruch' THEN 7 WHEN 'trockenbeerenauslese' THEN 8 WHEN 'tba' THEN 8
  END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_qualitaet_rang(text) FROM PUBLIC, anon;
COMMENT ON FUNCTION public.s112_qualitaet_rang(text) IS 'KAN-41 3e: Rang der Qualitätsstufe wie lib/wein/qualitaetsrang.ts (NULL = ohne Stufe)';

-- 2. Aufwertungssperre ──────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_aufwertung_sperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt integer := public.s112_qualitaet_rang(OLD.qualitaetsstufe);
  v_neu integer := public.s112_qualitaet_rang(NEW.qualitaetsstufe);
BEGIN
  -- keine bisherige Stufe, gleiche oder niedrigere Stufe: frei
  IF v_alt IS NULL OR (v_neu IS NOT NULL AND v_neu <= v_alt) THEN
    RETURN NEW;
  END IF;
  -- Korrektur durch die Betriebsleitung (s112_freeze_korrektur) bzw. Wartung
  IF current_setting('s112.freeze_frei', true) = 'weinausbau'
     OR current_setting('s112.loeschen_erlaubt', true) = OLD.tenant_id::text THEN
    RETURN NEW;
  END IF;
  -- Rücknahme beim Storno eines Verschnitts bzw. Umzugs: zurück auf den Stand vor der noch aktiven Buchung
  IF EXISTS (SELECT 1 FROM public.verschneidungen v
              WHERE v.ziel_weinausbau_id = NEW.id AND v.storniert_am IS NULL
                AND v.ziel_qualitaet_vorher IS NOT DISTINCT FROM NEW.qualitaetsstufe)
     OR EXISTS (SELECT 1 FROM public.keller_umzuege u
                 WHERE u.nach_weinausbau_id = NEW.id AND u.storniert_am IS NULL
                   AND u.qualitaet_vorher IS NOT DISTINCT FROM NEW.qualitaetsstufe) THEN
    RETURN NEW;
  END IF;
  -- frische Charge ohne Folgebuchung: Tippfehler dürfen korrigiert werden
  IF NOT public.s112_charge_hat_folgebuchung(NEW.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Aufwertung nicht zulässig: Die Qualitätsstufe der Charge „%“ kann nach Folgebuchungen nur gleich bleiben oder niedriger werden (% → %). Korrektur nur durch die Betriebsleitung.',
    OLD.name, coalesce(OLD.qualitaetsstufe, '–'), coalesce(NEW.qualitaetsstufe, 'ohne Stufe')
    USING ERRCODE = '42501', HINT = 'aufwertung';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_aufwertung_sperre() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_aufwertung BEFORE UPDATE OF qualitaetsstufe ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_aufwertung_sperre();

-- 3. Unetikettierter Bestand an der Füllung ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellungen
  ADD COLUMN anzahl_unetikettiert integer NOT NULL DEFAULT 0,
  ADD COLUMN bestand_unetikettiert integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT fuellungen_unetikettiert_chk CHECK (anzahl_unetikettiert >= 0 AND anzahl_unetikettiert <= anzahl_flaschen
                                                    AND bestand_unetikettiert >= 0 AND bestand_unetikettiert <= anzahl_unetikettiert);
COMMENT ON COLUMN public.fuellungen.anzahl_unetikettiert IS 'KAN-41 3d: bei der Füllung unetikettiert abgefüllte Flaschen';
COMMENT ON COLUMN public.fuellungen.bestand_unetikettiert IS 'KAN-41 3d: davon noch ohne Etikett (sinkt mit fuellung_etikettierungen)';

CREATE FUNCTION public.s112_etikett_bestand()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.bestand_unetikettiert := NEW.anzahl_unetikettiert;   -- beim Anlegen: alles Unetikettierte ist noch ohne Etikett
  END IF;
  IF NEW.storniert_am IS NULL AND NEW.bestand_unetikettiert > NEW.bestand_flaschen THEN
    RAISE EXCEPTION 'Von „%“ sind nur % Flaschen etikettiert – unetikettierte Flaschen dürfen nicht verkauft oder ausgebucht werden. Bitte zuerst etikettieren (Füllung › Etikettieren).',
      NEW.name, greatest(NEW.bestand_flaschen - OLD.bestand_unetikettiert, 0)
      USING ERRCODE = '23514', HINT = 'etikettierung';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_etikett_bestand() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_etikett_bestand BEFORE INSERT OR UPDATE OF bestand_flaschen, bestand_unetikettiert ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_etikett_bestand();

-- 4. Vorgang „Etikettieren“ ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.fuellung_etikettierungen (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fuellung_id        uuid NOT NULL REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  datum              date NOT NULL,
  menge_stk          integer NOT NULL CHECK (menge_stk > 0),
  notizen            text,
  erstellt_von       uuid,
  erstellt_von_name  text,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  storniert_am       timestamptz,
  storniert_von      uuid,
  storniert_von_name text,
  storno_grund       text
);
CREATE INDEX fuellung_etikettierungen_fuellung_idx ON public.fuellung_etikettierungen (fuellung_id, datum);
CREATE INDEX fuellung_etikettierungen_tenant_idx ON public.fuellung_etikettierungen (tenant_id, datum);
COMMENT ON TABLE public.fuellung_etikettierungen IS
  'KAN-41 3d: Etikettieren unetikettierter Flaschen einer Füllung (Datum, Stück, Storno) – nur über s112_fuellung_etikettieren/s112_etikettierung_stornieren';

ALTER TABLE public.fuellung_etikettierungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.fuellung_etikettierungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fuellung_etikettierungen FROM anon;
CREATE POLICY etikettierungen_select ON public.fuellung_etikettierungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.fuellung_etikettierungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.fuellung_etikettierungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.fuellung_etikettierungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.fuellung_etikettierungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.fuellung_etikettierungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.fuellung_etikettierungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');

CREATE FUNCTION public.s112_fuellung_etikettieren(p_tenant_id uuid, p_fuellung_id uuid, p_datum date, p_menge_stk integer,
  p_notizen text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_f     public.fuellungen%ROWTYPE;
  v_datum date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_id    uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Kellerbuch bzw. Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF p_menge_stk IS NULL OR p_menge_stk <= 0 THEN
    RAISE EXCEPTION 'Bitte die Anzahl der etikettierten Flaschen angeben (größer als 0).' USING ERRCODE = '22023';
  END IF;
  IF v_datum > (now() AT TIME ZONE 'Europe/Vienna')::date THEN
    RAISE EXCEPTION 'Das Datum der Etikettierung liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_f FROM public.fuellungen f WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_f.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Füllung ist storniert.' USING ERRCODE = '22023';
  END IF;
  IF v_f.datum IS NOT NULL AND v_datum < v_f.datum THEN
    RAISE EXCEPTION 'Etikettiert werden kann frühestens am Tag der Füllung (%).', to_char(v_f.datum, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF p_menge_stk > v_f.bestand_unetikettiert THEN
    RAISE EXCEPTION 'Von „%“ sind nur noch % Flaschen ohne Etikett.', v_f.name, v_f.bestand_unetikettiert USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fuellung_etikettierungen (tenant_id, fuellung_id, datum, menge_stk, notizen, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, p_fuellung_id, v_datum, p_menge_stk, NULLIF(btrim(coalesce(p_notizen, '')), ''), auth.uid(),
          public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen SET bestand_unetikettiert = bestand_unetikettiert - p_menge_stk WHERE id = p_fuellung_id;
  PERFORM set_config('s112.freeze_frei', '', true);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_etikettieren(uuid, uuid, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_fuellung_etikettieren(uuid, uuid, date, integer, text) TO authenticated;
COMMENT ON FUNCTION public.s112_fuellung_etikettieren(uuid, uuid, date, integer, text) IS
  'KAN-41 3d: unetikettierte Flaschen einer Füllung etikettieren (Datum, Stück)';

CREATE FUNCTION public.s112_etikettierung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_e     public.fuellung_etikettierungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Kellerbuch bzw. Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Stornieren angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_e FROM public.fuellung_etikettierungen e WHERE e.id = p_id AND e.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etikettierung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_e.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Etikettierung ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fuellung_etikettierungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = v_grund
   WHERE id = p_id;
  -- die Flaschen sind wieder ohne Etikett; schon verkaufte bzw. ausgebuchte lehnt a_etikett_bestand ab
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen SET bestand_unetikettiert = bestand_unetikettiert + v_e.menge_stk WHERE id = v_e.fuellung_id;
  PERFORM set_config('s112.freeze_frei', '', true);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_etikettierung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_etikettierung_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_etikettierung_stornieren(uuid, uuid, text) IS
  'KAN-41 3d: Etikettierung stornieren (Flaschen wieder ohne Etikett)';
