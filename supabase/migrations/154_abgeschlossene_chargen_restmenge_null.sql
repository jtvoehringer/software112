-- 154_abgeschlossene_chargen_restmenge_null.sql
--
-- Einmalige Datenkorrektur (Klärung 7.8.2026, Kellerbuch/Weinausbau):
-- Durch einen Programmfehler in bereinigCharge() (weinhandel/zukauf/actions.ts)
-- konnten Weinausbau-Chargen auf Status "Abgeschlossen" gesetzt werden, ohne dass
-- ihre Restmenge (menge_liter) auf 0 zurückgesetzt wurde. Betroffen waren Chargen,
-- deren zugrundeliegender Zukauf gelöscht oder bearbeitet wurde, NACHDEM die Charge
-- bereits per Tankverkauf oder Verschneidung teilweise reduziert worden war (diese
-- beiden Bewegungsarten wurden von der bisherigen Prüfung übersehen).
--
-- Business-Regel im gesamten System (siehe alle anderen Stellen, die den Status auf
-- 'abgeschlossen' setzen): eine abgeschlossene Charge hat IMMER menge_liter = 0.
-- Diese Migration stellt das für die bereits betroffenen Bestandsdaten her.
--
-- Der zugehörige Programmfehler wurde separat behoben (bereinigCharge() prüft jetzt
-- vollständig auf alle Bewegungsarten und lässt Chargen mit echten Bewegungen
-- unangetastet, statt sie blind zu schließen).
--
-- VOR dem Ausführen: bitte kurz prüfen, ob die betroffenen Chargen (siehe SELECT
-- unten) tatsächlich korrekt sind (kein Wein mehr im Behälter vorhanden). Der SELECT
-- kann separat ausgeführt werden, um die betroffenen Zeilen vorab zu sehen.

-- Betroffene Zeilen anzeigen (vor der Korrektur zur Kontrolle):
select id, name, jahrgang, rebsorte, status, menge_liter, aktiv, behaelter_id
from public.weinausbau
where status = 'abgeschlossen' and menge_liter > 0;

-- Korrektur:
update public.weinausbau
set menge_liter = 0
where status = 'abgeschlossen' and menge_liter > 0;
