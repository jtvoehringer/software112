-- @bereich: Bienenschutz-Bestätigung an der Maßnahme (KAN-325), PSM-/Dünger-Einkauf mit E/A-Ausgabe (KAN-326)
-- @ziel: Die Bestätigung setzt Zeitpunkt, Benutzer und Name die Datenbank (a0_bienenschutz); beim Bearbeiten bleibt die
-- @ziel: erste Bestätigung, „von“ lässt sich nicht fälschen, NULL hebt sie auf. s112_lager_einkauf legt als winzer
-- @ziel: Lagerbuchung (PSM bzw. Dünger) und E/A-Ausgabe in einer Transaktion an; ohne E&A, ohne Schreibmodul ea und als
-- @ziel: Leser abgelehnt. Direkt angelegte Einkäufe mit Betrag/Ausgabe → 42501 (a_lager_einkauf), direkter Storno eines
-- @ziel: Einkaufs mit Ausgabe → 42501; s112_lager_einkauf_stornieren storniert Lagerbuchung und Ausgabe (Gegenbuchung).
-- @ziel: „Einkauf / Zugang“ ohne Ausgabe bleibt direkt buchbar und stornierbar.
-- @mutation ohne_schutz: Trigger a_lager_einkauf auf psm_lager_bewegungen entfernt | rot: direkt_.*
-- @mutation bienen_von_frei: Trigger a0_bienenschutz entfernt | rot: bienen_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 80 (Stand 11.10.2026, KAN-325/KAN-326).
-- Personas aus s112_aufbau (Betrieb B mit b_w, b_ta, b_l) und ein Winzer nur mit Modul rieden – alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '80_bienenschutz_psm_einkauf';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
  v_bwr   uuid;   -- winzer nur mit Schreibmodul rieden
  v_kat   uuid;
  v_psm   uuid;
  v_dm    uuid;
  v_fi    uuid;
  v_mn    uuid;   -- Maßnahme
  v_id    uuid;   -- PSM-Einkauf
  v_idd   uuid;   -- Dünger-Einkauf
  v_ea    uuid;
  v_zug   uuid;   -- „Einkauf / Zugang“ ohne Ausgabe
  v_ein   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bwr := pg_temp.s112_benutzer('winzer', v_b, ARRAY['rieden']);
  UPDATE public.tenant_einstellungen SET modul_ea = true, buchhaltungsart = 'ea' WHERE tenant_id = v_b;
  SELECT k.id INTO v_kat FROM public.ea_kategorien k WHERE k.tenant_id IS NULL AND k.typ = 'ausgabe' AND k.aktiv ORDER BY k.id LIMIT 1;
  v_psm := (pg_temp.s112_beispiel('pflanzenschutzmittel', v_b, v_bw, '{"name": "S112TEST Netzschwefel"}') ->> 'id')::uuid;
  v_dm := (pg_temp.s112_beispiel('duengemittel', v_b, v_bw, '{"name": "S112TEST Kompost"}') ->> 'id')::uuid;
  v_fi := (pg_temp.s112_zeile('firmen', v_b, '{"name": "S112TEST Lieferant"}') ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_kategorie_vorhanden', v_kat IS NOT NULL, true);
  v_ein := format('SELECT public.s112_lager_einkauf(%L, %L, %L, pg_temp.s112_heute(), 10, %L, 89.90, 20, %L, %L, %L)',
                  v_b, 'psm', v_psm, 'kg', v_fi, v_kat, 'S112TEST PSM-Einkauf');

  -- ── Mutationen ───────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('ohne_schutz', 'DROP TRIGGER a_lager_einkauf ON public.psm_lager_bewegungen');
  PERFORM pg_temp.s112_mutiere('bienen_von_frei', 'DROP TRIGGER a0_bienenschutz ON public.behandlungen');

  -- ── 1. KAN-325: Bienenschutz-Bestätigung ─────────────────────────────────────────────────────────────
  -- angelegt als postgres (ohne Benutzer): Zeitpunkt der DB, kein Benutzer – „von“ aus dem Datensatz zählt nicht
  v_mn := (pg_temp.s112_beispiel('behandlungen', v_b, v_bw,
    jsonb_build_object('psm_id', v_psm, 'bienenschutz_bestaetigt_am', '2000-01-01T00:00:00Z', 'bienenschutz_bestaetigt_von', v_bl)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_anlegen_ohne_benutzer',
    (SELECT (b.bienenschutz_bestaetigt_von IS NULL)::text || '/' || (b.bienenschutz_bestaetigt_am > now() - interval '1 hour')::text
       FROM public.behandlungen b WHERE b.id = v_mn), 'true/true');
  UPDATE public.behandlungen SET bienenschutz_bestaetigt_am = NULL WHERE id = v_mn;
  -- als winzer bestätigt (s112_fehlertext: Änderung bleibt; s112_versuch rollt zurück): Zeitpunkt, Benutzer, Name setzt die DB
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_bestaetigen',
    pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET bienenschutz_bestaetigt_am = %L, bienenschutz_bestaetigt_von = %L WHERE id = %L',
      '2000-01-01T00:00:00Z', v_bl, v_mn)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_anlegen_von_db',
    (SELECT (b.bienenschutz_bestaetigt_von = v_bw)::text || '/' || (b.bienenschutz_bestaetigt_am > now() - interval '1 hour')::text
              || '/' || (b.bienenschutz_bestaetigt_von_name IS NOT NULL)::text
       FROM public.behandlungen b WHERE b.id = v_mn), 'true/true/true');
  -- Bearbeiten (Betriebsleitung) mit neuem Zeitpunkt und fremdem „von“: die erste Bestätigung bleibt
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_bearbeiten',
    pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET bienenschutz_bestaetigt_am = now(), bienenschutz_bestaetigt_von = %L, bienenschutz_bestaetigt_von_name = %L WHERE id = %L',
      v_bl, 'S112TEST gefälscht', v_mn)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_bleibt_beim_bearbeiten',
    (SELECT (b.bienenschutz_bestaetigt_von = v_bw)::text || '/' || (b.bienenschutz_bestaetigt_von_name <> 'S112TEST gefälscht')::text
       FROM public.behandlungen b WHERE b.id = v_mn), 'true/true');
  -- Aufheben (nicht mehr bienenrelevant): Zeitpunkt NULL räumt Benutzer und Name mit
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_aufheben',
    pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET bienenschutz_bestaetigt_am = NULL WHERE id = %L', v_mn)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_aufgehoben',
    (SELECT (b.bienenschutz_bestaetigt_am IS NULL AND b.bienenschutz_bestaetigt_von IS NULL AND b.bienenschutz_bestaetigt_von_name IS NULL)::text
       FROM public.behandlungen b WHERE b.id = v_mn), 'true');
  -- „von“ ohne Zeitpunkt setzen wirkt nicht
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_von_setzen',
    pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET bienenschutz_bestaetigt_von = %L WHERE id = %L', v_bl, v_mn)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bienen_von_ohne_zeitpunkt',
    (SELECT (b.bienenschutz_bestaetigt_von IS NULL)::text FROM public.behandlungen b WHERE b.id = v_mn), 'true');

  -- ── 2. KAN-326: PSM-Einkauf als winzer ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_psm_winzer',
    pg_temp.s112_fehlertext(format('SELECT set_config(%L, (%s)::text, true)', 's112.t80_id', v_ein)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_id := nullif(current_setting('s112.t80_id', true), '')::uuid;
  SELECT l.ea_transaktion_id INTO v_ea FROM public.psm_lager_bewegungen l WHERE l.id = v_id;
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_psm_lagerbuchung',
    (SELECT l.typ || '/' || l.menge::numeric(10,1) || '/' || l.einheit || '/' || l.betrag_netto || '/' || l.ust_satz || '/' || (l.lieferant_firma_id = v_fi)
       FROM public.psm_lager_bewegungen l WHERE l.id = v_id AND l.tenant_id = v_b AND l.psm_id = v_psm),
    'einkauf/10.0/kg/89.90/20.0/true');
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_psm_ausgabe',
    (SELECT e.typ || '/' || e.import_quelle || '/' || e.betrag_netto || '/' || (e.kategorie_id = v_kat) || '/' || (e.firma_id = v_fi)
       FROM public.ea_transaktionen e WHERE e.id = v_ea AND e.tenant_id = v_b AND e.storniert_am IS NULL),
    'ausgabe/betriebsmittel/89.90/true/true');

  -- Dünger
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_duenger_winzer',
    pg_temp.s112_fehlertext(format('SELECT set_config(%L, public.s112_lager_einkauf(%L, %L, %L, pg_temp.s112_heute(), 500, %L, 120, 13, NULL, %L, NULL)::text, true)',
      's112.t80_idd', v_b, 'duenger', v_dm, 'kg', v_kat)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_idd := nullif(current_setting('s112.t80_idd', true), '')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_duenger_lagerbuchung',
    (SELECT l.typ || '/' || l.menge::numeric(10,1) || '/' || (l.ea_transaktion_id IS NOT NULL)::text
       FROM public.duengemittel_lager_bewegungen l WHERE l.id = v_idd AND l.tenant_id = v_b), 'einkauf/500.0/true');

  -- ── 3. Ablehnungen ───────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bwr);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_ohne_modul_ea', pg_temp.s112_versuch(v_ein), 'T');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_leser', pg_temp.s112_versuch(v_ein), 'T');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_ea = false, modul_sumup = false WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_ohne_ea', pg_temp.s112_versuch(v_ein), 'T');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_ea = true WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_art_unbekannt',
    pg_temp.s112_versuch(format('SELECT public.s112_lager_einkauf(%L, %L, %L, pg_temp.s112_heute(), 1, %L, 1, 20, NULL, %L, NULL)', v_b, 'saatgut', v_psm, 'kg', v_kat)), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_menge_null',
    pg_temp.s112_versuch(format('SELECT public.s112_lager_einkauf(%L, %L, %L, pg_temp.s112_heute(), 0, %L, 1, 20, NULL, %L, NULL)', v_b, 'psm', v_psm, 'kg', v_kat)), 'E22023');

  -- ── 4. Direkt per Tabelle: Einkauf mit Betrag → 42501, Zugang ohne Ausgabe → k1, Storno eines Einkaufs mit Ausgabe → 42501 ─
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_einkauf_mit_betrag',
    pg_temp.s112_versuch(format('INSERT INTO public.psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit, betrag_netto, ust_satz) VALUES (%L, %L, pg_temp.s112_heute(), %L, 1, %L, 1, 20)',
      v_b, v_psm, 'einkauf', 'kg')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_einkauf_mit_ausgabe',
    pg_temp.s112_versuch(format('INSERT INTO public.psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit, ea_transaktion_id) VALUES (%L, %L, pg_temp.s112_heute(), %L, 1, %L, %L)',
      v_b, v_psm, 'einkauf', 'kg', v_ea)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_zugang_ohne_ausgabe',
    pg_temp.s112_fehlertext(format('WITH x AS (INSERT INTO public.psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit) VALUES (%L, %L, pg_temp.s112_heute(), %L, 2, %L) RETURNING id) SELECT set_config(%L, (SELECT id FROM x)::text, true)',
      v_b, v_psm, 'einkauf', 'kg', 's112.t80_zug')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_storno_einkauf_mit_ausgabe',
    pg_temp.s112_versuch(format('UPDATE public.psm_lager_bewegungen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST direkter Storno', v_id)), 'T');
  PERFORM pg_temp.s112_als_postgres();
  v_zug := nullif(current_setting('s112.t80_zug', true), '')::uuid;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_storno_zugang_ohne_ausgabe',
    pg_temp.s112_versuch(format('UPDATE public.psm_lager_bewegungen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno Zugang', v_zug)), 'k1');

  -- ── 5. Storno über die RPC: Lagerbuchung und Ausgabe, Gegenbuchung ───────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_leser',
    pg_temp.s112_versuch(format('SELECT public.s112_lager_einkauf_stornieren(%L, %L, %L, %L)', v_b, 'psm', v_id, 'S112TEST Storno Leser')), 'T');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_kurzer_grund',
    pg_temp.s112_versuch(format('SELECT public.s112_lager_einkauf_stornieren(%L, %L, %L, %L)', v_b, 'psm', v_id, 'kurz')), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_einkauf',
    pg_temp.s112_fehlertext(format('SELECT public.s112_lager_einkauf_stornieren(%L, %L, %L, %L)', v_b, 'psm', v_id, 'S112TEST Storno Einkauf')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_doppelt',
    pg_temp.s112_versuch(format('SELECT public.s112_lager_einkauf_stornieren(%L, %L, %L, %L)', v_b, 'psm', v_id, 'S112TEST Storno Einkauf')), 'T');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_lagerbuchung',
    (SELECT (l.storniert_am IS NOT NULL)::text || '/' || l.storno_grund || '/' || (l.storniert_von = v_bw)::text
       FROM public.psm_lager_bewegungen l WHERE l.id = v_id), 'true/S112TEST Storno Einkauf/true');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ausgabe',
    (SELECT (e.storniert_am IS NOT NULL)::text FROM public.ea_transaktionen e WHERE e.id = v_ea), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_gegenbuchung',
    (SELECT count(*)::text || '/' || coalesce(min(e.betrag_netto)::text, '-')
       FROM public.ea_transaktionen e WHERE e.storno_von_id = v_ea AND e.tenant_id = v_b), '1/-89.90');
  -- Dünger-Storno über die RPC
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_duenger',
    pg_temp.s112_fehlertext(format('SELECT public.s112_lager_einkauf_stornieren(%L, %L, %L, %L)', v_b, 'duenger', v_idd, 'S112TEST Storno Dünger')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_duenger_ausgabe',
    (SELECT (e.storniert_am IS NOT NULL)::text FROM public.duengemittel_lager_bewegungen l JOIN public.ea_transaktionen e ON e.id = l.ea_transaktion_id
      WHERE l.id = v_idd AND l.storniert_am IS NOT NULL), 'true');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 25);
END $test$;
