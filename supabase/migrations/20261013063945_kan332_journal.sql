-- KAN-332 (13.10.2026): Journal – wer hat wann in welchem Bereich was gebucht
--
-- Entscheidungen Jörgen (Jira-Kommentar 13.10.2026):
--   1 B  Mitarbeiter sehen ihre eigenen Vorgänge, die Betriebsleitung alle (Filter nach Benutzer in der App)
--   2 B  Anlage, Änderung, Storno und Löschung
--   3 A  alle Bereiche, die das Bestandsprotokoll (KAN-35) schon kennt
--   4    Neuanlagen ab dem Einspielen, rückwirkend nicht nötig
--   5    Reiter „Journal“ auf der Übersicht, Druck und CSV
--
-- Umsetzung:
--   (1) bestandsprotokoll.kennung: kurze Kennzeichnung des Datensatzes (Name, Nummer, Datum, Menge …) für alle Aktionen –
--       damit das Journal „Charge GV 2025 angelegt“ statt nur einer ID zeigen kann. Datenminimierung: nur die Spalten
--       aus c_kennung, keine ganzen Zeilen bei Neuanlagen.
--   (2) bestandsprotokoll_schreiben() protokolliert zusätzlich INSERT (alt/neu/geaenderte_spalten leer, kennung gesetzt).
--   (3) Trigger z_protokoll_anlegen (AFTER INSERT FOR EACH ROW) auf den Protokoll-Tabellen ohne Kindtabellen – Positionen,
--       Chargenanteile, Gebinde einer Pressung, Quellen eines Verschnitts, Grundstücke einer Maßnahme, Flaschenbewegungen
--       und AMA-Positionen erscheinen über ihren Kopf (Verkauf, Füllung, Pressung …), sonst wäre das Journal unlesbar.
--   (4) RLS: zusätzliche SELECT-Policy bestandsprotokoll_eigene (TO authenticated) – eigene Zeilen in eigenen Betrieben.
--       Die Policy der Betriebsleitung bleibt; die RESTRICTIVE-Policies (2FA, gesperrte Mitgliedschaft) gelten weiter.
--   (5) Index für „meine Vorgänge, neueste zuerst“.

-- (1) Kennung; Aktion INSERT zulassen (bisher nur UPDATE/DELETE)
ALTER TABLE public.bestandsprotokoll ADD COLUMN IF NOT EXISTS kennung jsonb;
ALTER TABLE public.bestandsprotokoll DROP CONSTRAINT IF EXISTS bestandsprotokoll_aktion_check;
ALTER TABLE public.bestandsprotokoll ADD CONSTRAINT bestandsprotokoll_aktion_check CHECK (aktion = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text]));
COMMENT ON COLUMN public.bestandsprotokoll.kennung IS
  'KAN-332: Kennzeichnung des Datensatzes (Name, Nummer, Datum, Menge …) für das Journal – nur Spalten aus c_kennung in bestandsprotokoll_schreiben()';

