-- KAN-41 Paket 3a/3b (06.10.2026): Verarbeitung (BSM AB_VERAR) und Volumenzugang durch Behandlung (BSM ZU_BEH).
-- Entscheidung Jörgen (06.10.2026): Umsetzung nach bestem Wissen ohne BKI-Abnahme. Zwecke: Traubensaft (R10, KAN-115),
-- Essig, Brennerei (Destillation) und Sonstiges (u. a. Produktion KAN-118). Die verarbeitete Menge verlässt den
-- Weinbestand; ein Produkt daraus legen KAN-115/KAN-118 an.
--  1. keller_verarbeitungen: Datum, Charge, Menge, Zweck, Notiz, Benutzer, Storno – per API nur lesbar, geschrieben nur
--     von den RPCs (2); berichtsrelevant: Löschsperre, Storno statt Löschen.
--  2. RPCs s112_verarbeitung_buchen (mindert die Charge, ganze Menge schließt sie ab) und s112_verarbeitung_stornieren
--     (Gegenbuchung am Storno-Tag, Menge zurück an die Charge). Prüfungen wie beim Abstufen (KAN-82): Betrieb, Abo,
--     Schreibrecht Kellerbuch, Datum nicht in der Zukunft, nicht im abgeschlossenen Kellerbuch-Zeitraum, nicht vor die
--     letzte Journalbuchung der Charge.
--  3. Journal: AB_VERAR je Verarbeitung (Trigger y_journal).
--  4. Folgebuchung: eine Verarbeitung sperrt wie Umzug oder Schwund die Merkmale der Charge (KAN-205/KAN-208).
--  5. Paket 3b: keller_behandlungen.zugang_liter – Volumenzugang durch eine Kellerbehandlung (z. B. Süßreserve, RTK,
--     Säuerungs- oder Entsäuerungsmittel in Lösung). Der Trigger z_zugang_bestand erhöht den Bestand der Charge (Storno
--     bzw. Änderung nimmt ihn zurück, nie unter 0); das Journal bucht ZU_BEH am Tag der Behandlung.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Tabelle ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.keller_verarbeitungen (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  weinausbau_id      uuid NOT NULL REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  datum              date NOT NULL,
  menge_liter        numeric(10,2) NOT NULL CHECK (menge_liter > 0),
  zweck              text NOT NULL CHECK (zweck IN ('traubensaft', 'essig', 'brennerei', 'sonstiges')),
  notizen            text,
  erstellt_von       uuid,
  erstellt_von_name  text,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  storniert_am       timestamptz,
  storniert_von      uuid,
  storniert_von_name text,
  storno_grund       text
);
CREATE INDEX keller_verarbeitungen_charge_idx ON public.keller_verarbeitungen (weinausbau_id, datum);
CREATE INDEX keller_verarbeitungen_tenant_idx ON public.keller_verarbeitungen (tenant_id, datum);
COMMENT ON TABLE public.keller_verarbeitungen IS
  'KAN-41 Paket 3a: Verarbeitung einer Menge aus einer Charge (Traubensaft, Essig, Brennerei, Sonstiges) – BSM AB_VERAR; nur über s112_verarbeitung_buchen/_stornieren';

ALTER TABLE public.keller_verarbeitungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.keller_verarbeitungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.keller_verarbeitungen FROM anon;
CREATE POLICY verarbeitungen_select ON public.keller_verarbeitungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.keller_verarbeitungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.keller_verarbeitungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.keller_verarbeitungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.keller_verarbeitungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.keller_verarbeitungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY keine_direktloeschung ON public.keller_verarbeitungen AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.keller_verarbeitungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.keller_verarbeitungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');

