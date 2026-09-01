-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 191: DebitorNr. (BMD-Konto) für Firmen
--
-- Rückmeldung 1.9.2026 (Weingut Gebeshuber): "Das Kellerbuch" (Altsystem)
-- führt pro Kunde eine "DebitorNr." - das ist die tatsächliche Kontonummer im
-- Kontenplan der Buchhaltungssoftware (BMD NTCS), NICHT unsere interne,
-- fortlaufend vergebene accountnummer. Bei der hochgeladenen Kellerbuch-Liste
-- (1173 Zeilen) ist DebitorNr. in JEDER Zeile befüllt und eindeutig
-- (z.B. "227002"), Betriebsnr./KundenNr. dagegen fast nie.
--
-- Zweck: beim BMD-Export (export/bmd/route.ts) und beim Verkaufs-/E&A-Export
-- muss als Buchungskonto die echte DebitorNr. verwendet werden, sonst landen
-- Buchungen im BMD auf einem falschen bzw. unbekannten Konto. Scope laut
-- Rückmeldung bewusst nur Firmen (die Kellerbuch-Liste enthält ausschließlich
-- firmenartige Einträge, kein Vorname/Nachname-Schema; Betriebsnummer ist aus
-- demselben Grund ebenfalls nur bei Firmen vorhanden).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS debitor_nr text;

CREATE INDEX IF NOT EXISTS idx_firmen_debitor_nr ON firmen (tenant_id, debitor_nr) WHERE debitor_nr IS NOT NULL;

COMMENT ON COLUMN firmen.debitor_nr IS
  'Debitorenkonto-Nummer aus der externen Buchhaltung (BMD NTCS) bzw. aus dem Altsystem "Das Kellerbuch" - unabhängig von der intern vergebenen accountnummer. Wird bevorzugt als Buchungskonto (KONTO) im BMD-Export sowie als Referenzspalte im Verkaufs-/E&A-Export verwendet, sofern gesetzt.';
