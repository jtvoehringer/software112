-- KAN-398 (UAT, Variante B): Tankmischung – mehrere Pflanzenschutzmittel in einer Spritzbrühe. Gespeichert wird weiterhin
-- je Mittel eine Maßnahme (Aufwand, Lager, Cu-Bilanz, PSM-Aufzeichnung je Mittel); die Maßnahmen einer Mischung tragen
-- dieselbe tankmischung_id (von der App vergeben, kein Verweis auf eine eigene Tabelle – daher kein Fremdverweis-Trigger).
-- Die Liste zeigt die Mittel zusammen, Storno und gemeinsame Felder (Datum, Uhrzeit, Witterung, BBCH, Anwender) gelten
-- für die ganze Mischung. Nur bei Spritzungen (CHECK). Bestehende Maßnahmen bleiben ohne Mischung (NULL).
-- Freeze (a_freeze_ernte, Positivliste) und Storno-Schutz sperren die neue Spalte automatisch mit.

ALTER TABLE public.behandlungen ADD COLUMN tankmischung_id uuid;

ALTER TABLE public.behandlungen
  ADD CONSTRAINT behandlungen_tankmischung_nur_spritzung CHECK (tankmischung_id IS NULL OR art = 'spritzung');

COMMENT ON COLUMN public.behandlungen.tankmischung_id IS
  'KAN-398: gemeinsame ID der Maßnahmen einer Tankmischung (mehrere Mittel in einer Spritzbrühe); NULL = einzelnes Mittel';

-- Liste/Storno/Bearbeiten suchen die Mittel einer Mischung je Betrieb
CREATE INDEX behandlungen_tankmischung_idx ON public.behandlungen (tenant_id, tankmischung_id) WHERE tankmischung_id IS NOT NULL;

-- Selbstprüfung
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'behandlungen' AND column_name = 'tankmischung_id') THEN
    RAISE EXCEPTION 'KAN-398: Spalte tankmischung_id fehlt';
  END IF;
END
$$;
