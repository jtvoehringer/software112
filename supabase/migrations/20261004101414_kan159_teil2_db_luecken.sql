-- KAN-159 Teil 2 (04.10.2026): übrige DB-Lücken aus der DB-Testsuite (Entscheidungen Jörgen 04.10.2026)
--   B3   profiles: nur noch das eigene Profil, Profile der Mitglieder gemeinsamer Betriebe und – für
--        Plattform-Admins – alle (vorher plattformweit lesbar, profiles_read_all).
--   B4   tenants: inaktive Mitglieder sahen die tenants-Zeile (get_user_tenant_ids ohne aktiv).
--   B5   NULL-Falle mitgliedschaft_aktiv: globale Stammdaten (tenant_id NULL) verschwanden, sobald irgendeine
--        Mitgliedschaft des Benutzers inaktiv war (duengemittel, ea_kategorien, pflanzenschutzmittel,
--        saetze_massnahmen).
--   B8   abgeschlossener Jahrgang war per API änderbar (Rest von B8; Storno und AMA sind seit KAN-149/148 gesperrt).
--   B10  anon/PUBLIC-EXECUTE auf drei CRM-Hilfsfunktionen und fünf Triggerfunktionen (REVOKE-Regel).
--   B11  Triggerfunktionen mit EXECUTE für authenticated (über PUBLIC).
--   B14  Assistent-Verläufe: privat je Benutzer (vorher für alle Mitglieder des Betriebs lesbar).
--   B15  sechs RPCs mit eigener Mitgliedsprüfung prüfen jetzt selbst die Zwei-Faktor-Stufe.
--   B16  deaktivierter Betrieb (tenants.active = false): Mitglieder lesen und schreiben nichts mehr – wie bei
--        einer inaktiven Mitgliedschaft (mitgliedschaft_aktiv, s112_meine_tenants, pruefe_tenant_zugriff,
--        Storage); Plattform-Admins und Service-Role ausgenommen.
--   BK3  tenant_id ohne FK auf tenants: sieben Tabellen bekommen den FK (ON DELETE CASCADE wie die übrigen 80);
--        bestandsprotokoll und system_ereignisse bleiben bewusst ohne FK (überdauern die Mandanten-Löschung).
-- Nicht hier: B2 (KAN-178), B12.1 (Soll: Mitglieder mit CRM-Schreibrecht löschen Dokumente – wie die App),
-- B17 (Folgeticket), BK4 (newsletter_token, eigener Schritt).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── B16: Hilfsfunktion „Betrieb deaktiviert“ ──────────────────────────────────────────────────────────────
-- SECURITY INVOKER ohne EXECUTE für API-Rollen: nur aus SECURITY-DEFINER-Funktionen aufgerufen (läuft dort als
-- Owner). Plattform-Admins bleiben handlungsfähig (Betrieb wieder aktivieren, Daten prüfen).
CREATE OR REPLACE FUNCTION public.s112_betrieb_gesperrt(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id AND NOT t.active)
     AND NOT EXISTS (SELECT 1 FROM plattform_admins p WHERE p.user_id = (SELECT auth.uid()))
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_betrieb_gesperrt(uuid) FROM PUBLIC, anon, authenticated;

-- Gesperrte Betriebe des Benutzers (RESTRICTIVE-Policy mitgliedschaft_aktiv auf allen Mandantentabellen):
-- inaktive Mitgliedschaft (Migration 221) oder deaktivierter Betrieb (B16)
CREATE OR REPLACE FUNCTION public.s112_gesperrte_tenants()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT m.tenant_id FROM tenant_memberships m
   WHERE m.user_id = (SELECT auth.uid())
     AND (NOT m.aktiv OR public.s112_betrieb_gesperrt(m.tenant_id))
$function$;

CREATE OR REPLACE FUNCTION public.s112_meine_tenants()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT m.tenant_id FROM tenant_memberships m
   WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND NOT public.s112_betrieb_gesperrt(m.tenant_id)
$function$;

CREATE OR REPLACE FUNCTION public.user_has_role_in_tenant(p_tenant_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE user_id   = auth.uid()
       AND tenant_id = p_tenant_id
       AND role      = ANY (p_roles)
       AND aktiv     = true
  ) AND NOT public.s112_betrieb_gesperrt(p_tenant_id)
$function$;

