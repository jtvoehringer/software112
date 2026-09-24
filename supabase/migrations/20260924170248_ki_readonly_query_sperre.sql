-- Sofortmaßnahme 24.09.2026: ki_readonly_query führt frei formulierte SELECTs mit den
-- Rechten des Aufrufers aus und sperrt set_config nicht. Ein angemeldeter Benutzer kann
-- darüber die Rolle wechseln (authenticator ist Mitglied von service_role) und RLS
-- umgehen. Bis zur korrigierten Fassung darf niemand außer der Service-Role die
-- Funktion aufrufen – die KI-Abfrage („Frag dein Weingut“) ist so lange offline.
REVOKE EXECUTE ON FUNCTION public.ki_readonly_query(text, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.ki_readonly_query(text, uuid) IS
  'GESPERRT seit 24.09.2026 (Sicherheitslücke: Rollenwechsel per set_config in frei formulierten SELECTs). Nur Service-Role; Freigabe erst mit korrigierter Fassung.';
