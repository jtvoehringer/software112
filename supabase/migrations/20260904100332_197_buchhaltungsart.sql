ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS buchhaltungsart text NOT NULL DEFAULT 'ea'
  CHECK (buchhaltungsart IN ('ea', 'doppik'));
COMMENT ON COLUMN tenant_einstellungen.buchhaltungsart IS 'ea = E&A-Rechnung in software:112, doppik = doppelte Buchhaltung beim Steuerberater (BMD-Übergabe, UVA nur Vorschau)';;
