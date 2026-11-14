-- KAN-458 (14.11.2026), Schritt 2 von 2: Rechtsverhältnis, Einheitswert und SVS-Zurechnung stehen nur noch in
-- grundstueck_recht (Lesebereich ea). Die App liest und schreibt seit PR #577 nur die neue Tabelle; diese Migration
-- entfernt den Abgleich und die fünf alten Spalten aus grundstuecke – damit liest das Profil „Extern“ über die
-- Grundstücke seiner Rieden weder Pacht/Eigentum noch den Einheitswert.
--
--   1. Sicherung: Die alten Spalten müssen in jeder Zeile den Werten in grundstueck_recht entsprechen (sonst Abbruch)
--   2. Demo-Funktionen: Das Rechtsverhältnis der Demo-Grundstücke kommt in grundstueck_recht
--   3. Abgleich-Trigger samt Funktion, Index und die fünf Spalten entfernen (die CHECKs fallen mit den Spalten)
-- Ein Grundstück ohne Zeile in grundstueck_recht gilt wie bisher als „ohne Angabe“, SVS-Zurechnung „eigen“ (mitRecht()).

-- 1. Sicherung ──────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.grundstuecke g LEFT JOIN public.grundstueck_recht r ON r.grundstueck_id = g.id
   WHERE r.id IS NULL
      OR r.tenant_id IS DISTINCT FROM g.tenant_id
      OR r.rechtsverhaeltnis IS DISTINCT FROM g.rechtsverhaeltnis
      OR r.einheitswert IS DISTINCT FROM g.einheitswert
      OR r.einheitswert_bescheid IS DISTINCT FROM g.einheitswert_bescheid
      OR r.einheitswert_quelle IS DISTINCT FROM g.einheitswert_quelle
      OR r.svs_zurechnung IS DISTINCT FROM g.svs_zurechnung;
  IF v_n > 0 THEN RAISE EXCEPTION 'KAN-458: % Grundstücke weichen in grundstueck_recht von den alten Spalten ab', v_n; END IF;
END $$;

-- 2. Demo-Funktionen ────────────────────────────────────────────────────────────────────────────────────────────────
-- Beide legen die Grundstücke in einer Schleife über r an; die Spalte entfällt aus dem INSERT, die Zeile in
-- grundstueck_recht folgt direkt danach. Jeder Anker muss genau einmal vorkommen.
DO $$
DECLARE
  c_recht constant text := E'\n    insert into grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis)   -- KAN-458'
                        || E'\n    select c_t, g.id, r.rv from grundstuecke g where g.id = demo_musterhof_id(3, r.nr)'
                        || E'\n    on conflict (grundstueck_id) do nothing;';
  r_f record;
  r_a record;
  v_def text;
  v_n integer;
BEGIN
  FOR r_f IN SELECT * FROM (VALUES
    ('public.demo_musterhof_gebiete()',
       ARRAY['nutzart, rechtsverhaeltnis, boden,', E'true, null, \'WI\', r.rv, r.boden,', E'    on conflict (id) do nothing;\n  end loop;'],
       ARRAY['nutzart, boden,',                    E'true, null, \'WI\', r.boden,',       E'    on conflict (id) do nothing;' || c_recht || E'\n  end loop;']),
    ('public.demo_musterhof_zuruecksetzen()',
       ARRAY['nutzart, rechtsverhaeltnis, boden,', E'r.na = \'WI\', null, r.na, r.rv, r.boden,', E'    where w.id = demo_musterhof_id(2, r.wg);\n  end loop;'],
       ARRAY['nutzart, boden,',                    E'r.na = \'WI\', null, r.na, r.boden,',       E'    where w.id = demo_musterhof_id(2, r.wg);' || c_recht || E'\n  end loop;'])
  ) AS v(funktion, alt, neu) LOOP
    v_def := replace(pg_get_functiondef(r_f.funktion::regprocedure), E'\r\n', E'\n');
    IF v_def ~ 'grundstueck_recht' THEN RAISE EXCEPTION 'KAN-458: % schreibt grundstueck_recht schon', r_f.funktion; END IF;
    FOR r_a IN SELECT a.alt, n.neu, a.i FROM unnest(r_f.alt) WITH ORDINALITY a(alt, i) JOIN unnest(r_f.neu) WITH ORDINALITY n(neu, i) USING (i) ORDER BY a.i LOOP
      v_n := (length(v_def) - length(replace(v_def, r_a.alt, ''))) / length(r_a.alt);
      IF v_n <> 1 THEN RAISE EXCEPTION 'KAN-458: % – Anker % kommt %-mal vor (erwartet 1)', r_f.funktion, r_a.i, v_n; END IF;
      v_def := replace(v_def, r_a.alt, r_a.neu);
    END LOOP;
    IF v_def ~ 'nutzart, rechtsverhaeltnis' OR v_def ~ 'r[.]rv, r[.]boden' THEN RAISE EXCEPTION 'KAN-458: % – alte Spalte noch im INSERT', r_f.funktion; END IF;
    EXECUTE v_def;
  END LOOP;
END $$;

-- 3. Abgleich und alte Spalten entfernen ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER a_recht_abgleich ON public.grundstuecke;
DROP FUNCTION public.s112_grundstueck_recht_abgleich();
DROP INDEX public.idx_grundstuecke_rechtsv;
ALTER TABLE public.grundstuecke
  DROP COLUMN rechtsverhaeltnis,
  DROP COLUMN einheitswert,
  DROP COLUMN einheitswert_bescheid,
  DROP COLUMN einheitswert_quelle,
  DROP COLUMN svs_zurechnung;

-- Selbstprüfung: keine Funktion in public nennt die alten Spalten noch im Zusammenhang mit grundstuecke
DO $$
DECLARE v_rest text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_rest
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ~ '(nutzart, rechtsverhaeltnis|einheitswert|svs_zurechnung)';
  IF v_rest IS NOT NULL THEN RAISE EXCEPTION 'KAN-458: Funktionen mit alten Spalten: %', v_rest; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'grundstuecke'
              AND column_name IN ('rechtsverhaeltnis', 'einheitswert', 'einheitswert_bescheid', 'einheitswert_quelle', 'svs_zurechnung')) THEN
    RAISE EXCEPTION 'KAN-458: alte Spalten noch vorhanden';
  END IF;
END $$;
