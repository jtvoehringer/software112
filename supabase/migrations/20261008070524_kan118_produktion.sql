-- KAN-118 (08.10.2026): Produktion – aus einer oder mehreren Chargen und Zutaten entsteht eine NEUE Charge mit eigenem
-- Erzeugnis: Perlweinspritzer/Weinmischgetränk (weinhaltiges Getränk, mindestens 50 % Wein), Perlwein, Schaumwein/Sekt,
-- PetNat. Entscheidungen Jörgen 08.10.2026: Zugang der Zielcharge = neue Buchungsart ZU_PROD, Abgang der Quellen = AB_VERAR,
-- PetNat = Erzeugnis PETNAT; Lohnversektung (LNSKT) folgt als eigener Schritt.
--  1. kat_buchungsart += ZU_PROD (BSM-relevant).
--  2. produktionen (Kopf) und produktion_eingaenge (Wein je Quelle, Wasser, Saft, Aroma, CO2, Zucker, Hefe, Sonstiges) –
--     lesbar für Mitglieder, geschrieben nur von den RPCs; stornieren statt löschen (Löschsperre).
--  3. Journal: je Quelle AB_VERAR (Quelle, −Liter) und ZU_PROD (Ziel, +Liter, Gegencharge = Quelle); Zusatzvolumen
--     (Wasser, Saft, Aroma) als eigene ZU_PROD-Zeile ohne Gegencharge. Ein Beleg je Produktion; Storno bucht gegen.
--  4. s112_produktion_buchen(tenant, kopf, eingaenge) / s112_produktion_stornieren(tenant, id, grund).
--     Zutaten mit Stoff aus dem Stoffkonto (kellermittel) werden dort als Verwendung gebucht (kellermittel_buchungen.produktion_id).
--  5. Genealogie (charge_herkunft) und Folgebuchungen kennen die Produktion.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 66, dann Produktion.

-- 1. Buchungsart ────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.kat_buchungsart (code, bezeichnung, richtung, einheit, bsm, bsm_code, reihenfolge)
VALUES ('ZU_PROD', 'Zugang durch Produktion', 'zu', 'l', true, NULL, 26);

-- 2. Tabellen ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.produktionen (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  datum              date NOT NULL,
  art                text NOT NULL CHECK (art IN ('spritzer', 'mischgetraenk', 'perlwein', 'schaumwein', 'petnat')),
  erzeugnis          text NOT NULL REFERENCES public.kat_erzeugnis(code),
  ziel_weinausbau_id uuid NOT NULL REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  wein_liter         numeric(10,2) NOT NULL CHECK (wein_liter > 0),
  ziel_menge         numeric(10,2) NOT NULL CHECK (ziel_menge > 0),
  gebucht            boolean NOT NULL DEFAULT false,
  notizen            text,
  erstellt_von       uuid,
  erstellt_von_name  text,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  storniert_am       timestamptz,
  storniert_von      uuid,
  storniert_von_name text,
  storno_grund       text,
  CONSTRAINT produktionen_wein_im_ziel CHECK (wein_liter <= ziel_menge + 0.005)
);
CREATE INDEX produktionen_tenant_idx ON public.produktionen (tenant_id, datum);
CREATE INDEX produktionen_ziel_idx ON public.produktionen (ziel_weinausbau_id);
COMMENT ON TABLE public.produktionen IS
  'KAN-118: Produktion einer neuen Charge (Spritzer, Mischgetränk, Perlwein, Schaumwein, PetNat) – Journal AB_VERAR/ZU_PROD; nur über s112_produktion_buchen/_stornieren';

