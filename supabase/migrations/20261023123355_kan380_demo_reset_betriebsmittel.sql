-- KAN-380 (23.10.2026): Der nächtliche Demo-Reset des Musterhofs scheiterte seit 12.10.2026 jede Nacht (HTTP 409):
-- „update or delete on table "betriebsmittel" violates foreign key constraint "behandlungen_betriebsmittel_fkey"“.
-- demo_musterhof_zuruecksetzen() löscht die Betriebsmittel früh (KAN-223), die Maßnahmen (behandlungen) erst später;
-- seit KAN-325/326 (11.10.2026) kann eine Maßnahme auf ein Betriebsmittel verweisen (FK ohne ON DELETE). Der Reset ist
-- atomar – ein Verweis aus dem UAT genügte, und nichts wurde mehr zurückgesetzt.
-- Korrektur: vor dem Löschen der Betriebsmittel den Verweis der Maßnahmen leeren (die Maßnahmen selbst löscht der Reset
-- wie bisher weiter unten). Nur diese eine Stelle der Funktion wird ersetzt – Prüfung auf genau einen Treffer.

DO $m$
DECLARE
  c_alt constant text := '  delete from betriebsmittel where tenant_id = c_t;';
  c_neu constant text := '  -- KAN-380: Maßnahmen können seit KAN-325/326 auf Betriebsmittel verweisen – Verweis vor dem Löschen leeren' || E'\n'
                      || '  update behandlungen set betriebsmittel_id = null where tenant_id = c_t and betriebsmittel_id is not null;' || E'\n'
                      || '  delete from betriebsmittel where tenant_id = c_t;';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
  v_treffer int;
BEGIN
  v_treffer := (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt);
  IF v_treffer <> 1 THEN
    RAISE EXCEPTION 'KAN-380: erwartet genau eine Stelle „delete from betriebsmittel“ in demo_musterhof_zuruecksetzen, gefunden %', v_treffer;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$m$;

-- Selbstprüfung
DO $$
BEGIN
  IF position('update behandlungen set betriebsmittel_id = null' in pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-380: Korrektur fehlt in demo_musterhof_zuruecksetzen';
  END IF;
END
$$;
