-- KAN-422 (12.11.2026): Nummernkreise kürzen nicht mehr, wenn der Zähler die eingestellte Stellenzahl überschreitet.
--
-- Befund: Musterhof-Reset vom 12.11.2026 unvollständig (Chargen 26 statt 31, kein Journal …). lpad(zaehler, stellen, '0')
-- KÜRZT längere Werte – aus 1000 und 1001 wird bei 3 Stellen jeweils „100“ → 23505 weinausbau_chargennummer_key.
-- Dieselbe Zeile steht in allen Nummernfunktionen (Rechnung, Storno, Lieferschein, Charge, Transaktion, Export,
-- Liefernummer): ein Betrieb mit 4-stelligem Rechnungskreis bekäme bei der 10.000. Rechnung eine doppelte Nummer.
-- Auslöser in der Demo: demo_musterhof_zuruecksetzen() setzte weinausbau_zaehler nie zurück (+31 je Nacht).
--
-- 1. s112_nummer_text(zahl, stellen): füllt mit Nullen auf, kürzt nie.
-- 2. Alle Nummernfunktionen verwenden sie (Ersetzen der einen lpad-Stelle je Funktion, Prüfung auf genau einen Treffer).
-- 3. demo_musterhof_zuruecksetzen() setzt weinausbau_zaehler = 1.

CREATE FUNCTION public.s112_nummer_text(p_zahl bigint, p_stellen integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_zahl IS NULL THEN NULL
    WHEN p_stellen IS NULL OR length(p_zahl::text) >= p_stellen THEN p_zahl::text
    ELSE lpad(p_zahl::text, p_stellen, '0')
  END
$$;

COMMENT ON FUNCTION public.s112_nummer_text(bigint, integer) IS
  'Laufende Nummer als Text: mit führenden Nullen auf p_stellen aufgefüllt, längere Zahlen bleiben vollständig (lpad würde kürzen). KAN-422.';

-- get_next_exportnummer läuft als INVOKER im Benutzerkontext → authenticated braucht EXECUTE; die Funktion liest nichts.
REVOKE EXECUTE ON FUNCTION public.s112_nummer_text(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_nummer_text(bigint, integer) TO authenticated, service_role;

DO $kan422$
DECLARE
  c_muster constant text := 'lpad\((v_[a-z_]+)::text,\s*(v_[a-z_]+|3),\s*''0''\)';
  r        record;
  v_def    text;
  v_n      integer;
  v_anzahl integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_next_accountnummer', 'get_next_chargennummer', 'get_next_exportnummer', 'get_next_liefernummer', 'get_next_transaktionsnr',
                         's112_lieferscheinnummer_ziehen', 's112_naechste_weinausbau_nummer', 's112_rechnungsnummer_ziehen',
                         's112_stornonummer_ziehen', 'demo_musterhof_txnr', 'demo_musterhof_fuellen')
     ORDER BY p.proname
  LOOP
    v_def := pg_get_functiondef(r.oid);
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_muster, 'gi');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'KAN-422: % – lpad-Stelle %× statt genau einmal gefunden', r.proname, v_n;
    END IF;
    EXECUTE regexp_replace(v_def, c_muster, 'public.s112_nummer_text(\1, \2)', 'gi');
    v_anzahl := v_anzahl + 1;
  END LOOP;
  IF v_anzahl <> 11 THEN
    RAISE EXCEPTION 'KAN-422: % statt 11 Nummernfunktionen gefunden', v_anzahl;
  END IF;

  -- Demo-Reset: Chargen-Zähler mit zurücksetzen (alle Chargen des Musterhofs werden vorher gelöscht)
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'demo_musterhof_zuruecksetzen';
  v_n := (length(v_def) - length(replace(v_def, 'charge_zaehler = 1, liefernummer_zaehler = 0,', '')))
         / length('charge_zaehler = 1, liefernummer_zaehler = 0,');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'KAN-422: demo_musterhof_zuruecksetzen – Zähler-Zeile %× statt genau einmal gefunden', v_n;
  END IF;
  EXECUTE replace(v_def, 'charge_zaehler = 1, liefernummer_zaehler = 0,',
                         'charge_zaehler = 1, liefernummer_zaehler = 0, weinausbau_zaehler = 1,');

  -- Selbstprüfung: keine Nummernfunktion kürzt mehr
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname <> 's112_nummer_text' AND p.prosrc ~* c_muster) THEN
    RAISE EXCEPTION 'KAN-422: es gibt noch eine Nummernfunktion mit lpad(v_…, stellen)';
  END IF;
  IF public.s112_nummer_text(7, 3) <> '007' OR public.s112_nummer_text(1000, 3) <> '1000' OR public.s112_nummer_text(999, 3) <> '999' THEN
    RAISE EXCEPTION 'KAN-422: s112_nummer_text rechnet falsch';
  END IF;
END
$kan422$;
