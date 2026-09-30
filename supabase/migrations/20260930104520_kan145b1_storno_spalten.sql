-- KAN-145 Block B, Etappe 1: Storno-Kennzeichen im Kellerbuch – ENTWURF, erst nach „OK, einspielen“, zuerst Staging
--
-- Stornierte Buchungen bleiben stehen (BKI, 26.09.2026). Diese Migration legt nur die Spalten und ihren Schutz an; die
-- App storniert ab Etappe 2 mit Kennzeichen statt zu löschen, die Löschsperre (Block A) wird erst danach je Tabelle
-- scharf geschaltet. Rein additiv – die heutige App merkt nichts davon.
--
--  1. storniert_am, storniert_von, storniert_von_name, storno_grund an keller_umzuege, verschneidungen,
--     keller_behandlungen, fuellungen, zukauf_posten. storniert_von ohne FK (ein gelöschter Benutzer darf den Storno
--     nicht leeren, ON DELETE SET NULL wie bei konto_umbuchungen.erstellt_von), dazu der Name als Momentaufnahme.
--     CHECK: Grund mindestens 10 Zeichen, sobald storniert; Grund/Benutzer nie ohne Storno-Zeitpunkt.
--  2. verschneidungen.ziel_rebsorte_vorher – Rebsorte der Ziel-Charge vor dem Verschnitt (Storno stellt sie wieder her;
--     Qualität, Herkunft und Mostgewicht haben schon Momentaufnahmen).
--  3. s112_storno_schutz() – BEFORE INSERT/UPDATE je Tabelle, für die API-Rollen (authenticated/anon):
--       * INSERT: nur ohne Storno-Spalten (eine Buchung wird nicht storniert angelegt)
--       * Stornieren (storniert_am NULL → gesetzt): Zeitpunkt, Benutzer und Name setzt die Datenbank (auth.uid(),
--         profiles bzw. E-Mail) – nicht fälschbar; Grund Pflicht (CHECK)
--       * stornierte Zeile: unveränderlich (auch kein „Entstornieren“), 42501
--     Service-Role/SQL-Editor bleiben frei (Wartung, Demo-Reset, Mandanten-Löschung).
--  4. Bestandsprotokoll: z_protokoll_aendern überwacht zusätzlich storniert_am und storno_grund (Storno erscheint im
--     Änderungsprotokoll mit Benutzer).
-- Kein session_replication_role (KAN-124). Keine Daten betroffen: alle neuen Spalten NULL.

