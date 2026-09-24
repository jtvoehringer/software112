ALTER TABLE user_email_connections
  ADD COLUMN IF NOT EXISTS email_spiegel_stand timestamptz,
  ADD COLUMN IF NOT EXISTS email_spiegel_info  text;
COMMENT ON COLUMN user_email_connections.email_spiegel_stand IS 'Bis zu diesem Zeitpunkt wurden Posteingang/Gesendet ins CRM gespiegelt (Cron).';;
