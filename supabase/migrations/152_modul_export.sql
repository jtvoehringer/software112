-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 152: tenant_einstellungen – Modul-Toggle für Exportaufträge (Weinexport)
--
-- "Exportaufträge" (Warenwirtschaft/Weinexport) wird nicht von jedem Mandanten
-- benötigt (7.8.2026) - analog zu modul_ea/modul_sumup (Migration 098) wird das
-- Modul jetzt pro Mandant unter Admin > Mandant > Module ein-/ausschaltbar.
-- Default false: bestehende Mandanten sehen das Modul erst nach expliziter
-- Aktivierung durch einen system_admin.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS modul_export boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant_einstellungen.modul_export IS 'Exportaufträge-Modul (Weinexport) aktiv';
