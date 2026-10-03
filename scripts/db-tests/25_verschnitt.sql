-- @bereich: Verschnitt aus Gebinde atomar (KAN-112): RPC s112_verschnitt_buchen und Verweise am Verschnitt
-- @ziel: Ein winzer bucht einen Verschnitt mit Schwund in EINER Transaktion: Bestände von Quelle und Ziel, Verschnitt mit
-- @ziel: ziel_behaelter_id, Quelle mit quell_behaelter_id und schwund_umzug_id, Schwundbuchung (keller_umzuege 'schwund').
-- @ziel: Leser und fremder Betrieb werden abgelehnt (42501), zu viel Menge 22023, inzwischen geänderter Bestand 40001.
-- @ziel: neue_ziel_charge legt die Ziel-Charge im leeren Gebinde an und verschneidet die Quellen hinein. Ein direktes
-- @ziel: UPDATE von verschneidung_quellen.quell_behaelter_id auf ein Gebinde eines anderen Betriebs scheitert (42501).
-- @mutation verweise_offen: Verweis-Trigger lässt alles durch | rot: verweis_.*
-- @mutation gebinde_offen: behaelter_nutzbar erlaubt jedes Gebinde | rot: neue_ziel_charge_fremdgebinde|verweis_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 25 (Stand 03.10.2026, KAN-112). Betrieb B aus s112_aufbau – alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '25_verschnitt';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_mta   uuid;
  v_g1    uuid;   -- Ziel-Gebinde (B)
  v_g2    uuid;   -- Gebinde der Quellen (B)
  v_g4    uuid;   -- leeres Gebinde (B)
  v_gm    uuid;   -- Gebinde des Musterhofs (M)
  v_z     uuid;   -- Ziel-Charge
  v_q     uuid;   -- Quelle 1
  v_q2    uuid;   -- Quelle 2
  v_vs    uuid;
  v_kopf  jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_g1 := (pg_temp.s112_beispiel('behaelter', v_b, v_bw, jsonb_build_object('name', 'S112TEST Tank 1', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_g2 := (pg_temp.s112_beispiel('behaelter', v_b, v_bw, jsonb_build_object('name', 'S112TEST Tank 2', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_g4 := (pg_temp.s112_beispiel('behaelter', v_b, v_bw, jsonb_build_object('name', 'S112TEST Tank 4', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_gm := (pg_temp.s112_beispiel('behaelter', c_m, NULL, jsonb_build_object('name', 'S112TEST Fremdtank', 'volumen_liter', 10000, 'aktiv', true, 'gemeinsam', false)) ->> 'id')::uuid;
  v_z := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Riesling', 'menge_liter', 1000,
    'aktiv', true, 'status', 'ausbau', 'rebsorte', 'Riesling', 'jahrgang', 2025, 'weinart', 'weiss', 'qualitaetsstufe', 'qualitaetswein',
    'behaelter_id', v_g1, 'storniert_am', NULL, 'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;
  v_q := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Veltliner', 'menge_liter', 300,
    'aktiv', true, 'status', 'ausbau', 'rebsorte', 'Grüner Veltliner', 'jahrgang', 2025, 'weinart', 'weiss', 'qualitaetsstufe', 'qualitaetswein',
    'behaelter_id', v_g2, 'storniert_am', NULL, 'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;
  v_q2 := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Welschriesling', 'menge_liter', 200,
    'aktiv', true, 'status', 'ausbau', 'rebsorte', 'Welschriesling', 'jahrgang', 2024, 'weinart', 'weiss', 'qualitaetsstufe', 'landwein',
    'behaelter_id', v_g2, 'storniert_am', NULL, 'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('verweise_offen',
    $m$CREATE OR REPLACE FUNCTION public.s112_verschnitt_verweise_pruefen() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
       BEGIN RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('gebinde_offen',
    $m$CREATE OR REPLACE FUNCTION public.behaelter_nutzbar(p_behaelter_id uuid, p_tenant_id uuid)
       RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $x$ SELECT true $x$$m$);

  -- ── 1. Verschnitt mit Schwund als winzer ──────────────────────────────────────────────────────────────
  v_kopf := jsonb_build_object('datum', current_date, 'ziel_weinausbau_id', v_z, 'ziel_menge_erwartet', 1000,
    'notizen', 'S112TEST Verschnitt', 'ziel', jsonb_build_object('rebsorte', 'Riesling', 'jahrgang', 2025));
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('buchen_winzer',
    pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf,
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 100, 'schwund_liter', 2, 'menge_erwartet', 300)))), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT v.id INTO v_vs FROM public.verschneidungen v WHERE v.tenant_id = v_b AND v.ziel_weinausbau_id = v_z;
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_ziel',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE id = %L AND menge_liter = 1100', v_z)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_quelle',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE id = %L AND menge_liter = 198 AND aktiv', v_q)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_ziel_gebinde',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verschneidungen WHERE id = %L AND ziel_behaelter_id = %L AND NOT gebinde_rekonstruiert', v_vs, v_g1)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('quelle_gebinde_schwund',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verschneidung_quellen WHERE verschneidung_id = %L AND quell_weinausbau_id = %L AND quell_behaelter_id = %L AND menge_liter = 100 AND anteil_pct = 100 AND schwund_umzug_id IS NOT NULL', v_vs, v_q, v_g2)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('schwundbuchung',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_umzuege u JOIN public.verschneidung_quellen q ON q.schwund_umzug_id = u.id WHERE q.verschneidung_id = %L AND u.umzug_typ = %L AND u.schwund_liter = 2 AND u.von_weinausbau_id = %L AND u.tenant_id = %L AND u.notizen LIKE %L', v_vs, 'schwund', v_q, v_b, 'Schwund beim Verschnitt%')), '1');

  -- ── 2. Rechte: Leser und fremder Betrieb ──────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('buchen_leser',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'ziel_weinausbau_id', v_z),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 1)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('buchen_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'ziel_weinausbau_id', v_z),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 1)))), ':', 1), '42501');

  -- ── 3. Bestandsprüfungen ──────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('menge_zu_hoch',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'ziel_weinausbau_id', v_z),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 500)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_geaendert',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'ziel_weinausbau_id', v_z),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 10, 'menge_erwartet', 300)))), ':', 1), '40001');
  v_erg := v_erg || pg_temp.s112_erwarte('feld_unbekannt',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'ziel_weinausbau_id', v_z, 'ziel', jsonb_build_object('menge_liter', 99999)),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 1)))), ':', 1), '22023');

  -- ── 4. Neue Ziel-Charge im leeren Gebinde ─────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('neue_ziel_charge',
    pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'neue_ziel_charge', jsonb_build_object('name', 'S112TEST Verschnitt neu', 'behaelter_id', v_g4,
        'weinart', 'weiss', 'rebsorte', 'Sortenverschnitt weiß', 'qualitaetsstufe', 'landwein')),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q, 'menge_liter', 50, 'menge_erwartet', 198),
                        jsonb_build_object('weinausbau_id', v_q2, 'menge_liter', 50, 'menge_erwartet', 200)))), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('neue_ziel_charge_bestand',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.weinausbau WHERE tenant_id = %L AND behaelter_id = %L AND aktiv AND menge_liter = 100 AND name = %L', v_b, v_g4, 'S112TEST Verschnitt neu')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('neue_ziel_charge_quellen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id WHERE v.tenant_id = %L AND v.ziel_behaelter_id = %L AND q.anteil_pct = 50', v_b, v_g4)), '2');
  v_erg := v_erg || pg_temp.s112_erwarte('neue_ziel_charge_fremdgebinde',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', current_date, 'neue_ziel_charge', jsonb_build_object('name', 'S112TEST fremd', 'behaelter_id', v_gm)),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_q2, 'menge_liter', 1)))), ':', 1), '42501');

  -- ── 5. Verweise am Verschnitt nur aus dem eigenen Betrieb ─────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verweis_quell_gebinde_fremd',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.verschneidung_quellen SET quell_behaelter_id = %L WHERE verschneidung_id = %L', v_gm, v_vs)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('verweis_ziel_gebinde_fremd',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.verschneidungen SET ziel_behaelter_id = %L WHERE id = %L', v_gm, v_vs)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END $test$;
