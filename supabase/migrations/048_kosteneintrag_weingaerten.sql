-- Migration 048: Kostenrechnung – Mehrere Weingärten je Buchung

CREATE TABLE IF NOT EXISTS kosteneintrag_weingaerten (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kosteneintrag_id  uuid NOT NULL REFERENCES kosteneintraege(id) ON DELETE CASCADE,
  weingarten_id     uuid NOT NULL REFERENCES weingarten(id) ON DELETE CASCADE,
  anteil_pct        numeric(5,2),      -- Anteil in % (null = gleichmäßig)
  betrag_anteil     numeric(10,2),     -- Berechneter Betrag
  UNIQUE(kosteneintrag_id, weingarten_id)
);

ALTER TABLE kosteneintrag_weingaerten ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kew_tenant" ON kosteneintrag_weingaerten
  USING (kosteneintrag_id IN (
    SELECT id FROM kosteneintraege WHERE tenant_id IN (
      SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
    )
  ));
