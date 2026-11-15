-- @bereich: Weinshop – Warteschlange der Bestands- und Weindaten-Übertragung (KAN-463)
-- @ziel: Eine Füllung wird nur eingereiht, wenn sie einem Shop-Produkt zugeordnet ist, das Paket-Modul an ist und – für
-- @ziel: den Bestand – der Schalter „Bestand übertragen“. Je Betrieb, Füllung und Art gibt es höchstens einen Eintrag.
-- @ziel: Die Menge ist Bestand − reservierte Flaschen − Reserve, nie negativ. Ausschalten leert die Warteschlange.
-- @ziel: Über die Datenschnittstelle ist die Warteschlange nur lesbar; anon hat keine Rechte.
-- @mutation ohne_schalter: s112_shop_einreihen beachtet den Schalter „Bestand übertragen“ nicht mehr | rot: schalter_aus_.*
-- @mutation ohne_zuordnung: s112_shop_einreihen reiht auch nicht zugeordnete Füllungen ein | rot: ohne_zuordnung_.*
-- @mutation menge_negativ: s112_shop_bestand ohne Untergrenze 0 | rot: menge_nie_negativ
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 15.11.2026, KAN-463). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_shop_warteschlange';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bta   uuid;
  v_f     uuid;
  v_f2    uuid;
  v_z     uuid;
  v_res   integer;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_schalter',
    $m$DO $d$ BEGIN
         EXECUTE replace(pg_get_functiondef('public.s112_shop_einreihen(uuid, uuid, text)'::regprocedure),
                         '(p_art <> ''bestand'' OR e.shop_bestand_uebertragen)', 'true');
       END $d$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_zuordnung',
    $m$DO $d$ BEGIN
         EXECUTE replace(pg_get_functiondef('public.s112_shop_einreihen(uuid, uuid, text)'::regprocedure),
                         'IF NOT EXISTS (SELECT 1 FROM shop_zuordnungen z WHERE z.tenant_id = p_tenant_id AND z.fuellung_id = p_fuellung_id) THEN',
                         'IF false THEN');
       END $d$$m$);
  PERFORM pg_temp.s112_mutiere('menge_negativ',
    $m$DO $d$ BEGIN
         EXECUTE replace(pg_get_functiondef('public.s112_shop_bestand(uuid)'::regprocedure), 'GREATEST(0,', '(');
       END $d$$m$);

  -- zwei Füllungen in B; Modul an (Aufbau), Schalter aus (Standard), Reserve 0
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bta) ->> 'id')::uuid;
  v_f2 := (pg_temp.s112_beispiel('fuellungen', v_b, v_bta) ->> 'id')::uuid;
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen SET bestand_flaschen = 100, aktiv = true WHERE id IN (v_f, v_f2);
  UPDATE public.tenant_einstellungen SET modul_shop = true, shop_bestand_uebertragen = false, shop_bestandsreserve = 0 WHERE tenant_id = v_b;
  DELETE FROM public.shop_warteschlange WHERE tenant_id = v_b;

  -- ── 1. Ohne Zuordnung wird nichts eingereiht ────────────────────────────────────────────────────────────────
  UPDATE public.tenant_einstellungen SET shop_bestand_uebertragen = true WHERE tenant_id = v_b;
  UPDATE public.fuellungen SET bestand_flaschen = 99 WHERE id = v_f;
  UPDATE public.fuellungen SET rebsorte = 'S112TEST Sorte' WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_zuordnung_nichts', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b), 0::bigint);
  UPDATE public.tenant_einstellungen SET shop_bestand_uebertragen = false WHERE tenant_id = v_b;

  -- ── 2. Zuordnung, Schalter aus: Bestand nicht, Weindaten schon ──────────────────────────────────────────────
  INSERT INTO public.shop_zuordnungen (tenant_id, fuellung_id, woo_produkt_id, woo_name) VALUES (v_b, v_f, 4711, 'S112TEST') RETURNING id INTO v_z;
  UPDATE public.fuellungen SET bestand_flaschen = 98 WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('schalter_aus_kein_bestand', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND art = 'bestand'), 0::bigint);
  UPDATE public.fuellungen SET rebsorte = 'S112TEST Sorte 2' WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('weindaten_ohne_schalter', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'weindaten'), 1::bigint);

  -- ── 3. Einschalten reiht alle zugeordneten Füllungen ein; keine Doppel ──────────────────────────────────────
  UPDATE public.tenant_einstellungen SET shop_bestand_uebertragen = true WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('einschalten_reiht_ein', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'bestand'), 1::bigint);
  UPDATE public.shop_warteschlange SET versuche = 4, letzter_fehler = 'S112TEST', naechster_versuch_am = now() + interval '3 hours' WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'bestand';
  UPDATE public.fuellungen SET bestand_flaschen = 97 WHERE id = v_f;
  UPDATE public.fuellungen SET bestand_flaschen = 96 WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('kein_doppel', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'bestand'), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('neue_aenderung_setzt_zurueck',
    (SELECT concat_ws('|', versuche, letzter_fehler IS NULL, naechster_versuch_am <= now()) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'bestand'), '0|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('andere_fuellung_nicht', (SELECT count(*) FROM public.shop_warteschlange WHERE fuellung_id = v_f2), 0::bigint);

  -- ── 4. Menge: Bestand − reserviert − Reserve, nie negativ; inaktiv = 0 ──────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('menge_ohne_abzug', public.s112_shop_bestand(v_f), 96);
  UPDATE public.tenant_einstellungen SET shop_bestandsreserve = 12 WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('menge_mit_reserve', public.s112_shop_bestand(v_f), 84);
  DELETE FROM public.shop_warteschlange WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_beispiel('auftrag_positionen', v_b, v_bta, jsonb_build_object('fuellung_id', v_f));
  v_res := public.s112_fuellung_reserviert(v_f);
  v_erg := v_erg || pg_temp.s112_erwarte('reservierung_zaehlt', v_res >= 1, true);
  v_erg := v_erg || pg_temp.s112_erwarte('menge_mit_reservierung', public.s112_shop_bestand(v_f), 84 - v_res);
  v_erg := v_erg || pg_temp.s112_erwarte('reservierung_reiht_ein', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'bestand'), 1::bigint);
  UPDATE public.fuellungen SET bestand_flaschen = 5 WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('menge_nie_negativ', public.s112_shop_bestand(v_f), 0);
  UPDATE public.fuellungen SET bestand_flaschen = 96, aktiv = false WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('menge_inaktiv_null', public.s112_shop_bestand(v_f), 0);
  UPDATE public.fuellungen SET aktiv = true WHERE id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('menge_unbekannte_fuellung', public.s112_shop_bestand(gen_random_uuid()) IS NULL, true);

  -- ── 5. Geänderte Reserve und täglicher Abgleich reihen ein; Umhängen räumt die alte Füllung ab ───────────────
  DELETE FROM public.shop_warteschlange WHERE tenant_id = v_b;
  UPDATE public.tenant_einstellungen SET shop_bestandsreserve = 6 WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('reserve_reiht_ein', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND art = 'bestand'), 1::bigint);
  DELETE FROM public.shop_warteschlange WHERE tenant_id = v_b;
  v_n := public.s112_shop_abgleich_einreihen();
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_reiht_ein', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f AND art = 'bestand'), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_ohne_doppel', public.s112_shop_abgleich_einreihen() = 0 OR (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b) = 1, true);
  UPDATE public.shop_zuordnungen SET fuellung_id = v_f2 WHERE id = v_z;
  v_erg := v_erg || pg_temp.s112_erwarte('umhaengen',
    (SELECT concat_ws('|', count(*) FILTER (WHERE fuellung_id = v_f), count(*) FILTER (WHERE fuellung_id = v_f2 AND art = 'bestand')) FROM public.shop_warteschlange WHERE tenant_id = v_b), '0|1');

  -- ── 6. Ausschalten leert: Schalter → Bestand weg, Weindaten bleiben; Modul → alles weg; Lösen → Füllung weg ──
  UPDATE public.fuellungen SET rebsorte = 'S112TEST Sorte 3' WHERE id = v_f2;
  UPDATE public.tenant_einstellungen SET shop_bestand_uebertragen = false WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('schalter_aus_leert_bestand',
    (SELECT concat_ws('|', count(*) FILTER (WHERE art = 'bestand'), count(*) FILTER (WHERE art = 'weindaten')) FROM public.shop_warteschlange WHERE tenant_id = v_b), '0|1');
  UPDATE public.fuellungen SET bestand_flaschen = 50 WHERE id = v_f2;
  v_erg := v_erg || pg_temp.s112_erwarte('schalter_aus_bleibt_leer', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND art = 'bestand'), 0::bigint);
  UPDATE public.tenant_einstellungen SET modul_shop = false WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('modul_aus_leert_alles', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b), 0::bigint);
  UPDATE public.fuellungen SET rebsorte = 'S112TEST Sorte 4' WHERE id = v_f2;
  v_erg := v_erg || pg_temp.s112_erwarte('modul_aus_bleibt_leer', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b), 0::bigint);
  UPDATE public.tenant_einstellungen SET modul_shop = true, shop_bestand_uebertragen = true WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('wieder_ein', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b AND fuellung_id = v_f2 AND art = 'bestand'), 1::bigint);
  DELETE FROM public.shop_zuordnungen WHERE id = v_z;
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_raeumt_ab', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b), 0::bigint);

  -- ── 7. Rechte: nur lesbar; anon nichts; Funktionen nicht für Benutzer ───────────────────────────────────────
  INSERT INTO public.shop_zuordnungen (tenant_id, fuellung_id, woo_produkt_id) VALUES (v_b, v_f, 4712);
  v_erg := v_erg || pg_temp.s112_erwarte('vorher_eintrag', (SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = v_b), 1::bigint);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('b_ta_liest', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = %L', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('b_ta_insert', pg_temp.s112_versuch(format('INSERT INTO public.shop_warteschlange (tenant_id, fuellung_id, art) VALUES (%L, %L, %L)', v_b, v_f2, 'bestand')), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('b_ta_update', pg_temp.s112_versuch(format('UPDATE public.shop_warteschlange SET versuche = 9 WHERE tenant_id = %L', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('b_ta_delete', pg_temp.s112_versuch(format('DELETE FROM public.shop_warteschlange WHERE tenant_id = %L', v_b)), 'G');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_liest_nichts', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.shop_warteschlange WHERE tenant_id = %L', v_b)), '0');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('anon_ohne_rechte',
    has_table_privilege('anon', 'public.shop_warteschlange', 'SELECT') OR has_table_privilege('anon', 'public.shop_warteschlange', 'INSERT'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('funktionen_nicht_fuer_benutzer',
    (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 's112\_shop\_%'
        AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('funktionen_vorhanden',
    (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 's112\_shop\_%'), 9::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 30);
END $test$;
