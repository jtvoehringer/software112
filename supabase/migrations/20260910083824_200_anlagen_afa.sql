CREATE TABLE IF NOT EXISTS ea_anlagen (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  gruppe               text,
  konto_nr             smallint,
  anschaffung_am       date NOT NULL,
  ak_netto             numeric(14,2) NOT NULL CHECK (ak_netto >= 0),
  nutzungsdauer_jahre  smallint NOT NULL DEFAULT 1 CHECK (nutzungsdauer_jahre BETWEEN 1 AND 100),
  methode              text NOT NULL DEFAULT 'linear' CHECK (methode IN ('linear', 'degressiv', 'gwg')),
  degressiv_satz       numeric(5,2) CHECK (degressiv_satz IS NULL OR (degressiv_satz > 0 AND degressiv_satz <= 30)),
  restwert             numeric(14,2) NOT NULL DEFAULT 0 CHECK (restwert >= 0),
  abgang_am            date,
  veraeusserungserloes numeric(14,2),
  transaktion_id       uuid REFERENCES ea_transaktionen(id) ON DELETE SET NULL,
  notizen              text,
  erstellt_am          timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ea_anlagen_restwert_max  CHECK (restwert <= ak_netto),
  CONSTRAINT ea_anlagen_abgang_folgt  CHECK (abgang_am IS NULL OR abgang_am >= anschaffung_am)
);
COMMENT ON TABLE ea_anlagen IS 'Anlagenverzeichnis je Mandant. AfA-Plan, Buchwert und Anlagenspiegel werden in der Anwendung gerechnet (src/lib/ea/anlagen.ts).';
CREATE INDEX IF NOT EXISTS ea_anlagen_tenant_idx ON ea_anlagen (tenant_id, anschaffung_am);

CREATE OR REPLACE FUNCTION public.trg_ea_anlagen_aktualisiert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.aktualisiert_am := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS ea_anlagen_aktualisiert ON ea_anlagen;
CREATE TRIGGER ea_anlagen_aktualisiert BEFORE UPDATE ON ea_anlagen
  FOR EACH ROW EXECUTE FUNCTION public.trg_ea_anlagen_aktualisiert();

CREATE OR REPLACE FUNCTION public.trg_ea_anlagen_transaktion_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaktion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ea_transaktionen t WHERE t.id = NEW.transaktion_id AND t.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Die Buchung gehört nicht zu diesem Betrieb.'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS ea_anlagen_transaktion_tenant ON ea_anlagen;
CREATE TRIGGER ea_anlagen_transaktion_tenant BEFORE INSERT OR UPDATE OF transaktion_id, tenant_id ON ea_anlagen
  FOR EACH ROW EXECUTE FUNCTION public.trg_ea_anlagen_transaktion_tenant();

ALTER TABLE ea_anlagen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ea_anlagen_select ON ea_anlagen;
CREATE POLICY ea_anlagen_select ON ea_anlagen FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ea_anlagen_write ON ea_anlagen;
CREATE POLICY ea_anlagen_write ON ea_anlagen FOR ALL
  USING (user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));

ALTER TABLE ea_transaktionen ADD COLUMN IF NOT EXISTS anlage_id uuid REFERENCES ea_anlagen(id) ON DELETE RESTRICT;
COMMENT ON COLUMN ea_transaktionen.anlage_id IS 'AfA-Buchung: Anlage, deren Jahres-Abschreibung diese Buchung ist (per 31.12., Konto 7010, 0 % USt, ohne Konto). NULL bei allen anderen Buchungen. Eine Anlage mit AfA-Buchungen kann nicht gelöscht werden.';
CREATE UNIQUE INDEX IF NOT EXISTS ea_transaktionen_afa_je_jahr
  ON ea_transaktionen (anlage_id, (EXTRACT(YEAR FROM datum)::int)) WHERE anlage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ea_transaktionen_anlage_idx ON ea_transaktionen (tenant_id, anlage_id) WHERE anlage_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_ea_transaktion_anlage_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.anlage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ea_anlagen a WHERE a.id = NEW.anlage_id AND a.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Die Anlage gehört nicht zu diesem Betrieb.'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS ea_transaktionen_anlage_tenant ON ea_transaktionen;
CREATE TRIGGER ea_transaktionen_anlage_tenant BEFORE INSERT OR UPDATE OF anlage_id, tenant_id ON ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.trg_ea_transaktion_anlage_tenant();

INSERT INTO ea_kategorien (tenant_id, typ, name, konto_nr, ust_satz_std, aktiv, sortierung, abzugsfaehig_pct)
SELECT NULL, 'ausgabe', 'Anlagenkauf (aktivierungspflichtig)', 660, 20, true, 175, 100
WHERE NOT EXISTS (SELECT 1 FROM ea_kategorien WHERE tenant_id IS NULL AND name = 'Anlagenkauf (aktivierungspflichtig)');
INSERT INTO ea_kategorien (tenant_id, typ, name, konto_nr, ust_satz_std, aktiv, sortierung, abzugsfaehig_pct)
SELECT NULL, 'ausgabe', 'Abschreibung (AfA)', 7010, 0, true, 176, 100
WHERE NOT EXISTS (SELECT 1 FROM ea_kategorien WHERE tenant_id IS NULL AND name = 'Abschreibung (AfA)');;
