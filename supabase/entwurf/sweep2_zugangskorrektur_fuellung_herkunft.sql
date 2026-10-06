-- Sweep Kellerbuch (06.10.2026): KAN-53 Zugangskorrektur für Chargen, KAN-198 Chargenpflicht der Füllung in der Datenbank.
--
-- KAN-53 (Mehrmenge, Inventur-Plus, Tippfehler bei Eröffnungsbeständen mit Bewegungen) – bisher nur über den Support:
--  1. keller_zugangskorrekturen: Datum, Charge, Menge, Art (mehrmenge, inventur, sonstiges), Grund (Pflicht), Benutzer,
--     Storno – per API nur lesbar, geschrieben nur von den RPCs (2); berichtsrelevant: Löschsperre, Storno statt Löschen.
--  2. RPCs s112_zugangskorrektur_buchen (erhöht die Charge) und s112_zugangskorrektur_stornieren (Gegenbuchung am
--     Storno-Tag, nur solange der Bestand reicht) – nur Betriebsleitung (system_admin/tenant_admin, Vorgabe Ticket);
--     Prüfungen wie die Verarbeitung (KAN-41 3a): Abo, Schreibrecht Kellerbuch, Datum nicht in der Zukunft, nicht im
--     abgeschlossenen Kellerbuch-Zeitraum, nicht vor die letzte Journalbuchung der Charge.
--  3. Journal: INV_PLUS (Inventurdifferenz Mehrmenge, BSM-neutral; die BSM warnt) je Korrektur (Trigger y_journal).
--  4. Folgebuchung: eine Zugangskorrektur sperrt wie Umzug oder Verarbeitung die Merkmale der Charge.
--  5. Prüfnummer (Kommentar Jörgen 25.09.2026, R3 BKI): eine Zugangskorrektur ist prüfnummernschädlich – Ende der
--     Gültigkeit für den Tankbestand (ende_grund 'korrektur', Trigger z_pn_chargen), auch für später eingereichte Anträge
--     (s112_pn_erstes_ende). Die App fragt vorher mit pruefePruefnummernSchaden('korrektur') zurück und lehnt bei
--     eingereichtem Antrag ab.
-- KAN-198 (Chargenpflicht der Füllung, Entscheidung Jörgen 06.10.2026: ohne neue Spalte herkunftsart):
--  6. Trigger z_fuellung_herkunft (AFTER, nach RLS): Eine Füllung aus eigener Abfüllung braucht eine Charge. Ohne Charge nur als
--     Flaschen-Eröffnungsbestand bzw. Import (import_quelle) oder Flaschenzukauf (zukauf_posten_id); 23514, HINT
--     fuellung_charge. Gilt für App und Data API (authenticated/anon); Wartung, Demo-Reset und Service-Role bleiben frei
--     (wie s112_pn_workflow_schutz).
--  7. Bestand: Füllungen ohne Charge, Zukauf und Import (Sandbox: 4) werden als Flaschen-Eröffnungsbestand gekennzeichnet.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 0. Ende-Grund 'korrektur' ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pruefnummer_chargen DROP CONSTRAINT pruefnummer_chargen_ende_grund_check;
ALTER TABLE public.pruefnummer_chargen ADD CONSTRAINT pruefnummer_chargen_ende_grund_check CHECK (ende_grund IS NULL OR ende_grund IN
  ('verschnitt', 'zugang', 'zukauf', 'pressung', 'behandlung', 'abstufung', 'korrektur', 'abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht', 'storno'));

-- 1. Tabelle ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.keller_zugangskorrekturen (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  weinausbau_id      uuid NOT NULL REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  datum              date NOT NULL,
  menge_liter        numeric(10,2) NOT NULL CHECK (menge_liter > 0),
  art                text NOT NULL CHECK (art IN ('mehrmenge', 'inventur', 'sonstiges')),
  grund              text NOT NULL CHECK (length(btrim(grund)) >= 10),
  erstellt_von       uuid,
  erstellt_von_name  text,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  storniert_am       timestamptz,
  storniert_von      uuid,
  storniert_von_name text,
  storno_grund       text
);
CREATE INDEX keller_zugangskorrekturen_charge_idx ON public.keller_zugangskorrekturen (weinausbau_id, datum);
CREATE INDEX keller_zugangskorrekturen_tenant_idx ON public.keller_zugangskorrekturen (tenant_id, datum);
COMMENT ON TABLE public.keller_zugangskorrekturen IS
  'KAN-53: Zugangskorrektur einer Charge (Mehrmenge, Inventur-Plus) – Journal INV_PLUS; nur über s112_zugangskorrektur_buchen/_stornieren';

