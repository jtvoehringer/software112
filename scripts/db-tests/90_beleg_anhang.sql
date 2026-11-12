-- @bereich: E&A – Belege an Buchungen (KAN-415), Tabelle ea_belege
-- @ziel: Ein Mitarbeiter mit E&A-Recht hängt einen Beleg direkt als „verbucht“ an eine Buchung des eigenen Betriebs (auch
-- @ziel: mehrere je Buchung) und ordnet einen gescannten Beleg einer bestehenden Buchung zu. An eine Buchung eines fremden
-- @ziel: Betriebs geht das nicht; ein angehängter Beleg ist unveränderlich; Leser und Mitarbeiter ohne E&A hängen nichts an.
-- @mutation ohne_fremdverweis: Trigger z_fremdverweis_ea_transaktion_id entfernt | rot: fremde_buchung_abgelehnt
-- @mutation ohne_modulrecht: Policy modul_insert auf ea_belege entfernt | rot: (leser|ohne_ea)_abgelehnt
-- @ziel: Lösen (UAT 12.11.2026): Ein angehängter Beleg lässt sich nur über s112_ea_beleg_loesen von der Buchung lösen –
-- @ziel: mit Grund, mit E&A-Recht, nur im offenen Zeitraum; danach liegt er wieder bei den nicht verbuchten Belegen.
-- @mutation ohne_periodensperre: s112_ea_zeitraum_sperrgrund liefert immer NULL | rot: loesen_im_abgeschlossenen_monat
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 90 (Stand 11.11.2026, KAN-415). Alles zurückgerollt.
-- Personen: Mitarbeiter b_w (alle Module) und Leser b_l in Betrieb B, Mitarbeiter x ohne E&A in B; Betrieb C fremd.

