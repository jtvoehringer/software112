-- Migration 077: Transaktionsnummern
-- Zähler-Tabelle (pro Tenant, Typ und Jahr)
CREATE TABLE IF NOT EXISTS transaktionszaehler (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  typ          text    NOT NULL,
  prefix       text    NOT NULL DEFAULT '',
  zaehler      integer NOT NULL DEFAULT 0,
  jahr         integer NOT NULL,
  stellen      integer NOT NULL DEFAULT 4,
  UNIQUE (tenant_id, typ, jahr)
);

-- RLS
ALTER TABLE transaktionszaehler ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant-Mitglieder können transaktionszaehler lesen"
  ON transaktionszaehler FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
    )
  );

-- Nur SECURITY DEFINER Funktion schreibt
CREATE POLICY "Nur via RPC schreiben"
  ON transaktionszaehler FOR ALL
  USING (false)
  WITH CHECK (false);

-- Transaktionsnummer-Spalten hinzufügen
ALTER TABLE keller_umzuege     ADD COLUMN IF NOT EXISTS transaktions_nr text DEFAULT NULL;
ALTER TABLE weinausbau         ADD COLUMN IF NOT EXISTS transaktions_nr text DEFAULT NULL;
ALTER TABLE verkaufsposten     ADD COLUMN IF NOT EXISTS transaktions_nr text DEFAULT NULL;
ALTER TABLE kosteneintraege    ADD COLUMN IF NOT EXISTS transaktions_nr text DEFAULT NULL;

-- RPC: nächste Transaktionsnummer atomar vergeben
CREATE OR REPLACE FUNCTION get_next_transaktionsnr(
  p_tenant_id uuid,
  p_typ       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jahr    integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_prefix  text;
  v_zaehler integer;
  v_stellen integer;
BEGIN
  -- Standardpräfix je Typ
  v_prefix := CASE p_typ
    WHEN 'umzug'        THEN 'KU'
    WHEN 'eroeffnung'   THEN 'EB'
    WHEN 'verkauf'      THEN 'VK'
    WHEN 'kosteneintrag' THEN 'KE'
    ELSE 'TX'
  END;

  -- Atomares Upsert: neuer Eintrag oder Zähler hochzählen
  INSERT INTO transaktionszaehler (tenant_id, typ, prefix, zaehler, jahr, stellen)
  VALUES (p_tenant_id, p_typ, v_prefix, 1, v_jahr, 4)
  ON CONFLICT (tenant_id, typ, jahr) DO UPDATE
    SET zaehler = transaktionszaehler.zaehler + 1
  RETURNING prefix, zaehler, stellen
    INTO v_prefix, v_zaehler, v_stellen;

  RETURN v_prefix || '-' || v_jahr || '-' || LPAD(v_zaehler::text, v_stellen, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION get_next_transaktionsnr(uuid, text) TO authenticated;
