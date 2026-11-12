-- KAN-432 (12.11.2026): Weinexport Teil A – Grunddaten am Exportauftrag (Epic KAN-431).
--
-- Entscheidungen Jörgen 12.11.2026 (alle Fragen A):
--   1A UID des Kunden am Exportauftrag (vorbelegt aus der Firma, bei Kontakten von Hand)
--   2A Flaschen je Karton: Standard je Betrieb (Vorgabe 6), je Position änderbar – gilt auch für die Einheit „Kiste“
--   3A Alkohol aus dem Prüfnummernantrag, sonst der jüngsten Analyse – kein Feld am Auftrag (wird nur gelesen)
--   4A KN-Code: achtstellig erwartet, Lücke als Hinweis; kein automatischer Vorschlag
-- Lieferfall (EU/Drittland, B2B/B2C), Liter, Kartons und Alkohol werden berechnet, nicht gespeichert.
-- Die neuen Spalten des Auftrags stehen NICHT in der Freeze-Positivliste (KAN-429) – ab „Versendet“ sind sie gesperrt.

-- ── 1. Exportauftrag und Positionen ───────────────────────────────────────────────────────────
ALTER TABLE public.exportauftraege
  ADD COLUMN versanddatum        date,
  ADD COLUMN zahlungsbedingungen text CONSTRAINT exportauftraege_zahlungsbedingungen_chk CHECK (zahlungsbedingungen IS NULL OR char_length(zahlungsbedingungen) <= 300),
  ADD COLUMN kunde_uid           text CONSTRAINT exportauftraege_kunde_uid_chk CHECK (kunde_uid IS NULL OR char_length(kunde_uid) <= 20);
COMMENT ON COLUMN public.exportauftraege.versanddatum IS 'KAN-432: Tag, an dem die Ware das Lager verlässt (Handelsrechnung, Begleitdokument)';
COMMENT ON COLUMN public.exportauftraege.zahlungsbedingungen IS 'KAN-432: Zahlungsbedingungen als Text (Vorschlag aus dem Zahlungsziel des Kunden bzw. Betriebs)';
COMMENT ON COLUMN public.exportauftraege.kunde_uid IS 'KAN-432: UID des Kunden – mit UID gilt die Lieferung als B2B (innergemeinschaftliche Lieferung in der EU)';

ALTER TABLE public.exportauftrag_positionen
  ADD COLUMN flaschen_je_karton smallint CONSTRAINT exportauftrag_positionen_karton_chk CHECK (flaschen_je_karton IS NULL OR flaschen_je_karton BETWEEN 1 AND 60);
COMMENT ON COLUMN public.exportauftrag_positionen.flaschen_je_karton IS
  'KAN-432: Flaschen je Karton (Packstücke); bei der Einheit „Kiste“ zugleich die Flaschen je Kiste (Liter und Gewicht)';

-- ── 2. Betrieb ──────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN betrieb_eori              text CONSTRAINT tenant_einstellungen_betrieb_eori_chk CHECK (betrieb_eori IS NULL OR char_length(betrieb_eori) <= 30),
  ADD COLUMN kleiner_weinerzeuger      boolean NOT NULL DEFAULT false,
  ADD COLUMN export_flaschen_je_karton smallint NOT NULL DEFAULT 6
    CONSTRAINT tenant_einstellungen_export_karton_chk CHECK (export_flaschen_je_karton BETWEEN 1 AND 60);
COMMENT ON COLUMN public.tenant_einstellungen.betrieb_eori IS 'KAN-432: EORI-Nummer des Betriebs (Ausfuhr in Drittländer)';
COMMENT ON COLUMN public.tenant_einstellungen.kleiner_weinerzeuger IS 'KAN-432: kleiner Weinerzeuger (durchschnittlich unter 1.000 hl je Weinwirtschaftsjahr) – steuert später Begleitdokument und Vermerk';
COMMENT ON COLUMN public.tenant_einstellungen.export_flaschen_je_karton IS 'KAN-432: Standard „Flaschen je Karton“ für neue Exportpositionen';
GRANT SELECT (betrieb_eori, kleiner_weinerzeuger, export_flaschen_je_karton) ON public.tenant_einstellungen TO authenticated, anon;

-- ── 3. s112_exportauftrag_aendern nimmt die neuen Felder (je genau eine Stelle, sonst Abbruch) ──────────────────────────
DO $kan432$
DECLARE
  v_def text;
  r record;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_exportauftrag_aendern';
  FOR r IN SELECT * FROM (VALUES
    ('    notizen           = NULLIF(p_kopf ->> ''notizen'', '''')
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;',
     '    notizen           = NULLIF(p_kopf ->> ''notizen'', ''''),
    -- KAN-432: Grunddaten für die Dokumente
    versanddatum        = NULLIF(p_kopf ->> ''versanddatum'', '''')::date,
    zahlungsbedingungen = NULLIF(btrim(coalesce(p_kopf ->> ''zahlungsbedingungen'', '''')), ''''),
    kunde_uid           = NULLIF(upper(regexp_replace(coalesce(p_kopf ->> ''kunde_uid'', ''''), ''\s'', '''', ''g'')), '''')
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;'),
    ('INSERT INTO public.exportauftrag_positionen (exportauftrag_id, fullung_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order)',
     'INSERT INTO public.exportauftrag_positionen (exportauftrag_id, fullung_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order, flaschen_je_karton)'),
    ('''2204.21''), (nr - 1)::integer
    FROM jsonb_array_elements(p_positionen) WITH ORDINALITY AS x(e, nr)',
     '''2204.21''), (nr - 1)::integer, NULLIF(e ->> ''flaschen_je_karton'', '''')::smallint
    FROM jsonb_array_elements(p_positionen) WITH ORDINALITY AS x(e, nr)'),
    ('    IF v_e NOT IN (''Fl'', ''Kiste'', ''HL'') THEN',
     '    IF NULLIF(v_z ->> ''flaschen_je_karton'', '''') IS NOT NULL
       AND (v_z ->> ''flaschen_je_karton'' !~ ''^[0-9]{1,2}$'' OR (v_z ->> ''flaschen_je_karton'')::integer NOT BETWEEN 1 AND 60) THEN
      RAISE EXCEPTION ''Position %: Flaschen je Karton bitte als ganze Zahl von 1 bis 60 angeben.'', v_nr USING ERRCODE = ''23514'';
    END IF;
    IF v_e NOT IN (''Fl'', ''Kiste'', ''HL'') THEN')
  ) AS t(alt, neu) LOOP
    IF v_def IS NULL OR (length(v_def) - length(replace(v_def, r.alt, ''))) / length(r.alt) <> 1 THEN
      RAISE EXCEPTION 'KAN-432: s112_exportauftrag_aendern – Ankerstelle nicht genau einmal gefunden: %', left(r.alt, 60);
    END IF;
    v_def := replace(v_def, r.alt, r.neu);
  END LOOP;
  EXECUTE v_def;
END
$kan432$;
