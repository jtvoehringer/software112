-- KAN-466 (16.11.2026): Tank mit Kammern – Stufe 1 (Stammdaten und Anzeige).
--
-- Manche Tanks sind in übereinander liegende Kammern geteilt (z. B. 7.000 l = 3.000 + 2.000 + 2.000 l). Jede Kammer wird
-- getrennt befüllt und ist deshalb ein ganz normales Gebinde (eigene Charge, Umzüge, Kellerbehandlungen, Fassungsprüfung,
-- eigene Zeile im BKI-Gebindeverzeichnis). Neu ist nur die Klammer darüber:
--   * gebinde_tanks: der Tank (Name, Typ, Material, Standort) – selbst KEIN Gebinde, nie befüllbar, nie gemeldet;
--   * behaelter.tank_id / kammer_nr: die Kammer gehört zu einem Tank (1 = unterste Kammer).
-- Entscheidungen Jörgen 16.11.2026 (Abklärung am Ticket): Behörde = Kammern einzeln; nur Neuanlage (keine Umwandlung
-- bestehender Gebinde); Freigabe der Kellergemeinschaft je Kammer; Typ, Material und Standort kommen vom Tank.
-- Der Tank ist bewusst eine eigene Tabelle und keine Gebinde-Zeile: rund 50 Stellen laden Gebinde – ein Tank als
-- Gebinde müsste überall ausgefiltert werden (Auswahllisten, Zählung, BKI, Fassungsvermögen).
-- Kammern entstehen nur über s112_tank_anlegen (eine Transaktion); die Zuordnung Kammer ↔ Tank ist danach fest.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Tabelle gebinde_tanks ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.gebinde_tanks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name       text NOT NULL CONSTRAINT gebinde_tanks_name_chk CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  typ        text NOT NULL CONSTRAINT gebinde_tanks_typ_chk CHECK (typ = ANY (ARRAY['stahltank', 'lagertank', 'immervolltank',
               'holzfass', 'betonei', 'amphore', 'bottich', 'gaerstaender', 'zisterne', 'sonstiges'])),
  material   text CONSTRAINT gebinde_tanks_material_chk CHECK (material IS NULL OR char_length(material) <= 255),
  standort   text CONSTRAINT gebinde_tanks_standort_chk CHECK (standort IS NULL OR char_length(standort) <= 255),
  notizen    text CONSTRAINT gebinde_tanks_notizen_chk CHECK (notizen IS NULL OR char_length(notizen) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Name je Betrieb eindeutig (wie behaelter_name_je_betrieb); der Index beginnt mit tenant_id (DB-Test 78)
CREATE UNIQUE INDEX gebinde_tanks_name_je_betrieb ON public.gebinde_tanks (tenant_id, lower(btrim(name)));
COMMENT ON TABLE public.gebinde_tanks IS
  'KAN-466: Tank mit Kammern. Der Tank ist kein Gebinde – die Kammern sind Zeilen in behaelter (tank_id, kammer_nr) und übernehmen Typ, Material und Standort vom Tank.';

ALTER TABLE public.gebinde_tanks ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.gebinde_tanks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gebinde_tanks FROM anon;

CREATE POLICY gebinde_tanks_select ON public.gebinde_tanks FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY gebinde_tanks_insert ON public.gebinde_tanks FOR INSERT TO authenticated
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY gebinde_tanks_update ON public.gebinde_tanks FOR UPDATE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
-- Löschen wie bei Gebinden nur die Betriebsleitung
CREATE POLICY gebinde_tanks_delete ON public.gebinde_tanks FOR DELETE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']));

CREATE POLICY mitgliedschaft_aktiv ON public.gebinde_tanks AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.gebinde_tanks AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
-- KAN-454/KAN-459: Lesebereich „keller“ – für alle Befehle
CREATE POLICY lesebereich ON public.gebinde_tanks AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('keller'))))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('keller'))));
COMMENT ON POLICY lesebereich ON public.gebinde_tanks IS 'KAN-466: Lesebereich keller – gesperrt für Profile ohne diesen Bereich (alle Befehle, KAN-459)';
CREATE POLICY abo_schreibsperre_ins ON public.gebinde_tanks AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.gebinde_tanks AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.gebinde_tanks AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
-- Schreibmodul Kellerbuch (wie behaelter)
CREATE POLICY modul_insert ON public.gebinde_tanks AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));
CREATE POLICY modul_update ON public.gebinde_tanks AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'kellerbuch')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));
CREATE POLICY modul_delete ON public.gebinde_tanks AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));

