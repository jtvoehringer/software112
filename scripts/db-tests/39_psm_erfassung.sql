-- @bereich: Pflanzenschutz-Aufzeichnung – erfasst am/von, Anwender (KAN-87)
-- @ziel: Legt ein Benutzer eine Maßnahme an, setzt die Datenbank created_at = now() und erfasst_von = Benutzer (kein
-- @ziel: Rückdatieren über die API); danach sind beide unveränderlich (42501, HINT erfassung). Der Anwender
-- @ziel: (durchgefuehrt_von) muss Mitglied des Betriebs sein, Fremdanwender nur als Name; Uhrzeiten plausibel.
-- @mutation erfassung_frei: kein Trigger b_erfassung auf behandlungen | rot: erfasst_.*|gesperrt_.*|anwender_fremd_betrieb
-- @mutation uhrzeit_frei: kein CHECK behandlungen_uhrzeit_chk | rot: uhrzeit_verkehrt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 39 (Stand 05.10.2026, KAN-87). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '39_psm_erfassung';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_mw    uuid;
  v_id    uuid := gen_random_uuid();
  v_txt   text;
  v_row   record;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('erfassung_frei', $m$DROP TRIGGER b_erfassung ON public.behandlungen$m$);
  PERFORM pg_temp.s112_mutiere('uhrzeit_frei', $m$ALTER TABLE public.behandlungen DROP CONSTRAINT behandlungen_uhrzeit_chk$m$);

  PERFORM pg_temp.s112_als(v_bw);
  -- ── 1. Anlegen: rückdatiertes created_at und fremdes erfasst_von werden überschrieben ──────────────────
  v_txt := pg_temp.s112_fehlertext(format(
    $s$INSERT INTO public.behandlungen (id, tenant_id, art, datum, uhrzeit_von, uhrzeit_bis, art_verwendung, durchgefuehrt_von, created_at, erfasst_von, notizen)
       VALUES (%L, %L, 'spritzung', current_date - 3, '06:30', '09:00', 'freiland', %L, now() - interval '5 days', %L, 'S112TEST')$s$,
    v_id, v_b, v_bta, v_bta));
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen', v_txt, 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT created_at, erfasst_von INTO v_row FROM public.behandlungen WHERE id = v_id;
  v_erg := v_erg || pg_temp.s112_erwarte('erfasst_am_jetzt', v_row.created_at > now() - interval '1 hour', true);
  v_erg := v_erg || pg_temp.s112_erwarte('erfasst_von_benutzer', v_row.erfasst_von = v_bw, true);

  PERFORM pg_temp.s112_als(v_bw);
  -- ── 2. erfasst am/von unveränderlich, andere Felder änderbar ───────────────────────────────────────────
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET created_at = created_at - interval %L WHERE id = %L', '2 days', v_id));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_erfasst_am', v_txt LIKE '42501:%HINT: erfassung', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_erfasst_von',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET erfasst_von = %L WHERE id = %L', v_bta, v_id)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_notizen',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET notizen = %L, uhrzeit_von = %L WHERE id = %L', 'S112TEST 2', '07:00', v_id)), 'k1');

  -- ── 3. Anwender: Mitglied ja, fremder Betrieb nein, Fremdanwender nur als Name ─────────────────────────
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET durchgefuehrt_von = %L WHERE id = %L', v_mw, v_id));
  v_erg := v_erg || pg_temp.s112_erwarte('anwender_fremd_betrieb', v_txt LIKE '42501:%HINT: anwender', true);
  v_erg := v_erg || pg_temp.s112_erwarte('anwender_name_und_id',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET anwender_name = %L WHERE id = %L', 'Lohnunternehmer Huber', v_id)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('anwender_fremdname',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET durchgefuehrt_von = NULL, anwender_name = %L WHERE id = %L', 'Lohnunternehmer Huber', v_id)), 'k1');

  -- ── 4. Uhrzeiten und Art der Verwendung ───────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('uhrzeit_verkehrt',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET uhrzeit_von = %L, uhrzeit_bis = %L WHERE id = %L', '10:00', '08:00', v_id)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('uhrzeit_mehrtaegig',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET datum_bis = datum + 1, uhrzeit_von = %L, uhrzeit_bis = %L WHERE id = %L', '18:00', '08:00', v_id)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('art_verwendung_unbekannt',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET art_verwendung = %L WHERE id = %L', 'luftfahrzeug', v_id)), 'E23514');

  -- ── 5. Frist je Betrieb: lesbar, Benutzer schreiben sie nicht direkt ──────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('frist_lesbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L AND psm_erfassungsfrist_h = 24', v_b)), '1');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('frist_nicht_direkt',
    left(pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET psm_erfassungsfrist_h = 48 WHERE tenant_id = %L', v_b)), 1) <> 'k', true);

  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 14);
END $test$;
