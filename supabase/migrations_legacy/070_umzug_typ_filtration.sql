-- Migration 070: umzug_typ – unterscheidet normalen Umzug von Filtration
-- Filtration = Sonderumzug (Quelle → Filter → Ziel, Schwund, N:N)
-- → wird im Bewegungsbuch als eigene Art angezeigt

ALTER TABLE keller_umzuege
  ADD COLUMN IF NOT EXISTS umzug_typ TEXT DEFAULT 'normal';

-- Bestehende Zeilen als 'normal' kennzeichnen
UPDATE keller_umzuege SET umzug_typ = 'normal' WHERE umzug_typ IS NULL;

-- Filtration gehört ins Bewegungsbuch, nicht in die Kellerbehandlungen
-- (nur für Sandbox-Tenant; in Produktion greift tenant-spezifische Seeding-Logik)
DELETE FROM keller_behandlungstypen WHERE name = 'Filtration';
