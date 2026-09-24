-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 181: Koordinaten / Geometrie je Ried (Stufe 1 "Rieden-Koordinaten")
--
-- Anforderung 27.8.2026: Lage der Rieden direkt bei den Einträgen anzeigen –
-- auf Riedenebene, nicht pro Grundstück. Stufe 1 = Mittelpunkt (Pin) manuell
-- erfassen (Karte, Eingabe, Smartphone-Standort), Anzeige in Ried-Detail,
-- Rieden-Übersicht und Dashboard, Google-Maps-Link, GPX/KML/GeoJSON-Export.
-- Die Geometrie-Spalte (GeoJSON, WGS84) ist für Stufe 2 (eAMA-GIS-Import,
-- Feldstück-Polygone über die AMA-Feldstücknummer) und Stufe 3 (Kataster)
-- bereits vorgesehen. Riedenebene: eine Ried kann aus mehreren weingarten-
-- Zeilen bestehen (gleiche lage_id/ried) – die Anwendung schreibt den Pin auf
-- alle Zeilen derselben Ried (siehe speichereRiedGeo in weingarten/actions.ts),
-- analog zu ama_feldnummer/codes. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE weingarten
  ADD COLUMN IF NOT EXISTS zentrum_lat numeric(9,6) CHECK (zentrum_lat BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS zentrum_lon numeric(9,6) CHECK (zentrum_lon BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS geometrie   jsonb,          -- GeoJSON Polygon/MultiPolygon (WGS84), Stufe 2/3
  ADD COLUMN IF NOT EXISTS geo_quelle  text CHECK (geo_quelle IN ('manuell', 'eama', 'kataster')),
  ADD COLUMN IF NOT EXISTS geo_stand   timestamptz;

COMMENT ON COLUMN weingarten.zentrum_lat IS 'Mittelpunkt der Ried (WGS84 Breite) – Pin für Karte, Navigation und Wegpunkt-Export.';
COMMENT ON COLUMN weingarten.zentrum_lon IS 'Mittelpunkt der Ried (WGS84 Länge).';
COMMENT ON COLUMN weingarten.geometrie   IS 'Umriss der Ried als GeoJSON (Polygon/MultiPolygon, WGS84) – ab Stufe 2 (eAMA-Import) befüllt.';
COMMENT ON COLUMN weingarten.geo_quelle  IS 'Herkunft der Koordinaten: manuell | eama | kataster.';

-- Grundstücke: Geometrie für Stufe 2 vorgesehen (Anzeige bleibt auf Riedenebene)
ALTER TABLE grundstuecke
  ADD COLUMN IF NOT EXISTS geometrie jsonb;
COMMENT ON COLUMN grundstuecke.geometrie IS 'Umriss des Grundstücks als GeoJSON (WGS84) – ab Stufe 2 (eAMA/Kataster) befüllt, Anzeige optional.';
