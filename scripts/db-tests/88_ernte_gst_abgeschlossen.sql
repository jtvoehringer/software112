-- @bereich: Ernte abgeschlossen je Grundstück (KAN-392)
-- @ziel: Ein Mitarbeiter mit Rieden- oder Kellerbuch-Recht schließt die Ernte eines Grundstücks im Jahrgang ab und öffnet
-- @ziel: sie wieder (Zeile löschen); je Jahrgang und Grundstück höchstens eine Zeile. Leser schreiben nicht, fremde Zeilen
-- @ziel: sind unsichtbar, Jahrgang und Grundstück müssen aus dem eigenen Betrieb stammen.
-- @mutation ohne_eindeutig: UNIQUE ernte_gst_abgeschlossen_eindeutig entfernt | rot: doppelt
-- @mutation ohne_fremdverweis: Prüf-Trigger z_fremdverweis_grundstueck_id entfernt | rot: fremdes_gst
-- @mutation ohne_modul: RESTRICTIVE modul_delete entfernt | rot: ohne_modul_oeffnen
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 88 (Stand 01.11.2026, KAN-392). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '88_ernte_gst_abgeschlossen';
  c_ins   constant text := 'INSERT INTO public.ernte_gst_abgeschlossen (tenant_id, jahrgang_id, grundstueck_id) VALUES (%L, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_jb    uuid;
  v_gb    uuid;
  v_gb2   uuid;
  v_gm    uuid;
  v_z     uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Rieden/Kellerbuch
  v_jb := (pg_temp.s112_zeile('weinjahrgaenge', v_b) ->> 'id')::uuid;
  v_gb := (pg_temp.s112_zeile('grundstuecke', v_b) ->> 'id')::uuid;
  v_gb2 := (pg_temp.s112_zeile('grundstuecke', v_b) ->> 'id')::uuid;
  v_gm := (pg_temp.s112_zeile('grundstuecke', v_m) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_eindeutig',
    $m$ALTER TABLE public.ernte_gst_abgeschlossen DROP CONSTRAINT ernte_gst_abgeschlossen_eindeutig$m$);
  PERFORM pg_temp.s112_mutiere('ohne_fremdverweis',
    $m$DROP TRIGGER z_fremdverweis_grundstueck_id ON public.ernte_gst_abgeschlossen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modul',
    $m$DROP POLICY modul_delete ON public.ernte_gst_abgeschlossen$m$);

  -- ── 1. Abschließen und wieder öffnen als Mitarbeiter ────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen_ok',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_jb, v_gb)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('doppelt',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_jb, v_gb)), ':', 1), '23505');
  v_erg := v_erg || pg_temp.s112_erwarte('gesetzt_von',
    (SELECT bool_and(gesetzt_von = v_bw)::text FROM public.ernte_gst_abgeschlossen WHERE grundstueck_id = v_gb), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('fremdes_gst',
    pg_temp.s112_fehlertext(format(c_ins, v_b, v_jb, v_gm)) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('oeffnen_ok',
    pg_temp.s112_versuch(format('DELETE FROM public.ernte_gst_abgeschlossen WHERE grundstueck_id = %L', v_gb)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  EXECUTE format(c_ins, v_b, v_jb, v_gb2);
  SELECT id INTO v_z FROM public.ernte_gst_abgeschlossen WHERE grundstueck_id = v_gb2;

  -- ── 2. Leser und Mitarbeiter ohne Rieden/Kellerbuch schreiben nicht ─────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_liest',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ernte_gst_abgeschlossen WHERE id = %L', v_z)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_kein_abschliessen',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_jb, v_gb)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_kein_oeffnen',
    pg_temp.s112_versuch(format('DELETE FROM public.ernte_gst_abgeschlossen WHERE id = %L', v_z)), 'k0');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_modul_abschliessen',
    split_part(pg_temp.s112_fehlertext(format(c_ins, v_b, v_jb, v_gb)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_modul_oeffnen',
    pg_temp.s112_versuch(format('DELETE FROM public.ernte_gst_abgeschlossen WHERE id = %L', v_z)), 'k0');

  -- ── 3. Fremder Betrieb sieht die Zeile nicht ────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ernte_gst_abgeschlossen WHERE id = %L', v_z)), '0');

  -- ── 4. Mit dem Grundstück fällt die Zeile weg ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);   -- Stammdaten-Löschsperre (KAN-150 F1a) für die Testzeile
  DELETE FROM public.grundstuecke WHERE id = v_gb2;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('kaskade_gst',
    (SELECT count(*)::text FROM public.ernte_gst_abgeschlossen WHERE id = v_z), '0');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 12);
END $test$;
