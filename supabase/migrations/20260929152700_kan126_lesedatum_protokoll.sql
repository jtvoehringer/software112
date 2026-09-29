-- KAN-126 (29.09.2026): Lesedatum je Pressungszeile – Änderungsprotokoll und Spaltenkommentar
--
-- Die App schreibt pressung_weingaerten.ernte_datum ab jetzt (Pressungsformular, Lesetag je Traubenzeile).
-- Änderungen daran landen damit im Änderungsprotokoll (bestandsprotokoll, Muster KAN-35/KAN-128):
-- z_protokoll_aendern bekommt ernte_datum dazu – auf pressung_weingaerten und (offene Frage 8, Vorschlag)
-- auf ernte_parzellen. Die bestehende Spaltenliste wird aus pg_trigger gelesen und nur ergänzt, so bleiben
-- die Ergänzungen von KAN-128 (Mostgewicht) erhalten. Wiederholbar: fehlt nichts, ändert sich nichts.
-- Dazu der Spaltenkommentar, der bisher nur in migrations_legacy/072 stand.
-- Keine Datenänderung. Staging zuerst.

COMMENT ON COLUMN public.pressung_weingaerten.ernte_datum IS
  'Lesedatum dieser Traubenzeile (KAN-126): Lesetag laut Erntemeldung, im Pressungsformular gewählt (änderbar); '
  'bei Zukauf-Zeilen das Zukaufsdatum. Bestimmt das Fensterende der Rückverfolgung (KAN-75) und das Lesedatum im Blend-Protokoll.';

DO $protokoll$
DECLARE
  r_tab     record;
  v_args    text[];
  v_update  text[];
  v_spalten text[];
BEGIN
  FOR r_tab IN SELECT * FROM (VALUES ('pressung_weingaerten'::text), ('ernte_parzellen')) AS t(tabelle) LOOP
    SELECT array_remove(string_to_array(encode(tg.tgargs, 'escape'), '\000'), ''),
           ARRAY(SELECT a.attname::text
                   FROM unnest(tg.tgattr::int2[]) WITH ORDINALITY AS u(attnum, nr)
                   JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = u.attnum
                  ORDER BY u.nr)
      INTO v_args, v_update
      FROM pg_trigger tg
     WHERE tg.tgrelid = format('public.%I', r_tab.tabelle)::regclass
       AND tg.tgname = 'z_protokoll_aendern';

    IF v_args IS NULL OR cardinality(v_args) = 0 THEN
      RAISE EXCEPTION 'KAN-126: z_protokoll_aendern auf % fehlt oder hat keine Spalten', r_tab.tabelle;
    END IF;
    IF v_update IS DISTINCT FROM v_args THEN
      RAISE EXCEPTION 'KAN-126: z_protokoll_aendern auf %: UPDATE OF (%) ≠ Argumente (%)',
        r_tab.tabelle, array_to_string(v_update, ', '), array_to_string(v_args, ', ');
    END IF;
    CONTINUE WHEN 'ernte_datum' = ANY (v_args);

    v_spalten := v_args || ARRAY['ernte_datum'];
    EXECUTE format('DROP TRIGGER z_protokoll_aendern ON public.%I', r_tab.tabelle);
    EXECUTE format('CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF %s ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben(%s)',
                   (SELECT string_agg(format('%I', s), ', ' ORDER BY nr) FROM unnest(v_spalten) WITH ORDINALITY AS n(s, nr)),
                   r_tab.tabelle,
                   (SELECT string_agg(quote_literal(s), ', ' ORDER BY nr) FROM unnest(v_spalten) WITH ORDINALITY AS n(s, nr)));
  END LOOP;
END $protokoll$;

-- Selbstprüfung: ernte_datum überwacht (UPDATE OF = Argumente), Kommentar gesetzt
DO $pruefung$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname,
           array_remove(string_to_array(encode(tg.tgargs, 'escape'), '\000'), '') AS args,
           ARRAY(SELECT a.attname::text FROM unnest(tg.tgattr::int2[]) WITH ORDINALITY AS u(attnum, nr)
                   JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = u.attnum ORDER BY u.nr) AS upd
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('pressung_weingaerten', 'ernte_parzellen')
       AND tg.tgname = 'z_protokoll_aendern'
  LOOP
    IF NOT ('ernte_datum' = ANY (r.args)) OR r.args IS DISTINCT FROM r.upd THEN
      RAISE EXCEPTION 'KAN-126: z_protokoll_aendern auf % unvollständig: %', r.relname, array_to_string(r.args, ', ');
    END IF;
  END LOOP;
  IF col_description('public.pressung_weingaerten'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.pressung_weingaerten'::regclass AND attname = 'ernte_datum')) IS NULL THEN
    RAISE EXCEPTION 'KAN-126: Spaltenkommentar fehlt';
  END IF;
END $pruefung$;
