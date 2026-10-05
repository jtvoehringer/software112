-- @bereich: Maßnahmen und PSM-/Dünger-Lager – Storno statt Löschen, Änderungsprotokoll (KAN-88)
-- @ziel: Maßnahmen und Lagerbuchungen lassen sich per API nicht löschen, nur stornieren (Zeitpunkt/Benutzer setzt die
-- @ziel: Datenbank, Grund Pflicht); stornierte sind unveränderlich; Lagerbuchungen sind nach dem Speichern fest (nur
-- @ziel: Notizen und Storno); die Grundstücke einer stornierten Maßnahme sind fest; Änderung, Storno und das Abwählen
-- @ziel: eines Grundstücks stehen im Bestandsprotokoll; endgültig löschen nur stornierte Zeilen über s112_storniert_loeschen.
-- @mutation loeschsperre_frei: keine Löschsperre auf behandlungen | rot: geloescht_api_behandlung
-- @mutation lager_frei: kein Freeze-Trigger auf psm_lager_bewegungen | rot: gesperrt_lager_menge
-- @mutation gst_protokoll_aus: kein Löschprotokoll auf behandlung_grundstuecke | rot: protokoll_gst_abgewaehlt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 40 (Stand 05.10.2026, KAN-88). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '40_psm_storno';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_wg    uuid;
  v_g1    uuid;
  v_g2    uuid;
  v_beh   uuid;
  v_beh2  uuid;
  v_pl    uuid;
  v_dl    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_wg := (pg_temp.s112_beispiel('weingarten', v_b) ->> 'id')::uuid;
  v_g1 := (pg_temp.s112_beispiel('grundstuecke', v_b, NULL, jsonb_build_object('weingarten_id', v_wg)) ->> 'id')::uuid;
  v_g2 := (pg_temp.s112_beispiel('grundstuecke', v_b, NULL, jsonb_build_object('weingarten_id', v_wg)) ->> 'id')::uuid;
  v_beh := (pg_temp.s112_beispiel('behandlungen', v_b, NULL, jsonb_build_object('art', 'laubarbeit', 'laubarbeit_art', 'gipfeln')) ->> 'id')::uuid;
  v_beh2 := (pg_temp.s112_beispiel('behandlungen', v_b, NULL, jsonb_build_object('art', 'laubarbeit', 'laubarbeit_art', 'gipfeln')) ->> 'id')::uuid;
  INSERT INTO public.behandlung_grundstuecke (behandlung_id, grundstueck_id, flaeche_ha)
  VALUES (v_beh, v_g1, 0.5), (v_beh, v_g2, 0.3), (v_beh2, v_g1, 0.5);
  v_pl := (pg_temp.s112_beispiel('psm_lager_bewegungen', v_b) ->> 'id')::uuid;
  v_dl := (pg_temp.s112_beispiel('duengemittel_lager_bewegungen', v_b) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('loeschsperre_frei',
    $m$DROP TRIGGER a_loeschsperre ON public.behandlungen; DROP POLICY keine_direktloeschung ON public.behandlungen$m$);
  PERFORM pg_temp.s112_mutiere('lager_frei', $m$DROP TRIGGER a_freeze ON public.psm_lager_bewegungen$m$);
  PERFORM pg_temp.s112_mutiere('gst_protokoll_aus', $m$DROP TRIGGER z_protokoll_loeschen ON public.behandlung_grundstuecke$m$);

  PERFORM pg_temp.s112_als(v_bta);
  -- ── 1. Maßnahme: kein Löschen per API, Bearbeiten bleibt, Abwählen eines GST protokolliert ─────────────
  v_txt := pg_temp.s112_fehlertext(format('DELETE FROM public.behandlungen WHERE id = %L', v_beh));
  v_erg := v_erg || pg_temp.s112_erwarte('geloescht_api_behandlung',
    v_txt = 'ok' AND NOT EXISTS (SELECT 1 FROM public.behandlungen WHERE id = v_beh), false);
  PERFORM pg_temp.s112_als(v_bw);   -- Bearbeiten als Mitarbeiter
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_bearbeiten',
    pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET notizen = %L, datum = datum - 1 WHERE id = %L', 'S112TEST bearbeitet', v_beh)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_gst_abwaehlen',
    pg_temp.s112_fehlertext(format('DELETE FROM public.behandlung_grundstuecke WHERE behandlung_id = %L AND grundstueck_id = %L', v_beh, v_g2)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_gst_abgewaehlt',
    EXISTS (SELECT 1 FROM public.bestandsprotokoll p WHERE p.tabelle = 'behandlung_grundstuecke' AND p.aktion = 'DELETE'
             AND p.tenant_id = v_b AND p.alt ->> 'grundstueck_id' = v_g2::text), true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_aenderung',
    EXISTS (SELECT 1 FROM public.bestandsprotokoll p WHERE p.tabelle = 'behandlungen' AND p.aktion = 'UPDATE'
             AND p.datensatz_id = v_beh AND 'datum' = ANY (p.geaenderte_spalten)), true);

  PERFORM pg_temp.s112_als(v_bw);
  -- ── 2. Storno: Grund Pflicht, Benutzer setzt die DB, danach unveränderlich, GST fest ───────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ohne_grund',
    left(pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET storniert_am = now() WHERE id = %L', v_beh)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_behandlung',
    pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST falsche Ried', v_beh)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_storniert_aendern',
    left(pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET notizen = %L WHERE id = %L', 'S112TEST danach', v_beh)), 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_gst_storniert',
    pg_temp.s112_versuch(format('DELETE FROM public.behandlung_grundstuecke WHERE behandlung_id = %L', v_beh)), 'T');   -- per API nur Löschen (keine UPDATE-Policy)
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_benutzer', (SELECT storniert_von = v_bw FROM public.behandlungen WHERE id = v_beh), true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_storno',
    EXISTS (SELECT 1 FROM public.bestandsprotokoll p WHERE p.tabelle = 'behandlungen' AND p.datensatz_id = v_beh
             AND 'storniert_am' = ANY (p.geaenderte_spalten)), true);

  PERFORM pg_temp.s112_als(v_bw);
  -- ── 3. Lager: fest nach dem Speichern, Storno erlaubt ─────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_lager_menge',
    pg_temp.s112_versuch(format('UPDATE public.psm_lager_bewegungen SET menge = menge + 1 WHERE id = %L', v_pl)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_duenger_datum',
    pg_temp.s112_versuch(format('UPDATE public.duengemittel_lager_bewegungen SET datum = datum - 1 WHERE id = %L', v_dl)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_lager_notizen',
    pg_temp.s112_versuch(format('UPDATE public.psm_lager_bewegungen SET notizen = %L WHERE id = %L', 'S112TEST Notiz', v_pl)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('kein_api_loeschen_lager',
    pg_temp.s112_versuch(format('DELETE FROM public.psm_lager_bewegungen WHERE id = %L', v_pl)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_lager',
    pg_temp.s112_fehlertext(format('UPDATE public.psm_lager_bewegungen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Fehlbuchung', v_pl)), 'ok');

  -- ── 4. Endgültig löschen: nur stornierte ──────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('endgueltig_unstorniert_abgelehnt',
    left(pg_temp.s112_fehlertext(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_b, 'behandlungen', v_beh2, 'S112TEST nicht storniert')), 5), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('endgueltig_behandlung',
    pg_temp.s112_fehlertext(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_b, 'behandlungen', v_beh, 'S112TEST endgültig weg')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('endgueltig_lager',
    pg_temp.s112_fehlertext(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_b, 'psm_lager_bewegungen', v_pl, 'S112TEST endgültig weg')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kaskade_gst',
    (SELECT count(*) FROM public.behandlung_grundstuecke WHERE behandlung_id = v_beh), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('grund_im_protokoll',
    EXISTS (SELECT 1 FROM public.bestandsprotokoll p WHERE p.tabelle = 'behandlungen' AND p.aktion = 'DELETE'
             AND p.datensatz_id = v_beh AND p.grund = 'S112TEST endgültig weg'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('buchung_loeschen_entfernt',
    to_regprocedure('public.s112_buchung_loeschen(uuid, text, uuid, text)') IS NULL, true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 22);
END $test$;
