-- KAN-22 (06.10.2026): KI-Zähler nicht mehr von jedem Mitglied manipulierbar (Vorschlag zugestimmt, Kommentar KAN-22).
-- check_und_increment_ki_abfrage und increment_ki_tokens prüfen nur die Mitgliedschaft (ohne Rollenliste) – jedes
-- Mitglied, auch ein Leser, konnte per /rest/v1/rpc das Monatskontingent aufbrauchen bzw. die Token-Summen verfälschen.
-- Ab jetzt nur noch Service-Role: /api/ki-abfrage ruft beide nach ihren eigenen Prüfungen (Mitgliedschaft,
-- Nur-Lesen-Modus, Auswertungsrecht) mit dem Admin-Client auf, der Morgenbericht tut das schon. Leser mit
-- Auswertungsrecht fragen wie bisher über die Route ab. Die Abo-Sperre greift in check_und_increment_ki_abfrage auch
-- im Service-Kontext (ist_service_kontext() AND s112_abo_gesperrt). Funktionsrümpfe unverändert.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

REVOKE EXECUTE ON FUNCTION public.check_und_increment_ki_abfrage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_und_increment_ki_abfrage(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_ki_tokens(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ki_tokens(uuid, integer, integer) TO service_role;
