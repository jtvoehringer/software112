-- „Heute“ und „dieses Jahr“ = Wiener Kalendertag – Rest der UTC-Annahmen (Befund test:db 14.11.2026, 00:05–00:55 Wien)
--
-- Befund: DB-Test 77 war kurz nach Mitternacht rot. demo_musterhof_verkauf() beginnt mit
--   „if p_datum > <Sitzungstag> then return; end if;“ – der Sitzungstag ist UTC, zwischen 0 und 1 Uhr (Sommer: 2 Uhr)
--   Wiener Zeit also noch gestern; ein Verkauf mit dem Wiener „heute“ wurde still übersprungen.
--
-- 1. Demo-Musterhof (8 Funktionen, 16 Stellen) und s112_smoke_test (2 Stellen): der Sitzungstag wird durch
--    (now() AT TIME ZONE 'Europe/Vienna')::date ersetzt – wie in demo_musterhof_kellerbuch und allen RPCs seit Test 56.
-- 2. Produktive Funktionen mit dem Jahr bzw. Tag aus now() (UTC):
--    · s112_rechnungsnummer_ziehen: Jahr für {JJ}/{JJJJ} und den Zähler-Neubeginn – am 1. Jänner zwischen 0 und 1 Uhr
--      bekam eine Rechnung noch das alte Jahr und die fortlaufende Nummer des alten Jahres.
--    · get_next_chargennummer: Jahr in der Chargennummer – dasselbe Fenster.
--    · kontakte_zusammenfuehren: Datum im Vermerk „[Zusammengeführt in … am TT.MM.JJJJ]“ – zwischen 0 und 1 bzw. 2 Uhr
--      der Vortag.
--
-- Die Funktionen werden aus ihrer aktuellen Definition neu erzeugt (pg_get_functiondef, CREATE OR REPLACE): Rechte,
-- Eigentümer, SECURITY DEFINER und search_path bleiben; nur die genannten Ausdrücke ändern sich. Die Selbstprüfung am
-- Ende bricht ab, wenn eine Stelle übrig bleibt. Produktion und Staging hatten am 14.11.2026 identische Stände (md5).

DO $mig$
DECLARE
  c_wien  constant text := $w$(now() AT TIME ZONE 'Europe/Vienna')::date$w$;
  c_wien2 constant text := $w$(now() AT TIME ZONE ''Europe/Vienna'')::date$w$;   -- innerhalb eines SQL-Texts in '…'
  c_tag   constant text := '\mcurrent_date\M';
  r       record;
  v_alt   text;
  v_neu   text;
  v_n     integer := 0;
  v_rest  text;
BEGIN
  -- ── 1. Sitzungstag → Wiener Tag ──────────────────────────────────────────────────────────────────────
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosrc ~* c_tag
     ORDER BY p.proname
  LOOP
    v_alt := pg_get_functiondef(r.oid);
    IF r.proname = 's112_smoke_test' THEN
      v_neu := regexp_replace(v_alt, c_tag, c_wien2, 'gi');          -- steht dort in format('…')
    ELSIF r.proname LIKE 'demo\_musterhof%' THEN
      v_neu := replace(v_alt, 'Wiener Datum, nie current_date', 'Wiener Datum, nie der Sitzungstag (UTC)');   -- Kommentar
      v_neu := regexp_replace(v_neu, c_tag, c_wien, 'gi');
    ELSE
      RAISE EXCEPTION 'Unerwartete Funktion mit Sitzungstag: % – bitte einzeln beurteilen.', r.proname;
    END IF;
    EXECUTE v_neu;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Sitzungstag ersetzt in % Funktionen', v_n;

  -- ── 2. Jahr bzw. Tag aus now() → Wiener Zeit ─────────────────────────────────────────────────────────
  v_n := 0;
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
       AND p.prosrc ~* 'to_char\(now\(\),|extract\(year from now\(\)\)'
     ORDER BY p.proname
  LOOP
    v_alt := pg_get_functiondef(r.oid);
    v_neu := regexp_replace(v_alt, 'to_char\(now\(\),', $e$to_char(now() AT TIME ZONE 'Europe/Vienna',$e$, 'gi');
    v_neu := regexp_replace(v_neu, 'extract\(year from now\(\)\)', $e$extract(year from (now() AT TIME ZONE 'Europe/Vienna'))$e$, 'gi');
    EXECUTE v_neu;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Jahr/Tag aus now() ersetzt in % Funktionen', v_n;

  -- ── Selbstprüfung ────────────────────────────────────────────────────────────────────────────────────
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_rest FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
     AND (p.prosrc ~* c_tag OR p.prosrc ~* '(to_char|extract|date_part|date_trunc)\s*\(([^()]*\mfrom\s+|''[a-z]+''\s*,\s*)?now\(\)\s*[,)]');
  IF v_rest IS NOT NULL THEN
    RAISE EXCEPTION 'UTC-Tag bzw. -Jahr noch in: %', v_rest;
  END IF;
END $mig$;
