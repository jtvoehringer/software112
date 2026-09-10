-- Morgenbericht und Wetteranbindung (Jour-fixe-Beschluss 9.9.2026, Umsetzung
-- 10.9.2026; Konzept siehe Software112_Entwicklungspfad.md).
--
-- wetter_stunden: Stundenwerte je Betrieb und Rasterpunkt (Rieden-Koordinaten,
-- auf 0,02° ≈ 2 km zusammengefasst) aus dem GeoSphere Austria Data Hub -
-- Rückblick INCA (Analyse 1 km, 1 h) und Prognose NWP (AROME 2,5 km, 61 h).
-- Open Data (CC BY 4.0, GeoSphere Austria). Die Anwendung frischt den Cache
-- beim Aufruf auf (Rückblick ≥ 90 min alt, Prognose ≥ 3 h alt) und beim
-- täglichen Cron; Schreiben nur über die Service-Role.
--
-- morgenberichte: ein gespeicherter Bericht je Betrieb und Tag - deterministische
-- Befunde (jsonb), Wetter-Kurzfassung (jsonb) und optionale KI-Zusammenfassung
-- (zählt gegen das KI-Kontingent des Pakets, Migration 194).

CREATE TABLE IF NOT EXISTS wetter_stunden (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lat           numeric(6,3) NOT NULL,
  lon           numeric(6,3) NOT NULL,
  quelle        text NOT NULL CHECK (quelle IN ('inca', 'nwp')),
  zeit          timestamptz NOT NULL,
  rr            numeric(6,2),          -- Niederschlag mm in der Stunde
  t2m           numeric(5,2),          -- Lufttemperatur 2 m, °C
  rh2m          numeric(5,1),          -- relative Feuchte, %
  wind_ms       numeric(5,2),          -- Windgeschwindigkeit 10 m, m/s
  boe_ms        numeric(5,2),          -- Böen (nur Prognose), m/s
  abgerufen_am  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, lat, lon, quelle, zeit)
);
COMMENT ON TABLE wetter_stunden IS 'Wetter-Cache je Betrieb und Rasterpunkt: INCA-Analyse (Rückblick) und NWP-Prognose vom GeoSphere Austria Data Hub (CC BY 4.0).';
CREATE INDEX IF NOT EXISTS wetter_stunden_zeit_idx ON wetter_stunden (tenant_id, quelle, zeit DESC);

ALTER TABLE wetter_stunden ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wetter_select ON wetter_stunden;
CREATE POLICY wetter_select ON wetter_stunden FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
-- kein Schreib-Policy: nur Service-Role (Cron / Server-Refresh)

CREATE TABLE IF NOT EXISTS morgenberichte (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  datum            date NOT NULL,
  erstellt_am      timestamptz NOT NULL DEFAULT now(),
  ausloeser        text NOT NULL DEFAULT 'cron' CHECK (ausloeser IN ('cron', 'manuell')),
  befunde          jsonb NOT NULL DEFAULT '[]'::jsonb,
  wetter           jsonb,
  zusammenfassung  text,
  ki_modell        text,
  anzahl_hoch      smallint NOT NULL DEFAULT 0,
  anzahl_mittel    smallint NOT NULL DEFAULT 0,
  anzahl_info      smallint NOT NULL DEFAULT 0,
  dauer_ms         integer,
  UNIQUE (tenant_id, datum)
);
COMMENT ON TABLE morgenberichte IS 'Täglicher Scan je Betrieb (05:00 UTC): deterministische Befunde + Wetter-Empfehlungen, optional KI-Zusammenfassung. Anzeige im Dashboard (Übersicht) und unter /dashboard/morgenbericht.';
CREATE INDEX IF NOT EXISTS morgenberichte_tenant_datum_idx ON morgenberichte (tenant_id, datum DESC);

ALTER TABLE morgenberichte ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS morgenberichte_select ON morgenberichte;
CREATE POLICY morgenberichte_select ON morgenberichte FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
-- kein Schreib-Policy: nur Service-Role (Cron / Server-Aktion mit Rollenprüfung)

-- Einstellungen je Betrieb: Morgenbericht ein/aus, Wetter ein/aus, Schwellwerte
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS morgenbericht_aktiv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wetter_aktiv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wetter_abwasch_mm smallint NOT NULL DEFAULT 25,     -- Regen seit Behandlung, ab dem der Belag als abgewaschen gilt
  ADD COLUMN IF NOT EXISTS wetter_intervall_tage smallint NOT NULL DEFAULT 14; -- Spritzintervall in der Saison
COMMENT ON COLUMN tenant_einstellungen.wetter_abwasch_mm IS 'Regelmaschine Wetter: Niederschlag (mm) seit der letzten Pflanzenschutz-Behandlung, ab dem der Spritzbelag als abgewaschen gilt (Faustregel 20-30 mm).';
