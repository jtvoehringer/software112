-- E-Mail-Spiegelung ins CRM (Rückmeldung 17.9.2026: „alle Nachrichten spiegeln,
-- ältere dürfen nicht verloren gehen“). Bisher landete eine E-Mail nur dann als
-- Aktivität beim Kontakt, wenn sie in software:112 geöffnet wurde (oder über den
-- Graph-Webhook eines Tenant-Postfachs). Der tägliche Cron (lib/email/spiegel.ts)
-- geht jetzt je verbundenem Postfach Posteingang + Gesendet durch und legt für
-- bekannte Kontakte/Firmen fehlende Aktivitäten an - inkrementell ab diesem Stand.
ALTER TABLE user_email_connections
  ADD COLUMN IF NOT EXISTS email_spiegel_stand timestamptz,
  ADD COLUMN IF NOT EXISTS email_spiegel_info  text;
COMMENT ON COLUMN user_email_connections.email_spiegel_stand IS 'Bis zu diesem Zeitpunkt wurden Posteingang/Gesendet ins CRM gespiegelt (Cron).';
