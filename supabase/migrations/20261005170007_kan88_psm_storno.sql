-- KAN-88 (05.10.2026): Pflanzenschutz- und Düngeaufzeichnungen sowie PSM-/Dünger-Lager – Storno statt Löschen,
-- vollständiges Änderungsprotokoll (Art. 67 VO (EG) 1107/2009, 3 Jahre Aufbewahrung; Vorgabe BKI wie KAN-145).
--  1. behandlungen, psm_lager_bewegungen, duengemittel_lager_bewegungen: Storno-Spalten (storniert_am/_von/_von_name,
--     storno_grund, CHECK Grund ≥ 10 Zeichen), a_storno_schutz (s112_storno_schutz), a_loeschsperre ('storno') und
--     RESTRICTIVE-Policy keine_direktloeschung – kein Löschen per API; endgültig löschen nur stornierte Zeilen über
--     s112_storniert_loeschen (Modul Rieden). s112_buchung_loeschen (KAN-166, Löschen mit Grund) entfällt.
--  2. Lagerbuchungen sind nach dem Speichern fest (a_freeze, nur Notizen und Storno) – Korrektur per Storno bzw.
--     Gegenbuchung (Inventurkorrektur). Maßnahmen bleiben bearbeitbar (Änderungen im Protokoll), stornierte nicht.
--  3. behandlung_grundstuecke: Protokolltrigger (Betrieb über die Maßnahme bzw. das Grundstück) und a_freeze, solange
--     die Maßnahme storniert ist (endgültiges Löschen der Maßnahme räumt per Kaskade ab – Elternzeile dann schon weg).
--  4. Änderungsprotokoll: behandlungen überwacht zusätzlich Storno, Uhrzeiten, Anwender und Art der Verwendung (KAN-87),
--     die Lager zusätzlich den Storno.
--  5. KAN-87-Nachtrag: Spaltenkommentare – Frist ab Tagesende, auch für Düngungen.
-- Kein session_replication_role. Bestehende Zeilen bleiben unverändert (neue Spalten NULL).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Storno-Spalten, Schutz, Löschsperre ───────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN storniert_am timestamptz,
      ADD COLUMN storniert_von uuid,
      ADD COLUMN storniert_von_name text,
      ADD COLUMN storno_grund text', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (storniert_am IS NULL AND storniert_von IS NULL AND storniert_von_name IS NULL AND storno_grund IS NULL)
      OR (storniert_am IS NOT NULL AND length(btrim(coalesce(storno_grund, ''''))) >= 10))', t, t || '_storno_chk');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_am IS %L', t,
      'KAN-88: Zeitpunkt des Stornos (Zeile bleibt stehen, zählt in keinem Bestand, keiner Bilanz, keiner Meldung); setzt s112_storno_schutz');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von IS %L', t, 'KAN-88: Benutzer (auth.uid(), ohne FK)');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von_name IS %L', t, 'KAN-88: Name des Benutzers als Momentaufnahme');
    EXECUTE format('COMMENT ON COLUMN public.%I.storno_grund IS %L', t, 'KAN-88: Grund des Stornos (mind. 10 Zeichen)');
    EXECUTE format('CREATE TRIGGER a_storno_schutz BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_storno_schutz()', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L)', t, 'storno');
    EXECUTE format('CREATE POLICY keine_direktloeschung ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
  END LOOP;
END $$;

DROP FUNCTION public.s112_buchung_loeschen(uuid, text, uuid, text);

-- 2. Lagerbuchungen fest (nur Notizen und Storno)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['psm_lager_bewegungen', 'duengemittel_lager_bewegungen'] LOOP
    EXECUTE format($f$CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Lagerbuchung gespeichert', 'o.storniert_am IS NULL',
        'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund', 'datum')$f$, t);
  END LOOP;
END $$;

-- 3. behandlung_grundstuecke: Protokoll und Sperre bei stornierter Maßnahme
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.bestandsprotokoll_schreiben()'::regprocedure);
  c_a1 constant text := $a$WHEN 'verschneidung_quellen' THEN$a$;
  c_n1 constant text := $a$WHEN 'behandlung_grundstuecke' THEN
        v_eltern := 'behandlungen';
        v_eltern_id := COALESCE((v_alt ->> 'behandlung_id')::uuid, (v_neu ->> 'behandlung_id')::uuid);
        SELECT b.tenant_id INTO v_tenant FROM public.behandlungen b WHERE b.id = v_eltern_id;
      WHEN 'verschneidung_quellen' THEN$a$;
  c_a2 constant text := $a$WHEN 'pressung_behaelter' THEN$a$;
  c_n2 constant text := $a$WHEN 'behandlung_grundstuecke' THEN
          SELECT s.tenant_id INTO v_tenant FROM public.grundstuecke s WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid;
        WHEN 'pressung_behaelter' THEN$a$;
BEGIN
  -- c_a1 steht zweimal (Elternzeile und Verweise): nur das erste Vorkommen; c_a2 genau einmal (Verweise)
  IF (length(v_def) - length(replace(v_def, c_a1, ''))) / length(c_a1) <> 2
     OR (length(v_def) - length(replace(v_def, c_a2, ''))) / length(c_a2) <> 1
     OR strpos(v_def, 'behandlung_grundstuecke') > 0 THEN
    RAISE EXCEPTION 'KAN-88: bestandsprotokoll_schreiben hat nicht die erwartete Form';
  END IF;
  v_def := overlay(v_def placing c_n1 from strpos(v_def, c_a1) for length(c_a1));
  EXECUTE replace(v_def, c_a2, c_n2);
END $$;

CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF behandlung_id, grundstueck_id, flaeche_ha ON public.behandlung_grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('behandlung_id', 'grundstueck_id', 'flaeche_ha');
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.behandlung_grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.behandlung_grundstuecke
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.behandlung_grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Maßnahme storniert',
    $$EXISTS (SELECT 1 FROM public.behandlungen b WHERE b.id = o.behandlung_id AND b.storniert_am IS NOT NULL
              AND NOT coalesce(public.s112_wartung_frei(b.tenant_id), false))$$,
    '', '');

-- 4. Änderungsprotokoll
DROP TRIGGER z_protokoll_aendern ON public.behandlungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF art, datum, datum_bis, psm_id, duengemittel_id, betriebsmittel_id, aufwandmenge,
  aufwandmenge_einheit, menge_gesamt, menge_einheit, konzentration, wasseraufwand_l_ha, ernte_fruehesteins, weingarten_id, tenant_id,
  uhrzeit_von, uhrzeit_bis, durchgefuehrt_von, anwender_name, art_verwendung, storniert_am, storno_grund ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('art', 'datum', 'datum_bis', 'psm_id', 'duengemittel_id',
  'betriebsmittel_id', 'aufwandmenge', 'aufwandmenge_einheit', 'menge_gesamt', 'menge_einheit', 'konzentration',
  'wasseraufwand_l_ha', 'ernte_fruehesteins', 'weingarten_id', 'tenant_id', 'uhrzeit_von', 'uhrzeit_bis', 'durchgefuehrt_von',
  'anwender_name', 'art_verwendung', 'storniert_am', 'storno_grund');
DROP TRIGGER z_protokoll_aendern ON public.psm_lager_bewegungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF psm_id, datum, typ, menge, einheit, tenant_id, storniert_am, storno_grund
  ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('psm_id', 'datum', 'typ', 'menge', 'einheit', 'tenant_id',
  'storniert_am', 'storno_grund');
DROP TRIGGER z_protokoll_aendern ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF duengemittel_id, datum, typ, menge, einheit, tenant_id, storniert_am, storno_grund
  ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('duengemittel_id', 'datum', 'typ', 'menge', 'einheit', 'tenant_id',
  'storniert_am', 'storno_grund');

-- 1b. Endgültig löschen stornierter Zeilen (Modul Rieden)
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.s112_storniert_loeschen(uuid, text, uuid, text)'::regprocedure);
  c_a1 constant text := $a$'betriebsmittel_lager_bewegungen'];$a$;
  c_n1 constant text := $a$'betriebsmittel_lager_bewegungen', 'behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen'];$a$;
  c_a2 constant text := $a$WHEN 'betriebsmittel_lager_bewegungen' THEN ARRAY['rieden']$a$;
  c_n2 constant text := $a$WHEN 'betriebsmittel_lager_bewegungen' THEN ARRAY['rieden']
    WHEN 'behandlungen'                    THEN ARRAY['rieden']
    WHEN 'psm_lager_bewegungen'            THEN ARRAY['rieden']
    WHEN 'duengemittel_lager_bewegungen'   THEN ARRAY['rieden']$a$;
BEGIN
  IF (length(v_def) - length(replace(v_def, c_a1, ''))) / length(c_a1) <> 1
     OR (length(v_def) - length(replace(v_def, c_a2, ''))) / length(c_a2) <> 1 THEN
    RAISE EXCEPTION 'KAN-88: s112_storniert_loeschen hat nicht die erwartete Form';
  END IF;
  EXECUTE replace(replace(v_def, c_a1, c_n1), c_a2, c_n2);
END $$;

-- 5. KAN-87-Nachtrag (Entscheidung 05.10.2026)
COMMENT ON COLUMN public.behandlungen.uhrzeit_bis IS 'KAN-87: Ende der Anwendung (Wiener Zeit, am Tag datum_bis bzw. datum) – die Erfassungsfrist läuft ab Tagesende, nicht ab dieser Uhrzeit';
COMMENT ON COLUMN public.tenant_einstellungen.psm_erfassungsfrist_h IS
  'KAN-87: Frist (Stunden ab Ende des Anwendungstags, 24:00 Wiener Zeit) für die Aufzeichnung von Pflanzenschutz und Düngung – Ampel grün bis zur Frist, gelb bis 72 h, rot darüber';
