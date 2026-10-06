-- @bereich: CRM-Gemeinschaft – CRM zwischen Mandanten gemeinsam nutzen (KAN-212)
-- @ziel: Mit aktiver crm_freigaben-Zeile (Eigentümer → Nutzer) liest der Nutzer-Betrieb Kontakte, Firmen, Aktivitäten
-- @ziel: (ohne private) und Pipeline des Eigentümers, ändert sie aber nicht; seine Belege (Verkauf) dürfen auf die
-- @ziel: Kontakte zeigen, die Momentaufnahme lässt Kundennummer/Debitor des Eigentümers leer. Ohne bzw. mit inaktiver
-- @ziel: Freigabe und in Gegenrichtung bleibt alles getrennt; die Freigabe pflegt nur die Service-Role.
-- @mutation partner_policy_weg: keine Partner-Policy auf kontakte | rot: partner_liest_kontakt
-- @mutation privat_sichtbar: Partner-Policy auf aktivitaeten ohne ist_privat-Bedingung | rot: privat_verborgen
-- @mutation verkauf_ohne_crm: Fremdverweis verkaufsposten.kontakt_id wieder nur eigener Betrieb | rot: beleg_mit_partner_kontakt
-- @mutation momentaufnahme_mit_nummer: s112_momentaufnahme_fremd lässt die Nummern stehen | rot: momentaufnahme_ohne_nummer
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 43 (Stand 06.10.2026, KAN-212). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '43_crm_gemeinschaft';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_bw    uuid;
  v_mw    uuid;
  v_k     uuid;
  v_f     uuid;
  v_kb    uuid;
  v_akt   uuid;
  v_aktp  uuid;
  v_pipe  uuid;
  v_fg    uuid;
  v_vp    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_k := (pg_temp.s112_beispiel('kontakte', v_m, NULL, jsonb_build_object('nachname', 'S112TEST Partnerkunde', 'accountnummer', 'K-4711', 'debitor_nr', '20999')) ->> 'id')::uuid;
  v_f := (pg_temp.s112_beispiel('firmen', v_m, NULL, jsonb_build_object('name', 'S112TEST Partnerfirma')) ->> 'id')::uuid;
  v_kb := (pg_temp.s112_beispiel('kontakte', v_b, NULL, jsonb_build_object('nachname', 'S112TEST Kunde B')) ->> 'id')::uuid;
  v_akt := (pg_temp.s112_beispiel('aktivitaeten', v_m, NULL, jsonb_build_object('kontakt_id', v_k, 'ist_privat', false)) ->> 'id')::uuid;
  v_aktp := (pg_temp.s112_beispiel('aktivitaeten', v_m, NULL, jsonb_build_object('kontakt_id', v_k, 'ist_privat', true)) ->> 'id')::uuid;
  v_pipe := (pg_temp.s112_beispiel('pipeline_eintraege', v_m, NULL, jsonb_build_object('kontakt_id', v_k)) ->> 'id')::uuid;
  DELETE FROM public.crm_freigaben WHERE v_m IN (eigentuemer_tenant_id, nutzer_tenant_id) OR v_b IN (eigentuemer_tenant_id, nutzer_tenant_id);   -- storno-ausnahme: Testaufbau, wird zurückgerollt

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('partner_policy_weg', $m$DROP POLICY kontakte_crm_partner ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('privat_sichtbar',
    $m$ALTER POLICY akt_crm_partner ON public.aktivitaeten USING (tenant_id IN (SELECT public.s112_crm_partner_tenants()))$m$);
  PERFORM pg_temp.s112_mutiere('verkauf_ohne_crm', $m$DROP TRIGGER z_fremdverweis_kontakt_id ON public.verkaufsposten;
    CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.verkaufsposten
      FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '')$m$);
  PERFORM pg_temp.s112_mutiere('momentaufnahme_mit_nummer', $m$CREATE OR REPLACE FUNCTION public.s112_momentaufnahme_fremd(p_teil jsonb, p_tabelle text, p_id uuid, p_tenant uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $x$ SELECT p_teil $x$$m$);

  -- ── 1. Ohne Freigabe: getrennt ────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_freigabe_getrennt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE id = %L::uuid', v_k)), '0');
  v_txt := pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, kontakt_id) VALUES (%L, current_date, %L)', v_b, v_k));
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_freigabe_kein_beleg', left(v_txt, 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_nicht_per_api',
    left(pg_temp.s112_fehlertext(format('INSERT INTO public.crm_freigaben (eigentuemer_tenant_id, nutzer_tenant_id) VALUES (%L, %L)', v_m, v_b)), 5), '42501');

  -- ── 2. Aktive Freigabe Musterhof → B ──────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.crm_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, notizen) VALUES (v_m, v_b, 'S112TEST CRM') RETURNING id INTO v_fg;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('partner_liest_kontakt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE id = %L::uuid', v_k)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('partner_liest_firma',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.firmen WHERE id = %L::uuid', v_f)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('partner_liest_aktivitaet',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaeten WHERE id = %L::uuid', v_akt)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('privat_verborgen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaeten WHERE id = %L::uuid', v_aktp)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('partner_liest_pipeline',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.pipeline_eintraege WHERE id = %L::uuid', v_pipe)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('partner_aendert_nicht',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET notizen = %L WHERE id = %L', 'S112TEST fremd', v_k)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('partner_keine_aktivitaet_beim_eigentuemer',
    left(pg_temp.s112_fehlertext(format('INSERT INTO public.aktivitaeten (tenant_id, art, betreff, kontakt_id) VALUES (%L, %L, %L, %L)', v_m, 'notiz', 'S112TEST', v_k)), 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('partner_aktivitaet_nicht_am_fremden_kontakt',
    left(pg_temp.s112_fehlertext(format('INSERT INTO public.aktivitaeten (tenant_id, art, betreff, kontakt_id) VALUES (%L, %L, %L, %L)', v_b, 'notiz', 'S112TEST', v_k)), 5), '42501');
  v_txt := pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, kontakt_id) VALUES (%L, current_date, %L)', v_b, v_k));
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_mit_partner_kontakt', v_txt, 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_lade_crmgemeinschaft',
    (SELECT string_agg(rolle || ':' || (partner_tenant_id = v_m)::text, ',') FROM public.lade_crmgemeinschaft(v_b)), 'nutzer:true');

  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_vp FROM public.verkaufsposten WHERE tenant_id = v_b AND kontakt_id = v_k ORDER BY erstellt_am DESC LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('momentaufnahme_ohne_nummer',
    (SELECT (partner_daten -> 'kontakt' ->> 'nachname') || '|' || coalesce(partner_daten -> 'kontakt' ->> 'accountnummer', '-')
            || '|' || coalesce(partner_daten -> 'kontakt' ->> 'debitor_nr', '-') || '|' || coalesce(partner_daten -> 'kontakt' ->> 'crm_gemeinschaft', '-')
       FROM public.verkaufsposten WHERE id = v_vp), 'S112TEST Partnerkunde|-|-|true');
  v_erg := v_erg || pg_temp.s112_erwarte('eigener_beleg_mit_nummer',
    (SELECT pg_temp.s112_zeile('verkaufsposten', v_m, jsonb_build_object('kontakt_id', v_k)) -> 'partner_daten' -> 'kontakt' ->> 'accountnummer'), 'K-4711');

  -- ── 3. Gegenrichtung und inaktive Freigabe ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('einseitig_eigentuemer_sieht_partner_nicht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE id = %L::uuid', v_kb)), '0');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.crm_freigaben SET aktiv = false WHERE id = v_fg;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('inaktiv_getrennt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE id = %L::uuid', v_k)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('inaktiv_kein_beleg',
    left(pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, kontakt_id) VALUES (%L, current_date, %L)', v_b, v_k)), 5), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 18);
END $test$;