-- 2. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_verarbeitung_buchen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_menge numeric,
  p_zweck text, p_notizen text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_w      public.weinausbau%ROWTYPE;
  v_datum  date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_menge  numeric := round(p_menge, 2);
  v_bis    date;
  v_letzte date;
  v_rest   numeric;
  v_id     uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF p_zweck IS NULL OR p_zweck NOT IN ('traubensaft', 'essig', 'brennerei', 'sonstiges') THEN
    RAISE EXCEPTION 'Unbekannter Zweck der Verarbeitung „%“.', coalesce(p_zweck, '–') USING ERRCODE = '22023';
  END IF;
  IF v_menge IS NULL OR v_menge <= 0 THEN
    RAISE EXCEPTION 'Die verarbeitete Menge muss größer als 0 L sein.' USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum der Verarbeitung liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Verarbeitung kann frühestens am % gebucht werden.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(v_bis + 1, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;

  SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.storniert_am IS NOT NULL OR NOT coalesce(v_w.aktiv, true) THEN
    RAISE EXCEPTION 'Die Charge ist storniert bzw. nicht mehr aktiv.' USING ERRCODE = '22023';
  END IF;
  -- nicht vor die letzte Journalbuchung der Charge (der Bestand zu diesem Tag stünde sonst nicht fest)
  SELECT max(k.datum) INTO v_letzte FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.weinausbau_id = p_weinausbau_id AND k.storno_von_id IS NULL;
  IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN
    RAISE EXCEPTION 'Die Charge hat am % schon eine Bewegung – die Verarbeitung kann frühestens an diesem Tag gebucht werden.',
      to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF v_menge > coalesce(v_w.menge_liter, 0) + 0.005 THEN
    RAISE EXCEPTION 'Verarbeitung von % L übersteigt den Bestand der Charge „%“ (% L).',
      replace(to_char(v_menge, 'FM999999990.00'), '.', ','), v_w.name,
      replace(to_char(coalesce(v_w.menge_liter, 0), 'FM999999990.00'), '.', ',') USING ERRCODE = '22023';
  END IF;
  v_rest := greatest(coalesce(v_w.menge_liter, 0) - v_menge, 0);
  IF v_rest <= 0.01 THEN
    v_menge := v_menge + v_rest;   -- Restmenge ≤ 0,01 L mit verarbeiten, dann abschließen (wie schwund_buchen)
    v_rest := 0;
  END IF;

  INSERT INTO public.keller_verarbeitungen (tenant_id, weinausbau_id, datum, menge_liter, zweck, notizen, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, p_weinausbau_id, v_datum, v_menge, p_zweck, NULLIF(btrim(coalesce(p_notizen, '')), ''), auth.uid(),
          public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  UPDATE public.weinausbau
     SET menge_liter = v_rest,
         aktiv = CASE WHEN v_rest = 0 THEN false ELSE aktiv END,
         status = CASE WHEN v_rest = 0 THEN 'abgeschlossen' ELSE status END
   WHERE id = p_weinausbau_id;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text) TO authenticated;
COMMENT ON FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text) IS
  'KAN-41 Paket 3a: Verarbeitung einer Menge aus einer Charge buchen (Journal AB_VERAR); ganze Menge schließt die Charge ab';

CREATE FUNCTION public.s112_verarbeitung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_v     public.keller_verarbeitungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
  v_bis   date;
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
  SELECT * INTO v_v FROM public.keller_verarbeitungen v WHERE v.id = p_id AND v.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verarbeitung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_v.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Verarbeitung ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.weinausbau w WHERE w.id = v_v.weinausbau_id FOR UPDATE;

  UPDATE public.keller_verarbeitungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = v_grund
   WHERE id = p_id;
  -- Menge zurück an die Charge; eine durch die Verarbeitung abgeschlossene Charge wird wieder aktiv
  UPDATE public.weinausbau
     SET menge_liter = round(coalesce(menge_liter, 0) + v_v.menge_liter, 2),
         aktiv = true,
         status = CASE WHEN status = 'abgeschlossen' THEN 'ausbau' ELSE status END
   WHERE id = v_v.weinausbau_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verarbeitung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_verarbeitung_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_verarbeitung_stornieren(uuid, uuid, text) IS
  'KAN-41 Paket 3a: Verarbeitung stornieren (Gegenbuchung am Storno-Tag, Menge zurück an die Charge)';

