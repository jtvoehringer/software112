-- @bereich: Warenwirtschaft – Angebot (KAN-418 Teil 4)
-- @ziel: Ein Angebot trägt Preise, reserviert aber nichts und ist nicht lieferbar. Es entsteht und ändert sich nur über
-- @ziel: die RPCs, hat einen eigenen Nummernkreis (AN), ist nur „offen“ änderbar und wird genau einmal in einen Auftrag
-- @ziel: übernommen – dabei wandern seine Preise an die Auftragspositionen. Leser, Mitarbeiter ohne Warenwirtschaft und
-- @ziel: fremde Betriebe kommen nicht durch; der Auftragsstorno greift nicht auf Angebote.
-- @mutation ohne_modul: s112_pruefe_schreibmodul prüft nichts mehr | rot: ohne_warenwirtschaft
-- @mutation angebot_reserviert: s112_fuellung_reserviert zählt auch Angebote | rot: (angebot_reserviert_nicht|verkauf_trotz_angebot)
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 08 (Stand 12.11.2026, KAN-418). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '08_angebot';
  c_neu   constant text := 'SELECT public.s112_angebot_anlegen(%L::uuid, %L::jsonb, %L::jsonb)';
  c_aend  constant text := 'SELECT public.s112_angebot_aendern(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb)';
  c_stat  constant text := 'SELECT public.s112_angebot_status_setzen(%L::uuid, %L::uuid, %L, %L)';
  c_auf   constant text := 'SELECT public.s112_auftrag_anlegen(%L::uuid, %L::jsonb, %L::jsonb)';
  c_verk  constant text := 'SELECT public.s112_fuellung_verkauf_buchen(%L::uuid, %L::uuid, gen_random_uuid(), %s, pg_temp.s112_heute(), %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_k     uuid;
  v_k2    uuid;
  v_km    uuid;
  v_f     uuid;   -- Füllung in B mit 100 Flaschen
  v_fm    uuid;   -- Füllung im fremden Betrieb
  v_pos   jsonb;
  v_r     jsonb;
  v_an    uuid;
  v_an2   uuid;
  v_an3   uuid;
  v_anm   uuid;   -- Angebot im fremden Betrieb
  v_auf   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Warenwirtschaft
  v_k := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('nachname', 'S112TEST Kunde')) ->> 'id')::uuid;
  v_k2 := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('nachname', 'S112TEST Kunde 2')) ->> 'id')::uuid;
  v_km := (pg_temp.s112_zeile('kontakte', v_m, jsonb_build_object('nachname', 'S112TEST Fremd')) ->> 'id')::uuid;
  v_f := (pg_temp.s112_zeile('fuellungen', v_b, jsonb_build_object('name', 'S112TEST GV', 'anzahl_flaschen', 100, 'bestand_flaschen', 100, 'aktiv', true)) ->> 'id')::uuid;
  v_fm := (pg_temp.s112_zeile('fuellungen', v_m, jsonb_build_object('name', 'S112TEST fremd', 'anzahl_flaschen', 100, 'bestand_flaschen', 100, 'aktiv', true)) ->> 'id')::uuid;
  v_pos := jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', '60', 'preis_brutto', '12.50', 'rabatt_pct', '10.00', 'sonderrabatt_pct', '0.00', 'ust_satz', '13.00'));

  PERFORM pg_temp.s112_mutiere('ohne_modul',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[]) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN; END $f$$m$);
  PERFORM pg_temp.s112_mutiere('angebot_reserviert',
    $m$CREATE OR REPLACE FUNCTION public.s112_fuellung_reserviert(p_fuellung_id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path = public AS $f$ SELECT COALESCE(SUM(p.menge - p.geliefert), 0)::integer FROM public.auftrag_positionen p
         JOIN public.auftraege a ON a.id = p.auftrag_id
        WHERE p.fuellung_id = p_fuellung_id AND a.status IN ('offen', 'teilgeliefert') AND a.storniert_am IS NULL $f$$m$);

  -- ── 1. Wer nicht darf ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_warenwirtschaft', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), '42501');

  -- ── 2. Anlegen als Mitarbeiter mit Warenwirtschaft ──────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_kontakt', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_km), v_pos)), ':', 1), '23503');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_fuellung', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k),
    jsonb_build_array(jsonb_build_object('fuellung_id', v_fm, 'menge', '1', 'preis_brutto', '5', 'ust_satz', '13')))), ':', 1), '23503');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_preis', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k),
    jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', '1', 'ust_satz', '13')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('rabatt_ueber_100', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k),
    jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', '1', 'preis_brutto', '5', 'rabatt_pct', '101', 'ust_satz', '13')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('gueltig_vor_datum', split_part(pg_temp.s112_fehlertext(format(c_neu, v_b,
    jsonb_build_object('kontakt_id', v_k, 'gueltig_bis', (pg_temp.s112_heute() - 1)::text), v_pos)), ':', 1), '23514');
  v_r := public.s112_angebot_anlegen(v_b, jsonb_build_object('kontakt_id', v_k), v_pos);
  v_an := (v_r ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_an', (v_r ->> 'nummer') ~ '^AN-[0-9]{4}-0001$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('angebot_zeile',
    (SELECT (art = 'angebot' AND status = 'offen' AND reserviert_bis IS NULL AND gueltig_bis = datum + 14 AND erstellt_von = v_bw)::text FROM public.auftraege WHERE id = v_an), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('preise_gespeichert',
    (SELECT concat_ws('/', menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz) FROM public.auftrag_positionen WHERE auftrag_id = v_an), '60/12.50/10.00/0.00/13.00');

  -- ── 3. Ein Angebot reserviert nicht und ist nicht lieferbar ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('angebot_reserviert_nicht', public.s112_fuellung_reserviert(v_f), 0);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_trotz_angebot', pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, -50, 'S112TEST Verkauf')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_lieferbar',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_liefern(%L::uuid, %L::uuid, gen_random_uuid(), %L::jsonb)', v_b, v_an,
      jsonb_build_array(jsonb_build_object('position_id', (SELECT id FROM public.auftrag_positionen WHERE auftrag_id = v_an), 'fuellung_id', v_f, 'menge', 1)))), ':', 1) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('auftragsstorno_greift_nicht',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_an, 'S112TEST falscher Weg')), ':', 1), 'P0002');

  -- ── 4. Direkte Schreibwege ─────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_anlegen',
    pg_temp.s112_versuch(format('INSERT INTO public.auftraege (tenant_id, art, nummer, kontakt_id) VALUES (%L, %L, %L, %L)', v_b, 'angebot', 'AN-9999-0001', v_k)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_preis',
    pg_temp.s112_versuch(format('UPDATE public.auftrag_positionen SET preis_brutto = 1 WHERE auftrag_id = %L', v_an)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_status',
    pg_temp.s112_versuch(format('UPDATE public.auftraege SET status = %L WHERE id = %L', 'angenommen', v_an)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_gueltig_bis',
    pg_temp.s112_versuch(format('UPDATE public.auftraege SET gueltig_bis = gueltig_bis + 30 WHERE id = %L', v_an)), 'T');

  -- ── 5. Ändern nur „offen“: Kopf und Positionen ersetzt, Nummer bleibt ──────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('aendern',
    pg_temp.s112_fehlertext(format(c_aend, v_b, v_an, jsonb_build_object('kontakt_id', v_k, 'gueltig_bis', (pg_temp.s112_heute() + 30)::text, 'notizen', 'S112TEST'),
      jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', '40', 'preis_brutto', '11.00', 'rabatt_pct', '0', 'sonderrabatt_pct', '5', 'ust_satz', '13'),
                        jsonb_build_object('fuellung_id', v_f, 'menge', '2', 'preis_brutto', '9.90', 'ust_satz', '20')))), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_wirkt',
    (SELECT concat_ws('/', a.nummer ~ '^AN-[0-9]{4}-0001$', a.gueltig_bis = pg_temp.s112_heute() + 30, a.notizen,
                      (SELECT count(*) FROM public.auftrag_positionen p WHERE p.auftrag_id = a.id), (SELECT sum(menge) FROM public.auftrag_positionen p WHERE p.auftrag_id = a.id))
       FROM public.auftraege a WHERE a.id = v_an), 't/t/S112TEST/2/42');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_aendert_nicht', split_part(pg_temp.s112_fehlertext(format(c_aend, v_b, v_an, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_aendert_nicht', split_part(pg_temp.s112_fehlertext(format(c_aend, v_b, v_an, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT (SELECT count(*) FROM public.auftraege WHERE id = %L) + (SELECT count(*) FROM public.auftrag_positionen WHERE auftrag_id = %L)', v_an, v_an)), '0');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_sieht', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.auftraege WHERE id = %L', v_an)), '1');

  -- fremdes Angebot mit der eigenen Betriebs-ID (IDOR): nicht gefunden
  PERFORM pg_temp.s112_als_postgres();
  v_anm := (public.s112_angebot_schreiben_intern(v_m, NULL, jsonb_build_object('kontakt_id', v_km),
    jsonb_build_array(jsonb_build_object('fuellung_id', v_fm, 'menge', '1', 'preis_brutto', '5', 'ust_satz', '13'))) ->> 'id')::uuid;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremdes_angebot_aendern', split_part(pg_temp.s112_fehlertext(format(c_aend, v_b, v_anm, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('fremdes_angebot_status', split_part(pg_temp.s112_fehlertext(format(c_stat, v_b, v_anm, 'storniert', 'S112TEST fremdes Angebot')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('fremdes_angebot_uebernehmen',
    split_part(pg_temp.s112_fehlertext(format(c_auf, v_b, jsonb_build_object('kontakt_id', v_k, 'angebot_id', v_anm), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1)))), ':', 1), 'P0002');

  -- ── 6. Übernahme in einen Auftrag: genau einmal, gleicher Kunde, Preise wandern mit ───────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('uebernahme_anderer_kunde',
    split_part(pg_temp.s112_fehlertext(format(c_auf, v_b, jsonb_build_object('kontakt_id', v_k2, 'angebot_id', v_an), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 5)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('uebernahme_zu_viel',   -- der Auftrag prüft den Bestand (100 − 50 verkauft = 50 verfügbar)
    split_part(pg_temp.s112_fehlertext(format(c_auf, v_b, jsonb_build_object('kontakt_id', v_k, 'angebot_id', v_an), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 51)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('angebot_bleibt_offen', (SELECT status FROM public.auftraege WHERE id = v_an), 'offen');
  v_r := public.s112_auftrag_anlegen(v_b, jsonb_build_object('kontakt_id', v_k, 'angebot_id', v_an), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 30)));
  v_auf := (v_r ->> 'id')::uuid;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('auftrag_aus_angebot',
    (SELECT concat_ws('/', a.art, a.nummer ~ '^AB-', a.angebot_id = v_an, (SELECT status FROM public.auftraege x WHERE x.id = v_an)) FROM public.auftraege a WHERE a.id = v_auf),
    'auftrag/t/t/angenommen');
  v_erg := v_erg || pg_temp.s112_erwarte('preise_am_auftrag',   -- erste Angebotsposition derselben Füllung
    (SELECT concat_ws('/', menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz) FROM public.auftrag_positionen WHERE auftrag_id = v_auf), '30/11.00/0.00/5.00/13.00');
  v_erg := v_erg || pg_temp.s112_erwarte('auftrag_reserviert', public.s112_fuellung_reserviert(v_f), 30);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zweite_uebernahme',
    split_part(pg_temp.s112_fehlertext(format(c_auf, v_b, jsonb_build_object('kontakt_id', v_k, 'angebot_id', v_an), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('angenommen_unveraenderlich', split_part(pg_temp.s112_fehlertext(format(c_aend, v_b, v_an, jsonb_build_object('kontakt_id', v_k), v_pos)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('angenommen_nicht_ablehnbar', split_part(pg_temp.s112_fehlertext(format(c_stat, v_b, v_an, 'abgelehnt', '')), ':', 1), '23514');
  v_r := public.s112_auftrag_anlegen(v_b, jsonb_build_object('kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1)));
  v_erg := v_erg || pg_temp.s112_erwarte('auftrag_ohne_angebot_ohne_preis',   -- ein normaler Auftrag bleibt ohne Preise
    (SELECT (p.preis_brutto IS NULL)::text FROM public.auftrag_positionen p WHERE p.auftrag_id = (v_r ->> 'id')::uuid), 'true');

  -- ── 7. Ablehnen und Stornieren, eigener Nummernkreis ───────────────────────────────────────────────────
  v_r := public.s112_angebot_anlegen(v_b, jsonb_build_object('kontakt_id', v_k), v_pos);
  v_an2 := (v_r ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_fortlaufend', (v_r ->> 'nummer') ~ '^AN-[0-9]{4}-0002$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('status_unbekannt', split_part(pg_temp.s112_fehlertext(format(c_stat, v_b, v_an2, 'angenommen', '')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ablehnen_ohne_grund', pg_temp.s112_fehlertext(format(c_stat, v_b, v_an2, 'abgelehnt', '')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('abgelehnt_nicht_uebernehmbar',
    split_part(pg_temp.s112_fehlertext(format(c_auf, v_b, jsonb_build_object('kontakt_id', v_k, 'angebot_id', v_an2), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1)))), ':', 1), '23514');
  v_r := public.s112_angebot_anlegen(v_b, jsonb_build_object('kontakt_id', v_k), v_pos);
  v_an3 := (v_r ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_grund_fehlt', split_part(pg_temp.s112_fehlertext(format(c_stat, v_b, v_an3, 'storniert', 'kurz')), ':', 1), '23514');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ohne_warenwirtschaft', split_part(pg_temp.s112_fehlertext(format(c_stat, v_b, v_an3, 'storniert', 'S112TEST irrtümlich angelegt')), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_fremd', split_part(pg_temp.s112_fehlertext(format(c_stat, v_b, v_an3, 'storniert', 'S112TEST irrtümlich angelegt')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok', pg_temp.s112_fehlertext(format(c_stat, v_b, v_an3, 'storniert', 'S112TEST irrtümlich angelegt')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('status_stand',
    (SELECT string_agg(status || ':' || (abgelehnt_am IS NOT NULL)::text || ':' || (storniert_am IS NOT NULL)::text, ',' ORDER BY nummer) FROM public.auftraege WHERE id IN (v_an2, v_an3)),
    'abgelehnt:true:false,storniert:false:true');
  v_erg := v_erg || pg_temp.s112_erwarte('nummernkreise_getrennt',   -- drei Angebote, zwei Aufträge
    (SELECT concat_ws('/', angebot_zaehler, auftrag_zaehler) FROM public.tenant_einstellungen WHERE tenant_id = v_b), '4/3');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_darf_nicht',
    has_function_privilege('anon', 'public.s112_angebot_anlegen(uuid, jsonb, jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.s112_angebot_schreiben_intern(uuid, uuid, jsonb, jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.s112_angebotsnummer_ziehen(uuid)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 49);
END $test$;
