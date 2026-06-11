-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 071: Auto-Chargennummer
-- Nummernkreis für Abfüllungs-Chargennummern (Muster: CH-2025-001)
-- Analog zu rechnung_prefix/zaehler/stellen (Migration 026)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS charge_prefix   TEXT    NOT NULL DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS charge_zaehler  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS charge_stellen  INTEGER NOT NULL DEFAULT 3;

-- ── RPC: nächste Chargennummer atomar vergeben ────────────────────────────────
CREATE OR REPLACE FUNCTION get_next_chargennummer(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prefix   TEXT;
  v_stellen  INTEGER;
  v_zaehler  INTEGER;
  v_jahr     TEXT;
BEGIN
  UPDATE tenant_einstellungen
  SET    charge_zaehler = charge_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING
    charge_prefix,
    charge_stellen,
    charge_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;

  v_jahr := to_char(now(), 'YYYY');
  RETURN v_prefix || '-' || v_jahr || '-' || lpad(v_zaehler::TEXT, v_stellen, '0');
END;
$$;

REVOKE ALL    ON FUNCTION get_next_chargennummer(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_next_chargennummer(UUID) TO authenticated;