-- B4 + B16: tenants-Zeile (und die Lese-Policies mit get_user_tenant_ids) nur bei aktiver Mitgliedschaft im
-- aktiven Betrieb; app.active_tenant_id (KI-Abfrage) wie bisher
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT tenant_id
    FROM tenant_memberships
   WHERE user_id = auth.uid()
     AND aktiv
     AND NOT public.s112_betrieb_gesperrt(tenant_id)
     AND (
       nullif(current_setting('app.active_tenant_id', true), '') IS NULL
       OR tenant_id = nullif(current_setting('app.active_tenant_id', true), '')::uuid
     )
$function$;

CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL::text[])
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF public.ist_service_kontext() THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE user_id   = auth.uid()
      AND tenant_id = p_tenant_id
      AND aktiv     = true
      AND (p_rollen IS NULL OR role = ANY(p_rollen))
  ) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Betrieb' USING ERRCODE = '42501';
  END IF;

  -- KAN-159 B16: deaktivierter Betrieb (Plattform-Admins ausgenommen)
  IF public.s112_betrieb_gesperrt(p_tenant_id) THEN
    RAISE EXCEPTION 'Der Betrieb ist deaktiviert' USING ERRCODE = '42501', HINT = 'betrieb_deaktiviert';
  END IF;

  -- KAN-136: Faktor eingerichtet, Sitzung aber nur aal1 → kein Zugriff
  IF NOT public.s112_aal_ok() THEN
    RAISE EXCEPTION 'Zwei-Faktor-Anmeldung erforderlich' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- ── B5: NULL-Falle – globale Zeilen (tenant_id NULL) bleiben sichtbar ─────────────────────────────────────
ALTER POLICY mitgliedschaft_aktiv ON public.duengemittel
  USING ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))))
  WITH CHECK ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))));
ALTER POLICY mitgliedschaft_aktiv ON public.ea_kategorien
  USING ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))))
  WITH CHECK ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))));
ALTER POLICY mitgliedschaft_aktiv ON public.pflanzenschutzmittel
  USING ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))))
  WITH CHECK ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))));
ALTER POLICY mitgliedschaft_aktiv ON public.saetze_massnahmen
  USING ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))))
  WITH CHECK ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))));

-- ── B3: Profile nur im eigenen Umfeld ────────────────────────────────────────────────────────────────────
-- Mitglieder (auch inaktive – ihre Namen stehen an alten Buchungen) der Betriebe, in denen der Benutzer aktiv ist
CREATE OR REPLACE FUNCTION public.s112_sichtbare_profile()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT m.user_id FROM tenant_memberships m
   WHERE m.tenant_id IN (SELECT public.s112_meine_tenants())
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_sichtbare_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_sichtbare_profile() TO authenticated;

DROP POLICY profiles_read_all ON public.profiles;
CREATE POLICY profiles_lesen ON public.profiles FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR id IN (SELECT public.s112_sichtbare_profile())
    OR EXISTS (SELECT 1 FROM plattform_admins p WHERE p.user_id = (SELECT auth.uid()))
  );

-- ── B14: Assistent-Verläufe privat je Benutzer ───────────────────────────────────────────────────────────
ALTER POLICY assist_unt_select ON public.assistent_unterhaltungen
  USING (user_id = (SELECT auth.uid())
         AND tenant_id IN (SELECT tenant_memberships.tenant_id FROM tenant_memberships
                            WHERE tenant_memberships.user_id = (SELECT auth.uid())));
ALTER POLICY assist_nach_select ON public.assistent_nachrichten
  USING (unterhaltung_id IN (SELECT u.id FROM assistent_unterhaltungen u WHERE u.user_id = (SELECT auth.uid())));
ALTER POLICY assist_akt_select ON public.assistent_aktionen
  USING (unterhaltung_id IN (SELECT u.id FROM assistent_unterhaltungen u WHERE u.user_id = (SELECT auth.uid())));

