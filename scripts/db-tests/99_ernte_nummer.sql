-- @bereich: Lese – Ernte-Nummer und Ernte je Traubenzeile der Pressung (KAN-477 S1)
-- @ziel: Jede Ernte (ernte_parzellen) bekommt beim Anlegen die nächste Nummer ihrer Lese – lückenlos, unabhängig von
-- @ziel: einer mitgeschickten Nummer; nachträglich bleibt sie, was immer der Aufrufer schickt. Der Bestand ist je Lese
-- @ziel: lückenlos nummeriert. Eine Traubenzeile der Pressung bekommt die Ernte derselben Lese, Ried, Grundstück und
-- @ziel: desselben Erntedatums; eine Angabe des Aufrufers (auch eine fremde Ernte) wird ignoriert, ohne passende Ernte
-- @ziel: bleibt die Spalte leer. Die Triggerfunktionen sind für Benutzer nicht aufrufbar.
-- @mutation ohne_nummer_trigger: Trigger b_ernte_nummer fehlt (Nummer vom Aufrufer, änderbar) | rot: nummer_.*
-- @mutation ohne_zuordnung: Trigger z_fremdverweis_ernte_parzelle_id fehlt (Verweis vom Aufrufer) | rot: traubenzeile_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 17.11.2026, KAN-477). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_ernte_nummer';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_e     record;
  v_max   int;
  v_e1    uuid;
  v_e2    uuid;
  v_fremd uuid;
  v_p     uuid;
  v_pw    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_a := pg_temp.s112_aufbau();

  -- ohne Trigger braucht die Pflichtspalte einen Wert – der Standard steht für „die Nummer kommt nicht mehr aus der Lese“
  PERFORM pg_temp.s112_mutiere('ohne_nummer_trigger', $m$DO $x$ BEGIN
    DROP TRIGGER b_ernte_nummer ON public.ernte_parzellen;
    ALTER TABLE public.ernte_parzellen ALTER COLUMN lfd_nr SET DEFAULT 500; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_zuordnung', $m$DROP TRIGGER z_fremdverweis_ernte_parzelle_id ON public.pressung_weingaerten$m$);

  -- Vorlage: eine Ernte des Musterhofs in einer Lese mit Pressung; eine Ernte einer ANDEREN Lese als fremder Verweis
  SELECT e.* INTO v_e FROM public.ernte_parzellen e JOIN public.weinjahrgaenge j ON j.id = e.jahrgang_id
   WHERE j.tenant_id = c_m AND e.storniert_am IS NULL AND e.weingarten_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.pressungen p WHERE p.lese_id = e.lese_id AND p.storniert_am IS NULL)
   ORDER BY e.ernte_datum DESC, e.id LIMIT 1;
  IF v_e.id IS NULL THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – keine Ernte mit Pressung im Musterhof (demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette())';
  END IF;
  SELECT p.id INTO v_p FROM public.pressungen p WHERE p.lese_id = v_e.lese_id AND p.storniert_am IS NULL ORDER BY p.datum DESC, p.id LIMIT 1;
  SELECT e.id INTO v_fremd FROM public.ernte_parzellen e WHERE e.lese_id <> v_e.lese_id ORDER BY e.id LIMIT 1;
  SELECT max(lfd_nr) INTO v_max FROM public.ernte_parzellen WHERE lese_id = v_e.lese_id;

  -- ── 1. Bestand ──────────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_lueckenlos',
    (SELECT count(*) FROM (SELECT lese_id FROM public.ernte_parzellen GROUP BY lese_id HAVING max(lfd_nr) <> count(*) OR min(lfd_nr) <> 1) x), 0::bigint);

  -- ── 2. Neue Ernte: nächste Nummer, mitgeschickte Nummer zählt nicht ─────────────────────────────────────────
  INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, grundstueck_id, ernte_datum, menge_kg, qualitaetsstufe, lfd_nr)
  VALUES (v_e.jahrgang_id, v_e.lese_id, v_e.weingarten_id, v_e.grundstueck_id, v_e.ernte_datum + 1, 10, v_e.qualitaetsstufe, 77) RETURNING id INTO v_e1;
  INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, grundstueck_id, ernte_datum, menge_kg, qualitaetsstufe)
  VALUES (v_e.jahrgang_id, v_e.lese_id, v_e.weingarten_id, v_e.grundstueck_id, v_e.ernte_datum + 2, 10, v_e.qualitaetsstufe) RETURNING id INTO v_e2;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_naechste_der_lese',
    (SELECT string_agg(lfd_nr::text, ',' ORDER BY lfd_nr) FROM public.ernte_parzellen WHERE id IN (v_e1, v_e2)), (v_max + 1)::text || ',' || (v_max + 2)::text);
  -- noch nicht verpresst (anderes Erntedatum, aber dieselbe Ried → die Sperre „Lese verpresst“ kann greifen): die Nummer bleibt so oder so
  BEGIN
    UPDATE public.ernte_parzellen SET lfd_nr = 99 WHERE id = v_e2;
  EXCEPTION WHEN OTHERS THEN NULL;   -- Sperre verpresster Lesen lehnt ab – auch dann bleibt die Nummer
  END;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_unveraenderlich',
    (SELECT lfd_nr FROM public.ernte_parzellen WHERE id = v_e2), v_max + 2);

  -- ── 3. Traubenzeile der Pressung: Ernte wird zugeordnet ─────────────────────────────────────────────────────
  INSERT INTO public.pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, trauben_kg, ernte_datum)
  VALUES (v_p, v_e.weingarten_id, v_e.grundstueck_id, 5, v_e.ernte_datum + 1) RETURNING id INTO v_pw;
  v_erg := v_erg || pg_temp.s112_erwarte('traubenzeile_ernte_zugeordnet',
    (SELECT ernte_parzelle_id FROM public.pressung_weingaerten WHERE id = v_pw), v_e1);
  -- fremde Ernte (andere Lese) mitgeschickt: wird durch die eigene ersetzt
  INSERT INTO public.pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, trauben_kg, ernte_datum, ernte_parzelle_id)
  VALUES (v_p, v_e.weingarten_id, v_e.grundstueck_id, 5, v_e.ernte_datum + 2, coalesce(v_fremd, gen_random_uuid())) RETURNING id INTO v_pw;
  v_erg := v_erg || pg_temp.s112_erwarte('traubenzeile_fremde_angabe_ignoriert',
    (SELECT ernte_parzelle_id FROM public.pressung_weingaerten WHERE id = v_pw), v_e2);
  -- kein passendes Erntedatum: leer
  INSERT INTO public.pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, trauben_kg, ernte_datum, ernte_parzelle_id)
  VALUES (v_p, v_e.weingarten_id, v_e.grundstueck_id, 5, v_e.ernte_datum + 30, v_e1) RETURNING id INTO v_pw;
  v_erg := v_erg || pg_temp.s112_erwarte('traubenzeile_ohne_passende_ernte_leer',
    (SELECT ernte_parzelle_id FROM public.pressung_weingaerten WHERE id = v_pw), NULL::uuid);
  -- nachträglich einen fremden Verweis setzen: bleibt, wie zugeordnet (bei gesperrter Pressung lehnt schon a_freeze ab)
  BEGIN
    UPDATE public.pressung_weingaerten SET ernte_parzelle_id = v_e1 WHERE id = v_pw;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_erg := v_erg || pg_temp.s112_erwarte('traubenzeile_verweis_nicht_setzbar',
    (SELECT ernte_parzelle_id FROM public.pressung_weingaerten WHERE id = v_pw), NULL::uuid);

  -- ── 4. Rechte und Schema ────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_ernte_nummer()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.s112_pressung_ernte_zuordnen()', 'EXECUTE')
      OR has_function_privilege('anon', 'public.s112_ernte_nummer()', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_je_lese_eindeutig',
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ernte_parzellen_lese_lfd_nr' AND indexdef LIKE 'CREATE UNIQUE INDEX%(lese_id, lfd_nr)'), 1::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
