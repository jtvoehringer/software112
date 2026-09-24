-- Fix: preislisten_positionen hat keinen updated_at-Spalte aber den Trigger
-- Lösung: updated_at-Spalte ergänzen (konsistent mit anderen Tabellen)

ALTER TABLE preislisten_positionen
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
