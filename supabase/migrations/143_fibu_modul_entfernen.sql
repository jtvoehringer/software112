-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 143 – FIBU-Modul vollständig entfernen
-- Punkt 6 der Punkteliste vom 04.08.2026: "Wir entfernen das FIBU Modul zur
-- Gänze!" – auf Wunsch inkl. Datenbank-Tabellen (nicht nur UI).
-- Das E&A-Modul (Einnahmen-Ausgaben-Rechnung) bleibt vollständig erhalten und
-- ist von dieser Migration nicht betroffen.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) FIBU-Tabellen löschen (Kind-Tabellen zuerst) ──────────────────────────
DROP TABLE IF EXISTS fibu_buchungszeilen  CASCADE;
DROP TABLE IF EXISTS fibu_buchungssaetze  CASCADE;
DROP TABLE IF EXISTS fibu_perioden        CASCADE;
DROP TABLE IF EXISTS fibu_kontenplan      CASCADE;

-- ── 2) FIBU-Funktionen/Trigger löschen ────────────────────────────────────────
-- (Der Trigger trg_fibu_balance_check wird bereits durch das obige DROP TABLE
--  fibu_buchungszeilen automatisch mitentfernt; die Funktion selbst bleibt
--  ohne DROP TABLE bestehen und muss explizit entfernt werden.)
DROP FUNCTION IF EXISTS check_fibu_buchungssatz_balance() CASCADE;
DROP FUNCTION IF EXISTS get_next_belegnummer(uuid, smallint) CASCADE;

-- ── 3) FIBU-Enum-Typ löschen ──────────────────────────────────────────────────
DROP TYPE IF EXISTS fibu_kontotyp;

-- ── 4) tenant_einstellungen: FIBU-Spalten + Constraints entfernen ────────────
-- Postgres löscht chk_ea_fibu_exklusiv und chk_sumup_bedingt_buchhaltung beim
-- Drop von modul_fibu automatisch mit (CASCADE), da beide Constraints diese
-- Spalte referenzieren. chk_sumup_bedingt_buchhaltung muss danach ohne die
-- FIBU-Klausel neu angelegt werden, damit die SumUp/E&A-Abhängigkeit bestehen
-- bleibt.
ALTER TABLE tenant_einstellungen
  DROP COLUMN IF EXISTS modul_fibu CASCADE,
  DROP COLUMN IF EXISTS fibu_kontenrahmen,
  DROP COLUMN IF EXISTS fibu_geschaeftsjahr_start;

ALTER TABLE tenant_einstellungen
  ADD CONSTRAINT chk_sumup_bedingt_buchhaltung
    CHECK (NOT (modul_sumup = true AND modul_ea = false));

COMMENT ON COLUMN tenant_einstellungen.modul_ea IS 'Einnahmen-Ausgaben-Rechner aktiv (FIBU-Modul wurde entfernt, Migration 143)';
