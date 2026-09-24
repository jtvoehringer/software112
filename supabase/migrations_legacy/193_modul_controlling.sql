-- Controlling als zuschaltbares Modul (Rückmeldung 2.9.2026), analog zu
-- modul_ea (E&A-Rechnung) und modul_export (Exportaufträge):
-- Sidebar-Gruppe "Controlling" (Auswertungen, Kostenrechnung, Kosten-Auswertung,
-- Datenexport) ist nur sichtbar, wenn das Flag gesetzt ist; die Seiten selbst
-- leiten ohne Flag auf /dashboard um. Toggle in Administration → Mandanten.
--
-- Default false für neu angelegte Mandanten (bewusst zubuchbar). Bestehende
-- Mandanten haben Controlling bisher immer gesehen - damit durch diese
-- Migration niemand stillschweigend Menüpunkte verliert, werden alle
-- vorhandenen Zeilen auf true gesetzt; abschalten geht dann gezielt pro Mandant.

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS modul_controlling boolean NOT NULL DEFAULT false;

UPDATE tenant_einstellungen SET modul_controlling = true;

COMMENT ON COLUMN tenant_einstellungen.modul_controlling IS
  'Modul Controlling (Auswertungen, Kostenrechnung, Datenexport) für diesen Mandanten freigeschaltet';
