-- @bereich: Verkauf – gelernte Begriffe aus Bestell-Mails (KAN-411 Teil 2)
-- @ziel: Ein Mitarbeiter mit Schreibrecht Warenwirtschaft merkt je Kunde und Begriff die gewählte Füllung, ändert und
-- @ziel: löscht sie. Leser und Mitarbeiter ohne Warenwirtschaft schreiben nicht, fremde Zeilen sind unsichtbar; Kunde und
-- @ziel: Füllung müssen aus dem eigenen Betrieb stammen, höchstens ein Kunde je Zeile, Begriff 2 bis 120 Zeichen.
-- @mutation ohne_fremdverweis: Prüf-Trigger z_fremdverweis_fuellung_id entfernt | rot: fremde_fuellung
-- @mutation ohne_modul: RESTRICTIVE modul_insert entfernt | rot: ohne_modul_merken
-- @mutation ohne_begriff_check: CHECK verkauf_ki_begriffe_begriff_chk entfernt | rot: begriff_zu_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 93 (Stand 11.11.2026, KAN-411). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '93_verkauf_ki_begriffe';
  c_ins   constant text := 'INSERT INTO public.verkauf_ki_begriffe (tenant_id, kontakt_id, firma_id, begriff, fuellung_id) VALUES (%L, %L, %L, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_kb    uuid;   -- Kontakt in B
  v_fb    uuid;   -- Firma in B
  v_fue   uuid;   -- Füllung in B
  v_fue2  uuid;
  v_fuem  uuid;   -- Füllung in M
  v_km    uuid;   -- Kontakt in M
  v_z     uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Warenwirtschaft
  v_kb := (pg_temp.s112_zeile('kontakte', v_b) ->> 'id')::uuid;
  v_fb := (pg_temp.s112_zeile('firmen', v_b) ->> 'id')::uuid;
  v_fue := (pg_temp.s112_zeile('fuellungen', v_b) ->> 'id')::uuid;
  v_fue2 := (pg_temp.s112_zeile('fuellungen', v_b) ->> 'id')::uuid;
  v_fuem := (pg_temp.s112_zeile('fuellungen', v_m) ->> 'id')::uuid;
  v_km := (pg_temp.s112_zeile('kontakte', v_m) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_fremdverweis',
    $m$DROP TRIGGER z_fremdverweis_fuellung_id ON public.verkauf_ki_begriffe$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modul',
    $m$DROP POLICY modul_insert ON public.verkauf_ki_begriffe$m$);
  PERFORM pg_temp.s112_mutiere('ohne_begriff_check',
    $m$ALTER TABLE public.verkauf_ki_begriffe DROP CONSTRAINT verkauf_ki_begriffe_begriff_chk$m$);

  -- ── 1. Merken, ändern, löschen als Mitarbeiter mit Warenwirtschaft ──────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('merken_kontakt',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 's112test gv klassik', v_fue)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('merken_firma',
    pg_temp.s112_fehlertext(format(c_ins, v_b, NULL, v_fb, 's112test zweigelt', v_fue)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('erstellt_von',
    (SELECT bool_and(erstellt_von = v_bw AND anzahl = 1)::text FROM public.verkauf_ki_begriffe WHERE tenant_id = v_b AND begriff LIKE 's112test%'), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_ok',
    pg_temp.s112_versuch(format('UPDATE public.verkauf_ki_begriffe SET fuellung_id = %L, anzahl = anzahl + 1 WHERE kontakt_id = %L', v_fue2, v_kb)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('zwei_kunden',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, v_fb, 's112test beide', v_fue)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('begriff_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 'x', v_fue)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('begriff_zu_lang',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, repeat('x', 121), v_fue)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_fuellung',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 's112test fremd', v_fuem)) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_kontakt',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_km, NULL, 's112test fremd', v_fue)) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_m, NULL, NULL, 's112test fremd', v_fuem)), ':', 1), '42501');
  SELECT id INTO v_z FROM public.verkauf_ki_begriffe WHERE kontakt_id = v_kb;
  v_erg := v_erg || pg_temp.s112_erwarte('loeschen_ok',
    pg_temp.s112_versuch(format('DELETE FROM public.verkauf_ki_begriffe WHERE firma_id = %L', v_fb)), 'k1');

  -- ── 2. Leser und Mitarbeiter ohne Warenwirtschaft schreiben nicht ────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_liest',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verkauf_ki_begriffe WHERE id = %L', v_z)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_merkt_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 's112test leser', v_fue)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_aendert_nicht',
    pg_temp.s112_versuch(format('UPDATE public.verkauf_ki_begriffe SET anzahl = 99 WHERE id = %L', v_z)), 'k0');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_modul_merken',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_kb, NULL, 's112test ohne modul', v_fue)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_modul_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.verkauf_ki_begriffe WHERE id = %L', v_z)), 'k0');

  -- ── 3. Fremder Betrieb sieht die Zeile nicht ─────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verkauf_ki_begriffe WHERE id = %L', v_z)), '0');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 17);
END $test$;
