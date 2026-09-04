-- Buchhaltungsart je Mandant (Rückmeldung 4.9.2026, Paket "Standard" / Modul E&A):
--   'ea'     = Einnahmen-Ausgaben-Rechnung in software:112 (UVA, Monatsabschluss
--              und Jahresergebnis entstehen hier) - bisheriges Verhalten.
--   'doppik' = doppelte Buchhaltung beim Steuerberater (BMD NTCS). software:112
--              ist nur Vorsystem: Rechnungen und Eingangsbelege werden erfasst
--              und per BMD-Übergabe (Migration 196) weitergegeben. Die UVA
--              meldet die Kanzlei aus BMD - bei uns nur Vorschau, keine Meldung.
-- Auswahl in Administration → Mandanten → Module (Entweder/Oder unter dem
-- E&A-Schalter), wirkt nur, wenn modul_ea aktiv ist.
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS buchhaltungsart text NOT NULL DEFAULT 'ea'
  CHECK (buchhaltungsart IN ('ea', 'doppik'));
COMMENT ON COLUMN tenant_einstellungen.buchhaltungsart IS 'ea = E&A-Rechnung in software:112, doppik = doppelte Buchhaltung beim Steuerberater (BMD-Übergabe, UVA nur Vorschau)';
