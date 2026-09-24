CREATE TABLE IF NOT EXISTS wetter_stunden (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lat           numeric(6,3) NOT NULL,
  lon           numeric(6,3) NOT NULL,
  quelle        text NOT NULL CHECK (quelle IN ('inca', 'nwp')),
  zeit          timestamptz NOT NULL,
  rr            numeric(6,2),
  t2m           numeric(5,2),
  rh2m          numeric(5,1),
  wind_ms       numeric(5,2),
  boe_ms        numeric(5,2),
  abgerufen_am  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, lat, lon, quelle, zeit)
);
COMMENT ON TABLE wetter_stunden IS 'Wetter-Cache je Betrieb und Rasterpunkt: INCA-Analyse (Rückblick) und NWP-Prognose vom GeoSphere Austria Data Hub (CC BY 4.0).';
CREATE INDEX IF NOT EXISTS wetter_stunden_zeit_idx ON wetter_stunden (tenant_id, quelle, zeit DESC);
ALTER TABLE wetter_stunden ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wetter_select ON wetter_stunden;
CREATE POLICY wetter_select ON wetter_stunden FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));

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

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS morgenbericht_aktiv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wetter_aktiv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wetter_abwasch_mm smallint NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS wetter_intervall_tage smallint NOT NULL DEFAULT 14;
COMMENT ON COLUMN tenant_einstellungen.wetter_abwasch_mm IS 'Regelmaschine Wetter: Niederschlag (mm) seit der letzten Pflanzenschutz-Behandlung, ab dem der Spritzbelag als abgewaschen gilt (Faustregel 20-30 mm).';;
