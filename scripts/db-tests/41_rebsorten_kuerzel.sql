-- @bereich: Rebsorten-Stammtabelle = BKI-Kürzelliste (KAN-89)
-- @ziel: Jede aktive Sorte mit amtlichem Kürzel steht genau so in der Soll-Liste unten (Kürzel, Name, Farbe) – dieselbe
-- @ziel: Liste gleicht der Unit-Test kan89-rebsorten-kuerzel mit REBSORTE_KUERZEL/bkiFarbe() ab. Nur die Farben weiss/rot;
-- @ziel: nicht amtliche Sorten haben kein Kürzel; Kürzel eindeutig.
-- @mutation farbe_grau: Grauburgunder wieder mit Farbe grau (CHECK entfernt) | rot: farben_nur_weiss_rot|soll_liste
-- @mutation kuerzel_alt: Merlot wieder MB | rot: soll_liste
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 41 (Stand 05.10.2026, KAN-89). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '41_rebsorten_kuerzel';
  -- SOLL-LISTE (Kürzel|Name|Farbe), alphabetisch nach Kürzel – Änderungen nur zusammen mit bki_kuerzel.ts
  c_soll  constant text[] := ARRAY[
    'BB|Blauburgunder|rot', 'BF|Blaufränkisch|rot', 'BW|Blauer Wildbacher|rot', 'CH|Chardonnay|weiss',
    'CS|Cabernet Sauvignon|rot', 'GR|Grauburgunder|weiss', 'GV|Grüner Veltliner|weiss', 'GW|Gemischter Satz|weiss',
    'ME|Merlot|rot', 'MU|Muskateller|weiss', 'NB|Neuburger|weiss', 'RL|Roesler|rot', 'RR|Riesling|weiss',
    'RV|Roter Veltliner|weiss', 'SB|Sauvignon Blanc|weiss', 'SH|Syrah|rot', 'SL|St. Laurent|rot', 'TR|Traminer|weiss',
    'WB|Weißburgunder|weiss', 'WR|Welschriesling|weiss', 'ZW|Zweigelt|rot'];
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_ist   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  PERFORM pg_temp.s112_mutiere('farbe_grau',
    $m$ALTER TABLE public.rebsorten DROP CONSTRAINT rebsorten_farbe_check; UPDATE public.rebsorten SET farbe = 'grau' WHERE kuerzel = 'GR'$m$);
  PERFORM pg_temp.s112_mutiere('kuerzel_alt', $m$UPDATE public.rebsorten SET kuerzel = 'MB' WHERE kuerzel = 'ME'$m$);

  SELECT string_agg(kuerzel || '|' || name_de || '|' || farbe, ',' ORDER BY kuerzel) INTO v_ist
    FROM public.rebsorten WHERE aktiv AND kuerzel_amtlich;
  v_erg := v_erg || pg_temp.s112_erwarte('soll_liste', v_ist, array_to_string(c_soll, ','));
  v_erg := v_erg || pg_temp.s112_erwarte('farben_nur_weiss_rot',
    (SELECT count(*) FROM public.rebsorten WHERE farbe NOT IN ('weiss', 'rot')), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_amtlich_ohne_kuerzel',
    (SELECT count(*) FROM public.rebsorten WHERE NOT kuerzel_amtlich AND kuerzel IS NOT NULL), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('grau_abgelehnt',
    pg_temp.s112_versuch($s$UPDATE public.rebsorten SET farbe = 'grau' WHERE kuerzel = 'GR'$s$), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('kuerzel_eindeutig',
    pg_temp.s112_versuch($s$UPDATE public.rebsorten SET kuerzel = 'GV' WHERE kuerzel = 'WR'$s$), 'E23505');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 5);
END $test$;