CREATE TRIGGER gebinde_tanks_updated_at BEFORE UPDATE ON public.gebinde_tanks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 2. Kammer = Gebinde mit Tank ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.behaelter
  ADD COLUMN tank_id   uuid REFERENCES public.gebinde_tanks(id),
  ADD COLUMN kammer_nr smallint,
  ADD CONSTRAINT behaelter_kammer_chk CHECK ((tank_id IS NULL) = (kammer_nr IS NULL)),
  ADD CONSTRAINT behaelter_kammer_nr_chk CHECK (kammer_nr IS NULL OR kammer_nr BETWEEN 1 AND 12);
-- je Tank jede Kammer-Nummer einmal (NULL gilt als verschieden); zugleich der Index zum Fremdschlüssel (DB-Test 78)
CREATE UNIQUE INDEX behaelter_tank_kammer ON public.behaelter (tank_id, kammer_nr);
COMMENT ON COLUMN public.behaelter.tank_id IS 'KAN-466: Tank, zu dem diese Kammer gehört (gebinde_tanks); NULL = eigenständiges Gebinde';
COMMENT ON COLUMN public.behaelter.kammer_nr IS 'KAN-466: Nummer der Kammer im Tank, 1 = unterste';

-- KAN-178: Verweis nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_tank_id BEFORE INSERT OR UPDATE OF tank_id, tenant_id ON public.behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('tank_id', 'gebinde_tanks', '', '', '');

-- Kammer: Zuordnung fest, Typ/Material/Standort vom Tank
CREATE FUNCTION public.s112_kammer_vom_tank() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t    public.gebinde_tanks%ROWTYPE;
  v_frei boolean := public.ist_service_kontext() OR coalesce(current_setting('s112.tank_frei', true), '') = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tank_id IS NULL THEN RETURN NEW; END IF;
    IF NOT v_frei THEN
      RAISE EXCEPTION 'Kammern entstehen nur beim Anlegen des Tanks.' USING ERRCODE = '42501', HINT = 'tank_kammer';
    END IF;
  ELSE
    IF (NEW.tank_id IS DISTINCT FROM OLD.tank_id OR NEW.kammer_nr IS DISTINCT FROM OLD.kammer_nr) AND NOT v_frei THEN
      RAISE EXCEPTION 'Die Zuordnung einer Kammer zu ihrem Tank lässt sich nicht ändern.' USING ERRCODE = '42501', HINT = 'tank_kammer';
    END IF;
    IF NEW.tank_id IS NULL THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO v_t FROM public.gebinde_tanks t WHERE t.id = NEW.tank_id AND t.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Der Tank gehört nicht zu diesem Betrieb.' USING ERRCODE = '23503', HINT = 'tank_kammer';
  END IF;
  NEW.typ := v_t.typ;
  NEW.material := v_t.material;
  NEW.standort := v_t.standort;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_kammer_vom_tank() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_kammer_vom_tank BEFORE INSERT OR UPDATE ON public.behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_kammer_vom_tank();

-- Tank: Betrieb fest; geänderter Typ/Material/Standort geht an die Kammern
CREATE FUNCTION public.s112_tank_an_kammern() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Ein Tank kann den Betrieb nicht wechseln.' USING ERRCODE = '42501';
  END IF;
  IF NEW.typ IS DISTINCT FROM OLD.typ OR NEW.material IS DISTINCT FROM OLD.material OR NEW.standort IS DISTINCT FROM OLD.standort THEN
    -- a_kammer_vom_tank liest die neuen Werte aus dieser Zeile
    UPDATE public.behaelter b SET typ = NEW.typ, material = NEW.material, standort = NEW.standort WHERE b.tank_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_tank_an_kammern() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_tank_an_kammern AFTER UPDATE ON public.gebinde_tanks
  FOR EACH ROW EXECUTE FUNCTION public.s112_tank_an_kammern();

