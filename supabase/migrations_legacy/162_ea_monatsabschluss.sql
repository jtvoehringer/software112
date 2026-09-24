-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 162: Monatsabschluss für E&A-Rechnung
--
-- Analog zur UVA-Sperre (Migration 146): "Monat abschließen" sperrt alle
-- ea_transaktionen-Buchungen dieses Monats (is_locked = true) und merkt sich
-- in ea_monatsabschluss, dass/wann/von wem dieser Monat geschlossen wurde.
-- Zusätzlich wird das Neuanlegen von Buchungen in bereits abgeschlossenen
-- Monaten bzw. bereits per UVA übermittelten Zeiträumen serverseitig
-- verhindert (siehe pruefe_ea_zeitraum_offen weiter unten) – sonst könnte
-- man einen geschlossenen Monat durch eine neue, ungesperrte Buchung wieder
-- unterlaufen.
--
-- Kein "Wiedereröffnen" über die UI (bewusst, analog zur UVA-Sperre –
-- irreversibel über die App, bei Bedarf nur direkt in der Datenbank).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Tabelle: welche Monate sind abgeschlossen ─────────────────────────────
CREATE TABLE ea_monatsabschluss (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jahr              smallint      NOT NULL,
  monat             smallint      NOT NULL CHECK (monat BETWEEN 1 AND 12),
  abgeschlossen_am  timestamptz   NOT NULL DEFAULT now(),
  abgeschlossen_von uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, jahr, monat)
);

COMMENT ON TABLE ea_monatsabschluss IS 'Merkt abgeschlossene E&A-Monate; das eigentliche Sperren der Buchungen läuft über ea_transaktionen.is_locked';

CREATE INDEX idx_ea_monatsabschluss_tenant ON ea_monatsabschluss(tenant_id);

ALTER TABLE ea_monatsabschluss ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ea_monatsabschluss_select" ON ea_monatsabschluss
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

-- Nur Admin-Rollen dürfen einen Monat abschließen (strenger als normale
-- Buchungserfassung, da ein Monatsabschluss den ganzen Zeitraum sperrt).
CREATE POLICY "ea_monatsabschluss_write" ON ea_monatsabschluss
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );

-- ── 2) Funktion: Monat abschließen ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sperre_ea_monat(
  p_tenant_id uuid,
  p_jahr      smallint,
  p_monat     smallint
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_von date;
  v_bis date;
BEGIN
  v_von := make_date(p_jahr, p_monat, 1);
  v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;

  UPDATE ea_transaktionen
  SET is_locked = true
  WHERE tenant_id = p_tenant_id
    AND datum BETWEEN v_von AND v_bis;

  INSERT INTO ea_monatsabschluss (tenant_id, jahr, monat)
  VALUES (p_tenant_id, p_jahr, p_monat)
  ON CONFLICT (tenant_id, jahr, monat) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION sperre_ea_monat IS
  'Schließt einen E&A-Monat ab: sperrt alle Buchungen des Monats (is_locked=true) und trägt den Abschluss in ea_monatsabschluss ein. Serverseitig mit vorheriger Admin-Rollenprüfung aufgerufen (SECURITY DEFINER, keine eigene Rollenprüfung).';

-- ── 3) Funktion: ist ein Datum noch "offen" für neue/geänderte Buchungen? ────
-- Prüft sowohl Monatsabschluss als auch bereits übermittelte UVA-Zeiträume
-- (Quartal oder Monat, je nach tenant_einstellungen.ea_uva_zeitraum) – ein
-- Datum ist nur dann offen, wenn keiner von beiden zutrifft.
CREATE OR REPLACE FUNCTION pruefe_ea_zeitraum_offen(
  p_tenant_id uuid,
  p_datum     date
)
RETURNS TABLE (offen boolean, grund text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jahr    smallint := EXTRACT(YEAR  FROM p_datum)::smallint;
  v_monat   smallint := EXTRACT(MONTH FROM p_datum)::smallint;
  v_quartal text     := 'Q' || CEIL(v_monat / 3.0)::int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM ea_monatsabschluss
    WHERE tenant_id = p_tenant_id AND jahr = v_jahr AND monat = v_monat
  ) THEN
    RETURN QUERY SELECT false, format('Monat %s/%s ist bereits abgeschlossen.', v_monat, v_jahr);
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM ea_uva
    WHERE tenant_id = p_tenant_id AND jahr = v_jahr AND gesperrt = true
      AND zeitraum IN (v_quartal, lpad(v_monat::text, 2, '0'))
  ) THEN
    RETURN QUERY SELECT false, 'Zeitraum wurde bereits per UVA übermittelt.';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

COMMENT ON FUNCTION pruefe_ea_zeitraum_offen IS
  'Prüft für ein Buchungsdatum, ob der Zeitraum noch offen ist (weder Monatsabschluss noch übermittelte UVA). Wird beim Anlegen neuer ea_transaktionen serverseitig genutzt, damit ein geschlossener Zeitraum nicht durch eine neue, ungesperrte Buchung unterlaufen werden kann.';
