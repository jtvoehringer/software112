-- KAN-477 (S1): Ernte-Nummer und Herkunft der Charge aus den Ernten (BKI-Sitzung 16.11.2026, Rückverfolgung)
--
-- Vorgabe: Jede Ernte (Lesedaten-Zeile) braucht eine sichtbare Nummer, bis sie in einer Charge aufgeht; n Ernten können
-- zusammen verpresst werden, die Charge muss ihre Ernten kennen.
--
--   1. ernte_parzellen.lfd_nr: laufende Nummer je Lese, Anzeige „2026/2-03“ (Jahrgang/Lese-Ernte). Vergibt die Datenbank
--      (Trigger b_ernte_nummer, nach a_lese_zuordnen); nachträglich nicht änderbar, bei Wechsel der Lese neu vergeben.
--      Bestehende Zeilen werden je Lese nach Erntedatum und Erfassung durchnummeriert – sonst bleibt alles, wie es ist.
--   2. pressung_weingaerten.ernte_parzelle_id: die Ernte, aus der eine Traubenzeile der Pressung stammt. Setzt die
--      Datenbank selbst (Trigger z_fremdverweis_ernte_parzelle_id): dieselbe Lese wie die Pressung, dieselbe Ried und
--      dasselbe Grundstück, dasselbe Erntedatum; eine Angabe des Aufrufers wird ignoriert – ein Verweis auf eine fremde
--      Ernte ist damit nicht möglich. Passt keine Ernte (Zukauf, abweichendes Datum), bleibt die Spalte leer.
--      Gilt für neue Traubenzeilen (ab jetzt, fachlich ab der Lese 2027); bestehende Pressungen bleiben unverändert und
--      zeigen ihre Herkunft wie bisher nach Rieden.
--   Die Ernten einer Charge mit kg-Anteil rechnet die App aus Mostzeile, Pressung und Traubenzeilen (keine eigene Tabelle).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Ernte-Nummer ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ernte_parzellen ADD COLUMN lfd_nr integer;
COMMENT ON COLUMN public.ernte_parzellen.lfd_nr IS
  'KAN-477: laufende Nummer der Ernte je Lese (Anzeige Jahrgang/Lese-Ernte, z. B. 2026/2-03); vergibt der Trigger b_ernte_nummer.';

-- Bestand durchnummerieren: nur die neue Spalte; die Sperre verpresster Lesen (a_freeze, Positivliste) gilt für sie nicht
DO $nr$
BEGIN
  PERFORM set_config('s112.freeze_frei', 'ernte_parzellen', true);
  UPDATE public.ernte_parzellen e
     SET lfd_nr = n.nr
    FROM (SELECT id, row_number() OVER (PARTITION BY lese_id ORDER BY ernte_datum NULLS LAST, created_at, id) AS nr
            FROM public.ernte_parzellen) n
   WHERE n.id = e.id;
  PERFORM set_config('s112.freeze_frei', '', true);
END $nr$;

ALTER TABLE public.ernte_parzellen ALTER COLUMN lfd_nr SET NOT NULL;
ALTER TABLE public.ernte_parzellen ADD CONSTRAINT ernte_parzellen_lfd_nr_chk CHECK (lfd_nr >= 1);
CREATE UNIQUE INDEX ernte_parzellen_lese_lfd_nr ON public.ernte_parzellen (lese_id, lfd_nr);

CREATE FUNCTION public.s112_ernte_nummer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lese_id IS NOT DISTINCT FROM OLD.lese_id THEN
    NEW.lfd_nr := OLD.lfd_nr;   -- die Nummer bleibt, was immer der Aufrufer schickt
    RETURN NEW;
  END IF;
  -- neue Ernte bzw. Wechsel der Lese: nächste Nummer der Lese; die Sperre verhindert doppelte Nummern
  PERFORM 1 FROM public.lesen l WHERE l.id = NEW.lese_id FOR NO KEY UPDATE;
  SELECT coalesce(max(e.lfd_nr), 0) + 1 INTO NEW.lfd_nr FROM public.ernte_parzellen e WHERE e.lese_id = NEW.lese_id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_ernte_nummer() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_ernte_nummer() IS
  'KAN-477: vergibt die laufende Nummer der Ernte je Lese (lückenlos in Erfassungsreihenfolge) und hält sie unveränderlich.';

