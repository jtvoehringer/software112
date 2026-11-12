-- KAN-418 Teil 2 (12.11.2026): Lieferung aus dem Auftrag.
--
-- „Liefern“ am Auftrag erzeugt einen normalen Verkauf (Lieferschein bzw. Rechnung sofort) mit den Preisen von heute.
-- Die Lieferung wird VOR der Bestandsbuchung am Auftrag vermerkt (geliefert steigt, die Reservierung sinkt um genau
-- diese Flaschen) – so darf der Verkauf seine eigene Reservierung verbrauchen. Entscheidungen Jörgen (12.11.2026):
--   1A Storno des Verkaufs nimmt die Lieferung zurück – der Auftrag ist wieder offen, die Flaschen wieder reserviert.
--   2A „Auftrag abschließen“: Rest wird nicht mehr geliefert, Status „abgeschlossen“, Rest-Reservierung fällt weg.
--   3A Je Auftragsposition höchstens die offene Menge; Mehrmenge ist eine freie Position im selben Verkauf.
--
-- 1. Status „abgeschlossen“ am Auftrag.
-- 2. auftrag_lieferungen (nur lesbar; geschrieben über die RPCs und den Storno-Trigger).
-- 3. s112_auftrag_liefern, s112_auftrag_lieferung_zuruecknehmen (Abbruchweg), Storno-Trigger am Verkaufsposten.
-- 4. s112_auftrag_abschliessen; s112_auftrag_stornieren lehnt Aufträge mit Lieferungen ab.

-- ── 1. Status ───────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.auftraege DROP CONSTRAINT auftraege_status_chk;
ALTER TABLE public.auftraege ADD CONSTRAINT auftraege_status_chk
  CHECK (status IN ('offen', 'teilgeliefert', 'geliefert', 'abgeschlossen', 'storniert'));
ALTER TABLE public.auftraege
  ADD COLUMN abgeschlossen_am  timestamptz,
  ADD COLUMN abgeschlossen_von uuid,
  ADD CONSTRAINT auftraege_abgeschlossen_chk CHECK ((status = 'abgeschlossen') = (abgeschlossen_am IS NOT NULL));

-- ── 2. Lieferungen ──────────────────────────────────────────────────────────────────────────────────────────────────
-- verkaufsposten_id bewusst ohne Fremdschlüssel (wie fuellung_bewegungen): die Lieferung wird vor der Bestandsbuchung
-- vermerkt, der Beleg entsteht erst danach (keine Lücke im Nummernkreis bei einer Ablehnung, KAN-35).
CREATE TABLE public.auftrag_lieferungen (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  auftrag_id           uuid NOT NULL REFERENCES public.auftraege(id) ON DELETE CASCADE,
  auftrag_position_id  uuid NOT NULL REFERENCES public.auftrag_positionen(id) ON DELETE CASCADE,
  verkaufsposten_id    uuid NOT NULL,
  menge                integer NOT NULL CONSTRAINT auftrag_lieferungen_menge_chk CHECK (menge BETWEEN 1 AND 1000000),
  erstellt_am          timestamptz NOT NULL DEFAULT now(),
  erstellt_von         uuid DEFAULT auth.uid(),
  zurueckgenommen_am   timestamptz,
  zurueck_grund        text CONSTRAINT auftrag_lieferungen_grund_chk CHECK (zurueck_grund IS NULL OR char_length(zurueck_grund) <= 200)
);
CREATE INDEX auftrag_lieferungen_tenant_idx ON public.auftrag_lieferungen (tenant_id);
CREATE INDEX auftrag_lieferungen_auftrag_idx ON public.auftrag_lieferungen (auftrag_id);
CREATE INDEX auftrag_lieferungen_position_idx ON public.auftrag_lieferungen (auftrag_position_id);
CREATE INDEX auftrag_lieferungen_verkauf_idx ON public.auftrag_lieferungen (verkaufsposten_id);
COMMENT ON TABLE public.auftrag_lieferungen IS
  'KAN-418: Lieferungen zu einem Auftrag – je Auftragsposition und Verkauf die gelieferten Flaschen. Zurückgenommen (zurueckgenommen_am) beim Storno des Verkaufs.';

