-- Migration 168: Eingeschränkt abzugsfähige Betriebsausgaben (Bewirtung/Repräsentation)
--
-- Hintergrund: Bewirtungsspesen ("Essenseinladungen") sind in Österreich gem.
-- § 20 Abs 1 Z 3 EStG idR nur zu 50% steuerlich abzugsfähig - das konnte das
-- E&A-Modul bisher nicht abbilden (jede Ausgabe zählte voll). Dies bildet
-- KEINE vollständige steuerliche Gewinnermittlung ab (AfA, GWG, Privatanteile
-- etc. bleiben außen vor) - es macht nur den nicht abzugsfähigen Anteil
-- sichtbar, damit er mit dem Steuerberater abgestimmt werden kann.

-- ── 1. ea_kategorien.abzugsfaehig_pct ────────────────────────────────────────
-- Konfigurierbar pro Kategorie, Default 100 (= voll abzugsfähig, unverändertes
-- Verhalten für alle bestehenden Kategorien).
ALTER TABLE ea_kategorien ADD COLUMN IF NOT EXISTS abzugsfaehig_pct numeric(5,2) NOT NULL DEFAULT 100
  CHECK (abzugsfaehig_pct >= 0 AND abzugsfaehig_pct <= 100);

COMMENT ON COLUMN ea_kategorien.abzugsfaehig_pct IS 'Steuerlich abzugsfaehiger Anteil in %, Default 100. Bei gesetzlicher Abzugsbeschraenkung (z.B. Bewirtung/Repraesentation gem. Paragraph 20 Abs 1 Z 3 EStG) entsprechend niedriger setzen.';

-- ── 2. ea_transaktionen.abzugsfaehig_pct + betrag_abzugsfaehig ──────────────
-- Bei Buchung wird der Wert von der gewählten Kategorie ÜBERNOMMEN (Snapshot) -
-- spätere Änderungen an der Kategorie wirken sich NICHT rückwirkend auf
-- bereits gebuchte Belege aus (gleiches Prinzip wie bei anderen Snapshot-
-- Feldern in diesem Modul).
ALTER TABLE ea_transaktionen ADD COLUMN IF NOT EXISTS abzugsfaehig_pct numeric(5,2) NOT NULL DEFAULT 100
  CHECK (abzugsfaehig_pct >= 0 AND abzugsfaehig_pct <= 100);

COMMENT ON COLUMN ea_transaktionen.abzugsfaehig_pct IS 'Bei Buchung von der gewaehlten Kategorie uebernommener Snapshot-Wert.';

ALTER TABLE ea_transaktionen ADD COLUMN IF NOT EXISTS betrag_abzugsfaehig numeric(12,2)
  GENERATED ALWAYS AS (ROUND(betrag_netto * abzugsfaehig_pct / 100, 2)) STORED;

COMMENT ON COLUMN ea_transaktionen.betrag_abzugsfaehig IS 'Steuerlich abzugsfaehiger Anteil des Netto-Betrags (vereinfachte Berechnung auf Netto-Basis). Bei abzugsfaehig_pct=100 identisch mit betrag_netto. Ersetzt keine vollstaendige steuerliche Gewinnermittlung - bitte mit Steuerberater abstimmen.';

-- ── 3. Neue Systemkategorie: Bewirtung / Repräsentation ─────────────────────
-- Konto-Nr. 7650 als üblicher EKR-Vorschlag (Repräsentationsaufwendungen) -
-- wie bei den anderen Systemkategorien ein Vorschlag, keine verbindliche
-- Steuerberatung. USt-Satz 10% als Default (Gastronomie/Speisen), pro Buchung
-- änderbar. WHERE NOT EXISTS statt ON CONFLICT, weil UNIQUE(tenant_id, name)
-- bei tenant_id IS NULL laut Postgres-Semantik keine Duplikate verhindert.
INSERT INTO ea_kategorien (tenant_id, typ, name, konto_nr, ust_satz_std, abzugsfaehig_pct, sortierung)
SELECT NULL, 'ausgabe', 'Bewirtung / Repräsentation (Geschäftsessen)', 7650, 10, 50, 145
WHERE NOT EXISTS (
  SELECT 1 FROM ea_kategorien WHERE tenant_id IS NULL AND name = 'Bewirtung / Repräsentation (Geschäftsessen)'
);
