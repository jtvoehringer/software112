-- @bereich: E-Label je Füllung (KAN-216)
-- @ziel: Ein Mitarbeiter legt das E-Label einer Füllung als Entwurf an; die Zutatenliste nimmt nur aktive, verschiedene
-- @ziel: Katalogeinträge; Freigabe nur vollständig (Zutaten, Nährwerte) und mit Stempel; freigegeben ist es weder
-- @ziel: änderbar noch löschbar; die Kennung (QR-Code) ist unveränderlich; fremde Betriebe sehen und verweisen nicht;
-- @ziel: den Katalog pflegen nur Plattform-Admins.
-- @mutation freeze_weg: kein Trigger a_freeze auf elabels | rot: freigegeben_gesperrt
-- @mutation pruefung_weg: kein Trigger b_elabel_pruefen | rot: unbekannte_zutat
-- @mutation freigabe_check_weg: kein CHECK elabels_freigabe_vollstaendig | rot: freigabe_unvollstaendig
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 46 (Stand 06.10.2026, KAN-216). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '46_elabel';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_mw    uuid;
  v_bta   uuid;
  v_f     uuid;
  v_f2    uuid;
  v_fb    uuid;
  v_trauben uuid;
  v_sulfit  uuid;
  v_el    uuid;
  v_el2   uuid;
  v_code  text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_f := (pg_temp.s112_beispiel('fuellungen', v_m) ->> 'id')::uuid;
  v_f2 := (pg_temp.s112_beispiel('fuellungen', v_m) ->> 'id')::uuid;
  v_fb := (pg_temp.s112_beispiel('fuellungen', v_b) ->> 'id')::uuid;
  SELECT id INTO v_trauben FROM public.elabel_zutaten WHERE kategorie = 'zutat' AND name_de = 'Trauben';
  SELECT id INTO v_sulfit FROM public.elabel_zutaten WHERE kategorie = 'konservierung' AND name_de = 'Sulfite';
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_befuellt', v_trauben IS NOT NULL AND v_sulfit IS NOT NULL, true);

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_weg', $m$DROP TRIGGER a_freeze ON public.elabels$m$);
  PERFORM pg_temp.s112_mutiere('pruefung_weg', $m$DROP TRIGGER b_elabel_pruefen ON public.elabels$m$);
  PERFORM pg_temp.s112_mutiere('freigabe_check_weg', $m$ALTER TABLE public.elabels DROP CONSTRAINT elabels_freigabe_vollstaendig$m$);

  -- ── 1. Entwurf durch den Mitarbeiter ──────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mw);
  INSERT INTO public.elabels (tenant_id, fuellung_id, zutaten_ids) VALUES (v_m, v_f, ARRAY[v_trauben, v_sulfit])
    RETURNING id, code INTO v_el, v_code;
  INSERT INTO public.elabels (tenant_id, fuellung_id) VALUES (v_m, v_f2) RETURNING id INTO v_el2;
  v_erg := v_erg || pg_temp.s112_erwarte('code_format', v_code ~ '^[2-9A-HJKMNP-Z]{10}$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('unbekannte_zutat',
    pg_temp.s112_versuch(format('UPDATE public.elabels SET zutaten_ids = ARRAY[%L::uuid, gen_random_uuid()] WHERE id = %L', v_trauben, v_el)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('doppelte_zutat',
    pg_temp.s112_versuch(format('UPDATE public.elabels SET zutaten_ids = ARRAY[%L::uuid, %L::uuid] WHERE id = %L', v_trauben, v_trauben, v_el)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('code_unveraenderlich',
    pg_temp.s112_versuch(format('UPDATE public.elabels SET code = %L WHERE id = %L', 'ABCDEFGHJK', v_el2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('entwurf_loeschbar',
    pg_temp.s112_versuch(format('DELETE FROM public.elabels WHERE id = %L', v_el2)), 'k1');

  -- ── 2. Freigabe ───────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_unvollstaendig',
    pg_temp.s112_versuch(format('UPDATE public.elabels SET status = %L WHERE id = %L', 'freigegeben', v_el)), 'E23514');
  UPDATE public.elabels SET energie_kj = 300, energie_kcal = 72, kohlenhydrate_g = 0.2, zucker_g = 0.2,
         alkohol_vol = 12.5, restzucker_gl = 2, gesamtsaeure_gl = 6 WHERE id = v_el;
  v_erg := v_erg || pg_temp.s112_erwarte('freigeben',
    pg_temp.s112_zaehle(format($q$WITH u AS (UPDATE public.elabels SET status = 'freigegeben' WHERE id = %L RETURNING 1) SELECT count(*) FROM u$q$, v_el)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_gestempelt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.elabels WHERE id = %L AND freigegeben_am IS NOT NULL AND freigegeben_von = %L', v_el, v_mw)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('freigegeben_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.elabels SET energie_kj = 1 WHERE id = %L', v_el)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('freigegeben_nicht_loeschbar',
    pg_temp.s112_versuch(format('DELETE FROM public.elabels WHERE id = %L', v_el)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_nur_plattform_admin',
    pg_temp.s112_versuch($q$INSERT INTO public.elabel_zutaten (kategorie, name_de, name_en) VALUES ('zutat', 'S112TEST', 'S112TEST')$q$), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_lesbar',
    pg_temp.s112_zaehle('SELECT (count(*) > 20)::int FROM public.elabel_zutaten'), '1');

  -- ── 3. Fremder Betrieb ────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_sehen_nicht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.elabels WHERE id = %L', v_el)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_schreiben_nicht',
    pg_temp.s112_versuch(format('INSERT INTO public.elabels (tenant_id, fuellung_id) VALUES (%L, %L)', v_m, v_f2)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('kein_fremdverweis',
    pg_temp.s112_versuch(format('INSERT INTO public.elabels (tenant_id, fuellung_id) VALUES (%L, %L)', v_b, v_f2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('eigener_betrieb_ok',
    pg_temp.s112_versuch(format('INSERT INTO public.elabels (tenant_id, fuellung_id) VALUES (%L, %L)', v_b, v_fb)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 17);
END $test$;
