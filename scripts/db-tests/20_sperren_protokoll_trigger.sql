-- @bereich: Sperren, Protokoll- und Konsistenz-Trigger
-- @ziel: Was die Datenbank als Sperre durchsetzt, hält: ea_transaktionen.is_locked (weder ändern, löschen, sperren
-- @ziel: noch entsperren durch Benutzer; sperre_ea_monat/sperre_ea_uva wirken), AMA-Status (bestätigte Meldung und
-- @ziel: ihre Positionen unveränderlich), TRUNCATE-Verbot auf allen 37 Protokolltabellen, Bestandsprotokoll (UPDATE
-- @ziel: überwachter Spalten und DELETE werden mit Mandant, Benutzer und Rolle protokolliert, kein Bypass für
-- @ziel: Benutzer oder echte Mandanten, Tabelle für Benutzer nur lesbar) sowie die Mandantengleichheit von Gebinden
-- @ziel: (weinausbau_gebinde_pruefen, Kellergemeinschaft) und Anlagen/Buchungen (trg_ea_*_tenant); keller_freigaben
-- @ziel: sind für Benutzer nicht schreibbar. Seit KAN-149 D3 erzwingt die Datenbank die E&A-Periodensperre
-- @ziel: (a_ea_periodensperre: kein Einfügen, Ändern, Löschen oder Datum-Verschieben in abgeschlossenen Monaten bzw.
-- @ziel: per UVA übermittelten Zeiträumen, nichts gesperrt anlegen oder entsperren; Abgleich und Storno bleiben
-- @ziel: möglich), den Abschluss (a_ea_abschluss_schutz: Monatsabschluss, gesperrte UVA, verbuchte Belege
-- @ziel: unveränderlich; sperren nur über sperre_ea_uva), die Löschsperre auf Verkauf/E-A (keine_direktloeschung
-- @ziel: und a_loeschsperre, Wartung nur mit s112.loeschen_erlaubt), Konten nur ohne Bewegungen löschbar und den
-- @ziel: Storno-Grund beim Verkauf. Abgeschlossener Jahrgang unveränderlich (a_jahrgang_abschluss_schutz, B8 seit
-- @ziel: KAN-159 Teil 2 hart). KAN-150 F1a: Stammdaten mit berichtsrelevantem Bezug sind nicht löschbar
-- @ziel: (a_stammdaten_loeschsperre, auch in der Kaskade; Wartung nur mit s112.loeschen_erlaubt), ohne Bezug schon;
-- @ziel: s112_stammdaten_bezuege zählt die Bezüge für jedes Mitglied des eigenen Betriebs; Grundstück nur mit
-- @ziel: Stichtag deaktivierbar, Deaktivieren und Umhängen des Kontakts am Verkauf werden protokolliert.
-- @mutation is_locked_offen: ea_tx_update ohne NOT is_locked | rot: ea_locked_.*|ea_sperren_offen
-- @mutation ama_status_offen: UPDATE-Policy der AMA-Meldung ohne Statusprüfung | rot: ama_bestaetigt_update
-- @mutation ama_pos_delete_offen: DELETE-Policy auf ama_meldepositionen ohne Statusprüfung | rot: ama_pos_delete_bestaetigt
-- @mutation truncate_trigger_weg: DROP TRIGGER z_protokoll_truncate auf keller_umzuege | rot: truncate(_|:).*
-- @mutation protokoll_aendern_weg: DROP TRIGGER z_protokoll_aendern auf weinausbau | rot: protokoll_update_.*
-- @mutation protokoll_loeschen_weg: DROP TRIGGER z_protokoll_loeschen auf keller_umzuege | rot: protokoll_delete_.*|bypass_.*|bp_select_.*
-- @mutation gebinde_offen: weinausbau_gebinde_pruefen lässt alles durch | rot: gebinde_.*
-- @mutation gebinde_freigabe_inaktiv: weinausbau_gebinde_pruefen ignoriert keller_freigaben.aktiv | rot: gebinde_gemeinsam_freigabe_inaktiv
-- @mutation sperre_monat_fremd: sperre_ea_monat prüft den eigenen Admin-Betrieb statt p_tenant_id | rot: ea_sperre_monat_fremd
-- @mutation anlage_tenant_offen: trg_ea_transaktion_anlage_tenant lässt fremde Anlagen zu | rot: anlage_fremd
-- @mutation freigaben_schreibbar: PERMISSIVE-Policy ALL USING/WITH CHECK (true) auf keller_freigaben | rot: freigabe_.*
-- @mutation periodensperre_weg: DROP TRIGGER a_ea_periodensperre auf ea_transaktionen | rot: d3_.*ea_transaktionen.*|ea_insert_.*|ea_datum_.*
-- @mutation abschluss_schutz_weg: DROP TRIGGER a_ea_abschluss_schutz auf ea_monatsabschluss | rot: .*monatsabschluss_(loeschen|aendern)
-- @mutation stammdaten_loeschsperre_weg: DROP TRIGGER a_stammdaten_loeschsperre auf kontakte (KAN-150 F1a) | rot: f1a_.*kontakte.*|f1a_stammdaten_katalog
-- @mutation grundstueck_protokoll_weg: DROP TRIGGER z_protokoll_aendern auf grundstuecke (KAN-150 F1a) | rot: f1a_grundstueck_deaktiviert_protokoll
-- @mutation kind_tenant_ama_weg: bestandsprotokoll_schreiben() ohne CASE-Zweig ama_meldepositionen (kein Ersatzweg) – Protokollzeile mit tenant_id NULL | rot: protokoll_kind_tenant:.*
--
-- software:112 – SQL-Testsuite, Datei 20 (Stand 28.09.2026). Nur Staging; die ganze Datei ist EINE Transaktion
-- und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt (Ausnahme: bestandsprotokoll_id_seq ist nicht
-- transaktional, es entstehen harmlose Nummernlücken).
--
-- Alle Beispieldaten legt die Datei selbst an (als postgres, im Musterhof M = v_a ->> 'm' bzw. in B): gesperrte
-- Buchung, gesperrte UVA und Monatsabschluss 2032 (gesperrte Zeilen seit KAN-149 D3 nur mit dem Wartungs-Flag
-- s112.loeschen_erlaubt), Abschluss 2033/03 samt Buchungen, Zahlungen, Umbuchungen, Konten, UVA und verbuchtem
-- Beleg (D3), bestätigte AMA-Meldung samt Position, abgeschlossener
-- Jahrgang, stornierter Verkaufsposten, Wein mit Menge, gemeinsamer belegter Behälter – unabhängig vom
-- Demo-Datenstand (ein Demo-Reset macht den Test nicht rot).
--
-- Geprüft:
--   1. E&A: is_locked-Buchung als m_ta weder änderbar noch löschbar (k0), sperren (R) und entsperren (k0) geht
--      nicht; sperre_ea_monat sperrt alle Buchungen des Monats und legt ea_monatsabschluss an; sperre_ea_uva
--      verlangt vollständige Monatsabschlüsse (P0001) und sperrt sonst UVA und Buchungen; m_w darf nicht sperren,
--      b_ta keinen Monat von M (T, danach kein Abschluss für M angelegt).
--   2. AMA: bestätigte Meldung und ihre Positionen sind unveränderlich (k0/R; Positionen auch nicht löschbar),
--      unter einem Entwurf erlaubt (k1).
--   3. Ehemals Lücke B7 (seit KAN-149 D3 in der Datenbank gesperrt, harte Prüfungen, T): Buchung in abgeschlossenen
--      Monat, gleich gesperrt anlegen, Datum in abgeschlossenen Monat verschieben (m_w), gesperrte UVA entsperren/
--      löschen (m_w), Monatsabschluss löschen (m_ta). B8: abgeschlossener Jahrgang nicht änderbar (T, seit KAN-159 Teil 2).
--   3b. KAN-149 D3 im Einzelnen (synthetischer Abschluss 2033/03, offen 2033/05, im Musterhof): Einfügen/Ändern/Datum
--      in den abgeschlossenen Monat für ea_transaktionen, zahlungen, konto_umbuchungen → T (konto_umbuchungen ohne
--      UPDATE-Policy: als postgres ohne Flag), offener Monat → k1; is_locked beim Anlegen → T; Abgleich
--      (setze_kontobewegung_abgeglichen) und Storno (s112_ea_stornieren, Gegenbuchung im offenen Monat) einer
--      gesperrten Buchung gehen, Storno mit Datum im abgeschlossenen Monat → 42501; gesperrte UVA ändern/löschen → T,
--      UVA direkt sperren → T, über sperre_ea_uva → ok; Monatsabschluss ändern/löschen → T; Konto mit Buchungen
--      löschen → T, leeres Konto → k1; verbuchten Beleg ändern/löschen → T; Verkaufsstorno ohne Grund → E23514, mit
--      Grund → k1; DELETE auf den fünf Verkaufs-/E-A-Tabellen als m_ta/m_w → k0 (Policy 'nein'), als postgres ohne
--      Flag → T (Löschsperre bzw. Periodensperre), mit s112.loeschen_erlaubt = Musterhof → k1.
--   3c. KAN-150 F1a (synthetische Stammdaten im Musterhof): a_stammdaten_loeschsperre genau auf den 10 Soll-Tabellen (KAN-167: + betriebsmittel);
--      s112_stammdaten_bezuege als Leser → {"Maßnahmen": 1} für Ried (nur über sein Grundstück), Grundstück und
--      PSM, {"Verkäufe": 1} für Kontakt und Firma, {} ohne Bezug; unbekannte ID → P0002, unbekannte Tabelle →
--      22023, fremder Betrieb (b_ta) → 42501. DELETE als m_ta mit Bezug → T (Klartext „deaktivieren statt
--      löschen“, Zeilen bleiben), ohne Bezug → k1; postgres ohne Flag → T, mit s112.loeschen_erlaubt = Musterhof
--      → k1, mit dem Flag von B → T. Grundstück aktiv = false ohne deaktiviert_am → E23514, mit → ok und eine
--      Protokollzeile (aktiv, deaktiviert_am); Kontakt am Verkauf umhängen → Protokollzeile mit kontakt_id.
--   4. Bestandsprotokoll: UPDATE überwachter Spalte (aus pg_trigger.tgargs) → genau 1 Zeile mit Mandant, Tabelle,
--      Aktion, Spalten, Benutzer und db_rolle; nicht überwachte Spalte → 0; DELETE mit alt; Kindzeile
--      (pressung_behaelter) mit Mandant über die Eltern; dazu dynamisch JEDE Protokolltabelle ohne tenant_id
--      (s112_soll_liste('protokoll_tabellen'), also auch künftige Kindtabellen): Beispielzeile in B löschen →
--      genau eine Protokollzeile mit tenant_id = B (protokoll_kind_tenant:<tab>); Bypass s112.protokoll_aus nur als
--      postgres für den Musterhof; authenticated hat auf bestandsprotokoll nur SELECT (nur SA/TA/PA sehen Zeilen).
--   5. Mandantengleichheit: Gebinde fremder Betriebe (nicht gemeinsam, ohne Freigabe, nur inaktive Freigabe,
--      belegt) → P0001; gemeinsames leeres Gebinde mit aktiver Freigabe → erlaubt; Anlage/Buchung eines fremden
--      Betriebs → P0001.
--   6. keller_freigaben: b_ta sieht die Freigabe, schreibt sie aber nicht (R/k0).
--   7. TRUNCATE als postgres auf jeder Protokolltabelle → 42501 (bei FK-Verweisen mit CASCADE, damit der
--      Trigger und nicht die FK-Prüfung antwortet), Zeilenzahl unverändert – zum Schluss, weil ein Erfolg
--      (Mutation) die Tabelle bis zum Ende leert.

