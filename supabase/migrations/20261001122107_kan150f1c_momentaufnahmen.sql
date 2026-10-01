-- KAN-150 (Folgeticket F), Etappe F1c: Momentaufnahmen von Käufer, Empfänger, Lieferant und Kategorie auf den Belegen
--
-- Bisher lesen alle Meldungen und Belege die Stammdaten live (kontakte, firmen, ea_kategorien): Umbenennen,
-- Zusammenführen oder Umwandeln änderten ausgestellte Rechnungen, Transportbescheinigungen, BKI-Datenblätter,
-- Exportpapiere und das E/A-Journal rückwirkend (Ticket Ist (2), Soll 5, Fragen 3 und 4).
--
--  1. Momentaufnahme als jsonb in derselben Form wie die Einbettungen der Loader (diese lesen dann
--     „Momentaufnahme ?? live“):
--       verkaufsposten.partner_daten  {kontakt, firma, zh_kontakt}
--       traubenverkauf.partner_daten  {kontakt, firma}
--       zukauf_posten.partner_daten   {lieferant_kontakt, lieferant_firma, zh_kontakt}
--       exportauftraege.partner_daten {kontakt, firma}
--       ea_transaktionen.stamm_daten  {kategorie, firma}
--     Kontakt: vorname, nachname, strasse, plz, ort, land, telefon(+vorwahl), betrieb_nr, accountnummer, debitor_nr,
--     zahlungsziel_tage; Firma zusätzlich name, uid_nummer, kreditor_nr; Kategorie: name, konto_nr.
--  2. Trigger a_momentaufnahme (BEFORE INSERT bzw. UPDATE OF Verweis und Momentaufnahme): setzt die Momentaufnahme
--     aus dem Stammsatz – beim Anlegen und bei bewusstem Wechsel in der App (Käufer-, Lieferanten-, Kategoriewechsel).
--     Direkt setzen lässt sie sich nicht (bleibt unverändert). Gegenbuchungen übernehmen die des Originals.
--     Bei Umhängen durch Zusammenführen bzw. Umwandeln (Flag s112.momentaufnahme_behalten) bleibt sie unverändert.
--  3. Zusammenführen (kontakte_zusammenfuehren) und neu Umwandeln (RPC s112_kontakt_historie_zu_firma, bisher
--     Einzel-Updates in der App) setzen das Flag. Die Storno-Schutz-Trigger (s112_storno_schutz,
--     s112_verkauf_storno_schutz) lassen dann an stornierten Belegen das Umhängen der Verweise zu – bisher brachen
--     beide Abläufe bei Kontakten mit stornierten Verkäufen mit 42501 ab (Befund 01.10.2026, seit KAN-149 D1).
--  4. Altzeilen einmalig aus dem heutigen Stammsatz (Wartungs-Flag für abgeschlossene E/A-Zeiträume).
-- Kein session_replication_role (KAN-124).

-- 1. Spalten ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verkaufsposten   ADD COLUMN IF NOT EXISTS partner_daten jsonb;
ALTER TABLE public.traubenverkauf   ADD COLUMN IF NOT EXISTS partner_daten jsonb;
ALTER TABLE public.zukauf_posten    ADD COLUMN IF NOT EXISTS partner_daten jsonb;
ALTER TABLE public.exportauftraege  ADD COLUMN IF NOT EXISTS partner_daten jsonb;
ALTER TABLE public.ea_transaktionen ADD COLUMN IF NOT EXISTS stamm_daten jsonb;
COMMENT ON COLUMN public.verkaufsposten.partner_daten IS 'KAN-150: Momentaufnahme Käufer {kontakt, firma, zh_kontakt} – Belege und Meldungen lesen sie vor den Stammdaten';
COMMENT ON COLUMN public.traubenverkauf.partner_daten IS 'KAN-150: Momentaufnahme Empfänger {kontakt, firma}';
COMMENT ON COLUMN public.zukauf_posten.partner_daten IS 'KAN-150: Momentaufnahme Lieferant {lieferant_kontakt, lieferant_firma, zh_kontakt}';
COMMENT ON COLUMN public.exportauftraege.partner_daten IS 'KAN-150: Momentaufnahme Empfänger {kontakt, firma}';
COMMENT ON COLUMN public.ea_transaktionen.stamm_daten IS 'KAN-150: Momentaufnahme {kategorie: {name, konto_nr}, firma}';

