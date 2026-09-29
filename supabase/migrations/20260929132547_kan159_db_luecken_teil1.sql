-- KAN-159 Teil 1 (29.09.2026): DB-Lücken aus der DB-Testsuite schließen
--   B1   zahlungen: Zahlung auf einen Verkaufsposten eines FREMDEN Betriebs setzte ihn über den
--        SECURITY-DEFINER-Trigger sync_verkaufsposten_bezahlt auf „bezahlt“.
--   BK1/BK2  TRUNCATE-Recht für authenticated/anon (Supabase-Standardrecht; TRUNCATE umgeht RLS).
--   B9   acht schreibende RPCs prüften Rolle und Abo, aber nicht das Schreibmodul des Winzers.
--   B13  benachrichtigungen: eigene Benachrichtigung ließ sich per UPDATE in einen fremden Betrieb umhängen.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── B9: Modulprüfung für RPCs ─────────────────────────────────────────────────────────────────────────
-- Wie s112_pruefe_abo_schreibsperre: SECURITY INVOKER, nur aus SECURITY-DEFINER-RPCs aufgerufen.
-- Service-Role/SQL-Editor passieren (wie pruefe_tenant_zugriff); sonst gilt s112_darf_schreiben
-- (Admins immer, Winzer mit einem der Module, eines genügt).
CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  IF public.ist_service_kontext() THEN
    RETURN;
  END IF;
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC p_module) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für dieses Modul (%).', array_to_string(p_module, ' oder ')
      USING ERRCODE = '42501', HINT = 'modul_fehlt';
  END IF;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pruefe_schreibmodul(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- Module je RPC wie die RESTRICTIVE modul_*-Policies der Tabellen, die der jeweilige Aufrufer beschreibt
-- (Stand Staging 29.09.2026):
--   get_next_accountnummer      kontakte/firmen                       → crm
--   get_next_chargennummer      fuellungen                            → kellerbuch, warenwirtschaft
--   get_next_liefernummer       ernte_parzellen, traubenverkauf, verkaufsposten → rieden, kellerbuch, warenwirtschaft
--   get_next_personenkonto      BMD-Export (App verlangt ea)          → ea
--   get_next_rechnungsnummer    verkaufsposten, traubenverkauf        → warenwirtschaft, rieden
--   get_next_transaktionsnr     je Typ (umzug/eroeffnung → keller_umzuege bzw. Kellerbuch, verkauf → verkaufsposten,
--                               kosteneintrag → kosteneintraege; sonst jedes Schreibmodul)
--   kontakte_zusammenfuehren    kontakte                              → crm
--   setze_kontobewegung_abgeglichen  je Quelle (zahlung → warenwirtschaft, ea; sonst ea); is_locked bleibt bewusst
--                               ungeprüft (Abgleich auch nach Monatsabschluss, siehe konten/actions.ts)

CREATE OR REPLACE FUNCTION public.get_next_accountnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix   text;
  v_stellen  integer;
  v_zaehler  integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'crm');   -- KAN-159 B9

  UPDATE tenant_einstellungen
  SET    account_zaehler = account_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING account_prefix, account_stellen, account_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF length(v_zaehler::text) >= COALESCE(v_stellen, 0) THEN
    RETURN v_prefix || '-' || v_zaehler::text;
  END IF;
  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_chargennummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_prefix TEXT; v_stellen INTEGER; v_zaehler INTEGER; v_jahr TEXT;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch', 'warenwirtschaft');   -- KAN-159 B9

  UPDATE tenant_einstellungen SET charge_zaehler = charge_zaehler + 1
  WHERE tenant_id = p_tenant_id
  RETURNING charge_prefix, charge_stellen, charge_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;
  v_jahr := to_char(now(), 'YYYY');
  RETURN v_prefix || '-' || v_jahr || '-' || lpad(v_zaehler::TEXT, v_stellen, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_liefernummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix   TEXT;
  v_zaehler  INTEGER;
  v_stellen  INTEGER;
  v_jahr     TEXT;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden', 'kellerbuch', 'warenwirtschaft');   -- KAN-159 B9

  UPDATE tenant_einstellungen
  SET    liefernummer_zaehler = liefernummer_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING liefernummer_prefix, liefernummer_zaehler, liefernummer_stellen
  INTO v_prefix, v_zaehler, v_stellen;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % nicht gefunden', p_tenant_id;
  END IF;

  v_jahr := to_char(CURRENT_DATE, 'YYYY');
  RETURN v_prefix || '-' || v_jahr || '-' || lpad(v_zaehler::TEXT, v_stellen, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_personenkonto(p_tenant_id uuid, p_art text, p_basis integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_zaehler integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');   -- KAN-159 B9
  IF p_art = 'debitor' THEN
    UPDATE tenant_einstellungen SET bmd_debitor_zaehler = bmd_debitor_zaehler + 1
    WHERE tenant_id = p_tenant_id RETURNING bmd_debitor_zaehler INTO v_zaehler;
  ELSIF p_art = 'kreditor' THEN
    UPDATE tenant_einstellungen SET bmd_kreditor_zaehler = bmd_kreditor_zaehler + 1
    WHERE tenant_id = p_tenant_id RETURNING bmd_kreditor_zaehler INTO v_zaehler;
  ELSE
    RAISE EXCEPTION 'Unbekannte Kontoart %', p_art;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN (p_basis + v_zaehler)::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_rechnungsnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix   text;
  v_suffix   text;
  v_stellen  integer;
  v_zaehler  integer;
  v_row_jahr integer;
  v_jahr     integer := extract(year from now())::int;
  v_nummer   integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft', 'rieden');   -- KAN-159 B9

  SELECT rechnung_prefix, rechnung_suffix, rechnung_stellen, rechnung_zaehler, rechnung_zaehler_jahr
  INTO   v_prefix, v_suffix, v_stellen, v_zaehler, v_row_jahr
  FROM   tenant_einstellungen
  WHERE  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Reset nur bei Jahreswechsel UND nur wenn der Suffix einen Jahres-Platzhalter
  -- enthält (sonst bliebe die Nummer nach dem Reset nicht mehr eindeutig).
  IF coalesce(v_suffix, '') LIKE '%{JJ%' AND v_row_jahr IS DISTINCT FROM v_jahr THEN
    v_nummer := 1;
  ELSE
    v_nummer := v_zaehler;
  END IF;

  UPDATE tenant_einstellungen
  SET    rechnung_zaehler      = v_nummer + 1,
         rechnung_zaehler_jahr = v_jahr
  WHERE  tenant_id = p_tenant_id;

  RETURN v_prefix || '-' || lpad(v_nummer::text, v_stellen, '0') ||
         replace(replace(coalesce(v_suffix, ''), '{JJJJ}', v_jahr::text), '{JJ}', lpad((v_jahr % 100)::text, 2, '0'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_next_transaktionsnr(p_tenant_id uuid, p_typ text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_jahr    integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_prefix  text;
  v_zaehler integer;
  v_stellen integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  -- KAN-159 B9: Modul je Typ wie die Tabelle, für die die Nummer vergeben wird
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, VARIADIC CASE p_typ
    WHEN 'umzug'         THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'eroeffnung'    THEN ARRAY['kellerbuch']
    WHEN 'verkauf'       THEN ARRAY['warenwirtschaft']
    WHEN 'kosteneintrag' THEN ARRAY['auswertungen', 'rieden', 'kellerbuch']
    ELSE ARRAY['rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'auswertungen']
  END);

  v_prefix := CASE p_typ
    WHEN 'umzug'         THEN 'KU'
    WHEN 'eroeffnung'    THEN 'EB'
    WHEN 'verkauf'       THEN 'VK'
    WHEN 'kosteneintrag' THEN 'KE'
    ELSE 'TX'
  END;

  INSERT INTO transaktionszaehler (tenant_id, typ, prefix, zaehler, jahr, stellen)
  VALUES (p_tenant_id, p_typ, v_prefix, 1, v_jahr, 4)
  ON CONFLICT (tenant_id, typ, jahr) DO UPDATE
    SET zaehler = transaktionszaehler.zaehler + 1
  RETURNING prefix, zaehler, stellen
    INTO v_prefix, v_zaehler, v_stellen;

  RETURN v_prefix || '-' || v_jahr || '-' || LPAD(v_zaehler::text, v_stellen, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.setze_kontobewegung_abgeglichen(p_tenant_id uuid, p_quelle text, p_id uuid, p_abgeglichen boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  -- KAN-159 B9: Modul wie die RLS der jeweiligen Tabelle
  IF p_quelle = 'zahlung' THEN
    PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft', 'ea');
  ELSE
    PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  END IF;

  IF p_quelle = 'zahlung' THEN
    UPDATE zahlungen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'ea_transaktion' THEN
    -- bewusst unabhängig von is_locked: Abgleich bleibt nach Monatsabschluss/UVA möglich (konten/actions.ts)
    UPDATE ea_transaktionen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_von' THEN
    UPDATE konto_umbuchungen SET von_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_nach' THEN
    UPDATE konto_umbuchungen SET nach_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSE
    RAISE EXCEPTION 'Unbekannte Quelle: %', p_quelle;
  END IF;
END;
$function$;

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

  RETURN jsonb_build_object('behalten', p_behalten, 'zusammengefuehrt', array_length(p_weg, 1), 'konflikte_entfernt', v_geloescht, 'email_weitere', to_jsonb(v_mails));
END $function$;

-- ── B1: Zahlung nur auf Verkaufsposten des eigenen Betriebs ────────────────────────────────────────────
-- Der AFTER-Trigger läuft als SECURITY DEFINER (sieht alle Betriebe). Jetzt: Verkaufsposten eines anderen
-- Betriebs → Fehler 42501 (die Zahlung wird mit zurückgerollt), Neuberechnung nur im Betrieb der Zahlung.
-- Nebenbei: Wird eine Zahlung auf einen anderen Verkaufsposten umgehängt, rechnet der Trigger jetzt beide
-- Posten neu (bisher nur den neuen – der alte blieb fälschlich „bezahlt“).
CREATE OR REPLACE FUNCTION public.sync_verkaufsposten_bezahlt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id       uuid;
  v_tenant   uuid;
  v_gesamt   numeric(10,2);
  v_gezahlt  numeric(10,2);
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.verkaufsposten_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM verkaufsposten v WHERE v.id = NEW.verkaufsposten_id AND v.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Der Verkaufsposten gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
  END IF;

  FOR v_id, v_tenant IN
    SELECT DISTINCT x.id, x.tenant_id
      FROM (VALUES (CASE WHEN TG_OP <> 'INSERT' THEN OLD.verkaufsposten_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.tenant_id END),
                   (CASE WHEN TG_OP <> 'DELETE' THEN NEW.verkaufsposten_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.tenant_id END)) AS x (id, tenant_id)
     WHERE x.id IS NOT NULL
  LOOP
    SELECT COALESCE(SUM(
      ROUND(vp.menge * COALESCE(vp.preis_brutto, 0)
        * (1 - COALESCE(vp.rabatt_pct, 0) / 100)
        * (1 - COALESCE(vp.sonderrabatt_pct, 0) / 100), 2)
    ), 0) INTO v_gesamt
    FROM verkauf_positionen vp WHERE vp.verkaufsposten_id = v_id;

    SELECT COALESCE(SUM(betrag), 0) INTO v_gezahlt
    FROM zahlungen WHERE verkaufsposten_id = v_id AND tenant_id = v_tenant;

    UPDATE verkaufsposten
    SET bezahlt    = (v_gezahlt >= v_gesamt AND v_gesamt > 0),
        bezahlt_am = CASE WHEN v_gezahlt >= v_gesamt AND v_gesamt > 0 THEN now() ELSE NULL END
    WHERE id = v_id AND tenant_id = v_tenant;
  END LOOP;

  RETURN NULL;   -- AFTER-Trigger: Rückgabewert wird ignoriert
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.sync_verkaufsposten_bezahlt() FROM PUBLIC, anon, authenticated;

-- ── BK1/BK2: kein TRUNCATE für die API-Rollen ─────────────────────────────────────────────────────────
-- TRUNCATE unterliegt keiner RLS. Über PostgREST nicht erreichbar, aber ein Supabase-Standardrecht, das hier
-- niemand braucht (Service-Role und postgres behalten es). Auch für künftige Tabellen des Owners postgres.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- ── B13: Benachrichtigungen nicht in fremde Betriebe umhängen ─────────────────────────────────────────
-- Benutzer setzen nur gelesen_am (api/benachrichtigungen); alles andere schreibt der Server per Service-Role.
-- Statt einer Policy-Erweiterung Spaltenrechte: tenant_id, empfaenger_id usw. sind für Benutzer nicht änderbar.
REVOKE UPDATE ON public.benachrichtigungen FROM anon, authenticated;
GRANT UPDATE (gelesen_am) ON public.benachrichtigungen TO authenticated;

-- ── Selbstprüfung ─────────────────────────────────────────────────────────────────────────────────────
DO $pruefung$
DECLARE
  v_n int;
  v_txt text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'KAN-159: noch % Tabellen mit TRUNCATE für anon/authenticated', v_n; END IF;

  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_txt FROM pg_attribute a
   WHERE a.attrelid = 'public.benachrichtigungen'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');
  IF v_txt IS DISTINCT FROM 'gelesen_am' THEN RAISE EXCEPTION 'KAN-159: benachrichtigungen UPDATE-Spalten = %', v_txt; END IF;
  IF has_column_privilege('anon', 'public.benachrichtigungen', 'gelesen_am', 'UPDATE') THEN
    RAISE EXCEPTION 'KAN-159: anon darf benachrichtigungen ändern';
  END IF;

  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO v_txt FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_next_accountnummer', 'get_next_chargennummer', 'get_next_liefernummer', 'get_next_personenkonto',
                       'get_next_rechnungsnummer', 'get_next_transaktionsnr', 'kontakte_zusammenfuehren',
                       'setze_kontobewegung_abgeglichen')
     AND p.prosrc !~ 's112_pruefe_schreibmodul';
  IF v_txt IS NOT NULL THEN RAISE EXCEPTION 'KAN-159: ohne Modulprüfung: %', v_txt; END IF;

  IF has_function_privilege('authenticated', 'public.s112_pruefe_schreibmodul(uuid, text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_pruefe_schreibmodul(uuid, text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sync_verkaufsposten_bezahlt()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-159: EXECUTE-Rechte zu weit';
  END IF;
END
$pruefung$;