DO $rls$
DECLARE
  t text := 'auftrag_lieferungen';
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT public.s112_meine_tenants()))', t || '_select', t);
  EXECUTE format('CREATE POLICY mitgliedschaft_aktiv ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))', t);
  EXECUTE format('CREATE POLICY abo_schreibsperre_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
  EXECUTE format('CREATE POLICY abo_schreibsperre_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
  EXECUTE format('CREATE POLICY abo_schreibsperre_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
  EXECUTE format('CREATE POLICY zwei_faktor_aal ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()))', t);
END
$rls$;

CREATE TRIGGER z_fremdverweis_auftrag_id BEFORE INSERT OR UPDATE OF auftrag_id, tenant_id ON public.auftrag_lieferungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('auftrag_id', 'auftraege', '', '', '');
CREATE TRIGGER z_fremdverweis_auftrag_position_id BEFORE INSERT OR UPDATE OF auftrag_position_id, tenant_id ON public.auftrag_lieferungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('auftrag_position_id', 'auftrag_positionen', '', '', '');

-- ── 3. Liefern und zurücknehmen ─────────────────────────────────────────────────────────────────────────────────────
-- Status eines Auftrags aus seinen Positionen (nur für lieferbare bzw. gelieferte Aufträge; abgeschlossen/storniert bleiben)
CREATE FUNCTION public.s112_auftrag_status_setzen(p_auftrag_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alt     text;
  v_neu     text;
  v_menge   bigint;
  v_gelief  bigint;
BEGIN
  SELECT status INTO v_alt FROM public.auftraege WHERE id = p_auftrag_id FOR UPDATE;
  IF NOT FOUND OR v_alt NOT IN ('offen', 'teilgeliefert', 'geliefert') THEN
    RETURN v_alt;
  END IF;
  SELECT COALESCE(SUM(menge), 0), COALESCE(SUM(geliefert), 0) INTO v_menge, v_gelief FROM public.auftrag_positionen WHERE auftrag_id = p_auftrag_id;
  v_neu := CASE WHEN v_gelief <= 0 THEN 'offen' WHEN v_gelief >= v_menge THEN 'geliefert' ELSE 'teilgeliefert' END;
  IF v_neu IS DISTINCT FROM v_alt THEN
    PERFORM set_config('s112.auftrag_frei', 'ja', true);
    UPDATE public.auftraege SET status = v_neu, aktualisiert_am = now() WHERE id = p_auftrag_id;
    PERFORM set_config('s112.auftrag_frei', '', true);
  END IF;
  RETURN v_neu;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_status_setzen(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_auftrag_liefern(p_tenant_id uuid, p_auftrag_id uuid, p_verkaufsposten_id uuid, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a  record;
  v_z  record;
  v_p  record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF p_verkaufsposten_id IS NULL THEN
    RAISE EXCEPTION 'Der Lieferung fehlt der Verkauf.' USING ERRCODE = '23514';
  END IF;
  IF p_positionen IS NULL OR jsonb_typeof(p_positionen) <> 'array' OR jsonb_array_length(p_positionen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Position liefern.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_positionen) > 100 THEN
    RAISE EXCEPTION 'Höchstens 100 Positionen je Lieferung.' USING ERRCODE = '23514';
  END IF;

  SELECT id, nummer, art, status, storniert_am INTO v_a FROM public.auftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.art <> 'auftrag' OR v_a.storniert_am IS NOT NULL OR v_a.status NOT IN ('offen', 'teilgeliefert') THEN
    RAISE EXCEPTION 'Der Auftrag % lässt sich nicht mehr liefern (Status: %).', v_a.nummer, v_a.status
      USING ERRCODE = '23514', HINT = 'auftrag_nicht_lieferbar';
  END IF;
  -- derselbe Verkauf nur einmal (doppeltes Absenden)
  IF EXISTS (SELECT 1 FROM public.auftrag_lieferungen l WHERE l.verkaufsposten_id = p_verkaufsposten_id)
     OR EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.id = p_verkaufsposten_id) THEN
    RAISE EXCEPTION 'Diese Lieferung ist bereits verbucht.' USING ERRCODE = '23505';
  END IF;

  FOR v_z IN
    SELECT (e ->> 'position_id')::uuid AS position_id, NULLIF(e ->> 'fuellung_id', '')::uuid AS fuellung_id,
           SUM((e ->> 'menge')::integer) AS menge, bool_or((e ->> 'menge')::integer < 1) AS ungueltig
      FROM jsonb_array_elements(p_positionen) e
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    IF v_z.position_id IS NULL OR v_z.ungueltig THEN
      RAISE EXCEPTION 'Bitte je Position eine Menge ab 1 Flasche angeben.' USING ERRCODE = '23514';
    END IF;
    SELECT id, fuellung_id, name, menge, geliefert INTO v_p
      FROM public.auftrag_positionen WHERE id = v_z.position_id AND auftrag_id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Auftragsposition nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = '23503';
    END IF;
    IF v_z.fuellung_id IS NOT NULL AND v_z.fuellung_id <> v_p.fuellung_id THEN
      RAISE EXCEPTION '„%“: Die Position des Verkaufs passt nicht zur Auftragsposition.', v_p.name USING ERRCODE = '23514';
    END IF;
    IF v_z.menge > v_p.menge - v_p.geliefert THEN
      RAISE EXCEPTION '„%“: nur noch % Flaschen offen (bestellt %, geliefert %), % angefragt.',
        v_p.name, v_p.menge - v_p.geliefert, v_p.menge, v_p.geliefert, v_z.menge
        USING ERRCODE = '22023', HINT = 'auftrag_offen';
    END IF;
    UPDATE public.auftrag_positionen SET geliefert = geliefert + v_z.menge WHERE id = v_p.id;
    INSERT INTO public.auftrag_lieferungen (tenant_id, auftrag_id, auftrag_position_id, verkaufsposten_id, menge, erstellt_von)
    VALUES (p_tenant_id, p_auftrag_id, v_p.id, p_verkaufsposten_id, v_z.menge, (SELECT auth.uid()));
  END LOOP;

  RETURN jsonb_build_object('auftrag_id', p_auftrag_id, 'nummer', v_a.nummer, 'status', public.s112_auftrag_status_setzen(p_auftrag_id));
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_liefern(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_liefern(uuid, uuid, uuid, jsonb) TO authenticated, service_role;

-- Lieferungen eines Verkaufs zurücknehmen (intern: Storno-Trigger und Abbruchweg). Liefert die Zahl der Zeilen.
CREATE FUNCTION public.s112_auftrag_lieferung_zurueck_intern(p_verkaufsposten_id uuid, p_grund text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_n      integer := 0;
  v_auftr  uuid[] := '{}';
  v_id     uuid;
BEGIN
  -- Aufträge in fester Reihenfolge sperren
  FOR v_id IN SELECT DISTINCT l.auftrag_id FROM public.auftrag_lieferungen l
               WHERE l.verkaufsposten_id = p_verkaufsposten_id AND l.zurueckgenommen_am IS NULL ORDER BY 1 LOOP
    PERFORM 1 FROM public.auftraege a WHERE a.id = v_id FOR UPDATE;
    v_auftr := v_auftr || v_id;
  END LOOP;
  FOR r IN SELECT l.id, l.auftrag_position_id, l.menge FROM public.auftrag_lieferungen l
            WHERE l.verkaufsposten_id = p_verkaufsposten_id AND l.zurueckgenommen_am IS NULL ORDER BY l.auftrag_position_id, l.id FOR UPDATE LOOP
    UPDATE public.auftrag_positionen SET geliefert = GREATEST(geliefert - r.menge, 0) WHERE id = r.auftrag_position_id;
    UPDATE public.auftrag_lieferungen SET zurueckgenommen_am = now(), zurueck_grund = left(p_grund, 200) WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  FOREACH v_id IN ARRAY v_auftr LOOP
    PERFORM public.s112_auftrag_status_setzen(v_id);
  END LOOP;
  RETURN v_n;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_lieferung_zurueck_intern(uuid, text) FROM PUBLIC, anon, authenticated;

-- Abbruchweg der App: Der Verkauf kam nach dem Vermerk der Lieferung nicht zustande (Bestand, Periodensperre …).
-- Nur solange es zu dieser Lieferung keinen gültigen Verkauf gibt – ein gebuchter Verkauf wird storniert, nicht „entliefert“.
CREATE FUNCTION public.s112_auftrag_lieferung_zuruecknehmen(p_tenant_id uuid, p_verkaufsposten_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF EXISTS (SELECT 1 FROM public.auftrag_lieferungen l WHERE l.verkaufsposten_id = p_verkaufsposten_id AND l.tenant_id <> p_tenant_id) THEN
    RAISE EXCEPTION 'Lieferung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.id = p_verkaufsposten_id AND v.storniert IS NOT TRUE) THEN
    RAISE EXCEPTION 'Zu dieser Lieferung gibt es einen Verkauf – bitte den Verkauf stornieren.' USING ERRCODE = '23514';
  END IF;
  RETURN public.s112_auftrag_lieferung_zurueck_intern(p_verkaufsposten_id, 'Verkauf nicht zustande gekommen');
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_lieferung_zuruecknehmen(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_lieferung_zuruecknehmen(uuid, uuid) TO authenticated, service_role;

-- Storno des Verkaufs (jeder Weg) nimmt die Lieferung zurück
CREATE FUNCTION public.s112_auftrag_lieferung_storno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.s112_auftrag_lieferung_zurueck_intern(NEW.id, 'Verkauf storniert');
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_lieferung_storno() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_auftrag_lieferung_storno AFTER UPDATE OF storniert ON public.verkaufsposten
  FOR EACH ROW WHEN (NEW.storniert IS TRUE AND OLD.storniert IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.s112_auftrag_lieferung_storno();

-- ── 4. Abschließen und Stornieren ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_auftrag_abschliessen(p_tenant_id uuid, p_auftrag_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  SELECT id, nummer, status INTO v_a FROM public.auftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.status <> 'teilgeliefert' THEN
    RAISE EXCEPTION 'Abschließen lässt sich nur ein teilweise gelieferter Auftrag (Auftrag %: %).', v_a.nummer, v_a.status USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege
     SET status = 'abgeschlossen', abgeschlossen_am = now(), abgeschlossen_von = (SELECT auth.uid()), aktualisiert_am = now()
   WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.auftrag_frei', '', true);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_abschliessen(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_abschliessen(uuid, uuid) TO authenticated, service_role;

-- Stornieren: nicht mehr, sobald geliefert wurde (dann abschließen bzw. erst den Verkauf stornieren)
CREATE OR REPLACE FUNCTION public.s112_auftrag_stornieren(p_tenant_id uuid, p_auftrag_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a     record;
  v_grund text := btrim(coalesce(p_grund, ''));
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT id, nummer, status, storniert_am INTO v_a FROM public.auftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Auftrag % ist bereits storniert.', v_a.nummer USING ERRCODE = '23514';
  END IF;
  IF v_a.status = 'abgeschlossen' THEN
    RAISE EXCEPTION 'Der Auftrag % ist abgeschlossen.', v_a.nummer USING ERRCODE = '23514';
  END IF;
  IF v_a.status IN ('geliefert', 'teilgeliefert')
     OR EXISTS (SELECT 1 FROM public.auftrag_lieferungen l WHERE l.auftrag_id = p_auftrag_id AND l.zurueckgenommen_am IS NULL) THEN
    RAISE EXCEPTION 'Zum Auftrag % wurde bereits geliefert – bitte den Auftrag abschließen bzw. zuerst den Verkauf stornieren.', v_a.nummer
      USING ERRCODE = '23514', HINT = 'auftrag_geliefert';
  END IF;
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege
     SET status = 'storniert', storniert_am = now(), storniert_von = (SELECT auth.uid()), storno_grund = left(v_grund, 500), aktualisiert_am = now()
   WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.auftrag_frei', '', true);
END
$$;
