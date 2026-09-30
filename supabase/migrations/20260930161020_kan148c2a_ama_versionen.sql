-- KAN-148 (Folgeticket C), Etappe C2: AMA-Erntemeldung – Status, Versionen, Positionen atomar
-- (Staging-Test zurückgerollt 30.09.2026, „OK, einspielen“ 30.09.2026)
--
-- Bisher: „Neu berechnen“ setzte status 'bereit', löschte die Positionen (still 0 Zeilen – ama_meldepositionen hat
-- keine DELETE-Policy → Dubletten) und fügte sie neu ein; „eingereicht“ konnte niemand setzen; UNIQUE (tenant_id,
-- jahrgang_id) ließ keine Korrekturmeldung zu. Neu:
--
--  1. ama_erntemeldungen: version (1, 2, …) und vorgaenger_id; UNIQUE (tenant_id, jahrgang_id, version) statt je
--     Jahrgang, höchstens EINE offene Version (entwurf/bereit) je Jahrgang (Teil-Index). Bestehende Meldungen: Version 1.
--  2. Schutz-Trigger a_ama_schutz (BEFORE INSERT/UPDATE/DELETE, nur API-Rollen): Status, Einreich-/Bestätigungsdatum,
--     Referenznummer, Version und Vorgänger ändert nur die RPC (Kennzeichen s112.ama_rpc); neu anlegen nur als
--     entwurf/bereit; eine eingereichte/bestätigte/abgelehnte Meldung ist unveränderlich und nicht löschbar.
--     ama_meldepositionen: a_ama_position_schutz – Positionen einer nicht offenen Meldung sind unveränderlich.
--     Service-Role/SQL-Editor (n8n, Wartung, Demo-Reset) bleiben frei.
--  3. s112_ama_meldung_speichern(p_tenant_id, p_jahrgang_id, p_kopf jsonb, p_positionen jsonb) → uuid: offene Version
--     des Jahrgangs anlegen bzw. aktualisieren (status 'bereit') und ihre Positionen in EINER Transaktion ersetzen.
--     Gibt es nur eine eingereichte Version, abgelehnt mit Hinweis auf die Korrekturmeldung.
--  4. s112_ama_status_setzen(p_tenant_id, p_meldung_id, p_status, p_datum, p_referenznr) → void: nur vorwärts
--     (bereit → eingereicht → bestätigt/abgelehnt), nur die neueste Version, Datum Pflicht (eingereicht_am bzw.
--     bestaetigt_am = Datum der AMA-Rückmeldung); „eingereicht“ führt weinjahrgaenge.ama_gemeldet/ama_meldedatum/ama_meldungsnr mit.
--  5. s112_ama_korrektur_anlegen(p_tenant_id, p_meldung_id) → uuid: ab „eingereicht“ neue Version (entwurf) mit
--     Kopie der Positionen; die Vorgängerin bleibt unverändert.
--  6. z_protokoll_aendern überwacht zusätzlich eingereicht_am, bestaetigt_am, ama_referenznr, version.
-- Alle RPCs: pruefe_tenant_zugriff (system_admin/tenant_admin/winzer), Abo-Schreibsperre, Schreibmodul Rieden (wie die
-- modul_*-Policies), REVOKE, search_path. Kein session_replication_role (KAN-124).

-- 1. Versionen ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ama_erntemeldungen
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vorgaenger_id uuid REFERENCES public.ama_erntemeldungen(id);
ALTER TABLE public.ama_erntemeldungen DROP CONSTRAINT IF EXISTS ama_erntemeldungen_version_check;
ALTER TABLE public.ama_erntemeldungen ADD CONSTRAINT ama_erntemeldungen_version_check CHECK (version >= 1);
ALTER TABLE public.ama_erntemeldungen DROP CONSTRAINT IF EXISTS ama_erntemeldungen_tenant_id_jahrgang_id_key;
ALTER TABLE public.ama_erntemeldungen DROP CONSTRAINT IF EXISTS ama_erntemeldungen_tenant_jahrgang_version_key;
ALTER TABLE public.ama_erntemeldungen ADD CONSTRAINT ama_erntemeldungen_tenant_jahrgang_version_key UNIQUE (tenant_id, jahrgang_id, version);
DROP INDEX IF EXISTS public.ama_erntemeldungen_eine_offene;
CREATE UNIQUE INDEX ama_erntemeldungen_eine_offene ON public.ama_erntemeldungen (tenant_id, jahrgang_id)
  WHERE status IN ('entwurf', 'bereit');
