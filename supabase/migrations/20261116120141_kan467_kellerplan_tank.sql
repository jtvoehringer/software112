-- KAN-467 (16.11.2026): Tank mit Kammern – Stufe 2: Tank-Symbol im Kellerplan.
--
-- Ein Tank (gebinde_tanks, KAN-466) steht im Kellerplan als EIN Symbol; seine Kammern werden darin als Segmente
-- gezeichnet. Dafür bekommt kellerplan_positionen die Spalte tank_id: eine Zeile steht entweder für ein Gebinde
-- (behaelter_id) oder für einen Tank (tank_id) – genau eines von beiden, je Tank höchstens eine Position (wie je Gebinde).
--   * breite_pct = Breite in % der Planbreite; hoehe_pct = Höhe im selben Maß (ein Tank mit 12 × 26 ist gut doppelt so
--     hoch wie breit). Bei Gebinden (Kreisen) bleibt hoehe_pct wie bisher ohne Wirkung.
--   * Eine Kammer eines eigenen Tanks lässt sich nicht mehr einzeln platzieren. Der Partner einer Kellergemeinschaft
--     platziert freigegebene Kammern eines fremden Tanks weiter einzeln (Entscheidung Jörgen 16.11.2026) – er sieht
--     nicht alle Kammern und darf den fremden Tank nicht verwalten.
--   * Schon platzierte Kammern (KAN-466, Demo-Tank) stellt diese Migration um: der Tank übernimmt den Platz der
--     untersten platzierten Kammer.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Spalte und Regeln ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.kellerplan_positionen
  ALTER COLUMN behaelter_id DROP NOT NULL,
  ADD COLUMN tank_id uuid REFERENCES public.gebinde_tanks(id) ON DELETE CASCADE,
  -- je Tank eine Position über alle Pläne (wie kellerplan_positionen_behaelter_unique); zugleich Index zum Fremdschlüssel
  ADD CONSTRAINT kellerplan_positionen_tank_unique UNIQUE (tank_id);
COMMENT ON COLUMN public.kellerplan_positionen.tank_id IS
  'KAN-467: Tank mit Kammern (gebinde_tanks) als ein Symbol im Plan – dann ist behaelter_id leer; hoehe_pct = Höhe im Maß der Breite';

-- ── 2. Bestehende Plätze von Kammern auf den Tank umstellen ─────────────────────────────────────────────────────────
INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, tank_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct)
SELECT DISTINCT ON (b.tank_id) p.tenant_id, p.kellerplan_id, b.tank_id, least(p.pos_x_pct, 88), least(p.pos_y_pct, 81), 12, 26
  FROM public.kellerplan_positionen p
  JOIN public.behaelter b ON b.id = p.behaelter_id
 WHERE b.tank_id IS NOT NULL AND b.tenant_id = p.tenant_id
 ORDER BY b.tank_id, b.kammer_nr;
DELETE FROM public.kellerplan_positionen p
 USING public.behaelter b
 WHERE b.id = p.behaelter_id AND b.tank_id IS NOT NULL AND b.tenant_id = p.tenant_id;

ALTER TABLE public.kellerplan_positionen
  ADD CONSTRAINT kellerplan_positionen_ziel_chk CHECK ((behaelter_id IS NULL) <> (tank_id IS NULL));

-- KAN-178: Verweis nur in den eigenen Betrieb (ein fremder Tank ist nie platzierbar)
CREATE TRIGGER z_fremdverweis_tank_id BEFORE INSERT OR UPDATE OF tank_id, tenant_id ON public.kellerplan_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('tank_id', 'gebinde_tanks', '', '', '');

-- Kammer eines eigenen Tanks: nur über das Tank-Symbol
CREATE FUNCTION public.s112_kellerplan_kammer_schutz() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.behaelter_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.behaelter b WHERE b.id = NEW.behaelter_id AND b.tank_id IS NOT NULL AND b.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Die Kammer eines Tanks steht nicht einzeln im Kellerplan – bitte den Tank platzieren.'
      USING ERRCODE = '23514', HINT = 'kellerplan_kammer';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_kellerplan_kammer_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_kammer_schutz BEFORE INSERT OR UPDATE OF behaelter_id, tenant_id ON public.kellerplan_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_kellerplan_kammer_schutz();

-- ── 3. Musterhof-Reset: der Demo-Tank steht als ein Symbol im Plan ──────────────────────────────────────────────────
-- Eine Stelle der Funktion wird ersetzt (Vorlage KAN-380/KAN-395/KAN-466) – Prüfung auf genau einen Treffer.
DO $m$
DECLARE
  c_alt constant text := '  insert into kellerplan_positionen (tenant_id, kellerplan_id, behaelter_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct)' || E'\n'
    || '  select c_t, demo_musterhof_id(17,1), demo_musterhof_id(10, p.nr), p.x, 78, 9, 14 from (values (25, 58), (26, 70), (27, 82)) as p(nr, x);';
  c_neu constant text := '  -- KAN-467: der Tank steht als ein Symbol im Plan (Kammern als Segmente)' || E'\n'
    || '  insert into kellerplan_positionen (tenant_id, kellerplan_id, tank_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct)' || E'\n'
    || '  values (c_t, demo_musterhof_id(17,1), demo_musterhof_id(68, 1), 60, 72, 12, 26);';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-467: erwartet genau einen Kellerplan-Platz der Demo-Kammern in demo_musterhof_zuruecksetzen';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$m$;

-- Selbstprüfung
DO $$
DECLARE v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF position('KAN-467: der Tank steht als ein Symbol im Plan' in v_def) = 0 OR position('(values (25, 58), (26, 70), (27, 82))' in v_def) > 0 THEN
    RAISE EXCEPTION 'KAN-467: Tank-Platz fehlt in demo_musterhof_zuruecksetzen';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kellerplan_positionen p JOIN public.behaelter b ON b.id = p.behaelter_id
              WHERE b.tank_id IS NOT NULL AND b.tenant_id = p.tenant_id) THEN
    RAISE EXCEPTION 'KAN-467: es stehen noch Kammern eigener Tanks einzeln im Plan';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
