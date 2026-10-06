-- @bereich: Private Aktivitäten (KAN-17)
-- @ziel: Eine private Aktivität (ist_privat) sieht nur ihr Ersteller – auch Betriebsleiter, die KI-Abfrage und Partner
-- @ziel: der CRM-Gemeinschaft nicht; Anhänge dazu ebenso. Andere Mitglieder erhalten über s112_privat_bloecke nur die
-- @ziel: Zeitangaben (für den Kalenderblock „Privat“), Fremde gar nichts. Nicht-private bleiben für alle sichtbar.
-- @mutation privat_policy_weg: keine Policy akt_privat | rot: andere_sehen_privat_nicht
-- @mutation anhang_policy_weg: keine Policy akt_dok_privat | rot: anhang_verborgen
-- @mutation bloecke_mit_eigenen: s112_privat_bloecke liefert auch eigene private Termine | rot: bloecke_ohne_eigene
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 44 (Stand 06.10.2026, KAN-17). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '44_aktivitaeten_privat';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_mw    uuid;
  v_mta   uuid;
  v_bw    uuid;
  v_k     uuid;
  v_priv  uuid;
  v_offen uuid;
  v_dok   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_k := (pg_temp.s112_beispiel('kontakte', v_m) ->> 'id')::uuid;
  v_priv := (pg_temp.s112_beispiel('aktivitaeten', v_m, NULL, jsonb_build_object('kontakt_id', v_k, 'ist_privat', true, 'erstellt_von', v_mw,
             'art', 'besprechung', 'betreff', 'S112TEST Arzttermin', 'datum', current_date, 'ganztags', false, 'uhrzeit_von', '10:00', 'uhrzeit_bis', '11:00')) ->> 'id')::uuid;
  v_offen := (pg_temp.s112_beispiel('aktivitaeten', v_m, NULL, jsonb_build_object('kontakt_id', v_k, 'ist_privat', false, 'erstellt_von', v_mw,
             'art', 'besuch', 'betreff', 'S112TEST Kundentermin', 'datum', current_date)) ->> 'id')::uuid;
  v_dok := (pg_temp.s112_beispiel('aktivitaet_dokumente', v_m, NULL, jsonb_build_object('aktivitaet_id', v_priv)) ->> 'id')::uuid;
  INSERT INTO public.crm_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, notizen) VALUES (v_m, v_b, 'S112TEST privat');

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('privat_policy_weg', $m$DROP POLICY akt_privat ON public.aktivitaeten$m$);
  PERFORM pg_temp.s112_mutiere('anhang_policy_weg', $m$DROP POLICY akt_dok_privat ON public.aktivitaet_dokumente$m$);
  PERFORM pg_temp.s112_mutiere('bloecke_mit_eigenen', $m$CREATE OR REPLACE FUNCTION public.s112_privat_bloecke(p_tenant_id uuid)
    RETURNS TABLE(id uuid, datum date, bis_datum date, ganztags boolean, uhrzeit_von time, uhrzeit_bis time, erledigt boolean, erstellt_von uuid)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $x$
      SELECT a.id, a.datum, a.bis_datum, a.ganztags, a.uhrzeit_von, a.uhrzeit_bis, a.erledigt, a.erstellt_von FROM public.aktivitaeten a
       WHERE a.tenant_id = p_tenant_id AND a.ist_privat $x$$m$);

  -- ── 1. Ersteller sieht alles ──────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('ersteller_sieht_privat',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaeten WHERE id = %L::uuid', v_priv)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ersteller_sieht_anhang',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaet_dokumente WHERE id = %L::uuid', v_dok)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('bloecke_ohne_eigene',
    (SELECT count(*) FROM public.s112_privat_bloecke(v_m) WHERE id = v_priv), 0::bigint);

  -- ── 2. Betriebsleiter desselben Betriebs: nur der Block ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('andere_sehen_privat_nicht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaeten WHERE id = %L::uuid', v_priv)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('andere_sehen_nicht_private',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaeten WHERE id = %L::uuid', v_offen)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('anhang_verborgen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaet_dokumente WHERE id = %L::uuid', v_dok)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('andere_aendern_nicht',
    pg_temp.s112_versuch(format('UPDATE public.aktivitaeten SET betreff = %L WHERE id = %L', 'S112TEST fremd', v_priv)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('block_nur_zeit',
    (SELECT to_char(uhrzeit_von, 'HH24:MI') || '-' || to_char(uhrzeit_bis, 'HH24:MI') || '|' || (erstellt_von = v_mw)::text
       FROM public.s112_privat_bloecke(v_m) WHERE id = v_priv), '10:00-11:00|true');

  -- ── 3. Partner der CRM-Gemeinschaft und fremder Betrieb ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('partner_sieht_privat_nicht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaeten WHERE id = %L::uuid', v_priv)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_keine_bloecke',
    left(pg_temp.s112_fehlertext(format('SELECT count(*) FROM public.s112_privat_bloecke(%L)', v_m)), 5), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 10);
END $test$;
