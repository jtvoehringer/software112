-- KAN-103 (08.10.2026): Verkauf als Lieferschein, Rechnung sofort oder später; getrennter Storno.
-- Entscheidungen Jörgen (06.10.2026): Preise erst bei der Rechnung; Stornorechnung ohne eigene Nummer.
--  1. verkaufsposten.rechnung_spaeter: beim Anlegen „Rechnung später“ – dann keine Rechnungsnummer und keine Rechnung
--     (Trigger a_rechnungsnummer/b_rechnung_anlegen); Standard bleibt „sofort“ (Ab-Hof-Verkauf, SumUp in einem Schritt).
--  2. rechnungen.spiegel: nur Rechnungen aus dem Übergang 1:1 (im Insert des Lieferscheins bzw. Altbelege) werden vom
--     Lieferschein gespiegelt; Rechnungen aus s112_rechnung_erstellen führen ihre Angaben selbst.
--  3. s112_rechnung_erstellen(tenant, lieferscheine[], datum, preise, notizen): Rechnung aus nicht berechneten Lieferscheinen
--     desselben Empfängers (Nummer aus dem Nummernkreis, Leistungszeitraum = Lieferdaten, Preise je Position anpassbar);
--     bereits erfasste Zahlungen wandern an die Rechnung.
--  4. s112_rechnung_stornieren(tenant, rechnung, grund): Rechnung storniert (Nummer bleibt), Lieferscheine wieder „nicht
--     berechnet“, Bestand bleibt; nur ohne gültige Zahlungen und vor der BMD-Übergabe.
--  5. Lieferschein stornieren (Bestand zurück) nur, solange er nicht berechnet ist – außer im Übergang 1:1 (Spiegel:
--     storniert wie bisher Lieferschein und Rechnung gemeinsam).
--  6. Eindeutige Rechnungsnummer nur noch an rechnungen (Index am Lieferschein entfällt, Sammelrechnung).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 70, dann Produktion.

-- 1./2. Kennzeichen ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verkaufsposten ADD COLUMN rechnung_spaeter boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.verkaufsposten.rechnung_spaeter IS 'KAN-103: beim Anlegen „Rechnung später“ – Lieferschein ohne Rechnung';
ALTER TABLE public.rechnungen ADD COLUMN spiegel boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.rechnungen.spiegel IS 'KAN-103: Rechnung aus dem Übergang 1:1 (vom Lieferschein gespiegelt); false = über s112_rechnung_erstellen';
UPDATE public.rechnungen SET spiegel = true;   -- alle bisherigen Rechnungen entstanden 1:1

-- Eindeutige Rechnungsnummer: seit KAN-102 an rechnungen (rechnungen_nummer_eindeutig). Am Lieferschein ist sie nur noch
-- Spiegel – eine Sammelrechnung (KAN-104) trägt dieselbe Nummer an mehreren Lieferscheinen.
DROP INDEX public.verkaufsposten_rechnungsnummer_eindeutig;

