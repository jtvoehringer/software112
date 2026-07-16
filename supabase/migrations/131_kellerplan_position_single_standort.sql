-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 131: Gebinde nur einem Standort (Kellerplan) zuordenbar
-- Bisher erlaubte unique(kellerplan_id, behaelter_id) die gleichzeitige
-- Platzierung eines Behälters auf mehreren Kellerplänen (Mehrfachzuordnung).
-- Neu: unique(behaelter_id) – ein Behälter steht nur einem Standort zur Verfügung.
-- ─────────────────────────────────────────────────────────────────────────────

-- Bestehende Mehrfachzuordnungen bereinigen: pro Behälter nur die zuletzt
-- aktualisierte Position behalten, ältere Duplikate entfernen.
delete from kellerplan_positionen kp
using kellerplan_positionen kp2
where kp.behaelter_id = kp2.behaelter_id
  and (kp.aktualisiert_am, kp.id) < (kp2.aktualisiert_am, kp2.id);

alter table kellerplan_positionen
  drop constraint if exists kellerplan_positionen_kellerplan_behaelter_unique;

alter table kellerplan_positionen
  add constraint kellerplan_positionen_behaelter_unique unique (behaelter_id);
