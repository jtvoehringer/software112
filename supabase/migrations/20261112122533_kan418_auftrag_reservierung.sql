-- KAN-418 Teil 1 (12.11.2026): Auftrag mit Bestandsreservierung.
--
-- Ein Auftrag reserviert Flaschen einer Füllung: Der Lagerbestand bleibt, der VERFÜGBARE Bestand sinkt
-- (verfügbar = Bestand − reserviert). Ein Verkauf darf nicht in fremde Reservierungen hineinverkaufen.
-- Entscheidungen Jörgen (11./12.11.2026, Ticket): Reservierung mit Ablaufdatum (Standard 14 Tage); eine abgelaufene
-- Reservierung bleibt bestehen, bis jemand verlängert oder storniert (Dashboardhinweis, Teil 5); Preise entstehen erst
-- bei der Lieferung (Teil 3) – der Auftrag kennt nur Mengen. Angebot (art = 'angebot', ohne Reservierung) folgt in Teil 4.
--
-- 1. auftraege, auftrag_positionen (nur lesbar für Mitglieder; geschrieben wird über die RPCs, Frist und Notiz direkt).
-- 2. Nummernkreis AB-JJJJ-NNNN (tenant_einstellungen.auftrag_*, s112_auftragsnummer_ziehen mit s112_nummer_text).
-- 3. s112_fuellung_reserviert, s112_auftrag_anlegen, s112_auftrag_stornieren.
-- 4. s112_fuellung_verkauf_buchen lehnt Abgänge ab, die den verfügbaren Bestand unterschreiten (HINT reserviert).
-- 5. Bezugsliste (Kontakt/Firma mit Auftrag nur deaktivieren), Demo-Reset räumt Aufträge mit ab.

-- ── 1. Tabellen ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.auftraege (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  art              text NOT NULL DEFAULT 'auftrag' CONSTRAINT auftraege_art_chk CHECK (art IN ('auftrag', 'angebot')),
  nummer           text NOT NULL CONSTRAINT auftraege_nummer_chk CHECK (char_length(nummer) BETWEEN 3 AND 40),
  datum            date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Vienna'))::date,
  kontakt_id       uuid REFERENCES public.kontakte(id),
  firma_id         uuid REFERENCES public.firmen(id),
  status           text NOT NULL DEFAULT 'offen' CONSTRAINT auftraege_status_chk CHECK (status IN ('offen', 'teilgeliefert', 'geliefert', 'storniert')),
  reserviert_bis   date,
  notizen          text CONSTRAINT auftraege_notizen_chk CHECK (notizen IS NULL OR char_length(notizen) <= 2000),
  erstellt_am      timestamptz NOT NULL DEFAULT now(),
  erstellt_von     uuid DEFAULT auth.uid(),
  aktualisiert_am  timestamptz NOT NULL DEFAULT now(),
  storniert_am     timestamptz,
  storniert_von    uuid,
  storno_grund     text CONSTRAINT auftraege_storno_grund_chk CHECK (storno_grund IS NULL OR char_length(storno_grund) <= 500),
  CONSTRAINT auftraege_ein_kunde CHECK (kontakt_id IS NOT NULL OR firma_id IS NOT NULL),
  CONSTRAINT auftraege_storno_chk CHECK ((status = 'storniert') = (storniert_am IS NOT NULL)),
  CONSTRAINT auftraege_nummer_key UNIQUE (tenant_id, nummer)
);
CREATE INDEX auftraege_tenant_idx ON public.auftraege (tenant_id, datum DESC);
CREATE INDEX auftraege_kontakt_idx ON public.auftraege (kontakt_id);
CREATE INDEX auftraege_firma_idx ON public.auftraege (firma_id);
COMMENT ON TABLE public.auftraege IS
  'KAN-418: Aufträge (und später Angebote). Ein offener Auftrag reserviert die Flaschen seiner Positionen; geschrieben über s112_auftrag_anlegen/_stornieren.';

