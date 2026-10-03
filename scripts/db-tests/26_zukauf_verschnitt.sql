-- @bereich: Zukauf atomar samt Charge und Verschnitt (KAN-193): RPC s112_zukauf_buchen
-- @ziel: Ein winzer bucht einen Wein-Zukauf in ein Gebinde mit abweichendem Wein: Zukauf-Charge, Beleg (ziel_weinausbau_id)
-- @ziel: und Verschnitt der ganzen Zukauf-Charge in die vorhandene Charge in EINER Transaktion – Zukauf-Charge danach 0 L und
-- @ziel: abgeschlossen, im Gebinde genau eine aktive Charge mit dem Bestand alt + Zukauf. Ohne Verschnitt bleibt die Zukauf-Charge
-- @ziel: aktiv; Trauben ohne Charge legen nur den Beleg an. Lieferant bzw. Gebinde eines anderen Betriebs → 42501, unbekanntes
-- @ziel: Feld → 22023, scheitert der Verschnitt (Ziel-Bestand geändert, 40001), bleibt kein Beleg und keine Charge zurück.
-- @ziel: Leser und Mitarbeiter ohne Warenwirtschaft werden abgelehnt (42501).
-- @mutation gebinde_offen: behaelter_nutzbar erlaubt jedes Gebinde | rot: charge_fremdgebinde
-- @mutation modul_offen: s112_pruefe_schreibmodul lässt jeden Mitarbeiter durch | rot: ohne_warenwirtschaft
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 26 (Stand 03.10.2026, KAN-193). Betrieb B aus s112_aufbau – alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '26_zukauf_verschnitt';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_mta   uuid;
  v_bk    uuid;   -- Mitarbeiter in B nur mit Kellerbuch (ohne Warenwirtschaft)
  v_g1    uuid;   -- Gebinde mit vorhandener Charge (B)
  v_g2    uuid;   -- leeres Gebinde (B)
  v_gm    uuid;   -- Gebinde des Musterhofs (M)
  v_z     uuid;   -- vorhandene Charge in v_g1
  v_km    uuid;   -- Kontakt des Musterhofs (fremder Lieferant)
  v_kb    uuid;   -- Kontakt in B (Lieferant)
  v_res   jsonb;
  v_zk    jsonb;
  v_ch    jsonb;
  v_vs    jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_bk := pg_temp.s112_benutzer('winzer', v_b, ARRAY['kellerbuch']);
  v_g1 := (pg_temp.s112_beispiel('behaelter', v_b, v_bw, jsonb_build_object('name', 'S112TEST ZK Tank 1', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_g2 := (pg_temp.s112_beispiel('behaelter', v_b, v_bw, jsonb_build_object('name', 'S112TEST ZK Tank 2', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_gm := (pg_temp.s112_beispiel('behaelter', c_m, NULL, jsonb_build_object('name', 'S112TEST ZK Fremdtank', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_z := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST ZK Riesling', 'menge_liter', 1000,
    'aktiv', true, 'status', 'ausbau', 'rebsorte', 'Riesling', 'jahrgang', 2025, 'weinart', 'weiss', 'qualitaetsstufe', 'qualitaetswein',
    'behaelter_id', v_g1, 'storniert_am', NULL, 'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;
  v_km := (pg_temp.s112_beispiel('kontakte', c_m, v_mta) ->> 'id')::uuid;
  v_kb := (pg_temp.s112_beispiel('kontakte', v_b, v_bw) ->> 'id')::uuid;

  -- Zukauf Grüner Veltliner 200 L in v_g1 (dort Riesling 1000 L) → sofort Verschnitt in v_z
  v_zk := jsonb_build_object('datum', current_date, 'art', 'wein', 'lieferant_kontakt_id', v_kb, 'weinart', 'weiss',
    'rebsorte', 'Grüner Veltliner', 'jahrgang', 2025, 'qualitaetsstufe', 'qualitaetswein', 'menge', 200, 'einheit', 'L',
    'notizen', 'S112TEST Zukauf');
  v_ch := jsonb_build_object('name', 'Grüner Veltliner', 'rebsorte', 'Grüner Veltliner', 'behaelter_id', v_g1, 'jahrgang', 2025,
    'menge_liter', 200, 'weinart', 'weiss', 'qualitaetsstufe', 'qualitaetswein');
  v_vs := jsonb_build_object('ziel_weinausbau_id', v_z, 'ziel_menge_erwartet', 1000, 'notizen', 'S112TEST Zukauf als Verschnitt',
    'ziel', jsonb_build_object('rebsorte', 'Riesling', 'jahrgang', 2025));

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('gebinde_offen',
    $m$CREATE OR REPLACE FUNCTION public.behaelter_nutzbar(p_behaelter_id uuid, p_tenant_id uuid)
       RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $x$ SELECT true $x$$m$);
  PERFORM pg_temp.s112_mutiere('modul_offen',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[])
       RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $x$ BEGIN NULL; END $x$$m$);

  -- ── 1. Zukauf mit Verschnitt als winzer ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_verschnitt_winzer',
    pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, %L::jsonb, %L::jsonb)', v_b, v_zk, v_ch, v_vs)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_ziel',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE id = %L AND menge_liter = 1200 AND aktiv', v_z)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_charge_leer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau w JOIN public.zukauf_posten z ON z.ziel_weinausbau_id = w.id WHERE z.tenant_id = %L AND z.notizen = %L AND w.menge_liter = 0 AND NOT w.aktiv AND w.status = %L AND w.behaelter_id = %L', v_b, 'S112TEST Zukauf', 'abgeschlossen', v_g1)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('eine_aktive_charge',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE tenant_id = %L AND behaelter_id = %L AND aktiv AND status <> %L', v_b, v_g1, 'abgeschlossen')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_quelle_zukauf',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verschneidungen v JOIN public.verschneidung_quellen q ON q.verschneidung_id = v.id JOIN public.zukauf_posten z ON z.ziel_weinausbau_id = q.quell_weinausbau_id WHERE v.tenant_id = %L AND v.ziel_weinausbau_id = %L AND q.menge_liter = 200 AND v.datum = current_date AND z.notizen = %L', v_b, v_z, 'S112TEST Zukauf')), '1');

  -- ── 2. Ohne Verschnitt (leeres Gebinde) und Trauben ohne Charge ───────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_ohne_verschnitt',
    pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      v_zk || jsonb_build_object('notizen', 'S112TEST Zukauf 2'), v_ch || jsonb_build_object('behaelter_id', v_g2))), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_trauben',
    pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 500, 'einheit', 'kg', 'notizen', 'S112TEST Trauben'))), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_verschnitt_charge_aktiv',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau w JOIN public.zukauf_posten z ON z.ziel_weinausbau_id = w.id WHERE z.tenant_id = %L AND z.notizen = %L AND w.menge_liter = 200 AND w.aktiv AND w.behaelter_id = %L', v_b, 'S112TEST Zukauf 2', v_g2)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('trauben_ohne_charge',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.zukauf_posten WHERE tenant_id = %L AND notizen = %L AND ziel_weinausbau_id IS NULL', v_b, 'S112TEST Trauben')), '1');

  -- ── 3. Verweise und Felder ────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('lieferant_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 1, 'einheit', 'kg', 'lieferant_kontakt_id', v_km))), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_fremdgebinde',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      v_zk || jsonb_build_object('notizen', 'S112TEST fremd'), v_ch || jsonb_build_object('behaelter_id', v_gm))), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('feld_zukauf_verboten',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 1, 'einheit', 'kg', 'tenant_id', c_m))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('feld_charge_verboten',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      v_zk, v_ch || jsonb_build_object('aktiv', false))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_ohne_charge',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, NULL, %L::jsonb)', v_b, v_zk, v_vs)), ':', 1), '22023');

  -- ── 4. Scheitert der Verschnitt, bleibt nichts zurück ─────────────────────────────────────────────────
  -- v_z hat jetzt 1200 L, erwartet werden 1000 L → 40001, Beleg und Zukauf-Charge sind mit zurückgerollt
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_scheitert',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, %L::jsonb, %L::jsonb)', v_b,
      v_zk || jsonb_build_object('notizen', 'S112TEST Zukauf 3'), v_ch, v_vs)), ':', 1), '40001');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('gescheitert_kein_beleg',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.zukauf_posten WHERE tenant_id = %L AND notizen = %L', v_b, 'S112TEST Zukauf 3')), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('gescheitert_keine_charge',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE tenant_id = %L AND behaelter_id = %L', v_b, v_g1)), '2');
  v_erg := v_erg || pg_temp.s112_erwarte('gescheitert_bestand_ziel',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE id = %L AND menge_liter = 1200', v_z)), '1');

  -- ── 5. Rechte: Leser, fremder Betrieb, Mitarbeiter ohne Warenwirtschaft ───────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('buchen_leser',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 1, 'einheit', 'kg'))), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('buchen_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 1, 'einheit', 'kg'))), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bk);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_warenwirtschaft',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 1, 'einheit', 'kg'))), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 21);
END $test$;
