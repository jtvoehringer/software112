-- KAN-332 Nachtrag (Abnahme 13.10.2026): Umbenennen einer Charge fehlte im Journal.
--
-- Ursache: z_protokoll_aendern überwacht je Tabelle nur die bestandsrelevanten Spalten (KAN-35, Trigger-Argumente =
-- UPDATE OF …). Name, Bezeichnung, Beschreibung und Notizen gehörten nicht dazu.
-- Entscheidung Jörgen 13.10.2026: „Namen + Notizen“ – jede sichtbare Bearbeitung erscheint im Journal (und damit auch im
-- Änderungsprotokoll).
--
-- Umsetzung: Für jede Tabelle mit z_protokoll_aendern kommen die vorhandenen Spalten name, bezeichnung, beschreibung und
-- notizen zu den überwachten Spalten dazu (Trigger neu mit UPDATE OF = Argumente, wie bisher). Funktion unverändert.

DO $do$
DECLARE
  r      record;
  v_neu  text[];
BEGIN
  FOR r IN
    SELECT c.relname::text AS tab,
           (SELECT array_agg(convert_from(decode(u.a, 'escape'), 'UTF8') ORDER BY u.n)
              FROM unnest(string_to_array(encode(t.tgargs, 'escape'), '\000')) WITH ORDINALITY u (a, n)
             WHERE u.a <> '') AS args
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = 'z_protokoll_aendern' AND c.relnamespace = 'public'::regnamespace
     ORDER BY 1
  LOOP
    SELECT r.args || coalesce(array_agg(a.attname::text ORDER BY a.attname), '{}')
      INTO v_neu
      FROM pg_attribute a
     WHERE a.attrelid = format('public.%I', r.tab)::regclass
       AND a.attname IN ('name', 'bezeichnung', 'beschreibung', 'notizen')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT (a.attname::text = ANY (r.args));
    IF cardinality(v_neu) > cardinality(r.args) THEN
      EXECUTE format('DROP TRIGGER z_protokoll_aendern ON public.%I', r.tab);
      EXECUTE format('CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben(%s)',
                     (SELECT string_agg(quote_ident(x), ', ') FROM unnest(v_neu) x), r.tab,
                     (SELECT string_agg(quote_literal(x), ', ') FROM unnest(v_neu) x));
    END IF;
  END LOOP;
END
$do$;
