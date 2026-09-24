ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS debitor_nr text;

CREATE INDEX IF NOT EXISTS idx_firmen_debitor_nr ON firmen (tenant_id, debitor_nr) WHERE debitor_nr IS NOT NULL;

COMMENT ON COLUMN firmen.debitor_nr IS
  'Debitorenkonto-Nummer aus der externen Buchhaltung (BMD NTCS) bzw. aus dem Altsystem "Das Kellerbuch" - unabhängig von der intern vergebenen accountnummer. Wird bevorzugt als Buchungskonto (KONTO) im BMD-Export sowie als Referenzspalte im Verkaufs-/E&A-Export verwendet, sofern gesetzt.';;
