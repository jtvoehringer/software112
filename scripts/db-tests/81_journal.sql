-- @bereich: Journal (KAN-332) – Neuanlagen im Bestandsprotokoll, eigene Vorgänge lesen
-- @ziel: Eine Neuanlage auf einer Kopf-Tabelle schreibt eine Protokollzeile INSERT mit Benutzer und Kennung (Name …), ohne
-- @ziel: ganze Zeile (alt/neu leer); Änderungen tragen die Kennung des neuen Stands. Ein Mitarbeiter (winzer) liest nur
-- @ziel: seine eigenen Zeilen im eigenen Betrieb, die Betriebsleitung alle, Leser und fremde Betriebe keine. Kindtabellen
-- @ziel: (Positionen, Anteile …) haben keinen Anlage-Trigger.
-- @mutation ohne_anlegen: Trigger z_protokoll_anlegen auf pflanzenschutzmittel entfernt | rot: anlegen_.*
-- @mutation ohne_eigene: Policy bestandsprotokoll_eigene entfernt | rot: winzer_sieht_eigene
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 81 (Stand 13.10.2026, KAN-332).
-- Personas aus s112_aufbau (Betrieb B mit b_w, b_ta, b_l; Musterhof-Winzer m_w) – alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '81_journal';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
  v_mw    uuid;
  v_id    uuid;
  v_id2   uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;

  -- ── Mutationen ───────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('ohne_anlegen', 'DROP TRIGGER z_protokoll_anlegen ON public.pflanzenschutzmittel');
  PERFORM pg_temp.s112_mutiere('ohne_eigene', 'DROP POLICY bestandsprotokoll_eigene ON public.bestandsprotokoll');

  -- ── 1. Neuanlage als Mitarbeiter (winzer) ─────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_winzer',
    pg_temp.s112_fehlertext(format('INSERT INTO public.pflanzenschutzmittel (tenant_id, name) VALUES (%L, %L)', v_b, 'S112TEST Journal Mittel')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT p.id INTO v_id FROM public.pflanzenschutzmittel p WHERE p.tenant_id = v_b AND p.name = 'S112TEST Journal Mittel';
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_protokolliert',
    (SELECT count(*)::text || '/' || coalesce(min(b.benutzer_id::text) = v_bw::text, false)::text || '/' || coalesce(min(b.kennung ->> 'name'), '-')
            || '/' || bool_and(b.alt IS NULL AND b.neu IS NULL AND b.geaenderte_spalten IS NULL)::text
       FROM public.bestandsprotokoll b
      WHERE b.tabelle = 'pflanzenschutzmittel' AND b.datensatz_id = v_id AND b.aktion = 'INSERT' AND b.tenant_id = v_b),
    '1/true/S112TEST Journal Mittel/true');

  -- ── 2. Änderung: Kennung des neuen Stands ─────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_winzer',
    pg_temp.s112_fehlertext(format('UPDATE public.pflanzenschutzmittel SET aktiv = false WHERE id = %L', v_id)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_kennung',
    (SELECT count(*)::text || '/' || coalesce(min(b.kennung ->> 'name'), '-')
       FROM public.bestandsprotokoll b WHERE b.tabelle = 'pflanzenschutzmittel' AND b.datensatz_id = v_id AND b.aktion = 'UPDATE'),
    '1/S112TEST Journal Mittel');

  -- ── 3. Neuanlage der Betriebsleitung ──────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_leitung',
    pg_temp.s112_fehlertext(format('INSERT INTO public.pflanzenschutzmittel (tenant_id, name) VALUES (%L, %L)', v_b, 'S112TEST Journal Leitung')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT p.id INTO v_id2 FROM public.pflanzenschutzmittel p WHERE p.tenant_id = v_b AND p.name = 'S112TEST Journal Leitung';

  -- ── 4. Lesen: eigene, alle, keine ─────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  SELECT count(*) FILTER (WHERE b.datensatz_id = v_id)::text || '/' || count(*) FILTER (WHERE b.datensatz_id = v_id2)::text
    INTO v_txt FROM public.bestandsprotokoll b WHERE b.tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_sieht_eigene', v_txt, '2/0');
  PERFORM pg_temp.s112_als(v_bta);
  SELECT count(*) FILTER (WHERE b.datensatz_id = v_id)::text || '/' || count(*) FILTER (WHERE b.datensatz_id = v_id2)::text
    INTO v_txt FROM public.bestandsprotokoll b WHERE b.tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('leitung_sieht_alle', v_txt, '2/1');
  PERFORM pg_temp.s112_als(v_bl);
  SELECT count(*)::text INTO v_txt FROM public.bestandsprotokoll b WHERE b.tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('leser_sieht_nichts', v_txt, '0');
  PERFORM pg_temp.s112_als(v_mw);
  SELECT count(*)::text INTO v_txt FROM public.bestandsprotokoll b WHERE b.tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_sieht_nichts', v_txt, '0');
  -- schreiben bleibt gesperrt (append-only), auch für die eigenen Zeilen
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_aendert_protokoll_nicht',
    pg_temp.s112_versuch(format('UPDATE public.bestandsprotokoll SET grund = %L WHERE datensatz_id = %L', 'S112TEST', v_id)), 'G');   -- kein UPDATE-Recht
  PERFORM pg_temp.s112_als_postgres();

  -- ── 5. Trigger-Abdeckung ──────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_trigger_anzahl',
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'public'::regnamespace AND t.tgname = 'z_protokoll_anlegen'
        AND t.tgfoid = 'public.bestandsprotokoll_schreiben()'::regprocedure AND t.tgtype = 5 AND t.tgqual IS NULL AND t.tgnargs = 0), 37::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('kindtabellen_ohne_anlegen',
    (SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '-') FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'z_protokoll_anlegen'
        AND c.relname IN ('ama_meldepositionen', 'behandlung_grundstuecke', 'fuellung_bewegungen', 'fuellung_chargen',
                          'pressung_behaelter', 'pressung_weingaerten', 'verkauf_positionen', 'verschneidung_quellen')), '-');
  v_erg := v_erg || pg_temp.s112_erwarte('policy_eigene_nur_authenticated',
    (SELECT p.roles::text FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'bestandsprotokoll' AND p.policyname = 'bestandsprotokoll_eigene'),
    '{authenticated}');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 12);
END $test$;
