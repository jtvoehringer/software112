-- KAN-436 E1 (12.11.2026): Der Schutz der Verknüpfung Exportauftrag–Verkauf läuft nach der Prüfung des Fremdverweises.
-- Als „a_export_rechnung_schutz“ lief er vor „z_fremdverweis_verkaufsposten_id“ und meldete beim Verkauf eines fremden
-- Betriebs „Verkauf fehlt“ (23514) statt der Ablehnung des Fremdverweises (DB-Test 11). Reihenfolge = Name des Triggers.
ALTER TRIGGER a_export_rechnung_schutz ON public.exportauftraege RENAME TO zz_export_rechnung_schutz;
