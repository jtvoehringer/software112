-- @bereich: Kellerbuch – Sammelmaßnahme (KAN-413), RPC s112_kellerbehandlung_sammel
-- @ziel: Ein Mitarbeiter mit Kellerbuch-Recht legt für mehrere Chargen in einem Aufruf je eine Kellerbehandlung mit
-- @ziel: gemeinsamer sammel_id und die Verwendung im Stoffkonto an – alles oder nichts. Leser, fremde Betriebe und anon
-- @ziel: kommen nicht durch; Gebinde und Volumen stammen aus der Charge, nicht aus der Anfrage.
-- @mutation anon_execute: EXECUTE auf s112_kellerbehandlung_sammel für anon | rot: anon_ohne_execute
-- @mutation ohne_modulrecht: Policy modul_insert auf keller_behandlungen entfernt | rot: ohne_kellerbuch_abgelehnt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 89 (Stand 11.11.2026, KAN-413). Alles zurückgerollt.
-- Personen: Mitarbeiter b_w und Leser b_l in Betrieb B, Betriebsleitung c_ta in Betrieb C.

DO $test$
DECLARE
  c_datei constant text := '89_sammelbehandlung';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_c     uuid;
  v_w     uuid;
  v_l     uuid;
  v_x     uuid;
  v_g1    uuid;
  v_g2    uuid;
  v_c1    uuid;
  v_c2    uuid;
  v_cf    uuid;
  v_typ   uuid;
  v_stoff uuid;
  v_kopf  jsonb;
  v_ok    text;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ─────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau(true);
  v_b := (v_a ->> 'b')::uuid;
  v_c := (v_a ->> 'c')::uuid;
  v_w := (v_a ->> 'b_w')::uuid;
  v_l := (v_a ->> 'b_l')::uuid;
  v_x := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Kellerbuch-Recht
  v_g1 := (pg_temp.s112_zeile('behaelter', v_b) ->> 'id')::uuid;
  v_g2 := (pg_temp.s112_zeile('behaelter', v_b) ->> 'id')::uuid;
  v_c1 := (pg_temp.s112_zeile('weinausbau', v_b, jsonb_build_object('behaelter_id', v_g1, 'menge_liter', 1000, 'aktiv', true)) ->> 'id')::uuid;
  v_c2 := (pg_temp.s112_zeile('weinausbau', v_b, jsonb_build_object('behaelter_id', v_g2, 'menge_liter', 500, 'aktiv', true)) ->> 'id')::uuid;
  v_cf := (pg_temp.s112_zeile('weinausbau', v_c, jsonb_build_object('menge_liter', 300, 'aktiv', true)) ->> 'id')::uuid;
  v_typ := (pg_temp.s112_zeile('keller_behandlungstypen', v_b) ->> 'id')::uuid;
  v_stoff := (pg_temp.s112_zeile('kellermittel', v_b, '{"aktiv": true}') ->> 'id')::uuid;
  v_kopf := jsonb_build_object('datum', pg_temp.s112_heute(), 'typ_id', v_typ, 'einheit', 'g', 'notizen', 'S112TEST Sammel', 'kellermittel_id', v_stoff);

  PERFORM pg_temp.s112_mutiere('anon_execute',
    $m$GRANT EXECUTE ON FUNCTION public.s112_kellerbehandlung_sammel(uuid, jsonb, jsonb) TO anon$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modulrecht', $m$DROP POLICY modul_insert ON public.keller_behandlungen$m$);

  -- ── 1. Mitarbeiter: zwei Chargen, Menge und Stoff je Zeile ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_w);
  v_ok := pg_temp.s112_fehlertext(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf,
    jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20, 'stoff_menge', 0.04),
                      jsonb_build_object('weinausbau_id', v_c2, 'menge', 10, 'stoff_menge', 0.02))));
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_mitarbeiter', v_ok, 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('zwei_behandlungen',
    (SELECT count(*) FROM public.keller_behandlungen WHERE tenant_id = v_b AND notizen = 'S112TEST Sammel' AND sammel_id IS NOT NULL), 2::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('eine_sammel_id',
    (SELECT count(DISTINCT sammel_id) FROM public.keller_behandlungen WHERE tenant_id = v_b AND notizen = 'S112TEST Sammel'), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_und_volumen_aus_charge',
    (SELECT count(*) FROM public.keller_behandlungen k
      WHERE k.tenant_id = v_b AND k.notizen = 'S112TEST Sammel'
        AND ((k.weinausbau_id = v_c1 AND k.behaelter_id = v_g1 AND k.volumen_liter_ist = 1000 AND k.menge = 20)
          OR (k.weinausbau_id = v_c2 AND k.behaelter_id = v_g2 AND k.volumen_liter_ist = 500 AND k.menge = 10))), 2::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('stoffkonto_verwendung',
    (SELECT sum(b.menge)::text FROM public.kellermittel_buchungen b
      WHERE b.tenant_id = v_b AND b.kellermittel_id = v_stoff AND b.art = 'verwendung' AND b.keller_behandlung_id IS NOT NULL), '-0.060');
  SELECT count(*) INTO v_n FROM public.keller_behandlungen WHERE tenant_id = v_b;

  -- ── 2. Alles oder nichts ─────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_w);
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_charge_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf,
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20, 'stoff_menge', 0.04),
                        jsonb_build_object('weinausbau_id', v_cf, 'menge', 10, 'stoff_menge', 0.02)))), 'E22023');
  v_ok := pg_temp.s112_fehlertext(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf,
    jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20, 'stoff_menge', 0.04),
                      jsonb_build_object('weinausbau_id', v_c2, 'menge', 10))));   -- zweite Zeile ohne Stoffanteil
  v_erg := v_erg || pg_temp.s112_erwarte('stoffanteil_fehlt_abgelehnt', left(v_ok, 5), '22023');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('nichts_gespeichert_nach_fehler',
    (SELECT count(*) FROM public.keller_behandlungen WHERE tenant_id = v_b), v_n);

  -- ── 3. Eingabeprüfung der RPC ────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_w);
  v_erg := v_erg || pg_temp.s112_erwarte('eine_charge_zu_wenig',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf,
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20, 'stoff_menge', 0.04)))), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_doppelt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf,
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20, 'stoff_menge', 0.04),
                        jsonb_build_object('weinausbau_id', v_c1, 'menge', 10, 'stoff_menge', 0.02)))), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('menge_null_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf - 'kellermittel_id',
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 0),
                        jsonb_build_object('weinausbau_id', v_c2, 'menge', 10)))), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_mengenangabe_geht',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b,
      (v_kopf - 'kellermittel_id') || '{"einheit": "-"}'::jsonb,
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1), jsonb_build_object('weinausbau_id', v_c2)))), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_typ_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf - 'typ_id',
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20, 'stoff_menge', 0.04),
                        jsonb_build_object('weinausbau_id', v_c2, 'menge', 10, 'stoff_menge', 0.02)))), 'E22023');

  -- ── 4. Rechte: Leser, fremder Betrieb, anon ──────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_l);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf - 'kellermittel_id',
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20),
                        jsonb_build_object('weinausbau_id', v_c2, 'menge', 10)))), 'T');
  PERFORM pg_temp.s112_als(v_x);   -- die Funktion läuft mit den Rechten des Benutzers: das Modulrecht der Tabelle gilt
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_kellerbuch_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf - 'kellermittel_id',
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20),
                        jsonb_build_object('weinausbau_id', v_c2, 'menge', 10)))), 'R');
  PERFORM pg_temp.s112_als(v_w);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_c, v_kopf - 'kellermittel_id',
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_cf, 'menge', 20),
                        jsonb_build_object('weinausbau_id', v_c2, 'menge', 10)))), 'T');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_aufruf',
    pg_temp.s112_versuch(format('SELECT public.s112_kellerbehandlung_sammel(%L, %L::jsonb, %L::jsonb)', v_b, v_kopf - 'kellermittel_id',
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_c1, 'menge', 20),
                        jsonb_build_object('weinausbau_id', v_c2, 'menge', 10)))), 'G');
  PERFORM pg_temp.s112_als_postgres();
  -- Der Aufruf scheitert für anon auch an pruefe_tenant_zugriff – das Ausführungsrecht selbst prüft der Katalog
  v_erg := v_erg || pg_temp.s112_erwarte('anon_ohne_execute',
    has_function_privilege('anon', 'public.s112_kellerbehandlung_sammel(uuid, jsonb, jsonb)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END
$test$;
