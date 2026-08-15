-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 163: Konten & Kontoabstimmung (Phase 2 des KPS-GAP-Portings)
--
-- Neu: Bankkonten/Kassen pro Mandant (konten), Umbuchungen zwischen Konten
-- (konto_umbuchungen) und ein "Bezahlt über"-Konto auf bestehenden Zahlungen
-- (zahlungen) und E&A-Buchungen (ea_transaktionen). Kein neues Buchhaltungs-
-- Kernmodell (kein FIBU-Revival – das wurde in Migration 143 bewusst und
-- vollständig entfernt) – nur eine Kontozuordnung + Abgleich-Flag auf den
-- bereits bestehenden Geldbewegungen.
--
-- Wichtig: Umbuchungen (konto_umbuchungen) sind eine komplett eigene Tabelle,
-- die NIE in ea_transaktionen landet – dadurch bleiben sie automatisch aus
-- Monatsübersicht/UVA/BMD-Export/Dashboard draußen, ohne dass an diesen
-- Stellen zusätzlich gefiltert werden müsste (reine Innenbuchungen sind
-- keine Einnahme/Ausgabe).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Konten ─────────────────────────────────────────────────────────────────
CREATE TABLE konten (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              text          NOT NULL,               -- z.B. "Raiffeisen Girokonto"
  iban              text,
  typ               text          NOT NULL DEFAULT 'giro'
    CHECK (typ IN ('giro', 'kreditkarte', 'kassa', 'sonstiges')),
  eroeffnungsdatum  date          NOT NULL,
  eroeffnungssaldo  numeric(12,2) NOT NULL DEFAULT 0,
  aktiv             boolean       NOT NULL DEFAULT true,
  sortierung        smallint      NOT NULL DEFAULT 0,
  erstellt_am       timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE konten IS 'Bankkonten/Kassen eines Mandanten für die Kontoabstimmung';

CREATE INDEX idx_konten_tenant ON konten(tenant_id);

ALTER TABLE konten ENABLE ROW LEVEL SECURITY;

CREATE POLICY "konten_select" ON konten
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

-- Konten anlegen/ändern ist administrativ (Kontenstruktur), bewusst enger
-- als das laufende Erfassen von Zahlungen/Buchungen (dort bleibt winzer dabei).
CREATE POLICY "konten_write" ON konten
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );

-- ── 2) "Bezahlt über"-Konto + Abgleich-Flag auf bestehenden Geldbewegungen ──

ALTER TABLE zahlungen
  ADD COLUMN konto_id    uuid    REFERENCES konten(id) ON DELETE SET NULL,
  ADD COLUMN abgeglichen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN zahlungen.konto_id    IS 'Konto, über das die Zahlung eingegangen ist (für Kontoabstimmung)';
COMMENT ON COLUMN zahlungen.abgeglichen IS 'Manuell gegen den Kontoauszug abgeglichen (Kontoabstimmung)';

ALTER TABLE ea_transaktionen
  ADD COLUMN konto_id    uuid    REFERENCES konten(id) ON DELETE SET NULL,
  ADD COLUMN abgeglichen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ea_transaktionen.konto_id    IS 'Konto, über das die Buchung lief (optional, für Kontoabstimmung)';
COMMENT ON COLUMN ea_transaktionen.abgeglichen IS 'Manuell gegen den Kontoauszug abgeglichen (Kontoabstimmung)';

CREATE INDEX idx_zahlungen_konto      ON zahlungen(konto_id)      WHERE konto_id IS NOT NULL;
CREATE INDEX idx_ea_tx_konto          ON ea_transaktionen(konto_id) WHERE konto_id IS NOT NULL;

-- ── 3) Umbuchungen zwischen Konten ────────────────────────────────────────────
CREATE TABLE konto_umbuchungen (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  von_konto_id     uuid          NOT NULL REFERENCES konten(id) ON DELETE RESTRICT,
  nach_konto_id    uuid          NOT NULL REFERENCES konten(id) ON DELETE RESTRICT,
  betrag           numeric(12,2) NOT NULL CHECK (betrag > 0),
  datum            date          NOT NULL DEFAULT CURRENT_DATE,
  beschreibung     text,
  von_abgeglichen  boolean       NOT NULL DEFAULT false,
  nach_abgeglichen boolean       NOT NULL DEFAULT false,
  erstellt_von     uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am      timestamptz   NOT NULL DEFAULT now(),
  CHECK (von_konto_id <> nach_konto_id)
);

COMMENT ON TABLE konto_umbuchungen IS 'Umbuchungen zwischen zwei Konten desselben Mandanten (z.B. Giro -> Kreditkarte); bewusst NICHT in ea_transaktionen, da reine Innenbuchung ohne Einnahme/Ausgabe-Charakter';

CREATE INDEX idx_konto_umbuchungen_tenant ON konto_umbuchungen(tenant_id);
CREATE INDEX idx_konto_umbuchungen_von    ON konto_umbuchungen(von_konto_id);
CREATE INDEX idx_konto_umbuchungen_nach   ON konto_umbuchungen(nach_konto_id);

ALTER TABLE konto_umbuchungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "konto_umbuchungen_select" ON konto_umbuchungen
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "konto_umbuchungen_insert" ON konto_umbuchungen
  FOR INSERT WITH CHECK (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "konto_umbuchungen_delete" ON konto_umbuchungen
  FOR DELETE USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );

-- ── 4) Funktion: Abgleich-Flag setzen (umgeht is_locked bewusst) ─────────────
-- Das "Abgeglichen"-Häkchen ist ein reiner Bankabstimmungs-Status, kein
-- Inhalt der Buchung – deshalb bewusst unabhängig von Monatsabschluss/UVA-
-- Sperre über eine SECURITY DEFINER-Funktion gesetzt (Kontoauszüge treffen
-- oft erst nach dem Monatsabschluss ein). Die Rollenprüfung (mind. Schreib-
-- recht) erfolgt in der aufrufenden Server Action, nicht hier.
CREATE OR REPLACE FUNCTION setze_kontobewegung_abgeglichen(
  p_tenant_id   uuid,
  p_quelle      text,   -- 'zahlung' | 'ea_transaktion' | 'umbuchung_von' | 'umbuchung_nach'
  p_id          uuid,
  p_abgeglichen boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_quelle = 'zahlung' THEN
    UPDATE zahlungen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'ea_transaktion' THEN
    UPDATE ea_transaktionen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_von' THEN
    UPDATE konto_umbuchungen SET von_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_nach' THEN
    UPDATE konto_umbuchungen SET nach_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSE
    RAISE EXCEPTION 'Unbekannte Quelle: %', p_quelle;
  END IF;
END;
$$;

COMMENT ON FUNCTION setze_kontobewegung_abgeglichen IS
  'Setzt/entfernt das Abgeglichen-Häkchen einer Kontobewegung (Zahlung, E&A-Buchung oder eine Seite einer Umbuchung) unabhängig von is_locked. Rollenprüfung erfolgt serverseitig in der aufrufenden Action.';
