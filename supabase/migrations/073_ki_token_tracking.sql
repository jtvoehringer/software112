-- Migration 073: KI-Token-Tracking
-- Kumulierte Input/Output-Token pro Mandant für Haiku API-Kosten-Ausweis

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS ki_input_tokens_total  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ki_output_tokens_total bigint NOT NULL DEFAULT 0;

-- Atomare Increment-Funktion (fire-and-forget aus der API Route)
CREATE OR REPLACE FUNCTION increment_ki_tokens(
  p_tenant_id     uuid,
  p_input_tokens  int,
  p_output_tokens int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tenant_einstellungen
  SET
    ki_input_tokens_total  = ki_input_tokens_total  + p_input_tokens,
    ki_output_tokens_total = ki_output_tokens_total + p_output_tokens
  WHERE tenant_id = p_tenant_id;
END;
$$;
