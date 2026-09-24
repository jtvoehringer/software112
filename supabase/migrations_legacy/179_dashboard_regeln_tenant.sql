-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 179: Dashboard-Regeln je Betrieb (Folge des Dashboard-Relaunch)
--
-- Bisher waren die beiden Schwellwerte Code-Konstanten (GAERUNG_MESSINTERVALL_TAGE = 3,
-- FAELLIG_TAGE = 30 in dashboard/_shared/data.ts). Jetzt je Betrieb in
-- "Mein Betrieb" > Branding einstellbar; die Konstanten bleiben als Fallback.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS gaerung_messintervall_tage smallint NOT NULL DEFAULT 3
    CHECK (gaerung_messintervall_tage BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS fristen_vorwarnung_tage smallint NOT NULL DEFAULT 30
    CHECK (fristen_vorwarnung_tage BETWEEN 1 AND 365);

COMMENT ON COLUMN tenant_einstellungen.gaerung_messintervall_tage IS 'Dashboard-Regel "Messung fällig": Charge in Gärung ohne Weinanalyse seit X Tagen (Kanban, Übersicht, Glocke).';
COMMENT ON COLUMN tenant_einstellungen.fristen_vorwarnung_tage IS 'Dashboard-Regel: Frist gilt X Tage vor Fälligkeit als "fällig" (Ampel, Glocke).';
