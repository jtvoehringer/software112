-- @bereich: Bewegungsjournal kellerbuch_buchungen (KAN-40 Etappen E1/E2)
-- @ziel: Ohne journal_ab schreiben die Trigger nichts. journal_eroeffnen nur als Betriebsleitung (tenant_admin/system_admin),
-- @ziel: einmalig, bucht den Ist-Bestand als EROEFF (rekonstruiert). Danach erzeugen Umzug (als winzer, App-Reihenfolge:
-- @ziel: Charge zuerst), Storno und Umstufung die erwarteten Zeilen mit gemeinsamer, lückenloser Belegnummer; journal_konsistenz
-- @ziel: liefert 0 Abweichungen, nach einer direkten Mengenänderung genau eine, die journal_abgleichen als INV_PLUS bucht.
-- @ziel: Benutzer lesen nur das Journal des eigenen Betriebs und schreiben nie direkt (R/T bzw. k0); UPDATE, DELETE und
-- @ziel: TRUNCATE scheitern für jede Rolle (42501), DELETE nur als Wartung mit s112.loeschen_erlaubt = Betrieb.
-- @ziel: E2: Statuswechsel Gärung ↔ Ausbau bucht ein Umstufungspaar mit dem Status als Merkmal; journal_rueckbefuellen
-- @ziel: nur für Musterhof/Sandbox und nie für Benutzer (42501).
-- @mutation journal_offen: Schutz-Trigger lässt alles durch und PERMISSIVE-Policy erlaubt INSERT | rot: direkt_.*|postgres_.*
-- @mutation ohne_umstufung: s112_journal_umstufung bucht nichts | rot: umstufung.*
-- @mutation ohne_gegenbuchung: s112_journal_gegenbuchen bucht nichts | rot: storno.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 23 (Stand 02.10.2026, KAN-40). Betrieb B aus s112_aufbau – alles zurückgerollt.

