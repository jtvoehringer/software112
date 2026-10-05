-- @bereich: Charge – Sperre ab Prüfnummernantrag „Eingereicht“ (KAN-204)
-- @ziel: Solange ein Antrag der Charge eingereicht bzw. in Prüfung ist, lehnt die Datenbank Änderungen an Merkmalen
-- @ziel: (Jahrgang, Rebsorte, Weinart, Qualität, Herkunft, Mostgewicht) mit 42501 (HINT freeze) ab; Bestand, Gebinde,
-- @ziel: Status, Bezeichnung und Notizen bleiben änderbar. Ohne Antrag bzw. nach dem Bescheid ist die Charge frei; die
-- @ziel: Betriebsleitung korrigiert über s112_freeze_korrektur.
-- @mutation freeze_aus: kein Freeze-Trigger auf weinausbau | rot: gesperrt_.*
-- @mutation merkmale_frei: Positivliste enthält die Merkmale | rot: gesperrt_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 34 (Stand 05.10.2026, KAN-204). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '34_charge_freeze';
  c_rpc   constant text := 'SELECT public.s112_pruefnummernantrag_status_setzen(%L::uuid, %L::uuid, %L, %L::date, %L, %L)';
  c_upd   constant text := 'UPDATE public.weinausbau SET %s WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_wa    uuid;
  v_wb    uuid;
  v_d     uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "1000", "qualitaetsstufe": "qualitaetswein", "jahrgang": "2025", "rebsorte": "S112TEST Veltliner"}') ->> 'id')::uuid;
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "qualitaetsstufe": "qualitaetswein", "jahrgang": "2025"}') ->> 'id')::uuid;
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 1000)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_aus', $m$DROP TRIGGER a_freeze ON public.weinausbau$m$);
  PERFORM pg_temp.s112_mutiere('merkmale_frei', $m$DROP TRIGGER a_freeze ON public.weinausbau;
    CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.weinausbau FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Prüfnummernantrag eingereicht',
      'o.storniert_am IS NULL AND EXISTS (SELECT 1 FROM public.dac_antrag d WHERE d.weinausbau_id = o.id AND d.storniert_am IS NULL AND d.status IN (''eingereicht'', ''in_pruefung''))',
      'name,behaelter_id,menge_liter,status,aktiv,notizen,einstandspreis_pro_liter,updated_at,jahrgang,rebsorte,qualitaetsstufe,weinart,kmw,oechsle,mostgewicht_einheit', '')$m$);

  -- ── 1. Entwurf: Charge frei ───────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_entwurf',
    pg_temp.s112_versuch(format(c_upd, 'jahrgang = 2024', v_wa)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', current_date - 2, NULL, NULL)), 'ok');

  -- ── 2. Eingereicht: Merkmale gesperrt, Betrieb läuft weiter ──────────────────────────────────────────
  v_txt := pg_temp.s112_fehlertext(format(c_upd, 'jahrgang = 2023', v_wa));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_jahrgang',
    v_txt LIKE '42501: Gesperrt: Prüfnummernantrag eingereicht – änderbar sind nur % (nicht: jahrgang).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_rebsorte',
    pg_temp.s112_versuch(format(c_upd, format('rebsorte = %L', 'S112TEST Riesling'), v_wa)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_qualitaet',
    pg_temp.s112_versuch(format(c_upd, format('qualitaetsstufe = %L', 'wein'), v_wa)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_weinart',
    pg_temp.s112_versuch(format(c_upd, format('weinart = %L', 'rot'), v_wa)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_mostgewicht',
    pg_temp.s112_versuch(format(c_upd, 'kmw = 19.5', v_wa)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_bestand_notizen',
    pg_temp.s112_versuch(format(c_upd, format('menge_liter = 990, notizen = %L, name = %L', 'S112TEST Notiz', 'S112TEST Charge'), v_wa)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_ohne_antrag',
    pg_temp.s112_versuch(format(c_upd, 'jahrgang = 2024', v_wb)), 'k1');

  -- ── 3. Korrektur durch die Betriebsleitung ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_betriebsleitung',
    pg_temp.s112_fehlertext(format('SELECT public.s112_freeze_korrektur(%L, %L, %L, %L::jsonb, %L)',
      v_b, 'weinausbau', v_wa, '{"rebsorte": "S112TEST Grüner Veltliner"}', 'S112TEST Tippfehler Sorte')), 'ok');

  -- ── 4. Nach dem Bescheid: DB-Sperre endet ─────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('zuteilen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', current_date - 1, 'N 34/26', NULL)), 'ok');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_nach_bescheid',
    pg_temp.s112_versuch(format(c_upd, format('notizen = %L, weinart = %L', 'S112TEST nach Bescheid', 'weiss'), v_wa)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_wert',
    (SELECT w.rebsorte FROM public.weinausbau w WHERE w.id = v_wa), 'S112TEST Grüner Veltliner');
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 14);
END $test$;