ALTER TABLE public.keller_zugangskorrekturen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.keller_zugangskorrekturen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.keller_zugangskorrekturen FROM anon;
CREATE POLICY zugangskorrekturen_select ON public.keller_zugangskorrekturen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.keller_zugangskorrekturen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.keller_zugangskorrekturen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.keller_zugangskorrekturen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.keller_zugangskorrekturen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.keller_zugangskorrekturen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY keine_direktloeschung ON public.keller_zugangskorrekturen AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.keller_zugangskorrekturen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.keller_zugangskorrekturen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');

-- 2. RPCs ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_zugangskorrektur_buchen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_menge numeric,
  p_art text, p_grund text)
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
  v_grund  text := btrim(coalesce(p_grund, ''));
  v_bis    date;
  v_letzte date;
  v_id     uuid;
BEGIN
  -- Betriebsleitung (Vorgabe KAN-53): system_admin/tenant_admin des eigenen Betriebs
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF p_art IS NULL OR p_art NOT IN ('mehrmenge', 'inventur', 'sonstiges') THEN
    RAISE EXCEPTION 'Unbekannte Art der Zugangskorrektur „%“.', coalesce(p_art, '–') USING ERRCODE = '22023';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Zugangskorrektur angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  IF v_menge IS NULL OR v_menge <= 0 THEN
    RAISE EXCEPTION 'Die Menge der Zugangskorrektur muss größer als 0 L sein.' USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum der Zugangskorrektur liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Zugangskorrektur kann frühestens am % gebucht werden.',
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
    RAISE EXCEPTION 'Die Charge hat am % schon eine Bewegung – die Zugangskorrektur kann frühestens an diesem Tag gebucht werden.',
      to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.keller_zugangskorrekturen (tenant_id, weinausbau_id, datum, menge_liter, art, grund, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, p_weinausbau_id, v_datum, v_menge, p_art, v_grund, auth.uid(), public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  UPDATE public.weinausbau SET menge_liter = round(coalesce(menge_liter, 0) + v_menge, 2) WHERE id = p_weinausbau_id;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zugangskorrektur_buchen(uuid, uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_zugangskorrektur_buchen(uuid, uuid, date, numeric, text, text) TO authenticated;
COMMENT ON FUNCTION public.s112_zugangskorrektur_buchen(uuid, uuid, date, numeric, text, text) IS
  'KAN-53: Zugangskorrektur einer Charge buchen (Mehrmenge, Inventur-Plus; Journal INV_PLUS) – nur Betriebsleitung';

CREATE FUNCTION public.s112_zugangskorrektur_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_z     public.keller_zugangskorrekturen%ROWTYPE;
  v_w     public.weinausbau%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
  v_bis   date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
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
  SELECT * INTO v_z FROM public.keller_zugangskorrekturen z WHERE z.id = p_id AND z.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zugangskorrektur nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_z.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Zugangskorrektur ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = v_z.weinausbau_id FOR UPDATE;
  IF coalesce(v_w.menge_liter, 0) + 0.005 < v_z.menge_liter THEN
    RAISE EXCEPTION 'Die Charge „%“ hat nur noch % L – die Korrektur über % L lässt sich nicht mehr zurücknehmen.',
      v_w.name, replace(to_char(coalesce(v_w.menge_liter, 0), 'FM999999990.00'), '.', ','),
      replace(to_char(v_z.menge_liter, 'FM999999990.00'), '.', ',') USING ERRCODE = '22023';
  END IF;

  UPDATE public.keller_zugangskorrekturen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = v_grund
   WHERE id = p_id;
  UPDATE public.weinausbau SET menge_liter = greatest(round(coalesce(menge_liter, 0) - v_z.menge_liter, 2), 0) WHERE id = v_z.weinausbau_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zugangskorrektur_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_zugangskorrektur_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_zugangskorrektur_stornieren(uuid, uuid, text) IS
  'KAN-53: Zugangskorrektur stornieren (Gegenbuchung am Storno-Tag, Menge zurück) – nur Betriebsleitung';

-- 3. Journal ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_journal_zeilen_zugangskorrektur(z jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN z ->> 'weinausbau_id' IS NOT NULL AND coalesce((z ->> 'menge_liter')::numeric, 0) > 0
    THEN jsonb_build_array(jsonb_build_object('code', 'INV_PLUS', 'bestand', 'offen', 'weinausbau_id', z ->> 'weinausbau_id',
           'liter', (z ->> 'menge_liter')::numeric,
           'hinweis', 'Zugangskorrektur (' || CASE z ->> 'art' WHEN 'mehrmenge' THEN 'Mehrmenge' WHEN 'inventur' THEN 'Inventur-Plus'
                                                               ELSE 'Sonstiges' END || '): ' || coalesce(z ->> 'grund', '')))
    ELSE '[]'::jsonb END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_zugangskorrektur(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_journal_trg_zugangskorrektur()
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
                                'zeilen', public.s112_journal_zeilen_zugangskorrektur(to_jsonb(OLD)));
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'keller_zugangskorrekturen', NEW.id, NEW.id, v_alt,
    jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', NEW.datum,
                       'zeilen', public.s112_journal_zeilen_zugangskorrektur(to_jsonb(NEW))),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_zugangskorrektur() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF datum, menge_liter, weinausbau_id, storniert_am ON public.keller_zugangskorrekturen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_zugangskorrektur();

-- 4. Folgebuchung (Regel wie lib/kellerbuch/folgebuchungen.ts) ───────────────────────────────────────────────
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
      OR EXISTS (SELECT 1 FROM public.keller_zugangskorrekturen zk WHERE zk.weinausbau_id = p_charge AND zk.storniert_am IS NULL)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zukauf_hat_folgebuchung(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 5. Prüfnummer: erstes Ende und Pflege je Charge, Trigger an der neuen Tabelle ──────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pn_erstes_ende(p_charge uuid, p_ab date)
RETURNS TABLE (datum date, grund text, vorgang text)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT x.d, x.g, x.v FROM (
    SELECT v.datum::date AS d, 'verschnitt' AS g, 'verschneidungen:' || v.id AS v
      FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = p_charge AND v.storniert_am IS NULL AND v.datum::date > p_ab
    UNION ALL
    SELECT z.datum::date, 'zukauf', 'zukauf_posten:' || z.id
      FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.storniert_am IS NULL AND z.datum::date > p_ab
    UNION ALL
    SELECT p.datum::date, 'pressung', 'pressung_behaelter:' || pb.id
      FROM public.pressung_behaelter pb JOIN public.pressungen p ON p.id = pb.pressung_id
     WHERE pb.weinausbau_id = p_charge AND pb.storniert_am IS NULL AND p.datum::date > p_ab
    UNION ALL   -- KAN-100: Kellerbehandlung, die den Wein verändert
    SELECT kb.datum::date, 'behandlung', 'keller_behandlungen:' || kb.id
      FROM public.keller_behandlungen kb JOIN public.keller_behandlungstypen t ON t.id = kb.typ_id
     WHERE kb.weinausbau_id = p_charge AND kb.storniert_am IS NULL AND t.pn_wirkung = 'veraenderung' AND kb.datum::date > p_ab
    UNION ALL   -- KAN-53: Zugangskorrektur
    SELECT zk.datum, 'korrektur', 'keller_zugangskorrekturen:' || zk.id
      FROM public.keller_zugangskorrekturen zk WHERE zk.weinausbau_id = p_charge AND zk.storniert_am IS NULL AND zk.datum > p_ab
    UNION ALL
    SELECT k.datum::date, 'zugang', 'keller_umzuege:' || k.id
      FROM public.keller_umzuege k
     WHERE k.nach_weinausbau_id = p_charge AND k.zeilen_typ IS DISTINCT FROM 'quelle' AND k.storniert_am IS NULL AND k.datum::date > p_ab
       AND (coalesce(k.von_weinausbau_id, p_charge) <> p_charge
            OR EXISTS (SELECT 1 FROM public.keller_umzuege q
                        WHERE k.umzug_batch_id IS NOT NULL AND q.umzug_batch_id = k.umzug_batch_id AND q.zeilen_typ = 'quelle'
                          AND q.storniert_am IS NULL AND q.von_weinausbau_id IS DISTINCT FROM p_charge))
  ) x
  ORDER BY x.d, x.g
  LIMIT 1
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pn_erstes_ende(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_pn_chargen_pflegen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c_ende_status constant text[] := ARRAY['abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht'];
  v_ziel     uuid;
  v_datum    date;
  v_vorgang  text;
  v_grund    text;
  v_quellen  uuid[];
  v_neu      boolean;
  v_w        public.weinausbau%ROWTYPE;
  r          record;
  v_uid      uuid := auth.uid();
BEGIN
  -- ── DAC-Antrag: Einreichen legt die Zeile an, Endstatus bzw. Storno beenden alle Zeilen ──
  IF TG_TABLE_NAME = 'dac_antrag' THEN
    -- direkt angelegte Anträge (Wartung, Demo, Import) mit Status ab „Eingereicht“ ebenso
    IF TG_OP = 'INSERT' THEN
      IF NEW.storniert_am IS NULL AND NEW.weinausbau_id IS NOT NULL AND NEW.status IN ('eingereicht', 'in_pruefung', 'genehmigt') THEN
        INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab)
        VALUES (NEW.tenant_id, NEW.id, NEW.weinausbau_id, coalesce(NEW.eingereicht_am, NEW.bescheid_am, (NEW.created_at AT TIME ZONE 'Europe/Vienna')::date, current_date))
        ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
      -- schon vorhandene Zugänge nach dem Beginn beenden die Gültigkeit sofort
      UPDATE public.pruefnummer_chargen pc SET gueltig_bis = e.datum, ende_grund = e.grund, ende_vorgang = e.vorgang
        FROM public.s112_pn_erstes_ende(NEW.weinausbau_id, (SELECT q.gueltig_ab FROM public.pruefnummer_chargen q WHERE q.dac_antrag_id = NEW.id AND q.weinausbau_id = NEW.weinausbau_id)) e
       WHERE pc.dac_antrag_id = NEW.id AND pc.weinausbau_id = NEW.weinausbau_id AND pc.gueltig_bis IS NULL;
      END IF;
      RETURN NULL;
    END IF;
    IF NEW.storniert_am IS NULL AND NEW.status = 'eingereicht' AND OLD.status IS DISTINCT FROM 'eingereicht'
       AND NEW.weinausbau_id IS NOT NULL THEN
      INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab)
      VALUES (NEW.tenant_id, NEW.id, NEW.weinausbau_id, coalesce(NEW.eingereicht_am, current_date))
      ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
      -- schon vorhandene Zugänge nach dem Beginn beenden die Gültigkeit sofort
      UPDATE public.pruefnummer_chargen pc SET gueltig_bis = e.datum, ende_grund = e.grund, ende_vorgang = e.vorgang
        FROM public.s112_pn_erstes_ende(NEW.weinausbau_id, (SELECT q.gueltig_ab FROM public.pruefnummer_chargen q WHERE q.dac_antrag_id = NEW.id AND q.weinausbau_id = NEW.weinausbau_id)) e
       WHERE pc.dac_antrag_id = NEW.id AND pc.weinausbau_id = NEW.weinausbau_id AND pc.gueltig_bis IS NULL;
    END IF;
    IF (NEW.status = ANY (c_ende_status) AND NOT (OLD.status = ANY (c_ende_status)))
       OR (NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL) THEN
      v_grund := CASE WHEN NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL THEN 'storno' ELSE NEW.status END;
      v_datum := coalesce(CASE WHEN v_grund = 'entzogen' THEN NEW.entzug_am END, current_date);
      UPDATE public.pruefnummer_chargen pc
         SET gueltig_bis = greatest(v_datum, pc.gueltig_ab), ende_grund = v_grund, ende_vorgang = 'dac_antrag:' || NEW.id
       WHERE pc.dac_antrag_id = NEW.id AND pc.gueltig_bis IS NULL;
    END IF;
    RETURN NULL;
  END IF;

  -- ── KAN-100: Abstufung bzw. geänderte Bezeichnung der Charge (Qualität, Zusatz, Erzeugnis, Herkunft) ──
  IF TG_TABLE_NAME = 'weinausbau' THEN
    IF (NEW.qualitaetsstufe, NEW.zusatzbezeichnung, NEW.erzeugnis, NEW.herkunft_code)
       IS DISTINCT FROM (OLD.qualitaetsstufe, OLD.zusatzbezeichnung, OLD.erzeugnis, OLD.herkunft_code) THEN
      -- KAN-82: Datum der Abstufung (s112_charge_abstufen), sonst heute
      v_datum := coalesce(NULLIF(current_setting('s112.umstufung_datum', true), '')::date, current_date);
      FOR r IN UPDATE public.pruefnummer_chargen pc
                  SET gueltig_bis = greatest(v_datum, pc.gueltig_ab), ende_grund = 'abstufung', ende_vorgang = 'weinausbau:' || NEW.id
                WHERE pc.weinausbau_id = NEW.id AND pc.gueltig_bis IS NULL
               RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_ende', v_datum, 'Für den Tankbestand erloschen: Abstufung bzw. geänderte Bezeichnung der Charge', v_uid);
      END LOOP;
    END IF;
    RETURN NULL;
  END IF;

  -- ── Vorgänge mit einer Ziel-Charge ──
  IF TG_TABLE_NAME = 'keller_umzuege' THEN
    IF NEW.nach_weinausbau_id IS NULL OR NEW.zeilen_typ = 'quelle' THEN RETURN NULL; END IF;
    v_ziel := NEW.nach_weinausbau_id;  v_grund := 'zugang';
  ELSIF TG_TABLE_NAME = 'verschneidungen' THEN
    v_ziel := NEW.ziel_weinausbau_id;  v_grund := 'verschnitt';
  ELSIF TG_TABLE_NAME = 'zukauf_posten' THEN
    v_ziel := NEW.ziel_weinausbau_id;  v_grund := 'zukauf';
  ELSIF TG_TABLE_NAME = 'pressung_behaelter' THEN
    v_ziel := NEW.weinausbau_id;  v_grund := 'pressung';
  ELSIF TG_TABLE_NAME = 'keller_behandlungen' THEN   -- KAN-100: nur Typen mit pn_wirkung 'veraenderung' (s. u.)
    IF TG_OP = 'UPDATE' AND NEW.storniert_am IS NOT DISTINCT FROM OLD.storniert_am THEN
      -- geänderte Behandlung: bisherige Wirkung zurücknehmen, danach wie eine neue bewerten
      FOR r IN UPDATE public.pruefnummer_chargen pc SET gueltig_bis = NULL, ende_grund = NULL, ende_vorgang = NULL
                WHERE pc.ende_vorgang = 'keller_behandlungen:' || NEW.id RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_wieder', current_date, 'Gültigkeit wieder offen (Behandlung geändert, keller_behandlungen:' || NEW.id || ')', v_uid);
      END LOOP;
    END IF;
    v_ziel := NEW.weinausbau_id;  v_grund := 'behandlung';
  ELSIF TG_TABLE_NAME = 'keller_zugangskorrekturen' THEN   -- KAN-53: Zugangskorrektur (Mehrmenge, Inventur-Plus)
    v_ziel := NEW.weinausbau_id;  v_grund := 'korrektur';
  ELSE
    RETURN NULL;
  END IF;
  IF v_ziel IS NULL THEN RETURN NULL; END IF;
  v_vorgang := TG_TABLE_NAME || ':' || NEW.id;

  -- Storno des Vorgangs: Weitergabe entfernen, beendete Gültigkeit wieder öffnen
  IF TG_OP = 'UPDATE' THEN
    IF NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL THEN
      FOR r IN DELETE FROM public.pruefnummer_chargen pc WHERE pc.quelle_vorgang = v_vorgang RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_wieder', current_date, 'Weitergabe zurückgenommen (Storno ' || v_vorgang || ')', v_uid);
      END LOOP;
      FOR r IN UPDATE public.pruefnummer_chargen pc SET gueltig_bis = NULL, ende_grund = NULL, ende_vorgang = NULL
                WHERE pc.ende_vorgang = v_vorgang RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_wieder', current_date, 'Gültigkeit wieder offen (Storno ' || v_vorgang || ')', v_uid);
      END LOOP;
      RETURN NULL;
    END IF;
    -- KAN-100: geänderte Kellerbehandlung (Typ, Charge, Datum) wird wie eine neue bewertet; sonst nichts
    IF TG_TABLE_NAME <> 'keller_behandlungen' OR NEW.storniert_am IS NOT NULL THEN RETURN NULL; END IF;
  END IF;
  IF TG_TABLE_NAME = 'keller_behandlungen' THEN   -- NEW.typ_id nur hier (andere Tabellen haben die Spalte nicht)
    IF NOT EXISTS (SELECT 1 FROM public.keller_behandlungstypen t WHERE t.id = NEW.typ_id AND t.pn_wirkung = 'veraenderung') THEN
      RETURN NULL;   -- Pflege bzw. nicht eingestuft: Warnung in der App, die Gültigkeit bleibt
    END IF;
  END IF;

  -- INSERT: Datum des Vorgangs
  v_datum := coalesce(CASE TG_TABLE_NAME
                        WHEN 'pressung_behaelter' THEN (SELECT p.datum FROM public.pressungen p WHERE p.id = (to_jsonb(NEW) ->> 'pressung_id')::uuid)
                        ELSE (to_jsonb(NEW) ->> 'datum')::date END, current_date);

  IF TG_TABLE_NAME = 'keller_umzuege' THEN
    -- Quellen des Umzugs: Quelle-Zeilen desselben Batches bzw. von_weinausbau_id (ältere Zeilen)
    SELECT array_agg(DISTINCT q) INTO v_quellen FROM (
      SELECT k.von_weinausbau_id AS q FROM public.keller_umzuege k
       WHERE NEW.umzug_batch_id IS NOT NULL AND k.umzug_batch_id = NEW.umzug_batch_id AND k.zeilen_typ = 'quelle'
         AND k.storniert_am IS NULL AND k.von_weinausbau_id IS NOT NULL
      UNION SELECT NEW.von_weinausbau_id WHERE NEW.von_weinausbau_id IS NOT NULL) x;
    v_quellen := array_remove(coalesce(v_quellen, '{}'), v_ziel);
    IF cardinality(v_quellen) = 0 THEN RETURN NULL; END IF;   -- Umzug innerhalb derselben Charge

    SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = v_ziel;
    v_neu := NOT coalesce(v_w.ist_eroeffnungsbestand, false) AND coalesce(v_w.anfangsbestand_liter, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM public.keller_umzuege k WHERE k.nach_weinausbau_id = v_ziel AND k.id <> NEW.id AND k.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = v_ziel AND v.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = v_ziel AND z.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.pressung_behaelter p WHERE p.weinausbau_id = v_ziel AND p.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.pruefnummer_chargen pc WHERE pc.weinausbau_id = v_ziel);

    IF v_neu THEN
      -- Neue Charge (leeres Gebinde): sie erbt jede Nummer, die für ALLE Quellen am Umzugstag gilt
      FOR r IN
        SELECT pc.dac_antrag_id, min(pc.tenant_id::text)::uuid AS tenant_id, min(pc.weinausbau_id::text)::uuid AS quelle
          FROM public.pruefnummer_chargen pc
         WHERE pc.weinausbau_id = ANY (v_quellen) AND pc.gueltig_ab <= v_datum AND (pc.gueltig_bis IS NULL OR pc.gueltig_bis >= v_datum)
         GROUP BY pc.dac_antrag_id
        HAVING count(DISTINCT pc.weinausbau_id) = cardinality(v_quellen)
      LOOP
        INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab, quelle_weinausbau_id, quelle_vorgang)
        VALUES (r.tenant_id, r.dac_antrag_id, v_ziel, v_datum, r.quelle, v_vorgang)
        ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, v_ziel, 'charge_weitergabe', v_datum, 'Umzug in ein leeres Gebinde (' || v_vorgang || ')', v_uid);
      END LOOP;
      RETURN NULL;
    END IF;
  END IF;

  -- Zugang in eine bestehende Charge: ihre Gültigkeit endet – außer bei einem Umzug, dessen Quellen alle dieselbe
  -- Nummer tragen (Teile desselben Antrags werden wieder zusammengeführt)
  FOR r IN
    UPDATE public.pruefnummer_chargen pc
       SET gueltig_bis = greatest(v_datum, pc.gueltig_ab), ende_grund = v_grund, ende_vorgang = v_vorgang
     WHERE pc.weinausbau_id = v_ziel AND pc.gueltig_bis IS NULL AND pc.gueltig_ab <= v_datum
       AND NOT (TG_TABLE_NAME = 'keller_umzuege' AND (
             SELECT count(DISTINCT q.weinausbau_id) FROM public.pruefnummer_chargen q
              WHERE q.dac_antrag_id = pc.dac_antrag_id AND q.weinausbau_id = ANY (v_quellen)
                AND q.gueltig_ab <= v_datum AND (q.gueltig_bis IS NULL OR q.gueltig_bis >= v_datum)) = cardinality(v_quellen))
    RETURNING pc.*
  LOOP
    INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
    VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_ende', v_datum, 'Für den Tankbestand erloschen: ' || v_grund || ' (' || v_vorgang || ')', v_uid);
  END LOOP;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pn_chargen_pflegen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am ON public.keller_zugangskorrekturen
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();