DO $test$
DECLARE
  c_datei constant text := '90_beleg_anhang';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_c     uuid;
  v_w     uuid;
  v_l     uuid;
  v_x     uuid;
  v_tb    uuid;
  v_tc    uuid;
  v_scan  uuid;
  v_ins   text;
  v_b1    uuid;
  v_dat   date;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ─────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau(true);
  v_b := (v_a ->> 'b')::uuid;
  v_c := (v_a ->> 'c')::uuid;
  v_w := (v_a ->> 'b_w')::uuid;
  v_l := (v_a ->> 'b_l')::uuid;
  v_x := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);
  UPDATE public.tenant_einstellungen SET modul_ea = true WHERE tenant_id IN (v_b, v_c);
  v_tb := (pg_temp.s112_beispiel('ea_transaktionen', v_b, NULL, '{"is_locked": false}') ->> 'id')::uuid;
  v_tc := (pg_temp.s112_beispiel('ea_transaktionen', v_c, NULL, '{"is_locked": false}') ->> 'id')::uuid;
  INSERT INTO public.ea_belege (tenant_id, dateiname, dateityp, storage_pfad, status)
  VALUES (v_b, 'S112TEST-scan.pdf', 'application/pdf', v_b::text || '/S112TEST-scan.pdf', 'erkannt') RETURNING id INTO v_scan;

  PERFORM pg_temp.s112_mutiere('ohne_fremdverweis', $m$DROP TRIGGER z_fremdverweis_ea_transaktion_id ON public.ea_belege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modulrecht', $m$DROP POLICY modul_insert ON public.ea_belege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_periodensperre',
    $m$CREATE OR REPLACE FUNCTION public.s112_ea_zeitraum_sperrgrund(p_tenant_id uuid, p_datum date) RETURNS text
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$ SELECT NULL::text $f$$m$);

  v_ins := $s$INSERT INTO public.ea_belege (tenant_id, ea_transaktion_id, dateiname, dateityp, groesse_bytes, storage_pfad, status, verbucht_am, hochgeladen_von)
              VALUES (%L, %L, %L, 'application/pdf', 10, %L, 'verbucht', now(), %L)$s$;

  -- ── 1. Mitarbeiter mit E&A: anhängen, mehrere je Buchung ─────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_w);
  v_erg := v_erg || pg_temp.s112_erwarte('anhaengen_eigene_buchung',
    pg_temp.s112_fehlertext(format(v_ins, v_b, v_tb, 'S112TEST-1.pdf', v_b::text || '/S112TEST-1.pdf', v_w)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zweiter_beleg_selbe_buchung',
    pg_temp.s112_fehlertext(format(v_ins, v_b, v_tb, 'S112TEST-2.pdf', v_b::text || '/S112TEST-2.pdf', v_w)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zwei_belege_an_der_buchung',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ea_belege WHERE ea_transaktion_id = %L', v_tb)), '2');

  -- ── 2. Fremder Betrieb ───────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_buchung_abgelehnt',
    left(pg_temp.s112_versuch(format(v_ins, v_b, v_tc, 'S112TEST-f.pdf', v_b::text || '/S112TEST-f.pdf', v_w)), 1) IN ('E', 'T', 'R'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('in_fremden_betrieb_abgelehnt',
    pg_temp.s112_versuch(format(v_ins, v_c, v_tc, 'S112TEST-g.pdf', v_c::text || '/S112TEST-g.pdf', v_w)), 'R');

  -- ── 3. Gescannten Beleg zuordnen, danach unveränderlich ──────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('scan_zuordnen',
    pg_temp.s112_fehlertext(format($s$UPDATE public.ea_belege SET ea_transaktion_id = %L, status = 'verbucht', verbucht_am = now()
                                       WHERE id = %L AND status IN ('erkannt', 'fehler')$s$, v_tb, v_scan)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('scan_ist_verbucht',
    pg_temp.s112_zaehle(format($s$SELECT count(*) FROM public.ea_belege WHERE id = %L AND status = 'verbucht' AND ea_transaktion_id = %L$s$, v_scan, v_tb)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('verbucht_nicht_umhaengbar',
    pg_temp.s112_versuch(format('UPDATE public.ea_belege SET ea_transaktion_id = NULL WHERE id = %L', v_scan)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('verbucht_nicht_loeschbar',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_belege WHERE id = %L', v_scan)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('zuordnen_nur_einmal',   -- das Muster der Route: 0 Zeilen, wenn schon verbucht
    pg_temp.s112_versuch(format($s$UPDATE public.ea_belege SET ea_transaktion_id = %L, status = 'verbucht' WHERE id = %L AND status IN ('erkannt', 'fehler')$s$, v_tb, v_scan)), 'k0');

  -- ── 4. Rechte ────────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_l);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    pg_temp.s112_versuch(format(v_ins, v_b, v_tb, 'S112TEST-l.pdf', v_b::text || '/S112TEST-l.pdf', v_l)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_liest_belege',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ea_belege WHERE ea_transaktion_id = %L', v_tb)), '3');
  PERFORM pg_temp.s112_als(v_x);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_ea_abgelehnt',
    pg_temp.s112_versuch(format(v_ins, v_b, v_tb, 'S112TEST-x.pdf', v_b::text || '/S112TEST-x.pdf', v_x)), 'R');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_liest_nichts',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.ea_belege'), '0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 5. Beleg von der Buchung lösen (UAT 12.11.2026) ────────────────────────────────────────────────────────────
  SELECT id INTO v_b1 FROM public.ea_belege WHERE tenant_id = v_b AND dateiname = 'S112TEST-1.pdf';
  SELECT datum INTO v_dat FROM public.ea_transaktionen WHERE id = v_tb;
  PERFORM pg_temp.s112_als(v_l);
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_leser',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, v_scan, 'S112TEST falscher Beleg')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_x);
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_ohne_ea',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, v_scan, 'S112TEST falscher Beleg')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_w);
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_c, v_scan, 'S112TEST falscher Beleg')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_ohne_grund',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, v_scan, 'kurz')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_unbekannter_beleg',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, gen_random_uuid(), 'S112TEST falscher Beleg')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, v_scan, 'S112TEST falscher Beleg')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('geloest_liegt_bei_den_offenen',
    pg_temp.s112_zaehle(format($s$SELECT count(*) FROM public.ea_belege WHERE id = %L AND status = 'erkannt' AND ea_transaktion_id IS NULL AND verbucht_am IS NULL$s$, v_scan)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_zweimal',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, v_scan, 'S112TEST falscher Beleg')), ':', 1), '23514');
  -- der gelöste Beleg lässt sich neu zuordnen; direkt bleibt ein verbuchter Beleg unveränderlich
  v_erg := v_erg || pg_temp.s112_erwarte('geloest_neu_zuordnen',
    pg_temp.s112_fehlertext(format($s$UPDATE public.ea_belege SET ea_transaktion_id = %L, status = 'verbucht', verbucht_am = now() WHERE id = %L AND status IN ('erkannt', 'fehler')$s$, v_tb, v_scan)), 'ok');   -- bleibt stehen (s112_versuch rollt zurück)
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_weiter_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.ea_belege SET ea_transaktion_id = NULL WHERE id = %L', v_scan)), 'T');
  -- abgeschlossener Monat: der Beleg bleibt als Nachweis an der Buchung
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.ea_monatsabschluss (tenant_id, jahr, monat) VALUES (v_b, extract(year FROM v_dat)::int, extract(month FROM v_dat)::int);
  PERFORM pg_temp.s112_als(v_w);
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_im_abgeschlossenen_monat',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_ea_beleg_loesen(%L::uuid, %L::uuid, %L)', v_b, v_b1, 'S112TEST falscher Beleg')), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('loesen_rechte',
    has_function_privilege('anon', 'public.s112_ea_beleg_loesen(uuid, uuid, text)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 26);
END
$test$;
