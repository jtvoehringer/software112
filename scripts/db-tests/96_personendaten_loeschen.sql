-- @bereich: CRM – Personendaten eines Kontakts löschen (DSGVO Art. 17, KAN-425 Teil 1)
-- @ziel: s112_kontakt_personendaten_loeschen löscht einen Kontakt ohne Belege ganz und anonymisiert einen Kontakt mit
-- @ziel: Belegen (Kundennummer bleibt, Personendaten leer, Beleg-Momentaufnahme unverändert). Aktivitäten samt
-- @ziel: Mail-Inhalten, Vorhaben, Lieferadressen und Einwilligungs-Nachweise gehen in beiden Fällen. Der anonymisierte
-- @ziel: Kontakt ist unveränderlich, das Kennzeichen setzt nur die RPC. Leser, Mitarbeiter ohne CRM und fremde Betriebe
-- @ziel: kommen nicht durch; im Protokoll steht der Vorgang ohne Altwerte.
-- @mutation ohne_schutz: Trigger a_anonymisiert_schutz entfernt | rot: (danach_unveraenderlich|kennzeichen_nur_rpc|reaktivieren_gesperrt)
-- @mutation ohne_crm_pruefung: s112_pruefe_schreibmodul prüft nichts mehr | rot: ohne_crm_recht
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 96 (Stand 12.11.2026, KAN-425). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '96_personendaten_loeschen';
  c_rpc   constant text := 'SELECT public.s112_kontakt_personendaten_loeschen(%L::uuid, %L::uuid, %L)';
  c_grund constant text := 'S112TEST Löschersuchen per E-Mail';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_ohne  uuid;   -- Kontakt ohne Belege
  v_mit   uuid;   -- Kontakt mit Verkauf
  v_rest  uuid;   -- Kontakt für die Rechteprüfungen
  v_km    uuid;   -- Kontakt im fremden Betrieb
  v_vp    uuid;
  v_snap  jsonb;
  v_r     jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['warenwirtschaft']);   -- Mitarbeiter ohne CRM
  v_ohne := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('vorname', 'S112TEST', 'nachname', 'Ohnebeleg', 'email', 's112test-ohne@software112.test', 'accountnummer', 'S112TEST-1')) ->> 'id')::uuid;
  v_mit := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('vorname', 'S112TEST', 'nachname', 'Mitbeleg', 'email', 's112test-mit@software112.test',
             'telefon', '0664 000', 'strasse', 'Testgasse 1', 'plz', '1010', 'ort', 'Wien', 'notizen', 'S112TEST Notiz', 'accountnummer', 'S112TEST-2', 'newsletter', true)) ->> 'id')::uuid;
  v_rest := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('nachname', 'S112TEST Rest')) ->> 'id')::uuid;
  v_km := (pg_temp.s112_zeile('kontakte', v_m, jsonb_build_object('nachname', 'S112TEST Fremd')) ->> 'id')::uuid;
  v_vp := (pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('kontakt_id', v_mit, 'firma_id', NULL)) ->> 'id')::uuid;
  SELECT partner_daten INTO v_snap FROM public.verkaufsposten WHERE id = v_vp;
  -- Anhängsel beider Kontakte
  INSERT INTO public.aktivitaeten (tenant_id, kontakt_id, art, betreff, datum, email_von, email_body)
  VALUES (v_b, v_mit, 'email', 'S112TEST Mail', (now() AT TIME ZONE 'Europe/Vienna')::date, 's112test-mit@software112.test', 'S112TEST vertraulicher Inhalt'),
         (v_b, v_ohne, 'notiz', 'S112TEST Notiz', (now() AT TIME ZONE 'Europe/Vienna')::date, NULL, NULL);
  INSERT INTO public.pipeline_eintraege (tenant_id, kontakt_id, stufe, titel) VALUES (v_b, v_mit, 'interessent', 'S112TEST Vorhaben');
  INSERT INTO public.lieferadressen (tenant_id, kontakt_id, strasse, plz, ort, land) VALUES (v_b, v_mit, 'Testgasse 2', '1010', 'Wien', 'AT');
  INSERT INTO public.datenschutz_consents (tenant_id, kontakt_id, email, aktion, quelle) VALUES (v_b, v_mit, 's112test-mit@software112.test', 'opt_in', 's112test');

  PERFORM pg_temp.s112_mutiere('ohne_schutz',
    $m$DROP TRIGGER a_anonymisiert_schutz ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('ohne_crm_pruefung',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[]) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN; END $f$$m$);

  -- ── 1. Wer nicht darf (vor dem Löschen, die Kontakte sind noch da) ──────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_rest, c_grund)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_crm_recht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_rest, c_grund)), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_rest, c_grund)), ':', 1), '42501');

  -- ── 2. Als Mitarbeiter mit CRM ──────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_rest, 'kurz')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_kontakt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_km, c_grund)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_nur_rpc',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET anonymisiert_am = now() WHERE id = %L', v_rest)), 'T');

  v_r := public.s112_kontakt_personendaten_loeschen(v_b, v_ohne, c_grund);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_belege_geloescht', v_r ->> 'art', 'geloescht');
  v_r := public.s112_kontakt_personendaten_loeschen(v_b, v_mit, c_grund);
  v_erg := v_erg || pg_temp.s112_erwarte('mit_belegen_anonymisiert', v_r ->> 'art', 'anonymisiert');
  v_erg := v_erg || pg_temp.s112_erwarte('nur_einmal',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mit, c_grund)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('danach_unveraenderlich',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET notizen = %L WHERE id = %L', 'S112TEST wieder da', v_mit)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('reaktivieren_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET aktiv = true WHERE id = %L', v_mit)), 'T');

  -- ── 3. Ergebnis prüfen (als postgres – unabhängig von der RLS) ──────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_belege_weg',
    (SELECT count(*) FROM public.kontakte WHERE id = v_ohne) + (SELECT count(*) FROM public.aktivitaeten WHERE betreff = 'S112TEST Notiz' AND tenant_id = v_b), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('personendaten_leer',
    (SELECT (nachname = 'Gelöschter Kontakt' AND vorname IS NULL AND email IS NULL AND email_weitere = '{}' AND telefon IS NULL AND strasse IS NULL AND plz IS NULL
             AND ort IS NULL AND notizen IS NULL AND NOT newsletter AND NOT aktiv AND anonymisiert_am IS NOT NULL AND anonymisiert_von = v_bw
             AND anonymisiert_grund = c_grund)::text FROM public.kontakte WHERE id = v_mit), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('kundennummer_bleibt',
    (SELECT accountnummer FROM public.kontakte WHERE id = v_mit), 'S112TEST-2');
  v_erg := v_erg || pg_temp.s112_erwarte('anhaengsel_weg',
    (SELECT count(*) FROM public.aktivitaeten WHERE kontakt_id = v_mit) + (SELECT count(*) FROM public.aktivitaeten WHERE email_body = 'S112TEST vertraulicher Inhalt')
    + (SELECT count(*) FROM public.pipeline_eintraege WHERE kontakt_id = v_mit) + (SELECT count(*) FROM public.lieferadressen WHERE kontakt_id = v_mit)
    + (SELECT count(*) FROM public.datenschutz_consents WHERE email = 's112test-mit@software112.test'), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_behaelt_partner',
    (SELECT (kontakt_id = v_mit AND partner_daten IS NOT NULL AND partner_daten = v_snap)::text FROM public.verkaufsposten WHERE id = v_vp), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_ohne_altwerte',
    (SELECT count(*) || '/' || bool_and(alt IS NULL AND neu IS NULL AND grund = c_grund AND benutzer_id = v_bw AND kennung ->> 'vorgang' = 'personendaten_geloescht')
       FROM public.bestandsprotokoll WHERE tabelle = 'kontakte' AND datensatz_id IN (v_ohne, v_mit)), '2/true');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_ohne_namen',
    (SELECT count(*) FROM public.bestandsprotokoll WHERE tabelle = 'kontakte' AND datensatz_id IN (v_ohne, v_mit)
        AND (to_jsonb(bestandsprotokoll.*)::text ILIKE '%Mitbeleg%' OR to_jsonb(bestandsprotokoll.*)::text ILIKE '%Ohnebeleg%' OR to_jsonb(bestandsprotokoll.*)::text ILIKE '%software112.test%')), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('anon_darf_nicht',
    has_function_privilege('anon', 'public.s112_kontakt_personendaten_loeschen(uuid, uuid, text)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 19);
END $test$;
