-- @bereich: Stoffkonto im Kellerbuch (besondere Konten, KAN-107)
-- @ziel: Buchungen sind append-only (kein Ändern, kein Löschen per API), das Vorzeichen passt zur Art (Zugang positiv,
-- @ziel: Verwendung negativ), Storno nur einmal je Buchung, Benutzer stempelt die Datenbank; ein Stoff mit Buchungen ist
-- @ziel: nicht löschbar (nur deaktivieren).
-- @mutation ohne_vorzeichen: CHECK kellermittel_buchungen_vorzeichen entfernt | rot: vorzeichen_.*
-- @mutation update_erlaubt: UPDATE für authenticated freigegeben | rot: kein_update
-- @mutation ohne_stempel: Trigger a_stempel entfernt | rot: stempel_benutzer
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 59 (Stand 07.10.2026, KAN-107). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '59_stoffkonto';
  c_ins   constant text := 'INSERT INTO public.kellermittel_buchungen (tenant_id, kellermittel_id, datum, art, menge, storno_von_id, erstellt_von_name) VALUES (%L, %L, %L, %L, %s, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_km    uuid;
  v_bu    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  INSERT INTO public.kellermittel (tenant_id, name, einheit) VALUES (v_b, 'S112TEST Saccharose', 'kg') RETURNING id INTO v_km;

  PERFORM pg_temp.s112_mutiere('ohne_vorzeichen', $m$ALTER TABLE public.kellermittel_buchungen DROP CONSTRAINT kellermittel_buchungen_vorzeichen$m$);
  PERFORM pg_temp.s112_mutiere('update_erlaubt', $m$GRANT UPDATE ON public.kellermittel_buchungen TO authenticated;
    CREATE POLICY s112test_upd ON public.kellermittel_buchungen FOR UPDATE TO authenticated USING (true) WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_stempel', $m$DROP TRIGGER a_stempel ON public.kellermittel_buchungen$m$);

  -- ── 1. Winzer bucht Zugang, Verwendung; Vorzeichen geprüft ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zugang_ok',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, v_heute, 'zugang', '25', NULL, 'gefälscht')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('vorzeichen_zugang_negativ',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, v_heute, 'zugang', '-5', NULL, NULL)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('vorzeichen_verwendung_positiv',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, v_heute, 'verwendung', '5', NULL, NULL)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('verwendung_ok',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, v_heute, 'verwendung', '-3.5', NULL, NULL)), 'ok');

  -- ── 2. Stempel und append-only ────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_bu FROM public.kellermittel_buchungen WHERE kellermittel_id = v_km AND art = 'zugang';
  v_erg := v_erg || pg_temp.s112_erwarte('stempel_benutzer',
    (SELECT erstellt_von = v_bw AND coalesce(erstellt_von_name, '') <> 'gefälscht' FROM public.kellermittel_buchungen WHERE id = v_bu), true);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kein_update',
    pg_temp.s112_versuch(format('UPDATE public.kellermittel_buchungen SET menge = 30 WHERE id = %L', v_bu)) <> 'k1', true);
  v_erg := v_erg || pg_temp.s112_erwarte('kein_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.kellermittel_buchungen WHERE id = %L', v_bu)) <> 'k1', true);

  -- ── 3. Storno einmal ──────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, v_heute, 'storno', '-25', v_bu, NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_zweimal',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, v_heute, 'storno', '-25', v_bu, NULL)), ':', 1), '23505');

  -- ── 4. Stoff mit Buchungen nicht löschbar ─────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('stoff_nicht_loeschbar',
    pg_temp.s112_versuch(format('DELETE FROM public.kellermittel WHERE id = %L', v_km)) <> 'k1', true);

  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 10);
END $test$;
