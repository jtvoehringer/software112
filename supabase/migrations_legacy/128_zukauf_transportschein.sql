-- Migration 128: Transportschein-Felder auf zukauf_posten
-- Gemäß §24 Weingesetz – Transportbescheinigung

ALTER TABLE zukauf_posten
  ADD COLUMN IF NOT EXISTS lieferung_uhrzeit      time,
  ADD COLUMN IF NOT EXISTS transport_zugmaschine  text,
  ADD COLUMN IF NOT EXISTS transport_anhaenger1   text,
  ADD COLUMN IF NOT EXISTS transport_anhaenger2   text,
  ADD COLUMN IF NOT EXISTS herkunft               text,
  ADD COLUMN IF NOT EXISTS anreicherung           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS alkohol_pct            numeric(5,2),
  ADD COLUMN IF NOT EXISTS kmw                    numeric(5,1),
  ADD COLUMN IF NOT EXISTS qualitaetsstufe        text,
  ADD COLUMN IF NOT EXISTS staatliche_pruefnummer text;

COMMENT ON COLUMN zukauf_posten.lieferung_uhrzeit      IS 'Uhrzeit der Lieferung (Transportbescheinigung)';
COMMENT ON COLUMN zukauf_posten.transport_zugmaschine  IS 'Kennzeichen Zugmaschine';
COMMENT ON COLUMN zukauf_posten.transport_anhaenger1   IS 'Kennzeichen 1. Anhänger';
COMMENT ON COLUMN zukauf_posten.transport_anhaenger2   IS 'Kennzeichen 2. Anhänger';
COMMENT ON COLUMN zukauf_posten.herkunft               IS 'Herkunft des Weins/der Trauben';
COMMENT ON COLUMN zukauf_posten.anreicherung           IS 'Anreicherung J/N';
COMMENT ON COLUMN zukauf_posten.alkohol_pct            IS 'Vorhandener Alkoholgehalt (%vol), bei Wein';
COMMENT ON COLUMN zukauf_posten.kmw                    IS '°KMW bei Trauben und Traubenmost';
COMMENT ON COLUMN zukauf_posten.qualitaetsstufe        IS 'Qualitätsstufe (Qualitätswein, Kabinett, etc.)';
COMMENT ON COLUMN zukauf_posten.staatliche_pruefnummer IS 'Staatl. Prüfnummer';
