ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS email_weitere text[] NOT NULL DEFAULT '{}';
ALTER TABLE firmen   ADD COLUMN IF NOT EXISTS email_weitere text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS kontakte_email_weitere_gin ON kontakte USING gin (email_weitere);
CREATE INDEX IF NOT EXISTS firmen_email_weitere_gin   ON firmen   USING gin (email_weitere);;