-- 1./2. Spalten ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['keller_umzuege', 'verschneidungen', 'keller_behandlungen', 'fuellungen', 'zukauf_posten'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS storniert_am timestamptz,
      ADD COLUMN IF NOT EXISTS storniert_von uuid,
      ADD COLUMN IF NOT EXISTS storniert_von_name text,
      ADD COLUMN IF NOT EXISTS storno_grund text', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_storno_chk');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (storniert_am IS NULL AND storniert_von IS NULL AND storniert_von_name IS NULL AND storno_grund IS NULL)
      OR (storniert_am IS NOT NULL AND length(btrim(coalesce(storno_grund, ''''))) >= 10))', t, t || '_storno_chk');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_am IS %L', t,
      'KAN-145: Zeitpunkt des Stornos (Buchung bleibt stehen, zählt in keinem Bestand); setzt s112_storno_schutz');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von IS %L', t, 'KAN-145: Benutzer (auth.uid(), ohne FK)');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von_name IS %L', t, 'KAN-145: Name des Benutzers als Momentaufnahme');
    EXECUTE format('COMMENT ON COLUMN public.%I.storno_grund IS %L', t, 'KAN-145: Grund des Stornos (mind. 10 Zeichen)');
  END LOOP;
END $$;

ALTER TABLE public.verschneidungen ADD COLUMN IF NOT EXISTS ziel_rebsorte_vorher text;
COMMENT ON COLUMN public.verschneidungen.ziel_rebsorte_vorher IS
  'KAN-145: Rebsorte der Ziel-Charge vor dem Verschnitt (Storno stellt sie wieder her)';

-- 3. Schutz der Storno-Spalten ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_storno_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_uid   uuid := auth.uid();
  v_name  text;
  v_neu   jsonb := to_jsonb(NEW);
  v_alt   jsonb;
BEGIN
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset, Mandanten-Löschung): frei
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_neu ->> 'storniert_am' IS NOT NULL OR v_neu ->> 'storniert_von' IS NOT NULL
       OR v_neu ->> 'storniert_von_name' IS NOT NULL OR v_neu ->> 'storno_grund' IS NOT NULL THEN
      RAISE EXCEPTION 'Eine Buchung kann nicht storniert angelegt werden (KAN-145).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_alt := to_jsonb(OLD);
  -- Stornierte Buchung: unveränderlich (auch kein Entstornieren)
  IF v_alt ->> 'storniert_am' IS NOT NULL THEN
    IF v_neu IS DISTINCT FROM v_alt THEN
      RAISE EXCEPTION 'Die Buchung in „%“ ist storniert und kann nicht mehr geändert werden (KAN-145).', TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Stornieren: Zeitpunkt, Benutzer und Name setzt die Datenbank
  IF v_neu ->> 'storniert_am' IS NOT NULL THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Stornieren nur als angemeldeter Benutzer (KAN-145).' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
      INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    IF v_name IS NULL THEN
      SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'storniert_am', now(), 'storniert_von', v_uid, 'storniert_von_name', v_name,
      'storno_grund', NULLIF(btrim(v_neu ->> 'storno_grund'), '')));
    RETURN NEW;
  END IF;

  -- Nicht storniert: Benutzer und Grund nicht ohne Storno setzen
  IF v_neu ->> 'storniert_von' IS NOT NULL OR v_neu ->> 'storniert_von_name' IS NOT NULL OR v_neu ->> 'storno_grund' IS NOT NULL THEN
    RAISE EXCEPTION 'Storno-Angaben nur zusammen mit dem Stornieren (KAN-145).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_storno_schutz() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['keller_umzuege', 'verschneidungen', 'keller_behandlungen', 'fuellungen', 'zukauf_posten'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_storno_schutz ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_storno_schutz BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.s112_storno_schutz()', t);
  END LOOP;
END $$;

-- 4. Änderungsprotokoll überwacht den Storno ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.keller_umzuege;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF datum, menge_liter, schwund_liter, brutto_liter, von_weinausbau_id,
  nach_weinausbau_id, von_behaelter_id, nach_behaelter_id, umzug_typ, zeilen_typ, umzug_batch_id, tenant_id,
  storniert_am, storno_grund ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('datum', 'menge_liter', 'schwund_liter', 'brutto_liter',
  'von_weinausbau_id', 'nach_weinausbau_id', 'von_behaelter_id', 'nach_behaelter_id', 'umzug_typ', 'zeilen_typ',
  'umzug_batch_id', 'tenant_id', 'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.verschneidungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF datum, ziel_weinausbau_id, tenant_id, storniert_am, storno_grund
  ON public.verschneidungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('datum', 'ziel_weinausbau_id', 'tenant_id',
  'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.keller_behandlungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF datum, menge, einheit, volumen_liter_ist, typ_id, weinausbau_id,
  behaelter_id, tenant_id, storniert_am, storno_grund ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('datum', 'menge', 'einheit', 'volumen_liter_ist',
  'typ_id', 'weinausbau_id', 'behaelter_id', 'tenant_id', 'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.fuellungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF bestand_flaschen, anzahl_flaschen, menge_liter_gefuellt,
  flaschengroesse_ml, aktiv, weinausbau_id, datum, qualitaet, jahrgang, rebsorte, herkunft_code, pruefnummer,
  anbaugebiet, tenant_id, storniert_am, storno_grund ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('bestand_flaschen', 'anzahl_flaschen',
  'menge_liter_gefuellt', 'flaschengroesse_ml', 'aktiv', 'weinausbau_id', 'datum', 'qualitaet', 'jahrgang', 'rebsorte',
  'herkunft_code', 'pruefnummer', 'anbaugebiet', 'tenant_id', 'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.zukauf_posten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge, einheit, art, aktiv, ziel_weinausbau_id, datum, tenant_id,
  kmw, oechsle, mostgewicht_einheit, storniert_am, storno_grund ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge', 'einheit', 'art', 'aktiv',
  'ziel_weinausbau_id', 'datum', 'tenant_id', 'kmw', 'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund');

-- Selbstprüfung
DO $$
DECLARE t text; v_n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['keller_umzuege', 'verschneidungen', 'keller_behandlungen', 'fuellungen', 'zukauf_posten'] LOOP
    SELECT count(*) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name IN ('storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund');
    IF v_n <> 4 THEN RAISE EXCEPTION 'KAN-145 B1: Storno-Spalten an % unvollständig', t; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_storno_schutz' AND tgrelid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'KAN-145 B1: a_storno_schutz fehlt an %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'z_protokoll_aendern' AND tgrelid = ('public.' || t)::regclass
                   AND pg_get_triggerdef(oid) LIKE '%storniert_am%') THEN
      RAISE EXCEPTION 'KAN-145 B1: z_protokoll_aendern an % überwacht storniert_am nicht', t;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.s112_storno_schutz()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-145 B1: EXECUTE-Rechte falsch';
  END IF;
END $$;
