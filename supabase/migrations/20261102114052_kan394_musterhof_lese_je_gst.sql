-- KAN-394 Nachtrag 3 (02.11.2026, Entscheidung Jörgen: „die Verteilung hat auf die GST zu erfolgen … die Pressungen
-- gehen dann von den GST weg“): Der Demo-Reset des Musterhofs legte Lesedaten an Rieden mit Grundstücken ohne GST an
-- („ganze Ried“) und presste sie ganz von einem GST. Nach der anteiligen Verteilung (App seit PR #507/#508) war das GST
-- dann überzogen (2025: Frechau Zweigelt, Kremsleithen GV, Pfaffenberg Riesling, Sandgrube GV).
--
-- Neu: demo_musterhof_lese_je_gst() am Ende von demo_musterhof_zuruecksetzen() (Schritt 1) und von demo_musterhof_y2_kette()
-- (Schritt 2, nach demo_musterhof_kellerbuch()):
--   1. Jeder Lese-Eintrag ohne GST an einer Ried mit im Jahrgang bewirtschafteten Weinbau-GST wird auf die GST
--      aufgeteilt – nach Fläche (ohne vollständige Flächen gleich), volle kg, Rest an das letzte GST (nach gst_nr, id),
--      dieselbe Rechnung wie riedLeseVerteilen() in src/lib/wein/leseBilanz.ts.
--   2. Jede Traubenzeile einer Pressung derselben Lese und Ried wird im Verhältnis der Lesemengen je GST aufgeteilt –
--      so ist kein GST überzogen.
-- Bestehende Zeilen werden zum ersten GST, die übrigen kommen als neue Zeilen dazu (feste IDs aus md5, damit der Reset
-- jeden Tag dieselben IDs erzeugt), nichts wird gelöscht. Nur Demo-Mandant; Freeze über s112.freeze_frei (nur in diesem Lauf).

CREATE OR REPLACE FUNCTION public.demo_musterhof_lese_je_gst()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  c_t constant uuid := '33333333-3333-4333-8333-333333333333';
  r record;
  g record;
  v_rest numeric;
  v_anteil numeric;
BEGIN
  PERFORM set_config('s112.protokoll_aus', c_t::text, true);
  -- Lese bzw. Pressung ist verpresst (Freeze KAN-205/KAN-148): nur in diesem Lauf frei, am Ende zurückgesetzt
  PERFORM set_config('s112.freeze_frei', '*', true);

  -- 1. Lese-Einträge ohne GST auf die GST der Ried aufteilen
  FOR r IN
    SELECT ep.*, jg.jahrgang AS jg_jahr
      FROM ernte_parzellen ep JOIN weinjahrgaenge jg ON jg.id = ep.jahrgang_id
     WHERE jg.tenant_id = c_t AND ep.grundstueck_id IS NULL AND ep.storniert_am IS NULL AND ep.menge_kg IS NOT NULL
     ORDER BY ep.id
  LOOP
    v_rest := r.menge_kg;
    -- Weinbau-GST der Ried, die im Jahrgang bewirtschaftet werden (gstImJahr: Stichtag 1.1.); Gewicht = Fläche, ohne
    -- vollständige Flächen 1 – Nummer, Anzahl und Summe der Gewichte je Zeile über Fensterfunktionen
    FOR g IN
      SELECT y.id, y.nr, y.n, y.gewicht, sum(y.gewicht) OVER () AS summe
        FROM (SELECT x.id, x.nr, count(*) OVER () AS n,
                     CASE WHEN bool_and(x.flaeche > 0) OVER () THEN x.flaeche ELSE 1 END AS gewicht
                FROM (SELECT g2.id, coalesce(g2.flaeche_ha, 0) AS flaeche, row_number() OVER (ORDER BY g2.gst_nr, g2.id) AS nr
                        FROM grundstuecke g2
                       WHERE g2.tenant_id = c_t AND g2.weingarten_id = r.weingarten_id AND g2.nutzart = 'WI'
                         AND (g2.aktiv IS DISTINCT FROM false
                              OR (g2.deaktiviert_am IS NOT NULL AND make_date(r.jg_jahr, 1, 1) < g2.deaktiviert_am))) x) y
       ORDER BY y.nr
    LOOP
      v_anteil := CASE WHEN g.nr = g.n THEN v_rest ELSE round(r.menge_kg * g.gewicht / g.summe, 0) END;
      v_rest := v_rest - v_anteil;
      IF g.nr = 1 THEN
        UPDATE ernte_parzellen SET grundstueck_id = g.id, menge_kg = v_anteil, menge_hl = v_anteil / 130 WHERE id = r.id;
      ELSE
        INSERT INTO ernte_parzellen
        SELECT * FROM jsonb_populate_record(NULL::ernte_parzellen,
          to_jsonb((SELECT e FROM ernte_parzellen e WHERE e.id = r.id))
          || jsonb_build_object('id', md5(r.id::text || g.id::text)::uuid, 'grundstueck_id', g.id,
                                'menge_kg', v_anteil, 'menge_hl', v_anteil / 130));
      END IF;
    END LOOP;
  END LOOP;

  -- 2. Traubenzeilen der Pressungen im Verhältnis der Lesemengen je GST derselben Lese und Ried aufteilen
  FOR r IN
    SELECT pw.*, p.lese_id AS p_lese
      FROM pressung_weingaerten pw JOIN pressungen p ON p.id = pw.pressung_id
     WHERE p.tenant_id = c_t AND p.storniert_am IS NULL AND pw.storniert_am IS NULL AND pw.weingarten_id IS NOT NULL
       AND (SELECT count(DISTINCT ep.grundstueck_id) FROM ernte_parzellen ep
             WHERE ep.lese_id = p.lese_id AND ep.weingarten_id = pw.weingarten_id AND ep.storniert_am IS NULL
               AND ep.grundstueck_id IS NOT NULL AND ep.menge_kg > 0) > 1
       -- nur ohne GST oder an einem überzogenen GST – ein zweiter Aufruf ändert nichts mehr
       AND (pw.grundstueck_id IS NULL
            OR (SELECT coalesce(sum(pw2.trauben_kg), 0) FROM pressung_weingaerten pw2 JOIN pressungen p2 ON p2.id = pw2.pressung_id
                 WHERE p2.lese_id = p.lese_id AND p2.storniert_am IS NULL AND pw2.storniert_am IS NULL AND pw2.grundstueck_id = pw.grundstueck_id)
             > (SELECT coalesce(sum(ep.menge_kg), 0) FROM ernte_parzellen ep
                 WHERE ep.lese_id = p.lese_id AND ep.grundstueck_id = pw.grundstueck_id AND ep.storniert_am IS NULL) + 0.01)
     ORDER BY pw.id
  LOOP
    v_rest := r.trauben_kg;
    -- Gewicht = Lesemenge des GST in dieser Lese und Ried
    FOR g IN
      SELECT x.id, row_number() OVER (ORDER BY x.gst_nr, x.id) AS nr, count(*) OVER () AS n,
             x.kg AS gewicht, sum(x.kg) OVER () AS summe
        FROM (SELECT gs.id, gs.gst_nr, sum(ep.menge_kg) AS kg
                FROM ernte_parzellen ep JOIN grundstuecke gs ON gs.id = ep.grundstueck_id
               WHERE ep.lese_id = r.p_lese AND ep.weingarten_id = r.weingarten_id AND ep.storniert_am IS NULL AND ep.menge_kg > 0
               GROUP BY gs.id, gs.gst_nr) x
       ORDER BY 2
    LOOP
      v_anteil := CASE WHEN g.nr = g.n THEN v_rest ELSE round(r.trauben_kg * g.gewicht / g.summe, 0) END;
      v_rest := v_rest - v_anteil;
      IF g.nr = 1 THEN
        UPDATE pressung_weingaerten SET grundstueck_id = g.id, trauben_kg = v_anteil WHERE id = r.id;
      ELSE
        INSERT INTO pressung_weingaerten
        SELECT * FROM jsonb_populate_record(NULL::pressung_weingaerten,
          to_jsonb((SELECT w FROM pressung_weingaerten w WHERE w.id = r.id))
          || jsonb_build_object('id', md5(r.id::text || g.id::text)::uuid, 'grundstueck_id', g.id, 'trauben_kg', v_anteil));
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('s112.freeze_frei', '', true);
END
$f$;

REVOKE EXECUTE ON FUNCTION public.demo_musterhof_lese_je_gst() FROM PUBLIC, anon, authenticated;

-- Aufruf als letzte Anweisung von Schritt 1 – vor dem abschließenden „end“ der Funktion (genau einmal)
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
  v_start int;
BEGIN
  -- Beginn des letzten Zeilenumbruchs vor „end“ (Suche im umgedrehten Text)
  v_start := length(v_def) - position(reverse(chr(10) || 'end') in reverse(v_def)) - 2;
  IF position(reverse(chr(10) || 'end') in reverse(v_def)) = 0
     OR substr(v_def, v_start) !~ ('^' || chr(10) || 'end\s*\$function\$\s*$') THEN
    RAISE EXCEPTION 'KAN-394: Ende von demo_musterhof_zuruecksetzen nicht gefunden';
  END IF;
  EXECUTE left(v_def, v_start - 1)
    || chr(10) || '  -- KAN-394 Nachtrag 3: Lesedaten und Pressungen je GST (keine Ried-Lese ohne GST)'
    || chr(10) || '  perform demo_musterhof_lese_je_gst();'
    || substr(v_def, v_start);
END
$m$;

-- Ebenso am Ende von Schritt 2 nach demo_musterhof_kellerbuch() – demo_musterhof_lesen() legt die Eiswein-Lese an der Ried
-- Sandgrube GV und demo_musterhof_kellerbuch() die Lese Gebling GV (laufendes Jahr) ohne GST an; bereits aufgeteilte
-- Zeilen bleiben unverändert
DO $m$
DECLARE
  c_alt constant text := '  perform demo_musterhof_kellerbuch();';
  c_neu constant text := E'  perform demo_musterhof_kellerbuch();\n\n'
                      || E'  -- KAN-394 Nachtrag 3: auch die Lesen aus demo_musterhof_lesen() und demo_musterhof_kellerbuch() je GST\n'
                      || '  perform demo_musterhof_lese_je_gst();';
  v_def text := pg_get_functiondef('public.demo_musterhof_y2_kette()'::regprocedure);
  v_treffer int;
BEGIN
  v_treffer := (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt);
  IF v_treffer <> 1 THEN
    RAISE EXCEPTION 'KAN-394: erwartet genau eine Stelle „perform demo_musterhof_kellerbuch()“ in demo_musterhof_y2_kette, gefunden %', v_treffer;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$m$;

-- Selbstprüfung
DO $$
BEGIN
  IF position('perform demo_musterhof_lese_je_gst();' in pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-394: Aufruf fehlt in demo_musterhof_zuruecksetzen';
  END IF;
  IF position('perform demo_musterhof_lese_je_gst();' in pg_get_functiondef('public.demo_musterhof_y2_kette()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-394: Aufruf fehlt in demo_musterhof_y2_kette';
  END IF;
END
$$;
