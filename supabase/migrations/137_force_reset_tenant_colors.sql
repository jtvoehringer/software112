-- Migration 137: primary_color/secondary_color unconditional zuruecksetzen
--
-- Migration 136 hat primary_color/secondary_color nur dort auf NULL gesetzt, wo sie exakt
-- den vermuteten alten Werten (#025450/#F9E54F) entsprachen. Das war offenbar falsch geraten
-- (Jörgen meldet: "teal/gelb ist noch immer default") - die tatsaechlich gespeicherten Werte
-- weichen offenbar von der Vermutung ab, daher hat die WHERE-Bedingung nichts getroffen.
--
-- Da laut project_design_relaunch.md aktuell nur EIN Mandant existiert (Hohenstein/Sandbox),
-- ist ein bedingungsloser Reset hier sicher: setzt primary_color/secondary_color fuer ALLE
-- Zeilen auf NULL, egal welcher Wert aktuell drinsteht. NULL laesst den Code-Default aus
-- (dashboard)/layout.tsx greifen (aktuell #4F86D6/#FFFFFF). logo_url wird NICHT angefasst
-- (nicht gemeldet als Problem, koennte ein echtes Mandanten-Logo sein).

-- Vorher-Stand (zur Kontrolle/Diagnose - bitte Ergebnis anschauen):
select tenant_id, anzeigename, logo_url, primary_color, secondary_color
from tenant_einstellungen;

update tenant_einstellungen
set primary_color = null,
    secondary_color = null;

-- Nachher-Stand (sollte jetzt ueberall NULL bei primary_color/secondary_color zeigen):
select tenant_id, anzeigename, logo_url, primary_color, secondary_color
from tenant_einstellungen;
