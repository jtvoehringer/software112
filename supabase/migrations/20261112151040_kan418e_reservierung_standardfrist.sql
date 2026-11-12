-- KAN-418 Teil 5 (12.11.2026): Standardfrist der Reservierung je Betrieb.
-- Bisher galt fest „14 Tage“ (Formular-Vorschlag und Rückfall in s112_auftrag_anlegen). Jetzt stellt der Betrieb die
-- Frist unter „Mein Betrieb“ ein (1–365 Tage, Standard 14). Lesbar per Spaltenrecht, geschrieben nur per Service-Role
-- (saveBrandingOwn) – wie die anderen Dashboard-Regeln.

ALTER TABLE public.tenant_einstellungen
  ADD COLUMN auftrag_reservierung_tage integer NOT NULL DEFAULT 14
    CONSTRAINT tenant_einstellungen_auftrag_reservierung_chk CHECK (auftrag_reservierung_tage BETWEEN 1 AND 365);
COMMENT ON COLUMN public.tenant_einstellungen.auftrag_reservierung_tage IS
  'KAN-418: Standardfrist einer Reservierung in Tagen ab Auftragsdatum (Vorschlag im Formular, Rückfall in s112_auftrag_anlegen)';
GRANT SELECT (auftrag_reservierung_tage) ON public.tenant_einstellungen TO authenticated, anon;

-- Rückfall in s112_auftrag_anlegen: Frist des Betriebs statt fester 14 Tage (genau eine Stelle, sonst Abbruch)
DO $kan418e$
DECLARE
  v_def text;
  c_alt constant text := 'v_datum + 14);';
  c_neu constant text := 'v_datum + COALESCE((SELECT e.auftrag_reservierung_tage FROM public.tenant_einstellungen e WHERE e.tenant_id = p_tenant_id), 14));';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_auftrag_anlegen';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-418: s112_auftrag_anlegen – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan418e$;
