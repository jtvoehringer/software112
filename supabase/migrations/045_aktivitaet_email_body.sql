-- Migration 045: Vollständiger Email-Body in Aktivitäten
-- Emails bleiben im CRM gespeichert, auch wenn Mailbox bereinigt wird

ALTER TABLE aktivitaeten
  ADD COLUMN IF NOT EXISTS email_von      text,   -- Absender-Adresse
  ADD COLUMN IF NOT EXISTS email_von_name text,   -- Absender-Name
  ADD COLUMN IF NOT EXISTS email_an       text,   -- Empfänger(innen)
  ADD COLUMN IF NOT EXISTS email_body     text,   -- Plain-Text Body (dauerhaft)
  ADD COLUMN IF NOT EXISTS email_body_html text;  -- HTML Body (dauerhaft)