CREATE FUNCTION pg_temp.t23_zeilen(p_tenant uuid, p_quelle text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant AND (p_quelle IS NULL OR k.quelle_tabelle = p_quelle)
$f$;

DO $test$
DECLARE
  c_datei constant text := '23_journal';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
  v_mta   uuid;
  v_c1    uuid;   -- Charge 500 l
  v_c2    uuid;   -- Charge 100 l
  v_u     uuid := gen_random_uuid();   -- Umzug
  v_j     uuid;   -- eine Journalzeile in B
  v_r     text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_c1 := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Charge 1', 'menge_liter', 500,
    'aktiv', true, 'status', 'ausbau', 'qualitaetsstufe', 'qualitaetswein', 'behaelter_id', NULL, 'storniert_am', NULL,
    'ist_eroeffnungsbestand', false)) ->> 'id')::uuid;
  v_c2 := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, jsonb_build_object('name', 'S112TEST Charge 2', 'menge_liter', 100,
    'aktiv', true, 'status', 'ausbau', 'qualitaetsstufe', 'qualitaetswein', 'behaelter_id', NULL, 'storniert_am', NULL,
    'ist_eroeffnungsbestand', false)) ->> 'id')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = NULL WHERE tenant_id = v_b;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('journal_offen',
    $m$CREATE OR REPLACE FUNCTION public.s112_journal_schutz() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
       BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $x$;
       CREATE POLICY s112test_journal_ins ON public.kellerbuch_buchungen AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_umstufung',
    $m$CREATE OR REPLACE FUNCTION public.s112_journal_umstufung(p_tenant_id uuid, p_bestand text, p_id uuid, p_alt jsonb, p_neu jsonb, p_ohne_quelle text)
       RETURNS void LANGUAGE sql SET search_path = public AS $x$ SELECT $x$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_gegenbuchung',
    $m$CREATE OR REPLACE FUNCTION public.s112_journal_gegenbuchen(p_tenant_id uuid, p_beleg integer, p_datum date, p_quelle_tabelle text, p_quelle_id uuid, p_hinweis text)
       RETURNS integer LANGUAGE sql SET search_path = public AS $x$ SELECT 0 $x$$m$);

  -- ── 1. Journal aus: Bewegungen schreiben nichts ───────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('aus_umzug_winzer',
    pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter - 10 WHERE id = %L', v_c1)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('aus_umzug_zeile',
    pg_temp.s112_fehlertext(format('INSERT INTO public.keller_umzuege (tenant_id, datum, von_weinausbau_id, nach_weinausbau_id, menge_liter, schwund_liter, umzug_typ, zeilen_typ, verschnitt) VALUES (%L, pg_temp.s112_heute(), %L, %L, 10, 0, %L, %L, false)',
      v_b, v_c1, v_c2, 'normal', 'transfer')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('aus_umzug_ziel',
    pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 10 WHERE id = %L', v_c2)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('aus_keine_zeilen', pg_temp.t23_zeilen(v_b), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('aus_konsistenz_leer', (SELECT count(*) FROM public.journal_konsistenz(v_b)), 0::bigint);

  -- ── 2. Eröffnen: Rollen, einmalig, EROEFF des Ist-Bestands ────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_leser', pg_temp.s112_versuch(format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute())', v_b)), 'T');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_winzer', pg_temp.s112_versuch(format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute())', v_b)), 'T');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_fremd', pg_temp.s112_versuch(format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute())', v_b)), 'T');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_zukunft',
    pg_temp.s112_versuch(format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute() + 400)', v_b)), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_ta',
    pg_temp.s112_fehlertext(format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute())', v_b)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_zweimal', pg_temp.s112_versuch(format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute())', v_b)), 'E55000');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_zeilen',
    (SELECT string_agg(format('%s/%s/%s/%s', k.buchungsart_code, k.menge_liter, k.rekonstruiert::text, k.beleg_nr), ',' ORDER BY k.menge_liter)
       FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b AND k.weinausbau_id IN (v_c1, v_c2)),
    'EROEFF/110.000/true/1,EROEFF/490.000/true/1');
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_journal_ab',
    (SELECT e.journal_ab = (now() AT TIME ZONE 'Europe/Vienna')::date FROM public.tenant_einstellungen e WHERE e.tenant_id = v_b), true);
  v_erg := v_erg || pg_temp.s112_erwarte('eroeffnen_konsistent', (SELECT count(*) FROM public.journal_konsistenz(v_b)), 0::bigint);

  -- ── 3. Umzug als winzer (Charge zuerst, dann Bewegung – getrennte Anweisungen wie die App) ──────────────
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter - 52 WHERE id = %L', v_c1));
  v_erg := v_erg || pg_temp.s112_erwarte('umzug_zeile_winzer',
    pg_temp.s112_fehlertext(format('INSERT INTO public.keller_umzuege (id, tenant_id, datum, von_weinausbau_id, nach_weinausbau_id, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, verschnitt) VALUES (%L, %L, pg_temp.s112_heute(), %L, %L, 50, 52, 2, %L, %L, false)',
      v_u, v_b, v_c1, v_c2, 'normal', 'transfer')), 'ok');
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 50 WHERE id = %L', v_c2));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('umzug_journal',
    (SELECT string_agg(format('%s/%s/%s', k.pos, k.buchungsart_code, k.menge_liter), ',' ORDER BY k.pos)
       FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b AND k.quelle_id = v_u),
    '1/UMZUG/-50.000,2/SCHWUND/-2.000,3/UMZUG/50.000');
  v_erg := v_erg || pg_temp.s112_erwarte('umzug_ein_beleg',
    (SELECT count(DISTINCT k.beleg_nr) FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b AND k.quelle_id = v_u), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('umzug_konsistent', (SELECT count(*) FROM public.journal_konsistenz(v_b)), 0::bigint);

  -- ── 4. Storno des Umzugs (Gegenbuchung, Merkmale der Originalzeilen) ──────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_winzer',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno Umzug', v_u)), 'ok');
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 52 WHERE id = %L', v_c1));
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter - 50 WHERE id = %L', v_c2));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_gegenbuchung',
    (SELECT count(*)::text || '/' || sum(k.menge_liter)::text FROM public.kellerbuch_buchungen k
      WHERE k.tenant_id = v_b AND k.quelle_id = v_u AND k.storno_von_id IS NOT NULL), '3/2.000');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_konsistent', (SELECT count(*) FROM public.journal_konsistenz(v_b)), 0::bigint);

  -- ── 5. Umstufung (Qualitätsstufe der Charge 1) über den Journal-Saldo ─────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET qualitaetsstufe = %L WHERE id = %L', 'landwein', v_c1));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('umstufung_paar',
    (SELECT string_agg(format('%s/%s/%s', k.buchungsart_code, k.menge_liter, k.qualitaetsstufe), ',' ORDER BY k.pos)
       FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b AND k.quelle_tabelle = 'weinausbau_merkmale' AND k.quelle_id = v_c1),
    'AB_ABW/-490.000/qualitaetswein,ZU_ABW/490.000/landwein');

  -- ── 6. Direkte Mengenänderung → Abweichung → Abgleich (INV_PLUS) ──────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 5 WHERE id = %L', v_c2));
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_abweichung',
    (SELECT string_agg(format('%s/%s', a.art, a.differenz), ',') FROM public.journal_konsistenz(v_b) a), 'charge/5.000');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_leser', pg_temp.s112_versuch(format('SELECT public.journal_abgleichen(%L, interval %L)', v_b, '0')), 'T');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_frisch', pg_temp.s112_zaehle(format('SELECT public.journal_abgleichen(%L, interval %L)', v_b, '1 hour')), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_winzer', pg_temp.s112_zaehle(format('SELECT public.journal_abgleichen(%L, interval %L)', v_b, '0')), '1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_zeile',
    (SELECT string_agg(format('%s/%s', k.buchungsart_code, k.menge_liter), ',') FROM public.kellerbuch_buchungen k
      WHERE k.tenant_id = v_b AND k.quelle_tabelle = 'weinausbau_bestand'), 'INV_PLUS/5.000');
  v_erg := v_erg || pg_temp.s112_erwarte('abgleich_konsistent', (SELECT count(*) FROM public.journal_konsistenz(v_b)), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('belege_lueckenlos',
    (SELECT max(k.beleg_nr) = count(DISTINCT k.beleg_nr) FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b), true);

  -- ── 6b. KAN-40 E2: Status Gärung ↔ Ausbau als Umstufungspaar, Status in jeder Zeile; Rückbefüllung nur Testbetriebe ─
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET status = %L WHERE id = %L', 'ausbau', v_c2));
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET status = %L WHERE id = %L', 'gaerung', v_c2));
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET status = %L WHERE id = %L', 'ausbau', v_c2));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('umstufung_status_most',
    (SELECT string_agg(format('%s/%s', k.buchungsart_code, k.charge_status), ',' ORDER BY k.beleg_nr, k.pos)
       FROM (SELECT * FROM public.kellerbuch_buchungen x WHERE x.tenant_id = v_b AND x.quelle_tabelle = 'weinausbau_merkmale' AND x.quelle_id = v_c2
              ORDER BY x.beleg_nr DESC, x.pos DESC LIMIT 4) k),
    'AB_ABW/ausbau,ZU_ABW/gaerung,AB_ABW/gaerung,ZU_ABW/ausbau');
  v_erg := v_erg || pg_temp.s112_erwarte('status_im_journal',
    (SELECT count(*) FROM public.kellerbuch_buchungen k JOIN public.weinausbau w ON w.id = k.weinausbau_id
      WHERE k.tenant_id = v_b AND k.bestand = 'offen' AND k.charge_status IS NULL AND w.status IS NOT NULL), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('rueckbefuellen_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.journal_rueckbefuellen(%L)', v_b)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('rueckbefuellen_benutzer',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.journal_rueckbefuellen(%L)', v_b)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 7. Lesen und direktes Schreiben als Benutzer ──────────────────────────────────────────────────────
  SELECT k.id INTO v_j FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b ORDER BY k.beleg_nr, k.pos LIMIT 1;
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('lesen_leser', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerbuch_buchungen WHERE id = %L', v_j)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('konsistenz_leser', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.journal_konsistenz(%L)', v_b)), '0');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('lesen_fremd', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerbuch_buchungen WHERE id = %L', v_j)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('konsistenz_fremd', pg_temp.s112_versuch(format('SELECT count(*) FROM public.journal_konsistenz(%L)', v_b)), 'T');
  PERFORM pg_temp.s112_als(v_bta);
  v_r := pg_temp.s112_versuch(format('INSERT INTO public.kellerbuch_buchungen (tenant_id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, menge_liter, quelle_tabelle) VALUES (%L, 9999, 1, pg_temp.s112_heute(), %L, %L, %L, 1, %L)',
    v_b, 'INV_PLUS', 'offen', v_c1, 's112test'));
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_insert_ta', v_r IN ('R', 'T'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_update_ta',
    pg_temp.s112_versuch(format('UPDATE public.kellerbuch_buchungen SET menge_liter = 0 WHERE id = %L', v_j)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_delete_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.kellerbuch_buchungen WHERE id = %L', v_j)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_update_policy', pg_temp.s112_policy('kellerbuch_buchungen', 'UPDATE', (SELECT to_jsonb(k) FROM public.kellerbuch_buchungen k WHERE k.id = v_j)) <> 'ja', true);
  PERFORM pg_temp.s112_als_postgres();

  -- ── 8. Unveränderlich für jede Rolle; Löschen nur als Wartung mit Kennzeichen ─────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('postgres_update',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.kellerbuch_buchungen SET menge_liter = 0 WHERE id = %L', v_j)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('postgres_delete',
    split_part(pg_temp.s112_fehlertext(format('DELETE FROM public.kellerbuch_buchungen WHERE id = %L', v_j)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('postgres_truncate',
    split_part(pg_temp.s112_fehlertext('TRUNCATE public.kellerbuch_buchungen'), ':', 1), '42501');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_delete_mit_kennzeichen',
    pg_temp.s112_versuch(format('DELETE FROM public.kellerbuch_buchungen WHERE tenant_id = %L', v_b)), 'k' || pg_temp.t23_zeilen(v_b));
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 39);
END $test$;
