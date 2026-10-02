-- Hotfix CRM (02.10.2026, Jörgen): Kontakte bekommen zwei optionale Freitextfelder
--  • position – Funktion der Person (im Formular in der Zeile Position | Segment | Firma)
--  • quelle   – woher der Kontakt kommt; Auswahl aus den im Betrieb verwendeten Quellen oder „+ Neue Quelle …“,
--               zugleich Filter in der Kontaktliste (Button „Quelle“ mit Wert-Buttons)
-- Keine eigene Quellen-Tabelle: die Werte ergeben sich aus den Kontakten des Betriebs (RLS wie die übrigen Spalten).
ALTER TABLE public.kontakte
  ADD COLUMN position text CONSTRAINT kontakte_position_laenge CHECK (position IS NULL OR length(btrim(position)) BETWEEN 1 AND 120),
  ADD COLUMN quelle   text CONSTRAINT kontakte_quelle_laenge CHECK (quelle IS NULL OR length(btrim(quelle)) BETWEEN 1 AND 80);
CREATE INDEX kontakte_quelle_idx ON public.kontakte (tenant_id, quelle) WHERE quelle IS NOT NULL;
COMMENT ON COLUMN public.kontakte.position IS 'Hotfix 02.10.2026: Position/Funktion der Person (optional)';
COMMENT ON COLUMN public.kontakte.quelle IS 'Hotfix 02.10.2026: Quelle des Kontakts (optional, Freitext; Filter in der Kontaktliste)';