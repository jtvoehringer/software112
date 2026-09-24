-- Migration 049: Kostenrechnung – Mehrere Behälter je Buchung (analog 048 für Weingärten)

CREATE TABLE IF NOT EXISTS kosteneintrag_behaelter (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kosteneintrag_id  uuid NOT NULL REFERENCES kosteneintraege(id) ON DELETE CASCADE,
  behaelter_id      uuid NOT NULL REFERENCES behaelter(id) ON DELETE CASCADE,
  anteil_pct        numeric(5,2),
  betrag_anteil     numeric(10,2),
  UNIQUE(kosteneintrag_id, behaelter_id)
);

ALTER TABLE kosteneintrag_behaelter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "keb_tenant" ON kosteneintrag_behaelter
  USING (kosteneintrag_id IN (
    SELECT id FROM kosteneintraege WHERE tenant_id IN (
      SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
    )
  ));
