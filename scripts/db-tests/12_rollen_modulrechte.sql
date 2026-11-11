-- @bereich: Rollen und Modulrechte (Soll-Matrix je Tabelle)
-- @ziel: Leser schreibt nirgends (außer eigenen Benutzerzeilen). Winzer schreibt nur mit passendem Schreibmodul;
-- @ziel: das Modul 'betrieb' gilt für jeden Winzer. Löschen und Admin-Tabellen nur SA/TA. Geprüft wird gegen die
-- @ziel: explizite Soll-Matrix pg_temp.s112_soll() in _helfer.sql, in die jede neue Tabelle eingetragen werden muss.
-- @mutation modul_egal: s112_darf_schreiben lässt jeden aktiven Winzer ohne Blick auf die Schreibmodule schreiben | rot: rolle:.*
-- @mutation zeiterfassung_offen: PERMISSIVE-Policy ALL USING/WITH CHECK (true) auf zeiterfassung | rot: nur_admin:zeiterfassung|rolle:zeiterfassung:.*|leser_schreibt_nirgends
-- @mutation loeschen_offen: PERMISSIVE-DELETE-Policy USING (true) auf weinbaugebiete_custom | rot: kein_delete:weinbaugebiete_custom:.*|rolle:weinbaugebiete_custom:DELETE:.*
-- @mutation neue_tabelle: neue Tabelle in public ohne Eintrag in s112_soll() | rot: soll_fehlt:s112test_neu
-- @mutation eigner_aufgeweicht: Policy FOR ALL auf benachrichtigungen prüft nur noch den Betrieb, nicht den Empfänger | rot: eigner_fremd:benachrichtigungen:.*
-- @mutation mitglied_selbst: Policy tenant_memberships FOR UPDATE USING/WITH CHECK (user_id = auth.uid()) – jeder ändert die eigene Mitgliedschaft | rot: mitglied_selbst:.*
-- @mutation modul_entkoppelt: s112_darf_schreiben prüft Mitgliedschaft im Betrieb und Schreibmodule getrennt (Module aus irgendeinem Betrieb) | rot: rolle:.*:x_w0
-- @mutation rolle_entkoppelt: behaelter_delete und s112_darf_schreiben prüfen die Rolle ohne Bezug auf den Betrieb der Zeile | rot: rolle:.*:x_ta_l
-- @mutation zeit_del_offen: zusätzliche DELETE-Policy USING (true) auf zeiterfassung – Leser/Winzer löschen per „DELETE FROM“ ohne WHERE, per PK bliebe es k0 | rot: rolle:zeiterfassung:DELETE:.*
--
-- software:112 – SQL-Testsuite gegen STAGING, Datei 12 (Stand 28.09.2026). Nur Staging; die ganze Datei ist EINE
-- Transaktion und endet mit pg_temp.s112_ende(…) = RAISE → alles wird zurückgerollt.
--
-- Was geprüft wird
--   1. Soll-Abdeckung: s112_soll() deckt exakt alle Tabellen in public ab (Quelle inventar/matrix.txt vom 28.09.2026).
--      Tabelle ohne Soll → FEHLER soll_fehlt:<tab>; Soll ohne Tabelle → FEHLER soll_veraltet:<tab>.
--   2. Rollenmatrix: je Tabelle mit RLS eine frische Beispielzeile im Musterhof (schreibbarer Zustand:
--      ea_transaktionen is_locked=false, AMA-Meldung als Entwurf, ama_meldepositionen an eigener Entwurfs-Meldung,
--      Kindzeilen an frischer Elternzeile, Eigentümerspalten = handelnde Persona bei assistent_unterhaltungen
--      samt Kindern, benachrichtigungen, user_email_connections, profiles, release_notes_gesehen). Zwölf Personas im
--      Musterhof (m_sa ohne Plattform-Admin, m_ta, m_l, m_w_leer mit '{}', sechs Einmodul-Winzer und zwei
--      Mehrbetriebs-Personas: x_ta_l = tenant_admin in B, Leser in M; x_w0 = Winzer mit allen Modulen in B, '{}' in M –
--      sie gelten im Musterhof als L bzw. W ohne Modul, so fällt eine Rollen-/Modulprüfung ohne Betriebsbezug auf) versuchen je
--      INSERT (Klon mit neuem Primärschlüssel), UPDATE (SET x = x per PK) und DELETE (per PK) über s112_versuch
--      (sofort zurückgerollt). erlaubt = k≥1 oder E23xxx (Constraint NACH der RLS-Prüfung); verweigert = R, G, T, k0.
--      k0 bei UPDATE/DELETE zählt nur als verweigert, wenn auch die UPDATE-/DELETE-Policy-Schicht die Zeile ablehnt
--      (pg_temp.s112_policy): „WHERE <pk>“ wendet zusätzlich die SELECT-Policies an, für eine Persona ohne Leserecht
--      wäre k0 sonst immer das Ergebnis – ein „DELETE FROM tab“ ohne WHERE prüft aber nur die DELETE-Policy.
--      k0 mit Policy 'ja' → Code 'k0+policy' = erlaubt (maskiert durch die SELECT-Policy).
--      Abweichung vom Soll → FEHLER rolle:<tab>:<op>:<persona> ist=<code> soll=erlaubt|verweigert.
--   3. Leser: nirgends erlaubt außer den eigenen Benutzerzeilen (benachrichtigungen UPDATE/DELETE, profiles
--      INSERT/UPDATE, release_notes_gesehen, user_email_connections DELETE).
--   4. Harte Einzelprüfungen: kein DELETE / kein UPDATE für niemanden (k0 auch für m_sa/m_ta), DELETE nur SA/TA,
--      Schreiben nur SA/TA, Tabellen ganz ohne Schreibrecht (bestandsprotokoll und fuellung_bewegungen: G),
--      Modul 'betrieb' für jeden Winzer.
--   4b. Eigene Mitgliedschaft: m_sa, m_ta, m_l, m_w_leer, m_w_crm und m_inak ändern an der EIGENEN Zeile in
--      tenant_memberships weder schreibmodule noch role noch aktiv (echte Wertänderung, nicht SET x = x – so greift
--      auch ein zu weiter WITH CHECK). Positivkontrolle: der Plattform-Admin ändert dieselbe Anweisung an m_w_crm.
--   4c. Fremder Eigentümer im selben Betrieb: Zeilen mit Eigentümerbezug (benachrichtigungen, assistent_unterhaltungen
--      samt Nachrichten und Aktionen, release_notes_gesehen, profiles) eines ANDEREN Mitglieds – m_w auf Zeilen von
--      m_ta und umgekehrt: SELECT → 0 (profiles ausgenommen – gemeinsamer Betrieb, B3; assistent_* privat seit KAN-159 B14),
--      UPDATE/DELETE → verweigert, INSERT mit dem
--      Eigentümer eines anderen → verweigert. Vorher als postgres belegt, dass jede Zeile existiert.
--   5. Bezeichnung vs. Verhalten: aktivitaet_dokumente-DELETE („Winzer können eigene Dokumente löschen“) prüft
--      keinen Eigentümer → BEKANNT (zu klären), als Ratsche.
--   6. Modul- und Paketschalter beim Schreiben (B17, Ist-Stand als Ratsche): in Betrieb B werden alle
--      tenant_einstellungen.modul_* auf false gesetzt und alle module_flags entfernt (als postgres, belegt); b_ta und
--      b_w (alle sechs Schreibmodule) legen trotzdem je Modul eine Zeile an (kontakte, weinausbau, weingarten,
--      verkaufsposten, ea_transaktionen, exportauftraege). Die Schalter wirken nur in der App, nicht in RLS.
-- Nicht hier: Modulprüfung in RPCs (get_next_*, setze_kontobewegung_abgeglichen, kontakte_zusammenfuehren) → 18;
-- module_flags positiv für Plattform-Admins → 17; Lesen/Mandantentrennung → 10.
-- Existenz: jede Beispielzeile wird als postgres per PK gezählt (zeile_vorhanden:<tab>), bevor k0 als „verweigert“ zählt.