COMMENT ON COLUMN public.ama_erntemeldungen.version IS 'KAN-148 C2: Version der Meldung je Jahrgang (Korrektur = neue Version)';
COMMENT ON COLUMN public.ama_erntemeldungen.vorgaenger_id IS 'KAN-148 C2: korrigierte Vorgänger-Version';
COMMENT ON COLUMN public.ama_erntemeldungen.bestaetigt_am IS 'Datum der AMA-Rückmeldung (bestätigt bzw. abgelehnt, KAN-148 C2)';

-- 2. Schutz ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_rpc   boolean := coalesce(current_setting('s112.ama_rpc', true), '') = 'an';
BEGIN
  -- Wartung (Service-Role, n8n, SQL-Editor, Demo-Reset, Mandanten-Löschung) und die RPCs: frei
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_rpc THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('entwurf', 'bereit') OR NEW.eingereicht_am IS NOT NULL OR NEW.bestaetigt_am IS NOT NULL
       OR NEW.ama_referenznr IS NOT NULL OR NEW.version <> 1 OR NEW.vorgaenger_id IS NOT NULL THEN
      RAISE EXCEPTION 'Eine AMA-Erntemeldung wird als Entwurf angelegt; Einreichen, Rückmeldung und Korrekturen laufen über „Status setzen“ bzw. „Korrekturmeldung“ (KAN-148).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('entwurf', 'bereit') THEN
    RAISE EXCEPTION 'Die AMA-Erntemeldung ist bereits % – sie bleibt unverändert; Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status NOT IN ('entwurf', 'bereit')
     OR NEW.eingereicht_am IS DISTINCT FROM OLD.eingereicht_am OR NEW.bestaetigt_am IS DISTINCT FROM OLD.bestaetigt_am
     OR NEW.ama_referenznr IS DISTINCT FROM OLD.ama_referenznr OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.vorgaenger_id IS DISTINCT FROM OLD.vorgaenger_id
     OR NEW.jahrgang_id IS DISTINCT FROM OLD.jahrgang_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Status, Einreich- und Rückmeldedatum, Referenznummer und Version ändert nur „Status setzen“ bzw. „Korrekturmeldung“ (KAN-148).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_schutz() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_ama_schutz ON public.ama_erntemeldungen;
CREATE TRIGGER a_ama_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.ama_erntemeldungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ama_schutz();

CREATE OR REPLACE FUNCTION public.s112_ama_position_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle  text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_status text;
BEGIN
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT m.status INTO v_status FROM public.ama_erntemeldungen m
   WHERE m.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.meldung_id ELSE NEW.meldung_id END;
  IF v_status IS NOT NULL AND v_status NOT IN ('entwurf', 'bereit') THEN
    RAISE EXCEPTION 'Die AMA-Erntemeldung ist bereits % – ihre Positionen bleiben unverändert.', v_status USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.meldung_id IS DISTINCT FROM OLD.meldung_id THEN
    RAISE EXCEPTION 'Eine Position kann nicht in eine andere Meldung verschoben werden.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_position_schutz() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_ama_position_schutz ON public.ama_meldepositionen;
CREATE TRIGGER a_ama_position_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.ama_meldepositionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ama_position_schutz();

