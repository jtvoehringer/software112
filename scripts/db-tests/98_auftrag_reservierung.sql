-- @bereich: Warenwirtschaft – Auftrag mit Bestandsreservierung (KAN-418 Teil 1)
-- @ziel: Ein Auftrag reserviert Flaschen: verfügbar = Bestand − reserviert. Mehr als verfügbar lässt sich weder
-- @ziel: beauftragen noch verkaufen; der Storno gibt die Flaschen frei. Aufträge entstehen nur über die RPC, direkt
-- @ziel: änderbar sind nur Frist und Notiz. Leser, Mitarbeiter ohne Warenwirtschaft und fremde Betriebe kommen nicht
-- @ziel: durch, fremde Aufträge sind unsichtbar; ein Kontakt mit Auftrag lässt sich nicht löschen.
-- @mutation ohne_verkaufssperre: s112_fuellung_reserviert liefert immer 0 | rot: (verkauf_in_reservierung|zweiter_auftrag_zu_viel|reserviert_60)
-- @mutation ohne_schutz: Trigger a_auftrag_schutz entfernt | rot: (direkt_status|storniert_unveraenderlich)
-- @ziel: KAN-487: Lieferbedingungen (Freitext) und Preise je Position sind Pflicht; ein Auftrag von früher lässt sich
-- @ziel: einmal ergänzen, solange er Flaschen reserviert – nur mit Schreibrecht Warenwirtschaft im eigenen Betrieb.
-- @mutation ohne_modul: s112_pruefe_schreibmodul prüft nichts mehr | rot: ohne_warenwirtschaft
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 98 (Stand 12.11.2026, KAN-418). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '98_auftrag_reservierung';
  c_neu   constant text := 'SELECT public.s112_auftrag_anlegen(%L::uuid, %L::jsonb, %L::jsonb)';
  c_verk  constant text := 'SELECT public.s112_fuellung_verkauf_buchen(%L::uuid, %L::uuid, gen_random_uuid(), %s, pg_temp.s112_heute(), %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_k     uuid;
  v_km    uuid;
  v_f     uuid;   -- Füllung in B mit 100 Flaschen
  v_fm    uuid;   -- Füllung im fremden Betrieb
  v_r     jsonb;
  v_auf   uuid;
  c_erg   constant text := 'SELECT public.s112_auftrag_ergaenzen(%L::uuid, %L::uuid, %L, %L::jsonb)';   -- KAN-487
  v_alt   uuid;    -- Auftrag von früher (ohne Preise und Lieferbedingungen)
  v_erp   jsonb;   -- Preise zum Ergänzen
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Warenwirtschaft
  v_k := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('nachname', 'S112TEST Kunde')) ->> 'id')::uuid;
  v_km := (pg_temp.s112_zeile('kontakte', v_m, jsonb_build_object('nachname', 'S112TEST Fremd')) ->> 'id')::uuid;
  v_f := (pg_temp.s112_zeile('fuellungen', v_b, jsonb_build_object('name', 'S112TEST GV', 'anzahl_flaschen', 100, 'bestand_flaschen', 100, 'aktiv', true)) ->> 'id')::uuid;
  v_fm := (pg_temp.s112_zeile('fuellungen', v_m, jsonb_build_object('name', 'S112TEST fremd', 'anzahl_flaschen', 100, 'bestand_flaschen', 100, 'aktiv', true)) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_verkaufssperre',
    $m$CREATE OR REPLACE FUNCTION public.s112_fuellung_reserviert(p_fuellung_id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path = public AS $f$ SELECT 0 $f$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_schutz',
    $m$DROP TRIGGER a_auftrag_schutz ON public.auftraege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modul',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[]) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN; END $f$$m$);

  -- ── 1. Wer nicht darf ───────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_warenwirtschaft',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '42501');

  -- ── 2. Anlegen und Reservierung als Mitarbeiter mit Warenwirtschaft ─────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_kontakt',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_km), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '23503');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_fuellung',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_fm, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '23503');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_kunde',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, '{}'::jsonb, jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('mehr_als_bestand',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 101, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '22023');
  -- zwei Positionen derselben Füllung zählen zusammen
  v_r := public.s112_auftrag_anlegen(v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k),
           jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 40, 'preis_brutto', '10.00', 'ust_satz', '13'), jsonb_build_object('fuellung_id', v_f, 'menge', 20, 'preis_brutto', '10.00', 'ust_satz', '13')));
  v_auf := (v_r ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer', (v_r ->> 'nummer') ~ '^AB-[0-9]{4}-0001$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('frist_14_tage',
    (SELECT (reserviert_bis = datum + 14 AND status = 'offen' AND erstellt_von = v_bw)::text FROM public.auftraege WHERE id = v_auf), 'true');
  -- KAN-418 Teil 5: Standardfrist des Betriebs (30 statt 14 Tage) – lesbar, nicht direkt schreibbar, wirkt beim Anlegen
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET auftrag_reservierung_tage = 30 WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frist_betrieb_lesbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L AND auftrag_reservierung_tage = 30', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('frist_betrieb_nicht_direkt',
    left(pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET auftrag_reservierung_tage = 60 WHERE tenant_id = %L', v_b)), 1) <> 'k', true);
  v_r := public.s112_auftrag_anlegen(v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')));
  v_erg := v_erg || pg_temp.s112_erwarte('frist_des_betriebs',
    (SELECT (reserviert_bis = datum + 30)::text FROM public.auftraege WHERE id = (v_r ->> 'id')::uuid), 'true');
  -- eine ausdrücklich angegebene Frist bleibt
  PERFORM public.s112_auftrag_stornieren(v_b, (v_r ->> 'id')::uuid, 'S112TEST Frist des Betriebs geprüft');
  v_r := public.s112_auftrag_anlegen(v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k, 'reserviert_bis', (pg_temp.s112_heute() + 3)::text),
           jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')));
  v_erg := v_erg || pg_temp.s112_erwarte('frist_ausdruecklich',
    (SELECT (reserviert_bis = pg_temp.s112_heute() + 3)::text FROM public.auftraege WHERE id = (v_r ->> 'id')::uuid), 'true');
  PERFORM public.s112_auftrag_stornieren(v_b, (v_r ->> 'id')::uuid, 'S112TEST ausdrückliche Frist geprüft');

  -- ── 2a. KAN-487: Lieferbedingungen (Pflicht-Freitext) und Preise je Position ────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_lieferbedingungen',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k, 'lieferbedingungen', '   '), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('lieferbedingungen_zu_lang',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k, 'lieferbedingungen', repeat('x', 301)), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_preis',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k, 'lieferbedingungen', 'S112TEST ab Hof'), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'ust_satz', '13')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_steuersatz',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('kontakt_id', v_k, 'lieferbedingungen', 'S112TEST ab Hof'), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00')))), ':', 1), '23514');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('preise_und_lieferbedingungen_gespeichert',
    (SELECT concat_ws('/', a.lieferbedingungen, (SELECT count(*) FROM public.auftrag_positionen p WHERE p.auftrag_id = a.id AND p.preis_brutto = 10 AND p.ust_satz = 13 AND p.rabatt_pct = 0))
       FROM public.auftraege a WHERE a.id = v_auf), 'S112TEST ab Hof/2');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_lieferbedingungen',
    pg_temp.s112_versuch(format('UPDATE public.auftraege SET lieferbedingungen = %L WHERE id = %L', 'S112TEST direkt', v_auf)), 'T');
  -- ein vollständiger Auftrag lässt sich nicht „ergänzen“ (Preise ändern = stornieren und neu erfassen)
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_vollstaendig_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_auf, 'S112TEST neu',
      (SELECT jsonb_agg(jsonb_build_object('position_id', p.id, 'preis_brutto', '1.00', 'ust_satz', '13')) FROM public.auftrag_positionen p WHERE p.auftrag_id = v_auf))), ':', 1), '23514');
  -- Auftrag von früher: ohne Lieferbedingungen und ohne Preise (so lagen sie vor KAN-487 in der Tabelle)
  v_r := public.s112_auftrag_anlegen(v_b, jsonb_build_object('kontakt_id', v_k, 'lieferbedingungen', 'S112TEST wird geleert'),
           jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 1, 'preis_brutto', '10.00', 'ust_satz', '13')));
  v_alt := (v_r ->> 'id')::uuid;
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege SET lieferbedingungen = NULL WHERE id = v_alt;
  PERFORM set_config('s112.auftrag_frei', '', true);
  UPDATE public.auftrag_positionen SET preis_brutto = NULL, rabatt_pct = NULL, sonderrabatt_pct = NULL, ust_satz = NULL WHERE auftrag_id = v_alt;
  SELECT jsonb_agg(jsonb_build_object('position_id', p.id, 'preis_brutto', '12.50', 'rabatt_pct', '10', 'ust_satz', '13')) INTO v_erp
    FROM public.auftrag_positionen p WHERE p.auftrag_id = v_alt;
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_leser', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST ab Hof', v_erp)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_ohne_warenwirtschaft', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST ab Hof', v_erp)), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_fremder_betrieb', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST ab Hof', v_erp)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_fremder_auftrag', split_part(pg_temp.s112_fehlertext(format(c_erg, v_m, v_alt, 'S112TEST ab Hof', v_erp)), ':', 1), 'P0002');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_ohne_lieferbedingungen', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, ' ', v_erp)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_ohne_positionen', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST ab Hof', '[]'::jsonb)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_fremde_position',   -- Position eines anderen Auftrags
    split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST ab Hof',
      (SELECT jsonb_build_array(jsonb_build_object('position_id', p.id, 'preis_brutto', '12.50', 'ust_satz', '13')) FROM public.auftrag_positionen p WHERE p.auftrag_id = v_auf LIMIT 1))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_ok', pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, '  S112TEST frei Haus  ', v_erp)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_zweimal', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST nochmal', v_erp)), ':', 1), '23514');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzt_steht',
    (SELECT concat_ws('/', a.lieferbedingungen, p.preis_brutto, p.rabatt_pct, p.sonderrabatt_pct, p.ust_satz, a.status)
       FROM public.auftraege a JOIN public.auftrag_positionen p ON p.auftrag_id = a.id WHERE a.id = v_alt), 'S112TEST frei Haus/12.50/10.00/0.00/13.00/offen');
  -- nach dem Storno (keine Reservierung mehr) ist auch ein unvollständiger Auftrag nicht mehr ergänzbar
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege SET lieferbedingungen = NULL WHERE id = v_alt;
  PERFORM set_config('s112.auftrag_frei', '', true);
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM public.s112_auftrag_stornieren(v_b, v_alt, 'S112TEST Ergänzen geprüft');
  v_erg := v_erg || pg_temp.s112_erwarte('ergaenzen_storniert', split_part(pg_temp.s112_fehlertext(format(c_erg, v_b, v_alt, 'S112TEST ab Hof', v_erp)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('zweiter_auftrag_zu_viel',
    split_part(pg_temp.s112_fehlertext(format(c_neu, v_b, jsonb_build_object('lieferbedingungen', 'S112TEST ab Hof', 'kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 41, 'preis_brutto', '10.00', 'ust_satz', '13')))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_in_reservierung',
    pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, -41, 'S112TEST Verkauf')) LIKE '22023:%reserviert%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_bis_zur_grenze',
    pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, -40, 'S112TEST Verkauf')), 'ok');

  -- ── 3. Direkte Schreibwege ──────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_anlegen',
    pg_temp.s112_versuch(format('INSERT INTO public.auftraege (tenant_id, nummer, kontakt_id) VALUES (%L, %L, %L)', v_b, 'AB-9999-0001', v_k)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_position',
    pg_temp.s112_versuch(format('UPDATE public.auftrag_positionen SET menge = 1 WHERE auftrag_id = %L', v_auf)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_status',
    pg_temp.s112_versuch(format('UPDATE public.auftraege SET status = %L WHERE id = %L', 'geliefert', v_auf)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('frist_aendern',
    pg_temp.s112_versuch(format('UPDATE public.auftraege SET reserviert_bis = reserviert_bis + 7 WHERE id = %L', v_auf)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.auftraege WHERE id = %L', v_auf)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('kontakt_mit_auftrag_bleibt',
    pg_temp.s112_versuch(format('DELETE FROM public.kontakte WHERE id = %L', v_k)) IN ('T', 'E23503'), true);

  -- KAN-418 Teil 3: Versandvermerk der Auftragsbestätigung – nur über die RPC, mit Schreibrecht Warenwirtschaft
  v_erg := v_erg || pg_temp.s112_erwarte('ab_adresse_ungueltig',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_ab_vermerken(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'keine-adresse')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ab_vermerkt',
    pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_ab_vermerken(%L::uuid, %L::uuid, %L)', v_b, v_auf, ' kunde@example.org ')), 'ok');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ab_ohne_warenwirtschaft',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_ab_vermerken(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'kunde@example.org')), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('ab_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_ab_vermerken(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'kunde@example.org')), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ab_vermerk_steht',
    (SELECT ab_versendet_an || '/' || (ab_versendet_am IS NOT NULL)::text FROM public.auftraege WHERE id = v_auf), 'kunde@example.org/true');

  -- ── 4. Sichtbarkeit ─────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_sieht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.auftraege WHERE id = %L', v_auf)), '1');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT (SELECT count(*) FROM public.auftraege WHERE id = %L) + (SELECT count(*) FROM public.auftrag_positionen WHERE auftrag_id = %L)', v_auf, v_auf)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_storniert_nicht',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'S112TEST fremder Storno')), ':', 1), '42501');

  -- ── 5. Storno gibt frei ─────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('reserviert_60', public.s112_fuellung_reserviert(v_f), 60);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_grund_fehlt',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'kurz')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'S112TEST Kunde hat abgesagt')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ab_storniert_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_ab_vermerken(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'kunde@example.org')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('storniert_unveraenderlich',
    pg_temp.s112_versuch(format('UPDATE public.auftraege SET notizen = %L WHERE id = %L', 'S112TEST', v_auf)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_storno_verkaufbar',
    pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, -60, 'S112TEST Verkauf nach Storno')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('reserviert_0', public.s112_fuellung_reserviert(v_f), 0);
  v_erg := v_erg || pg_temp.s112_erwarte('anon_darf_nicht',
    has_function_privilege('anon', 'public.s112_auftrag_anlegen(uuid, jsonb, jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.s112_fuellung_reserviert(uuid)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('anon_darf_nicht_ergaenzen',   -- KAN-487
    has_function_privilege('anon', 'public.s112_auftrag_ergaenzen(uuid, uuid, text, jsonb)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 57);   -- +19 KAN-487
END $test$;
