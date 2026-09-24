-- Migration 157: Neues Feld "Reinkupfer (kg/ha)" auf Behandlungen
--
-- Anforderung (9.8.2026, Rieden/Maßnahmen-Formular, Punkt 4): Für Spritzungen soll neben dem
-- bereits vorhandenen Cu-Beitrag (Gesamt, in g - live berechnet in der Kupferbilanz aus
-- pflanzenschutzmittel.cu_gehalt_pct) zusätzlich der Reinkupfer-Eintrag je Hektar sichtbar
-- und gespeichert werden (Reinkupfer(kg/ha) = Gesamtmenge(kg) x Cu-Gehalt(%) / 100 / Fläche(ha)).
--
-- Hinweis: behandlungen.cu_gehalt_pct existiert NICHT (nur pflanzenschutzmittel.cu_gehalt_pct,
-- siehe Migration 015) - es gibt also keine bereits vorhandene, ungenutzte Spalte, die dafür
-- wiederverwendet werden könnte. Reinkupfer wird hier als neue eigene Spalte angelegt und vom
-- Formular (NeueBehandlungForm.tsx) live berechnet mitgeliefert, damit spätere Auswertungen
-- (z.B. Kupferbilanz-Berichte) direkt darauf zugreifen können, ohne die Berechnung erneut
-- durchführen zu müssen.

alter table behandlungen
  add column if not exists reinkupfer_kg_ha numeric(8,4);

comment on column behandlungen.reinkupfer_kg_ha is
  'Reinkupfer-Eintrag je Hektar in kg (berechnet aus Gesamtmenge x Cu-Gehalt(%) des PSM / Fläche). Nur bei Spritzungen mit kupferhaltigem Mittel gefüllt.';