-- (2) Protokoll-Funktion: INSERT und Kennung
CREATE OR REPLACE FUNCTION public.bestandsprotokoll_schreiben()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_demo      constant uuid := '33333333-3333-4333-8333-333333333333';
  -- KAN-332: Spalten, die einen Datensatz im Journal kennzeichnen (je Tabelle die vorhandenen)
  c_kennung   constant text[] := ARRAY['anzahl_flaschen', 'art', 'belegnummer', 'beschreibung', 'betrag', 'betrag_brutto',
                                       'betrag_netto', 'bezeichnung', 'dateiname', 'datum', 'ernte_datum', 'jahr', 'jahrgang',
                                       'liefernummer', 'lfd_nr', 'menge', 'menge_kg', 'menge_liter', 'monat', 'name',
                                       'pruefnummer', 'rebsorte', 'rechnungsnummer', 'status', 'tbs_nummer', 'transaktions_nr',
                                       'typ', 'zeitraum'];
  v_rolle     text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_alt       jsonb;
  v_neu       jsonb;
  v_alt_diff  jsonb;
  v_neu_diff  jsonb;
  v_spalten   text[];
  v_tenant    uuid;
  v_eltern    text;
  v_eltern_id uuid;
  v_kennung   jsonb;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'TRUNCATE auf „%“ ist gesperrt (KAN-35 Bestandsprotokoll) – bitte zeilenweise mit DELETE löschen', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Datenminimierung: Versand-E-Mail-Adresse ist nicht bestandsrelevant
    v_alt := to_jsonb(OLD) - 'rechnung_versendet_an';
  ELSIF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    v_neu := to_jsonb(NEW);
    SELECT array_agg(s.k ORDER BY s.k),
           jsonb_object_agg(s.k, v_alt -> s.k),
           jsonb_object_agg(s.k, v_neu -> s.k)
      INTO v_spalten, v_alt_diff, v_neu_diff
      FROM unnest(CASE WHEN TG_NARGS > 0 THEN TG_ARGV
                       ELSE ARRAY(SELECT jsonb_object_keys(v_neu)) END) AS s(k)
     WHERE (v_alt -> s.k) IS DISTINCT FROM (v_neu -> s.k);
    IF v_spalten IS NULL THEN
      RETURN NULL;  -- keine überwachte Spalte hat sich tatsächlich geändert
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- KAN-332: Neuanlage – nur Kennung und Benutzer, keine ganze Zeile (alt/neu bleiben leer)
    v_neu := to_jsonb(NEW);
  ELSE
    RETURN NULL;
  END IF;

  SELECT jsonb_object_agg(e.key, e.value) INTO v_kennung
    FROM jsonb_each(COALESCE(v_neu, v_alt)) e
   WHERE e.key = ANY (c_kennung) AND e.value <> 'null'::jsonb;

  v_tenant := COALESCE((v_alt ->> 'tenant_id')::uuid, (v_neu ->> 'tenant_id')::uuid);

  IF v_tenant IS NULL THEN
    -- (1) Elternzeile
    CASE TG_TABLE_NAME
      WHEN 'pressung_behaelter', 'pressung_weingaerten' THEN
        v_eltern := 'pressungen';
        v_eltern_id := COALESCE((v_alt ->> 'pressung_id')::uuid, (v_neu ->> 'pressung_id')::uuid);
        SELECT p.tenant_id INTO v_tenant FROM public.pressungen p WHERE p.id = v_eltern_id;
      WHEN 'behandlung_grundstuecke' THEN
        v_eltern := 'behandlungen';
        v_eltern_id := COALESCE((v_alt ->> 'behandlung_id')::uuid, (v_neu ->> 'behandlung_id')::uuid);
        SELECT b.tenant_id INTO v_tenant FROM public.behandlungen b WHERE b.id = v_eltern_id;
      WHEN 'verschneidung_quellen' THEN
        v_eltern := 'verschneidungen';
        v_eltern_id := COALESCE((v_alt ->> 'verschneidung_id')::uuid, (v_neu ->> 'verschneidung_id')::uuid);
        SELECT v.tenant_id INTO v_tenant FROM public.verschneidungen v WHERE v.id = v_eltern_id;
      WHEN 'ama_meldepositionen' THEN
        v_eltern := 'ama_erntemeldungen';
        v_eltern_id := COALESCE((v_alt ->> 'meldung_id')::uuid, (v_neu ->> 'meldung_id')::uuid);
        SELECT a.tenant_id INTO v_tenant FROM public.ama_erntemeldungen a WHERE a.id = v_eltern_id;
      WHEN 'ernte_parzellen' THEN
        v_eltern := 'weinjahrgaenge';
        v_eltern_id := COALESCE((v_alt ->> 'jahrgang_id')::uuid, (v_neu ->> 'jahrgang_id')::uuid);
        SELECT j.tenant_id INTO v_tenant FROM public.weinjahrgaenge j WHERE j.id = v_eltern_id;
      ELSE
        NULL;
    END CASE;

    -- (2) Protokollzeile der Eltern-Löschung (FK-Kaskade)
    IF v_tenant IS NULL AND v_eltern_id IS NOT NULL THEN
      SELECT b.tenant_id INTO v_tenant
        FROM public.bestandsprotokoll b
       WHERE b.tabelle = v_eltern AND b.datensatz_id = v_eltern_id
         AND b.aktion = 'DELETE' AND b.tenant_id IS NOT NULL
       ORDER BY b.id DESC
       LIMIT 1;
    END IF;

    -- (3) noch vorhandene Verweise
    IF v_tenant IS NULL THEN
      CASE TG_TABLE_NAME
        WHEN 'behandlung_grundstuecke' THEN
          SELECT s.tenant_id INTO v_tenant FROM public.grundstuecke s WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid;
        WHEN 'pressung_behaelter' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'weinausbau_id')::uuid;
        WHEN 'verschneidung_quellen' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'quell_weinausbau_id')::uuid;
        WHEN 'pressung_weingaerten' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g    WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT z.tenant_id FROM public.zukauf_posten z WHERE z.id = (v_alt ->> 'zukauf_posten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s  WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        WHEN 'ernte_parzellen' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g   WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        ELSE
          NULL;
      END CASE;
    END IF;
  END IF;

  -- (4) KAN-151: Mandanten-Löschung – Kind ohne tenant_id, Eltern schon weg: Betrieb aus dem Wartungs-Kennzeichen
  IF v_tenant IS NULL AND current_setting('s112.loeschen_erlaubt', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_tenant := current_setting('s112.loeschen_erlaubt', true)::uuid;
  END IF;

  -- Bypass Demo-Reset (siehe Kopfkommentar); nie für API-Benutzer, nie für echte Mandanten
  IF v_tenant = c_demo
     AND current_setting('s112.protokoll_aus', true) = c_demo::text
     AND v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.bestandsprotokoll
    (tenant_id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id, grund, kennung)
  VALUES
    (v_tenant, TG_TABLE_NAME, COALESCE((v_alt ->> 'id')::uuid, (v_neu ->> 'id')::uuid), TG_OP,
     CASE WHEN TG_OP = 'DELETE' THEN v_alt ELSE v_alt_diff END,
     v_neu_diff, v_spalten, v_rolle, auth.uid(),
     -- KAN-145: Grund einer endgültigen Löschung (nur die Lösch-RPC setzt ihn, transaktionslokal);
     -- KAN-97: Grund einer Änderung (nur RPCs setzen s112.aenderung_grund, z. B. der Statuswechsel)
     CASE WHEN TG_OP = 'DELETE' THEN NULLIF(current_setting('s112.loesch_grund', true), '')
          WHEN TG_OP = 'UPDATE' THEN NULLIF(current_setting('s112.aenderung_grund', true), '') END,
     v_kennung);

  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.bestandsprotokoll_schreiben() FROM PUBLIC, anon, authenticated;

-- (3) Neuanlagen protokollieren – Köpfe, keine Kindtabellen
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ama_erntemeldungen', 'behandlungen', 'betriebsmittel', 'betriebsmittel_lager_bewegungen', 'dac_antrag',
    'duengemittel', 'duengemittel_lager_bewegungen', 'ea_belege', 'ea_dauerauftraege', 'ea_kategorien',
    'ea_monatsabschluss', 'ea_transaktionen', 'ea_uva', 'ernte_parzellen', 'exportauftraege', 'fuellungen',
    'grundstuecke', 'keller_behandlungen', 'keller_behandlungstypen', 'keller_umzuege', 'konto_umbuchungen', 'lesen',
    'pflanzenschutzmittel', 'pressungen', 'pruefnummernantraege', 'psm_lager_bewegungen', 'rechnungen',
    'transportbescheinigungen', 'traubenverkauf', 'verkaufsposten', 'verschneidungen', 'weinanalysen', 'weinausbau',
    'weingarten', 'weinjahrgaenge', 'zahlungen', 'zukauf_posten']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_anlegen ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_anlegen AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
  END LOOP;
END
$do$;

-- (4) Eigene Vorgänge lesen (Mitarbeiter); Betriebsleitung liest weiter alles über bestandsprotokoll_select
DROP POLICY IF EXISTS bestandsprotokoll_eigene ON public.bestandsprotokoll;
CREATE POLICY bestandsprotokoll_eigene ON public.bestandsprotokoll
  FOR SELECT TO authenticated
  USING (benutzer_id = (SELECT auth.uid()) AND tenant_id IN (SELECT public.get_user_tenant_ids()));

-- (5) Index: meine Vorgänge im Betrieb, neueste zuerst
CREATE INDEX IF NOT EXISTS bestandsprotokoll_benutzer_idx
  ON public.bestandsprotokoll (tenant_id, benutzer_id, erstellt_am DESC);
