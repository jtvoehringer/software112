-- @bereich: Betriebsmittel – Einkauf mit E/A-Ausgabe, Storno, Lösch- und Bezugssperren (KAN-167)
-- @ziel: s112_betriebsmittel_einkauf legt als winzer in EINER Transaktion die E/A-Ausgabe (import_quelle 'betriebsmittel',
-- @ziel: typ 'ausgabe') und die Lagerbuchung (typ 'einkauf') an; ohne aktive E&A-Rechnung, ohne Schreibmodul ea und als
-- @ziel: Leser abgelehnt (42501). Einkäufe direkt per INSERT → RLS (R), Ändern eines Einkaufs → k0, direktes Löschen → k0.
-- @ziel: s112_betriebsmittel_stornieren storniert die Lagerbuchung samt Ausgabe (Gegenbuchung); danach endgültig löschen
-- @ziel: über s112_storniert_loeschen. Maßnahme mit PSM UND Betriebsmittel → CHECK (E23514); Betriebsmittel mit Bezug
-- @ziel: lässt sich nicht löschen (T), ohne Bezug schon.
-- @mutation einkauf_insert_offen: PERMISSIVE-Policy WITH CHECK (true) für INSERT auf betriebsmittel_lager_bewegungen | rot: direkt_einkauf_insert
-- @mutation ohne_ea_pruefung: s112_betriebsmittel_einkauf prüft modul_ea/buchhaltungsart nicht mehr | rot: ohne_ea_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 22 (Stand 01.10.2026, KAN-167).
-- Personas aus s112_aufbau (Betrieb B mit b_w, b_ta, b_l) und ein Winzer nur mit Modul rieden – alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '22_betriebsmittel';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
  v_bwr   uuid;   -- winzer in B nur mit Schreibmodul rieden (ohne ea)
  v_kat   uuid;   -- globale Ausgaben-Kategorie
  v_bm    uuid;   -- Betriebsmittel in B (bekommt Lagerbuchungen = Bezug)
  v_bm2   uuid;   -- Betriebsmittel in B ohne Bezug
  v_fi    uuid;   -- Lieferant (Firma in B)
  v_psm   uuid;
  v_id    uuid;   -- Einkauf (Lagerbuchung)
  v_ea    uuid;   -- E/A-Ausgabe des Einkaufs
  v_r     text;
  v_n     bigint;
  v_ein   text;   -- SQL des Einkaufs (B, v_bm, 5 Stk, 12,50 € netto, 20 %)
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
  v_bm := (pg_temp.s112_beispiel('betriebsmittel', v_b, v_bw, '{"name": "S112TEST Schwefel", "gruppe": "weinbehandlung"}') ->> 'id')::uuid;
  v_bm2 := (pg_temp.s112_beispiel('betriebsmittel', v_b, v_bw, '{"name": "S112TEST Bindedraht", "gruppe": "produktion"}') ->> 'id')::uuid;
  v_fi := (pg_temp.s112_zeile('firmen', v_b, '{"name": "S112TEST Lieferant"}') ->> 'id')::uuid;
  v_psm := (pg_temp.s112_beispiel('pflanzenschutzmittel', v_b, v_bw) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_kategorie_vorhanden', v_kat IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_ea_aktiv',
    (SELECT te.modul_ea AND te.buchhaltungsart = 'ea' FROM public.tenant_einstellungen te WHERE te.tenant_id = v_b), true);
  v_ein := format('SELECT public.s112_betriebsmittel_einkauf(%L, %L, current_date, 5, %L, 12.5, 20, %L, %L, %L)',
                  v_b, v_bm, 'stk', v_fi, v_kat, 'S112TEST Einkauf');

  -- ── Mutationen (nur im Mutationsmodus; nach dem Aufbau, vor den Prüfungen) ──────────────────────────
  PERFORM pg_temp.s112_mutiere('einkauf_insert_offen',
    $m$CREATE POLICY s112test_einkauf_offen ON public.betriebsmittel_lager_bewegungen AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_ea_pruefung',
    replace(pg_get_functiondef('public.s112_betriebsmittel_einkauf(uuid, uuid, date, numeric, text, numeric, numeric, uuid, uuid, text)'::regprocedure),
      $r$AND te.modul_ea AND te.buchhaltungsart = 'ea'$r$, 'OR true'));

  -- ── 1. Einkauf als winzer: Ausgabe und Lagerbuchung ───────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_winzer',
    pg_temp.s112_fehlertext(format('SELECT set_config(%L, (%s)::text, true)', 's112.t22_id', v_ein)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_id := nullif(current_setting('s112.t22_id', true), '')::uuid;
  SELECT l.ea_transaktion_id INTO v_ea FROM public.betriebsmittel_lager_bewegungen l WHERE l.id = v_id;
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_lagerbuchung',
    (SELECT l.typ || '/' || l.menge::numeric(10,1) || '/' || l.einheit || '/' || l.betrag_netto || '/' || l.ust_satz || '/' || (l.lieferant_firma_id = v_fi)
       FROM public.betriebsmittel_lager_bewegungen l WHERE l.id = v_id AND l.tenant_id = v_b AND l.betriebsmittel_id = v_bm),
    'einkauf/5.0/stk/12.50/20.0/true');
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_ausgabe',
    (SELECT e.typ || '/' || e.import_quelle || '/' || e.betrag_netto || '/' || (e.kategorie_id = v_kat) || '/' || (e.firma_id = v_fi)
       FROM public.ea_transaktionen e WHERE e.id = v_ea AND e.tenant_id = v_b AND e.storniert_am IS NULL),
    'ausgabe/betriebsmittel/12.50/true/true');

  -- ── 2. Ablehnungen: ohne E&A, ohne Modul ea, Leser ────────────────────────────────────────────────────
  UPDATE public.tenant_einstellungen SET modul_ea = false, modul_sumup = false WHERE tenant_id = v_b;   -- KAN-195: SumUp verlangt E&A
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_ea_einkauf', pg_temp.s112_versuch(v_ein), 'T');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_ea = true, buchhaltungsart = 'doppik' WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_ea_doppik_einkauf', pg_temp.s112_versuch(v_ein), 'T');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET buchhaltungsart = 'ea' WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bwr);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_winzer_ohne_modul_ea', pg_temp.s112_versuch(v_ein), 'T');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_leser', pg_temp.s112_versuch(v_ein), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('stornieren_leser',
    pg_temp.s112_versuch(format('SELECT public.s112_betriebsmittel_stornieren(%L, %L, %L)', v_b, v_id, 'S112TEST Storno Leser')), 'T');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_positivkontrolle', pg_temp.s112_versuch(v_ein), 'k1');
  -- Eingaben: Menge 0 und unbekannte Einheit → 22023
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_menge_null',
    pg_temp.s112_versuch(format('SELECT public.s112_betriebsmittel_einkauf(%L, %L, current_date, 0, %L, 1, 20, NULL, %L, NULL)', v_b, v_bm, 'stk', v_kat)), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_einheit_unbekannt',
    pg_temp.s112_versuch(format('SELECT public.s112_betriebsmittel_einkauf(%L, %L, current_date, 1, %L, 1, 20, NULL, %L, NULL)', v_b, v_bm, 'fass', v_kat)), 'E22023');

  -- ── 3. Direkt per Tabelle (als winzer): Einkauf anlegen R, Anfangsbestand k1, Einkauf ändern/löschen k0 ─
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_einkauf_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.betriebsmittel_lager_bewegungen (tenant_id, betriebsmittel_id, datum, typ, menge, einheit, betrag_netto, ust_satz) VALUES (%L, %L, current_date, %L, 1, %L, 1, 20)',
      v_b, v_bm, 'einkauf', 'stk')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_anfangsbestand_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.betriebsmittel_lager_bewegungen (tenant_id, betriebsmittel_id, datum, typ, menge, einheit) VALUES (%L, %L, current_date, %L, 1, %L)',
      v_b, v_bm, 'anfangsbestand', 'stk')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_einkauf_update',
    pg_temp.s112_versuch(format('UPDATE public.betriebsmittel_lager_bewegungen SET notizen = %L WHERE id = %L', 'S112TEST geändert', v_id)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_einkauf_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.betriebsmittel_lager_bewegungen WHERE id = %L', v_id)), 'k0');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_einkauf_delete_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.betriebsmittel_lager_bewegungen WHERE id = %L', v_id)), 'k0');
  -- ── 4. Stammdaten mit Bezug: nicht löschbar (T), ohne Bezug schon (k1) ───────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('stammdaten_mit_bezug_delete_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.betriebsmittel WHERE id = %L', v_bm)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('stammdaten_ohne_bezug_delete_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.betriebsmittel WHERE id = %L', v_bm2)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('stammdaten_bezuege',
    pg_temp.s112_fehlertext(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'betriebsmittel', v_bm)), 'ok');
  PERFORM pg_temp.s112_als(v_bw);
  -- endgültig löschen vor dem Storno → 42501
  v_erg := v_erg || pg_temp.s112_erwarte('loeschen_vor_storno',
    pg_temp.s112_versuch(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_b, 'betriebsmittel_lager_bewegungen', v_id, 'S112TEST endgültig löschen')), 'T');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('einkauf_unveraendert',
    (SELECT (l.notizen = 'S112TEST Einkauf' AND l.storniert_am IS NULL)::text FROM public.betriebsmittel_lager_bewegungen l WHERE l.id = v_id), 'true');

  -- ── 5. Storno des Einkaufs: Lagerbuchung und Ausgabe storniert, Gegenbuchung angelegt ─────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_kurzer_grund',
    pg_temp.s112_versuch(format('SELECT public.s112_betriebsmittel_stornieren(%L, %L, %L)', v_b, v_id, 'kurz')), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_einkauf',
    pg_temp.s112_fehlertext(format('SELECT public.s112_betriebsmittel_stornieren(%L, %L, %L)', v_b, v_id, 'S112TEST Storno Einkauf')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_doppelt',
    pg_temp.s112_versuch(format('SELECT public.s112_betriebsmittel_stornieren(%L, %L, %L)', v_b, v_id, 'S112TEST Storno Einkauf')), 'T');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_lagerbuchung',
    (SELECT (l.storniert_am IS NOT NULL)::text || '/' || l.storno_grund FROM public.betriebsmittel_lager_bewegungen l WHERE l.id = v_id),
    'true/S112TEST Storno Einkauf');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ausgabe',
    (SELECT (e.storniert_am IS NOT NULL)::text FROM public.ea_transaktionen e WHERE e.id = v_ea), 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_gegenbuchung',
    (SELECT count(*)::text || '/' || coalesce(min(e.betrag_netto)::text, '-') || '/' || coalesce(min(e.import_quelle), '-')
       FROM public.ea_transaktionen e WHERE e.storno_von_id = v_ea AND e.tenant_id = v_b), '1/-12.50/betriebsmittel');

  -- ── 6. Endgültig löschen nach dem Storno (Ausgabe und Gegenbuchung bleiben) ───────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('loeschen_nach_storno',
    pg_temp.s112_fehlertext(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_b, 'betriebsmittel_lager_bewegungen', v_id, 'S112TEST endgültig löschen')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('loeschen_zeile_weg',
    (SELECT count(*) FROM public.betriebsmittel_lager_bewegungen WHERE id = v_id), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('loeschen_ausgabe_bleibt',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_ea OR storno_von_id = v_ea), 2::bigint);

  -- ── 7. Maßnahme: PSM und Betriebsmittel zugleich → CHECK; je eines allein geht ───────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('massnahme_psm_und_betriebsmittel',
    pg_temp.s112_versuch(format('SELECT pg_temp.s112_beispiel(%L, %L, %L, %L::jsonb)', 'behandlungen', v_b, v_bw,
      jsonb_build_object('psm_id', v_psm, 'betriebsmittel_id', v_bm))), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('massnahme_nur_betriebsmittel',
    pg_temp.s112_versuch(format('SELECT pg_temp.s112_beispiel(%L, %L, %L, %L::jsonb)', 'behandlungen', v_b, v_bw,
      jsonb_build_object('psm_id', NULL, 'betriebsmittel_id', v_bm))), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('massnahme_nur_psm',
    pg_temp.s112_versuch(format('SELECT pg_temp.s112_beispiel(%L, %L, %L, %L::jsonb)', 'behandlungen', v_b, v_bw,
      jsonb_build_object('psm_id', v_psm, 'betriebsmittel_id', NULL))), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('massnahme_einheit_stk_ha',
    pg_temp.s112_versuch(format('SELECT pg_temp.s112_beispiel(%L, %L, %L, %L::jsonb)', 'behandlungen', v_b, v_bw,
      jsonb_build_object('betriebsmittel_id', v_bm, 'aufwandmenge_einheit', 'stk_ha', 'menge_einheit', 'm'))), 'k1');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 30);
END $test$;
