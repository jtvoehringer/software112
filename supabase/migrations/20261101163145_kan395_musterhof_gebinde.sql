-- KAN-395 (Epic KAN-391, UAT): Der Demo-Musterhof hat nach dem Reset alle 19 Gebinde belegt – für Umzug, Verschnitt,
-- Pressung und Abstufen einer Teilmenge fehlt ein leeres Gebinde. Der Reset legt zusätzlich fünf leere Gebinde an
-- (Nr. 20–24, IDs 33333333-3333-4333-8333-000a00000014 … 18) und stellt sie in den Kellerplan:
--   Stahltank 12 (10.000 l), Immervolltank 13 (5.000 l), Stahltank 14 (2.500 l) – Tankhalle
--   Holzfass 4 (1.000 l), Barrique 5 (225 l) – Gewölbekeller
-- Nur zwei Stellen der Funktion werden ersetzt (Vorlage KAN-380) – Prüfung auf genau einen Treffer je Stelle.
-- Die Gebinde entstehen beim nächsten Reset (nächtlich 05:00 bzw. manuell zuruecksetzen() + y2_kette()).

DO $m$
DECLARE
  c_alt1 constant text := E'\n  ) as v(nr, name, typ, vol, ort)';
  c_neu1 constant text := ',' || E'\n'
    || '    -- KAN-395: leere Gebinde für Umzug, Verschnitt und Pressung' || E'\n'
    || '    (20, ''Stahltank 12'',        ''stahltank'',      10000, ''Tankhalle''),' || E'\n'
    || '    (21, ''Immervolltank 13'',    ''immervolltank'',  5000,  ''Tankhalle''),' || E'\n'
    || '    (22, ''Stahltank 14'',        ''stahltank'',      2500,  ''Tankhalle''),' || E'\n'
    || '    (23, ''Holzfass 4 (1.000 l)'',''holzfass'',       1000,  ''Gewölbekeller''),' || E'\n'
    || '    (24, ''Barrique 5'',          ''barrique'',       225,   ''Gewölbekeller'')' || E'\n'
    || '  ) as v(nr, name, typ, vol, ort)';
  c_alt2 constant text := '  -- ── Jahrgänge';
  c_neu2 constant text := '  -- KAN-395: Kellerplan-Plätze der leeren Gebinde (freier Platz in Reihe 2, neue Reihe unten)' || E'\n'
    || '  insert into kellerplan_positionen (tenant_id, kellerplan_id, behaelter_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct)' || E'\n'
    || '  select c_t, demo_musterhof_id(17,1), demo_musterhof_id(10, p.nr), p.x, p.y, p.b, p.h from (values' || E'\n'
    || '    (20, 82, 26, 13, 18), (21, 2, 78, 13, 18), (22, 18, 78, 13, 18), (23, 34, 78, 9, 14), (24, 46, 78, 9, 14)' || E'\n'
    || '  ) as p(nr, x, y, b, h);' || E'\n\n'
    || '  -- ── Jahrgänge';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt1, ''))) / length(c_alt1) <> 1 THEN
    RAISE EXCEPTION 'KAN-395: erwartet genau eine Gebinde-Liste in demo_musterhof_zuruecksetzen';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_alt2, ''))) / length(c_alt2) <> 1 THEN
    RAISE EXCEPTION 'KAN-395: erwartet genau einen Abschnitt „Jahrgänge“ in demo_musterhof_zuruecksetzen';
  END IF;
  -- Gebinde-Liste: Zeile 19 endet ohne Komma – das Komma kommt vor die neuen Zeilen
  v_def := replace(v_def, c_alt1, c_neu1);
  IF position('(24, ''Barrique 5''' in v_def) = 0 THEN
    RAISE EXCEPTION 'KAN-395: Gebinde-Liste nicht ersetzt';
  END IF;
  EXECUTE replace(v_def, c_alt2, c_neu2);
END
$m$;

-- Selbstprüfung
DO $$
DECLARE v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF position('(24, ''Barrique 5''' in v_def) = 0 OR position('KAN-395: Kellerplan-Plätze' in v_def) = 0 THEN
    RAISE EXCEPTION 'KAN-395: Gebinde fehlen in demo_musterhof_zuruecksetzen';
  END IF;
END
$$;
