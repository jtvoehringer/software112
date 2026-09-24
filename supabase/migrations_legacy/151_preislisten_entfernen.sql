-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 151: Preislisten-Modul entfernen
--
-- Das eigenstaendige Preislisten-Modul (Migration 024, davor bereits einmal
-- gescheitert in Migration 020 - "waren nie in Benutzung") wurde geprueft:
-- ausser einer optionalen, rein informativen Verknuepfung auf fuellungen
-- (preislisten_positionen.fuellung_id) gibt es KEINE Verknuepfung zu
-- Verkauf, Rechnung, Zukauf oder Kellerbuch - die dort tatsaechlich
-- verwendeten Preise kommen von anderswo. Auf Wunsch des Kunden (7.8.2026)
-- wird das Modul komplett entfernt: Code (Seiten, Actions, Sidebar-Eintrag,
-- Onboarding-Checkliste, Handbuch-Eintrag) in einem separaten Commit, hier
-- nur die Datenbank-Seite.
--
-- DROP TABLE entfernt automatisch auch alle abhaengigen Trigger, Indizes und
-- RLS-Policies dieser beiden Tabellen - keine separaten DROPs noetig.
-- ─────────────────────────────────────────────────────────────────────────────

drop table if exists preislisten_positionen;
drop table if exists preislisten;