-- ── 3. Tank samt Kammern anlegen ────────────────────────────────────────────────────────────────────────────────────
-- p_kammern: [{ "name": "A10/1", "volumen_liter": 3000, "gemeinsam": true }, …] – Reihenfolge = von unten nach oben
CREATE FUNCTION public.s112_tank_anlegen(
  p_tenant_id uuid, p_name text, p_typ text, p_material text, p_standort text, p_notizen text, p_kammern jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_n    int;
  v_id   uuid;
  v_dopp text;
  r      record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' OR char_length(v_name) > 50 THEN
    RAISE EXCEPTION 'Bitte einen Namen für den Tank angeben (höchstens 50 Zeichen).' USING ERRCODE = '22023', HINT = 'tank_name';
  END IF;
  IF p_kammern IS NULL OR jsonb_typeof(p_kammern) <> 'array' OR jsonb_array_length(p_kammern) NOT BETWEEN 2 AND 12 THEN
    RAISE EXCEPTION 'Ein Tank mit Kammern braucht 2 bis 12 Kammern.' USING ERRCODE = '22023', HINT = 'tank_kammern';
  END IF;
  v_n := jsonb_array_length(p_kammern);

  FOR r IN
    SELECT x.ord, btrim(coalesce(x.e ->> 'name', '')) AS name, x.e ->> 'volumen_liter' AS vol
    FROM jsonb_array_elements(p_kammern) WITH ORDINALITY AS x(e, ord)
  LOOP
    IF r.name = '' OR char_length(r.name) > 50 THEN
      RAISE EXCEPTION 'Kammer %: bitte einen Namen angeben (höchstens 50 Zeichen).', r.ord USING ERRCODE = '22023', HINT = 'tank_kammern';
    END IF;
    IF r.vol IS NULL OR r.vol !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' OR r.vol::numeric <= 0 THEN
      RAISE EXCEPTION 'Kammer %: bitte das Fassungsvermögen in Litern angeben.', r.ord USING ERRCODE = '22023', HINT = 'tank_kammern';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT lower(btrim(x.e ->> 'name'))) FROM jsonb_array_elements(p_kammern) AS x(e)) <> v_n THEN
    RAISE EXCEPTION 'Jede Kammer braucht einen eigenen Namen.' USING ERRCODE = '22023', HINT = 'tank_kammern';
  END IF;

  -- Namen: der Tank darf weder wie ein anderer Tank noch wie ein Gebinde heißen, die Kammern nicht wie ein Gebinde
  IF EXISTS (SELECT 1 FROM public.gebinde_tanks t WHERE t.tenant_id = p_tenant_id AND lower(btrim(t.name)) = lower(v_name))
     OR EXISTS (SELECT 1 FROM public.behaelter b WHERE b.tenant_id = p_tenant_id AND lower(btrim(b.name)) = lower(v_name)) THEN
    RAISE EXCEPTION 'Der Name „%“ ist in diesem Betrieb schon vergeben.', v_name USING ERRCODE = '23505', HINT = 'tank_name';
  END IF;
  SELECT b.name INTO v_dopp FROM public.behaelter b
   WHERE b.tenant_id = p_tenant_id
     AND lower(btrim(b.name)) IN (SELECT lower(btrim(x.e ->> 'name')) FROM jsonb_array_elements(p_kammern) AS x(e))
   LIMIT 1;
  IF v_dopp IS NOT NULL THEN
    RAISE EXCEPTION 'Der Name „%“ ist in diesem Betrieb schon an ein Gebinde vergeben.', v_dopp USING ERRCODE = '23505', HINT = 'tank_kammern';
  END IF;

  INSERT INTO public.gebinde_tanks (tenant_id, name, typ, material, standort, notizen)
  VALUES (p_tenant_id, v_name, p_typ, nullif(btrim(coalesce(p_material, '')), ''), nullif(btrim(coalesce(p_standort, '')), ''),
          nullif(btrim(coalesce(p_notizen, '')), ''))
  RETURNING id INTO v_id;

  PERFORM set_config('s112.tank_frei', '1', true);
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, gemeinsam, aktiv, tank_id, kammer_nr)
  SELECT p_tenant_id, btrim(x.e ->> 'name'), (x.e ->> 'volumen_liter')::numeric,
         CASE WHEN x.e ? 'gemeinsam' THEN coalesce((x.e ->> 'gemeinsam')::boolean, true) ELSE true END, true, v_id, x.ord::smallint
  FROM jsonb_array_elements(p_kammern) WITH ORDINALITY AS x(e, ord);
  PERFORM set_config('s112.tank_frei', '', true);

  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_tank_anlegen(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_tank_anlegen(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.s112_tank_anlegen(uuid, text, text, text, text, text, jsonb) IS
  'KAN-466: legt einen Tank und seine Kammern (Gebinde) in einer Transaktion an; Kammern von unten nach oben.';

-- ── 4. lade_behaelter liefert Tank und Kammer mit ───────────────────────────────────────────────────────────────────
-- Neue Spalten am Ende (RETURNS TABLE ändert sich → DROP + CREATE); der Partner einer Kellergemeinschaft sieht so den
-- Tank-Namen einer freigegebenen Kammer, ohne die Tabelle gebinde_tanks lesen zu dürfen.
DROP FUNCTION public.lade_behaelter(uuid);
CREATE FUNCTION public.lade_behaelter(p_tenant_id uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, name text, typ text, volumen_liter numeric, standort text, aktiv boolean, gemeinsam boolean, stapler boolean, notizen text, import_quelle text, eigentuemer_name text, fremd boolean, eigen_liter numeric, fremd_liter numeric, fremd_betrieb text, lp_pickerl text, material text, bezeichnung_lang text, tank_id uuid, kammer_nr smallint, tank_name text, tank_kammern integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id, b.tenant_id, b.name, b.typ, b.volumen_liter, b.standort, b.aktiv,
         b.gemeinsam, b.stapler, b.notizen, b.import_quelle,
         t.name AS eigentuemer_name,
         (b.tenant_id <> p_tenant_id) AS fremd,
         COALESCE((SELECT SUM(w.menge_liter) FROM weinausbau w
                   WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id = p_tenant_id), 0) AS eigen_liter,
         COALESCE((SELECT SUM(w.menge_liter) FROM weinausbau w
                   WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id <> p_tenant_id AND COALESCE(w.menge_liter, 0) > 0), 0) AS fremd_liter,
         (SELECT t2.name FROM weinausbau w JOIN tenants t2 ON t2.id = w.tenant_id
          WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id <> p_tenant_id AND COALESCE(w.menge_liter, 0) > 0
          ORDER BY w.updated_at DESC LIMIT 1) AS fremd_betrieb,
         b.lp_pickerl,
         b.material,
         b.bezeichnung_lang,
         /* KAN-466 */ b.tank_id, b.kammer_nr, gt.name AS tank_name,
         CASE WHEN b.tank_id IS NULL THEN NULL
              ELSE (SELECT count(*)::integer FROM behaelter k WHERE k.tank_id = b.tank_id) END AS tank_kammern
  FROM behaelter b
  JOIN tenants t ON t.id = b.tenant_id
  LEFT JOIN gebinde_tanks gt ON gt.id = b.tank_id
  WHERE (
          session_user = 'postgres'
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
          OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id) /* KAN-455 */ AND public.s112_darf_lesen(p_tenant_id, 'keller'))
        )
    AND (
          b.tenant_id = p_tenant_id
          OR (b.gemeinsam AND EXISTS (
                SELECT 1 FROM keller_freigaben f
                WHERE f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = p_tenant_id AND f.aktiv))
        )
  ORDER BY b.name
$function$;
REVOKE EXECUTE ON FUNCTION public.lade_behaelter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lade_behaelter(uuid) TO authenticated, service_role;

-- ── 5. Musterhof-Reset: Tanks abräumen, ein Demo-Tank mit drei Kammern ──────────────────────────────────────────────
-- Zwei Stellen der Funktion werden ersetzt (Vorlage KAN-380/KAN-395) – Prüfung auf genau einen Treffer je Stelle.
-- Demo-Tank „Stahltank 15“ (7.000 l): Kammern 15/1 (3.000 l), 15/2 und 15/3 (je 2.000 l), Gebinde Nr. 25–27, leer.
DO $m$
DECLARE
  c_alt1 constant text := E'  delete from behaelter where tenant_id = c_t;\n';
  c_neu1 constant text := E'  delete from behaelter where tenant_id = c_t;\n'
    || E'  delete from gebinde_tanks where tenant_id = c_t;   -- KAN-466\n';
  c_alt2 constant text := '  -- ── Jahrgänge';
  c_neu2 constant text := '  -- KAN-466: Tank mit drei Kammern (leer), Kammern als Gebinde 25–27 samt Kellerplan-Platz' || E'\n'
    || '  insert into gebinde_tanks (id, tenant_id, name, typ, material, standort, created_at)' || E'\n'
    || '  values (demo_musterhof_id(68, 1), c_t, ''Stahltank 15'', ''stahltank'', ''Edelstahl'', ''Tankhalle'', make_date(y1, 1, 1)::timestamptz);' || E'\n'
    || '  perform set_config(''s112.tank_frei'', ''1'', true);' || E'\n'
    || '  insert into behaelter (id, tenant_id, name, volumen_liter, aktiv, created_at, tank_id, kammer_nr)' || E'\n'
    || '  select demo_musterhof_id(10, k.nr), c_t, k.name, k.vol, true, make_date(y1, 1, 1)::timestamptz, demo_musterhof_id(68, 1), k.kammer from (values' || E'\n'
    || '    (25, ''Stahltank 15/1'', 3000, 1), (26, ''Stahltank 15/2'', 2000, 2), (27, ''Stahltank 15/3'', 2000, 3)' || E'\n'
    || '  ) as k(nr, name, vol, kammer);' || E'\n'
    || '  perform set_config(''s112.tank_frei'', '''', true);' || E'\n'
    || '  insert into kellerplan_positionen (tenant_id, kellerplan_id, behaelter_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct)' || E'\n'
    || '  select c_t, demo_musterhof_id(17,1), demo_musterhof_id(10, p.nr), p.x, 78, 9, 14 from (values (25, 58), (26, 70), (27, 82)) as p(nr, x);' || E'\n\n'
    || '  -- ── Jahrgänge';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt1, ''))) / length(c_alt1) <> 1 THEN
    RAISE EXCEPTION 'KAN-466: erwartet genau ein „delete from behaelter“ in demo_musterhof_zuruecksetzen';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_alt2, ''))) / length(c_alt2) <> 1 THEN
    RAISE EXCEPTION 'KAN-466: erwartet genau einen Abschnitt „Jahrgänge“ in demo_musterhof_zuruecksetzen';
  END IF;
  EXECUTE replace(replace(v_def, c_alt1, c_neu1), c_alt2, c_neu2);
END
$m$;

-- Selbstprüfung
DO $$
DECLARE v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF position('delete from gebinde_tanks where tenant_id = c_t' in v_def) = 0 OR position('KAN-466: Tank mit drei Kammern' in v_def) = 0 THEN
    RAISE EXCEPTION 'KAN-466: Tank fehlt in demo_musterhof_zuruecksetzen';
  END IF;
  IF has_table_privilege('anon', 'public.gebinde_tanks', 'SELECT') THEN
    RAISE EXCEPTION 'KAN-466: anon darf gebinde_tanks nicht lesen';
  END IF;
  IF has_function_privilege('anon', 'public.s112_tank_anlegen(uuid, text, text, text, text, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lade_behaelter(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-466: anon darf die Funktionen nicht ausführen';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