CREATE TABLE public.produktion_eingaenge (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  produktion_id  uuid NOT NULL REFERENCES public.produktionen(id) ON DELETE CASCADE,
  art            text NOT NULL CHECK (art IN ('wein', 'wasser', 'saft', 'aroma', 'co2', 'zucker', 'hefe', 'sonstiges')),
  weinausbau_id  uuid REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  kellermittel_id uuid REFERENCES public.kellermittel(id) ON DELETE SET NULL,
  bezeichnung    text CHECK (bezeichnung IS NULL OR length(btrim(bezeichnung)) <= 80),
  menge          numeric(12,3) NOT NULL CHECK (menge > 0),
  einheit        text NOT NULL CHECK (einheit IN ('l', 'kg', 'g')),
  volumen_liter  numeric(10,2) NOT NULL DEFAULT 0 CHECK (volumen_liter >= 0),
  CONSTRAINT produktion_eingaenge_wein CHECK ((art = 'wein') = (weinausbau_id IS NOT NULL)),
  CONSTRAINT produktion_eingaenge_wein_liter CHECK (art <> 'wein' OR (einheit = 'l' AND volumen_liter = menge))
);
CREATE INDEX produktion_eingaenge_produktion_idx ON public.produktion_eingaenge (produktion_id);
CREATE INDEX produktion_eingaenge_charge_idx ON public.produktion_eingaenge (weinausbau_id) WHERE weinausbau_id IS NOT NULL;
CREATE INDEX produktion_eingaenge_tenant_idx ON public.produktion_eingaenge (tenant_id);
COMMENT ON TABLE public.produktion_eingaenge IS
  'KAN-118: Eingänge einer Produktion – Wein je Quell-Charge (Liter), Wasser/Saft/Aroma (Volumen), CO2/Zucker/Hefe (optional aus dem Stoffkonto)';