CREATE TABLE public.auftrag_positionen (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  auftrag_id   uuid NOT NULL REFERENCES public.auftraege(id) ON DELETE CASCADE,
  fuellung_id  uuid NOT NULL REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  name         text NOT NULL CONSTRAINT auftrag_positionen_name_chk CHECK (char_length(name) BETWEEN 1 AND 300),
  menge        integer NOT NULL CONSTRAINT auftrag_positionen_menge_chk CHECK (menge BETWEEN 1 AND 1000000),
  geliefert    integer NOT NULL DEFAULT 0,
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auftrag_positionen_geliefert_chk CHECK (geliefert BETWEEN 0 AND menge)
);
CREATE INDEX auftrag_positionen_tenant_idx ON public.auftrag_positionen (tenant_id);
CREATE INDEX auftrag_positionen_auftrag_idx ON public.auftrag_positionen (auftrag_id);
CREATE INDEX auftrag_positionen_fuellung_idx ON public.auftrag_positionen (fuellung_id);
COMMENT ON TABLE public.auftrag_positionen IS
  'KAN-418: Positionen eines Auftrags – Füllung und Flaschen. Reserviert sind menge − geliefert, solange der Auftrag offen ist.';

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auftraege', 'auftrag_positionen'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT public.s112_meine_tenants()))', t || '_select', t);
    EXECUTE format('CREATE POLICY mitgliedschaft_aktiv ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY abo_schreibsperre_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY abo_schreibsperre_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY abo_schreibsperre_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY zwei_faktor_aal ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()))', t);
  END LOOP;
END
$rls$;

-- Frist und Notiz eines Auftrags ändert der Benutzer direkt (alles andere über die RPCs, siehe Schutz-Trigger)
CREATE POLICY auftraege_update ON public.auftraege FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_update ON public.auftraege AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));

-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.auftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.auftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_auftrag_id BEFORE INSERT OR UPDATE OF auftrag_id, tenant_id ON public.auftrag_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('auftrag_id', 'auftraege', '', '', '');
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.auftrag_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');

-- Schutz: direkt änderbar sind nur Frist und Notiz eines nicht stornierten Auftrags
CREATE FUNCTION public.s112_auftrag_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('s112.auftrag_frei', true), '') = 'ja' OR coalesce(public.s112_wartung_frei(OLD.tenant_id), false) THEN
    RETURN NEW;
  END IF;
  IF OLD.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Auftrag % ist storniert und lässt sich nicht mehr ändern.', OLD.nummer USING ERRCODE = '42501', HINT = 'auftrag_storniert';
  END IF;
  IF (to_jsonb(NEW) - 'reserviert_bis' - 'notizen' - 'aktualisiert_am') IS DISTINCT FROM (to_jsonb(OLD) - 'reserviert_bis' - 'notizen' - 'aktualisiert_am') THEN
    RAISE EXCEPTION 'Am Auftrag % lassen sich nur die Reservierungsfrist und die Notiz ändern – sonst bitte stornieren und neu erfassen.', OLD.nummer
      USING ERRCODE = '42501', HINT = 'auftrag_gesperrt';
  END IF;
  NEW.aktualisiert_am := now();
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_auftrag_schutz BEFORE UPDATE ON public.auftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_auftrag_schutz();

-- ── 2. Nummernkreis ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN auftrag_prefix  text NOT NULL DEFAULT 'AB' CHECK (char_length(auftrag_prefix) BETWEEN 1 AND 10),
  ADD COLUMN auftrag_stellen integer NOT NULL DEFAULT 4 CHECK (auftrag_stellen BETWEEN 1 AND 8),
  ADD COLUMN auftrag_zaehler integer NOT NULL DEFAULT 1 CHECK (auftrag_zaehler >= 1);