-- Rechnungsnummer: bei „Rechnung später“ keine Nummer; Änderung nur durch die Rechnungs-RPCs (s112.rechnung_rpc)
CREATE OR REPLACE FUNCTION public.s112_rechnungsnummer_vergeben()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- API-Rolle aus dem JWT (current_user ist hier der Eigentümer der SECURITY-DEFINER-Funktion); SQL-Editor, Wartung
  -- und Service-Role haben keine bzw. eine andere Rolle
  v_api boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon')
                   AND coalesce(current_setting('s112.rechnung_rpc', true), '') <> 'an';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.rechnungsnummer IS NOT NULL AND v_api THEN
      RAISE EXCEPTION 'Die Rechnungsnummer vergibt das System (lückenloser Nummernkreis) – bitte ohne Nummer speichern.'
        USING ERRCODE = '42501', HINT = 'rechnungsnummer';
    END IF;
    IF NEW.rechnungsnummer IS NULL AND NOT coalesce(NEW.rechnung_spaeter, false) THEN   -- KAN-103: „Rechnung später“
      NEW.rechnungsnummer := public.s112_rechnungsnummer_ziehen(NEW.tenant_id);
    END IF;
  ELSIF NEW.rechnungsnummer IS DISTINCT FROM OLD.rechnungsnummer AND v_api THEN
    RAISE EXCEPTION 'Die Rechnungsnummer eines Belegs ist unveränderlich (lückenloser Nummernkreis).'
      USING ERRCODE = '42501', HINT = 'rechnungsnummer';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.s112_rechnung_id_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.rechnung_id IS DISTINCT FROM OLD.rechnung_id AND coalesce(auth.role(), '') IN ('authenticated', 'anon')
     AND coalesce(current_setting('s112.rechnung_rpc', true), '') <> 'an' THEN
    RAISE EXCEPTION 'Die Rechnung eines Lieferscheins setzt das System.' USING ERRCODE = '42501', HINT = 'rechnung_id';
  END IF;
  RETURN NEW;
END
$function$;

-- Rechnung im Insert nur im Übergang 1:1 (mit Nummer), als Spiegel-Rechnung
CREATE OR REPLACE FUNCTION public.s112_rechnung_aus_lieferschein()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_api boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  IF NEW.rechnung_id IS NOT NULL THEN
    IF v_api THEN
      RAISE EXCEPTION 'Die Rechnung eines Lieferscheins setzt das System.' USING ERRCODE = '42501', HINT = 'rechnung_id';
    END IF;
    RETURN NEW;   -- Wartung/Import: Rechnung schon vorhanden
  END IF;
  IF NEW.rechnungsnummer IS NULL THEN
    RETURN NEW;   -- „Rechnung später“ bzw. kein Nummernkreis – keine Rechnung
  END IF;
  INSERT INTO public.rechnungen (tenant_id, rechnungsnummer, datum, leistung_von, leistung_bis, kontakt_id, firma_id, zh_kontakt_id,
                                 partner_daten, skonto_pct, skonto_tage, skonto_aktiv, aktiv, storniert, storniert_am, storniert_von,
                                 storniert_von_name, storno_grund, bezahlt, bezahlt_am, rechnung_versendet_am, rechnung_versendet_an,
                                 bmd_export_id, erstellt_am, spiegel)
  VALUES (NEW.tenant_id, NEW.rechnungsnummer, coalesce(NEW.datum, (now() AT TIME ZONE 'Europe/Vienna')::date), NEW.datum, NEW.datum,
          NEW.kontakt_id, NEW.firma_id, NEW.zh_kontakt_id, NEW.partner_daten, NEW.skonto_pct, NEW.skonto_tage, NEW.skonto_aktiv,
          coalesce(NEW.aktiv, true), coalesce(NEW.storniert, false), NEW.storniert_am, NEW.storniert_von, NEW.storniert_von_name,
          NEW.storno_grund, coalesce(NEW.bezahlt, false), NEW.bezahlt_am, NEW.rechnung_versendet_am, NEW.rechnung_versendet_an,
          NEW.bmd_export_id, coalesce(NEW.erstellt_am, now()), true)
  RETURNING id INTO NEW.rechnung_id;
  RETURN NEW;
END
$function$;

-- Spiegel nur für Spiegel-Rechnungen (Übergang 1:1)
CREATE OR REPLACE FUNCTION public.s112_rechnung_spiegeln()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.rechnung_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.rechnungen r WHERE r.id = NEW.rechnung_id AND r.spiegel)
     OR EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = NEW.rechnung_id AND v.id <> NEW.id) THEN
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