-- ── B8: abgeschlossener Jahrgang unveränderlich (API-Rollen) ─────────────────────────────────────────────
-- Die AMA-Felder setzt s112_ama_status_setzen (SECURITY DEFINER, Rolle bleibt authenticated) auch danach;
-- Wartung (Service-Role, SQL-Editor, Demo-Reset) bleibt frei.
CREATE OR REPLACE FUNCTION public.s112_jahrgang_abschluss_schutz()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  c_frei  constant text[] := ARRAY['ama_gemeldet', 'ama_meldedatum', 'ama_meldungsnr', 'updated_at'];
BEGIN
  IF v_rolle NOT IN ('authenticated', 'anon') OR NOT OLD.abgeschlossen THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - c_frei) IS DISTINCT FROM (to_jsonb(OLD) - c_frei) THEN
    RAISE EXCEPTION 'Der Jahrgang % ist abgeschlossen und bleibt unverändert.', OLD.jahrgang
      USING ERRCODE = '42501', HINT = 'jahrgang_abgeschlossen';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_jahrgang_abschluss_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_jahrgang_abschluss_schutz BEFORE UPDATE ON public.weinjahrgaenge
  FOR EACH ROW EXECUTE FUNCTION public.s112_jahrgang_abschluss_schutz();

-- ── B10/B11: EXECUTE-Rechte ──────────────────────────────────────────────────────────────────────────────
-- CRM-Hilfsfunktionen (aus crm_dubletten, SECURITY DEFINER): nicht für anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.crm_dubletten_paar(text, jsonb, jsonb), public.crm_dubletten_stufe(text, jsonb),
  public.crm_norm_name(text) FROM PUBLIC, anon;
-- Triggerfunktionen: EXECUTE wird nur beim Anlegen des Triggers geprüft, nicht beim Auslösen
REVOKE EXECUTE ON FUNCTION public.kundennummer_unveraenderlich_trg(), public.tenant_memberships_schreibmodule_default(),
  public.trg_ea_anlagen_aktualisiert(), public.trg_ea_anlagen_transaktion_tenant(),
  public.trg_ea_transaktion_anlage_tenant() FROM PUBLIC, anon, authenticated;

-- ── BK3: tenant_id → tenants ─────────────────────────────────────────────────────────────────────────────
-- aktivitaet_dokumente hatte nur den FK auf tenant_einstellungen(tenant_id)
ALTER TABLE public.aktivitaet_dokumente
  ADD CONSTRAINT aktivitaet_dokumente_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.exportauftraege
  ADD CONSTRAINT exportauftraege_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.pruefnummernantraege
  ADD CONSTRAINT pruefnummernantraege_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.sonstige_artikel
  ADD CONSTRAINT sonstige_artikel_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.transportbescheinigungen
  ADD CONSTRAINT transportbescheinigungen_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.weinbaugebiete_custom
  ADD CONSTRAINT weinbaugebiete_custom_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.zukauf_posten
  ADD CONSTRAINT zukauf_posten_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ── B15 (+ B16): RPCs mit eigener Mitgliedsprüfung – Zwei-Faktor-Stufe und deaktivierter Betrieb ─────────
-- Rumpf unverändert bis auf die Mitgliedsprüfung (Stand Produktion 04.10.2026)

CREATE OR REPLACE FUNCTION public.crm_dubletten(p_tenant_id uuid)
 RETURNS TABLE(art text, schluessel text, anzahl integer, stufe text, kontakte jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
        OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id)) AS darf
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
    SELECT s.art, s.schluessel, array_agg(DISTINCT s.id ORDER BY s.id) AS ids
    FROM schluessel s
    GROUP BY s.art, s.schluessel
    HAVING count(DISTINCT s.id) > 1
  ),
  gruppen2 AS (
    SELECT g.* FROM gruppen g
    WHERE g.art = 'email'
       OR NOT EXISTS (SELECT 1 FROM gruppen e WHERE e.art = 'email' AND e.ids = g.ids)
  ),
  mit_kontakten AS (
    SELECT g.art, g.schluessel, array_length(g.ids, 1) AS anzahl,
           (SELECT jsonb_agg(jsonb_build_object(
                'id', k.id, 'accountnummer', k.accountnummer, 'vorname', k.vorname, 'nachname', k.nachname,
                'email', k.email, 'email_weitere', to_jsonb(k.email_weitere), 'plz', k.plz, 'ort', k.ort, 'telefon', k.telefon,
                'is_lead', k.is_lead, 'erstellt_am', k.erstellt_am, 'firma_id', k.firma_id,
                'anz_aktivitaeten', k.anz_aktivitaeten, 'anz_verkaeufe', k.anz_verkaeufe)
              ORDER BY k.anz_verkaeufe DESC, k.anz_aktivitaeten DESC, k.erstellt_am)
            FROM k WHERE k.id = ANY (g.ids)) AS kontakte
    FROM gruppen2 g
    WHERE NOT EXISTS (SELECT 1 FROM crm_dubletten_ignoriert i WHERE i.tenant_id = p_tenant_id AND i.schluessel = g.schluessel)
  )
  SELECT m.art, m.schluessel, m.anzahl, crm_dubletten_stufe(m.art, m.kontakte) AS stufe, m.kontakte
  FROM mit_kontakten m
  ORDER BY CASE crm_dubletten_stufe(m.art, m.kontakte) WHEN 'sicher' THEN 0 WHEN 'pruefen' THEN 1 ELSE 2 END, m.art, m.schluessel
