DROP INDEX IF EXISTS idx_aktivitaeten_email_id;
CREATE UNIQUE INDEX IF NOT EXISTS aktivitaeten_tenant_email_id_uq ON aktivitaeten (tenant_id, email_id);;