ALTER TABLE public.produktionen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produktion_eingaenge ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.produktionen, public.produktion_eingaenge FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.produktionen, public.produktion_eingaenge FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.produktionen, public.produktion_eingaenge FROM authenticated;
CREATE POLICY produktionen_select ON public.produktionen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY produktion_eingaenge_select ON public.produktion_eingaenge FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.produktionen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY mitgliedschaft_aktiv ON public.produktion_eingaenge AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.produktionen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.produktionen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.produktionen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.produktion_eingaenge AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.produktion_eingaenge AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.produktion_eingaenge AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.produktionen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY zwei_faktor_aal ON public.produktion_eingaenge AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY keine_direktloeschung ON public.produktionen AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY keine_direktloeschung ON public.produktion_eingaenge AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.produktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.produktion_eingaenge
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_ziel_weinausbau_id BEFORE INSERT OR UPDATE OF ziel_weinausbau_id, tenant_id ON public.produktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ziel_weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_produktion_id BEFORE INSERT OR UPDATE OF produktion_id, tenant_id ON public.produktion_eingaenge
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('produktion_id', 'produktionen', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.produktion_eingaenge
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_kellermittel_id BEFORE INSERT OR UPDATE OF kellermittel_id, tenant_id ON public.produktion_eingaenge
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kellermittel_id', 'kellermittel', '', '', '');

-- Stoffkonto: Verwendung aus einer Produktion
ALTER TABLE public.kellermittel_buchungen ADD COLUMN produktion_id uuid REFERENCES public.produktionen(id) ON DELETE SET NULL;
CREATE INDEX kellermittel_buchungen_produktion_idx ON public.kellermittel_buchungen (produktion_id) WHERE produktion_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_produktion_id BEFORE INSERT OR UPDATE OF produktion_id, tenant_id ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('produktion_id', 'produktionen', '', '', '');

-- 3. Journal ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_journal_zeilen_produktion(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT coalesce((p ->> 'gebucht')::boolean, false) THEN '[]'::jsonb ELSE
    coalesce((SELECT jsonb_agg(z ORDER BY o, q) FROM (
      SELECT 1 AS o, e.weinausbau_id::text AS q,
             jsonb_build_object('code', 'AB_VERAR', 'bestand', 'offen', 'weinausbau_id', e.weinausbau_id, 'liter', -e.menge,
                                'gegen_weinausbau_id', p ->> 'ziel_weinausbau_id', 'hinweis', 'Produktion: ' || coalesce(k.bezeichnung, p ->> 'erzeugnis')) AS z
        FROM public.produktion_eingaenge e LEFT JOIN public.kat_erzeugnis k ON k.code = p ->> 'erzeugnis'
       WHERE e.produktion_id = (p ->> 'id')::uuid AND e.art = 'wein'
      UNION ALL
      SELECT 2, e.weinausbau_id::text,
             jsonb_build_object('code', 'ZU_PROD', 'bestand', 'offen', 'weinausbau_id', p ->> 'ziel_weinausbau_id', 'liter', e.menge,
                                'gegen_weinausbau_id', e.weinausbau_id, 'hinweis', 'Wein aus der Quell-Charge')
        FROM public.produktion_eingaenge e
       WHERE e.produktion_id = (p ->> 'id')::uuid AND e.art = 'wein'
      UNION ALL
      SELECT 3, '',
             jsonb_build_object('code', 'ZU_PROD', 'bestand', 'offen', 'weinausbau_id', p ->> 'ziel_weinausbau_id',
                                'liter', (p ->> 'ziel_menge')::numeric - (p ->> 'wein_liter')::numeric,
                                'hinweis', 'Zusatz: ' || (SELECT string_agg(coalesce(e.bezeichnung, e.art) || ' ' ||
                                  replace(to_char(e.volumen_liter, 'FM999999990.00'), '.', ',') || ' L', ', ' ORDER BY e.art)
                                  FROM public.produktion_eingaenge e WHERE e.produktion_id = (p ->> 'id')::uuid AND e.volumen_liter > 0 AND e.art <> 'wein'))
       WHERE (p ->> 'ziel_menge')::numeric - (p ->> 'wein_liter')::numeric > 0.005
    ) s), '[]'::jsonb) END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_produktion(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_journal_trg_produktion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt jsonb;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := jsonb_build_object('wirksam', OLD.storniert_am IS NULL AND OLD.gebucht, 'datum', OLD.datum,
                                'zeilen', public.s112_journal_zeilen_produktion(to_jsonb(OLD)));
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'produktionen', NEW.id, NEW.id, v_alt,
    jsonb_build_object('wirksam', NEW.storniert_am IS NULL AND NEW.gebucht, 'datum', NEW.datum,
                       'zeilen', public.s112_journal_zeilen_produktion(to_jsonb(NEW))),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_produktion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF datum, gebucht, storniert_am ON public.produktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_produktion();

-- 4. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────
-- p_kopf: {datum, art, erzeugnis?, name, behaelter_id, notizen?}
-- p_eingaenge: [{art:'wein', weinausbau_id, menge (L)} | {art, menge, einheit 'l'|'kg'|'g', kellermittel_id?, bezeichnung?}]
CREATE FUNCTION public.s112_produktion_buchen(p_tenant_id uuid, p_kopf jsonb, p_eingaenge jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_heute     date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_datum     date := coalesce(NULLIF(p_kopf ->> 'datum', '')::date, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_art       text := p_kopf ->> 'art';
  v_erz       text := NULLIF(p_kopf ->> 'erzeugnis', '');
  v_name      text := NULLIF(btrim(coalesce(p_kopf ->> 'name', '')), '');
  v_beh       uuid := NULLIF(p_kopf ->> 'behaelter_id', '')::uuid;
  v_bis       date;
  v_letzte    date;
  e           jsonb;
  v_w         public.weinausbau%ROWTYPE;
  v_km        public.kellermittel%ROWTYPE;
  v_menge     numeric;
  v_rest      numeric;
  v_wein      numeric := 0;
  v_zusatz    numeric := 0;
  v_quellen   uuid[] := '{}';
  v_mengen    numeric[] := '{}';
  v_weinarten text[] := '{}';
  v_ziel      uuid;
  v_id        uuid;
  v_vol       numeric;
  v_einheit   text;
  v_km_menge  numeric;
  v_wein_art  text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF v_art IS NULL OR v_art NOT IN ('spritzer', 'mischgetraenk', 'perlwein', 'schaumwein', 'petnat') THEN
    RAISE EXCEPTION 'Unbekannte Art der Produktion „%“.', coalesce(v_art, '–') USING ERRCODE = '22023';
  END IF;
  -- Erzeugnis je Art (Schaumwein auch als Sekt g.U.)
  v_erz := coalesce(v_erz, CASE v_art WHEN 'spritzer' THEN 'WEINHALT' WHEN 'mischgetraenk' THEN 'WEINHALT'
                                      WHEN 'perlwein' THEN 'PERLWEIN' WHEN 'schaumwein' THEN 'SCHAUMW' ELSE 'PETNAT' END);
  IF NOT ((v_art IN ('spritzer', 'mischgetraenk') AND v_erz = 'WEINHALT') OR (v_art = 'perlwein' AND v_erz = 'PERLWEIN')
          OR (v_art = 'schaumwein' AND v_erz IN ('SCHAUMW', 'SEKTGU')) OR (v_art = 'petnat' AND v_erz = 'PETNAT')) THEN
    RAISE EXCEPTION 'Das Erzeugnis „%“ passt nicht zur Produktion „%“.', v_erz, v_art USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum der Produktion liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Produktion kann frühestens am % gebucht werden.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(v_bis + 1, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;
  IF v_name IS NULL OR v_beh IS NULL THEN
    RAISE EXCEPTION 'Bitte Name und Gebinde der neuen Charge angeben.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.behaelter_nutzbar(v_beh, p_tenant_id) THEN
    RAISE EXCEPTION 'Das Gebinde ist nicht nutzbar (fremd, inaktiv oder belegt).' USING ERRCODE = '42501';
  END IF;
  IF p_eingaenge IS NULL OR jsonb_typeof(p_eingaenge) <> 'array' OR jsonb_array_length(p_eingaenge) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Quell-Charge angeben.' USING ERRCODE = '22023';
  END IF;

  -- Wein je Quelle (gesperrt, aktiv, Bestand, nicht vor der letzten Bewegung)
  FOR e IN SELECT x FROM jsonb_array_elements(p_eingaenge) x WHERE x ->> 'art' = 'wein' ORDER BY x ->> 'weinausbau_id' LOOP
    v_menge := round((e ->> 'menge')::numeric, 2);
    IF v_menge IS NULL OR v_menge < 0.01 THEN
      RAISE EXCEPTION 'Die Weinmenge je Quelle muss mindestens 0,01 L sein.' USING ERRCODE = '22023';
    END IF;
    IF (e ->> 'weinausbau_id')::uuid = ANY (v_quellen) THEN
      RAISE EXCEPTION 'Eine Quell-Charge ist doppelt angegeben.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = (e ->> 'weinausbau_id')::uuid AND w.tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quell-Charge nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    IF v_w.storniert_am IS NOT NULL OR NOT coalesce(v_w.aktiv, true) THEN
      RAISE EXCEPTION 'Die Quell-Charge „%“ ist storniert bzw. nicht mehr aktiv.', v_w.name USING ERRCODE = '22023';
    END IF;
    IF v_menge > coalesce(v_w.menge_liter, 0) + 0.005 THEN
      RAISE EXCEPTION 'Aus „%“ sollen % L verwendet werden, im Bestand sind nur % L.', v_w.name,
        replace(to_char(v_menge, 'FM999999990.00'), '.', ','), replace(to_char(coalesce(v_w.menge_liter, 0), 'FM999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;
    SELECT max(k.datum) INTO v_letzte FROM public.kellerbuch_buchungen k
     WHERE k.tenant_id = p_tenant_id AND k.weinausbau_id = v_w.id AND k.storno_von_id IS NULL;
    IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN
      RAISE EXCEPTION 'Die Quell-Charge „%“ hat am % schon eine Bewegung – die Produktion kann frühestens an diesem Tag gebucht werden.',
        v_w.name, to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_w.menge_liter, 0) - v_menge <= 0.01 THEN
      v_menge := coalesce(v_w.menge_liter, 0);   -- Rest ≤ 0,01 L mitnehmen, Quelle wird abgeschlossen
    END IF;
    v_quellen := v_quellen || v_w.id;
    v_mengen := v_mengen || v_menge;
    v_wein := v_wein + v_menge;
    IF coalesce(v_w.weinart, 'unbekannt') <> 'unbekannt' AND NOT (v_w.weinart = ANY (v_weinarten)) THEN
      v_weinarten := v_weinarten || v_w.weinart;
    END IF;
  END LOOP;
  IF array_length(v_quellen, 1) IS NULL THEN
    RAISE EXCEPTION 'Bitte mindestens eine Quell-Charge angeben.' USING ERRCODE = '22023';
  END IF;
  -- Weinart-Sperre: keine Mischung aus Weiß, Rot und Rosé
  IF coalesce(array_length(v_weinarten, 1), 0) > 1 THEN
    RAISE EXCEPTION 'Die Quell-Chargen haben unterschiedliche Weinarten (%) – eine Produktion mischt nur gleiche Weinarten.',
      array_to_string(v_weinarten, ', ') USING ERRCODE = '22023';
  END IF;

  -- Zutaten
  FOR e IN SELECT x FROM jsonb_array_elements(p_eingaenge) x WHERE x ->> 'art' IS DISTINCT FROM 'wein' LOOP
    IF e ->> 'art' IS NULL OR e ->> 'art' NOT IN ('wasser', 'saft', 'aroma', 'co2', 'zucker', 'hefe', 'sonstiges') THEN
      RAISE EXCEPTION 'Unbekannte Zutat „%“.', coalesce(e ->> 'art', '–') USING ERRCODE = '22023';
    END IF;
    v_einheit := coalesce(e ->> 'einheit', 'l');
    IF v_einheit NOT IN ('l', 'kg', 'g') OR coalesce((e ->> 'menge')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Bitte Menge und Einheit (l, kg, g) für „%“ angeben.', e ->> 'art' USING ERRCODE = '22023';
    END IF;
    IF e ->> 'art' IN ('wasser', 'saft', 'aroma') THEN
      IF v_art NOT IN ('spritzer', 'mischgetraenk') THEN
        RAISE EXCEPTION 'Wasser, Saft oder Aroma gibt es nur bei Spritzer und Weinmischgetränk.' USING ERRCODE = '22023';
      END IF;
      IF v_einheit <> 'l' THEN
        RAISE EXCEPTION 'Wasser, Saft und Aroma bitte in Litern angeben.' USING ERRCODE = '22023';
      END IF;
      v_zusatz := v_zusatz + round((e ->> 'menge')::numeric, 2);
    END IF;
    IF e ->> 'art' = 'co2' AND v_art = 'petnat' THEN
      RAISE EXCEPTION 'PetNat entsteht ohne Zusatz von Kohlensäure.' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(e ->> 'kellermittel_id', '') IS NOT NULL THEN
      SELECT * INTO v_km FROM public.kellermittel m WHERE m.id = (e ->> 'kellermittel_id')::uuid AND m.tenant_id = p_tenant_id;
      IF NOT FOUND OR NOT v_km.aktiv THEN
        RAISE EXCEPTION 'Stoff aus dem Stoffkonto nicht gefunden oder nicht aktiv.' USING ERRCODE = 'P0002';
      END IF;
      IF NOT ((v_km.einheit = 'kg' AND v_einheit IN ('kg', 'g')) OR (v_km.einheit = 'l' AND v_einheit = 'l')) THEN
        RAISE EXCEPTION 'Der Stoff „%“ wird in % geführt – bitte die Menge in dieser Einheit angeben.', v_km.name, v_km.einheit
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- mindestens 50 % Wein (§ 33 WeinG) bei Spritzer und Weinmischgetränk
  IF v_art IN ('spritzer', 'mischgetraenk') AND v_wein * 2 < v_wein + v_zusatz - 0.005 THEN
    RAISE EXCEPTION 'Ein weinhaltiges Getränk braucht mindestens 50 %% Wein – hier sind es % %%.',
      replace(to_char(round(100 * v_wein / (v_wein + v_zusatz), 1), 'FM990.0'), '.', ',') USING ERRCODE = '22023', HINT = 'produktion_weinanteil';
  END IF;

  -- neue Zielcharge (Erzeugnis gleich beim Anlegen – keine Umstufung im Journal)
  INSERT INTO public.weinausbau (tenant_id, name, behaelter_id, menge_liter, aktiv, status, erzeugnis, weinart, rebsorte, jahrgang,
                                 herkunft_code, land_iso, qualitaetsstufe, notizen)
  SELECT p_tenant_id, v_name, v_beh, 0, true, 'ausbau', v_erz,
         CASE WHEN count(DISTINCT w.weinart) = 1 THEN min(w.weinart) ELSE 'unbekannt' END,
         CASE WHEN count(DISTINCT w.rebsorte) = 1 AND bool_and(w.rebsorte IS NOT NULL) THEN min(w.rebsorte) END,
         CASE WHEN count(DISTINCT w.jahrgang) = 1 AND bool_and(w.jahrgang IS NOT NULL) THEN min(w.jahrgang) END,
         CASE WHEN count(DISTINCT w.herkunft_code) = 1 AND bool_and(w.herkunft_code IS NOT NULL) THEN min(w.herkunft_code) END,
         CASE WHEN count(DISTINCT w.land_iso) = 1 THEN min(w.land_iso) ELSE 'AT' END,
         CASE WHEN v_erz = 'WEINHALT' THEN NULL
              WHEN count(DISTINCT w.qualitaetsstufe) = 1 AND bool_and(w.qualitaetsstufe IS NOT NULL) THEN min(w.qualitaetsstufe) END,
         NULLIF(btrim(coalesce(p_kopf ->> 'notizen', '')), '')
    FROM public.weinausbau w WHERE w.id = ANY (v_quellen)
  RETURNING id INTO v_ziel;

  INSERT INTO public.produktionen (tenant_id, datum, art, erzeugnis, ziel_weinausbau_id, wein_liter, ziel_menge, notizen,
                                   erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, v_datum, v_art, v_erz, v_ziel, v_wein, v_wein + v_zusatz, NULLIF(btrim(coalesce(p_kopf ->> 'notizen', '')), ''),
          auth.uid(), public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;

  FOR i IN 1 .. array_length(v_quellen, 1) LOOP
    INSERT INTO public.produktion_eingaenge (tenant_id, produktion_id, art, weinausbau_id, menge, einheit, volumen_liter)
    VALUES (p_tenant_id, v_id, 'wein', v_quellen[i], v_mengen[i], 'l', v_mengen[i]);
    SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = v_quellen[i];
    v_rest := round(greatest(coalesce(v_w.menge_liter, 0) - v_mengen[i], 0), 2);
    UPDATE public.weinausbau
       SET menge_liter = v_rest,
           aktiv = CASE WHEN v_rest = 0 THEN false ELSE aktiv END,
           status = CASE WHEN v_rest = 0 THEN 'abgeschlossen' ELSE status END
     WHERE id = v_quellen[i];
  END LOOP;
  FOR e IN SELECT x FROM jsonb_array_elements(p_eingaenge) x WHERE x ->> 'art' IS DISTINCT FROM 'wein' LOOP
    v_einheit := coalesce(e ->> 'einheit', 'l');
    v_vol := CASE WHEN e ->> 'art' IN ('wasser', 'saft', 'aroma') THEN round((e ->> 'menge')::numeric, 2) ELSE 0 END;
    INSERT INTO public.produktion_eingaenge (tenant_id, produktion_id, art, kellermittel_id, bezeichnung, menge, einheit, volumen_liter)
    VALUES (p_tenant_id, v_id, e ->> 'art', NULLIF(e ->> 'kellermittel_id', '')::uuid, NULLIF(btrim(coalesce(e ->> 'bezeichnung', '')), ''),
            round((e ->> 'menge')::numeric, 3), v_einheit, v_vol);
    IF NULLIF(e ->> 'kellermittel_id', '') IS NOT NULL THEN
      v_km_menge := round(CASE WHEN v_einheit = 'g' THEN (e ->> 'menge')::numeric / 1000 ELSE (e ->> 'menge')::numeric END, 3);
      INSERT INTO public.kellermittel_buchungen (tenant_id, kellermittel_id, datum, art, menge, weinausbau_id, behaelter_id, zweck, produktion_id)
      VALUES (p_tenant_id, (e ->> 'kellermittel_id')::uuid, v_datum, 'verwendung', -v_km_menge, v_ziel, v_beh, 'Produktion', v_id);
    END IF;
  END LOOP;

  UPDATE public.weinausbau SET menge_liter = round(v_wein + v_zusatz, 2) WHERE id = v_ziel;
  UPDATE public.produktionen SET gebucht = true WHERE id = v_id;   -- schreibt das Journal (AB_VERAR/ZU_PROD)
  RETURN jsonb_build_object('produktion_id', v_id, 'ziel_weinausbau_id', v_ziel, 'wein_liter', v_wein, 'ziel_menge', v_wein + v_zusatz);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_produktion_buchen(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_produktion_buchen(uuid, jsonb, jsonb) TO authenticated;
COMMENT ON FUNCTION public.s112_produktion_buchen(uuid, jsonb, jsonb) IS
  'KAN-118: Produktion buchen – Quellen AB_VERAR, neue Zielcharge mit Erzeugnis ZU_PROD, Zutaten (optional Stoffkonto); Spritzer/Mischgetränk mindestens 50 % Wein, gleiche Weinart';

-- Storno: nur solange die Zielcharge unverändert ist (volle Menge, keine Folgebuchung)
CREATE FUNCTION public.s112_produktion_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_p     public.produktionen%ROWTYPE;
  v_z     public.weinausbau%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
  v_bis   date;
  r       record;
  v_name  text := public.s112_storno_benutzername(auth.uid());
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Stornieren angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND (now() AT TIME ZONE 'Europe/Vienna')::date <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – Stornieren ist erst danach möglich.',
      to_char(v_bis, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;
  SELECT * INTO v_p FROM public.produktionen p WHERE p.id = p_id AND p.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produktion nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Produktion ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_z FROM public.weinausbau w WHERE w.id = v_p.ziel_weinausbau_id FOR UPDATE;
  IF NOT coalesce(v_z.aktiv, false) OR abs(coalesce(v_z.menge_liter, 0) - v_p.ziel_menge) > 0.005
     OR public.s112_charge_hat_folgebuchung(v_z.id) THEN
    RAISE EXCEPTION 'Die erzeugte Charge „%“ wurde schon weiter verwendet (Menge geändert oder Folgebuchung) – bitte zuerst diese Buchungen stornieren.',
      v_z.name USING ERRCODE = '22023', HINT = 'produktion_folgebuchung';
  END IF;

  UPDATE public.produktionen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = v_name, storno_grund = v_grund
   WHERE id = p_id;   -- Journal bucht gegen
  FOR r IN SELECT e.weinausbau_id, e.menge FROM public.produktion_eingaenge e WHERE e.produktion_id = p_id AND e.art = 'wein'
           ORDER BY e.weinausbau_id LOOP
    UPDATE public.weinausbau
       SET menge_liter = round(coalesce(menge_liter, 0) + r.menge, 2),
           aktiv = true,
           status = CASE WHEN status = 'abgeschlossen' THEN 'ausbau' ELSE status END
     WHERE id = r.weinausbau_id;
  END LOOP;
  UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen' WHERE id = v_z.id;
  -- Stoffkonto: Verwendungen zurückbuchen
  INSERT INTO public.kellermittel_buchungen (tenant_id, kellermittel_id, datum, art, menge, weinausbau_id, behaelter_id, zweck,
                                             produktion_id, storno_von_id, notizen)
  SELECT b.tenant_id, b.kellermittel_id, (now() AT TIME ZONE 'Europe/Vienna')::date, 'storno', -b.menge, b.weinausbau_id, b.behaelter_id,
         b.zweck, b.produktion_id, b.id, 'Storno der Produktion: ' || v_grund
    FROM public.kellermittel_buchungen b
   WHERE b.produktion_id = p_id AND b.art = 'verwendung'
     AND NOT EXISTS (SELECT 1 FROM public.kellermittel_buchungen s WHERE s.storno_von_id = b.id);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_produktion_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_produktion_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_produktion_stornieren(uuid, uuid, text) IS
  'KAN-118: Produktion stornieren – nur solange die erzeugte Charge unverändert ist; Quellen bekommen die Menge zurück, Stoffkonto wird zurückgebucht';

-- 5. Folgebuchungen und Genealogie ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_charge_hat_folgebuchung(p_charge uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.keller_umzuege u WHERE u.storniert_am IS NULL AND (u.von_weinausbau_id = p_charge OR u.nach_weinausbau_id = p_charge))
      OR EXISTS (SELECT 1 FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id
                  WHERE q.quell_weinausbau_id = p_charge AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = p_charge AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.weinausbau_id = p_charge AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.fuellung_chargen fc JOIN public.fuellungen f ON f.id = fc.fuellung_id WHERE fc.weinausbau_id = p_charge AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.verkaufsposten k ON k.id = vp.verkaufsposten_id
                  WHERE vp.weinausbau_id = p_charge AND vp.typ = 'tank' AND NOT coalesce(k.storniert, false))
      OR EXISTS (SELECT 1 FROM public.keller_behandlungen b WHERE b.weinausbau_id = p_charge AND b.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.weinanalysen a WHERE a.weinausbau_id = p_charge)
      OR EXISTS (SELECT 1 FROM public.dac_antrag d WHERE d.weinausbau_id = p_charge)
      OR EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.aktiv)
      OR EXISTS (SELECT 1 FROM public.keller_verarbeitungen kv WHERE kv.weinausbau_id = p_charge AND kv.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.keller_zugangskorrekturen zk WHERE zk.weinausbau_id = p_charge AND zk.storniert_am IS NULL)
      -- KAN-118: Quelle einer (nicht stornierten) Produktion
      OR EXISTS (SELECT 1 FROM public.produktion_eingaenge pe JOIN public.produktionen p ON p.id = pe.produktion_id
                  WHERE pe.weinausbau_id = p_charge AND p.storniert_am IS NULL)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_hat_folgebuchung(uuid) FROM PUBLIC, anon, authenticated;

-- Genealogie: ZU_PROD mit Gegencharge = Kante Quelle → Zielcharge; ZU_PROD ohne Gegencharge (Wasser, Saft, Aroma) = Wurzel
CREATE OR REPLACE VIEW public.charge_herkunft WITH (security_invoker = true) AS
WITH z AS (
  SELECT k.*, (k.storno_von_id IS NOT NULL) AS gb
    FROM public.kellerbuch_buchungen k
   WHERE k.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU', 'VS_AB', 'FUELLUNG')
)
SELECT n.tenant_id, n.beleg_nr, n.datum, n.buchungsart_code AS art,
       CASE WHEN n.bestand = 'offen' THEN n.weinausbau_id END AS nach_weinausbau_id,
       CASE WHEN n.bestand = 'flasche' THEN n.fuellung_id END AS nach_fuellung_id,
       v.weinausbau_id AS von_weinausbau_id,
       NULL::uuid AS zukauf_posten_id,
       round(n.menge_liter * v.menge_liter / NULLIF(sum(v.menge_liter) OVER (PARTITION BY n.id), 0), 3) AS liter,
       n.gb AS gegenbuchung, n.quelle_tabelle, n.quelle_id, n.gruppe_id, n.erstellt_am, n.id AS buchung_id
  FROM z n
  JOIN z v ON v.tenant_id = n.tenant_id AND v.beleg_nr = n.beleg_nr AND v.gb = n.gb AND v.bestand = 'offen'
          AND v.buchungsart_code = CASE n.buchungsart_code WHEN 'VS_ZU' THEN 'VS_AB' ELSE n.buchungsart_code END
          AND sign(v.menge_liter) = -sign(n.menge_liter) AND v.weinausbau_id IS DISTINCT FROM n.weinausbau_id
 WHERE ((n.menge_liter > 0) <> n.gb)
   AND ((n.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU') AND n.bestand = 'offen') OR (n.buchungsart_code = 'FUELLUNG' AND n.bestand = 'flasche'))
UNION ALL
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, k.weinausbau_id, NULL::uuid, k.gegen_weinausbau_id, NULL::uuid,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'offen' AND k.buchungsart_code = 'ZU_PROD' AND k.gegen_weinausbau_id IS NOT NULL
UNION ALL
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, k.weinausbau_id, NULL::uuid, NULL::uuid, k.zukauf_posten_id,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'offen' AND (k.buchungsart_code IN ('ERNTE', 'ZK_TRAUB', 'ZK_MAISC', 'ZK_MOST', 'ZK_FASS', 'EROEFF', 'INV_PLUS')
                                OR (k.buchungsart_code = 'ZU_PROD' AND k.gegen_weinausbau_id IS NULL));
COMMENT ON VIEW public.charge_herkunft IS
  'KAN-192: Genealogie aus dem Bewegungsjournal – Kante von_weinausbau_id → nach_weinausbau_id bzw. nach_fuellung_id je Beleg (Liter anteilig), Wurzeln ohne Quell-Charge (KAN-41: auch ZK_MAISC; KAN-118: Produktion – ZU_PROD je Quelle, Zusatzvolumen als Wurzel); Gegenbuchungen negativ';
