-- KAN-219 (07.10.2026): E-Label D – Umleitung eines gedruckten QR-Codes (z. B. auf die Nachfolgefüllung), mit Protokoll.
--  1. elabels += umleitung_auf (anderes E-Label desselben Betriebs, SET NULL); die öffentliche Seite zeigt dann das Ziel
--     (sofern freigegeben; Kette höchstens 5 Schritte, keine Schleifen).
--  2. Ändern nur über die RPC s112_elabel_umleiten(tenant, elabel, ziel, grund) – Grund ≥ 10 Zeichen, nur freigegebene
--     E-Labels (gedruckt), Ziel freigegeben und im eigenen Betrieb, keine Schleife. Direktes Setzen sperrt der Trigger
--     b_elabel_umleitung (auch im Entwurf); die Freeze-Sperre hebt die RPC mit s112.freeze_frei auf.
--  3. elabel_umleitungen: Protokoll (wer, wann, von, nach, Grund) – nur lesbar, geschrieben nur von der RPC.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 65, dann Produktion.

-- 1. Spalte ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.elabels
  ADD COLUMN umleitung_auf uuid REFERENCES public.elabels(id) ON DELETE SET NULL,
  ADD CONSTRAINT elabels_umleitung_nicht_selbst CHECK (umleitung_auf IS DISTINCT FROM id);
COMMENT ON COLUMN public.elabels.umleitung_auf IS
  'KAN-219: der QR-Code dieses E-Labels zeigt auf ein anderes (freigegebenes) E-Label desselben Betriebs – nur über s112_elabel_umleiten';
CREATE INDEX elabels_umleitung_idx ON public.elabels (umleitung_auf) WHERE umleitung_auf IS NOT NULL;
CREATE TRIGGER z_fremdverweis_umleitung_auf BEFORE INSERT OR UPDATE OF umleitung_auf, tenant_id ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('umleitung_auf', 'elabels', '', '', '');

CREATE FUNCTION public.s112_elabel_umleitung_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.umleitung_auf IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.umleitung_auf IS DISTINCT FROM OLD.umleitung_auf) THEN
    IF coalesce(current_setting('s112.elabel_umleitung', true), '') <> 'an' AND NOT public.ist_service_kontext() THEN
      RAISE EXCEPTION 'Die Umleitung eines E-Labels ändert nur „Umleiten“ (mit Grund, protokolliert).' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_umleitung_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_elabel_umleitung BEFORE INSERT OR UPDATE ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_elabel_umleitung_schutz();

-- 2. Protokoll ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.elabel_umleitungen (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  elabel_id        uuid NOT NULL REFERENCES public.elabels(id) ON DELETE CASCADE,
  von_elabel_id    uuid REFERENCES public.elabels(id) ON DELETE SET NULL,
  nach_elabel_id   uuid REFERENCES public.elabels(id) ON DELETE SET NULL,
  grund            text NOT NULL CHECK (length(btrim(grund)) >= 10),
  geaendert_am     timestamptz NOT NULL DEFAULT now(),
  geaendert_von    uuid,
  geaendert_von_name text
);
CREATE INDEX elabel_umleitungen_elabel_idx ON public.elabel_umleitungen (elabel_id, geaendert_am DESC);
CREATE INDEX elabel_umleitungen_tenant_idx ON public.elabel_umleitungen (tenant_id);
COMMENT ON TABLE public.elabel_umleitungen IS 'KAN-219: Protokoll der Umleitungen gedruckter E-Label-QR-Codes – nur lesbar, geschrieben von s112_elabel_umleiten';

ALTER TABLE public.elabel_umleitungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.elabel_umleitungen FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.elabel_umleitungen FROM PUBLIC, authenticated;
CREATE POLICY elabel_umleitungen_select ON public.elabel_umleitungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.elabel_umleitungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.elabel_umleitungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.elabel_umleitungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.elabel_umleitungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.elabel_umleitungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- 3. RPC ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_elabel_umleiten(p_tenant_id uuid, p_elabel_id uuid, p_ziel_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_e      public.elabels%ROWTYPE;
  v_z      public.elabels%ROWTYPE;
  v_schritt uuid;
  v_n      integer := 0;
  v_uid    uuid := auth.uid();
  v_name   text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Kellerbuch bzw. Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Umleitung angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_e FROM public.elabels e WHERE e.id = p_elabel_id AND e.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E-Label nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_e.status <> 'freigegeben' THEN
    RAISE EXCEPTION 'Umleiten lassen sich nur freigegebene E-Labels (der QR-Code ist gedruckt).' USING ERRCODE = '22023';
  END IF;
  IF p_ziel_id IS NOT DISTINCT FROM v_e.umleitung_auf THEN
    RAISE EXCEPTION 'Die Umleitung ist bereits so eingestellt.' USING ERRCODE = '22023';
  END IF;
  IF p_ziel_id IS NOT NULL THEN
    IF p_ziel_id = p_elabel_id THEN
      RAISE EXCEPTION 'Ein E-Label kann nicht auf sich selbst umgeleitet werden.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_z FROM public.elabels e WHERE e.id = p_ziel_id AND e.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ziel-E-Label nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    IF v_z.status <> 'freigegeben' THEN
      RAISE EXCEPTION 'Das Ziel muss ein freigegebenes E-Label sein.' USING ERRCODE = '22023';
    END IF;
    -- keine Schleife: der Weg ab dem Ziel darf nicht zurück zu diesem E-Label führen
    v_schritt := v_z.umleitung_auf;
    WHILE v_schritt IS NOT NULL LOOP
      v_n := v_n + 1;
      IF v_schritt = p_elabel_id OR v_n > 5 THEN
        RAISE EXCEPTION 'Diese Umleitung ergäbe eine Schleife bzw. eine zu lange Kette (höchstens 5 Schritte).' USING ERRCODE = '22023';
      END IF;
      SELECT e.umleitung_auf INTO v_schritt FROM public.elabels e WHERE e.id = v_schritt;
    END LOOP;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
    INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
  IF v_name IS NULL AND v_uid IS NOT NULL THEN
    SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
  END IF;

  PERFORM set_config('s112.freeze_frei', 'elabels', true);
  PERFORM set_config('s112.elabel_umleitung', 'an', true);
  UPDATE public.elabels SET umleitung_auf = p_ziel_id WHERE id = p_elabel_id;
  PERFORM set_config('s112.elabel_umleitung', '', true);
  PERFORM set_config('s112.freeze_frei', '', true);

  INSERT INTO public.elabel_umleitungen (tenant_id, elabel_id, von_elabel_id, nach_elabel_id, grund, geaendert_von, geaendert_von_name)
  VALUES (p_tenant_id, p_elabel_id, v_e.umleitung_auf, p_ziel_id, btrim(p_grund), v_uid, v_name);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_umleiten(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_elabel_umleiten(uuid, uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_elabel_umleiten(uuid, uuid, uuid, text) IS
  'KAN-219: QR-Code eines freigegebenen E-Labels auf ein anderes freigegebenes E-Label desselben Betriebs umleiten (NULL = aufheben), Grund ≥ 10 Zeichen, protokolliert';
