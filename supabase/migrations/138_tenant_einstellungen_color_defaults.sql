-- Migration 138: DB-Spalten-Defaults fuer primary_color/secondary_color auf neue Palette
--
-- Ursachen-Kette des "Farben kommen immer wieder zurueck"-Problems (Migration 136/137 haben
-- nur die DATEN in bestehenden Zeilen repariert, nicht die Ursachen):
-- 1. Migration 021 (Ursprungs-Migration der Tabelle) hat die Spalten primary_color/
--    secondary_color mit DB-Level-DEFAULT '#2a7c6f'/'#f5c842' angelegt (altes Sandbox-Gruen/
--    Gold).
-- 2. Mehrere Admin-Seiten (admin/mandanten/page.tsx, admin/mandanten/[id]/page.tsx,
--    admin/mandanten/[id]/actions.ts, admin/mandanten/actions.ts) hatten im TypeScript-Code
--    exakt denselben alten Hex-Wert als Fallback fest einprogrammiert - das fuehrte dazu, dass
--    jedes Speichern im Mandanten-Bearbeiten-Formular (auch ohne die Farbe bewusst zu aendern)
--    die alten Werte wieder in die Datenbank zurueckgeschrieben hat. Diese Codestellen wurden
--    im selben Zug wie diese Migration auf die neue Palette (#4F86D6/#FFFFFF) umgestellt.
--
-- Diese Migration schliesst die letzte Luecke: den DB-Spalten-Default selbst, falls jemals
-- eine Zeile ohne explizite Werte eingefuegt wird (z.B. direkt per SQL).

alter table tenant_einstellungen
  alter column primary_color set default '#4F86D6';

alter table tenant_einstellungen
  alter column secondary_color set default '#FFFFFF';

-- Zur Kontrolle: aktuelle Defaults anzeigen
select column_name, column_default
from information_schema.columns
where table_name = 'tenant_einstellungen'
  and column_name in ('primary_color', 'secondary_color');