-- 2. Momentaufnahmen ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_kontakt_momentaufnahme(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('vorname', k.vorname, 'nachname', k.nachname, 'strasse', k.strasse, 'plz', k.plz, 'ort', k.ort,
           'land', k.land, 'telefon', k.telefon, 'telefon_vorwahl', k.telefon_vorwahl, 'betrieb_nr', k.betrieb_nr,
           'accountnummer', k.accountnummer, 'debitor_nr', k.debitor_nr, 'zahlungsziel_tage', k.zahlungsziel_tage)
    FROM public.kontakte k WHERE k.id = p_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kontakt_momentaufnahme(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_firma_momentaufnahme(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('name', f.name, 'strasse', f.strasse, 'plz', f.plz, 'ort', f.ort, 'land', f.land,
           'telefon', f.telefon, 'telefon_vorwahl', f.telefon_vorwahl, 'uid_nummer', f.uid_nummer, 'betrieb_nr', f.betrieb_nr,
           'accountnummer', f.accountnummer, 'debitor_nr', f.debitor_nr, 'kreditor_nr', f.kreditor_nr,
           'zahlungsziel_tage', f.zahlungsziel_tage)
    FROM public.firmen f WHERE f.id = p_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_firma_momentaufnahme(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_momentaufnahme()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_neu jsonb := to_jsonb(NEW);
  v_alt jsonb;
  v     jsonb;
  v_fk  text[] := CASE TG_TABLE_NAME
    WHEN 'verkaufsposten'   THEN ARRAY['kontakt_id', 'firma_id', 'zh_kontakt_id']
    WHEN 'zukauf_posten'    THEN ARRAY['lieferant_kontakt_id', 'lieferant_firma_id', 'zh_kontakt_id']
    WHEN 'ea_transaktionen' THEN ARRAY['kategorie_id', 'firma_id']
    ELSE ARRAY['kontakt_id', 'firma_id'] END;
  v_spalte text := CASE WHEN TG_TABLE_NAME = 'ea_transaktionen' THEN 'stamm_daten' ELSE 'partner_daten' END;
BEGIN
  -- Umhängen durch Zusammenführen/Umwandeln: Belege behalten ihre Momentaufnahme
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('s112.momentaufnahme_behalten', true), '') = 'an' THEN
    IF TG_TABLE_NAME = 'ea_transaktionen' THEN NEW.stamm_daten := OLD.stamm_daten; ELSE NEW.partner_daten := OLD.partner_daten; END IF;
    RETURN NEW;
  END IF;
  -- Nur bei echtem Wechsel eines Verweises neu – sonst (auch bei direktem Setzen) bleibt die bestehende Momentaufnahme;
  -- leere (Altzeilen) werden befüllt
  IF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    IF COALESCE(v_alt -> v_spalte, 'null'::jsonb) <> 'null'::jsonb
       AND NOT EXISTS (SELECT 1 FROM unnest(v_fk) k WHERE v_neu -> k IS DISTINCT FROM v_alt -> k) THEN
      IF TG_TABLE_NAME = 'ea_transaktionen' THEN NEW.stamm_daten := OLD.stamm_daten; ELSE NEW.partner_daten := OLD.partner_daten; END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'verkaufsposten' THEN
    v := jsonb_build_object(
      'kontakt', public.s112_kontakt_momentaufnahme((v_neu ->> 'kontakt_id')::uuid),
      'firma', public.s112_firma_momentaufnahme((v_neu ->> 'firma_id')::uuid),
      'zh_kontakt', public.s112_kontakt_momentaufnahme((v_neu ->> 'zh_kontakt_id')::uuid));
    NEW.partner_daten := v;
  ELSIF TG_TABLE_NAME IN ('traubenverkauf', 'exportauftraege') THEN
    v := jsonb_build_object(
      'kontakt', public.s112_kontakt_momentaufnahme((v_neu ->> 'kontakt_id')::uuid),
      'firma', public.s112_firma_momentaufnahme((v_neu ->> 'firma_id')::uuid));
    NEW.partner_daten := v;
  ELSIF TG_TABLE_NAME = 'zukauf_posten' THEN
    v := jsonb_build_object(
      'lieferant_kontakt', public.s112_kontakt_momentaufnahme((v_neu ->> 'lieferant_kontakt_id')::uuid),
      'lieferant_firma', public.s112_firma_momentaufnahme((v_neu ->> 'lieferant_firma_id')::uuid),
      'zh_kontakt', public.s112_kontakt_momentaufnahme((v_neu ->> 'zh_kontakt_id')::uuid));
    NEW.partner_daten := v;
  ELSIF TG_TABLE_NAME = 'ea_transaktionen' THEN
    -- Gegenbuchung: Momentaufnahme des Originals (gleiche Bezeichnungen wie die stornierte Buchung)
    IF TG_OP = 'INSERT' AND (v_neu ->> 'storno_von_id') IS NOT NULL THEN
      SELECT e.stamm_daten INTO v FROM public.ea_transaktionen e WHERE e.id = (v_neu ->> 'storno_von_id')::uuid;
    END IF;
    IF v IS NULL THEN
      v := jsonb_build_object(
        'kategorie', (SELECT jsonb_build_object('name', k.name, 'konto_nr', k.konto_nr) FROM public.ea_kategorien k
                       WHERE k.id = (v_neu ->> 'kategorie_id')::uuid),
        'firma', public.s112_firma_momentaufnahme((v_neu ->> 'firma_id')::uuid));
    END IF;
    NEW.stamm_daten := v;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_momentaufnahme() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_momentaufnahme ON public.verkaufsposten;
CREATE TRIGGER a_momentaufnahme BEFORE INSERT OR UPDATE OF kontakt_id, firma_id, zh_kontakt_id, partner_daten ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_momentaufnahme();
DROP TRIGGER IF EXISTS a_momentaufnahme ON public.traubenverkauf;
CREATE TRIGGER a_momentaufnahme BEFORE INSERT OR UPDATE OF kontakt_id, firma_id, partner_daten ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_momentaufnahme();
DROP TRIGGER IF EXISTS a_momentaufnahme ON public.zukauf_posten;
CREATE TRIGGER a_momentaufnahme BEFORE INSERT OR UPDATE OF lieferant_kontakt_id, lieferant_firma_id, zh_kontakt_id, partner_daten ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_momentaufnahme();
DROP TRIGGER IF EXISTS a_momentaufnahme ON public.exportauftraege;
CREATE TRIGGER a_momentaufnahme BEFORE INSERT OR UPDATE OF kontakt_id, firma_id, partner_daten ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_momentaufnahme();
DROP TRIGGER IF EXISTS a_momentaufnahme ON public.ea_transaktionen;
CREATE TRIGGER a_momentaufnahme BEFORE INSERT OR UPDATE OF kategorie_id, firma_id, stamm_daten ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_momentaufnahme();

-- 3. Storno-Schutz: Umhängen der Verweise beim Zusammenführen/Umwandeln ───────────────────────────────────
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
  -- KAN-150 F1c: Verweise, die Zusammenführen/Umwandeln auch an stornierten Buchungen umhängen darf
  c_verweise constant text[] := ARRAY['kontakt_id', 'firma_id', 'zh_kontakt_id', 'lieferant_kontakt_id', 'lieferant_firma_id',
                                      'aktualisiert_am', 'updated_at'];
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
      IF COALESCE(current_setting('s112.momentaufnahme_behalten', true), '') = 'an'
         AND (v_neu - c_verweise) = (v_alt - c_verweise) THEN
        RETURN NEW;
      END IF;
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

CREATE OR REPLACE FUNCTION public.s112_verkauf_storno_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_uid   uuid := auth.uid();
  v_name  text;
  -- KAN-150 F1c: Zusammenführen/Umwandeln hängt Käufer-Verweise um; der Beleg behält seine Momentaufnahme
  v_umhaengen boolean := COALESCE(current_setting('s112.momentaufnahme_behalten', true), '') = 'an';
BEGIN
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset, Mandanten-Löschung): frei
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.storniert OR NEW.storniert_am IS NOT NULL OR NEW.storniert_von IS NOT NULL
       OR NEW.storniert_von_name IS NOT NULL OR NEW.storno_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Ein Verkauf kann nicht storniert angelegt werden (KAN-149).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Stornierter Beleg: kein Entstornieren; Storno-Angaben und Belegdaten unveränderlich
  IF OLD.storniert THEN
    IF NOT NEW.storniert
       OR NEW.storniert_am IS DISTINCT FROM OLD.storniert_am OR NEW.storniert_von IS DISTINCT FROM OLD.storniert_von
       OR NEW.storniert_von_name IS DISTINCT FROM OLD.storniert_von_name OR NEW.storno_grund IS DISTINCT FROM OLD.storno_grund
       OR NEW.rechnungsnummer IS DISTINCT FROM OLD.rechnungsnummer OR NEW.datum IS DISTINCT FROM OLD.datum
       OR (NOT v_umhaengen AND (NEW.kontakt_id IS DISTINCT FROM OLD.kontakt_id OR NEW.firma_id IS DISTINCT FROM OLD.firma_id))
       OR NEW.partner_daten IS DISTINCT FROM OLD.partner_daten
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Der Verkauf % ist storniert – Storno und Belegdaten bleiben unverändert (KAN-149).', COALESCE(OLD.rechnungsnummer, '')
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Stornieren: Grund Pflicht (seit D3), Zeitpunkt, Benutzer und Name setzt die Datenbank
  IF NEW.storniert THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Stornieren nur als angemeldeter Benutzer (KAN-149).' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(COALESCE(NEW.storno_grund, ''))) < 10 THEN
      RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
      INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    IF v_name IS NULL THEN
      SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
    END IF;
    NEW.storniert_am := now();
    NEW.storniert_von := v_uid;
    NEW.storniert_von_name := v_name;
    NEW.storno_grund := btrim(NEW.storno_grund);
    RETURN NEW;
  END IF;

  -- Nicht storniert: keine Storno-Angaben ohne Storno
  IF NEW.storniert_am IS NOT NULL OR NEW.storniert_von IS NOT NULL OR NEW.storniert_von_name IS NOT NULL OR NEW.storno_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Storno-Angaben nur zusammen mit dem Stornieren (KAN-149).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Umwandeln Kontakt → Firma: Historie an die Firma hängen (bisher Einzel-Updates in der App, Fehler nur geloggt)
CREATE OR REPLACE FUNCTION public.s112_kontakt_historie_zu_firma(p_tenant_id uuid, p_kontakt_id uuid, p_firma_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t     text;
  v_n   int;
  v_erg jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'crm');
  IF NOT EXISTS (SELECT 1 FROM public.kontakte k WHERE k.id = p_kontakt_id AND k.tenant_id = p_tenant_id)
     OR NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = p_firma_id AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Kontakt oder Firma nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('s112.momentaufnahme_behalten', 'an', true);
  FOREACH t IN ARRAY ARRAY['aktivitaeten', 'pipeline_eintraege', 'verkaufsposten', 'bestellungen', 'exportauftraege', 'traubenverkauf'] LOOP
    EXECUTE format('UPDATE public.%I SET firma_id = $1 WHERE kontakt_id = $2 AND tenant_id = $3 AND firma_id IS DISTINCT FROM $1', t)
      USING p_firma_id, p_kontakt_id, p_tenant_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || jsonb_build_object(t, v_n);
  END LOOP;
  PERFORM set_config('s112.momentaufnahme_behalten', '', true);
  RETURN v_erg;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kontakt_historie_zu_firma(uuid, uuid, uuid) FROM PUBLIC, anon;


-- Zusammenführen: Flag für Momentaufnahme und Storno-Schutz (sonst unverändert, Stand KAN-159)
CREATE OR REPLACE FUNCTION public.kontakte_zusammenfuehren(p_tenant_id uuid, p_behalten uuid, p_weg uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_darf boolean;
  b kontakte%ROWTYPE;
  w kontakte%ROWTYPE;
  r record;
  z record;
  v_mails text[];
  v_notiz text := '';
  v_umgehaengt int := 0;
  v_geloescht int := 0;
BEGIN
  IF p_behalten IS NULL OR p_weg IS NULL OR array_length(p_weg, 1) IS NULL THEN
    RAISE EXCEPTION 'Behaltener Kontakt und mindestens ein zusammenzuführender Kontakt nötig';
  END IF;
  IF p_behalten = ANY (p_weg) THEN RAISE EXCEPTION 'Der behaltene Kontakt kann nicht mit sich selbst zusammengeführt werden'; END IF;

  SELECT session_user = 'postgres' OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
      OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv
                    AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer']))
    INTO v_darf;
  IF NOT v_darf THEN RAISE EXCEPTION 'Keine Berechtigung'; END IF;
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'crm');   -- KAN-159 B9
  -- KAN-150 F1c: Umhängen ändert keine Momentaufnahmen auf Belegen; Verweise an stornierten Belegen dürfen mit
  PERFORM set_config('s112.momentaufnahme_behalten', 'an', true);

  SELECT * INTO b FROM kontakte WHERE id = p_behalten AND tenant_id = p_tenant_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Behaltener Kontakt nicht gefunden'; END IF;
  IF (SELECT count(*) FROM kontakte WHERE id = ANY (p_weg) AND tenant_id = p_tenant_id) <> array_length(p_weg, 1) THEN
    RAISE EXCEPTION 'Nicht alle Kontakte gehören zu diesem Betrieb';
  END IF;

  -- E-Mail-Adressen sammeln (Standard bleibt, alle anderen als weitere)
  v_mails := COALESCE(b.email_weitere, '{}');

  FOR w IN SELECT * FROM kontakte WHERE id = ANY (p_weg) AND tenant_id = p_tenant_id FOR UPDATE LOOP
    -- Leere Felder des behaltenen Kontakts aus dem zusammengeführten ergänzen
    b.vorname          := COALESCE(NULLIF(b.vorname,''), w.vorname);
    b.telefon          := COALESCE(NULLIF(b.telefon,''), w.telefon);
    b.telefon_vorwahl  := COALESCE(b.telefon_vorwahl, w.telefon_vorwahl);
    b.mobil            := COALESCE(NULLIF(b.mobil,''), w.mobil);
    b.mobil_vorwahl    := COALESCE(b.mobil_vorwahl, w.mobil_vorwahl);
    b.strasse          := COALESCE(NULLIF(b.strasse,''), w.strasse);
    b.plz              := COALESCE(NULLIF(b.plz,''), w.plz);
    b.ort              := COALESCE(NULLIF(b.ort,''), w.ort);
    b.land             := COALESCE(NULLIF(b.land,''), w.land);
    b.geburtsdatum     := COALESCE(b.geburtsdatum, w.geburtsdatum);
    b.sprache          := COALESCE(NULLIF(b.sprache,''), w.sprache);
    b.firma_id         := COALESCE(b.firma_id, w.firma_id);
    b.rabattgruppe_id  := COALESCE(b.rabattgruppe_id, w.rabattgruppe_id);
    b.sonderrabatt_pct := COALESCE(NULLIF(b.sonderrabatt_pct,0), w.sonderrabatt_pct);
    b.skonto_pct       := COALESCE(NULLIF(b.skonto_pct,0), w.skonto_pct);
    b.betrieb_nr       := COALESCE(NULLIF(b.betrieb_nr,''), w.betrieb_nr);
    b.debitor_nr       := COALESCE(NULLIF(b.debitor_nr,''), w.debitor_nr);
    b.weingut_ansprechpartner := COALESCE(NULLIF(b.weingut_ansprechpartner,''), w.weingut_ansprechpartner);
    b.newsletter       := COALESCE(b.newsletter,false) OR COALESCE(w.newsletter,false);
    b.newsletter_bestaetigt := COALESCE(b.newsletter_bestaetigt,false) OR COALESCE(w.newsletter_bestaetigt,false);
    b.stammkunde       := COALESCE(b.stammkunde,false) OR COALESCE(w.stammkunde,false);
    b.is_lead          := COALESCE(b.is_lead,false) AND COALESCE(w.is_lead,false);   -- Kunde schlägt Lead
    IF b.email IS NULL OR trim(b.email) = '' THEN
      b.email := w.email;
    ELSIF w.email IS NOT NULL AND lower(trim(w.email)) <> lower(trim(b.email)) THEN
      v_mails := array_append(v_mails, lower(trim(w.email)));
    END IF;
    v_mails := v_mails || COALESCE(w.email_weitere, '{}');
    IF w.notizen IS NOT NULL AND trim(w.notizen) <> '' THEN
      v_notiz := v_notiz || E'\n' || w.notizen;
    END IF;

    -- Alle Fremdschlüssel auf kontakte.id umhängen (dynamisch); bei eindeutigen
    -- Nebenbedingungen (z.B. Ansprechperson je Firma) Zeile für Zeile, Konflikte löschen
    FOR r IN
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND ccu.table_name = 'kontakte' AND ccu.column_name = 'id' AND tc.table_name <> 'kontakte'
    LOOP
      BEGIN
        EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', r.table_name, r.column_name, r.column_name) USING p_behalten, w.id;
        GET DIAGNOSTICS v_umgehaengt = ROW_COUNT;
      EXCEPTION WHEN unique_violation THEN
        FOR z IN EXECUTE format('SELECT ctid AS c FROM %I WHERE %I = $1', r.table_name, r.column_name) USING w.id LOOP
          BEGIN
            EXECUTE format('UPDATE %I SET %I = $1 WHERE ctid = $2', r.table_name, r.column_name) USING p_behalten, z.c;
          EXCEPTION WHEN unique_violation THEN
            EXECUTE format('DELETE FROM %I WHERE ctid = $1', r.table_name) USING z.c;
            v_geloescht := v_geloescht + 1;
          END;
        END LOOP;
      END;
    END LOOP;

    -- Zusammengeführten Kontakt deaktivieren und vermerken
    UPDATE kontakte
       SET aktiv = false,
           notizen = COALESCE(notizen,'') || E'\n[Zusammengeführt in ' || COALESCE(b.accountnummer, b.id::text) || ' am ' || to_char(now(), 'DD.MM.YYYY') || ']',
           aktualisiert_am = now()
     WHERE id = w.id;
  END LOOP;

  -- Adressen bereinigen: eindeutig, ohne die Standardadresse
  SELECT COALESCE(array_agg(DISTINCT m), '{}') INTO v_mails
    FROM unnest(v_mails) AS m
   WHERE m IS NOT NULL AND m <> '' AND (b.email IS NULL OR m <> lower(trim(b.email)));

  UPDATE kontakte SET
    vorname = b.vorname, telefon = b.telefon, telefon_vorwahl = b.telefon_vorwahl, mobil = b.mobil, mobil_vorwahl = b.mobil_vorwahl,
    strasse = b.strasse, plz = b.plz, ort = b.ort, land = b.land, geburtsdatum = b.geburtsdatum, sprache = b.sprache,
    firma_id = b.firma_id, rabattgruppe_id = b.rabattgruppe_id, sonderrabatt_pct = b.sonderrabatt_pct, skonto_pct = b.skonto_pct,
    betrieb_nr = b.betrieb_nr, debitor_nr = b.debitor_nr, weingut_ansprechpartner = b.weingut_ansprechpartner,
    newsletter = b.newsletter, newsletter_bestaetigt = b.newsletter_bestaetigt, stammkunde = b.stammkunde, is_lead = b.is_lead,
    email = b.email, email_weitere = v_mails,
    notizen = CASE WHEN v_notiz <> '' THEN COALESCE(b.notizen,'') || E'\n--- aus zusammengeführten Kontakten ---' || v_notiz ELSE b.notizen END,
    aktualisiert_am = now()
  WHERE id = p_behalten;

  PERFORM set_config('s112.momentaufnahme_behalten', '', true);
  RETURN jsonb_build_object('behalten', p_behalten, 'zusammengefuehrt', array_length(p_weg, 1), 'konflikte_entfernt', v_geloescht, 'email_weitere', to_jsonb(v_mails));
END $function$;

-- 4. Altzeilen einmalig aus dem heutigen Stammsatz (Trigger a_momentaufnahme rechnet; Wartungs-Flag für die
--    Periodensperre der E/A, KAN-149 D3)
SELECT set_config('s112.loeschen_erlaubt', '*', true);
UPDATE public.verkaufsposten   SET partner_daten = '{}'::jsonb WHERE partner_daten IS NULL;
UPDATE public.traubenverkauf   SET partner_daten = '{}'::jsonb WHERE partner_daten IS NULL;
UPDATE public.zukauf_posten    SET partner_daten = '{}'::jsonb WHERE partner_daten IS NULL;
UPDATE public.exportauftraege  SET partner_daten = '{}'::jsonb WHERE partner_daten IS NULL;
UPDATE public.ea_transaktionen SET stamm_daten   = '{}'::jsonb WHERE stamm_daten IS NULL;
SELECT set_config('s112.loeschen_erlaubt', '', true);
