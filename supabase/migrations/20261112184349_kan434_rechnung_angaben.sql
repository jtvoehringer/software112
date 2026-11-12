-- KAN-434 (12.11.2026): Weinexport Teil C – Angaben für Handelsrechnung und Proforma (Epic KAN-431).
--
-- Entscheidungen Jörgen 12.11.2026 (alle Fragen A):
--   1A Ursprungserklärung nur mit Ankreuzfeld am Auftrag (rechtliche Zusicherung des Betriebs), Vorgabe aus
--   3A über 6.000 EUR ohne REX- bzw. Bewilligungsnummer wird die Erklärung nicht gedruckt
--   5A Nebenkosten als zwei Felder: Fracht und Versicherung (der „Versicherungswert“ bleibt, was er ist)
-- Befreiungstext, Abkommen und Wortlaut der Erklärung werden berechnet (src/lib/export/rechnungTexte.ts), nicht gespeichert.
-- Die neuen Spalten des Auftrags stehen NICHT in der Freeze-Positivliste (KAN-429) – ab „Versendet“ sind sie gesperrt.

-- ── 1. Exportauftrag ────────────────────────────────────────────────────────────
ALTER TABLE public.exportauftraege
  ADD COLUMN fracht_eur          numeric(12,2) CONSTRAINT exportauftraege_fracht_chk CHECK (fracht_eur IS NULL OR fracht_eur >= 0),
  ADD COLUMN versicherung_eur    numeric(12,2) CONSTRAINT exportauftraege_versicherung_chk CHECK (versicherung_eur IS NULL OR versicherung_eur >= 0),
  ADD COLUMN ursprungserklaerung boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.exportauftraege.fracht_eur IS 'KAN-434: Frachtkosten in EUR, die dem Kunden verrechnet werden (Handelsrechnung)';
COMMENT ON COLUMN public.exportauftraege.versicherung_eur IS 'KAN-434: Versicherungskosten in EUR, die dem Kunden verrechnet werden (nicht der Versicherungswert)';
COMMENT ON COLUMN public.exportauftraege.ursprungserklaerung IS 'KAN-434: Ursprungserklärung des Ausführers auf Handelsrechnung und Proforma (nur bei Zielland mit Abkommen)';

-- ── 2. Betrieb ──────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN betrieb_rex_nummer     text CONSTRAINT tenant_einstellungen_rex_chk CHECK (betrieb_rex_nummer IS NULL OR char_length(betrieb_rex_nummer) <= 40),
  ADD COLUMN betrieb_ea_bewilligung text CONSTRAINT tenant_einstellungen_ea_chk CHECK (betrieb_ea_bewilligung IS NULL OR char_length(betrieb_ea_bewilligung) <= 40);
COMMENT ON COLUMN public.tenant_einstellungen.betrieb_rex_nummer IS 'KAN-434: REX-Nummer des Betriebs (Registrierter Ausführer – Ursprungserklärung über 6.000 EUR, z. B. Vereinigtes Königreich, Japan)';
COMMENT ON COLUMN public.tenant_einstellungen.betrieb_ea_bewilligung IS 'KAN-434: Bewilligungsnummer als Ermächtigter Ausführer (Ursprungserklärung über 6.000 EUR, z. B. Südkorea, Schweiz)';
GRANT SELECT (betrieb_rex_nummer, betrieb_ea_bewilligung) ON public.tenant_einstellungen TO authenticated, anon;

-- ── 3. s112_exportauftrag_aendern nimmt die neuen Felder (genau eine Stelle, sonst Abbruch) ──────────────────────────
DO $kan434$
DECLARE
  v_def text;
  c_alt constant text := '    mustersendung       = coalesce(p_kopf ->> ''mustersendung'', '''') = ''true''
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;';
  c_neu constant text := '    mustersendung       = coalesce(p_kopf ->> ''mustersendung'', '''') = ''true'',
    -- KAN-434: Nebenkosten und Ursprungserklärung (Handelsrechnung, Proforma)
    fracht_eur          = NULLIF(p_kopf ->> ''fracht_eur'', '''')::numeric,
    versicherung_eur    = NULLIF(p_kopf ->> ''versicherung_eur'', '''')::numeric,
    ursprungserklaerung = coalesce(p_kopf ->> ''ursprungserklaerung'', '''') = ''true''
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_exportauftrag_aendern';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-434: s112_exportauftrag_aendern – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan434$;
