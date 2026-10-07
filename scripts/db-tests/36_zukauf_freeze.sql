-- @bereich: Zukauf-Merkmale nach Folgebuchung (KAN-208)
-- @ziel: Hängt an der Zielcharge eines Zukaufs eine Folgebuchung (ohne den Zukauf selbst), sind seine Merkmale fest
-- @ziel: (42501, HINT freeze) – Beleg- und Transportangaben, Notizen und Storno bleiben; ohne Folgebuchung frei.
-- @mutation freeze_aus: kein Freeze-Trigger auf zukauf_posten | rot: gesperrt_.*
-- @mutation selbst_zaehlt: der Zukauf selbst gilt als Folgebuchung | rot: funktion_zukauf_selbst_zaehlt_nicht|frei_ohne_folgebuchung
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 36 (Stand 05.10.2026, KAN-208). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '36_zukauf_freeze';
  c_upd   constant text := 'UPDATE public.zukauf_posten SET %s WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_wa    uuid;
  v_z     uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_z := (pg_temp.s112_beispiel('zukauf_posten', v_b, NULL, jsonb_build_object('ziel_weinausbau_id', v_wa, 'art', 'wein', 'menge', 500,
           'einheit', 'l', 'rebsorte', 'S112TEST Veltliner', 'datum', v_heute - 5, 'aktiv', true)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_aus', $m$DROP TRIGGER a_freeze ON public.zukauf_posten$m$);
  PERFORM pg_temp.s112_mutiere('selbst_zaehlt',
    $m$CREATE OR REPLACE FUNCTION public.s112_zukauf_hat_folgebuchung(p_charge uuid, p_zukauf uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS 'SELECT EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.aktiv)'$m$);

  -- ── 1. Hilfsfunktion ──────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_nicht_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_zukauf_hat_folgebuchung(uuid, uuid)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_zukauf_selbst_zaehlt_nicht', public.s112_zukauf_hat_folgebuchung(v_wa, v_z), false);

  -- ── 2. Ohne Folgebuchung frei ─────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_ohne_folgebuchung',
    pg_temp.s112_versuch(format(c_upd, format('rebsorte = %L', 'S112TEST Riesling'), v_z)), 'k1');

  -- ── 3. Folgebuchung an der Zielcharge: Merkmale fest ─────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'datum', v_heute - 1));
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_mit_folgebuchung', public.s112_zukauf_hat_folgebuchung(v_wa, v_z), true);
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.s112_fehlertext(format(c_upd, format('rebsorte = %L', 'S112TEST Zweigelt'), v_z));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_sorte',
    v_txt LIKE '42501: Gesperrt: Folgebuchung an der Charge bzw. Weinlager-Artikel des Zukaufs am % (nicht: rebsorte).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_menge',
    pg_temp.s112_versuch(format(c_upd, 'menge = 400', v_z)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_jahrgang',
    pg_temp.s112_versuch(format(c_upd, 'jahrgang = 1999', v_z)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_beleg',
    pg_temp.s112_versuch(format(c_upd, format('notizen = %L, eingangsrechnungsnummer = %L', 'S112TEST', 'S112TEST-ER-1'), v_z)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
