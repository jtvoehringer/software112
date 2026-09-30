-- KAN-148 (Folgeticket C), Etappe C1a: Storno-Kennzeichen für Lese, Pressung und Traubenverkauf – ENTWURF, erst nach
-- „OK, einspielen“, zuerst Staging
--
-- Wie KAN-145 B1 für das Kellerbuch: nur Spalten und ihr Schutz. Die App storniert ab C1b (Lesedaten,
-- Traubenverkauf) bzw. C1c (Pressung) mit Kennzeichen statt zu löschen; die Löschsperre wird erst in C1d scharf.
-- Rein additiv – die heutige App merkt nichts davon.
--
--  1. storniert_am, storniert_von, storniert_von_name, storno_grund an pressungen, pressung_behaelter,
--     pressung_weingaerten, ernte_parzellen, traubenverkauf (weinausbau hat sie seit B3). storniert_von ohne FK,
--     Name als Momentaufnahme; CHECK <tabelle>_storno_chk: Grund mind. 10 Zeichen, sobald storniert.
--  2. Schutz-Trigger a_storno_schutz (s112_storno_schutz aus B1, unverändert): Zeitpunkt/Benutzer setzt die DB,
--     stornierte Zeile unveränderlich, nicht storniert anlegen; Service-Role/SQL-Editor frei.
--  3. z_protokoll_aendern überwacht zusätzlich storniert_am und storno_grund (übrige Spalten wie heute in Produktion).
-- Kein session_replication_role (KAN-124). Keine Daten betroffen: alle neuen Spalten NULL.

-- 1. Spalten ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'ernte_parzellen', 'traubenverkauf'] LOOP
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
      'KAN-148: Zeitpunkt des Stornos (Zeile bleibt stehen, zählt in keiner Menge und keinem Bestand); setzt s112_storno_schutz');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von IS %L', t, 'KAN-148: Benutzer (auth.uid(), ohne FK)');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von_name IS %L', t, 'KAN-148: Name des Benutzers als Momentaufnahme');
    EXECUTE format('COMMENT ON COLUMN public.%I.storno_grund IS %L', t, 'KAN-148: Grund des Stornos (mind. 10 Zeichen)');
  END LOOP;
END $$;

-- 2. Schutz der Storno-Spalten ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'ernte_parzellen', 'traubenverkauf'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_storno_schutz ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_storno_schutz BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.s112_storno_schutz()', t);
  END LOOP;
END $$;

-- 3. Änderungsprotokoll überwacht den Storno ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.pressungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF datum, jahrgang_id, most_liter_gesamt, tenant_id, kmw_grad, oechsle,
  mostgewicht_einheit, lese_id, storniert_am, storno_grund ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('datum', 'jahrgang_id', 'most_liter_gesamt', 'tenant_id',
  'kmw_grad', 'oechsle', 'mostgewicht_einheit', 'lese_id', 'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.pressung_behaelter;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_liter, behaelter_id, weinausbau_id, pressung_id, storniert_am,
  storno_grund ON public.pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_liter', 'behaelter_id', 'weinausbau_id',
  'pressung_id', 'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.pressung_weingaerten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF trauben_kg, weingarten_id, grundstueck_id, zukauf_posten_id,
  pressung_id, kmw, oechsle, mostgewicht_einheit, ernte_datum, storniert_am, storno_grund ON public.pressung_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('trauben_kg', 'weingarten_id', 'grundstueck_id',
  'zukauf_posten_id', 'pressung_id', 'kmw', 'oechsle', 'mostgewicht_einheit', 'ernte_datum', 'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.ernte_parzellen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_kg, menge_hl, jahrgang_id, weingarten_id, grundstueck_id,
  klosterneuburger, oechsle, mostgewicht_einheit, ernte_datum, lese_id, storniert_am, storno_grund ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_kg', 'menge_hl', 'jahrgang_id', 'weingarten_id',
  'grundstueck_id', 'klosterneuburger', 'oechsle', 'mostgewicht_einheit', 'ernte_datum', 'lese_id', 'storniert_am',
  'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.traubenverkauf;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_kg, datum, jahrgang_id, weingarten_id, grundstueck_id,
  zukauf_posten_id, verkaufsposten_id, tenant_id, kmw_grad, oechsle, mostgewicht_einheit, lese_id, storniert_am,
  storno_grund ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_kg', 'datum', 'jahrgang_id', 'weingarten_id',
  'grundstueck_id', 'zukauf_posten_id', 'verkaufsposten_id', 'tenant_id', 'kmw_grad', 'oechsle', 'mostgewicht_einheit',
  'lese_id', 'storniert_am', 'storno_grund');

-- Selbstprüfung
DO $$
DECLARE t text; v_n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'ernte_parzellen', 'traubenverkauf'] LOOP
    SELECT count(*) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name IN ('storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund');
    IF v_n <> 4 THEN RAISE EXCEPTION 'KAN-148 C1a: Storno-Spalten an % unvollständig', t; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_storno_schutz' AND tgrelid = ('public.' || t)::regclass
                     AND tgfoid = 'public.s112_storno_schutz()'::regprocedure) THEN
      RAISE EXCEPTION 'KAN-148 C1a: a_storno_schutz fehlt an %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'z_protokoll_aendern' AND tgrelid = ('public.' || t)::regclass
                   AND pg_get_triggerdef(oid) LIKE '%storniert_am%') THEN
      RAISE EXCEPTION 'KAN-148 C1a: z_protokoll_aendern an % überwacht storniert_am nicht', t;
    END IF;
  END LOOP;
END $$;
