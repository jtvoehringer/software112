-- Migration 156: Aktivitäts-Art "Aufgabe" im CHECK-Constraint ergänzen
--
-- Bug (7.8.2026): Speichern einer Ganztags-Aktivität mit Art = "Aufgabe" schlägt fehl
-- ("An error occurred in the Server Components render..." - die generische, in Produktion
-- zensierte Next.js-Fehlermeldung). Ursache: "Aufgabe" wurde als Auswahlmöglichkeit im
-- Frontend ergänzt (AKTIVITAET_ARTEN in src/lib/crm/types.ts, samt Erledigt-Haken-Funktion),
-- aber der CHECK-Constraint auf aktivitaeten.art wurde dabei nicht mit erweitert - der
-- INSERT scheitert daher an "aktivitaeten_art_check" (Postgres-Fehler, im Server-Log über
-- console.error('[createAktivitaet] DB-Fehler: ...') sichtbar, dem User aber nur als
-- generische Fehlermeldung angezeigt).
--
-- Fix hier: 'aufgabe' zur erlaubten Werteliste hinzufügen. Nutzt denselben robusten Ansatz
-- wie Migration 135 (Constraint über pg_attribute/conkey anhand der eingeschränkten SPALTE
-- suchen statt über den Constraint-Text zu parsen - Migration 134 ist daran gescheitert,
-- weil Postgres "IN (...)" intern zu "= ANY (ARRAY[...])" umschreibt).

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel      ON rel.oid = con.conrelid
  JOIN pg_attribute att  ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'aktivitaeten'
    AND con.contype = 'c'
    AND att.attname = 'art'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE aktivitaeten DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE aktivitaeten ADD CONSTRAINT aktivitaeten_art_check
  CHECK (art IN (
    'notiz','anruf','email','verkostung','messe','besuch','angebot','sonstiges',
    'urlaub','abwesenheit','verkauf','besprechung','aufgabe'
  ));