-- Führt p_sql aus und rollt die Wirkung SOFORT zurück. Ergebnis 'ok:<n>' oder '<SQLSTATE>: <Meldung>'.
CREATE FUNCTION pg_temp.t20_probe(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'S1T20', MESSAGE = v_n::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state = 'S1T20' THEN
      RETURN 'ok:' || v_msg;
    END IF;
    RETURN v_state || ': ' || v_msg;
  END;
END $f$;

-- p_ist passt auf das LIKE-Muster → p_kurz, sonst p_ist (als Beleg im FEHLER).
CREATE FUNCTION pg_temp.t20_muster(p_ist text, p_like text, p_kurz text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_ist LIKE p_like THEN p_kurz ELSE coalesce(p_ist, 'NULL') END
$f$;

-- Protokollzeilen zu einem Datensatz (als postgres).
CREATE FUNCTION pg_temp.t20_bp(p_tab text, p_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $f$
  SELECT count(*) FROM public.bestandsprotokoll b WHERE b.tabelle = p_tab AND b.datensatz_id = p_id
$f$;

-- Überwachte Spalten eines z_protokoll_aendern-Triggers (Trigger-Argumente aus pg_trigger.tgargs).
CREATE FUNCTION pg_temp.t20_tgargs(p_tab text) RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT coalesce(array_remove(regexp_split_to_array(encode(t.tgargs, 'escape'), '\\000'), ''), '{}'::text[])
    FROM pg_trigger t
   WHERE t.tgrelid = to_regclass(format('public.%I', p_tab)) AND t.tgname = 'z_protokoll_aendern' AND NOT t.tgisinternal
$f$;

-- Mutationshilfe: ersetzt in der Definition von p_fn das Muster p_muster durch p_ersatz und legt die Funktion
-- neu an; greift das Muster nicht, bricht sie ab (sonst liefe die Mutation unbemerkt ins Leere).
CREATE FUNCTION pg_temp.t20_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't20_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei      constant text := '20_sperren_protokoll_trigger';
  v_m          uuid;
  v_t0         timestamptz := clock_timestamp();
  v_erg        text[] := '{}';
  v_a          jsonb;
  v_b          uuid;
  v_mta        uuid;
  v_mw         uuid;
  v_bta        uuid;
  v_n          bigint;
  v_n2         bigint;
  v_txt        text;
  v_arr        text[];
  v_t1         text;
  v_t2         text;
  v_t3         text;
  v_z          jsonb;
  r            record;
  -- E&A
  v_tx_locked  uuid;
  v_tx_offen   uuid;
  v_tx_jan     uuid;
  v_tx_feb     uuid;
  v_tx_mai     uuid;
  v_tx_mai_z   jsonb;
  v_uva_neu    uuid;
  v_uva_gesp   uuid;
  v_ma         uuid;
  v_ma_datum   date;
  -- KAN-149 D3 (Abschluss 2033/03, offen 2033/05)
  v_k1         uuid;
  v_k2         uuid;
  v_k_leer     uuid;
  v_vp         uuid;
  v_vp_leer    jsonb;
  v_vpos       jsonb;
  v_tx_zu      uuid;
  v_tx_gesp    uuid;
  v_tx_of      jsonb;
  v_za_zu      uuid;
  v_za_of      jsonb;
  v_ub_zu      uuid;
  v_ub_of      jsonb;
  v_ma_d3      uuid;
  v_uva_d3_g   uuid;
  v_uva_d3_o   uuid;
  v_beleg      uuid;
  v_tab        text;
  v_zd3        jsonb;
  -- KAN-150 F1a: Stammdaten mit und ohne Bezug
  v_f_wg       uuid;
  v_f_gs       uuid;
  v_f_psm      uuid;
  v_f_bh       uuid;
  v_f_ko       uuid;
  v_f_fi       uuid;
  v_f_vp       uuid;
  v_f_wg0      uuid;
  v_f_gs0      uuid;
  v_f_ko0      uuid;
  v_f_ko1      uuid;
  v_f_fi0      uuid;
  v_f_psm0     uuid;
  -- AMA
  v_ama_best   uuid;
  v_ama_entw   uuid;
  v_pos_best   jsonb;
  v_pos_entw   jsonb;
  -- KAN-37: abgegebene Meldung in B (echter Betrieb) – Sperre auch für postgres/Service-Role
  v_jg_ama_b   uuid;
  v_ama_b      uuid;
  v_pos_b      jsonb;
  -- KAN-37 B: Einreichen mit Snapshot (meldung_abgaben)
  v_ama_b2     uuid;
  v_abg        uuid;
  -- KAN-37 C: Lese-Sperre nach dem Einreichen
  v_jg_c       uuid;
  v_ama_c      uuid;
  v_ep_c       uuid;
  -- sonstige Sperren
  v_jg_abg     uuid;
  v_jg_ama     uuid;
  v_vp_storno  uuid;
  v_beh_m      uuid;
  -- Protokoll
  v_wa_m       uuid;
  v_spalte_frei text;
  v_ku         uuid[] := '{}';
  v_ku_b1      uuid;
  v_ku_b2      uuid;
  v_pb         uuid;
  v_bp         record;
  -- Mandantengleichheit
  v_beh_ng     uuid;
  v_beh_gl     uuid;
  v_beh_bel    uuid;
  v_wa_b       uuid;
  v_freigabe   uuid;
  v_anl_m      uuid;
  v_anl_b      uuid;
  v_tx_b       uuid;
  v_tx_m       uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 0. Aufbau (als postgres) ─────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;

  -- E&A: eigene gesperrte Buchung, gesperrte UVA und Monatsabschluss 2032/06 im Musterhof. Gesperrt anlegen lehnen
  -- a_ea_periodensperre/a_ea_abschluss_schutz seit KAN-149 D3 auch für postgres ab – deshalb als Wartung mit Flag
  -- (nur für diese drei Zeilen; die Prüfungen unten laufen ohne Flag)
  PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
  v_tx_locked := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2032-06-15", "is_locked": "true"}') ->> 'id')::uuid;
  v_uva_gesp := (pg_temp.s112_zeile('ea_uva', v_m, '{"jahr": "2032", "zeitraum": "Q2", "gesperrt": "true"}') ->> 'id')::uuid;
  v_ma := (pg_temp.s112_zeile('ea_monatsabschluss', v_m, '{"jahr": "2032", "monat": "6"}') ->> 'id')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_ma_datum := DATE '2032-06-15';
  -- eigene offene Buchungen 2031 (Monate ohne Abschluss) und eine offene UVA 2031 Q1
  v_tx_jan := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-01-15", "is_locked": "false"}') ->> 'id')::uuid;
  v_tx_feb := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-02-15", "is_locked": "false"}') ->> 'id')::uuid;
  v_tx_offen := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-03-15", "is_locked": "false"}') ->> 'id')::uuid;
  v_tx_mai_z := pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-05-10", "is_locked": "false"}');
  v_tx_mai := (v_tx_mai_z ->> 'id')::uuid;
  v_uva_neu := (pg_temp.s112_zeile('ea_uva', v_m, '{"jahr": "2031", "zeitraum": "Q1", "gesperrt": "false"}') ->> 'id')::uuid;

  -- KAN-149 D3: zwei Konten mit Bewegungen, ein leeres; offener Verkauf (mit Position, Zahlungen) und ein Verkauf ohne
  -- Kinder; je Tabelle eine Zeile im Monat 2033/03 (danach abgeschlossen) und eine im offenen Monat 2033/05; eine
  -- gesperrte Buchung 2033/03 (Wartungs-Flag); gesperrte UVA 2033/Q4 (Flag), offene UVA 2033/03; verbuchter Beleg
  v_k1 := (pg_temp.s112_zeile('konten', v_m, '{"name": "S112TEST D3 Konto 1"}') ->> 'id')::uuid;
  v_k2 := (pg_temp.s112_zeile('konten', v_m, '{"name": "S112TEST D3 Konto 2"}') ->> 'id')::uuid;
  v_k_leer := (pg_temp.s112_zeile('konten', v_m, '{"name": "S112TEST D3 Konto leer"}') ->> 'id')::uuid;
  v_vp := (pg_temp.s112_beispiel('verkaufsposten', v_m, v_mta) ->> 'id')::uuid;
  v_vp_leer := pg_temp.s112_beispiel('verkaufsposten', v_m, v_mta);
  v_vpos := pg_temp.s112_beispiel('verkauf_positionen', v_m, v_mta, jsonb_build_object('verkaufsposten_id', v_vp));
  v_tx_zu := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta,
                jsonb_build_object('datum', '2033-03-10', 'is_locked', false, 'konto_id', v_k1)) ->> 'id')::uuid;
  v_tx_of := pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, jsonb_build_object('datum', '2033-05-10', 'is_locked', false, 'konto_id', v_k1));
  v_za_zu := (pg_temp.s112_beispiel('zahlungen', v_m, v_mta,
                jsonb_build_object('datum', '2033-03-10', 'verkaufsposten_id', v_vp, 'konto_id', v_k1)) ->> 'id')::uuid;
  v_za_of := pg_temp.s112_beispiel('zahlungen', v_m, v_mta, jsonb_build_object('datum', '2033-05-10', 'verkaufsposten_id', v_vp, 'konto_id', v_k1));
  v_ub_zu := (pg_temp.s112_beispiel('konto_umbuchungen', v_m, v_mta,
                jsonb_build_object('datum', '2033-03-10', 'von_konto_id', v_k1, 'nach_konto_id', v_k2)) ->> 'id')::uuid;
  v_ub_of := pg_temp.s112_beispiel('konto_umbuchungen', v_m, v_mta,
               jsonb_build_object('datum', '2033-05-10', 'von_konto_id', v_k1, 'nach_konto_id', v_k2));
  v_uva_d3_o := (pg_temp.s112_zeile('ea_uva', v_m, '{"jahr": "2033", "zeitraum": "03", "gesperrt": "false"}') ->> 'id')::uuid;
  v_beleg := (pg_temp.s112_zeile('ea_belege', v_m, jsonb_build_object('status', 'verbucht', 'dateiname', 'S112TEST D3 Beleg.pdf',
                'storage_pfad', v_m::text || '/s112test/d3-beleg.pdf', 'ea_transaktion_id', v_tx_zu)) ->> 'id')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
  v_tx_gesp := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta,
                  jsonb_build_object('datum', '2033-03-12', 'is_locked', true, 'konto_id', v_k1)) ->> 'id')::uuid;
  v_uva_d3_g := (pg_temp.s112_zeile('ea_uva', v_m, '{"jahr": "2033", "zeitraum": "Q4", "gesperrt": "true"}') ->> 'id')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_ma_d3 := (pg_temp.s112_zeile('ea_monatsabschluss', v_m, '{"jahr": "2033", "monat": "3"}') ->> 'id')::uuid;

  -- abgeschlossener Jahrgang (eigener, nächstes freies Jahr), stornierter Verkaufsposten
  v_jg_abg := (pg_temp.s112_zeile('weinjahrgaenge', v_m, '{"abgeschlossen": "true"}') ->> 'id')::uuid;
  v_vp_storno := (pg_temp.s112_beispiel('verkaufsposten', v_m, v_mta, '{"storniert": "true"}') ->> 'id')::uuid;

  -- AMA: eigene Meldung mit Position, danach bestätigt (eigener Jahrgang, UNIQUE tenant_id/jahrgang_id);
  -- eigener Entwurf samt Position
  v_jg_ama := (pg_temp.s112_zeile('weinjahrgaenge', v_m) ->> 'id')::uuid;
  v_ama_best := (pg_temp.s112_beispiel('ama_erntemeldungen', v_m, v_mta, jsonb_build_object('jahrgang_id', v_jg_ama)) ->> 'id')::uuid;
  v_pos_best := pg_temp.s112_zeile('ama_meldepositionen', v_m, jsonb_build_object('meldung_id', v_ama_best));
  UPDATE public.ama_erntemeldungen SET status = 'bestaetigt' WHERE id = v_ama_best;
  v_ama_entw := (pg_temp.s112_beispiel('ama_erntemeldungen', v_m, v_mta) ->> 'id')::uuid;
  v_pos_entw := pg_temp.s112_zeile('ama_meldepositionen', v_m, jsonb_build_object('meldung_id', v_ama_entw));

  -- Protokoll: eigener Wein im Musterhof mit Menge in einem eigenen Behälter, eigene keller_umzuege (3 × M, 2 × B),
  -- eigene pressung_behaelter
  v_beh_m := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST eigen", "gemeinsam": "false"}') ->> 'id')::uuid;
  v_wa_m := (pg_temp.s112_beispiel('weinausbau', v_m, v_mta,
               jsonb_build_object('menge_liter', 100, 'aktiv', true, 'behaelter_id', v_beh_m)) ->> 'id')::uuid;
  v_ku := ARRAY[(pg_temp.s112_beispiel('keller_umzuege', v_m, v_mta) ->> 'id')::uuid,
                (pg_temp.s112_beispiel('keller_umzuege', v_m, v_mta) ->> 'id')::uuid,
                (pg_temp.s112_beispiel('keller_umzuege', v_m, v_mta) ->> 'id')::uuid];
  v_ku_b1 := (pg_temp.s112_beispiel('keller_umzuege', v_b, v_bta) ->> 'id')::uuid;
  v_ku_b2 := (pg_temp.s112_beispiel('keller_umzuege', v_b, v_bta) ->> 'id')::uuid;
  v_pb := (pg_temp.s112_beispiel('pressung_behaelter', v_m, v_mta) ->> 'id')::uuid;
  SELECT a.attname::text INTO v_spalte_frei FROM pg_attribute a
   WHERE a.attrelid = 'public.weinausbau'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND a.atttypid = 'text'::regtype AND NOT (a.attname::text = ANY (pg_temp.t20_tgargs('weinausbau')))
     AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
   ORDER BY (a.attname = 'notizen') DESC, a.attnum LIMIT 1;

  -- Mandantengleichheit: M-Behälter nicht gemeinsam, M-Behälter gemeinsam und leer, gemeinsam und von M belegt
  v_beh_ng := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST nicht gemeinsam", "gemeinsam": "false"}') ->> 'id')::uuid;
  v_beh_gl := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST gemeinsam leer", "gemeinsam": "true"}') ->> 'id')::uuid;
  v_beh_bel := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST gemeinsam belegt", "gemeinsam": "true"}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('weinausbau', v_m, v_mta,
            jsonb_build_object('menge_liter', 100, 'aktiv', true, 'behaelter_id', v_beh_bel));
  v_wa_b := (pg_temp.s112_beispiel('weinausbau', v_b, v_bta, '{"menge_liter": "100", "aktiv": "true"}') ->> 'id')::uuid;
  v_anl_m := (pg_temp.s112_zeile('ea_anlagen', v_m) ->> 'id')::uuid;
  v_anl_b := (pg_temp.s112_beispiel('ea_anlagen', v_b, v_bta) ->> 'id')::uuid;
  v_tx_b := (pg_temp.s112_beispiel('ea_transaktionen', v_b, v_bta) ->> 'id')::uuid;
  v_tx_m := v_tx_mai;

  -- Belege: die Beispielzeilen existieren (sonst wären k0/0-Ergebnisse unten wertlos)
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_tx_locked', (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_locked AND is_locked), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_uva_gesperrt', (SELECT count(*) FROM public.ea_uva WHERE id = v_uva_gesp AND gesperrt), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_monatsabschluss', v_ma IS NOT NULL AND v_ma_datum IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_ama_bestaetigt',
    (SELECT status FROM public.ama_erntemeldungen WHERE id = v_ama_best) || '/' || (v_pos_best IS NOT NULL), 'bestaetigt/true');
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_ama_entwurf', (SELECT status FROM public.ama_erntemeldungen WHERE id = v_ama_entw), 'entwurf');
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_jahrgang_abgeschlossen', v_jg_abg IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_verkaufsposten_storniert', v_vp_storno IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_weinausbau_m', v_wa_m IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_spalte_nicht_ueberwacht', v_spalte_frei IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_behaelter_belegt', v_beh_bel IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_2031_offen',
    (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2031), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_d3_zeilen',
    concat_ws('|', (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2033),
                   (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_gesp AND is_locked),
                   (SELECT count(*) FROM public.ea_uva WHERE id = v_uva_d3_g AND gesperrt),
                   (SELECT count(*) FROM public.ea_uva WHERE id = v_uva_d3_o AND NOT gesperrt),
                   (SELECT count(*) FROM public.ea_belege WHERE id = v_beleg AND status = 'verbucht'),
                   (v_tx_zu IS NOT NULL AND v_za_zu IS NOT NULL AND v_ub_zu IS NOT NULL AND v_tx_of IS NOT NULL
                    AND v_za_of IS NOT NULL AND v_ub_of IS NOT NULL AND v_vpos IS NOT NULL AND v_vp_leer IS NOT NULL)),
    '1|1|1|1|1|t');

  -- ── Mutationen (nur im Mutationsmodus; nach dem Aufbau, vor den Prüfungen) ──────────────────────────
  PERFORM pg_temp.s112_mutiere('is_locked_offen',
    $m$ALTER POLICY ea_tx_update ON public.ea_transaktionen USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
         WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])))$m$);
  PERFORM pg_temp.s112_mutiere('ama_status_offen',
    $m$ALTER POLICY "ama: winzer+ can update (nur Entwurf)" ON public.ama_erntemeldungen USING (tenant_id IN (SELECT m.tenant_id
         FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
          AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])))$m$);
  PERFORM pg_temp.s112_mutiere('truncate_trigger_weg', $m$DROP TRIGGER z_protokoll_truncate ON public.keller_umzuege$m$);
  PERFORM pg_temp.s112_mutiere('protokoll_aendern_weg', $m$DROP TRIGGER z_protokoll_aendern ON public.weinausbau$m$);
  PERFORM pg_temp.s112_mutiere('protokoll_loeschen_weg', $m$DROP TRIGGER z_protokoll_loeschen ON public.keller_umzuege$m$);
  PERFORM pg_temp.s112_mutiere('gebinde_offen',
    $m$CREATE OR REPLACE FUNCTION public.weinausbau_gebinde_pruefen() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
       SET search_path = public AS $x$ BEGIN RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('gebinde_freigabe_inaktiv',
    $m$SELECT pg_temp.t20_ersetze('public.weinausbau_gebinde_pruefen()'::regprocedure, 'AND f[.]aktiv[)][)] THEN', ')) THEN')$m$);
  PERFORM pg_temp.s112_mutiere('sperre_monat_fremd',
    $m$SELECT pg_temp.t20_ersetze('public.sperre_ea_monat(uuid,smallint,smallint)'::regprocedure,
       'pruefe_tenant_zugriff[(]p_tenant_id,',
       'pruefe_tenant_zugriff((SELECT m.tenant_id FROM public.tenant_memberships m WHERE m.user_id = auth.uid() AND m.aktiv AND m.role IN (''system_admin'', ''tenant_admin'') ORDER BY m.tenant_id LIMIT 1),')$m$);
  PERFORM pg_temp.s112_mutiere('ama_pos_delete_offen',
    $m$CREATE POLICY s112test_ama_pos_delete_offen ON public.ama_meldepositionen FOR DELETE TO authenticated
       USING (meldung_id IN (SELECT m.id FROM public.ama_erntemeldungen m WHERE m.tenant_id IN (SELECT public.get_user_tenant_ids())))$m$);
  PERFORM pg_temp.s112_mutiere('anlage_tenant_offen',
    $m$CREATE OR REPLACE FUNCTION public.trg_ea_transaktion_anlage_tenant() RETURNS trigger LANGUAGE plpgsql
       SET search_path = public, extensions AS $x$ BEGIN RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('kind_tenant_ama_weg',
    $m$SELECT pg_temp.t20_ersetze('public.bestandsprotokoll_schreiben()'::regprocedure,
       'WHEN ''ama_meldepositionen'' THEN', 'WHEN ''s112test_nie'' THEN')$m$);
  PERFORM pg_temp.s112_mutiere('freigaben_schreibbar',
    $m$CREATE POLICY s112test_freigaben_offen ON public.keller_freigaben FOR ALL TO authenticated USING (true) WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('stammdaten_loeschsperre_weg', $m$DROP TRIGGER a_stammdaten_loeschsperre ON public.kontakte$m$);   -- KAN-150 F1a
  PERFORM pg_temp.s112_mutiere('grundstueck_protokoll_weg', $m$DROP TRIGGER z_protokoll_aendern ON public.grundstuecke$m$);   -- KAN-150 F1a
  PERFORM pg_temp.s112_mutiere('periodensperre_weg', $m$DROP TRIGGER a_ea_periodensperre ON public.ea_transaktionen$m$);
  PERFORM pg_temp.s112_mutiere('abschluss_schutz_weg', $m$DROP TRIGGER a_ea_abschluss_schutz ON public.ea_monatsabschluss$m$);

  -- ── 1. E&A-Sperren ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ea_transaktionen WHERE id = %L AND is_locked', v_tx_locked)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_update',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = beschreibung WHERE id = %L', v_tx_locked)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_transaktionen WHERE id = %L', v_tx_locked)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_entsperren',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET is_locked = false WHERE id = %L', v_tx_locked)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_offen_update_erlaubt',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = beschreibung WHERE id = %L', v_tx_offen)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperren_offen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET is_locked = true WHERE id = %L', v_tx_offen)), 'R');
  PERFORM pg_temp.s112_als_postgres();

  -- sperre_ea_monat: m_w darf nicht; m_ta sperrt 2031-01..03 (Zahl gesperrter Buchungen steigt um 3)
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_winzer',
    pg_temp.s112_versuch(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 1::smallint)', v_m)), 'T');
  -- fremder Betrieb: b_ta (tenant_admin in B) darf keinen Monat von M sperren; s112_fehlertext rollt einen
  -- Erfolg nicht zurück, deshalb danach der Beleg, dass für M 2031/04 kein Abschluss entstanden ist
  PERFORM pg_temp.s112_als(v_bta);
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 4::smallint)', v_m));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_fremd',
    pg_temp.t20_muster(v_txt, '42501:%', '42501') || '/'
      || (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2031 AND monat = 4), '42501/0');
  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE tenant_id = v_m AND is_locked;
  PERFORM pg_temp.s112_als(v_mta);
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2031::smallint, %L)', v_m, 'Q1'));
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_ohne_abschluss',
    pg_temp.t20_muster(v_txt, 'P0001: Monatsabschluss fehlt%', 'P0001 Monatsabschluss fehlt'), 'P0001 Monatsabschluss fehlt');
  v_arr := ARRAY[
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 1::smallint)', v_m)),
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 2::smallint)', v_m)),
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 3::smallint)', v_m))];
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_aufruf', array_to_string(v_arr, ','), 'ok,ok,ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n2 FROM public.ea_transaktionen WHERE tenant_id = v_m AND is_locked;
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_anzahl_steigt', v_n2 - v_n, 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_buchungen',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id IN (v_tx_jan, v_tx_feb, v_tx_offen) AND is_locked), 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_abschluss',
    (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2031 AND monat IN (1, 2, 3)), 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_mai_offen',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_mai AND NOT is_locked), 1::bigint);
  -- sperre_ea_uva: Q1 jetzt vollständig → ok und UVA gesperrt; Q2 ohne Abschlüsse → P0001
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q1',
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2031::smallint, %L)', v_m, 'Q1')), 'ok');
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2031::smallint, %L)', v_m, 'Q2'));
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q2_unvollstaendig',
    pg_temp.t20_muster(v_txt, 'P0001: Monatsabschluss fehlt%', 'P0001 Monatsabschluss fehlt'), 'P0001 Monatsabschluss fehlt');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q1_gesperrt',
    (SELECT gesperrt FROM public.ea_uva WHERE id = v_uva_neu), true);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q2_mai_offen',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_mai AND NOT is_locked), 1::bigint);

  -- ── 2. AMA-Status ─────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ama_bestaetigt_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ama_erntemeldungen WHERE id = %L', v_ama_best)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_bestaetigt_update',
    pg_temp.s112_versuch(format('UPDATE public.ama_erntemeldungen SET notizen = notizen WHERE id = %L', v_ama_best)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_entwurf_update',
    pg_temp.s112_versuch(format('UPDATE public.ama_erntemeldungen SET notizen = notizen WHERE id = %L', v_ama_entw)), 'k1');
  -- KAN-148 C2: Trigger a_ama_position_schutz lehnt vor der RLS-Prüfung ab (T statt R)
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_insert_bestaetigt',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ama_meldepositionen', v_pos_best)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_update_bestaetigt',
    pg_temp.s112_versuch(format('UPDATE public.ama_meldepositionen SET menge_kg = menge_kg WHERE meldung_id = %L', v_ama_best)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_bestaetigt_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ama_meldepositionen WHERE meldung_id = %L', v_ama_best)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_delete_bestaetigt',
    pg_temp.s112_versuch(format('DELETE FROM public.ama_meldepositionen WHERE meldung_id = %L', v_ama_best)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_insert_entwurf',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ama_meldepositionen', v_pos_entw)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_update_entwurf',
    pg_temp.s112_versuch(format('UPDATE public.ama_meldepositionen SET menge_kg = menge_kg WHERE id = %L', v_pos_entw ->> 'id')), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_bestaetigt_existiert',
    (SELECT count(*) > 0 FROM public.ama_meldepositionen WHERE meldung_id = v_ama_best), true);

  -- ── 3. Ehemals Lücke B7 (seit KAN-149 D3 in der Datenbank gesperrt) und bekannte Lücke B8 ─────────────
  -- a_ea_periodensperre bzw. a_ea_abschluss_schutz lehnen ab (42501 → T), bevor RLS die Zeile prüft
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_insert_abgeschlossener_monat',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_mai_z, jsonb_build_object('datum', v_ma_datum))), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_insert_is_locked',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_mai_z, '{"is_locked": true}'::jsonb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_datum_in_abgeschlossenen_monat',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET datum = %L::date WHERE id = %L', v_ma_datum, v_tx_mai)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_uva_entsperren',
    pg_temp.s112_versuch(format('UPDATE public.ea_uva SET gesperrt = false WHERE id = %L', v_uva_gesp)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_uva_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_uva WHERE id = %L', v_uva_gesp)), 'T');
  -- B8 behoben (KAN-159 Teil 2, Trigger a_jahrgang_abschluss_schutz): abgeschlossener Jahrgang unveränderlich
  v_erg := v_erg || pg_temp.s112_erwarte('jahrgang_abgeschlossen_wieder_oeffnen',
    pg_temp.s112_versuch(format('UPDATE public.weinjahrgaenge SET abgeschlossen = false WHERE id = %L', v_jg_abg)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('jahrgang_abgeschlossen_notiz',
    pg_temp.s112_versuch(format('UPDATE public.weinjahrgaenge SET notizen = %L WHERE id = %L', 'S112TEST', v_jg_abg)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('jahrgang_abgeschlossen_ama_felder_frei',
    pg_temp.s112_versuch(format('UPDATE public.weinjahrgaenge SET ama_meldungsnr = ama_meldungsnr WHERE id = %L', v_jg_abg)), 'k1');
  -- B8 behoben (KAN-149 D1, Trigger a_verkauf_storno_schutz): Storno eines Verkaufs nicht rückgängig machbar
  v_erg := v_erg || pg_temp.s112_erwarte('storno_rueckgaengig',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = false WHERE id = %L', v_vp_storno)), 'T');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('monatsabschluss_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_monatsabschluss WHERE id = %L', v_ma)), 'T');
  -- B8 behoben (KAN-148 C2, Trigger a_ama_schutz): bestätigte AMA-Meldung nicht löschbar, auch nicht als tenant_admin
  v_erg := v_erg || pg_temp.s112_erwarte('ama_bestaetigt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ama_erntemeldungen WHERE id = %L', v_ama_best)), 'T');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 3b. KAN-149 D3: Periodensperre, Abschluss, Löschsperre, Konten, Verkaufsstorno ───────────────────
  -- Einfügen, Ändern und Datum-Verschieben in den abgeschlossenen Monat 2033/03 (m_ta); Gegenprobe im offenen 2033/05
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_abgeschlossen:ea_transaktionen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_of, '{"datum": "2033-03-20"}'::jsonb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_abgeschlossen:zahlungen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('zahlungen', v_za_of, '{"datum": "2033-03-20"}'::jsonb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_abgeschlossen:konto_umbuchungen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('konto_umbuchungen', v_ub_of, '{"datum": "2033-03-20"}'::jsonb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_offen:ea_transaktionen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_of, '{"datum": "2033-05-20"}'::jsonb)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_offen:zahlungen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('zahlungen', v_za_of, '{"datum": "2033-05-20"}'::jsonb)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_offen:konto_umbuchungen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('konto_umbuchungen', v_ub_of, '{"datum": "2033-05-20"}'::jsonb)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_is_locked:ea_transaktionen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_of, '{"is_locked": true}'::jsonb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_abgeschlossen:ea_transaktionen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = coalesce(beschreibung, '''') || '' D3'' WHERE id = %L', v_tx_zu)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_abgeschlossen:zahlungen',
    pg_temp.s112_versuch(format('UPDATE public.zahlungen SET betrag = betrag + 1 WHERE id = %L', v_za_zu)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_datum_in_abgeschlossen:ea_transaktionen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET datum = %L::date WHERE id = %L', '2033-03-20', v_tx_of ->> 'id')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_datum_in_abgeschlossen:zahlungen',
    pg_temp.s112_versuch(format('UPDATE public.zahlungen SET datum = %L::date WHERE id = %L', '2033-03-20', v_za_of ->> 'id')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_offen:ea_transaktionen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = coalesce(beschreibung, '''') || '' D3'' WHERE id = %L', v_tx_of ->> 'id')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_offen:zahlungen',
    pg_temp.s112_versuch(format('UPDATE public.zahlungen SET betrag = betrag + 1 WHERE id = %L', v_za_of ->> 'id')), 'k1');
  -- Winzer ebenso
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('d3_insert_abgeschlossen_winzer:zahlungen',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('zahlungen', v_za_of, '{"datum": "2033-03-20"}'::jsonb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_abgeschlossen_winzer:ea_transaktionen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = coalesce(beschreibung, '''') || '' D3'' WHERE id = %L', v_tx_zu)), 'T');
  PERFORM pg_temp.s112_als_postgres();
  -- konto_umbuchungen hat keine UPDATE-Policy (k0 für alle Benutzer) – die Periodensperre gilt auch für postgres
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_abgeschlossen_postgres:konto_umbuchungen',
    pg_temp.s112_versuch(format('UPDATE public.konto_umbuchungen SET betrag = betrag + 1 WHERE id = %L', v_ub_zu)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_abgeschlossen_postgres:ea_transaktionen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET betrag_netto = betrag_netto + 1 WHERE id = %L', v_tx_zu)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_update_offen_postgres:konto_umbuchungen',
    pg_temp.s112_versuch(format('UPDATE public.konto_umbuchungen SET betrag = betrag + 1 WHERE id = %L', v_ub_of ->> 'id')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_entsperren_postgres:ea_transaktionen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET is_locked = false WHERE id = %L', v_tx_gesp)), 'T');

  -- Abgleich und Storno einer gesperrten Buchung im abgeschlossenen Monat bleiben möglich (m_ta)
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('d3_abgleich_gesperrt',
    pg_temp.s112_fehlertext(format('SELECT public.setze_kontobewegung_abgeglichen(%L::uuid, %L, %L::uuid, true)', v_m, 'ea_transaktion', v_tx_gesp))
      || '/' || pg_temp.s112_fehlertext(format('SELECT public.setze_kontobewegung_abgeglichen(%L::uuid, %L, %L::uuid, true)', v_m, 'zahlung', v_za_zu))
      || '/' || pg_temp.s112_fehlertext(format('SELECT public.setze_kontobewegung_abgeglichen(%L::uuid, %L, %L::uuid, true)', v_m, 'umbuchung_von', v_ub_zu)),
    'ok/ok/ok');
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.s112_ea_stornieren(%L::uuid, %L::uuid, %L, %L::date)',
                                          v_m, v_tx_of ->> 'id', 'S112TEST Storno D3 ins Abgeschlossene', '2033-03-25'));
  v_erg := v_erg || pg_temp.s112_erwarte('d3_storno_datum_abgeschlossen', pg_temp.t20_muster(v_txt, '42501:%', '42501'), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_storno_gesperrt',
    pg_temp.s112_fehlertext(format('SELECT public.s112_ea_stornieren(%L::uuid, %L::uuid, %L, %L::date)',
                                   v_m, v_tx_gesp, 'S112TEST Storno D3 gesperrt', '2033-05-25')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('d3_abgleich_wirkung',
    concat_ws('|', (SELECT abgeglichen FROM public.ea_transaktionen WHERE id = v_tx_gesp),
                   (SELECT abgeglichen FROM public.zahlungen WHERE id = v_za_zu),
                   (SELECT von_abgeglichen FROM public.konto_umbuchungen WHERE id = v_ub_zu)), 't|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_storno_wirkung',
    concat_ws('|', (SELECT storniert_am IS NOT NULL AND is_locked FROM public.ea_transaktionen WHERE id = v_tx_gesp),
                   (SELECT count(*) FROM public.ea_transaktionen WHERE storno_von_id = v_tx_gesp AND datum = DATE '2033-05-25' AND NOT is_locked)),
    't|1');

  -- Abschluss: gesperrte UVA, Monatsabschluss, verbuchter Beleg unveränderlich; UVA nur über sperre_ea_uva sperren
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_gesperrt_aendern',
    pg_temp.s112_versuch(format('UPDATE public.ea_uva SET notizen = %L WHERE id = %L', 'S112TEST D3', v_uva_d3_g)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_gesperrt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_uva WHERE id = %L', v_uva_d3_g)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_direkt_sperren',
    pg_temp.s112_versuch(format('UPDATE public.ea_uva SET gesperrt = true WHERE id = %L', v_uva_d3_o)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_gesperrt_anlegen',
    pg_temp.s112_versuch(format('INSERT INTO public.ea_uva (tenant_id, jahr, zeitraum, gesperrt) VALUES (%L, 2033, %L, true)', v_m, 'Q3')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_offen_aendern',
    pg_temp.s112_versuch(format('UPDATE public.ea_uva SET notizen = %L WHERE id = %L', 'S112TEST D3', v_uva_d3_o)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_monatsabschluss_aendern',
    pg_temp.s112_versuch(format('UPDATE public.ea_monatsabschluss SET monat = 4 WHERE id = %L', v_ma_d3)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_monatsabschluss_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_monatsabschluss WHERE id = %L', v_ma_d3)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_beleg_verbucht_aendern',
    pg_temp.s112_versuch(format('UPDATE public.ea_belege SET dateiname = dateiname || %L WHERE id = %L', ' x', v_beleg)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_beleg_verbucht_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_belege WHERE id = %L', v_beleg)), 'T');

  -- Konten: mit Bewegungen nicht löschbar, leeres Konto schon
  v_erg := v_erg || pg_temp.s112_erwarte('d3_konto_mit_buchungen_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.konten WHERE id = %L', v_k2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_konto_leer_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.konten WHERE id = %L', v_k_leer)), 'k1');

  -- Verkaufsstorno: Grund Pflicht (mindestens 10 Zeichen)
  v_erg := v_erg || pg_temp.s112_erwarte('d3_verkauf_storno_ohne_grund',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true WHERE id = %L', v_vp_leer ->> 'id')), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_verkauf_storno_kurzer_grund',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L', 'zu kurz', v_vp_leer ->> 'id')), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_verkauf_storno_mit_grund',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L',
                                'S112TEST Storno-Grund D3', v_vp_leer ->> 'id')), 'k1');

  -- Löschsperre: DELETE auf den fünf Tabellen (offener Monat) als m_ta und m_w → k0, Policy-Schicht 'nein'
  FOREACH v_txt IN ARRAY ARRAY['m_ta', 'm_w'] LOOP
    PERFORM pg_temp.s112_als(CASE v_txt WHEN 'm_ta' THEN v_mta ELSE v_mw END);
    FOR v_tab, v_zd3 IN SELECT x.t, x.z FROM (VALUES ('ea_transaktionen', v_tx_of), ('zahlungen', v_za_of),
                                                     ('konto_umbuchungen', v_ub_of), ('verkaufsposten', v_vp_leer),
                                                     ('verkauf_positionen', v_vpos)) x (t, z) LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('d3_delete_' || v_txt || ':' || v_tab,
        pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tab, pg_temp.s112_pk_where(v_tab, v_zd3)))
          || '/' || pg_temp.s112_policy(v_tab, 'DELETE', v_zd3), 'k0/nein');
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  -- als postgres ohne Flag: Löschsperre (T); mit s112.loeschen_erlaubt = Musterhof (Wartung): gelöscht (k1, sofort
  -- zurückgerollt); im abgeschlossenen Monat antwortet zuerst die Periodensperre; ein fremdes Flag gibt nichts frei
  FOR v_tab, v_zd3 IN SELECT x.t, x.z FROM (VALUES ('ea_transaktionen', v_tx_of), ('zahlungen', v_za_of),
                                                   ('konto_umbuchungen', v_ub_of), ('verkaufsposten', v_vp_leer),
                                                   ('verkauf_positionen', v_vpos)) x (t, z) LOOP
    v_t1 := pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tab, pg_temp.s112_pk_where(v_tab, v_zd3)));
    PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
    v_t2 := pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tab, pg_temp.s112_pk_where(v_tab, v_zd3)));
    PERFORM set_config('s112.loeschen_erlaubt', '', true);
    v_erg := v_erg || pg_temp.s112_erwarte('d3_delete_postgres:' || v_tab, v_t1 || '/' || v_t2, 'T/k1');
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('d3_delete_postgres_abgeschlossen:ea_transaktionen',
    pg_temp.t20_muster(pg_temp.t20_probe(format('DELETE FROM public.ea_transaktionen WHERE id = %L', v_tx_zu)),
                       '42501: %abgeschlossen%', '42501 abgeschlossen'), '42501 abgeschlossen');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('d3_delete_postgres_fremdes_flag',
    pg_temp.s112_versuch(format('DELETE FROM public.zahlungen WHERE id = %L', v_za_of ->> 'id')), 'T');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  -- UVA sperren über sperre_ea_uva (m_ta; Monat 2033/03 abgeschlossen) – zum Schluss, sperrt auch die Buchungen 2033/03
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_sperren_rpc',
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2033::smallint, %L)', v_m, '03')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_sperren_flag_zurueck',
    coalesce(nullif(current_setting('s112.ea_sperre', true), ''), 'leer'), 'leer');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('d3_uva_sperren_wirkung',
    concat_ws('|', (SELECT gesperrt FROM public.ea_uva WHERE id = v_uva_d3_o),
                   (SELECT is_locked FROM public.ea_transaktionen WHERE id = v_tx_zu)), 't|t');

  -- ── 3c. KAN-150 F1a: Stammdaten mit Bezug nur deaktivieren ──────────────────────────────────────────────
  -- Synthetische Stammdaten im Musterhof (als postgres): Ried A mit Grundstück A, Maßnahme nur über das Grundstück
  -- (behandlung_grundstuecke, Maßnahme ohne weingarten_id) mit PSM A; Verkauf mit Kontakt A und Firma A. Ohne
  -- Bezug: Ried/Grundstück/Kontakt/Firma/PSM „leer“ (zuletzt angelegt, damit keine Beispielzeile auf sie verweist).
  v_f_wg := (pg_temp.s112_beispiel('weingarten', v_m, v_mta) ->> 'id')::uuid;
  v_f_gs := (pg_temp.s112_beispiel('grundstuecke', v_m, v_mta, jsonb_build_object('weingarten_id', v_f_wg)) ->> 'id')::uuid;
  v_f_psm := (pg_temp.s112_zeile('pflanzenschutzmittel', v_m, '{"name": "S112TEST F1a PSM"}') ->> 'id')::uuid;
  v_f_bh := (pg_temp.s112_beispiel('behandlungen', v_m, v_mta,
               jsonb_build_object('weingarten_id', NULL, 'psm_id', v_f_psm, 'duengemittel_id', NULL)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_zeile('behandlung_grundstuecke', v_m, jsonb_build_object('behandlung_id', v_f_bh, 'grundstueck_id', v_f_gs));
  v_f_ko := (pg_temp.s112_beispiel('kontakte', v_m, v_mta) ->> 'id')::uuid;
  v_f_fi := (pg_temp.s112_beispiel('firmen', v_m, v_mta) ->> 'id')::uuid;
  v_f_vp := (pg_temp.s112_beispiel('verkaufsposten', v_m, v_mta,
               jsonb_build_object('kontakt_id', v_f_ko, 'firma_id', v_f_fi, 'zh_kontakt_id', NULL)) ->> 'id')::uuid;
  v_f_wg0 := (pg_temp.s112_beispiel('weingarten', v_m, v_mta) ->> 'id')::uuid;
  v_f_gs0 := (pg_temp.s112_beispiel('grundstuecke', v_m, v_mta, jsonb_build_object('weingarten_id', v_f_wg0)) ->> 'id')::uuid;
  v_f_ko0 := (pg_temp.s112_beispiel('kontakte', v_m, v_mta) ->> 'id')::uuid;
  v_f_ko1 := (pg_temp.s112_beispiel('kontakte', v_m, v_mta) ->> 'id')::uuid;
  v_f_fi0 := (pg_temp.s112_beispiel('firmen', v_m, v_mta) ->> 'id')::uuid;
  v_f_psm0 := (pg_temp.s112_zeile('pflanzenschutzmittel', v_m, '{"name": "S112TEST F1a PSM leer"}') ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_beleg_fixtures',
    concat_ws('|', (SELECT count(*) FROM public.behandlung_grundstuecke WHERE behandlung_id = v_f_bh AND grundstueck_id = v_f_gs),
                   (SELECT weingarten_id IS NULL AND psm_id = v_f_psm FROM public.behandlungen WHERE id = v_f_bh),
                   (SELECT kontakt_id = v_f_ko AND firma_id = v_f_fi FROM public.verkaufsposten WHERE id = v_f_vp),
                   (SELECT count(*) FROM public.grundstuecke WHERE id = v_f_gs0 AND weingarten_id = v_f_wg0 AND aktiv AND deaktiviert_am IS NULL)),
    '1|t|t|1');

  -- Katalog: a_stammdaten_loeschsperre (BEFORE DELETE FOR EACH ROW = tgtype 11) genau auf der Soll-Liste
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgname = 'a_stammdaten_loeschsperre'
     AND t.tgfoid = 'public.s112_stammdaten_loeschsperre()'::regprocedure AND t.tgtype = 11 AND t.tgenabled = 'O';
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_stammdaten_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('stammdaten_loeschsperre')) x));

  -- Bezugszähler (RPC s112_stammdaten_bezuege): jedes Mitglied (hier der Leser), nur der eigene Betrieb; direkt
  -- aufgerufen (s112_zaehle erwartet eine Zahl), Fehlerfälle über s112_zaehle
  PERFORM pg_temp.s112_als((v_a ->> 'm_l')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_bezuege_zaehler',
    concat_ws('|',
      public.s112_stammdaten_bezuege(v_m, 'weingarten', v_f_wg)::text,
      public.s112_stammdaten_bezuege(v_m, 'grundstuecke', v_f_gs)::text,
      public.s112_stammdaten_bezuege(v_m, 'pflanzenschutzmittel', v_f_psm)::text,
      public.s112_stammdaten_bezuege(v_m, 'kontakte', v_f_ko)::text,
      public.s112_stammdaten_bezuege(v_m, 'firmen', v_f_fi)::text,
      public.s112_stammdaten_bezuege(v_m, 'weingarten', v_f_wg0)::text),
    '{"Maßnahmen": 1}|{"Maßnahmen": 1}|{"Maßnahmen": 1}|{"Verkäufe": 1}|{"Verkäufe": 1}|{}');
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_bezuege_unbekannte_id',
    pg_temp.s112_zaehle(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)::text', v_m, 'weingarten', gen_random_uuid())), 'EP0002');
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_bezuege_unbekannte_tabelle',
    pg_temp.s112_zaehle(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)::text', v_m, 'lagen', v_f_wg)), 'E22023');
  -- fremder Betrieb: b_ta fragt den Musterhof ab → pruefe_tenant_zugriff (42501)
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_bezuege_fremd',
    pg_temp.s112_zaehle(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)::text', v_m, 'weingarten', v_f_wg)), 'T');
  PERFORM pg_temp.s112_als_postgres();

  -- Löschen als tenant_admin: mit Bezug → T (auch das Ried, dessen Grundstück die Maßnahme trägt), ohne → k1
  PERFORM pg_temp.s112_als(v_mta);
  FOR v_tab, v_t1, v_t2 IN SELECT x.t, x.soll, x.id::text FROM (VALUES
        ('weingarten', 'T', v_f_wg), ('grundstuecke', 'T', v_f_gs), ('pflanzenschutzmittel', 'T', v_f_psm),
        ('kontakte', 'T', v_f_ko), ('firmen', 'T', v_f_fi),
        ('weingarten', 'k1', v_f_wg0), ('grundstuecke', 'k1', v_f_gs0), ('kontakte', 'k1', v_f_ko0),
        ('firmen', 'k1', v_f_fi0), ('pflanzenschutzmittel', 'k1', v_f_psm0)) x (t, soll, id) LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('f1a_delete_ta:' || v_tab || CASE v_t1 WHEN 'T' THEN '_mit_bezug' ELSE '_ohne_bezug' END,
      pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE id = %L', v_tab, v_t2)), v_t1);
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_delete_ta_meldung:weingarten',
    pg_temp.t20_muster(pg_temp.t20_probe(format('DELETE FROM public.weingarten WHERE id = %L', v_f_wg)),
                       '42501: %hat noch 1 Maßnahmen – bitte deaktivieren statt löschen.', '42501 deaktivieren'), '42501 deaktivieren');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_delete_ta_zeilen_bleiben:weingarten',
    concat_ws('|', (SELECT count(*) FROM public.weingarten WHERE id = v_f_wg), (SELECT count(*) FROM public.grundstuecke WHERE id = v_f_gs),
                   (SELECT count(*) FROM public.behandlung_grundstuecke WHERE grundstueck_id = v_f_gs)), '1|1|1');

  -- Wartung: postgres ohne Flag → T, mit s112.loeschen_erlaubt = Musterhof → gelöscht (Kaskade Grundstück und
  -- Maßnahmen-Zuordnung; Kontakt am Verkauf → SET NULL; sofort zurückgerollt), mit dem Flag von B → T
  v_t1 := pg_temp.s112_versuch(format('DELETE FROM public.weingarten WHERE id = %L', v_f_wg));
  PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
  v_t2 := pg_temp.s112_versuch(format('DELETE FROM public.weingarten WHERE id = %L', v_f_wg))
          || ',' || pg_temp.s112_versuch(format('DELETE FROM public.kontakte WHERE id = %L', v_f_ko));
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_t3 := pg_temp.s112_versuch(format('DELETE FROM public.weingarten WHERE id = %L', v_f_wg));
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_delete_postgres:weingarten', v_t1 || '/' || v_t2 || '/' || v_t3, 'T/k1,k1/T');

  -- Grundstück deaktivieren (m_ta): ohne Stichtag → CHECK (E23514), mit Stichtag → ok und genau eine Protokollzeile;
  -- Kontakt am Verkauf umhängen (Soll 6) → Protokollzeile mit kontakt_id
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_grundstueck_deaktiviert_ohne_datum',
    pg_temp.s112_versuch(format('UPDATE public.grundstuecke SET aktiv = false WHERE id = %L', v_f_gs)), 'E23514');
  v_n := pg_temp.t20_bp('grundstuecke', v_f_gs);
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_grundstueck_deaktiviert_mit_datum',
    pg_temp.s112_fehlertext(format('UPDATE public.grundstuecke SET aktiv = false, deaktiviert_am = DATE %L WHERE id = %L', '2026-09-30', v_f_gs)), 'ok');
  v_n2 := pg_temp.t20_bp('verkaufsposten', v_f_vp);
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_verkauf_kontakt_umhaengen',
    pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET kontakt_id = %L WHERE id = %L', v_f_ko1, v_f_vp)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT b.* INTO v_bp FROM public.bestandsprotokoll b
   WHERE b.tabelle = 'grundstuecke' AND b.datensatz_id = v_f_gs ORDER BY b.id DESC LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_grundstueck_deaktiviert_protokoll',
    concat_ws('|', pg_temp.t20_bp('grundstuecke', v_f_gs) - v_n, v_bp.tenant_id, v_bp.aktion,
              array_to_string(v_bp.geaenderte_spalten, ','), v_bp.benutzer_id),
    concat_ws('|', 1, v_m, 'UPDATE', 'aktiv,deaktiviert_am', v_mta));
  SELECT b.* INTO v_bp FROM public.bestandsprotokoll b
   WHERE b.tabelle = 'verkaufsposten' AND b.datensatz_id = v_f_vp ORDER BY b.id DESC LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('f1a_verkauf_kontakt_protokoll',
    concat_ws('|', pg_temp.t20_bp('verkaufsposten', v_f_vp) - v_n2, v_bp.aktion, array_to_string(v_bp.geaenderte_spalten, ','),
              v_bp.alt ->> 'kontakt_id', v_bp.neu ->> 'kontakt_id'),
    concat_ws('|', 1, 'UPDATE', 'kontakt_id', v_f_ko, v_f_ko1));

  -- ── 4. Bestandsprotokoll ──────────────────────────────────────────────────────────────────────────────
  v_arr := pg_temp.t20_tgargs('weinausbau');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_menge_ueberwacht', 'menge_liter' = ANY (v_arr), true);
  -- UPDATE überwachter Spalte als m_ta → genau 1 Zeile
  v_n := pg_temp.t20_bp('weinausbau', v_wa_m);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_ausfuehren',
    pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 1 WHERE id = %L', v_wa_m)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_eine_zeile', pg_temp.t20_bp('weinausbau', v_wa_m) - v_n, 1::bigint);
  SELECT b.* INTO v_bp FROM public.bestandsprotokoll b
   WHERE b.tabelle = 'weinausbau' AND b.datensatz_id = v_wa_m ORDER BY b.id DESC LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_inhalt',
    concat_ws('|', v_bp.tenant_id, v_bp.aktion, array_to_string(v_bp.geaenderte_spalten, ','), v_bp.benutzer_id, v_bp.db_rolle,
              (v_bp.neu ->> 'menge_liter')::numeric - (v_bp.alt ->> 'menge_liter')::numeric = 1),
    concat_ws('|', v_m, 'UPDATE', 'menge_liter', v_mta, 'authenticated', true));
  -- nicht überwachte Spalte → keine Zeile
  v_n := pg_temp.t20_bp('weinausbau', v_wa_m);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_frei_ausfuehren',
    pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET %I = coalesce(%I, '''') || '' s112test'' WHERE id = %L',
                                   v_spalte_frei, v_spalte_frei, v_wa_m)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_frei_keine_zeile', pg_temp.t20_bp('weinausbau', v_wa_m) - v_n, 0::bigint);

  -- DELETE keller_umzuege (m_ta) → Zeile 'DELETE' mit alt. Seit KAN-145 B4 direkt gesperrt: stornieren, dann
  -- endgültig löschen über s112_storniert_loeschen (auth.uid() bleibt der Benutzer)
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_direkt_gesperrt',
    pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku[1])) || '/'
      || (SELECT count(*) FROM public.keller_umzuege WHERE id = v_ku[1]), 'ok/1');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_ausfuehren',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 's112test Storno Protokoll', v_ku[1]))
      || '/' || pg_temp.s112_fehlertext(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_m, 'keller_umzuege', v_ku[1], 's112test endgültig löschen')),
    'ok/ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_geloescht', (SELECT count(*) FROM public.keller_umzuege WHERE id = v_ku[1]), 0::bigint);
  SELECT count(*), max(b.aktion), max(b.tenant_id::text), bool_and(b.alt ->> 'id' = v_ku[1]::text)::text, max(b.benutzer_id::text)
    INTO v_n, v_txt, v_t1, v_t2, v_t3
    FROM public.bestandsprotokoll b WHERE b.tabelle = 'keller_umzuege' AND b.datensatz_id = v_ku[1]
     AND b.aktion = 'DELETE';   -- davor protokolliert: das Storno (UPDATE)
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_zeile',
    concat_ws('|', v_n, v_txt, v_t1, v_t2, v_t3), concat_ws('|', 1, 'DELETE', v_m, 'true', v_mta));
  -- DELETE einer Kindzeile ohne tenant_id → Mandant über die Eltern (pressungen). Seit KAN-148 C1d gesperrt – als
  -- Wartung (postgres) mit Flag
  PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_kind_ausfuehren',
    pg_temp.s112_fehlertext(format('DELETE FROM public.pressung_behaelter WHERE id = %L', v_pb)), 'ok');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_kind_tenant',
    (SELECT string_agg(coalesce(b.tenant_id::text, 'NULL') || '/' || b.aktion, ',') FROM public.bestandsprotokoll b
      WHERE b.tabelle = 'pressung_behaelter' AND b.datensatz_id = v_pb), v_m::text || '/DELETE');

  -- Alle Protokolltabellen ohne tenant_id (Mandant über CASE TG_TABLE_NAME in bestandsprotokoll_schreiben):
  -- Beispielzeile in B anlegen und als postgres löschen → genau eine Zeile mit tenant_id = B. Eine neue
  -- Kindtabelle ohne CASE-Zweig oder ein falscher Spaltenname im Zweig ergäbe tenant_id NULL.
  v_arr := '{}';
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);   -- KAN-145 B4: Wartungs-Flag für die Löschsperre
  FOR r IN SELECT x AS tab FROM unnest(pg_temp.s112_soll_liste('protokoll_tabellen')) x
            WHERE to_regclass(format('public.%I', x)) IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', x))
                                 AND a.attname = 'tenant_id' AND NOT a.attisdropped)
            ORDER BY 1 LOOP
    BEGIN
      v_z := pg_temp.s112_beispiel(r.tab, v_b, v_bta);
      EXECUTE format('DELETE FROM public.%I WHERE %s', r.tab, pg_temp.s112_pk_where(r.tab, v_z));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_erg := v_erg || pg_temp.s112_erwarte('protokoll_kind_tenant:' || r.tab,
        v_n || '|' || coalesce((SELECT string_agg(coalesce(b.tenant_id::text, 'NULL') || '/' || b.aktion, ',')
                                  FROM public.bestandsprotokoll b
                                 WHERE b.tabelle = r.tab
                                   -- KAN-88: behandlung_grundstuecke hat keine id-Spalte – Zeile über den Inhalt
                                   AND CASE WHEN v_z ? 'id' THEN b.datensatz_id = (v_z ->> 'id')::uuid ELSE b.alt @> v_z END), '(keine Zeile)'),
        '1|' || v_b::text || '/DELETE');
      v_arr := v_arr || r.tab;
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('protokoll_kind_tenant:' || r.tab, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_kind_abgedeckt',
    ARRAY['ama_meldepositionen', 'ernte_parzellen', 'pressung_behaelter', 'pressung_weingaerten', 'verschneidung_quellen'] <@ v_arr, true);

  -- Bypass s112.protokoll_aus: als m_ta wirkungslos; als postgres nur für den Musterhof
  -- (als authenticated an einem UPDATE geprüft – DELETE auf keller_umzuege ist dort seit KAN-145 B4 gesperrt)
  v_n := pg_temp.t20_bp('weinausbau', v_wa_m);
  PERFORM pg_temp.s112_als(v_mta);
  PERFORM set_config('s112.protokoll_aus', v_m::text, true);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 1 WHERE id = %L', v_wa_m));
  PERFORM set_config('s112.protokoll_aus', '', true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bypass_authenticated_protokolliert', v_txt || '/' || (pg_temp.t20_bp('weinausbau', v_wa_m) - v_n), 'ok/1');
  PERFORM set_config('s112.protokoll_aus', v_m::text, true);
  v_txt := pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku[3]));
  PERFORM set_config('s112.protokoll_aus', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('demo_reset_postgres_musterhof_ohne_protokoll',
    v_txt || '/' || (SELECT count(*) FROM public.keller_umzuege WHERE id = v_ku[3]) || '/' || pg_temp.t20_bp('keller_umzuege', v_ku[3]), 'ok/0/0');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);   -- KAN-145 B4: Löschsperre (Wartungs-Flag)
  PERFORM set_config('s112.protokoll_aus', v_b::text, true);
  v_txt := pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku_b1));
  PERFORM set_config('s112.protokoll_aus', v_m::text, true);
  v_txt := v_txt || '/' || pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku_b2));
  PERFORM set_config('s112.protokoll_aus', '', true);
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('bypass_postgres_betrieb_b_protokolliert',
    v_txt || '/' || pg_temp.t20_bp('keller_umzuege', v_ku_b1) || '/' || pg_temp.t20_bp('keller_umzuege', v_ku_b2)
      || '/' || (SELECT count(*) FROM public.bestandsprotokoll WHERE datensatz_id IN (v_ku_b1, v_ku_b2) AND tenant_id = v_b),
    'ok/ok/1/1/2');

  -- authenticated: auf bestandsprotokoll nur SELECT, und nur SA/TA (m_w sieht nichts)
  v_n := (SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = v_m);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_select_beleg_zeilen_m', v_n >= 2, true);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_insert_authenticated',
    pg_temp.s112_versuch(format('INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, aktion) VALUES (%L, %L, %L)', v_m, 's112test', 'UPDATE')), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_update_authenticated',
    pg_temp.s112_versuch(format('UPDATE public.bestandsprotokoll SET tabelle = tabelle WHERE tenant_id = %L', v_m)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_delete_authenticated',
    pg_temp.s112_versuch(format('DELETE FROM public.bestandsprotokoll WHERE tenant_id = %L', v_m)), 'G');
  v_txt := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L', v_m));
  v_erg := v_erg || pg_temp.s112_erwarte('bp_select_tenant_admin', v_txt ~ '^[0-9]+$' AND v_txt::bigint >= 1, true);
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_select_winzer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L', v_m)), '0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 5. Mandantengleichheit: Gebinde (weinausbau_gebinde_pruefen) ─────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_nicht_gemeinsam',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_ng, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_ohne_freigabe',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_gl, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  -- inaktive Freigabe M → B gilt nicht (UNIQUE eigentuemer/nutzer: dieselbe Zeile wird danach aktiv gesetzt)
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen)
  VALUES (v_m, v_b, false, 'S112TEST Freigabe M an B') RETURNING id INTO v_freigabe;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_freigabe_inaktiv',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_gl, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.keller_freigaben SET aktiv = true WHERE id = v_freigabe;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_mit_freigabe',
    pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_gl, v_wa_b)), 'ok:1');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_belegt',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_bel, v_wa_b)),
                       'P0001: %belegt%', 'P0001 belegt'), 'P0001 belegt');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_nicht_gemeinsam_trotz_freigabe',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_ng, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');

  -- Anlagen/Buchungen (trg_ea_*_tenant)
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_fremd',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.ea_transaktionen SET anlage_id = %L WHERE id = %L', v_anl_m, v_tx_b)),
                       'P0001: Die Anlage gehört nicht zu diesem Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_eigen',
    pg_temp.t20_probe(format('UPDATE public.ea_transaktionen SET anlage_id = %L WHERE id = %L', v_anl_b, v_tx_b)), 'ok:1');
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_buchung_fremd',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.ea_anlagen SET transaktion_id = %L WHERE id = %L', v_tx_m, v_anl_b)),
                       'P0001: Die Buchung gehört nicht zu diesem Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_buchung_eigen',
    pg_temp.t20_probe(format('UPDATE public.ea_anlagen SET transaktion_id = %L WHERE id = %L', v_tx_b, v_anl_b)), 'ok:1');

  -- ── 6. keller_freigaben: sichtbar, aber nicht schreibbar ─────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_sichtbar_nutzer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L', v_freigabe)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv) VALUES (%L, %L, true)', v_b, v_m)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_insert_fremd',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv) VALUES (%L, %L, true)', v_m, v_b)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_update',
    pg_temp.s112_versuch(format('UPDATE public.keller_freigaben SET aktiv = false WHERE id = %L', v_freigabe)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.keller_freigaben WHERE id = %L', v_freigabe)), 'k0');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_sichtbar_eigentuemer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L', v_freigabe)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_update_eigentuemer',
    pg_temp.s112_versuch(format('UPDATE public.keller_freigaben SET aktiv = false WHERE id = %L', v_freigabe)), 'k0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 7. TRUNCATE-Verbot (als postgres; zum Schluss) ───────────────────────────────────────────────────
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND t.tgname = 'z_protokoll_truncate' AND NOT t.tgisinternal;
  -- KAN-145 B4: Löschsperre (a_loeschsperre → s112_loeschsperre) und keine_direktloeschung genau auf der Soll-Liste
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgfoid = 'public.s112_loeschsperre()'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('loeschsperre_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('loeschsperre_tabellen')) x));
  SELECT coalesce(array_agg(p.tablename::text ORDER BY p.tablename), '{}') INTO v_arr
    FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'keine_direktloeschung' AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'DELETE';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_direktloeschung_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('loeschsperre_tabellen')) x));
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND t.tgname = 'z_protokoll_truncate' AND NOT t.tgisinternal;
  v_erg := v_erg || pg_temp.s112_erwarte('truncate_trigger_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('protokoll_tabellen')) x));
  FOR r IN SELECT DISTINCT x AS tab FROM unnest(v_arr || pg_temp.s112_soll_liste('protokoll_tabellen')) x ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.tab) INTO v_n;
    v_txt := pg_temp.s112_fehlertext(format('TRUNCATE public.%I', r.tab));
    IF v_txt LIKE '0A000:%' THEN   -- FK-Verweis: mit CASCADE, damit der Trigger der Tabelle antwortet
      v_txt := pg_temp.s112_fehlertext(format('TRUNCATE public.%I CASCADE', r.tab));
    END IF;
    v_erg := v_erg || pg_temp.s112_erwarte('truncate:' || r.tab,
      pg_temp.t20_muster(v_txt, '42501: TRUNCATE auf „' || r.tab || '“ ist gesperrt%', '42501 gesperrt'), '42501 gesperrt');
    EXECUTE format('SELECT count(*) FROM public.%I', r.tab) INTO v_n2;
    v_erg := v_erg || pg_temp.s112_erwarte('truncate_zeilen:' || r.tab, v_n2, v_n);
  END LOOP;

  -- ── KAN-37: abgegebene Meldung auch für postgres (SQL-Editor/Service-Role) unveränderlich ─────────────────
  -- eingereichte Meldung samt Position in B (der Musterhof ist für Wartung ausgenommen); erst hier angelegt, weil
  -- protokoll_kind_tenant oben Beispielpositionen in B anlegt und wieder löscht
  PERFORM pg_temp.s112_als_postgres();
  v_jg_ama_b := (pg_temp.s112_zeile('weinjahrgaenge', v_b) ->> 'id')::uuid;
  v_ama_b := (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, v_bta, jsonb_build_object('jahrgang_id', v_jg_ama_b)) ->> 'id')::uuid;
  v_pos_b := pg_temp.s112_zeile('ama_meldepositionen', v_b, jsonb_build_object('meldung_id', v_ama_b));
  UPDATE public.ama_erntemeldungen SET status = 'eingereicht', eingereicht_am = now() WHERE id = v_ama_b;
  v_erg := v_erg || pg_temp.s112_erwarte('kan37_postgres_inhalt',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('UPDATE public.ama_erntemeldungen SET notizen = %L WHERE id = %L', 'x', v_ama_b)),
      '42501:%ihr Inhalt bleibt unverändert (KAN-37)%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37_postgres_loeschen',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('DELETE FROM public.ama_erntemeldungen WHERE id = %L', v_ama_b)),
      '42501:%nie gelöscht (KAN-37)%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37_postgres_position',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('DELETE FROM public.ama_meldepositionen WHERE meldung_id = %L', v_ama_b)),
      '42501:%Positionen bleiben unverändert (KAN-37)%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37_postgres_zurueck',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('UPDATE public.ama_erntemeldungen SET status = %L WHERE id = %L', 'bereit', v_ama_b)),
      '42501:%nur vorwärts%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37_postgres_bestaetigen',
    pg_temp.s112_versuch(format('UPDATE public.ama_erntemeldungen SET status = %L, bestaetigt_am = now() WHERE id = %L', 'bestaetigt', v_ama_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37_mandant_loeschen',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('SELECT public.s112_mandant_loeschen(%L, (SELECT name FROM public.tenants WHERE id = %L))', v_b, v_b)),
      '55000:%abgegebene Meldungen%', 'abgelehnt'), 'abgelehnt');

  -- ── KAN-37 B: Einreichen nur mit Snapshot; die Abgabe ist für jede Rolle unveränderlich ────────────────────
  v_ama_b2 := (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, v_bta, jsonb_build_object('status', 'bereit', 'jahrgang_id',
    (pg_temp.s112_beispiel('weinjahrgaenge', v_b, v_bta, '{"jahrgang": 1902}'::jsonb) ->> 'id')::uuid)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_direkt_eingereicht',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('SELECT public.s112_ama_status_setzen(%L, %L, %L, current_date, NULL)', v_b, v_ama_b2, 'eingereicht')),
      '42501:%Einreichen%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_falscher_jahrgang',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('SELECT public.s112_ama_einreichen(%L, %L, current_date, NULL, %L::jsonb)', v_b, v_ama_b2,
      jsonb_build_object('meldung', 'erntemeldung', 'parameter', '{"jahrgang": 1903}'::jsonb, 'zeilen', '[]'::jsonb,
        'spalten', '[{"kopf": "Rebsorte", "typ": "text"}]'::jsonb, 'profil', 'EXCEL_AT', 'dateiname', 'S112TEST.csv', 'csv', 'x'))),
      '22023:%gehört nicht zu dieser Meldung%', 'abgelehnt'), 'abgelehnt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_einreichen',
    pg_temp.s112_fehlertext(format('SELECT public.s112_ama_einreichen(%L, %L, current_date, %L, %L::jsonb)', v_b, v_ama_b2, 'S112TEST-REF',
      jsonb_build_object('meldung', 'erntemeldung', 'parameter', '{"jahrgang": 1902}'::jsonb, 'zeilen', '[{"rebsorte": "S112TEST"}]'::jsonb,
        'spalten', '[{"kopf": "Rebsorte", "typ": "text"}]'::jsonb, 'profil', 'EXCEL_AT', 'dateiname', 'S112TEST.csv',
        'csv', E'﻿Rebsorte
S112TEST
'))), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_lesen_als_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.meldung_abgaben WHERE ama_meldung_id = %L', v_ama_b2)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_kein_insert_als_ta',
    pg_temp.s112_versuch(format('INSERT INTO public.meldung_abgaben (tenant_id, meldung, eingereicht_am, parameter, zeilen, zeilen_anzahl, spalten, spalten_sha256, profil, dateiname, csv_text, csv_sha256, csv_bytes) VALUES (%L, %L, current_date, %L, %L, 0, %L, %L, %L, %L, %L, %L, 0)',
      v_b, 'bestandsmeldung', '{}', '[]', '[{}]', '', 'p', 'd', 'x', '')) IN ('R', 'T'), true);   -- Trigger (vor RLS) bzw. RLS
  PERFORM pg_temp.s112_als_postgres();
  SELECT a.id INTO v_abg FROM public.meldung_abgaben a WHERE a.ama_meldung_id = v_ama_b2;
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_snapshot',
    (SELECT concat_ws('|', m.status, a.zeilen_anzahl, a.csv_bytes = octet_length(convert_to(a.csv_text, 'UTF8')),
                      a.csv_sha256 = encode(sha256(convert_to(a.csv_text, 'UTF8')), 'hex'), left(a.csv_text, 1) = E'﻿',
                      length(a.spalten_sha256), a.erstellt_von = v_bta, a.meldungs_version)
       FROM public.meldung_abgaben a JOIN public.ama_erntemeldungen m ON m.id = a.ama_meldung_id WHERE a.id = v_abg),
    'eingereicht|1|t|t|t|64|t|1');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_postgres_aendern',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('UPDATE public.meldung_abgaben SET csv_text = %L WHERE id = %L', 'x', v_abg)),
      '42501:%bleibt unverändert%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_postgres_loeschen',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('DELETE FROM public.meldung_abgaben WHERE id = %L', v_abg)),
      '42501:%nie gelöscht%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_postgres_truncate',
    pg_temp.t20_muster(pg_temp.s112_fehlertext('TRUNCATE public.meldung_abgaben'), '42501:%nie gelöscht%', 'gesperrt'), 'gesperrt');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_zweimal',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('SELECT public.s112_ama_einreichen(%L, %L, current_date, NULL, %L::jsonb)', v_b, v_ama_b2,
      jsonb_build_object('meldung', 'erntemeldung', 'parameter', '{"jahrgang": 1902}'::jsonb, 'zeilen', '[]'::jsonb,
        'spalten', '[{"kopf": "Rebsorte", "typ": "text"}]'::jsonb, 'profil', 'EXCEL_AT', 'dateiname', 'S112TEST.csv', 'csv', 'x'))),
      '42501:%nur vorwärts%', 'abgelehnt'), 'abgelehnt');
  PERFORM pg_temp.s112_als_postgres();

  -- ── KAN-37 C: Meldungsrahmen und Lese-Sperre bis zum Stichtag ───────────────────────────────────────────
  v_jg_c := (pg_temp.s112_beispiel('weinjahrgaenge', v_b, v_bta, '{"jahrgang": 1904}'::jsonb) ->> 'id')::uuid;
  v_ep_c := (pg_temp.s112_beispiel('ernte_parzellen', v_b, v_bta, jsonb_build_object('jahrgang_id', v_jg_c, 'ernte_datum', '1904-09-20', 'menge_kg', 100)) ->> 'id')::uuid;
  v_ama_c := (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, v_bta, jsonb_build_object('jahrgang_id', v_jg_c, 'status', 'bereit')) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_rahmen',
    (SELECT concat_ws('|', meldungsart, stichtag, abgabefrist) FROM public.ama_erntemeldungen WHERE id = v_ama_c), 'erntemeldung|1904-11-30|1904-12-15');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_offen_frei',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET menge_kg = 110 WHERE id = %L', v_ep_c)), 'k1');
  PERFORM public.s112_ama_einreichen(v_b, v_ama_c, current_date, NULL, jsonb_build_object('meldung', 'erntemeldung',
    'parameter', '{"jahrgang": 1904}'::jsonb, 'zeilen', '[]'::jsonb, 'spalten', '[{"kopf": "S112TEST", "typ": "text"}]'::jsonb,
    'profil', 'EXCEL_AT', 'dateiname', 'S112TEST.csv', 'csv', 'S112TEST'));
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_benutzer_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET menge_kg = 120 WHERE id = %L', v_ep_c)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_notiz_frei',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET notizen = %L WHERE id = %L', 'S112TEST Notiz', v_ep_c)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_eingereicht_von',
    (SELECT eingereicht_von FROM public.ama_erntemeldungen WHERE id = v_ama_c), v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_postgres_gesperrt',
    pg_temp.t20_muster(pg_temp.s112_fehlertext(format('DELETE FROM public.ernte_parzellen WHERE id = %L', v_ep_c)),
      '42501:%bis zum Stichtag 30.11.1904 sind gesperrt%', 'gesperrt'), 'gesperrt');
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_nach_stichtag_frei',
    pg_temp.s112_versuch(format('INSERT INTO public.ernte_parzellen (jahrgang_id, ernte_datum, menge_kg) VALUES (%L, %L, 5)', v_jg_c, '1904-12-05')), 'k1');
  PERFORM pg_temp.s112_als(v_bta);
  PERFORM public.s112_ama_korrektur_anlegen(v_b, v_ama_c);
  v_erg := v_erg || pg_temp.s112_erwarte('kan37c_korrektur_frei',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET menge_kg = 130 WHERE id = %L', v_ep_c)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 194);   -- KAN-150 F1a: 140 → 170; KAN-37: +6; KAN-37 B: +10; KAN-37 C: +8
END
$test$;