-- Text-Array aus einem jsonb-Array.
CREATE FUNCTION pg_temp.t12_arr(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce(array(SELECT jsonb_array_elements_text(coalesce(p, '[]'::jsonb))), '{}'::text[])
$f$;

-- Code aus s112_versuch → 'erlaubt' | 'verweigert' | 'unklar'.
-- E23xxx (NOT NULL, FK, UNIQUE, CHECK) entsteht erst NACH der RLS-Prüfung (WITH CHECK greift vorher) → erlaubt.
-- 'k0+policy' (siehe t12_wirkung): per PK 0 Zeilen, aber die UPDATE-/DELETE-Policy lässt die Zeile zu → erlaubt;
-- 'k0+policy:G'/'k0+policy:T': die Policy-Auswertung scheitert an einer für die Rolle gesperrten Funktion → verweigert.
CREATE FUNCTION pg_temp.t12_klasse(p_code text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p_code ~ '^k[1-9][0-9]*$' THEN 'erlaubt'
    WHEN p_code LIKE 'E23%' THEN 'erlaubt'
    WHEN p_code = 'k0+policy' THEN 'erlaubt'
    WHEN p_code IN ('k0', 'R', 'G', 'T', 'k0+policy:G', 'k0+policy:T') THEN 'verweigert'
    ELSE 'unklar'
  END
$f$;

-- Wirkung einer UPDATE-/DELETE-Probe per PK ohne SELECT-Maskierung, als gerade aktive Rolle: bei k0 zusätzlich die
-- UPDATE-/DELETE-Policy-Schicht für die Zeile auswerten (pg_temp.s112_policy). 'ja' → 'k0+policy' (ein „DELETE FROM
-- tab“ bzw. „UPDATE tab SET x = <Literal>“ ohne WHERE träfe die Zeile), Fehler → 'k0+policy:<code>', sonst k0.
-- Ohne Tabellen-/Spaltenrecht käme G statt k0 – dann ist nichts auszuwerten.
CREATE FUNCTION pg_temp.t12_wirkung(p_code text, p_tab text, p_op text, p_zeile jsonb) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  IF p_code <> 'k0' OR p_op NOT IN ('UPDATE', 'DELETE') THEN
    RETURN p_code;
  END IF;
  v := pg_temp.s112_policy(p_tab, p_op, p_zeile);
  RETURN CASE WHEN v = 'nein' THEN 'k0' WHEN v = 'ja' THEN 'k0+policy' ELSE 'k0+policy:' || v END;
END $f$;

-- Soll aus der Matrix: p_soll = {"r": rollen, "m": module}; p_rolle SA | TA | L | W; p_pmod = Schreibmodule der Persona.
-- W* = Winzer nur mit passendem Modul; 'betrieb' gilt für jeden Winzer; W* ohne Modulliste = jeder Winzer.
CREATE FUNCTION pg_temp.t12_soll_erlaubt(p_soll jsonb, p_rolle text, p_pmod text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p_soll IS NULL THEN NULL
    WHEN p_rolle = 'W' THEN
      'W' = ANY (pg_temp.t12_arr(p_soll -> 'r'))
      OR ('W*' = ANY (pg_temp.t12_arr(p_soll -> 'r'))
          AND (cardinality(pg_temp.t12_arr(p_soll -> 'm')) = 0
               OR 'betrieb' = ANY (pg_temp.t12_arr(p_soll -> 'm'))
               OR pg_temp.t12_arr(p_soll -> 'm') && coalesce(p_pmod, '{}'::text[])))
    ELSE p_rolle = ANY (pg_temp.t12_arr(p_soll -> 'r'))
  END
$f$;

-- Tabellen, deren Beispielzeile der handelnden Persona gehören muss (Policies prüfen auth.uid() gegen eine Spalte
-- der Zeile oder der Elternzeile) – für sie entsteht je Persona eine eigene Zeile.
CREATE FUNCTION pg_temp.t12_pro_persona(p_tab text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT p_tab IN ('assistent_unterhaltungen', 'assistent_aktionen', 'assistent_nachrichten', 'benachrichtigungen',
                   'user_email_connections', 'profiles', 'release_notes_gesehen', 'benutzer_dashboard')
$f$;

-- Frische Beispielzeile in schreibbarem Zustand (als postgres). Musterhof p_m, Betrieb B p_b, Plattform-Admin p_pa.
CREATE FUNCTION pg_temp.t12_zeile(p_tab text, p_klasse text, p_eltern_spalte text, p_eltern_tabelle text, p_eltern_ref text,
                                  p_m uuid, p_b uuid, p_pa uuid, p_persona uuid)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_e jsonb;
  v_z jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_postgres('t12_zeile');
  IF p_tab IN ('assistent_unterhaltungen', 'benachrichtigungen', 'user_email_connections') THEN
    RETURN pg_temp.s112_beispiel(p_tab, p_m, p_persona);
  ELSIF p_tab IN ('assistent_aktionen', 'assistent_nachrichten') THEN
    v_e := pg_temp.s112_beispiel('assistent_unterhaltungen', p_m, p_persona);
    RETURN pg_temp.s112_beispiel(p_tab, p_m, p_persona, jsonb_build_object('unterhaltung_id', v_e ->> 'id'));
  ELSIF p_tab = 'profiles' THEN
    SELECT to_jsonb(x.*) INTO v_z FROM public.profiles x WHERE x.id = p_persona;
    RETURN v_z;
  ELSIF p_tab IN ('release_notes_gesehen', 'benutzer_dashboard') THEN
    RETURN pg_temp.s112_beispiel(p_tab, NULL, p_persona);
  ELSIF p_tab = 'tenants' THEN
    SELECT to_jsonb(x.*) INTO v_z FROM public.tenants x WHERE x.id = p_m;
    RETURN v_z;
  ELSIF p_tab = 'plattform_admins' THEN
    SELECT to_jsonb(x.*) INTO v_z FROM public.plattform_admins x WHERE x.user_id = p_pa;
    RETURN v_z;
  ELSIF p_tab = 'svs_parameter' THEN
    SELECT to_jsonb(x.*) INTO v_z FROM public.svs_parameter x ORDER BY x.jahr DESC LIMIT 1;
    IF v_z IS NULL THEN
      v_z := pg_temp.s112_zeile(p_tab, NULL);
    END IF;
    RETURN v_z;
  ELSIF p_tab = 'rebsorten' THEN   -- KAN-89: Testsorte nicht amtlich (kein Kürzel), nur weiß/rot
    RETURN pg_temp.s112_zeile(p_tab, NULL, '{"kuerzel": null, "kuerzel_amtlich": false, "farbe": "weiss"}');
  ELSIF p_tab = 'release_notes' THEN
    RETURN pg_temp.s112_zeile(p_tab, NULL);
  ELSIF p_tab IN ('kat_buchungsart', 'kat_erzeugnis', 'kat_farbe', 'kat_land', 'kat_qualitaetsstufe', 'katalog_mapping') THEN
    -- KAN-39: Kataloge per Migration befüllt (CHECKs auf die Codes) – vorhandene Zeile
    EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x LIMIT 1', p_tab) INTO v_z;
    RETURN v_z;
  ELSIF p_tab IN ('keller_freigaben', 'crm_freigaben') THEN
    RETURN pg_temp.s112_zeile(p_tab, NULL, jsonb_build_object('eigentuemer_tenant_id', p_m, 'nutzer_tenant_id', p_b));
  ELSIF p_tab = 'module_flags' THEN
    -- alle zehn erlaubten Module sind im Musterhof schon belegt (UNIQUE tenant_id, module): vorhandene Zeile
    SELECT to_jsonb(x.*) INTO v_z FROM public.module_flags x WHERE x.tenant_id = p_m ORDER BY x.module LIMIT 1;
    RETURN coalesce(v_z, pg_temp.s112_beispiel(p_tab, p_m));
  ELSIF p_tab = 'ea_transaktionen' THEN
    RETURN pg_temp.s112_beispiel(p_tab, p_m, NULL, '{"is_locked": false}'::jsonb);
  ELSIF p_tab = 'verkauf_positionen' THEN
    -- KAN-355: eigener Verkaufsposten von heute – der erste vorhandene hängt im Musterhof an einer Rechnung aus einem
    -- abgeschlossenen Monat (Demo-Reset legt ea_monatsabschluss an), dort lehnt a_rechnung_periodensperre jede Position ab
    v_e := pg_temp.s112_beispiel('verkaufsposten', p_m);
    RETURN pg_temp.s112_beispiel(p_tab, p_m, NULL, jsonb_build_object('verkaufsposten_id', v_e ->> 'id'));
  ELSIF p_klasse = 'K' AND p_eltern_tabelle IS NOT NULL THEN
    -- frische Elternzeile über s112_beispiel (ama_meldepositionen hängt so an einer eigenen Entwurfs-Meldung)
    v_e := pg_temp.s112_beispiel(p_eltern_tabelle, p_m);
    RETURN pg_temp.s112_beispiel(p_tab, p_m, NULL, jsonb_build_object(p_eltern_spalte, v_e ->> p_eltern_ref));
  END IF;
  RETURN pg_temp.s112_beispiel(p_tab, p_m);
END $f$;

-- Spalte für das No-op-UPDATE: die updatebare Spalte aus s112_mandantentabellen oder – ohne Spaltenrecht
-- (bestandsprotokoll, fuellung_bewegungen) – die erste nicht generierte Spalte ohne GENERATED ALWAYS AS IDENTITY
-- (sonst meldet Postgres 428C9 schon vor der Rechteprüfung statt G).
CREATE FUNCTION pg_temp.t12_upd_spalte(p_tab text, p_upd text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(p_upd,
    (SELECT a.attname::text FROM pg_attribute a
      WHERE a.attrelid = to_regclass(format('public.%I', p_tab)) AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attgenerated = '' AND a.attidentity <> 'a'
      ORDER BY (a.attname = 'tenant_id') DESC, a.attnum LIMIT 1))
$f$;

-- Änderungen für den INSERT-Klon (neuer Primärschlüssel kommt aus s112_klon_sql; UNIQUE-Spalten hier).
CREATE FUNCTION pg_temp.t12_klon_aend(p_tab text) RETURNS jsonb LANGUAGE sql VOLATILE AS $f$
  SELECT CASE p_tab
    WHEN 'tenants' THEN jsonb_build_object('slug', 's112test-klon-' || gen_random_uuid(), 'name', 'S112TEST Klon')
    ELSE '{}'::jsonb
  END
$f$;


DO $test$
DECLARE
  c_datei constant text := '12_rollen_modulrechte';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  c_ops   constant text[] := ARRAY['INSERT', 'UPDATE', 'DELETE'];
  -- eigene Benutzerzeilen, die ein Leser schreiben darf (Tabelle:Aktion)
  c_leser_eigen constant text[] := ARRAY['benachrichtigungen:UPDATE', 'benachrichtigungen:DELETE', 'profiles:INSERT',
    'profiles:UPDATE', 'release_notes_gesehen:INSERT', 'release_notes_gesehen:UPDATE', 'release_notes_gesehen:DELETE',
    'benutzer_dashboard:INSERT', 'benutzer_dashboard:UPDATE', 'benutzer_dashboard:DELETE',   -- KAN-388
    'user_email_connections:DELETE'];
  c_kein_delete constant text[] := ARRAY['ama_meldepositionen', 'behandlungen', 'dac_antrag', 'duengemittel_lager_bewegungen', 'ea_transaktionen', 'ernte_parzellen',
    'export_dokumente', 'exportauftraege', 'exportauftrag_positionen', 'fuellungen', 'konto_umbuchungen',
    'pruefnummernantraege', 'psm_lager_bewegungen', 'sumup_checkouts', 'transportbescheinigungen', 'verkauf_positionen',
    'verkaufsposten', 'weinanalysen', 'weinausbau', 'weinbaugebiete_custom', 'zahlungen', 'zukauf_posten'];   -- sonstige_artikel seit KAN-242 löschbar (unbenutzte Produkte; mit Bewegung sperrt der FK); fuellungen: KAN-145 B4, ernte_parzellen/weinausbau: KAN-148 C1d (nur über s112_storniert_loeschen);
                                                               -- Verkauf/E-A: KAN-149 D3 (nur stornieren, keine Lösch-RPC)
                                                               -- Anträge/Analysen/Export: KAN-150 F2a (nur über s112_storniert_loeschen)
  c_kein_update constant text[] := ARRAY['aktivitaet_dokumente', 'konto_umbuchungen', 'behandlung_grundstuecke',
    'buchhaltung_export_protokoll', 'pipeline_verlauf', 'assistent_aktionen', 'assistent_nachrichten'];
  c_delete_nur_admin constant text[] := ARRAY['ama_erntemeldungen', 'behaelter',
    'duengemittel', 'grundstuecke', 'kellerplaene', 'lagen', 'lesen', 'pflanzenschutzmittel', 'saetze_massnahmen',
    'weingarten', 'weingarten_rebsorten', 'weinjahrgaenge'];   -- Verkauf/E-A seit KAN-149 D3, dac_antrag/weinanalysen seit KAN-150 F2a, Maßnahmen/Mittel-Lager seit KAN-88 in c_kein_delete
  c_nur_admin constant text[] := ARRAY['buchhaltung_kontenmapping', 'ea_monatsabschluss', 'konten', 'sumup_terminals',
    'zeiterfassung'];
  c_ohne_schreibrecht constant text[] := ARRAY['bestandsprotokoll', 'fuellung_bewegungen', 'ea_dauerauftrag_log',
    'morgenberichte', 'wetter_stunden', 'stripe_zahlungen_log', 'sumup_transaktionen', 'system_ereignisse',
    'transaktionszaehler', 'module_flags'];
  c_nur_select_recht constant text[] := ARRAY['bestandsprotokoll', 'fuellung_bewegungen'];
  c_betrieb constant text[] := ARRAY['checklisten', 'checklisten_punkte', 'fristen'];
  -- je Modul eine Tabelle für die Schalter-Probe (Abschnitt 6): crm, kellerbuch, rieden/weingarten, warenwirtschaft, ea, weinexport
  c_modul_tabellen constant text[] := ARRAY['kontakte', 'weinausbau', 'weingarten', 'verkaufsposten', 'ea_transaktionen',
    'exportauftraege'];
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_pers  jsonb := '[]'::jsonb;
  v_p     jsonb;
  v_soll  jsonb;
  v_codes jsonb := '{}'::jsonb;
  v_tc    jsonb;
  r       record;
  v_z     jsonb;
  v_zok   boolean;
  v_sql   jsonb;
  v_op    text;
  v_code  text;
  v_kl    text;
  v_sb    boolean;
  v_mis   text[];
  v_leser text[] := '{}';
  v_tab   text;
  v_pn    text;
  v_txt   text;
  v_arr   text[];
  v_n     bigint;
  v_doc   jsonb;
  v_mwcrm uuid;
  v_mta   uuid;
  v_uid   uuid;
  v_rolle text;
  v_ez    jsonb;
  v_owner uuid;
  v_upd   text;
  v_x_ta_l uuid;
  v_x_w0  uuid;
  v_b     uuid;
  v_mz    jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── Aufbau (als postgres) ────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_pers := jsonb_build_array(
    jsonb_build_object('n', 'm_sa', 'u', v_a ->> 'm_sa', 'r', 'SA', 'mo', '[]'::jsonb),
    jsonb_build_object('n', 'm_ta', 'u', v_a ->> 'm_ta', 'r', 'TA', 'mo', '[]'::jsonb),
    jsonb_build_object('n', 'm_l', 'u', v_a ->> 'm_l', 'r', 'L', 'mo', '[]'::jsonb),
      jsonb_build_object('n', 'm_w_leer', 'u', v_a ->> 'm_w0', 'r', 'W', 'mo', '[]'::jsonb));
  -- Mehrbetriebs-Personas: im Musterhof nur Leser bzw. Winzer ohne Modul, in B tenant_admin bzw. Winzer mit allen
  -- Modulen. Im Musterhof müssen sie sich wie m_l bzw. m_w_leer verhalten – sonst prüft eine Policy oder
  -- s112_darf_schreiben Rolle/Modul ohne Bezug auf den Betrieb der Zeile.
  v_x_ta_l := pg_temp.s112_benutzer('tenant_admin', (v_a ->> 'b')::uuid);
  PERFORM pg_temp.s112_mitglied(v_x_ta_l, c_m, 'leser');
  v_x_w0 := pg_temp.s112_benutzer('winzer', (v_a ->> 'b')::uuid);
  PERFORM pg_temp.s112_mitglied(v_x_w0, c_m, 'winzer', '{}'::text[]);
  v_pers := v_pers || jsonb_build_array(
    jsonb_build_object('n', 'x_ta_l', 'u', v_x_ta_l, 'r', 'L', 'mo', '[]'::jsonb),
    jsonb_build_object('n', 'x_w0', 'u', v_x_w0, 'r', 'W', 'mo', '[]'::jsonb));
  FOREACH v_txt IN ARRAY pg_temp.s112_soll_liste('schreibmodule') LOOP
    v_pers := v_pers || jsonb_build_array(jsonb_build_object('n', 'm_w_' || v_txt,
      'u', pg_temp.s112_benutzer('winzer', c_m, ARRAY[v_txt]), 'r', 'W', 'mo', jsonb_build_array(v_txt)));
  END LOOP;
  v_mwcrm := (SELECT (e ->> 'u')::uuid FROM jsonb_array_elements(v_pers) e WHERE e ->> 'n' = 'm_w_crm');
  -- Staging hat keine release_notes: eine anlegen (für release_notes_gesehen)
  IF NOT EXISTS (SELECT 1 FROM public.release_notes) THEN
    PERFORM pg_temp.s112_zeile('release_notes', NULL);
  END IF;
  SELECT jsonb_object_agg(s.tabelle || ':' || s.aktion, jsonb_build_object('r', to_jsonb(s.rollen), 'm', to_jsonb(s.module)))
    INTO v_soll FROM pg_temp.s112_soll() s;

  -- Aufbau belegen: Einmodul-Winzer haben genau ihr Modul, m_w_leer keines, m_sa ist kein Plattform-Admin
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_pers) e
    JOIN public.tenant_memberships m ON m.user_id = (e ->> 'u')::uuid AND m.tenant_id = c_m
   WHERE e ->> 'r' = 'W' AND m.aktiv AND m.role = 'winzer'
     AND coalesce(m.schreibmodule, '{}'::text[]) = pg_temp.t12_arr(e -> 'mo');
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_winzer_module', v_n, 8);
  -- Mehrbetriebs-Personas: in B hohe Rolle bzw. alle Module, im Musterhof Leser bzw. Winzer ohne Modul (beide aktiv)
  SELECT count(*) INTO v_n FROM public.tenant_memberships m
   WHERE m.aktiv AND ((m.user_id = v_x_ta_l AND m.tenant_id = (v_a ->> 'b')::uuid AND m.role = 'tenant_admin')
      OR (m.user_id = v_x_ta_l AND m.tenant_id = c_m AND m.role = 'leser')
      OR (m.user_id = v_x_w0 AND m.tenant_id = (v_a ->> 'b')::uuid AND m.role = 'winzer' AND cardinality(m.schreibmodule) = 6)
      OR (m.user_id = v_x_w0 AND m.tenant_id = c_m AND m.role = 'winzer' AND m.schreibmodule = '{}'::text[]));
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_mehrbetrieb_personas', v_n, 4);
  SELECT count(*) INTO v_n FROM public.plattform_admins WHERE user_id = (v_a ->> 'm_sa')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_m_sa_kein_plattform_admin', v_n, 0);

  -- Mutationen: nach dem Aufbau, vor den Prüfungen, auf oberster Ebene
  PERFORM pg_temp.s112_mutiere('modul_egal', $m$
    CREATE OR REPLACE FUNCTION public.s112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[])
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $fn$
      SELECT EXISTS (SELECT 1 FROM tenant_memberships m
                      WHERE m.tenant_id = p_tenant AND m.user_id = (SELECT auth.uid()) AND m.aktiv
                        AND m.role IN ('system_admin', 'tenant_admin', 'winzer'))
    $fn$$m$);
  PERFORM pg_temp.s112_mutiere('zeiterfassung_offen', $m$CREATE POLICY s112test_ze ON public.zeiterfassung FOR ALL TO authenticated USING (true) WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('loeschen_offen', $m$CREATE POLICY s112test_wb ON public.weinbaugebiete_custom FOR DELETE TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('neue_tabelle', $m$CREATE TABLE public.s112test_neu (id integer PRIMARY KEY)$m$);
  PERFORM pg_temp.s112_mutiere('eigner_aufgeweicht', $m$CREATE POLICY s112test_bn ON public.benachrichtigungen FOR ALL TO authenticated USING (tenant_id IN (SELECT public.s112_meine_tenants())) WITH CHECK (tenant_id IN (SELECT public.s112_meine_tenants()))$m$);
  PERFORM pg_temp.s112_mutiere('modul_entkoppelt', $m$
    CREATE OR REPLACE FUNCTION public.s112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[])
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $fn$
      SELECT EXISTS (SELECT 1 FROM tenant_memberships m
                      WHERE m.tenant_id = p_tenant AND m.user_id = (SELECT auth.uid()) AND m.aktiv
                        AND m.role IN ('system_admin', 'tenant_admin', 'winzer'))
         AND EXISTS (SELECT 1 FROM tenant_memberships m
                      WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
                        AND (m.role IN ('system_admin', 'tenant_admin')
                             OR (m.role = 'winzer' AND ('betrieb' = ANY (p_module) OR coalesce(m.schreibmodule, '{}') && p_module))))
    $fn$$m$);
  PERFORM pg_temp.s112_mutiere('rolle_entkoppelt', $m$
    ALTER POLICY behaelter_delete ON public.behaelter
      USING (tenant_id IN (SELECT public.s112_meine_tenants())
             AND EXISTS (SELECT 1 FROM public.tenant_memberships m
                          WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin')));
    CREATE OR REPLACE FUNCTION public.s112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[])
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $fn$
      SELECT EXISTS (SELECT 1 FROM tenant_memberships m
                      WHERE m.tenant_id = p_tenant AND m.user_id = (SELECT auth.uid()) AND m.aktiv)
         AND EXISTS (SELECT 1 FROM tenant_memberships m
                      WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
                        AND (m.role IN ('system_admin', 'tenant_admin')
                             OR (m.role = 'winzer' AND ('betrieb' = ANY (p_module) OR coalesce(m.schreibmodule, '{}') && p_module))))
    $fn$$m$);
  PERFORM pg_temp.s112_mutiere('mitglied_selbst', $m$CREATE POLICY s112test_tm ON public.tenant_memberships FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())$m$);
  PERFORM pg_temp.s112_mutiere('zeit_del_offen', $m$CREATE POLICY s112test_zeit_del ON public.zeiterfassung AS PERMISSIVE FOR DELETE TO authenticated USING (true)$m$);

  -- ── 1. Soll-Abdeckung ────────────────────────────────────────────────────────────────────────────────
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_temp.s112_soll() s WHERE s.tabelle = c.relname::text);
  FOREACH v_tab IN ARRAY v_arr LOOP
    v_erg := v_erg || pg_temp.s112_fehler('soll_fehlt:' || v_tab, 'Tabelle public.' || v_tab || ' fehlt in pg_temp.s112_soll() (_helfer.sql)');
  END LOOP;
  SELECT coalesce(array_agg(DISTINCT s.tabelle), '{}') INTO v_arr
    FROM pg_temp.s112_soll() s
   WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname::text = s.tabelle);
  FOREACH v_tab IN ARRAY v_arr LOOP
    v_erg := v_erg || pg_temp.s112_fehler('soll_veraltet:' || v_tab, 'Soll-Eintrag ohne Tabelle public.' || v_tab);
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND EXISTS (SELECT 1 FROM pg_temp.s112_soll() s WHERE s.tabelle = c.relname::text);
  v_erg := v_erg || pg_temp.s112_erwarte('soll_deckt_tabellen', v_n, (SELECT count(DISTINCT tabelle) FROM pg_temp.s112_soll()));

  -- ── 2. Rollenmatrix je Tabelle × Persona × Aktion ────────────────────────────────────────────────────
  FOR r IN SELECT * FROM pg_temp.s112_mandantentabellen() t
            WHERE EXISTS (SELECT 1 FROM pg_temp.s112_soll() s WHERE s.tabelle = t.tabelle)
            ORDER BY t.tabelle LOOP
    v_tc := '{}'::jsonb;
    v_mis := '{}';
    v_zok := true;
    v_sql := NULL;
    FOR v_p IN SELECT e FROM jsonb_array_elements(v_pers) e LOOP
      v_pn := v_p ->> 'n';
      -- Beispielzeile (einmal je Tabelle bzw. je Persona) und die drei Anweisungen, als postgres
      IF v_sql IS NULL OR pg_temp.t12_pro_persona(r.tabelle) THEN
        PERFORM pg_temp.s112_als_postgres();
        BEGIN
          v_z := pg_temp.t12_zeile(r.tabelle, r.klasse, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref,
                                   c_m, (v_a ->> 'b')::uuid, (v_a ->> 'pa')::uuid, (v_p ->> 'u')::uuid);
          IF v_z IS NULL THEN
            RAISE EXCEPTION 'keine Beispielzeile';
          END IF;
          v_sql := jsonb_build_object(
            'INSERT', pg_temp.s112_klon_sql(r.tabelle, v_z, pg_temp.t12_klon_aend(r.tabelle)),
            'UPDATE', format('UPDATE public.%I SET %I = %I WHERE %s', r.tabelle, pg_temp.t12_upd_spalte(r.tabelle, r.upd_spalte),
                             pg_temp.t12_upd_spalte(r.tabelle, r.upd_spalte), pg_temp.s112_pk_where(r.tabelle, v_z)),
            'DELETE', format('DELETE FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_z)));
          v_code := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_z)));
          IF v_code <> '1' THEN
            v_zok := false;
            v_erg := v_erg || pg_temp.s112_fehler('zeile_vorhanden:' || r.tabelle || ':' || v_pn, 'ist=' || v_code || ' soll=1');
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_sql := NULL;
          v_zok := false;
          v_erg := v_erg || pg_temp.s112_fehler('beispiel:' || r.tabelle || ':' || v_pn, SQLSTATE || ' ' || SQLERRM);
        END;
      END IF;
      IF v_sql IS NOT NULL THEN
        PERFORM pg_temp.s112_als((v_p ->> 'u')::uuid);
        FOREACH v_op IN ARRAY c_ops LOOP
          v_code := pg_temp.t12_wirkung(pg_temp.s112_versuch(v_sql ->> v_op), r.tabelle, v_op, v_z);
          v_kl := pg_temp.t12_klasse(v_code);
          v_sb := pg_temp.t12_soll_erlaubt(v_soll -> (r.tabelle || ':' || v_op), v_p ->> 'r', pg_temp.t12_arr(v_p -> 'mo'));
          v_tc := v_tc || jsonb_build_object(v_op || ':' || v_pn, v_code);
          IF v_kl = 'unklar' OR v_sb IS NULL OR (v_kl = 'erlaubt') IS DISTINCT FROM v_sb THEN
            v_mis := v_mis || v_op;
            v_erg := v_erg || pg_temp.s112_fehler('rolle:' || r.tabelle || ':' || v_op || ':' || v_pn,
                        'ist=' || v_code || '(' || v_kl || ') soll=' || CASE WHEN v_sb THEN 'erlaubt' WHEN NOT v_sb THEN 'verweigert' ELSE 'unbekannt' END);
          END IF;
          IF v_pn = 'm_l' AND v_kl = 'erlaubt' AND NOT (r.tabelle || ':' || v_op) = ANY (c_leser_eigen) THEN
            v_leser := v_leser || (r.tabelle || ':' || v_op || '=' || v_code);
          END IF;
        END LOOP;
        PERFORM pg_temp.s112_als_postgres();
      ELSE
        v_mis := c_ops;
      END IF;
    END LOOP;
    PERFORM pg_temp.s112_als_postgres();
    IF v_zok THEN
      v_erg := v_erg || pg_temp.s112_ok('zeile_vorhanden:' || r.tabelle);
    END IF;
    FOREACH v_op IN ARRAY c_ops LOOP
      IF NOT v_op = ANY (v_mis) THEN
        v_erg := v_erg || pg_temp.s112_ok('rolle:' || r.tabelle || ':' || v_op);
      END IF;
    END LOOP;
    v_codes := v_codes || jsonb_build_object(r.tabelle, v_tc);
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM jsonb_object_keys(v_codes);
  v_erg := v_erg || pg_temp.s112_erwarte('matrix_tabellen_geprueft', v_n,
    (SELECT count(*) FROM pg_temp.s112_mandantentabellen() t WHERE EXISTS (SELECT 1 FROM pg_temp.s112_soll() s WHERE s.tabelle = t.tabelle)));

  -- ── 3. Leser ─────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('leser_schreibt_nirgends', array_to_string(v_leser, ','), '');
  FOREACH v_txt IN ARRAY c_leser_eigen LOOP
    v_code := v_codes -> split_part(v_txt, ':', 1) ->> (split_part(v_txt, ':', 2) || ':m_l');
    v_erg := v_erg || pg_temp.s112_erwarte('leser_eigen:' || v_txt, coalesce(v_code, '-') || '/' || coalesce(pg_temp.t12_klasse(v_code), '-'),
                                           coalesce(v_code, '-') || '/erlaubt');
  END LOOP;

  -- ── 4. Harte Einzelprüfungen ────────────────────────────────────────────────────────────────────────
  -- Kein DELETE bzw. kein UPDATE für niemanden: auch m_sa/m_ta treffen 0 Zeilen
  FOREACH v_tab IN ARRAY c_kein_delete LOOP
    FOREACH v_pn IN ARRAY ARRAY['m_sa', 'm_ta'] LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('kein_delete:' || v_tab || ':' || v_pn, coalesce(v_codes -> v_tab ->> ('DELETE:' || v_pn), 'fehlt'), 'k0');
    END LOOP;
  END LOOP;
  FOREACH v_tab IN ARRAY c_kein_update LOOP
    FOREACH v_pn IN ARRAY ARRAY['m_sa', 'm_ta'] LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('kein_update:' || v_tab || ':' || v_pn, coalesce(v_codes -> v_tab ->> ('UPDATE:' || v_pn), 'fehlt'), 'k0');
    END LOOP;
  END LOOP;
  -- DELETE nur SA/TA: m_ta löscht (k1, bei Verweisen E23503), der Winzer mit passendem Modul trifft 0 Zeilen
  FOREACH v_tab IN ARRAY c_delete_nur_admin LOOP
    v_code := coalesce(v_codes -> v_tab ->> 'DELETE:m_ta', 'fehlt');
    v_erg := v_erg || pg_temp.s112_erwarte('delete_nur_admin:' || v_tab || ':m_ta', CASE WHEN v_code IN ('k1', 'E23503') THEN 'k1|E23503' ELSE v_code END, 'k1|E23503');
    v_txt := (SELECT s.module[1] FROM pg_temp.s112_soll() s WHERE s.tabelle = v_tab AND s.aktion = 'DELETE');
    v_erg := v_erg || pg_temp.s112_erwarte('delete_nur_admin:' || v_tab || ':m_w_' || coalesce(v_txt, '?'),
                                           coalesce(v_codes -> v_tab ->> ('DELETE:m_w_' || v_txt), 'fehlt'), 'k0');
    v_erg := v_erg || pg_temp.s112_erwarte('delete_nur_admin:' || v_tab || ':winzer_darf_einfuegen',
                                           pg_temp.t12_klasse(v_codes -> v_tab ->> ('INSERT:m_w_' || v_txt)), 'erlaubt');
  END LOOP;
  -- Schreiben nur SA/TA: kein Winzer schreibt, m_ta legt an
  FOREACH v_tab IN ARRAY c_nur_admin LOOP
    SELECT coalesce(string_agg(k.key || '=' || k.value, ','), '') INTO v_txt
      FROM jsonb_each_text(coalesce(v_codes -> v_tab, '{}'::jsonb)) k
     WHERE split_part(k.key, ':', 2) LIKE 'm_w_%' AND pg_temp.t12_klasse(k.value) <> 'verweigert';
    v_erg := v_erg || pg_temp.s112_erwarte('nur_admin:' || v_tab, v_txt, '');
    v_erg := v_erg || pg_temp.s112_erwarte('nur_admin:' || v_tab || ':m_ta_legt_an', pg_temp.t12_klasse(v_codes -> v_tab ->> 'INSERT:m_ta'), 'erlaubt');
  END LOOP;
  -- Ganz ohne Schreibrecht für jede Mandanten-Persona (module_flags: nur Plattform-Admin, siehe 17)
  FOREACH v_tab IN ARRAY c_ohne_schreibrecht LOOP
    SELECT coalesce(string_agg(k.key || '=' || k.value, ','), '') INTO v_txt
      FROM jsonb_each_text(coalesce(v_codes -> v_tab, '{"fehlt":"-"}'::jsonb)) k
     WHERE coalesce(pg_temp.t12_klasse(k.value), 'unklar') <> 'verweigert';
    v_erg := v_erg || pg_temp.s112_erwarte('ohne_schreibrecht:' || v_tab, v_txt, '');
  END LOOP;
  SELECT coalesce(string_agg(k.key || '=' || k.value, ','), '') INTO v_txt
    FROM jsonb_each_text(coalesce(v_codes -> 'tenant_memberships', '{"fehlt":"-"}'::jsonb)) k
   WHERE split_part(k.key, ':', 1) IN ('INSERT', 'UPDATE', 'fehlt') AND coalesce(pg_temp.t12_klasse(k.value), 'unklar') <> 'verweigert';
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_schreibrecht:tenant_memberships_insert_update', v_txt, '');
  -- bestandsprotokoll und fuellung_bewegungen: authenticated hat nur SELECT → G
  FOREACH v_tab IN ARRAY c_nur_select_recht LOOP
    FOREACH v_op IN ARRAY c_ops LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('nur_select_recht:' || v_tab || ':' || v_op, coalesce(v_codes -> v_tab ->> (v_op || ':m_ta'), 'fehlt'), 'G');
    END LOOP;
  END LOOP;
  -- Modul 'betrieb': jeder Winzer schreibt, auch ohne Schreibmodul
  FOREACH v_tab IN ARRAY c_betrieb LOOP
    SELECT coalesce(string_agg(k.key || '=' || k.value, ','), 'fehlt') INTO v_txt
      FROM jsonb_each_text(coalesce(v_codes -> v_tab, '{}'::jsonb)) k
     WHERE split_part(k.key, ':', 2) LIKE 'm_w_%' AND pg_temp.t12_klasse(k.value) <> 'erlaubt';
    SELECT count(*) INTO v_n FROM jsonb_each_text(coalesce(v_codes -> v_tab, '{}'::jsonb)) k WHERE split_part(k.key, ':', 2) LIKE 'm_w_%';
    v_erg := v_erg || pg_temp.s112_erwarte('betrieb_jeder_winzer:' || v_tab, v_n || ':' || CASE WHEN v_txt = 'fehlt' THEN '' ELSE v_txt END, '21:');
  END LOOP;

  -- ── 4b. Eigene Mitgliedschaft: keine Selbst-Eskalation (Module, Rolle, Aktiv-Status) ─────────────────
  -- Echte Wertänderungen an der EIGENEN Zeile (die Matrix oben prüft nur die Zeile eines fremden Benutzers
  -- per No-op). Erlaubt wäre k≥1; verweigert = k0, R, G, T. Vorher als postgres: eigene Zeile existiert.
  FOR v_p IN SELECT e FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('n', 'm_sa', 'u', v_a ->> 'm_sa', 'r', 'tenant_admin'),
      jsonb_build_object('n', 'm_ta', 'u', v_a ->> 'm_ta', 'r', 'system_admin'),
      jsonb_build_object('n', 'm_l', 'u', v_a ->> 'm_l', 'r', 'tenant_admin'),
      jsonb_build_object('n', 'm_w_leer', 'u', v_a ->> 'm_w0', 'r', 'tenant_admin'),
      jsonb_build_object('n', 'm_w_crm', 'u', v_mwcrm, 'r', 'tenant_admin'),
      jsonb_build_object('n', 'm_inak', 'u', v_a ->> 'm_inak', 'r', 'tenant_admin'))) e LOOP
    v_pn := v_p ->> 'n';
    v_uid := (v_p ->> 'u')::uuid;
    v_rolle := v_p ->> 'r';
    PERFORM pg_temp.s112_als_postgres();
    v_erg := v_erg || pg_temp.s112_erwarte('mitglied_eigen_zeile:' || v_pn,
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', c_m, v_uid)), '1');
    PERFORM pg_temp.s112_als(v_uid);
    v_code := pg_temp.s112_versuch(format(
      'UPDATE public.tenant_memberships SET schreibmodule = ARRAY[''crm'', ''kellerbuch'', ''rieden'', ''warenwirtschaft'', ''ea'', ''auswertungen'']::text[] WHERE tenant_id = %L AND user_id = %L',
      c_m, v_uid));
    v_erg := v_erg || pg_temp.s112_erwarte('mitglied_selbst:' || v_pn || ':module', v_code || '/' || pg_temp.t12_klasse(v_code), v_code || '/verweigert');
    v_code := pg_temp.s112_versuch(format('UPDATE public.tenant_memberships SET role = %L WHERE tenant_id = %L AND user_id = %L', v_rolle, c_m, v_uid));
    v_erg := v_erg || pg_temp.s112_erwarte('mitglied_selbst:' || v_pn || ':rolle', v_code || '/' || pg_temp.t12_klasse(v_code), v_code || '/verweigert');
    v_code := pg_temp.s112_versuch(format('UPDATE public.tenant_memberships SET aktiv = true WHERE tenant_id = %L AND user_id = %L', c_m, v_uid));
    v_erg := v_erg || pg_temp.s112_erwarte('mitglied_selbst:' || v_pn || ':aktiv', v_code || '/' || pg_temp.t12_klasse(v_code), v_code || '/verweigert');
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;
  -- Positivkontrolle: dieselbe Modul-Anweisung wirkt beim Plattform-Admin (sonst wären die k0 oben wertlos)
  PERFORM pg_temp.s112_als((v_a ->> 'pa')::uuid);
  v_code := pg_temp.s112_versuch(format(
    'UPDATE public.tenant_memberships SET schreibmodule = ARRAY[''crm'', ''kellerbuch'', ''rieden'', ''warenwirtschaft'', ''ea'', ''auswertungen'']::text[] WHERE tenant_id = %L AND user_id = %L',
    c_m, v_mwcrm));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('mitglied_kontrolle:pa_aendert_module', v_code, 'k1');

  -- ── 4c. Fremder Eigentümer im selben Betrieb ────────────────────────────────────────────────────────
  FOR v_p IN SELECT e FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('n', 'm_w', 'u', v_a ->> 'm_w', 'eigner', v_a ->> 'm_ta'),
      jsonb_build_object('n', 'm_ta', 'u', v_a ->> 'm_ta', 'eigner', v_a ->> 'm_w'))) e LOOP
    v_pn := v_p ->> 'n';
    v_uid := (v_p ->> 'u')::uuid;
    v_owner := (v_p ->> 'eigner')::uuid;
    PERFORM pg_temp.s112_als_postgres();
    -- Zeilen des anderen Mitglieds (als postgres)
    v_ez := jsonb_build_object(
      'benachrichtigungen', pg_temp.s112_beispiel('benachrichtigungen', c_m, v_owner),
      'assistent_unterhaltungen', pg_temp.s112_beispiel('assistent_unterhaltungen', c_m, v_owner),
      -- UNIQUE (user_id, release_note_id): aus der Matrix oben kann schon eine Zeile des Eigentümers existieren
      'release_notes_gesehen', coalesce((SELECT to_jsonb(x.*) FROM public.release_notes_gesehen x WHERE x.user_id = v_owner LIMIT 1),
                                        pg_temp.s112_beispiel('release_notes_gesehen', NULL, v_owner)),
      'profiles', (SELECT to_jsonb(x.*) FROM public.profiles x WHERE x.id = v_owner),
      -- KAN-388: PK user_id – aus der Matrix oben kann schon eine Zeile des Eigentümers existieren
      'benutzer_dashboard', coalesce((SELECT to_jsonb(x.*) FROM public.benutzer_dashboard x WHERE x.user_id = v_owner),
                                     pg_temp.s112_beispiel('benutzer_dashboard', NULL, v_owner)));
    v_ez := v_ez || jsonb_build_object(
      'assistent_nachrichten', pg_temp.s112_beispiel('assistent_nachrichten', c_m, v_owner,
        jsonb_build_object('unterhaltung_id', v_ez -> 'assistent_unterhaltungen' ->> 'id')),
      'assistent_aktionen', pg_temp.s112_beispiel('assistent_aktionen', c_m, v_owner,
        jsonb_build_object('unterhaltung_id', v_ez -> 'assistent_unterhaltungen' ->> 'id')));
    FOR r IN SELECT k.key AS tab, k.value AS z FROM jsonb_each(v_ez) k ORDER BY k.key LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('eigner_zeile_vorhanden:' || r.tab || ':' || v_pn,
        pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', r.tab, pg_temp.s112_pk_where(r.tab, r.z))), '1');
    END LOOP;
    PERFORM pg_temp.s112_als(v_uid);
    FOR r IN SELECT k.key AS tab, k.value AS z FROM jsonb_each(v_ez) k ORDER BY k.key LOOP
      v_upd := pg_temp.t12_upd_spalte(r.tab, (SELECT m.upd_spalte FROM pg_temp.s112_mandantentabellen() m WHERE m.tabelle = r.tab));
      -- Assistent-Verläufe privat je Benutzer (KAN-159 B14, vorher für alle Mitglieder lesbar) – wie die übrigen
      IF r.tab <> 'profiles' THEN   -- Profile der Mitglieder gemeinsamer Betriebe sind lesbar (B3; Datei 10)
        v_erg := v_erg || pg_temp.s112_erwarte('eigner_fremd:' || r.tab || ':SELECT:' || v_pn,
          pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', r.tab, pg_temp.s112_pk_where(r.tab, r.z))), '0');
      END IF;
      v_code := pg_temp.t12_wirkung(pg_temp.s112_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', r.tab, v_upd, v_upd,
                                    pg_temp.s112_pk_where(r.tab, r.z))), r.tab, 'UPDATE', r.z);
      v_erg := v_erg || pg_temp.s112_erwarte('eigner_fremd:' || r.tab || ':UPDATE:' || v_pn, v_code || '/' || pg_temp.t12_klasse(v_code), v_code || '/verweigert');
      v_code := pg_temp.t12_wirkung(pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', r.tab, pg_temp.s112_pk_where(r.tab, r.z))),
                                    r.tab, 'DELETE', r.z);
      v_erg := v_erg || pg_temp.s112_erwarte('eigner_fremd:' || r.tab || ':DELETE:' || v_pn, v_code || '/' || pg_temp.t12_klasse(v_code), v_code || '/verweigert');
      -- INSERT: Klon der fremden Zeile (Eigentümerspalte bleibt der andere Benutzer)
      v_code := pg_temp.s112_versuch(pg_temp.s112_klon_sql(r.tab, r.z));
      v_erg := v_erg || pg_temp.s112_erwarte('eigner_fremd:' || r.tab || ':INSERT:' || v_pn,
        CASE WHEN v_code IN ('R', 'G', 'T') THEN 'verweigert' ELSE v_code END, 'verweigert');
    END LOOP;
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;

  -- ── 5. Bezeichnung vs. Verhalten: aktivitaet_dokumente ──────────────────────────────────────────────
  -- Soll (Entscheidung Jörgen 04.10.2026, KAN-159 B12.1): wer im CRM schreiben darf, löscht auch Dokumente anderer
  -- Mitglieder – wie die App (/api/crm/aktivitaet/[id]/dokument/[dok_id]); m_w_crm löscht ein Dokument von m_ta.
  PERFORM pg_temp.s112_als_postgres();
  v_doc := pg_temp.s112_beispiel('aktivitaet_dokumente', c_m, v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('dokument_ersteller_m_ta', v_doc ->> 'erstellt_von', v_mta::text);
  v_erg := v_erg || pg_temp.s112_erwarte('dokument_vorhanden',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.aktivitaet_dokumente WHERE %s', pg_temp.s112_pk_where('aktivitaet_dokumente', v_doc))), '1');
  PERFORM pg_temp.s112_als(v_mwcrm);
  v_code := pg_temp.s112_versuch(format('DELETE FROM public.aktivitaet_dokumente WHERE %s', pg_temp.s112_pk_where('aktivitaet_dokumente', v_doc)));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('dokument_fremder_ersteller_loeschbar', v_code, 'k1');

  -- ── 6. Modul- und Paketschalter beim Schreiben (B17) ────────────────────────────────────────────────
  -- Als postgres in B: je Modul eine Beispielzeile, dann alle modul_*-Schalter aus und alle module_flags weg.
  PERFORM pg_temp.s112_als_postgres();
  v_b := (v_a ->> 'b')::uuid;
  v_mz := '{}'::jsonb;
  FOREACH v_tab IN ARRAY c_modul_tabellen LOOP
    BEGIN
      v_mz := v_mz || jsonb_build_object(v_tab, pg_temp.s112_beispiel(v_tab, v_b, (v_a ->> 'b_ta')::uuid));
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('modul_schalter_beispiel:' || v_tab, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  SELECT array_agg(a.attname::text ORDER BY a.attname) INTO v_arr
    FROM pg_attribute a
   WHERE a.attrelid = 'public.tenant_einstellungen'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname LIKE 'modul\_%' AND a.atttypid = 'boolean'::regtype;
  v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_spalten_mind_8', coalesce(cardinality(v_arr), 0) >= 8, true);
  EXECUTE format('UPDATE public.tenant_einstellungen SET %s WHERE tenant_id = %L',
                 (SELECT string_agg(format('%I = false', x), ', ') FROM unnest(v_arr) x), v_b);
  DELETE FROM public.module_flags WHERE tenant_id = v_b;
  -- Beleg: in B ist kein Schalter mehr an, und b_w hat weiterhin alle sechs Schreibmodule
  EXECUTE format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L AND (%s)', v_b,
                 (SELECT string_agg(format('coalesce(%I, false)', x), ' OR ') FROM unnest(v_arr) x)) INTO v_n;
  v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_aus:tenant_einstellungen', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM public.tenant_einstellungen WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_aus:zeile_vorhanden', v_n, 1::bigint);
  SELECT count(*) INTO v_n FROM public.module_flags WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_aus:module_flags', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM public.tenant_memberships m
   WHERE m.tenant_id = v_b AND m.user_id = (v_a ->> 'b_w')::uuid AND m.aktiv AND m.role = 'winzer'
     AND coalesce(m.schreibmodule, pg_temp.s112_soll_liste('schreibmodule')) @> pg_temp.s112_soll_liste('schreibmodule');
  v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_b_w_alle_module', v_n, 1::bigint);
  FOREACH v_pn IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
    PERFORM pg_temp.s112_als((v_a ->> v_pn)::uuid);
    FOR r IN SELECT k.key AS tab, k.value AS z FROM jsonb_each(v_mz) k ORDER BY k.key LOOP
      v_code := pg_temp.s112_versuch(pg_temp.s112_klon_sql(r.tab, r.z));
      -- durch = RLS hat die neue Zeile angenommen (k≥1 oder ein Constraint danach), abgelehnt = R/G/T
      -- KAN-195 (vorher B17): Paket-Module (E&A, Export …) sperrt die DB; Kernmodule (Weingarten, Kellerbuch, CRM)
      -- und Warenwirtschaft sind in jedem Paket enthalten und bleiben frei (Entscheidung Jörgen 04.10.2026)
      v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_schreiben:' || r.tab || ':' || v_pn,
        CASE WHEN pg_temp.t12_klasse(v_code) = 'erlaubt' THEN 'durch' WHEN v_code IN ('R', 'G', 'T') THEN 'abgelehnt' ELSE v_code END,
        CASE WHEN r.tab IN ('ea_transaktionen', 'exportauftraege') THEN 'abgelehnt' ELSE 'durch' END);
    END LOOP;
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;
  SELECT count(*) INTO v_n FROM jsonb_object_keys(v_mz);
  v_erg := v_erg || pg_temp.s112_erwarte('modul_schalter_tabellen_geprueft', v_n, cardinality(c_modul_tabellen)::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 370);
END
$test$;
