-- Migration 111: Traubenverkauf Erweiterungen (P2-Handlungsbedarf)
-- 1. Gesundheitsstatus der angelieferten Trauben (G=Gut / K=Krank)
-- 2. nachhaltig Austria Flag pro Weingarten
-- 3. Liefernummer (auto-generiert, analog Rechnungsnummer)

-- ── 1. Gesundheitsstatus ────────────────────────────────────────────────────
ALTER TABLE traubenverkauf
  ADD COLUMN IF NOT EXISTS gesundheit CHAR(1) NOT NULL DEFAULT 'G'
  CHECK (gesundheit IN ('G', 'K'));

COMMENT ON COLUMN traubenverkauf.gesundheit IS
  'Gesundheitsstatus der Trauben: G=Gut (Standard), K=Krank/beschädigt';

-- ── 2. nachhaltig Austria ───────────────────────────────────────────────────
ALTER TABLE weingarten
  ADD COLUMN IF NOT EXISTS nachhaltig_austria BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN weingarten.nachhaltig_austria IS
  'Mitglied im Programm „nachhaltig Austria" (Zertifizierungsnachweis)';

-- ── 3. Liefernummer ─────────────────────────────────────────────────────────
-- Nummerierungsparameter im Mandanten
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS liefernummer_prefix  TEXT    NOT NULL DEFAULT 'LN',
  ADD COLUMN IF NOT EXISTS liefernummer_zaehler INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liefernummer_stellen  INTEGER NOT NULL DEFAULT 4;

-- Liefernummer-Spalte in traubenverkauf
ALTER TABLE traubenverkauf
  ADD COLUMN IF NOT EXISTS liefernummer TEXT;

COMMENT ON COLUMN traubenverkauf.liefernummer IS
  'Auto-generierte Liefernummer (Transportscheinnummer), z.B. LN-2025-0001';

-- RPC: nächste Liefernummer atomar ermitteln und Zähler hochzählen
CREATE OR REPLACE FUNCTION get_next_liefernummer(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prefix   TEXT;
  v_zaehler  INTEGER;
  v_stellen  INTEGER;
  v_jahr     TEXT;
BEGIN
  UPDATE tenant_einstellungen
  SET    liefernummer_zaehler = liefernummer_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING liefernummer_prefix, liefernummer_zaehler, liefernummer_stellen
  INTO v_prefix, v_zaehler, v_stellen;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % nicht gefunden', p_tenant_id;
  END IF;

  v_jahr := to_char(CURRENT_DATE, 'YYYY');

  RETURN v_prefix || '-' || v_jahr || '-' || lpad(v_zaehler::TEXT, v_stellen, '0');
END;
$$;
