-- KAN-223 Nachtrag (07.10.2026): Betriebsmittel-Einkäufe im Demo-Aufbau nur bei E&A-Rechnung.
--
-- Befund (Rollback-Probe Produktion nach 20261007081913_kan223_demo_musterhof_kellerbuch): Der Produktions-Musterhof
-- führt buchhaltungsart = 'doppik' (Staging: 'ea'); s112_betriebsmittel_einkauf lehnt dann mit 42501 ab („Einkäufe mit
-- Ausgabe gibt es nur mit aktiver E&A-Rechnung“) und demo_musterhof_y2_kette() bräche ab. Die Einstellung bleibt;
-- ohne E&A bleibt es beim Anfangsbestand (beide Betriebsmittel-Tabellen sind trotzdem befüllt).
DO $$
DECLARE
  c_alt constant text := '  if public.s112_ea_zeitraum_sperrgrund(c_t, v_ea) is null then';
  c_neu constant text := E'  -- Einkauf mit E/A-Ausgabe nur bei E&A-Rechnung (Doppik: nur Anfangsbestand)\n'
    || E'  if public.s112_ea_zeitraum_sperrgrund(c_t, v_ea) is null\n'
    || '     and exists (select 1 from tenant_einstellungen te where te.tenant_id = c_t and te.modul_ea and te.buchhaltungsart = ''ea'') then';
  v_def text := pg_get_functiondef('public.demo_musterhof_kellerbuch()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-223: Stelle in demo_musterhof_kellerbuch nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END $$;

REVOKE EXECUTE ON FUNCTION public.demo_musterhof_kellerbuch() FROM PUBLIC, anon, authenticated;