$function$;

CREATE OR REPLACE FUNCTION public.crm_filterwerte(p_tenant_id uuid)
 RETURNS TABLE(art text, wert text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
        OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id)) AS darf
  ),
  werte AS (
    SELECT 'ort' AS art, k.ort AS wert FROM kontakte k, ok WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv AND k.ort IS NOT NULL AND k.ort <> ''
    UNION
    SELECT 'ort', f.ort FROM firmen f, ok WHERE ok.darf AND f.tenant_id = p_tenant_id AND f.aktiv AND f.ort IS NOT NULL AND f.ort <> ''
    UNION
    SELECT 'land', k.land FROM kontakte k, ok WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv AND k.land IS NOT NULL AND k.land <> ''
    UNION
    SELECT 'land', f.land FROM firmen f, ok WHERE ok.darf AND f.tenant_id = p_tenant_id AND f.aktiv AND f.land IS NOT NULL AND f.land <> ''
  )
  SELECT art, wert FROM werte ORDER BY art, wert
$function$;

CREATE OR REPLACE FUNCTION public.crm_zaehler(p_tenant_id uuid)
 RETURNS TABLE(art text, segment text, is_lead boolean, ist_kunde boolean, ist_lieferant boolean, anzahl bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
        OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id)) AS darf
  )
  SELECT 'kontakt', k.segment::text, COALESCE(k.is_lead,false), true, false, COUNT(*)
    FROM kontakte k, ok WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv
    GROUP BY k.segment, COALESCE(k.is_lead,false)
  UNION ALL
  SELECT 'firma', f.segment::text, COALESCE(f.is_lead,false), COALESCE(f.ist_kunde,true), COALESCE(f.ist_lieferant,false), COUNT(*)
    FROM firmen f, ok WHERE ok.darf AND f.tenant_id = p_tenant_id AND f.aktiv
    GROUP BY f.segment, COALESCE(f.is_lead,false), COALESCE(f.ist_kunde,true), COALESCE(f.ist_lieferant,false)
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
      OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv
                    AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer']))
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id))
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

CREATE OR REPLACE FUNCTION public.lade_behaelter(p_tenant_id uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, name text, typ text, volumen_liter numeric, standort text, aktiv boolean, gemeinsam boolean, stapler boolean, notizen text, import_quelle text, eigentuemer_name text, fremd boolean, eigen_liter numeric, fremd_liter numeric, fremd_betrieb text)
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
          ORDER BY w.updated_at DESC LIMIT 1) AS fremd_betrieb
  FROM behaelter b
  JOIN tenants t ON t.id = b.tenant_id
  WHERE (
          session_user = 'postgres'
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
          OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id))
        )
    AND (
          b.tenant_id = p_tenant_id
          OR (b.gemeinsam AND EXISTS (
                SELECT 1 FROM keller_freigaben f
                WHERE f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = p_tenant_id AND f.aktiv))
        )
  ORDER BY b.name
$function$;

CREATE OR REPLACE FUNCTION public.lade_kellergemeinschaft(p_tenant_id uuid)
 RETURNS TABLE(rolle text, partner_tenant_id uuid, partner_name text, notizen text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN 'eigentuemer' ELSE 'nutzer' END AS rolle,
         CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN f.nutzer_tenant_id ELSE f.eigentuemer_tenant_id END AS partner_tenant_id,
         t.name AS partner_name, f.notizen
  FROM keller_freigaben f
  JOIN tenants t ON t.id = CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN f.nutzer_tenant_id ELSE f.eigentuemer_tenant_id END
  WHERE f.aktiv
    AND (f.eigentuemer_tenant_id = p_tenant_id OR f.nutzer_tenant_id = p_tenant_id)
    AND (session_user = 'postgres'
         OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
         OR (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
            /* KAN-159 B15/B16 */ AND public.s112_aal_ok() AND NOT public.s112_betrieb_gesperrt(p_tenant_id)))
  ORDER BY 1, 3
$function$;