-- 6. KAN-198: Chargenpflicht der Füllung ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_fuellung_herkunft_pruefen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rolle text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
BEGIN
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset): frei – wie s112_pn_workflow_schutz
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;
  IF NEW.storniert_am IS NULL AND NEW.weinausbau_id IS NULL AND NEW.zukauf_posten_id IS NULL
     AND NULLIF(btrim(coalesce(NEW.import_quelle, '')), '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.fuellung_chargen fc WHERE fc.fuellung_id = NEW.id) THEN
    RAISE EXCEPTION 'Eine Füllung aus eigener Abfüllung braucht eine Charge – ohne Charge nur als Flaschen-Eröffnungsbestand bzw. Import oder über einen Flaschenzukauf.'
      USING ERRCODE = '23514', HINT = 'fuellung_charge';
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_herkunft_pruefen() FROM PUBLIC, anon, authenticated;
-- AFTER: zuerst lehnen RLS bzw. Abo-/Zwei-Faktor-Policies ab (ein BEFORE-Trigger überdeckte sie mit 23514)
CREATE TRIGGER z_fuellung_herkunft AFTER INSERT OR UPDATE OF weinausbau_id, zukauf_posten_id, import_quelle ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fuellung_herkunft_pruefen();

-- 7. Bestand: Füllungen ohne Herkunft als Flaschen-Eröffnungsbestand kennzeichnen (Wartung je Betrieb) ───────
DO $bereinigung$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT f.tenant_id FROM public.fuellungen f
            WHERE f.storniert_am IS NULL AND f.weinausbau_id IS NULL AND f.zukauf_posten_id IS NULL AND f.import_quelle IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.fuellung_chargen fc WHERE fc.fuellung_id = f.id)
  LOOP
    PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
    PERFORM set_config('s112.aenderung_grund', 'KAN-198: Füllung ohne Charge als Flaschen-Eröffnungsbestand gekennzeichnet', true);
    UPDATE public.fuellungen f SET import_quelle = 'eroeffnungsbestand'
     WHERE f.tenant_id = r.tenant_id AND f.storniert_am IS NULL AND f.weinausbau_id IS NULL AND f.zukauf_posten_id IS NULL
       AND f.import_quelle IS NULL AND NOT EXISTS (SELECT 1 FROM public.fuellung_chargen fc WHERE fc.fuellung_id = f.id);
  END LOOP;
  PERFORM set_config('s112.freeze_frei', '', true);
  PERFORM set_config('s112.aenderung_grund', '', true);
END
$bereinigung$;