-- 3. Journal ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_journal_zeilen_verarbeitung(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN v ->> 'weinausbau_id' IS NOT NULL AND coalesce((v ->> 'menge_liter')::numeric, 0) > 0
    THEN jsonb_build_array(jsonb_build_object('code', 'AB_VERAR', 'bestand', 'offen', 'weinausbau_id', v ->> 'weinausbau_id',
           'liter', -(v ->> 'menge_liter')::numeric,
           'hinweis', 'Verarbeitung zu ' || CASE v ->> 'zweck' WHEN 'traubensaft' THEN 'Traubensaft' WHEN 'essig' THEN 'Essig'
                                                               WHEN 'brennerei' THEN 'Brennerei/Destillation' ELSE 'Sonstigem' END))
    ELSE '[]'::jsonb END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_verarbeitung(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_journal_trg_verarbeitung()
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
    v_alt := jsonb_build_object('wirksam', OLD.storniert_am IS NULL, 'datum', OLD.datum,
                                'zeilen', public.s112_journal_zeilen_verarbeitung(to_jsonb(OLD)));
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'keller_verarbeitungen', NEW.id, NEW.id, v_alt,
    jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', NEW.datum,
                       'zeilen', public.s112_journal_zeilen_verarbeitung(to_jsonb(NEW))),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_verarbeitung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF datum, menge_liter, weinausbau_id, storniert_am ON public.keller_verarbeitungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_verarbeitung();

-- 4. Folgebuchung (Regel wie lib/kellerbuch/folgebuchungen.ts) ──────────────────────────────────────────────
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
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_hat_folgebuchung(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_zukauf_hat_folgebuchung(p_charge uuid, p_zukauf uuid)
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
      OR EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.aktiv AND z.id <> p_zukauf)
      OR EXISTS (SELECT 1 FROM public.keller_verarbeitungen kv WHERE kv.weinausbau_id = p_charge AND kv.storniert_am IS NULL)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zukauf_hat_folgebuchung(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 5. Volumenzugang durch Behandlung (Paket 3b) ──────────────────────────────────────────────────────────────────
ALTER TABLE public.keller_behandlungen ADD COLUMN zugang_liter numeric(10,2)
  CONSTRAINT keller_behandlungen_zugang_chk CHECK (zugang_liter IS NULL OR (zugang_liter > 0 AND weinausbau_id IS NOT NULL));
COMMENT ON COLUMN public.keller_behandlungen.zugang_liter IS
  'KAN-41 Paket 3b: Volumenzugang durch die Behandlung in L (BSM ZU_BEH) – erhöht den Bestand der Charge (Trigger z_zugang_bestand)';

-- Bestand der Charge: der Zugang wirkt, solange die Behandlung nicht storniert ist
CREATE FUNCTION public.s112_behandlung_zugang_bestand()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt numeric := 0;
  v_neu numeric := 0;
  r     record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.storniert_am IS NULL THEN
    v_alt := coalesce(OLD.zugang_liter, 0);
  END IF;
  IF NEW.storniert_am IS NULL THEN
    v_neu := coalesce(NEW.zugang_liter, 0);
  END IF;
  FOR r IN
    SELECT x.wa, sum(x.d) AS delta
      FROM (VALUES (CASE WHEN TG_OP = 'UPDATE' THEN OLD.weinausbau_id END, -v_alt), (NEW.weinausbau_id, v_neu)) AS x(wa, d)
     WHERE x.wa IS NOT NULL
     GROUP BY x.wa
    HAVING sum(x.d) <> 0
  LOOP
    IF EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = r.wa AND coalesce(w.menge_liter, 0) + r.delta < -0.005) THEN
      RAISE EXCEPTION 'Der Volumenzugang der Behandlung kann nicht zurückgenommen werden – die Charge hat nicht mehr so viel Bestand.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.weinausbau SET menge_liter = greatest(round(coalesce(menge_liter, 0) + r.delta, 2), 0) WHERE id = r.wa;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_zugang_bestand() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_zugang_bestand AFTER INSERT OR UPDATE OF zugang_liter, weinausbau_id, storniert_am ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_zugang_bestand();

-- Journal: ZU_BEH am Tag der Behandlung
CREATE FUNCTION public.s112_journal_zeilen_behandlung(b jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN b ->> 'weinausbau_id' IS NOT NULL AND coalesce((b ->> 'zugang_liter')::numeric, 0) > 0
    THEN jsonb_build_array(jsonb_build_object('code', 'ZU_BEH', 'bestand', 'offen', 'weinausbau_id', b ->> 'weinausbau_id',
           'liter', (b ->> 'zugang_liter')::numeric,
           'hinweis', 'Zugang durch Behandlung' || coalesce(': ' || NULLIF(b ->> 'typ_name_snapshot', ''), '')))
    ELSE '[]'::jsonb END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_behandlung(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_journal_trg_behandlung()
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
    v_alt := jsonb_build_object('wirksam', OLD.storniert_am IS NULL, 'datum', OLD.datum,
                                'zeilen', public.s112_journal_zeilen_behandlung(to_jsonb(OLD)));
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'keller_behandlungen', NEW.id, NEW.id, v_alt,
    jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', NEW.datum,
                       'zeilen', public.s112_journal_zeilen_behandlung(to_jsonb(NEW))),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_behandlung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF zugang_liter, weinausbau_id, datum, storniert_am ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_behandlung();
