-- @bereich: Kostenrechnung – Ausgabe der E&A-Rechnung auf Kostenstellen (KAN-421)
-- @ziel: Eine Ausgabe wird einmal über s112_ea_kosten_zuordnen auf Kostenstellen aufgeteilt (Summe ≤ netto, eigene aktive
-- @ziel: Kostenstelle, nur Ausgaben). Kosteneinträge aus einer Buchung lassen sich nicht direkt anlegen, ändern oder
-- @ziel: löschen; der Storno der Buchung spiegelt sie negativ. Leser, Mitarbeiter ohne E&A, Betriebe ohne Controlling
-- @ziel: und fremde Betriebe kommen nicht durch.
-- @mutation ohne_schutz: Trigger a_kosten_buchung_schutz entfernt | rot: direkt_.*
-- @mutation ohne_spiegel: Trigger z_kosten_storno_spiegeln entfernt | rot: (storno_spiegel|summe_nach_storno)
-- @mutation ohne_controlling_pruefung: s112_pruefe_paketmodul prüft nichts mehr | rot: ohne_controlling
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 95 (Stand 12.11.2026, KAN-421). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '95_kosten_aus_buchung';
  c_rpc   constant text := 'SELECT public.s112_ea_kosten_zuordnen(%L::uuid, %L::uuid, %L::jsonb)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_ks    uuid;
  v_ks2   uuid;
  v_ksm   uuid;
  v_ea    uuid;   -- Ausgabe 120 netto
  v_ea2   uuid;   -- Ausgabe 100 netto
  v_ein   uuid;   -- Einnahme
  v_eam   uuid;   -- Ausgabe im fremden Betrieb
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm', 'auswertungen']);   -- Mitarbeiter ohne E&A
  v_ks := (pg_temp.s112_zeile('kostenstellen', v_b, jsonb_build_object('aktiv', true)) ->> 'id')::uuid;
  v_ks2 := (pg_temp.s112_zeile('kostenstellen', v_b, jsonb_build_object('aktiv', true)) ->> 'id')::uuid;
  v_ksm := (pg_temp.s112_zeile('kostenstellen', v_m, jsonb_build_object('aktiv', true)) ->> 'id')::uuid;
  v_ea := (pg_temp.s112_zeile('ea_transaktionen', v_b, jsonb_build_object('typ', 'ausgabe', 'datum', v_heute, 'beschreibung', 'S112TEST Diesel', 'betrag_netto', 120, 'ust_satz', 20)) ->> 'id')::uuid;
  v_ea2 := (pg_temp.s112_zeile('ea_transaktionen', v_b, jsonb_build_object('typ', 'ausgabe', 'datum', v_heute, 'beschreibung', 'S112TEST Kork', 'betrag_netto', 100, 'ust_satz', 20)) ->> 'id')::uuid;
  v_ein := (pg_temp.s112_zeile('ea_transaktionen', v_b, jsonb_build_object('typ', 'einnahme', 'datum', v_heute, 'beschreibung', 'S112TEST Verkauf', 'betrag_netto', 100, 'ust_satz', 20)) ->> 'id')::uuid;

  v_eam := (pg_temp.s112_zeile('ea_transaktionen', v_m, jsonb_build_object('typ', 'ausgabe', 'datum', v_heute, 'beschreibung', 'S112TEST fremd', 'betrag_netto', 100, 'ust_satz', 20)) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_schutz',
    $m$DROP TRIGGER a_kosten_buchung_schutz ON public.kosteneintraege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_spiegel',
    $m$DROP TRIGGER z_kosten_storno_spiegeln ON public.ea_transaktionen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_controlling_pruefung',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_paketmodul(p_tenant_id uuid, p_schalter text) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN; END $f$$m$);

  -- ── 1. Zuordnen als Mitarbeiter mit E&A ─────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zuordnen_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea, jsonb_build_array(
      jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 80), jsonb_build_object('kostenstelle_id', v_ks2, 'kostenart_id', '', 'betrag', '40.00')))), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zwei_eintraege',
    (SELECT count(*) || '/' || sum(betrag) || '/' || bool_and(datum = v_heute AND beschreibung = 'S112TEST Diesel' AND transaktions_nr IS NOT NULL)
       FROM public.kosteneintraege WHERE ea_transaktion_id = v_ea), '2/120.00/true');
  v_erg := v_erg || pg_temp.s112_erwarte('nur_einmal',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 1)))), ':', 1), '23505');
  v_erg := v_erg || pg_temp.s112_erwarte('summe_zu_hoch',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(
      jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 60), jsonb_build_object('kostenstelle_id', v_ks2, 'betrag', 40.01)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('betrag_null',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 0)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_kostenstelle',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ksm, 'betrag', 10)))), ':', 1), '23503');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_buchung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_eam, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 10)))), ':', 1), '23503');
  v_erg := v_erg || pg_temp.s112_erwarte('einnahme_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ein, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 10)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('leere_liste',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, '[]'::jsonb)), ':', 1), '23514');

  -- ── 2. Einträge aus einer Buchung sind nur über die Buchung änderbar ────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_aendern',
    pg_temp.s112_versuch(format('UPDATE public.kosteneintraege SET betrag = 1 WHERE ea_transaktion_id = %L', v_ea)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.kosteneintraege WHERE ea_transaktion_id = %L', v_ea)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_anlegen',
    pg_temp.s112_versuch(format('INSERT INTO public.kosteneintraege (tenant_id, kostenstelle_id, betrag, ea_transaktion_id) VALUES (%L, %L, 5, %L)', v_b, v_ks, v_ea2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('manuell_bleibt_frei',
    pg_temp.s112_versuch(format('INSERT INTO public.kosteneintraege (tenant_id, kostenstelle_id, betrag) VALUES (%L, %L, 5)', v_b, v_ks)), 'k1');

  -- ── 3. Storno der Buchung spiegelt die Kosteneinträge negativ ───────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_ea_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_ea, 'S112TEST Storno KAN-421')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_spiegel',
    (SELECT count(*) || '/' || coalesce(sum(k.betrag), 0) FROM public.kosteneintraege k
       JOIN public.ea_transaktionen e ON e.id = k.ea_transaktion_id WHERE e.storno_von_id = v_ea), '2/-120.00');
  v_erg := v_erg || pg_temp.s112_erwarte('summe_nach_storno',
    (SELECT coalesce(sum(k.betrag), 0)::text FROM public.kosteneintraege k
       JOIN public.ea_transaktionen e ON e.id = k.ea_transaktion_id WHERE e.id = v_ea OR e.storno_von_id = v_ea), '0.00');
  v_erg := v_erg || pg_temp.s112_erwarte('stornierte_nicht_zuordenbar',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 1)))), ':', 1) IN ('23514', '23505'), true);

  -- ── 4. Wer nicht darf ───────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 10)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_ea_recht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 10)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 10)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_controlling = false WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_controlling',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ea2, jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks, 'betrag', 10)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('anon_darf_nicht',
    has_function_privilege('anon', 'public.s112_ea_kosten_zuordnen(uuid, uuid, jsonb)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 22);
END $test$;