-- 5. Lieferschein stornieren nur, solange nicht (über eine eigene Rechnung) berechnet ─────────────────────────────────
CREATE FUNCTION public.s112_lieferschein_storno_sperre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_nr text;
BEGIN
  IF NEW.storniert AND NOT coalesce(OLD.storniert, false) AND NEW.rechnung_id IS NOT NULL THEN
    SELECT r.rechnungsnummer INTO v_nr FROM public.rechnungen r
     WHERE r.id = NEW.rechnung_id AND NOT r.spiegel AND NOT r.storniert;
    IF FOUND THEN
      RAISE EXCEPTION 'Der Lieferschein % ist mit der Rechnung % berechnet – bitte zuerst die Rechnung stornieren.', coalesce(NEW.lieferscheinnummer, ''), v_nr
        USING ERRCODE = '42501', HINT = 'lieferschein_berechnet';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lieferschein_storno_sperre() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_lieferschein_storno_sperre BEFORE UPDATE OF storniert ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_lieferschein_storno_sperre();

-- 3. Rechnung erstellen ───────────────────────────────────────────────────────────────────────────────────────────
-- p_preise: [{ "position_id": uuid, "preis_brutto": numeric, "rabatt_pct": numeric? }] – optional, nur Positionen dieser Lieferscheine
CREATE FUNCTION public.s112_rechnung_erstellen(p_tenant_id uuid, p_lieferscheine uuid[], p_datum date, p_preise jsonb, p_notizen text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_datum  date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_anz    integer;
  v_erster public.verkaufsposten%ROWTYPE;
  v_nr     text;
  v_id     uuid;
  v_von    date;
  v_bis    date;
  e        jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF p_lieferscheine IS NULL OR coalesce(array_length(p_lieferscheine, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens einen Lieferschein wählen.' USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Rechnungsdatum liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;

  -- Lieferscheine sperren und prüfen: eigener Betrieb, nicht storniert, nicht berechnet, ein Empfänger
  PERFORM 1 FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine) ORDER BY v.id FOR UPDATE;
  SELECT count(*) INTO v_anz FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine) AND v.tenant_id = p_tenant_id;
  IF v_anz <> (SELECT count(DISTINCT x) FROM unnest(p_lieferscheine) x) THEN
    RAISE EXCEPTION 'Lieferschein nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine) AND (v.storniert OR NOT coalesce(v.aktiv, true))) THEN
    RAISE EXCEPTION 'Ein stornierter Lieferschein lässt sich nicht berechnen.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine) AND v.rechnung_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Ein Lieferschein ist bereits berechnet.' USING ERRCODE = '22023', HINT = 'lieferschein_berechnet';
  END IF;
  IF (SELECT count(DISTINCT (v.kontakt_id, v.firma_id)) FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine)) > 1 THEN
    RAISE EXCEPTION 'Eine Rechnung hat genau einen Empfänger – die Lieferscheine gehören zu verschiedenen Kunden.' USING ERRCODE = '22023';
  END IF;
  SELECT min(v.datum), max(v.datum) INTO v_von, v_bis FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine);
  IF v_datum < v_von THEN
    RAISE EXCEPTION 'Das Rechnungsdatum liegt vor dem Lieferdatum (%).', to_char(v_von, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_erster FROM public.verkaufsposten v WHERE v.id = ANY (p_lieferscheine) ORDER BY v.datum, v.lieferscheinnummer LIMIT 1;

  -- Preise (Entscheidung: Preise erst bei der Rechnung)
  FOR e IN SELECT x FROM jsonb_array_elements(coalesce(p_preise, '[]'::jsonb)) x LOOP
    IF NOT EXISTS (SELECT 1 FROM public.verkauf_positionen p WHERE p.id = (e ->> 'position_id')::uuid AND p.verkaufsposten_id = ANY (p_lieferscheine)) THEN
      RAISE EXCEPTION 'Position gehört nicht zu den gewählten Lieferscheinen.' USING ERRCODE = '22023';
    END IF;
    IF (e ->> 'preis_brutto') IS NULL OR (e ->> 'preis_brutto')::numeric < 0
       OR coalesce((e ->> 'rabatt_pct')::numeric, 0) NOT BETWEEN 0 AND 100 THEN
      RAISE EXCEPTION 'Ungültiger Preis oder Rabatt.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.verkauf_positionen
       SET preis_brutto = round((e ->> 'preis_brutto')::numeric, 4),
           rabatt_pct = CASE WHEN e ? 'rabatt_pct' THEN coalesce((e ->> 'rabatt_pct')::numeric, 0) ELSE rabatt_pct END
     WHERE id = (e ->> 'position_id')::uuid;
  END LOOP;

  v_nr := public.s112_rechnungsnummer_ziehen(p_tenant_id);
  IF v_nr IS NULL THEN
    RAISE EXCEPTION 'Kein Rechnungs-Nummernkreis für diesen Betrieb.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.rechnungen (tenant_id, rechnungsnummer, datum, leistung_von, leistung_bis, kontakt_id, firma_id, zh_kontakt_id,
                                 partner_daten, skonto_pct, skonto_tage, skonto_aktiv, notizen, spiegel)
  VALUES (p_tenant_id, v_nr, v_datum, v_von, v_bis, v_erster.kontakt_id, v_erster.firma_id, v_erster.zh_kontakt_id,
          v_erster.partner_daten, v_erster.skonto_pct, v_erster.skonto_tage, v_erster.skonto_aktiv,
          NULLIF(btrim(coalesce(p_notizen, '')), ''), false)
  RETURNING id INTO v_id;

  PERFORM set_config('s112.rechnung_rpc', 'an', true);
  UPDATE public.verkaufsposten SET rechnung_id = v_id, rechnungsnummer = v_nr WHERE id = ANY (p_lieferscheine);
  -- bereits erfasste (gültige) Zahlungen an die Rechnung; trg_zahlungen_sync_bezahlt rechnet bezahlt je Rechnung neu.
  -- Stornierte Zahlungen bleiben unverändert (a_ea_storno_schutz).
  UPDATE public.zahlungen SET rechnung_id = v_id
   WHERE verkaufsposten_id = ANY (p_lieferscheine) AND tenant_id = p_tenant_id AND storniert_am IS NULL;
  PERFORM set_config('s112.rechnung_rpc', '', true);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_erstellen(uuid, uuid[], date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_rechnung_erstellen(uuid, uuid[], date, jsonb, text) TO authenticated;
COMMENT ON FUNCTION public.s112_rechnung_erstellen(uuid, uuid[], date, jsonb, text) IS
  'KAN-103/104: Rechnung aus nicht berechneten Lieferscheinen eines Empfängers – Nummer aus dem Nummernkreis, Preise je Position, Zahlungen wandern mit';

-- 4. Rechnung stornieren ──────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_rechnung_stornieren(p_tenant_id uuid, p_rechnung_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_r     public.rechnungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
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
  IF v_r.bmd_export_id IS NOT NULL THEN
    RAISE EXCEPTION 'Die Rechnung % ist bereits an BMD übergeben – Storno bitte über die Buchhaltung.', v_r.rechnungsnummer
      USING ERRCODE = '22023', HINT = 'rechnung_bmd';
  END IF;

  UPDATE public.rechnungen
     SET storniert = true, storniert_am = now(), storniert_von = auth.uid(),
         storniert_von_name = public.s112_storno_benutzername(auth.uid()), storno_grund = v_grund, spiegel = false
   WHERE id = p_rechnung_id;
  -- Lieferscheine wieder „nicht berechnet“ (Bestand bleibt); stornierte Zahlungen bleiben an der Rechnung
  PERFORM set_config('s112.rechnung_rpc', 'an', true);
  UPDATE public.verkaufsposten SET rechnung_id = NULL, rechnungsnummer = NULL, bezahlt = false, bezahlt_am = NULL
   WHERE rechnung_id = p_rechnung_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.rechnung_rpc', '', true);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_rechnung_stornieren(uuid, uuid, text) IS
  'KAN-103: Rechnung stornieren – Nummer bleibt, Lieferscheine wieder nicht berechnet, Bestand bleibt; nur ohne Zahlungen und vor der BMD-Übergabe';