CREATE FUNCTION public.s112_auftragsnummer_ziehen(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix  text;
  v_stellen integer;
  v_nummer  integer;
BEGIN
  SELECT auftrag_prefix, auftrag_stellen, auftrag_zaehler INTO v_prefix, v_stellen, v_nummer
    FROM public.tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Für diesen Betrieb fehlen die Einstellungen (Nummernkreis Auftrag).' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.tenant_einstellungen SET auftrag_zaehler = v_nummer + 1 WHERE tenant_id = p_tenant_id;
  RETURN v_prefix || '-' || to_char((now() AT TIME ZONE 'Europe/Vienna')::date, 'YYYY') || '-' || public.s112_nummer_text(v_nummer, v_stellen);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftragsnummer_ziehen(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Reservierung ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Reservierte Flaschen einer Füllung: offene Mengen aller nicht stornierten, noch nicht ganz gelieferten Aufträge.
-- Das Ablaufdatum gibt nichts frei (Entscheidung: Dashboardhinweis statt stillem Wegfall).
CREATE FUNCTION public.s112_fuellung_reserviert(p_fuellung_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(p.menge - p.geliefert), 0)::integer
    FROM public.auftrag_positionen p
    JOIN public.auftraege a ON a.id = p.auftrag_id
   WHERE p.fuellung_id = p_fuellung_id
     AND a.art = 'auftrag' AND a.status IN ('offen', 'teilgeliefert') AND a.storniert_am IS NULL
$$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_reserviert(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.s112_auftrag_anlegen(p_tenant_id uuid, p_kopf jsonb, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_heute    date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_kontakt  uuid := NULLIF(p_kopf ->> 'kontakt_id', '')::uuid;
  v_firma    uuid := NULLIF(p_kopf ->> 'firma_id', '')::uuid;
  v_datum    date := COALESCE(NULLIF(p_kopf ->> 'datum', '')::date, v_heute);
  v_bis      date := COALESCE(NULLIF(p_kopf ->> 'reserviert_bis', '')::date, v_datum + 14);
  v_notizen  text := NULLIF(btrim(COALESCE(p_kopf ->> 'notizen', '')), '');
  v_id       uuid;
  v_nummer   text;
  v_z        record;
  v_f        record;
  v_res      integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF v_kontakt IS NULL AND v_firma IS NULL THEN
    RAISE EXCEPTION 'Bitte einen Kunden wählen.' USING ERRCODE = '23514';
  END IF;
  IF v_kontakt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.kontakte k WHERE k.id = v_kontakt AND k.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Kontakt nicht gefunden.' USING ERRCODE = '23503';
  END IF;
  IF v_firma IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = v_firma AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Firma nicht gefunden.' USING ERRCODE = '23503';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Auftragsdatum darf nicht in der Zukunft liegen.' USING ERRCODE = '23514';
  END IF;
  IF v_bis < v_heute THEN
    RAISE EXCEPTION 'Die Reservierung muss mindestens bis heute gelten.' USING ERRCODE = '23514';
  END IF;
  IF p_positionen IS NULL OR jsonb_typeof(p_positionen) <> 'array' OR jsonb_array_length(p_positionen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Position angeben.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_positionen) > 100 THEN
    RAISE EXCEPTION 'Höchstens 100 Positionen je Auftrag.' USING ERRCODE = '23514';
  END IF;

  -- je Füllung die Summe der Positionen; Füllungen in fester Reihenfolge sperren (kein Deadlock zweier Aufträge)
  FOR v_z IN
    SELECT (e ->> 'fuellung_id')::uuid AS fuellung_id, SUM((e ->> 'menge')::integer) AS menge, bool_or((e ->> 'menge')::integer < 1) AS ungueltig
      FROM jsonb_array_elements(p_positionen) e
     GROUP BY 1 ORDER BY 1
  LOOP
    IF v_z.fuellung_id IS NULL OR v_z.ungueltig THEN
      RAISE EXCEPTION 'Bitte je Position eine Füllung und eine Menge ab 1 Flasche angeben.' USING ERRCODE = '23514';
    END IF;
    SELECT f.id, f.name, f.jahrgang, COALESCE(f.bestand_flaschen, 0) AS bestand, f.aktiv, f.storniert_am INTO v_f
      FROM public.fuellungen f WHERE f.id = v_z.fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND OR v_f.storniert_am IS NOT NULL THEN
      RAISE EXCEPTION 'Füllung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = '23503';
    END IF;
    v_res := public.s112_fuellung_reserviert(v_z.fuellung_id);
    IF v_z.menge > v_f.bestand - v_res THEN
      RAISE EXCEPTION '„%“: nur noch % Flaschen verfügbar (Bestand %, reserviert %), % angefragt.',
        v_f.name, GREATEST(v_f.bestand - v_res, 0), v_f.bestand, v_res, v_z.menge
        USING ERRCODE = '22023', HINT = 'reserviert';
    END IF;
  END LOOP;

  v_nummer := public.s112_auftragsnummer_ziehen(p_tenant_id);
  INSERT INTO public.auftraege (tenant_id, art, nummer, datum, kontakt_id, firma_id, status, reserviert_bis, notizen, erstellt_von)
  VALUES (p_tenant_id, 'auftrag', v_nummer, v_datum, v_kontakt, v_firma, 'offen', v_bis, v_notizen, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  INSERT INTO public.auftrag_positionen (tenant_id, auftrag_id, fuellung_id, name, menge)
  SELECT p_tenant_id, v_id, f.id, left(concat_ws(' ', f.name, f.jahrgang::text), 300), (e ->> 'menge')::integer
    FROM jsonb_array_elements(p_positionen) WITH ORDINALITY AS x(e, nr)
    JOIN public.fuellungen f ON f.id = (e ->> 'fuellung_id')::uuid AND f.tenant_id = p_tenant_id
   ORDER BY nr;

  RETURN jsonb_build_object('id', v_id, 'nummer', v_nummer, 'reserviert_bis', v_bis);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_anlegen(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_anlegen(uuid, jsonb, jsonb) TO authenticated, service_role;

CREATE FUNCTION public.s112_auftrag_stornieren(p_tenant_id uuid, p_auftrag_id uuid, p_grund text)
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
  IF v_a.status = 'geliefert' THEN
    RAISE EXCEPTION 'Der Auftrag % ist vollständig geliefert – bitte den Verkauf stornieren.', v_a.nummer USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege
     SET status = 'storniert', storniert_am = now(), storniert_von = (SELECT auth.uid()), storno_grund = left(v_grund, 500), aktualisiert_am = now()
   WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.auftrag_frei', '', true);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_stornieren(uuid, uuid, text) TO authenticated, service_role;

-- ── 4./5. Bestehende Funktionen ergänzen (je genau eine Stelle, sonst Abbruch) ──────────────────────────────────────
DO $kan418$
DECLARE
  v_def text;
  r record;
BEGIN
  -- 4. Verkauf: nicht in Reservierungen hineinverkaufen
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_fuellung_verkauf_buchen';
  IF (length(v_def) - length(replace(v_def, '  IF v_neu > 2147483647 THEN', ''))) / length('  IF v_neu > 2147483647 THEN') <> 1 THEN
    RAISE EXCEPTION 'KAN-418: s112_fuellung_verkauf_buchen – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, '  IF v_neu > 2147483647 THEN',
    '  -- KAN-418: reservierte Flaschen (offene Aufträge) bleiben stehen
  IF p_menge_stk < 0 AND v_neu < public.s112_fuellung_reserviert(p_fuellung_id) THEN
    RAISE EXCEPTION ''„%“: nur noch % Flaschen verfügbar (Bestand %, davon % für Aufträge reserviert), % angefragt.'',
      COALESCE(v_name, ''Füllung''), GREATEST(v_alt - public.s112_fuellung_reserviert(p_fuellung_id), 0), v_alt,
      public.s112_fuellung_reserviert(p_fuellung_id), -p_menge_stk
      USING ERRCODE = ''22023'', HINT = ''reserviert'';
  END IF;
  IF v_neu > 2147483647 THEN');

  -- 5a. Bezugsliste: Kontakt bzw. Firma mit Auftrag nur deaktivieren
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_stammdaten_bezuege_intern';
  FOR r IN SELECT * FROM (VALUES
      ('''Traubenverkäufe'', (SELECT count(*) FROM public.traubenverkauf t WHERE t.kontakt_id = p_id));',
       '''Traubenverkäufe'', (SELECT count(*) FROM public.traubenverkauf t WHERE t.kontakt_id = p_id),
        ''Aufträge'', (SELECT count(*) FROM public.auftraege a WHERE a.kontakt_id = p_id));'),
      ('''Traubenverkäufe'', (SELECT count(*) FROM public.traubenverkauf t WHERE t.firma_id = p_id));',
       '''Traubenverkäufe'', (SELECT count(*) FROM public.traubenverkauf t WHERE t.firma_id = p_id),
        ''Aufträge'', (SELECT count(*) FROM public.auftraege a WHERE a.firma_id = p_id));')) AS x(alt, neu)
  LOOP
    IF (length(v_def) - length(replace(v_def, r.alt, ''))) / length(r.alt) <> 1 THEN
      RAISE EXCEPTION 'KAN-418: s112_stammdaten_bezuege_intern – Stelle nicht genau einmal gefunden: %', left(r.alt, 60);
    END IF;
    v_def := replace(v_def, r.alt, r.neu);
  END LOOP;
  EXECUTE v_def;

  -- 5b. Demo-Reset: Aufträge des Musterhofs zuerst abräumen (Positionen per Kaskade) – sonst hält der Verweis auf
  --     Kontakt/Firma den Reset auf, sobald in der Demo ein Auftrag erfasst wurde (wie KAN-380). Gleich nach dem
  --     Abschalten des Protokolls, also vor allen anderen Löschungen.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'demo_musterhof_zuruecksetzen';
  IF (length(v_def) - length(replace(v_def, 'PERFORM set_config(''s112.protokoll_aus'', c_t::text, true);', ''))) / length('PERFORM set_config(''s112.protokoll_aus'', c_t::text, true);') <> 1 THEN
    RAISE EXCEPTION 'KAN-418: demo_musterhof_zuruecksetzen – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, 'PERFORM set_config(''s112.protokoll_aus'', c_t::text, true);',
    'PERFORM set_config(''s112.protokoll_aus'', c_t::text, true);
  delete from auftraege where tenant_id = c_t;   -- KAN-418: vor Kontakten, Firmen und Füllungen
  update tenant_einstellungen set auftrag_zaehler = 1 where tenant_id = c_t;');
END
$kan418$;
