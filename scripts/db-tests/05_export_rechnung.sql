-- @bereich: Weinexport – Rechnung und Bestandsabgang aus dem Exportauftrag (KAN-436 E1)
-- @ziel: Ein Exportauftrag lässt sich ab „Bestätigt“ mit einem Verkauf verknüpfen, der einen Steuerfall trägt. Danach ist
-- @ziel: er gesperrt (Kopf, Positionen, Storno); die Verknüpfung löst nur das Storno des Verkaufs. Eine Mustersendung
-- @ziel: bekommt keine Rechnung – s112_export_muster_buchen bucht den Bestand als Entnahme aus bzw. zurück.
-- @ziel: Leser, fremde Betriebe und Betriebe ohne Export-Modul nicht.
-- @mutation ohne_schutz: Trigger zz_export_rechnung_schutz entfernt | rot: loesen_direkt
-- @mutation ohne_storno_trigger: Trigger z_export_rechnung_storno entfernt | rot: storno_verkauf_loest
-- @ziel: KAN-439: Das Kellerbuch-Journal bucht einen Verkauf mit Bestimmungsland (lieferland) nach diesem Land als
-- @ziel: „im Inland“ bzw. „ins Ausland“; ohne Bestimmungsland entscheidet wie bisher das Land des Käufers.
-- @mutation ohne_lieferland: s112_journal_verkauf_stand beachtet das Bestimmungsland nicht | rot: journal_lieferland_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 05 (Stand 12.11.2026, KAN-436 E1). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '05_export_rechnung';
  c_rpc   constant text := 'SELECT public.s112_export_muster_buchen(%L::uuid, %L::uuid, %L::date, %L::boolean)';
  c_link  constant text := 'UPDATE public.exportauftraege SET verkaufsposten_id = %L WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_mw    uuid;
  v_f     uuid;
  v_auf   uuid;
  v_mus   uuid;
  v_vp0   uuid := gen_random_uuid();   -- Verkauf ohne Steuerfall
  v_vp1   uuid := gen_random_uuid();   -- Verkauf mit Steuerfall
  v_vp2   uuid := gen_random_uuid();   -- zweiter Verkauf mit Steuerfall
  v_vpm   uuid := gen_random_uuid();   -- Verkauf des fremden Betriebs
  v_pos   uuid;
  v_heute date;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_heute := pg_temp.s112_heute();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  UPDATE public.tenant_einstellungen SET modul_export = true WHERE tenant_id IN (v_b, v_m);
  v_f := (pg_temp.s112_zeile('fuellungen', v_b, jsonb_build_object('name', 'S112TEST Export', 'anzahl_flaschen', 600, 'bestand_flaschen', 600, 'aktiv', true)) ->> 'id')::uuid;
  v_auf := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'entwurf', 'storniert_am', NULL, 'datum', v_heute,
    'destination_land', 'US', 'mustersendung', false)) ->> 'id')::uuid;
  v_mus := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'bestaetigt', 'storniert_am', NULL, 'datum', v_heute,
    'destination_land', 'US', 'mustersendung', false)) ->> 'id')::uuid;
  INSERT INTO public.exportauftrag_positionen (exportauftrag_id, fullung_id, beschreibung, menge, einheit, preis_eur, sort_order)
  VALUES (v_auf, v_f, 'S112TEST A', 12, 'Fl', 9.5, 0), (v_mus, v_f, 'S112TEST M1', 6, 'Fl', 0, 0), (v_mus, v_f, 'S112TEST M2', 2, 'Kiste', 0, 1);
  UPDATE public.exportauftrag_positionen SET flaschen_je_karton = 3 WHERE exportauftrag_id = v_mus AND einheit = 'Kiste';
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('id', v_vp0, 'rechnung_spaeter', true));
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('id', v_vp1, 'rechnung_spaeter', true, 'steuerfall', 'ausfuhr', 'lieferland', 'US'));
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('id', v_vp2, 'rechnung_spaeter', true, 'steuerfall', 'igl', 'kunde_uid', 'DE123456789', 'lieferland', 'DE'));
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_m, jsonb_build_object('id', v_vpm, 'rechnung_spaeter', true, 'steuerfall', 'ausfuhr'));

  PERFORM pg_temp.s112_mutiere('ohne_schutz', $m$DROP TRIGGER zz_export_rechnung_schutz ON public.exportauftraege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_storno_trigger', $m$DROP TRIGGER z_export_rechnung_storno ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('ohne_lieferland', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_journal_verkauf_stand(jsonb, jsonb)'::regprocedure), $a$vp ->> 'lieferland'$a$, $a$vp ->> 'kein_feld'$a$);
  END $d$$m$);

  -- ── 1. Steuerfall am Verkauf ───────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('igl_nur_mit_uid',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET steuerfall = %L, kunde_uid = NULL WHERE id = %L', 'igl', v_vp1)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('steuerfall_unbekannt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET steuerfall = %L WHERE id = %L', 'reverse', v_vp1)), ':', 1), '23514');

  -- KAN-439: Journal – Inland/Ausland nach dem Bestimmungsland des Verkaufs, sonst nach dem Land des Käufers.
  -- Käufer ohne Land (= Inland) mit Bestimmungsland US → Ausland; Käufer in Deutschland mit Bestimmungsland AT → Inland;
  -- ohne Bestimmungsland wie bisher: Käufer in Deutschland → Ausland, Käufer ohne Land → Inland.
  v_erg := v_erg || pg_temp.s112_erwarte('journal_lieferland_ausland',
    (SELECT public.s112_journal_verkauf_stand(jsonb_build_object('typ', 'flasche', 'fuellung_id', v_f, 'menge', 6, 'name', 'S112TEST Export'),
       to_jsonb(v))::text LIKE '%VK_FL_AU%' FROM public.verkaufsposten v WHERE v.id = v_vp1), true);
  v_erg := v_erg || pg_temp.s112_erwarte('journal_lieferland_inland',
    (SELECT public.s112_journal_verkauf_stand(jsonb_build_object('typ', 'flasche', 'fuellung_id', v_f, 'menge', 6, 'name', 'S112TEST Export'),
       to_jsonb(v) || jsonb_build_object('lieferland', 'AT', 'partner_daten', jsonb_build_object('firma', jsonb_build_object('name', 'S112TEST Käufer', 'land', 'DE'))))::text LIKE '%VK_FL_AT%'
     FROM public.verkaufsposten v WHERE v.id = v_vp1), true);
  v_erg := v_erg || pg_temp.s112_erwarte('journal_ohne_lieferland',
    (SELECT concat_ws('/',
       public.s112_journal_verkauf_stand(jsonb_build_object('typ', 'flasche', 'fuellung_id', v_f, 'menge', 6, 'name', 'S112TEST Export'),
         to_jsonb(v))::text LIKE '%VK_FL_AT%',
       public.s112_journal_verkauf_stand(jsonb_build_object('typ', 'flasche', 'fuellung_id', v_f, 'menge', 6, 'name', 'S112TEST Export'),
         to_jsonb(v) || jsonb_build_object('partner_daten', jsonb_build_object('firma', jsonb_build_object('name', 'S112TEST Käufer', 'land', 'DE'))))::text LIKE '%VK_FL_AU%')
     FROM public.verkaufsposten v WHERE v.id = v_vp0), 't/t');

  -- ── 2. Verknüpfen: erst ab Bestätigt, nur mit Steuerfall, nur eigener Verkauf ─────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verknuepfen_im_entwurf',
    pg_temp.s112_fehlertext(format(c_link, v_vp1, v_auf)) LIKE '23514:%Bestätigt%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('status_bestaetigt',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET status = %L WHERE id = %L', 'bestaetigt', v_auf)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('verknuepfen_ohne_steuerfall',
    pg_temp.s112_fehlertext(format(c_link, v_vp0, v_auf)) LIKE '23514:%Steuerfall%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('verknuepfen_fremder_verkauf',
    pg_temp.s112_fehlertext(format(c_link, v_vpm, v_auf)) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('verknuepfen_ok',
    pg_temp.s112_fehlertext(format(c_link, v_vp1, v_auf)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('verknuepft',
    (SELECT (verkaufsposten_id = v_vp1)::text FROM public.exportauftraege WHERE id = v_auf), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('ein_verkauf_ein_auftrag',
    split_part(pg_temp.s112_fehlertext(format(c_link, v_vp1, v_mus)), ':', 1), '23505');

  -- ── 3. Mit Rechnung gesperrt: Kopf, Positionen, Lösen, Storno ──────────────────────────────────────────
  SELECT id INTO v_pos FROM public.exportauftrag_positionen WHERE exportauftrag_id = v_auf ORDER BY sort_order LIMIT 1;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kopf_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET lieferdatum = %L WHERE id = %L', v_heute, v_auf)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('position_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.exportauftrag_positionen SET menge = 1 WHERE id = %L', v_pos)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_direkt',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET verkaufsposten_id = NULL WHERE id = %L', v_auf)) LIKE '42501:%Storno der Rechnung%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('umhaengen_direkt',
    split_part(pg_temp.s112_fehlertext(format(c_link, v_vp2, v_auf)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_gesperrt',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno mit Rechnung', v_auf))
      LIKE '23514:%zuerst die Rechnung stornieren%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('status_bleibt_aenderbar',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET status = %L WHERE id = %L', 'versendet', v_auf)), 'k1');

  -- ── 4. Storno des Verkaufs gibt den Auftrag frei ───────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.verkaufsposten SET storniert = true, storniert_am = now(), storno_grund = 'S112TEST Storno der Rechnung' WHERE id = v_vp1;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_verkauf_loest',
    (SELECT (verkaufsposten_id IS NULL)::text FROM public.exportauftraege WHERE id = v_auf), 'true');
  UPDATE public.exportauftraege SET status = 'bestaetigt' WHERE id = v_auf;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('danach_bearbeitbar',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET lieferdatum = %L WHERE id = %L', v_heute, v_auf)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('stornierter_verkauf_nicht_verknuepfbar',
    split_part(pg_temp.s112_fehlertext(format(c_link, v_vp1, v_auf)), ':', 1), '23514');

  -- ── 5. Mustersendung: aus- und zurückbuchen ──────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('muster_ohne_kennzeichen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)) LIKE '23514:%Mustersendung%', true);
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.exportauftraege SET mustersendung = true WHERE id = v_mus;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_zukunft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, (now() AT TIME ZONE 'Europe/Vienna')::date + 2, false)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('muster_zurueck_ohne_ausbuchung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, true)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('muster_ausbuchen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  -- 6 Flaschen + 2 Kisten zu 3 = 12 Flaschen als eine Entnahme je Füllung
  v_erg := v_erg || pg_temp.s112_erwarte('muster_bestand',
    (SELECT f.bestand_flaschen || '/' || (SELECT count(*) || ':' || sum(menge_stk) FROM public.fuellung_bewegungen b WHERE b.fuellung_id = v_f AND b.art = 'eigenverbrauch')
       FROM public.fuellungen f WHERE f.id = v_f), '588/1:-12');
  v_erg := v_erg || pg_temp.s112_erwarte('muster_vermerkt',
    (SELECT (muster_ausgebucht_am = v_heute)::text FROM public.exportauftraege WHERE id = v_mus), 'true');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_doppelt',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)) LIKE '23514:%schon ausgebucht%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_direkt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET muster_ausgebucht_am = NULL WHERE id = %L', v_mus)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('muster_kopf_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET lieferdatum = %L WHERE id = %L', v_heute, v_mus)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('muster_storno_gesperrt',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno mit Muster', v_mus))
      LIKE '23514:%zurückbuchen%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_keine_rechnung',
    pg_temp.s112_fehlertext(format(c_link, v_vp2, v_mus)) LIKE '23514:%Mustersendung%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_zurueckbuchen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, true)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('muster_bestand_zurueck',
    (SELECT f.bestand_flaschen || '/' || (SELECT (muster_ausgebucht_am IS NULL)::text FROM public.exportauftraege WHERE id = v_mus)
       FROM public.fuellungen f WHERE f.id = v_f), '600/true');
  -- lose Ware lässt sich nicht als Muster ausbuchen – nichts wird gebucht
  INSERT INTO public.exportauftrag_positionen (exportauftrag_id, beschreibung, menge, einheit, preis_eur, sort_order) VALUES (v_mus, 'S112TEST lose', 1, 'HL', 0, 2);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_lose_ware',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)) LIKE '23514:%lose Ware%', true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('muster_lose_ware_nichts_gebucht',
    (SELECT bestand_flaschen::text FROM public.fuellungen WHERE id = v_f), '600');

  -- ── 6. Rechte: Leser, fremder Betrieb, fremder Auftrag, ohne Export-Modul ────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_auftrag',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_mus, v_heute, false)), ':', 1), 'P0002');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_export = false WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_export_modul',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, v_heute, false)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('/',
      has_function_privilege('anon', 'public.s112_export_muster_buchen(uuid, uuid, date, boolean)', 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.s112_export_muster_buchen(uuid, uuid, date, boolean)', 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.s112_export_rechnung_schutz()', 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.s112_export_rechnung_storno()', 'EXECUTE')::text),
    'false/true/false/false');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 41);
END
$test$;
