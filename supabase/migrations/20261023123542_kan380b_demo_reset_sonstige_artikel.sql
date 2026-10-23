-- KAN-380 Nachtrag (23.10.2026): Nach der Betriebsmittel-Korrektur (kan380_demo_reset_betriebsmittel) scheiterte der
-- Probelauf des Demo-Resets in Produktion (zurückgerollt) an der nächsten Stelle:
-- „update or delete on table "sonstige_artikel" violates foreign key constraint "sonstige_artikel_bewegungen_artikel_id_fkey"“.
-- Die Lagerbewegungen sonstiger Artikel (KAN-115, Verweis ohne Kaskade) kannte der Reset nicht – sie entstehen, sobald
-- im Musterhof ein sonstiger Artikel verkauft oder gebucht wird (UAT: Traubensaft). Korrektur: die Bewegungen vor den
-- Artikeln löschen. Nur diese eine Stelle der Funktion wird ersetzt – Prüfung auf genau einen Treffer.
-- Probelauf (Produktion, zurückgerollt): Reset + y2-Kette laufen durch (31 Chargen, 28 Verkäufe, Journal ohne Abweichung).

DO $m$
DECLARE
  c_alt constant text := '  delete from sonstige_artikel where tenant_id = c_t;';
  c_neu constant text := '  -- KAN-380: Lagerbewegungen sonstiger Artikel (KAN-115) vor den Artikeln löschen (Verweis ohne Kaskade)' || E'\n'
                      || '  delete from sonstige_artikel_bewegungen where tenant_id = c_t;  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus' || E'\n'
                      || '  delete from sonstige_artikel where tenant_id = c_t;';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
  v_treffer int;
BEGIN
  v_treffer := (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt);
  IF v_treffer <> 1 THEN
    RAISE EXCEPTION 'KAN-380: erwartet genau eine Stelle „delete from sonstige_artikel“ in demo_musterhof_zuruecksetzen, gefunden %', v_treffer;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$m$;

-- Selbstprüfung
DO $$
BEGIN
  IF position('delete from sonstige_artikel_bewegungen where tenant_id = c_t' in pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-380: Nachtrag fehlt in demo_musterhof_zuruecksetzen';
  END IF;
END
$$;
