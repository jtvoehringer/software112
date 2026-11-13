-- KAN-419 G1 (13.11.2026): UVA zählt Gutschriften (Doppik).
--
-- berechne_ea_uva kennt bei Doppik-Betrieben die Rechnung (nach Rechnungsdatum), die stornierte Rechnung mit
-- Stornobeleg und den Stornobeleg (KAN-379). Die Gutschrift (rechnungen.art = 'gutschrift', KAN-419) fehlte: Sie mindert
-- Bemessungsgrundlage und Steuer im Zeitraum ihres Datums – mit ihren eigenen Zeilen (gutschrift_positionen).
-- Steuerfall für die Kennzahlen 011/017 (KAN-439): über den Lieferschein der Zeile; freie Zeilen (Preisnachlass) haben
-- keinen Lieferschein und nehmen den Steuerfall der berichtigten Rechnung.
-- E&A-Betriebe versteuern nach Zahlung: Dort wirkt eine Gutschrift erst über eine Rückzahlung (KAN-453, Entscheidung 4A).
-- Nur die Funktion ändert sich – keine Datenänderung.

DO $kan419b$
DECLARE
  v_def text;
  c_alt constant text := '    WHERE v_doppik AND s.tenant_id = p_tenant_id AND s.art = ''storno'' AND s.aktiv
      AND s.datum BETWEEN v_von AND v_bis
  ),';
  c_neu constant text := '    WHERE v_doppik AND s.tenant_id = p_tenant_id AND s.art = ''storno'' AND s.aktiv
      AND s.datum BETWEEN v_von AND v_bis
    UNION ALL
    -- KAN-419: Gutschrift – ihre eigenen Zeilen −1 im Zeitraum ihres Datums; Steuerfall über den Lieferschein der Zeile,
    -- bei freien Zeilen (Preisnachlass) der der berichtigten Rechnung
    SELECT g.id, -1, x.pos,
           coalesce((SELECT v.steuerfall FROM verkaufsposten v WHERE v.id = (x.pos ->> ''lieferschein_id'')::uuid AND v.tenant_id = g.tenant_id),
                    (SELECT max(v.steuerfall) FROM verkaufsposten v WHERE v.rechnung_id = g.gutschrift_zu_id AND v.tenant_id = g.tenant_id))
    FROM rechnungen g CROSS JOIN LATERAL jsonb_array_elements(g.gutschrift_positionen) AS x(pos)
    WHERE v_doppik AND g.tenant_id = p_tenant_id AND g.art = ''gutschrift'' AND g.aktiv
      AND g.datum BETWEEN v_von AND v_bis
  ),';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'berechne_ea_uva';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-419: berechne_ea_uva – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan419b$;
