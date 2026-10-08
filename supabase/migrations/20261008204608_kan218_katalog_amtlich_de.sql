-- KAN-218 Nachtrag (08.10.2026): deutsche Katalogbegriffe des E-Labels an den amtlichen Wortlaut angleichen
--
-- Befund aus der EUR-Lex-Recherche zu KAN-218 (deutsche Sprachfassungen):
--   'Ei (Eiklar)'                    → 'Albumin aus Ei'                  Del. VO (EU) 2019/33 Anhang I Teil A (zulässige Begriffe:
--                                                                         Ei, Eiprotein, Eiprodukt, Lysozym aus Ei, Albumin aus Ei)
--   'Milch (Casein)'                 → 'Kasein aus Milch'                ebd. (Milch, Milcherzeugnis, Kasein aus Milch, Milchprotein)
--   'Abgefüllt in Schutzatmosphäre'  → 'Unter Schutzatmosphäre abgefüllt' Del. VO (EU) 2023/1606, Art. 48a Abs. 6 VO 2019/33
--   'Mannoproteine aus Hefe'         → 'Hefe-Mannoproteine'              Del. VO (EU) 2019/934 Anhang I Teil A Tabelle 2 (Stabilisatoren)
--   'Kaliumhydrogencarbonat'         → 'Kaliumbicarbonat'                ebd., Nr. 1.5 (E 501(ii))
-- Die englischen Namen (name_en) bleiben unverändert – sie sind der Schlüssel der Übersetzungen (lib/elabel/uebersetzungen.ts).
-- Allergen-Kennzeichen (allergen) bleiben, Hervorhebung und „Enthält: Ei/Milch“ also unverändert. Bestehende E-Labels
-- verweisen über zutaten_ids auf den Katalog und zeigen ab dann den amtlichen Begriff; archivierte Kopien gelöschter
-- Betriebe (s112_archiv) bleiben, wie sie sind.
-- Rollback: dieselben UPDATEs mit vertauschten Werten.

UPDATE public.elabel_zutaten AS z
   SET name_de = n.neu
  FROM (VALUES
    ('Egg (egg white)',                    'Ei (Eiklar)',                   'Albumin aus Ei'),
    ('Milk (casein)',                      'Milch (Casein)',                'Kasein aus Milch'),
    ('Bottled in a protective atmosphere', 'Abgefüllt in Schutzatmosphäre', 'Unter Schutzatmosphäre abgefüllt'),
    ('Yeast mannoproteins',                'Mannoproteine aus Hefe',        'Hefe-Mannoproteine'),
    ('Potassium hydrogen carbonate',       'Kaliumhydrogencarbonat',        'Kaliumbicarbonat')
  ) AS n(name_en, alt, neu)
 WHERE z.name_en = n.name_en
   AND z.name_de = n.alt;

DO $pruefung$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.elabel_zutaten
   WHERE name_de IN ('Albumin aus Ei', 'Kasein aus Milch', 'Unter Schutzatmosphäre abgefüllt', 'Hefe-Mannoproteine', 'Kaliumbicarbonat');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'KAN-218: erwartet 5 angeglichene Katalogbegriffe, gefunden %', v_n;
  END IF;
END $pruefung$;
