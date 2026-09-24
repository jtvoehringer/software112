-- Rückmeldung 24.8.2026: zusätzliches, optionales Feld "Interne Bezeichnung"
-- auf dem Ried-Formular (weingarten-Datensatz) - für einen zweiten,
-- betriebsinternen Namen einer Ried (z.B. "Innerbüchl"), der zusätzlich zum
-- offiziellen Riednamen in der Rieden-Übersicht angezeigt wird.

ALTER TABLE weingarten ADD COLUMN IF NOT EXISTS interne_bezeichnung TEXT;