-- b_…: nach a_lese_zuordnen (setzt bzw. prüft die Lese), vor dem Schreiben
CREATE TRIGGER b_ernte_nummer BEFORE INSERT OR UPDATE OF lfd_nr, lese_id ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ernte_nummer();

-- ── 2. Ernte je Traubenzeile der Pressung ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pressung_weingaerten ADD COLUMN ernte_parzelle_id uuid REFERENCES public.ernte_parzellen(id);
COMMENT ON COLUMN public.pressung_weingaerten.ernte_parzelle_id IS
  'KAN-477: Ernte (Lesedaten-Zeile), aus der diese Traubenzeile stammt – setzt der Trigger z_fremdverweis_ernte_parzelle_id; leer bei Zukauf, bei Pressungen vor KAN-477 und ohne passende Ernte.';
CREATE INDEX pressung_weingaerten_ernte_parzelle_id ON public.pressung_weingaerten (ernte_parzelle_id);

CREATE FUNCTION public.s112_pressung_ernte_zuordnen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lese uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.weingarten_id IS NOT DISTINCT FROM OLD.weingarten_id
     AND NEW.grundstueck_id IS NOT DISTINCT FROM OLD.grundstueck_id AND NEW.ernte_datum IS NOT DISTINCT FROM OLD.ernte_datum
     AND NEW.pressung_id IS NOT DISTINCT FROM OLD.pressung_id THEN
    NEW.ernte_parzelle_id := OLD.ernte_parzelle_id;   -- unverändert, eine Angabe des Aufrufers zählt nie
    RETURN NEW;
  END IF;
  NEW.ernte_parzelle_id := NULL;
  IF NEW.weingarten_id IS NULL THEN RETURN NEW; END IF;   -- Zukauf: keine eigene Ernte
  SELECT p.lese_id INTO v_lese FROM public.pressungen p WHERE p.id = NEW.pressung_id;
  -- dieselbe Lese, dieselbe Ried, dasselbe Grundstück (beide leer oder gleich), dasselbe Erntedatum; bei mehreren die kleinste Nummer
  SELECT e.id INTO NEW.ernte_parzelle_id
    FROM public.ernte_parzellen e
   WHERE e.lese_id = v_lese AND e.storniert_am IS NULL AND e.weingarten_id = NEW.weingarten_id
     AND e.grundstueck_id IS NOT DISTINCT FROM NEW.grundstueck_id
     AND (NEW.ernte_datum IS NULL OR e.ernte_datum = NEW.ernte_datum)
   ORDER BY e.lfd_nr
   LIMIT 1;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_pressung_ernte_zuordnen() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_pressung_ernte_zuordnen() IS
  'KAN-477: ordnet einer Traubenzeile der Pressung ihre Ernte zu (gleiche Lese, Ried, Grundstück, Erntedatum); Angaben des Aufrufers werden ignoriert.';

CREATE TRIGGER z_fremdverweis_ernte_parzelle_id BEFORE INSERT OR UPDATE OF ernte_parzelle_id, weingarten_id, grundstueck_id, ernte_datum, pressung_id
  ON public.pressung_weingaerten FOR EACH ROW EXECUTE FUNCTION public.s112_pressung_ernte_zuordnen();

-- ── 3. Selbstprüfung ────────────────────────────────────────────────────────────────────────────────────────────────
DO $pruef$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ernte_parzellen WHERE lfd_nr IS NULL) THEN
    RAISE EXCEPTION 'KAN-477: Ernten ohne Nummer';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ernte_parzellen GROUP BY lese_id HAVING max(lfd_nr) <> count(*)) THEN
    RAISE EXCEPTION 'KAN-477: Nummern je Lese nicht lückenlos';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_ernte_nummer()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_pressung_ernte_zuordnen()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-477: Triggerfunktion ist für authenticated ausführbar';
  END IF;
END $pruef$;
