-- Migration 107: Zeiterfassung (IC&P Projektaufwände)

CREATE TABLE IF NOT EXISTS zeiterfassung (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  datum             date        NOT NULL,
  phase             smallint    NOT NULL DEFAULT 0,
  beschreibung      text        NOT NULL,
  stunden           numeric(6,2) NOT NULL DEFAULT 0,
  stundensatz       numeric(7,2) NOT NULL DEFAULT 50,
  tokens_input      integer,
  tokens_output     integer,
  token_kosten_euro numeric(10,4),
  erstellt_am       timestamptz DEFAULT now(),
  aktualisiert_am   timestamptz DEFAULT now()
);

ALTER TABLE zeiterfassung ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zeiterfassung_tenant_admin" ON zeiterfassung
  FOR ALL
  USING (
    tenant_id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND rolle = 'tenant_admin'
    )
  )
  WITH CHECK (
    tenant_id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND rolle = 'tenant_admin'
    )
  );
