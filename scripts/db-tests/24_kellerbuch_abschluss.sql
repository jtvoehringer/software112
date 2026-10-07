-- @bereich: Kellerbuch-Abschluss (Periodensperre) und Chargennummer (KAN-192 Etappe A)
-- @ziel: kellerbuch_abschliessen nur als Betriebsleitung des eigenen Betriebs, höchstens bis gestern, nur nach dem letzten
-- @ziel: Abschluss; Abschlüsse sind unwiderruflich (UPDATE/DELETE 42501, direktes INSERT als Benutzer abgelehnt) und nur im
-- @ziel: eigenen Betrieb lesbar. Danach lehnen die Bewegungstabellen ab (42501): neue Bewegung mit Datum im abgeschlossenen
-- @ziel: Zeitraum, Mengenänderung bzw. Umdatieren in den Zeitraum, Löschen; Storno und Bewegungen danach bleiben möglich,
-- @ziel: Wartung (s112.loeschen_erlaubt) ebenso. Neue Chargen bekommen eine fortlaufende Chargennummer, die unveränderlich ist.
-- @mutation sperre_aus: Periodensperre lässt alles durch | rot: gesperrt_.*
-- @mutation nummer_frei: Chargennummer änderbar | rot: nummer_unveraenderlich
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 24 (Stand 03.10.2026, KAN-192). Betrieb B aus s112_aufbau – alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '24_kellerbuch_abschluss';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
  v_mta   uuid;
  v_c1    uuid;
  v_c2    uuid;
  v_c3    uuid;
  v_alt   uuid;   -- Umzug vor dem Abschluss
  v_neu   uuid;   -- Umzug nach dem Abschluss
  v_nr1   text;
  v_nr3   text;
  v_bis   date;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_c1 := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Charge 1', 'menge_liter', 500,
    'aktiv', true, 'status', 'ausbau', 'qualitaetsstufe', 'qualitaetswein', 'behaelter_id', NULL, 'storniert_am', NULL,
    'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;
  v_c2 := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Charge 2', 'menge_liter', 100,
    'aktiv', true, 'status', 'ausbau', 'qualitaetsstufe', 'qualitaetswein', 'behaelter_id', NULL, 'storniert_am', NULL,
    'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;
  v_bis := v_heute - 30;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('sperre_aus',
    $m$CREATE OR REPLACE FUNCTION public.s112_kellerbuch_periodensperre() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
       BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('nummer_frei',
    $m$CREATE OR REPLACE FUNCTION public.s112_chargennummer_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
       BEGIN RETURN NEW; END $x$$m$);

  -- ── 1. Chargennummer: vergeben, fortlaufend, unveränderlich ───────────────────────────────────────────
  SELECT w.chargennummer INTO v_nr1 FROM public.weinausbau w WHERE w.id = v_c1;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_vergeben', v_nr1 ~ '^[A-Za-z0-9]+-[0-9]{4}-[0-9]+$', true);
  v_c3 := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Charge 3', 'menge_liter', 10,
    'aktiv', true, 'status', 'ausbau', 'behaelter_id', NULL, 'storniert_am', NULL, 'ist_eroeffnungsbestand', false, 'chargennummer', NULL)) ->> 'id')::uuid;
  SELECT w.chargennummer INTO v_nr3 FROM public.weinausbau w WHERE w.id = v_c3;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_fortlaufend',
    split_part(v_nr3, '-', 3)::integer - split_part((SELECT w.chargennummer FROM public.weinausbau w WHERE w.id = v_c2), '-', 3)::integer, 1);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_unveraenderlich',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET chargennummer = %L WHERE id = %L', 'S112TEST-1', v_c1)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 2. Bewegung vor dem Abschluss (Datum im späteren Sperrzeitraum) ───────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('vorher_umzug',
    pg_temp.s112_fehlertext(format('INSERT INTO public.keller_umzuege (tenant_id, datum, von_weinausbau_id, nach_weinausbau_id, menge_liter, schwund_liter, umzug_typ, zeilen_typ, verschnitt) VALUES (%L, %L, %L, %L, 10, 0, %L, %L, false)',
      v_b, v_bis - 20, v_c1, v_c2, 'normal', 'transfer')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT u.id INTO v_alt FROM public.keller_umzuege u WHERE u.tenant_id = v_b AND u.datum = v_bis - 20 AND u.von_weinausbau_id = v_c1;

  -- ── 3. Abschließen: Rollen, Grenzen ───────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_leser',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L)', v_b, v_bis)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_winzer',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L)', v_b, v_bis)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L)', v_b, v_bis)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_heute',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, pg_temp.s112_heute())', v_b)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_direkt',
    pg_temp.s112_versuch(format('INSERT INTO public.kellerbuch_abschluesse (tenant_id, abgeschlossen_bis) VALUES (%L, %L)', v_b, v_bis)) IN ('R', 'T'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_ta',
    pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L, %L)', v_b, v_bis, 'S112TEST BSM')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_frueher',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L)', v_b, v_bis - 5)), ':', 1), '55000');
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_lesen_eigen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerbuch_abschluesse WHERE tenant_id = %L AND abgeschlossen_bis = %L', v_b, v_bis)), '1');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_lesen_fremd',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerbuch_abschluesse WHERE tenant_id = %L', v_b)), '0');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_update',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.kellerbuch_abschluesse SET abgeschlossen_bis = abgeschlossen_bis - 1 WHERE tenant_id = %L', v_b)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_delete',
    split_part(pg_temp.s112_fehlertext(format('DELETE FROM public.kellerbuch_abschluesse WHERE tenant_id = %L', v_b)), ':', 1), '42501');

  -- ── 4. Sperre an den Bewegungen ───────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_neu',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.keller_umzuege (tenant_id, datum, von_weinausbau_id, nach_weinausbau_id, menge_liter, schwund_liter, umzug_typ, zeilen_typ, verschnitt) VALUES (%L, %L, %L, %L, 5, 0, %L, %L, false)',
      v_b, v_bis, v_c1, v_c2, 'normal', 'transfer')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('offen_neu',
    pg_temp.s112_fehlertext(format('INSERT INTO public.keller_umzuege (tenant_id, datum, von_weinausbau_id, nach_weinausbau_id, menge_liter, schwund_liter, umzug_typ, zeilen_typ, verschnitt) VALUES (%L, %L, %L, %L, 5, 0, %L, %L, false)',
      v_b, v_bis + 1, v_c1, v_c2, 'normal', 'transfer')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT u.id INTO v_neu FROM public.keller_umzuege u WHERE u.tenant_id = v_b AND u.datum = v_bis + 1 AND u.von_weinausbau_id = v_c1;
  PERFORM pg_temp.s112_als(v_bw);
  -- KAN-207: gebuchte Umzüge sind fest (a_freeze) – hier wird die Periodensperre geprüft, deshalb über den Korrekturweg
  PERFORM set_config('s112.freeze_frei', 'keller_umzuege', true);
  v_erg := v_erg || pg_temp.s112_erwarte('offen_aendern',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET menge_liter = 6 WHERE id = %L', v_neu)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_umdatieren',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET datum = %L WHERE id = %L', v_bis - 1, v_neu)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_menge',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET menge_liter = 11 WHERE id = %L', v_alt)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_unveraendert',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET menge_liter = menge_liter WHERE id = %L', v_alt)), 'ok');
  PERFORM set_config('s112.freeze_frei', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_storno',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno im Abschluss', v_alt)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_loeschen',
    split_part(pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_alt)), ':', 1), '42501');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_alt)), 'k1');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 24);
END $test$;
