-- KAN-419 Nachtrag (13.11.2026): Gutschriftnummer kürzt nicht mehr bei Zählern über der Stellenzahl.
--
-- Befund (DB-Test 94 im Gesamtlauf zu KAN-455): s112_gutschriftnummer_ziehen (kan419a) baute die Nummer mit lpad –
-- lpad kürzt, nach GS-2026-9999 käme bei 4 Stellen zweimal „1000“ (derselbe Fehler wie KAN-422 bei der Chargennummer).
-- Jetzt wie alle Nummernkreise über s112_nummer_text (füllt auf, kürzt nie). Bestehende Nummern bleiben unverändert.
DO $kan419c$
DECLARE
  v_oid oid;
  v_alt text;
  v_neu text;
  c_alt constant text := $a$lpad(v_nummer::text, v_stellen, '0')$a$;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 's112_gutschriftnummer_ziehen';
  v_alt := pg_get_functiondef(v_oid);
  IF (length(v_alt) - length(replace(v_alt, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-419: s112_gutschriftnummer_ziehen – Anker nicht genau einmal';
  END IF;
  v_neu := replace(v_alt, c_alt, 'public.s112_nummer_text(v_nummer::bigint, v_stellen)');
  EXECUTE v_neu;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 's112_gutschriftnummer_ziehen' AND p.prosrc ~* 'lpad\(') THEN
    RAISE EXCEPTION 'KAN-419: s112_gutschriftnummer_ziehen kürzt noch';
  END IF;
END
$kan419c$;
