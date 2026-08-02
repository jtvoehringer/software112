-- Migration 136: Alte Marken-Werte (Teal/Gelb #025450/#F9E54F, Sandbox-Demo-Logo) aus
-- tenant_einstellungen entfernen, damit der neue Code-Standard wieder greift.
--
-- Hintergrund: Phase A des Design-Relaunch (2026-08-01) hat nur den CODE-Default auf die neue
-- Palette umgestellt (DEFAULT_BRANDING in src/app/(dashboard)/layout.tsx, #4F86D6/#FFFFFF).
-- Der laufende Mandant (Hohenstein/Sandbox) hat aber vermutlich noch die ALTEN Werte explizit
-- in tenant_einstellungen.primary_color/secondary_color gespeichert — diese überschreiben den
-- Code-Default (siehe (dashboard)/layout.tsx, "d.primary_color ?? DEFAULT_BRANDING...").
-- Das erklärt, warum im Dashboard noch der alte grün/gelbe Standard sichtbar ist.
--
-- Diese Migration setzt primary_color/secondary_color NUR dort auf NULL zurück, wo sie noch
-- exakt den alten, bekannten Werten entsprechen (gezielt, überschreibt keine bewusst anders
-- gesetzten individuellen Mandanten-Farben). NULL lässt den Code-Default greifen — bei
-- künftigen Palette-Anpassungen im Code muss diese Tabelle dann nicht erneut angefasst werden.
--
-- logo_url wird nur zurückgesetzt, wenn er noch auf das alte Sandbox-Demo-Logo
-- (/logo-sandbox.svg) zeigt — ein reines Platzhalter-Icon aus der Frühphase, kein echtes
-- Mandanten-Logo. Ein evtl. gesetztes echtes Logo (z.B. /logos/hohenstein-logo.png) bleibt
-- unangetastet.

-- Vorher-Stand zur Kontrolle (Ergebnis erscheint im Supabase SQL-Editor):
select tenant_id, anzeigename, logo_url, primary_color, secondary_color
from tenant_einstellungen;

update tenant_einstellungen
set primary_color = null
where primary_color = '#025450';

update tenant_einstellungen
set secondary_color = null
where secondary_color = '#F9E54F';

update tenant_einstellungen
set logo_url = null
where logo_url = '/logo-sandbox.svg';

-- Nachher-Stand zur Kontrolle:
select tenant_id, anzeigename, logo_url, primary_color, secondary_color
from tenant_einstellungen;
