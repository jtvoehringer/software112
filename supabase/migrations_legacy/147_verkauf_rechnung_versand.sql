-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 147: Direkter Rechnungsversand per E-Mail aus dem Verkaufsmodul
--
-- Hält fest, wann und an welche Adresse eine Rechnung zuletzt per E-Mail
-- versendet wurde (analog zum "Versendet am ..."-Badge, wie es z.B. bei der
-- UVA-Meldung für "übermittelt" schon existiert). Rein informativ – der
-- Versand selbst läuft über die bereits bestehende, pro Mandant konfigurierte
-- SMTP- bzw. Microsoft-365-Anbindung (siehe tenant_einstellungen /
-- user_email_connections), es wird kein neuer externer E-Mail-Dienst
-- eingeführt.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE verkaufsposten
  ADD COLUMN IF NOT EXISTS rechnung_versendet_am timestamptz,
  ADD COLUMN IF NOT EXISTS rechnung_versendet_an  text;

COMMENT ON COLUMN verkaufsposten.rechnung_versendet_am IS
  'Zeitstempel des letzten erfolgreichen E-Mail-Versands der Rechnung (Verkaufsmodul, /api/weinhandel/verkauf/[id]/send).';
COMMENT ON COLUMN verkaufsposten.rechnung_versendet_an IS
  'Empfänger-E-Mail-Adresse des letzten Rechnungsversands.';
