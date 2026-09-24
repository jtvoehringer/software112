-- Migration 213 (18.9.2026): Kontakt-Dubletten erkennen und zusammenführen
-- Rückmeldung: "bei den möglichen Dubletten draufzuklicken führt dich in die
-- Kontakte, aber die Dubletten findest du so nicht mehr - hier wäre eine Liste
-- oder weiterführende Unterstützung zwecks Zusammenführen hilfreich."
--
-- 1. crm_dubletten(p_tenant_id): Gruppen gleicher E-Mail (Standard + weitere)
--    bzw. gleichen Namens (Vor-/Nachname ohne Akzente/Groß-Klein) - serverseitig,
--    damit auch 8.300 Kontakte vollständig geprüft werden (der Morgenbericht sah
--    bisher nur die ersten 1.000 Zeilen). Ignorierte Gruppen (Tabelle
--    crm_dubletten_ignoriert) werden ausgelassen.
-- 2. kontakte_zusammenfuehren(p_tenant_id, p_behalten, p_weg[]): hängt alle
--    Verweise (Aktivitäten, Verkäufe, Pipeline, Bestellungen, Zukäufe,
--    Exportaufträge, Ansprechpersonen, Präferenzen, Consents - dynamisch über
--    die Fremdschlüssel) auf den behaltenen Kontakt um, ergänzt leere Felder
--    aus den zusammengeführten Datensätzen, sammelt alle E-Mail-Adressen und
--    deaktiviert die zusammengeführten Kontakte (aktiv = false, Vermerk in den
--    Notizen). Nichts wird gelöscht.

CREATE TABLE IF NOT EXISTS crm_dubletten_ignoriert (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schluessel  text NOT NULL,
  erstellt_von uuid,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, schluessel)
);
ALTER TABLE crm_dubletten_ignoriert ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_dubl_ign_select ON crm_dubletten_ignoriert;
CREATE POLICY crm_dubl_ign_select ON crm_dubletten_ignoriert FOR SELECT
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (select auth.uid()) AND m.aktiv));
DROP POLICY IF EXISTS crm_dubl_ign_write ON crm_dubletten_ignoriert;
CREATE POLICY crm_dubl_ign_write ON crm_dubletten_ignoriert FOR ALL
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));

-- Namensnormalisierung: klein, ohne Akzente, nur Buchstaben/Ziffern
CREATE OR REPLACE FUNCTION crm_norm_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(translate(coalesce(p,''), 'äöüßÄÖÜáàâéèêíìîóòôúùûçñ', 'aousAOUaaaeeeiiiooouuucn')), '[^a-z0-9]+', '', 'g')
$$;

CREATE OR REPLACE FUNCTION crm_dubletten(p_tenant_id uuid)
RETURNS TABLE (art text, schluessel text, anzahl int, kontakte jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
        OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv) AS darf
  ),
  k AS (
    SELECT k.id, k.accountnummer, k.vorname, k.nachname, k.email, k.email_weitere, k.plz, k.ort, k.telefon, k.is_lead, k.erstellt_am, k.firma_id,
           (SELECT count(*) FROM aktivitaeten a WHERE a.kontakt_id = k.id) AS anz_aktivitaeten,
           (SELECT count(*) FROM verkaufsposten v WHERE v.kontakt_id = k.id) AS anz_verkaeufe
    FROM kontakte k, ok
    WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv
  ),
  adressen AS (
    SELECT id, lower(trim(email)) AS e FROM k WHERE email IS NOT NULL AND trim(email) <> ''
    UNION
    SELECT k.id, lower(trim(w)) FROM k, unnest(k.email_weitere) AS w WHERE trim(w) <> ''
  ),
  schluessel AS (
    SELECT 'email' AS art, 'm:' || e AS schluessel, id FROM adressen
    UNION
    SELECT 'name', 'n:' || crm_norm_name(vorname) || '|' || crm_norm_name(nachname), id FROM k
     WHERE crm_norm_name(vorname) <> '' AND crm_norm_name(nachname) <> ''
  ),
  gruppen AS (
    SELECT s.art, s.schluessel, array_agg(DISTINCT s.id) AS ids
    FROM schluessel s
    GROUP BY s.art, s.schluessel
    HAVING count(DISTINCT s.id) > 1
  )
  SELECT g.art, g.schluessel, array_length(g.ids, 1) AS anzahl,
         (SELECT jsonb_agg(jsonb_build_object(
              'id', k.id, 'accountnummer', k.accountnummer, 'vorname', k.vorname, 'nachname', k.nachname,
              'email', k.email, 'email_weitere', to_jsonb(k.email_weitere), 'plz', k.plz, 'ort', k.ort, 'telefon', k.telefon,
              'is_lead', k.is_lead, 'erstellt_am', k.erstellt_am, 'firma_id', k.firma_id,
              'anz_aktivitaeten', k.anz_aktivitaeten, 'anz_verkaeufe', k.anz_verkaeufe)
            ORDER BY k.anz_verkaeufe DESC, k.anz_aktivitaeten DESC, k.erstellt_am)
          FROM k WHERE k.id = ANY (g.ids)) AS kontakte
  FROM gruppen g
  WHERE NOT EXISTS (SELECT 1 FROM crm_dubletten_ignoriert i WHERE i.tenant_id = p_tenant_id AND i.schluessel = g.schluessel)
  ORDER BY g.art, g.schluessel
$$;
GRANT EXECUTE ON FUNCTION crm_dubletten(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION kontakte_zusammenfuehren(p_tenant_id uuid, p_behalten uuid, p_weg uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION kontakte_zusammenfuehren(uuid, uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION kontakte_zusammenfuehren(uuid, uuid, uuid[]) TO authenticated, service_role;
