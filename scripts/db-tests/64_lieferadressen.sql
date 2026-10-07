-- @bereich: Lieferadressen (KAN-176)
-- @ziel: Lieferadressen gehören genau einem Kontakt oder einer Firma des eigenen Betriebs, Leser schreiben nicht,
-- @ziel: gelöscht wird nicht (nur deaktiviert); der Verkauf hält die Lieferadresse als Momentaufnahme (CHECK auf Straße/Ort)
-- @ziel: und verweist nie auf die Lieferadresse eines fremden Betriebs.
-- @mutation ohne_ein_partner: CHECK lieferadressen_ein_partner entfernt | rot: zwei_partner
-- @mutation ohne_fremdverweis: Prüf-Trigger z_fremdverweis_lieferadresse_id entfernt | rot: vp_fremde_adresse
-- @mutation loeschen_erlaubt: DELETE für authenticated freigegeben | rot: kein_loeschen
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 64 (Stand 07.10.2026, KAN-176). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '64_lieferadressen';
  c_ins   constant text := 'INSERT INTO public.lieferadressen (tenant_id, kontakt_id, firma_id, strasse, plz, ort) VALUES (%L, %L, %L, %L, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_kb    uuid;
  v_fb    uuid;
  v_km    uuid;
  v_lam   uuid;
  v_la    uuid;
  v_vp    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_kb := (pg_temp.s112_zeile('kontakte', v_b) ->> 'id')::uuid;
  v_fb := (pg_temp.s112_zeile('firmen', v_b, '{"name": "S112TEST Lieferfirma"}') ->> 'id')::uuid;
  v_km := (pg_temp.s112_zeile('kontakte', v_m) ->> 'id')::uuid;
  v_lam := (pg_temp.s112_beispiel('lieferadressen', v_m, NULL, jsonb_build_object('kontakt_id', v_km)) ->> 'id')::uuid;
  v_vp := (pg_temp.s112_beispiel('verkaufsposten', v_b, NULL, jsonb_build_object('kontakt_id', v_kb, 'firma_id', NULL)) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_ein_partner', $m$ALTER TABLE public.lieferadressen DROP CONSTRAINT lieferadressen_ein_partner$m$);
  PERFORM pg_temp.s112_mutiere('ohne_fremdverweis', $m$DROP TRIGGER z_fremdverweis_lieferadresse_id ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('loeschen_erlaubt', $m$GRANT DELETE ON public.lieferadressen TO authenticated;
    CREATE POLICY s112test_del ON public.lieferadressen FOR DELETE TO authenticated USING (true)$m$);

  -- ── 1. Anlegen als Mitarbeiter, Regeln der Zeile ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_ok',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 'Lagerweg 3', '3500', 'Krems')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('firma_ok',
    pg_temp.s112_fehlertext(format(c_ins, v_b, NULL, v_fb, 'Hafenstraße 1', '1020', 'Wien')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zwei_partner',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, v_fb, 'Doppelgasse 1', '1010', 'Wien')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_partner',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, NULL, NULL, 'Leergasse 1', '1010', 'Wien')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_kontakt',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, NULL, 'Fremdgasse 1', '1010', 'Wien')) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_adresse_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.lieferadressen WHERE id = %L', v_lam)), '0');

  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_la FROM public.lieferadressen WHERE kontakt_id = v_kb;

  -- ── 2. Nur deaktivieren, nie löschen; Leser schreiben nicht ─────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('deaktivieren_ok',
    pg_temp.s112_fehlertext(format('UPDATE public.lieferadressen SET aktiv = false WHERE id = %L', v_la)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kein_loeschen',
    split_part(pg_temp.s112_fehlertext(format('DELETE FROM public.lieferadressen WHERE id = %L', v_la)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_kein_anlegen',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 'Lesergasse 1', '1010', 'Wien')), ':', 1), '42501');

  -- ── 3. Verkauf: Momentaufnahme und Verweis ──────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('vp_moment_ok',
    pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET lieferadresse = %L::jsonb, lieferadresse_id = %L WHERE id = %L',
      '{"strasse": "Lagerweg 3", "plz": "3500", "ort": "Krems", "land": "AT"}', v_la, v_vp)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('vp_moment_ohne_ort',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET lieferadresse = %L::jsonb WHERE id = %L',
      '{"strasse": "Lagerweg 3", "plz": "3500"}', v_vp)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('vp_fremde_adresse',
    pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET lieferadresse_id = %L WHERE id = %L', v_lam, v_vp)) <> 'ok', true);
  UPDATE public.lieferadressen SET ort = 'Stein' WHERE id = v_la;
  v_erg := v_erg || pg_temp.s112_erwarte('moment_bleibt',
    (SELECT lieferadresse ->> 'ort' FROM public.verkaufsposten WHERE id = v_vp), 'Krems');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 13);
END $test$;