-- 3. Meldung speichern (offene Version, Positionen atomar) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_meldung_speichern(p_tenant_id uuid, p_jahrgang_id uuid, p_kopf jsonb, p_positionen jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id      uuid;
  v_version integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weinjahrgaenge j WHERE j.id = p_jahrgang_id AND j.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Jahrgang nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(coalesce(p_positionen, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Ungültige Positionen.' USING ERRCODE = '22023';
  END IF;
  -- Jahrgang sperren: kein paralleles Anlegen einer zweiten offenen Version
  PERFORM 1 FROM public.weinjahrgaenge j WHERE j.id = p_jahrgang_id FOR UPDATE;
  PERFORM set_config('s112.ama_rpc', 'an', true);

  SELECT m.id INTO v_id FROM public.ama_erntemeldungen m
   WHERE m.tenant_id = p_tenant_id AND m.jahrgang_id = p_jahrgang_id AND m.status IN ('entwurf', 'bereit');
  IF v_id IS NULL THEN
    SELECT max(m.version) INTO v_version FROM public.ama_erntemeldungen m
     WHERE m.tenant_id = p_tenant_id AND m.jahrgang_id = p_jahrgang_id;
    IF v_version IS NOT NULL THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung dieses Jahrgangs ist bereits eingereicht – für Änderungen bitte eine Korrekturmeldung anlegen.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.ama_erntemeldungen (tenant_id, jahrgang_id, status, version)
    VALUES (p_tenant_id, p_jahrgang_id, 'entwurf', 1) RETURNING id INTO v_id;
  END IF;

  UPDATE public.ama_erntemeldungen SET
    betriebsnummer = NULLIF(p_kopf ->> 'betriebsnummer', ''),
    weinbaugebiet  = NULLIF(p_kopf ->> 'weinbaugebiet', ''),
    gesamtmenge_kg = NULLIF(p_kopf ->> 'gesamtmenge_kg', '')::numeric,
    gesamtmenge_hl = NULLIF(p_kopf ->> 'gesamtmenge_hl', '')::numeric,
    status         = 'bereit'
   WHERE id = v_id;

  DELETE FROM public.ama_meldepositionen WHERE meldung_id = v_id;
  INSERT INTO public.ama_meldepositionen (meldung_id, rebsorte_name, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe)
  SELECT v_id, NULLIF(z ->> 'rebsorte_name', ''), NULLIF(z ->> 'flaeche_ha', '')::numeric, NULLIF(z ->> 'menge_kg', '')::numeric,
         NULLIF(z ->> 'menge_hl', '')::numeric, NULLIF(z ->> 'qualitaetsstufe', '')
    FROM jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) z;

  PERFORM set_config('s112.ama_rpc', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_meldung_speichern(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;

-- 4. Status setzen (nur vorwärts, neueste Version) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_status_setzen(p_tenant_id uuid, p_meldung_id uuid, p_status text, p_datum date, p_referenznr text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('eingereicht', 'bestaetigt', 'abgelehnt') THEN
    RAISE EXCEPTION 'Unbekannter Status „%“.', coalesce(p_status, '–') USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte das Datum angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_datum > current_date THEN
    RAISE EXCEPTION 'Das Datum liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  SELECT m.* INTO v_m FROM public.ama_erntemeldungen m WHERE m.id = p_meldung_id AND m.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMA-Erntemeldung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ama_erntemeldungen x WHERE x.tenant_id = p_tenant_id AND x.jahrgang_id = v_m.jahrgang_id AND x.version > v_m.version) THEN
    RAISE EXCEPTION 'Das ist nicht die neueste Version der Meldung – bitte die Seite neu laden.' USING ERRCODE = '42501';
  END IF;
  IF NOT ((v_m.status = 'bereit' AND p_status = 'eingereicht')
          OR (v_m.status = 'eingereicht' AND p_status IN ('bestaetigt', 'abgelehnt'))) THEN
    RAISE EXCEPTION 'Der Status kann nur vorwärts gesetzt werden (bereit → eingereicht → bestätigt/abgelehnt), nicht von „%“ auf „%“.', v_m.status, p_status
      USING ERRCODE = '42501';
  END IF;
  IF p_status <> 'eingereicht' AND p_datum < v_m.eingereicht_am::date THEN
    RAISE EXCEPTION 'Die Rückmeldung kann nicht vor dem Einreichen (%) liegen.', to_char(v_m.eingereicht_am, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('s112.ama_rpc', 'an', true);
  IF p_status = 'eingereicht' THEN
    UPDATE public.ama_erntemeldungen SET status = 'eingereicht', eingereicht_am = p_datum,
           ama_referenznr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_referenznr)
     WHERE id = p_meldung_id;
    UPDATE public.weinjahrgaenge SET ama_gemeldet = true, ama_meldedatum = p_datum,
           ama_meldungsnr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_meldungsnr)
     WHERE id = v_m.jahrgang_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.ama_erntemeldungen SET status = p_status, bestaetigt_am = p_datum,
           ama_referenznr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_referenznr)
     WHERE id = p_meldung_id;
  END IF;
  PERFORM set_config('s112.ama_rpc', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_status_setzen(uuid, uuid, text, date, text) FROM PUBLIC, anon;

-- 5. Korrekturmeldung (neue Version) ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_korrektur_anlegen(p_tenant_id uuid, p_meldung_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m  record;
  v_id uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_m FROM public.ama_erntemeldungen m WHERE m.id = p_meldung_id AND m.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMA-Erntemeldung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_m.status IN ('entwurf', 'bereit') THEN
    RAISE EXCEPTION 'Die Meldung ist noch nicht eingereicht – sie kann direkt neu berechnet werden.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ama_erntemeldungen x WHERE x.tenant_id = p_tenant_id AND x.jahrgang_id = v_m.jahrgang_id AND x.version > v_m.version) THEN
    RAISE EXCEPTION 'Es gibt bereits eine neuere Version dieser Meldung – bitte die Seite neu laden.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('s112.ama_rpc', 'an', true);
  INSERT INTO public.ama_erntemeldungen (tenant_id, jahrgang_id, betriebsnummer, weinbaugebiet, status, gesamtmenge_kg, gesamtmenge_hl,
                                         version, vorgaenger_id, notizen)
  VALUES (p_tenant_id, v_m.jahrgang_id, v_m.betriebsnummer, v_m.weinbaugebiet, 'entwurf', v_m.gesamtmenge_kg, v_m.gesamtmenge_hl,
          v_m.version + 1, v_m.id, v_m.notizen)
  RETURNING id INTO v_id;
  INSERT INTO public.ama_meldepositionen (meldung_id, rebsorte_id, rebsorte_name, weingarten_name, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe, oechsle)
  SELECT v_id, p.rebsorte_id, p.rebsorte_name, p.weingarten_name, p.flaeche_ha, p.menge_kg, p.menge_hl, p.qualitaetsstufe, p.oechsle
    FROM public.ama_meldepositionen p WHERE p.meldung_id = v_m.id;
  PERFORM set_config('s112.ama_rpc', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_korrektur_anlegen(uuid, uuid) FROM PUBLIC, anon;

-- 6. Änderungsprotokoll ──────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.ama_erntemeldungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF status, gesamtmenge_kg, gesamtmenge_hl, jahrgang_id, tenant_id,
  eingereicht_am, bestaetigt_am, ama_referenznr, version ON public.ama_erntemeldungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('status', 'gesamtmenge_kg', 'gesamtmenge_hl', 'jahrgang_id',
  'tenant_id', 'eingereicht_am', 'bestaetigt_am', 'ama_referenznr', 'version');

-- Selbstprüfung
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ama_erntemeldungen_tenant_id_jahrgang_id_key')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ama_erntemeldungen_eine_offene') THEN
    RAISE EXCEPTION 'KAN-148 C2: Eindeutigkeit falsch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_ama_schutz' AND tgrelid = 'public.ama_erntemeldungen'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_ama_position_schutz' AND tgrelid = 'public.ama_meldepositionen'::regclass) THEN
    RAISE EXCEPTION 'KAN-148 C2: Schutz-Trigger fehlen';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_ama_schutz()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_ama_position_schutz()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_ama_meldung_speichern(uuid, uuid, jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_ama_status_setzen(uuid, uuid, text, date, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_ama_korrektur_anlegen(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-148 C2: EXECUTE-Rechte falsch';
  END IF;
END $$;
