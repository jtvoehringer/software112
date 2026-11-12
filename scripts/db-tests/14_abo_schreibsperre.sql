-- @bereich: Abo-Schreibsperre (Nur-Lesen-Modus, KAN-5)
-- @ziel: Ein Betrieb mit gesperrtem Abo liest alles, schreibt aber auf keinem Weg – weder in Tabellen (INSERT,
-- @ziel: UPDATE, DELETE auf jeder Tabelle mit Abo-Policy) noch über die schreibenden SECURITY-DEFINER-RPCs noch
-- @ziel: in Storage. Die Ausnahmen (system_admin, Plattform-Admin, feste IDs von Musterhof und Sandbox) greifen
-- @ziel: genau so weit wie vorgesehen; Statusregel und Policy-Katalog entsprechen dem Soll.
-- @mutation katalog_del_fehlt: DROP POLICY abo_schreibsperre_del auf kontakte – Löschen im gesperrten Betrieb wieder möglich | rot: abo_katalog:kontakte|gesperrt_del_.*
-- @mutation status_paused_frei: s112_abo_gesperrt ohne 'paused' (und ohne Sandbox-Ausnahme) | rot: status_paused|status_liste_funktion|ausnahme_sandbox.*
-- @mutation ausnahme_system_admin_weg: s112_schreibgesperrte_tenants nimmt system_admin nicht mehr aus | rot: ausnahme_b_sa.*
-- @mutation rpc_sperre_aus: s112_pruefe_abo_schreibsperre prüft nichts mehr | rot: rpc_gesperrt_.*
-- @mutation schreibgesperrte_leer: s112_schreibgesperrte_tenants liefert nie etwas (RLS- und Storage-Sperre aus) | rot: storage_.*|tenants_.*|gesperrt_.*|sperrmenge_.*
--
-- software:112 – SQL-Testsuite, Datei 14 (Stand 28.09.2026). Nur Staging; die ganze Datei ist EINE Transaktion
-- und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt.
--
-- Geprüft (Migrationen 20260925095428_kan5_abo_schreibsperre, 20260925104521_kan5_dauerauftraege_abo_sperre):
--   1. Katalog: jede Tabelle mit RLS außer den Soll-Ausnahmen (s112_soll_liste('abo_ausnahmen'): G-Tabellen sowie
--      benachrichtigungen, system_ereignisse, tenant_memberships, user_email_connections) hat die RESTRICTIVE
--      Policies abo_schreibsperre_ins/_upd/_del TO authenticated über s112_schreibgesperrte_tenants(), bei
--      nullable tenant_id NULL-sicher; tenants nur _upd; storage.objects alle drei. Neue Tabelle ohne Abo-Policy
--      → FEHLER abo_katalog:<tab>.
--   2. Statusregel public.s112_abo_gesperrt(B) als postgres (Liste = ABO_GESPERRTE_STATUS in src/lib/abo/regeln.ts).
--   3. Dynamisch je T/K-Tabelle mit Abo-Policy, als b_ta und b_w: Lesen bleibt, INSERT → R/T, UPDATE → k0/R,
--      DELETE → k0; Positivkontrolle mit stripe_status NULL (UPDATE/INSERT/DELETE k1, wo die Rolle darf).
--   4. tenants (bio_status) und die Ausnahmen: system_admin in B, Test-Plattform-Admin, Musterhof, Sandbox.
--   5. Die 14 schreibenden RPCs mit s112_pruefe_abo_schreibsperre → 42501 / HINT abo_gesperrt; lesende RPCs nicht;
--      KI-Zähler (check_und_increment_ki_abfrage, increment_ki_tokens) seit KAN-22 nur Service-Role → Benutzer 42501.
--   6. Storage (ea-belege, dokumente): Hochladen → R, Lesen bleibt, Löschen → k0.
--
-- Die Sandbox-ID ist eine Produktions-Betriebs-ID und steht deshalb NICHT in dieser Datei: der Test liest sie
-- aus dem Rumpf von s112_abo_gesperrt (die zweite feste UUID neben dem Musterhof) und belegt sie über ihren
-- md5-Wert; dann legt er einen Betrieb mit dieser ID an (wird mit zurückgerollt) und prüft die Ausnahme.

-- Führt eine RPC aus und rollt ihre Wirkung SOFORT zurück. Ergebnis: 'ok' oder '<SQLSTATE>[/<HINT>]'.
CREATE FUNCTION pg_temp.t14_rpc(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_state text;
  v_hint text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'S1T14', MESSAGE = 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
    IF v_state = 'S1T14' THEN
      RETURN 'ok';
    END IF;
    RETURN v_state || coalesce('/' || nullif(v_hint, ''), '');
  END;
END $f$;

-- UPDATE-Spalte für die No-op-Probe: upd_spalte, sonst die erste Spalte ohne Identity/Generated (tenant_id zuerst) –
-- wie t12_upd_spalte in Datei 12. Mit dem Primärschlüssel landete man bei IDENTITY ALWAYS (z. B. bestandsprotokoll.id)
-- in 428C9, frei wie gesperrt, und die Abo-Sperre für UPDATE bliebe ungeprüft.
CREATE FUNCTION pg_temp.t14_upd_spalte(p_tab text, p_upd text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(p_upd,
    (SELECT a.attname::text FROM pg_attribute a
      WHERE a.attrelid = to_regclass(format('public.%I', p_tab)) AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attgenerated = '' AND a.attidentity <> 'a'
      ORDER BY (a.attname = 'tenant_id') DESC, a.attnum LIMIT 1))
$f$;

-- Proben einer Persona auf allen Beispielzeilen: {tab: {s: SELECT-Zahl, i: INSERT-Klon, u: No-op-UPDATE, d: DELETE}}.
-- p_zeilen: {tab: {z: zeile, u: update-spalte, w: pk-bedingung}}. Wird als postgres aufgerufen, endet als postgres.
CREATE FUNCTION pg_temp.t14_proben(p_zeilen jsonb, p_persona uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  r record;
  v_erg jsonb := '{}';
  v_sql_i text;
BEGIN
  FOR r IN SELECT e.key AS tab, e.value -> 'z' AS z, e.value ->> 'u' AS u, e.value ->> 'w' AS w
             FROM jsonb_each(p_zeilen) e ORDER BY e.key LOOP
    v_sql_i := pg_temp.s112_klon_sql(r.tab, r.z);
    PERFORM pg_temp.s112_als(p_persona);
    v_erg := v_erg || jsonb_build_object(r.tab, jsonb_build_object(
      's', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', r.tab, r.w)),
      'i', pg_temp.s112_versuch(v_sql_i),
      'u', pg_temp.s112_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', r.tab, r.u, r.u, r.w)),
      'd', pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', r.tab, r.w))));
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;
  RETURN v_erg;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei     constant text := '14_abo_schreibsperre';
  c_m         constant uuid := '33333333-3333-4333-8333-333333333333';
  -- Muss mit ABO_GESPERRTE_STATUS in src/lib/abo/regeln.ts (und s112_abo_gesperrt) übereinstimmen.
  c_gesperrt  constant text[] := ARRAY['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused'];
  -- Schreibende SECURITY-DEFINER-RPCs mit s112_pruefe_abo_schreibsperre (Soll-Liste; s112_zukauf_buchen seit KAN-193; s112_verschnitt_buchen/s112_verschnitte_buchen seit KAN-112; s112_betriebsmittel_einkauf/_stornieren seit KAN-167; s112_herkunft_setzen seit KAN-150 F1d; s112_kontakt_historie_zu_firma seit KAN-150 F1c; s112_fuellung_verkauf_buchen seit KAN-149 D1; s112_ea_/zahlung_/umbuchung_stornieren seit D2; s112_storniert_loeschen seit KAN-145 (s112_buchung_loeschen von KAN-166 entfällt seit KAN-88), s112_pressung_stornieren/_zeilen_stornieren, s112_mostzeile_anlegen, s112_pressung_anlegen seit KAN-148, s112_ama_* seit KAN-148 C2, s112_ama_einreichen seit KAN-37 B, journal_eroeffnen/journal_abgleichen seit KAN-40, s112_pruefnummernantrag_status_setzen seit KAN-97, s112_fuellung_nachtragen seit KAN-101, s112_charge_abstufen seit KAN-82, s112_fuellung_aendern seit KAN-378).
  c_abo_rpcs  constant text[] := ARRAY['fuellung_bestand_buchen', 'get_next_accountnummer', 'get_next_chargennummer',
                                       'get_next_liefernummer', 'get_next_personenkonto', 'get_next_rechnungsnummer',   -- KAN-21: rechnungsnummer nur noch Service-Role (Prüfung bleibt)
                                       'get_next_transaktionsnr', 'journal_abgleichen', 'journal_eroeffnen', 'kellerbuch_abschliessen', 'kontakte_zusammenfuehren', 's112_ama_einreichen', 's112_ama_korrektur_anlegen', 's112_ama_meldung_speichern', 's112_ama_status_setzen', 's112_artikel_bewegung_stornieren', 's112_artikel_buchen', 's112_artikel_verkauf_buchen', 's112_artikel_verkauf_stornieren', 's112_betriebsmittel_einkauf', 's112_betriebsmittel_stornieren', 's112_charge_abstufen', 's112_charge_status_setzen', 's112_ea_kosten_zuordnen', 's112_ea_stornieren', 's112_elabel_umleiten', 's112_etikettierung_stornieren', 's112_freeze_korrektur', 's112_fuellung_aendern', 's112_fuellung_etikettieren', 's112_fuellung_nachtragen', 's112_fuellung_verkauf_buchen', 's112_herkunft_setzen', 's112_kontakt_historie_zu_firma', 's112_kontakt_personendaten_loeschen', 's112_lager_einkauf', 's112_lager_einkauf_stornieren', 's112_lohnversektung_stornieren', 's112_lohnversektung_versenden', 's112_mostzeile_anlegen', 's112_pressung_anlegen', 's112_pressung_stornieren', 's112_pressung_zeilen_stornieren', 's112_produktion_buchen', 's112_produktion_stornieren', 's112_pruefnummernantrag_status_setzen', 's112_psm_uebermittlung_protokollieren', 's112_rechnung_erstellen', 's112_rechnung_stornieren', 's112_sekt_stufe_setzen', 's112_storniert_loeschen', 's112_umbuchung_stornieren', 's112_verarbeitung_buchen', 's112_verarbeitung_stornieren', 's112_verkauf_samt_rechnung_stornieren', 's112_verschnitt_buchen', 's112_verschnitte_buchen', 's112_zahlung_stornieren', 's112_zugangskorrektur_buchen', 's112_zugangskorrektur_stornieren', 's112_zukauf_buchen', 'schwund_buchen',
                                       'setze_kontobewegung_abgeglichen', 'sperre_ea_monat', 'sperre_ea_uva'];
  -- Tabellen, deren Policies auth.uid() gegen eine Eigentümerspalte prüfen (wie t12_pro_persona in Datei 12)
  c_eigentuemer constant text[] := ARRAY['assistent_unterhaltungen', 'assistent_aktionen', 'assistent_nachrichten',
                                         'benachrichtigungen', 'user_email_connections'];
  -- Mindestabdeckung je Persona mit freiem Abo (Stand 29.09.2026 ausgezählt): lesen, ins (k1 oder E23xxx), upd, del
  -- del ohne die Tabellen mit Löschsperre: KAN-145 B4 71 → 65 bzw. 47 → 42, KAN-148 C1d → 59 bzw. 38 (30.09.2026),
  -- KAN-149 D3 → 53 (b_ta: Löschsperre Verkauf/E-A auf 5 Tabellen, Monatsabschluss unveränderlich), KAN-150 F1a → 52
  -- (Stammdaten-Löschsperre: eine Beispielzeile mit Bezug lässt sich nicht durch eine bezugsfreie ersetzen)
  c_min_b_ta  constant int[] := ARRAY[93, 81, 76, 44];   -- del +1 06.10.2026 (Probezeilen ohne Bezug aus den RPC-Daten, s112_keine_eltern: pflanzenschutzmittel und weinjahrgaenge stabil k1)   -- del −2 KAN-88 (Maßnahmen, Mittel-Lager mit Löschsperre)   -- del −6 KAN-150 F2a (Anträge/Analysen/Export mit Löschsperre)   -- del −1 KAN-150 F1d (weinausbau_weingaerten mit Löschsperre)
  c_min_b_w   constant int[] := ARRAY[91, 77, 71, 30];   -- del −2 KAN-88 (Maßnahmen, Mittel-Lager mit Löschsperre)   -- del −5 KAN-150 F2a (Anträge/Analysen/Export mit Löschsperre)   -- del −1 KAN-150 F1d (weinausbau_weingaerten mit Löschsperre)
  -- md5 der Sandbox-ID (SANDBOX_TENANT_ID in src/lib/abo/regeln.ts) – die ID selbst darf hier nicht stehen.
  c_sandbox_md5 constant text := 'c925cef2213a9938ec2714439901a74e';
  v_t0        timestamptz := clock_timestamp();
  v_erg       text[] := '{}';
  v_a         jsonb;
  v_b         uuid;
  v_bta       uuid;
  v_bw        uuid;
  v_bl        uuid;
  v_bsa       uuid;
  v_pa        uuid;
  v_mta       uuid;
  v_mbta      uuid;
  v_sandbox   uuid;
  v_sb_ta     uuid;
  v_n         bigint;
  v_n2        bigint;
  v_txt       text;
  v_arr       text[];
  v_bool      boolean;
  v_def       text;
  r           record;
  v_zeilen    jsonb := '{}';
  v_zeile     jsonb;
  v_frei      jsonb := '{}';
  v_gesp      jsonb := '{}';
  v_p         text;
  v_f         jsonb;
  v_g         jsonb;
  v_soll_rollen text[];
  v_fehler_vorher int;
  v_rpc       jsonb;
  v_rpc_frei  jsonb := '{}';
  v_rpc_gesp  jsonb := '{}';
  v_journal   jsonb;   -- KAN-40: Beispielzeilen des Journals in B (für journal_eroeffnen kurz entfernt)
  v_fuellung  uuid;
  v_wa        uuid;
  v_eatx      uuid;
  v_frz       uuid;   -- KAN-96: Zeile der Freeze-Testtabelle
  v_dac       uuid;   -- KAN-97: Prüfnummernantrag im Entwurf
  v_kb        uuid;
  v_kv        uuid;   -- KAN-41 Paket 3a: Verarbeitung in B
  v_sa        uuid;   -- KAN-115: Sonstiges Produkt mit Lagerstand in B
  v_sab       uuid;   -- KAN-115: Lagerbuchung (Zugang) in B
  v_svp       uuid;   -- KAN-115: Verkauf in B
  v_sekt      uuid;   -- KAN-190: Sekt g.U. mit Tirage vor 10 Monaten in B
  v_el1       uuid;   -- KAN-219: zwei freigegebene E-Labels in B (Umleitung)
  v_el2       uuid;
  v_pw        uuid;   -- KAN-118: Charge (Weiß) für die Produktion
  v_pb1       uuid;
  v_pb2       uuid;
  v_prod      uuid;   -- KAN-118: vorhandene Produktion (Storno)
  v_lvw       uuid;   -- KAN-232: Charge im Gebinde (Versand in der Probe)
  v_lvf       uuid;   -- KAN-232: Sektkellerei
  v_lv0       uuid;   -- KAN-232: offener Versand ohne Rückkehr (Storno in der Probe)
  v_rls       uuid;   -- KAN-103: Lieferschein ohne Rechnung (Rechnung erstellen)
  v_rre       uuid;   -- KAN-103: Rechnung aus einem zweiten Lieferschein (Storno)
  v_rsv       uuid;   -- KAN-356: Lieferschein mit eigener Rechnung (Verkauf samt Rechnung stornieren)
  v_zk        uuid;   -- KAN-53: Zugangskorrektur in B
  v_fe        uuid;   -- KAN-41 Paket 3d: Füllung mit unetikettierten Flaschen in B
  v_psm_beh   uuid;   -- KAN-120: Maßnahme in B für das Übermittlungsprotokoll
  v_et        uuid;   -- KAN-41 Paket 3d: Etikettierung in B
  v_pr        uuid;
  v_pr_jg     uuid;
  v_ama_jg    uuid;   -- KAN-148 C2: Jahrgang mit eingereichter Meldung (Korrektur)
  v_ama_ein   uuid;
  v_ama_ber   uuid;   -- bereite Meldung an eigenem Jahrgang (Status setzen, Speichern)
  v_ama_jg2   uuid;
  v_beh_b     uuid;
  v_pl        uuid;
  v_fz_b      uuid;   -- KAN-149 D1: Füllung in B (Flaschen-Rückbuchung)
  v_ea_b      uuid;   -- KAN-149 D2: E/A-Buchung, Zahlung, Umbuchung in B
  v_ea_k      uuid;   -- KAN-421: Ausgabe in B für die Kostenrechnung
  v_ks_b      uuid;   -- KAN-421: Kostenstelle in B
  v_kt_d      uuid;   -- KAN-425: Kontakt in B für „Personendaten löschen“
  v_za_b      uuid;
  v_ub_b      uuid;
  v_k1        uuid;
  v_k2        uuid;
  v_fi_b      uuid;   -- KAN-150 F1c: Firma in B (Umwandeln)
  v_wg_b      uuid;   -- KAN-150 F1d: Ried in B (Herkunft der Charge)
  v_bm_b      uuid;   -- KAN-167: Betriebsmittel, Lagerbuchung und Ausgaben-Kategorie (global) für B
  v_bml_b     uuid;
  v_lpsm_b    uuid;   -- KAN-326: PSM und PSM-Lagerbuchung für B
  v_lpl_b     uuid;
  v_eakat     uuid;
  v_abdeckung jsonb := '{}';
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 0. Aufbau (als postgres; B zunächst mit freiem Abo) ─────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_pa := (v_a ->> 'pa')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_mbta := (v_a ->> 'mb_ta')::uuid;
  v_bsa := pg_temp.s112_benutzer('system_admin', v_b);   -- system_admin in B, aber KEIN Plattform-Admin
  SELECT count(*) INTO v_n FROM public.plattform_admins WHERE user_id = v_bsa;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_sa_ohne_pa', v_n, 0);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_pa AND tenant_id = v_b AND role = 'system_admin' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_pa_system_admin_in_b', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = v_b AND stripe_status IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_abo_frei', v_n, 1);

  -- Beispielzeile in B für jede T/K-Tabelle mit Abo-Policy (Eigentümerspalten = b_w)
  FOR r IN SELECT m.tabelle, m.upd_spalte, m.pk
             FROM pg_temp.s112_mandantentabellen() m
            WHERE m.klasse IN ('T', 'K')
              AND EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = m.tabelle
                             AND p.policyname = 'abo_schreibsperre_upd')
            ORDER BY m.tabelle LOOP
    BEGIN
      v_zeile := pg_temp.s112_beispiel(r.tabelle, v_b, v_bw);
      v_zeilen := v_zeilen || jsonb_build_object(r.tabelle, jsonb_build_object(
        'z', v_zeile, 'u', pg_temp.t14_upd_spalte(r.tabelle, r.upd_spalte), 'w', pg_temp.s112_pk_where(r.tabelle, v_zeile)));
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('beispiel:' || r.tabelle, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  -- KAN-150 F1a: spätere Beispielzeilen verweisen auf frühere Stammdaten (z. B. Maßnahme → Ried) – mit Bezug greift
  -- die Löschsperre (T) vor der Abo-Policy. Solche Stammdaten-Zeilen durch eine frische Zeile ohne Bezug ersetzen.
  FOR r IN SELECT e.key AS tab FROM jsonb_each(v_zeilen) e
            WHERE e.key = ANY (pg_temp.s112_soll_liste('stammdaten_loeschsperre'))
              AND public.s112_stammdaten_bezuege_intern(e.key, (e.value #>> '{z,id}')::uuid) <> '{}'::jsonb ORDER BY 1 LOOP
    v_zeile := pg_temp.s112_beispiel(r.tab, v_b, v_bw);
    v_zeilen := v_zeilen || jsonb_build_object(r.tab, (v_zeilen -> r.tab) || jsonb_build_object('z', v_zeile, 'w', pg_temp.s112_pk_where(r.tab, v_zeile)));
  END LOOP;
  -- Die RPC-Daten unten dürfen sich nicht an die Probezeilen hängen: s112_zeile wählte vorhandene Elternzeilen per
  -- ORDER BY id, also je nach zufälliger UUID mal die Probezeile (psm_lager_bewegungen → pflanzenschutzmittel,
  -- pressungen → weinjahrgaenge) – dann griff die Löschsperre (T statt k1) und abdeckung_b_ta_del kippte (06.10.2026).
  PERFORM pg_temp.s112_keine_eltern(ARRAY(SELECT e.value #>> '{z,id}' FROM jsonb_each(v_zeilen) e WHERE e.value #>> '{z,id}' IS NOT NULL));
  -- Jede Beispielzeile existiert (als postgres belegt) – sonst wäre „0 Zeilen“ unten wertlos
  v_n2 := 0;
  FOR r IN SELECT e.key AS tab, e.value ->> 'w' AS w FROM jsonb_each(v_zeilen) e LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', r.tab, r.w) INTO v_n;
    IF v_n <> 1 THEN
      v_erg := v_erg || pg_temp.s112_fehler('zeile_existiert:' || r.tab, 'n=' || v_n);
      v_n2 := v_n2 + 1;
    END IF;
  END LOOP;
  IF v_n2 = 0 THEN
    v_erg := v_erg || pg_temp.s112_ok('zeilen_existieren');
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_object_keys(v_zeilen);
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_anzahl_mindestens_90', v_n >= 90, true);

  -- Daten für RPCs und Storage (als postgres, in B)
  v_fuellung := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"bestand_flaschen": "10"}') ->> 'id')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, v_bw, '{"menge_liter": "100"}') ->> 'id')::uuid;
  v_eatx := (pg_temp.s112_beispiel('ea_transaktionen', v_b, v_bw) ->> 'id')::uuid;
  -- KAN-96: s112_freeze_korrektur braucht eine Tabelle mit Freeze-Trigger – Testtabelle nur in dieser Transaktion
  CREATE TABLE public.s112test_freeze (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, betrag numeric);
  CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.s112test_freeze FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('S112TEST', 'true', '');
  INSERT INTO public.s112test_freeze (tenant_id, betrag) VALUES (v_b, 1) RETURNING id INTO v_frz;
  v_dac := (pg_temp.s112_beispiel('dac_antrag', v_b, v_bw) ->> 'id')::uuid;   -- KAN-97
  v_kb := (pg_temp.s112_beispiel('keller_behandlungen', v_b, v_bw,
    '{"storniert_am": "2026-09-30T10:00:00Z", "storno_grund": "S112TEST storniert"}') ->> 'id')::uuid;   -- KAN-145
  v_kv := (pg_temp.s112_beispiel('keller_verarbeitungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'datum', v_heute,
    'menge_liter', 1, 'zweck', 'essig', 'storniert_am', NULL)) ->> 'id')::uuid;   -- KAN-41 Paket 3a
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, bestand_fuehren) VALUES (v_b, 'S112TEST Traubensaft', 'Stk', true) RETURNING id INTO v_sa;   -- KAN-115
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (v_b, v_sa, v_heute, 'zugang', 5) RETURNING id INTO v_sab;
  v_svp := (pg_temp.s112_beispiel('verkaufsposten', v_b, NULL, jsonb_build_object('datum', v_heute, 'storniert', false)) ->> 'id')::uuid;
  v_sekt := (pg_temp.s112_beispiel('fuellungen', v_b, NULL, jsonb_build_object('erzeugnis', 'SEKTGU', 'qualitaet', 'qualitaetswein', 'datum', v_heute - 1,
    'tirage_datum', (v_heute - interval '10 months')::date, 'gaermethode', 'tankgaerung', 'storniert_am', NULL)) ->> 'id')::uuid;   -- KAN-190
  SELECT (pg_temp.s112_beispiel('elabels', v_b, NULL, jsonb_build_object('status', 'freigegeben', 'umleitung_auf', NULL, 'freigegeben_am', now(),
      'zutaten_ids', '{' || (SELECT z.id FROM public.elabel_zutaten z WHERE z.aktiv ORDER BY z.sortierung, z.id LIMIT 1) || '}',
      'energie_kj', 300, 'energie_kcal', 72, 'kohlenhydrate_g', 2.5, 'zucker_g', 0.4)) ->> 'id')::uuid INTO v_el1;   -- KAN-219
  SELECT (pg_temp.s112_beispiel('elabels', v_b, NULL, jsonb_build_object('status', 'freigegeben', 'umleitung_auf', NULL, 'freigegeben_am', now(),
      'zutaten_ids', '{' || (SELECT z.id FROM public.elabel_zutaten z WHERE z.aktiv ORDER BY z.sortierung, z.id LIMIT 1) || '}',
      'energie_kj', 300, 'energie_kcal', 72, 'kohlenhydrate_g', 2.5, 'zucker_g', 0.4)) ->> 'id')::uuid INTO v_el2;
  -- KAN-118: zwei Chargen und Gebinde; eine Produktion wird im Aufbau gebucht (für das Storno), die zweite in der Probe
  v_pw := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "300", "status": "ausbau", "aktiv": true, "storniert_am": null, "weinart": "weiss"}') ->> 'id')::uuid;
  v_pb1 := (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid;
  v_pb2 := (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid;
  v_prod := (public.s112_produktion_buchen(v_b, jsonb_build_object('art', 'perlwein', 'name', 'S112TEST Perlwein', 'behaelter_id', v_pb1),
    jsonb_build_array(jsonb_build_object('art', 'wein', 'weinausbau_id', v_pw, 'menge', 100))) ->> 'produktion_id')::uuid;
  v_zk := (pg_temp.s112_beispiel('keller_zugangskorrekturen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'datum', v_heute,
    'menge_liter', 1, 'art', 'inventur', 'grund', 'S112TEST Inventur-Plus', 'storniert_am', NULL)) ->> 'id')::uuid;   -- KAN-53
  v_psm_beh := (pg_temp.s112_beispiel('behandlungen', v_b, v_bw, '{"storniert_am": null}') ->> 'id')::uuid;   -- KAN-120
  -- KAN-232: Sektkellerei, eine Charge für den Versand in der Probe und ein offener Versand für das Storno
  v_lvf := (pg_temp.s112_beispiel('firmen', v_b, NULL, '{"name": "S112TEST Sektkellerei"}') ->> 'id')::uuid;
  v_lvw := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, jsonb_build_object('menge_liter', 100, 'status', 'ausbau', 'aktiv', true,
    'storniert_am', NULL, 'behaelter_id', (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid)) ->> 'id')::uuid;
  v_lv0 := public.s112_lohnversektung_versenden(v_b, (pg_temp.s112_beispiel('weinausbau', v_b, NULL, jsonb_build_object('menge_liter', 50,
    'status', 'ausbau', 'aktiv', true, 'storniert_am', NULL, 'behaelter_id', (pg_temp.s112_beispiel('behaelter', v_b, NULL,
    '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid)) ->> 'id')::uuid, pg_temp.s112_heute(), v_lvf, NULL);
  v_fe := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"anzahl_flaschen": 10, "bestand_flaschen": 10, "anzahl_unetikettiert": 5, "storniert_am": null}') ->> 'id')::uuid;   -- KAN-41 Paket 3d
  v_et := (pg_temp.s112_beispiel('fuellung_etikettierungen', v_b, NULL, jsonb_build_object('fuellung_id', v_fe, 'datum', v_heute,
    'menge_stk', 1, 'storniert_am', NULL)) ->> 'id')::uuid;
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen SET bestand_unetikettiert = 4 WHERE id = v_fe;   -- die eine etikettierte Flasche
  PERFORM set_config('s112.freeze_frei', '', true);
  v_pl := (pg_temp.s112_beispiel('psm_lager_bewegungen', v_b, v_bw) ->> 'id')::uuid;   -- KAN-166
  v_fz_b := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw) ->> 'id')::uuid;   -- KAN-149 D1
  v_ea_b := (pg_temp.s112_beispiel('ea_transaktionen', v_b, v_bw, jsonb_build_object('datum', v_heute)) ->> 'id')::uuid;   -- KAN-149 D2
  v_ea_k := (pg_temp.s112_beispiel('ea_transaktionen', v_b, v_bw, jsonb_build_object('datum', v_heute, 'typ', 'ausgabe', 'betrag_netto', 50, 'ust_satz', 20)) ->> 'id')::uuid;   -- KAN-421
  v_ks_b := (pg_temp.s112_beispiel('kostenstellen', v_b, v_bw, jsonb_build_object('aktiv', true)) ->> 'id')::uuid;   -- KAN-421
  v_kt_d := (pg_temp.s112_beispiel('kontakte', v_b, v_bw) ->> 'id')::uuid;   -- KAN-425
  v_za_b := (pg_temp.s112_beispiel('zahlungen', v_b, v_bw) ->> 'id')::uuid;
  -- KAN-103 (nach der Beispiel-Zahlung – die hängt sonst evtl. an diesem Lieferschein): zwei Lieferscheine „Rechnung später“; einer wird im Aufbau berechnet (für das Storno)
  v_rls := (pg_temp.s112_beispiel('verkaufsposten', v_b, NULL, jsonb_build_object('datum', v_heute, 'storniert', false, 'rechnung_spaeter', true)) ->> 'id')::uuid;
  v_rre := public.s112_rechnung_erstellen(v_b, ARRAY[(pg_temp.s112_beispiel('verkaufsposten', v_b, NULL,
    jsonb_build_object('datum', v_heute, 'storniert', false, 'rechnung_spaeter', true)) ->> 'id')::uuid], v_heute, '[]'::jsonb, NULL);
  v_rsv := (pg_temp.s112_beispiel('verkaufsposten', v_b, NULL, jsonb_build_object('datum', v_heute, 'storniert', false, 'rechnung_spaeter', true)) ->> 'id')::uuid;   -- KAN-356
  PERFORM public.s112_rechnung_erstellen(v_b, ARRAY[v_rsv], v_heute, '[]'::jsonb, NULL);
  v_ub_b := (pg_temp.s112_beispiel('konto_umbuchungen', v_b, v_bw) ->> 'id')::uuid;
  v_pr := (pg_temp.s112_beispiel('pressungen', v_b, v_bw) ->> 'id')::uuid;   -- KAN-148 C1c
  SELECT jahrgang_id INTO v_pr_jg FROM public.pressungen WHERE id = v_pr;
  -- KAN-148 C2: AMA-Meldungen in B – eine bereit, eine eingereicht, je an einem eigenen, sicher unbenutzten Jahrgang
  -- (die Beispielzeilen der Tabellenproben hängen sonst schon eine Meldung an einen vorhandenen Jahrgang)
  v_ama_jg2 := (pg_temp.s112_beispiel('weinjahrgaenge', v_b, v_bw, jsonb_build_object('jahrgang', (SELECT coalesce(min(j.jahrgang), 2000) - 1 FROM public.weinjahrgaenge j WHERE j.tenant_id = v_b))) ->> 'id')::uuid;
  v_ama_ber := (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, v_bw, jsonb_build_object('jahrgang_id', v_ama_jg2, 'status', 'bereit')) ->> 'id')::uuid;
  v_ama_jg  := (pg_temp.s112_beispiel('weinjahrgaenge', v_b, v_bw, jsonb_build_object('jahrgang', (SELECT coalesce(min(j.jahrgang), 2000) - 1 FROM public.weinjahrgaenge j WHERE j.tenant_id = v_b))) ->> 'id')::uuid;
  v_ama_ein := (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, v_bw,
                 jsonb_build_object('jahrgang_id', v_ama_jg, 'status', 'eingereicht', 'eingereicht_am', '2026-09-01')) ->> 'id')::uuid;
  v_beh_b := (pg_temp.s112_beispiel('behaelter', v_b, v_bw) ->> 'id')::uuid;   -- KAN-148 C1c-2
  v_k1 := (pg_temp.s112_zeile('kontakte', v_b, '{"nachname": "S112TEST Behalten"}') ->> 'id')::uuid;
  v_k2 := (pg_temp.s112_zeile('kontakte', v_b, '{"nachname": "S112TEST Weg"}') ->> 'id')::uuid;
  v_fi_b := (pg_temp.s112_zeile('firmen', v_b, '{"name": "S112TEST Firma"}') ->> 'id')::uuid;   -- KAN-150 F1c
  v_wg_b := (pg_temp.s112_beispiel('weingarten', v_b, v_bw) ->> 'id')::uuid;   -- KAN-150 F1d
  -- KAN-167: Einkauf braucht E&A (modul_ea, buchhaltungsart 'ea') und eine Ausgaben-Kategorie; Storno eine Lagerbuchung
  UPDATE public.tenant_einstellungen SET modul_ea = true, buchhaltungsart = 'ea' WHERE tenant_id = v_b;
  SELECT k.id INTO v_eakat FROM public.ea_kategorien k WHERE k.tenant_id IS NULL AND k.typ = 'ausgabe' AND k.aktiv ORDER BY k.id LIMIT 1;
  v_bm_b := (pg_temp.s112_beispiel('betriebsmittel', v_b, v_bw) ->> 'id')::uuid;
  v_bml_b := (pg_temp.s112_beispiel('betriebsmittel_lager_bewegungen', v_b, v_bw, jsonb_build_object('betriebsmittel_id', v_bm_b)) ->> 'id')::uuid;
  v_lpsm_b := (pg_temp.s112_beispiel('pflanzenschutzmittel', v_b, v_bw) ->> 'id')::uuid;   -- KAN-326
  v_lpl_b := (pg_temp.s112_beispiel('psm_lager_bewegungen', v_b, v_bw, jsonb_build_object('psm_id', v_lpsm_b)) ->> 'id')::uuid;
  INSERT INTO public.ea_monatsabschluss (tenant_id, jahr, monat) VALUES (v_b, 2020, 1);
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('ea-belege', v_b::text || '/s112test/beleg-b.pdf', v_bta),
    ('dokumente', v_b::text || '/s112test/dok-b.pdf', v_bta);
  -- Nach dem ganzen Aufbau hat keine Probezeile einer Tabelle mit Bezugs-Löschsperre einen Bezug bekommen
  -- (Stammdaten: s112_stammdaten_bezuege_intern; Jahrgang: a_jahrgang_loeschsperre über die RPC-Pressung)
  SELECT coalesce(array_agg(e.key ORDER BY e.key), '{}') INTO v_arr FROM jsonb_each(v_zeilen) e
   WHERE e.key = ANY (pg_temp.s112_soll_liste('stammdaten_loeschsperre'))
     AND public.s112_stammdaten_bezuege_intern(e.key, (e.value #>> '{z,id}')::uuid) <> '{}'::jsonb;
  v_erg := v_erg || pg_temp.s112_erwarte('proben_ohne_bezug_stammdaten', v_arr, '{}'::text[]);
  v_erg := v_erg || pg_temp.s112_erwarte('proben_ohne_bezug_jahrgang',
    (SELECT p.jahrgang_id FROM public.pressungen p WHERE p.id = v_pr) IS DISTINCT FROM (v_zeilen #>> '{weinjahrgaenge,z,id}')::uuid, true);

  -- ── Mutationen (nur im Mutationsmodus; nach dem Aufbau, vor den Prüfungen) ──────────────────────────
  PERFORM pg_temp.s112_mutiere('katalog_del_fehlt', $m$DROP POLICY abo_schreibsperre_del ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('status_paused_frei',
    $m$CREATE OR REPLACE FUNCTION public.s112_abo_gesperrt(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE
       SET search_path = public AS $x$
         SELECT COALESCE((SELECT p_tenant <> '33333333-3333-4333-8333-333333333333'::uuid
                                 AND NULLIF(t.stripe_status, '') IS NOT NULL
                                 AND (t.stripe_status = ANY (ARRAY['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired'])
                                      OR (t.stripe_status = 'trialing' AND t.stripe_trial_ends_at IS NOT NULL AND t.stripe_trial_ends_at < now()))
                            FROM tenants t WHERE t.id = p_tenant), false) $x$$m$);
  PERFORM pg_temp.s112_mutiere('ausnahme_system_admin_weg',
    $m$CREATE OR REPLACE FUNCTION public.s112_schreibgesperrte_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE
       SECURITY DEFINER SET search_path = public AS $x$
         SELECT m.tenant_id FROM tenant_memberships m
          WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
            AND NOT EXISTS (SELECT 1 FROM plattform_admins p WHERE p.user_id = m.user_id)
            AND public.s112_abo_gesperrt(m.tenant_id) $x$$m$);
  PERFORM pg_temp.s112_mutiere('rpc_sperre_aus',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_abo_schreibsperre(p_tenant_id uuid) RETURNS void LANGUAGE plpgsql
       STABLE SET search_path = public AS $x$ BEGIN NULL; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('schreibgesperrte_leer',
    $m$CREATE OR REPLACE FUNCTION public.s112_schreibgesperrte_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE
       SECURITY DEFINER SET search_path = public AS $x$ SELECT NULL::uuid WHERE false $x$$m$);

  -- ── 1. Katalog ───────────────────────────────────────────────────────────────────────────────────────
  -- Soll-Ausnahmen = G-Tabellen (ohne tenants, das nur _upd hat) + genau diese vier
  SELECT array_agg(x ORDER BY x) INTO v_arr
    FROM unnest(pg_temp.s112_soll_liste('abo_ausnahmen')) x
   WHERE x <> ALL (pg_temp.s112_soll_liste('g_tabellen'));
  v_erg := v_erg || pg_temp.s112_erwarte('abo_ausnahmen_soll', v_arr,
    ARRAY['benachrichtigungen', 'system_ereignisse', 'tenant_memberships', 'user_email_connections']);

  v_fehler_vorher := cardinality(v_erg);
  FOR r IN
    WITH tab AS (
      SELECT c.relname::text AS tabelle, pg_temp.s112_klasse(c.relname::text) AS klasse,
             (SELECT NOT a.attnotnull FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS tid_null
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity),
    pol AS (
      SELECT p.tablename::text AS tabelle, p.policyname::text AS name,
             p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[]
             AND p.cmd = CASE p.policyname WHEN 'abo_schreibsperre_ins' THEN 'INSERT' WHEN 'abo_schreibsperre_upd' THEN 'UPDATE' ELSE 'DELETE' END
             AND CASE p.policyname
                   WHEN 'abo_schreibsperre_ins' THEN p.qual IS NULL AND p.with_check LIKE '%s112_schreibgesperrte_tenants()%'
                   WHEN 'abo_schreibsperre_upd' THEN p.qual LIKE '%s112_schreibgesperrte_tenants()%' AND p.with_check LIKE '%s112_schreibgesperrte_tenants()%'
                   ELSE p.qual LIKE '%s112_schreibgesperrte_tenants()%' AND p.with_check IS NULL END AS form_ok,
             coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') AS ausdruck
        FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.policyname IN ('abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del'))
    SELECT t.tabelle, t.klasse, t.tid_null,
           CASE WHEN t.tabelle = 'tenants' THEN ARRAY['abo_schreibsperre_upd']
                WHEN t.tabelle = ANY (pg_temp.s112_soll_liste('abo_ausnahmen')) THEN '{}'::text[]
                ELSE ARRAY['abo_schreibsperre_del', 'abo_schreibsperre_ins', 'abo_schreibsperre_upd'] END AS soll,
           coalesce((SELECT array_agg(p.name ORDER BY p.name) FROM pol p WHERE p.tabelle = t.tabelle), '{}') AS ist,
           coalesce((SELECT array_agg(p.name ORDER BY p.name) FROM pol p WHERE p.tabelle = t.tabelle AND NOT p.form_ok), '{}') AS form_falsch,
           coalesce((SELECT array_agg(p.name ORDER BY p.name) FROM pol p
                      WHERE p.tabelle = t.tabelle AND t.tid_null AND p.ausdruck NOT LIKE '%tenant_id IS NULL%'), '{}') AS null_unsicher,
           EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public' AND q.tablename = t.tabelle
                      AND q.policyname = 'mitgliedschaft_aktiv') AS hat_aktiv
      FROM tab t ORDER BY t.tabelle
  LOOP
    IF r.ist IS DISTINCT FROM r.soll THEN
      v_erg := v_erg || pg_temp.s112_fehler('abo_katalog:' || r.tabelle,
        'ist=' || array_to_string(r.ist, ',') || ' soll=' || array_to_string(r.soll, ',')
        || CASE WHEN r.hat_aktiv THEN ' (mit mitgliedschaft_aktiv)' ELSE '' END);
    ELSIF cardinality(r.form_falsch) > 0 THEN
      v_erg := v_erg || pg_temp.s112_fehler('abo_katalog:' || r.tabelle, 'Form falsch (RESTRICTIVE/TO authenticated/Kommando/Ausdruck): ' || array_to_string(r.form_falsch, ','));
    ELSIF cardinality(r.null_unsicher) > 0 THEN
      v_erg := v_erg || pg_temp.s112_fehler('abo_katalog:' || r.tabelle, 'nullable tenant_id ohne „tenant_id IS NULL OR …“: ' || array_to_string(r.null_unsicher, ','));
    END IF;
  END LOOP;
  IF cardinality(v_erg) = v_fehler_vorher THEN
    v_erg := v_erg || pg_temp.s112_ok('abo_katalog');
  END IF;
  -- Mitgliedschaftstabellen ohne Abo-Sperre sind genau die drei bewussten Ausnahmen
  SELECT array_agg(DISTINCT p.tablename::text ORDER BY p.tablename::text) INTO v_arr
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.policyname = 'mitgliedschaft_aktiv'
     AND NOT EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public' AND q.tablename = p.tablename
                        AND q.policyname = 'abo_schreibsperre_ins');
  v_erg := v_erg || pg_temp.s112_erwarte('abo_katalog_aktiv_ohne_abo', v_arr,
    ARRAY['benachrichtigungen', 'tenant_memberships', 'user_email_connections']);
  -- Nullable tenant_id: dieselbe Liste wie im Soll und alle mit NULL-sicherer Abo-Policy (oben geprüft)
  SELECT count(*) INTO v_n FROM pg_temp.s112_mandantentabellen() m
   WHERE m.tid_nullable AND m.tabelle <> ALL (pg_temp.s112_soll_liste('abo_ausnahmen'));
  v_erg := v_erg || pg_temp.s112_erwarte('abo_katalog_nullable_abgedeckt', v_n, 5::bigint);
  -- storage.objects: alle drei, RESTRICTIVE, TO authenticated, erster Ordner NULL-sicher
  SELECT count(*) INTO v_n FROM pg_policies p
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
     AND p.policyname IN ('abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del')
     AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[]
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') LIKE '%s112_schreibgesperrte_tenants()%'
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') LIKE '%IS NULL%';
  v_erg := v_erg || pg_temp.s112_erwarte('abo_katalog_storage', v_n, 3::bigint);

  -- RPC-Katalog: genau die 12 Funktionen rufen s112_pruefe_abo_schreibsperre auf, und s112_soll_rpc stimmt
  SELECT array_agg(p.proname::text ORDER BY p.proname::text) INTO v_arr
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc LIKE '%s112_pruefe_abo_schreibsperre(p_tenant_id)%'
     AND p.proname <> 's112_pruefe_abo_schreibsperre';
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_katalog_aufrufer', v_arr, c_abo_rpcs);
  SELECT array_agg(split_part(s.funktion, '(', 1) ORDER BY split_part(s.funktion, '(', 1)) INTO v_arr   -- nach dem Namen wie rpc_katalog_aufrufer (KAN-326: Präfix-Namen)
    FROM pg_temp.s112_soll_rpc() s WHERE s.abo;
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_katalog_soll', v_arr, c_abo_rpcs);
  -- Die Abo-Prüfung steht direkt hinter der Zugriffsprüfung (sonst verrät die RPC Fremden den Abo-Stand)
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (c_abo_rpcs)
     AND p.prosrc !~ '(pruefe_tenant_zugriff\s*\([^;]*\);|IF NOT v_darf THEN RAISE EXCEPTION ''Keine Berechtigung''; END IF;)\s*PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);';
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_katalog_nach_zugriffspruefung', v_n, 0::bigint);
  -- Interne Helfer sind für Benutzer nicht ausführbar (sonst ließe sich der Abo-Stand fremder Betriebe abfragen)
  v_erg := v_erg || pg_temp.s112_erwarte('rechte_abo_gesperrt_intern',
    has_function_privilege('authenticated', 'public.s112_abo_gesperrt(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.s112_abo_gesperrt(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.s112_pruefe_abo_schreibsperre(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.s112_pruefe_abo_schreibsperre(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.s112_schreibgesperrte_tenants()', 'EXECUTE'), false);

  -- ── 2. Statusregel (als postgres) ────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('status_liste_soll', pg_temp.s112_soll_liste('abo_status_gesperrt'), c_gesperrt);
  v_def := pg_get_functiondef('public.s112_abo_gesperrt(uuid)'::regprocedure);
  SELECT array_agg(m[1] ORDER BY o) INTO v_arr
    FROM regexp_matches((regexp_match(v_def, 'stripe_status\s*=\s*ANY\s*\(ARRAY\[([^\]]*)\]'))[1], '''([^'']*)''', 'g')
         WITH ORDINALITY AS x (m, o);
  v_erg := v_erg || pg_temp.s112_erwarte('status_liste_funktion', v_arr, c_gesperrt);

  FOREACH v_txt IN ARRAY c_gesperrt LOOP
    UPDATE public.tenants SET stripe_status = v_txt, stripe_trial_ends_at = NULL WHERE id = v_b;
    v_erg := v_erg || pg_temp.s112_erwarte('status_' || v_txt, public.s112_abo_gesperrt(v_b), true);
  END LOOP;
  UPDATE public.tenants SET stripe_status = 'trialing', stripe_trial_ends_at = now() - interval '1 day' WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('status_trialing_abgelaufen', public.s112_abo_gesperrt(v_b), true);
  UPDATE public.tenants SET stripe_status = 'trialing', stripe_trial_ends_at = now() + interval '1 day' WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('status_trialing_laeuft', public.s112_abo_gesperrt(v_b), false);
  UPDATE public.tenants SET stripe_status = 'trialing', stripe_trial_ends_at = NULL WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('status_trialing_ohne_ende', public.s112_abo_gesperrt(v_b), false);
  UPDATE public.tenants SET stripe_status = 'active', stripe_trial_ends_at = now() - interval '1 day' WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('status_active', public.s112_abo_gesperrt(v_b), false);
  UPDATE public.tenants SET stripe_status = 'past_due', stripe_trial_ends_at = NULL WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('status_past_due', public.s112_abo_gesperrt(v_b), false);
  -- '' kommt in der DB nicht vor: tenants_stripe_status_check lehnt es ab (s112_abo_gesperrt fängt es per NULLIF ab)
  v_erg := v_erg || pg_temp.s112_erwarte('status_leer_verboten',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET stripe_status = %L WHERE id = %L', '', v_b)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('status_leer_nullif_im_rumpf',
    pg_get_functiondef('public.s112_abo_gesperrt(uuid)'::regprocedure) ~* 'NULLIF\s*\(\s*t\.stripe_status\s*,\s*''''\s*\)', true);
  UPDATE public.tenants SET stripe_status = NULL WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('status_null', public.s112_abo_gesperrt(v_b), false);
  v_erg := v_erg || pg_temp.s112_erwarte('status_unbekannter_betrieb', public.s112_abo_gesperrt(gen_random_uuid()), false);

  -- Feste Ausnahmen im Rumpf: genau zwei UUIDs – Musterhof und die Sandbox (per md5 belegt)
  SELECT array_agg(DISTINCT lower(m[1])) INTO v_arr
    FROM regexp_matches(v_def, '''([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})''', 'g') AS m;
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_feste_ids_anzahl', coalesce(cardinality(v_arr), 0), 2);
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_musterhof_im_rumpf', c_m::text = ANY (coalesce(v_arr, '{}')), true);
  SELECT x::uuid INTO v_sandbox FROM unnest(coalesce(v_arr, '{}')) x WHERE x <> c_m::text LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_sandbox_im_rumpf', md5(coalesce(v_sandbox::text, '')), c_sandbox_md5);

  -- ── 3. Positivkontrolle: B mit freiem Abo ────────────────────────────────────────────────────────────
  FOREACH v_p IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
    v_frei := v_frei || jsonb_build_object(v_p, pg_temp.t14_proben(v_zeilen, (v_a ->> v_p)::uuid));
  END LOOP;
  -- tenants: bio_status ist das einzige für Benutzer schreibbare Feld
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_update_frei',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = bio_status WHERE id = %L', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('sperrmenge_frei_leer',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.s112_schreibgesperrte_tenants()'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('kontakte_insert_frei_b_ta',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST frei')), 'k1');
  -- Storage mit freiem Abo
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_frei_ea_belege',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, auth.uid())',
      'ea-belege', v_b::text || '/s112test/neu.pdf')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_frei_dokumente',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, auth.uid())',
      'dokumente', v_b::text || '/s112test/neu.pdf')), 'k1');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('storage_delete_frei_ea_belege',
    pg_temp.s112_versuch(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ea-belege', v_b::text || '/s112test/beleg-b.pdf')), 'k1');
  -- KAN-40: die Beispielzeile des Bewegungsjournals in B entfernen (Wartung mit Kennzeichen) – sonst gilt das Journal
  -- als eröffnet und journal_eroeffnen lehnt mit 55000 ab
  PERFORM pg_temp.s112_als_postgres();
  SELECT jsonb_agg(to_jsonb(k)) INTO v_journal FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b;
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  DELETE FROM public.kellerbuch_buchungen WHERE tenant_id = v_b;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  PERFORM pg_temp.s112_als(v_bta);
  -- RPCs mit freiem Abo (Wirkung sofort zurückgerollt)
  v_rpc := jsonb_build_object(
    'fuellung_bestand_buchen', format('SELECT public.fuellung_bestand_buchen(%L, %L, %L, pg_temp.s112_heute(), 1, NULL, %L)', v_b, v_fuellung, 'korrektur', 'S112TEST'),
    'get_next_accountnummer', format('SELECT public.get_next_accountnummer(%L)', v_b),
    'get_next_chargennummer', format('SELECT public.get_next_chargennummer(%L)', v_b),
    'get_next_liefernummer', format('SELECT public.get_next_liefernummer(%L)', v_b),
    'get_next_personenkonto', format('SELECT public.get_next_personenkonto(%L, %L, 10000)', v_b, 'debitor'),
    'get_next_transaktionsnr', format('SELECT public.get_next_transaktionsnr(%L, %L)', v_b, 'umzug'),
    's112_kontakt_historie_zu_firma', format('SELECT public.s112_kontakt_historie_zu_firma(%L, %L, %L)', v_b, v_k1, v_fi_b),   -- KAN-150 F1c
    's112_herkunft_setzen', format('SELECT public.s112_herkunft_setzen(%L, %L, ARRAY[%L]::uuid[], %L)', v_b, v_wa, v_wg_b, 'S112TEST Herkunft geändert'),   -- KAN-150 F1d
    'kontakte_zusammenfuehren', format('SELECT public.kontakte_zusammenfuehren(%L, %L, ARRAY[%L]::uuid[])', v_b, v_k1, v_k2),
    'journal_eroeffnen', format('SELECT public.journal_eroeffnen(%L, pg_temp.s112_heute())', v_b),   -- KAN-40
    'kellerbuch_abschliessen', format('SELECT public.kellerbuch_abschliessen(%L, pg_temp.s112_heute() - 1)', v_b),   -- KAN-192
    's112_verschnitt_buchen', format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', v_heute, 'neue_ziel_charge', jsonb_build_object('name', 'S112TEST Verschnitt', 'behaelter_id', v_beh_b)),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 1))),   -- KAN-112: 1 L in eine neue Charge im B-Gebinde
    's112_verschnitte_buchen', format('SELECT public.s112_verschnitte_buchen(%L, %L::jsonb)', v_b, jsonb_build_array(jsonb_build_object(
      'kopf', jsonb_build_object('datum', v_heute, 'neue_ziel_charge', jsonb_build_object('name', 'S112TEST Verschnitt 2', 'behaelter_id', v_beh_b)),
      'quellen', jsonb_build_array(jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 1))))),   -- KAN-112: dasselbe als Sammelaufruf (v_wa hat 100 L)
    's112_zukauf_buchen', format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb)', v_b,
      jsonb_build_object('datum', v_heute, 'art', 'trauben', 'menge', 1, 'einheit', 'kg')),   -- KAN-193: Trauben-Zukauf ohne Charge
    'journal_abgleichen', format('SELECT public.journal_abgleichen(%L, interval %L)', v_b, '0'),   -- KAN-40
    's112_betriebsmittel_einkauf', format('SELECT public.s112_betriebsmittel_einkauf(%L, %L, pg_temp.s112_heute(), 2, %L, 10, 20, NULL, %L, NULL)', v_b, v_bm_b, 'stk', v_eakat),   -- KAN-167
    's112_betriebsmittel_stornieren', format('SELECT public.s112_betriebsmittel_stornieren(%L, %L, %L)', v_b, v_bml_b, 'S112TEST Storno Lagerbuchung'),   -- KAN-167
    's112_ea_stornieren', format('SELECT public.s112_ea_stornieren(%L, %L, %L)', v_b, v_ea_b, 'S112TEST Storno E/A'),
    's112_zahlung_stornieren', format('SELECT public.s112_zahlung_stornieren(%L, %L, %L)', v_b, v_za_b, 'S112TEST Storno Zahlung'),
    's112_umbuchung_stornieren', format('SELECT public.s112_umbuchung_stornieren(%L, %L, %L)', v_b, v_ub_b, 'S112TEST Storno Umbuchung'),
    's112_fuellung_verkauf_buchen', format('SELECT public.s112_fuellung_verkauf_buchen(%L, %L, gen_random_uuid(), 1, pg_temp.s112_heute(), %L)', v_b, v_fz_b, 'S112TEST Rückbuchung'),
    's112_ama_korrektur_anlegen', format('SELECT public.s112_ama_korrektur_anlegen(%L, %L)', v_b, v_ama_ein),
    's112_ama_meldung_speichern', format('SELECT public.s112_ama_meldung_speichern(%L, %L, %L::jsonb, %L::jsonb)', v_b, v_ama_jg2, '{}', '[]'),
    -- KAN-37 B: „eingereicht“ nur über s112_ama_einreichen; status_setzen hier mit der AMA-Rückmeldung
    's112_ama_status_setzen', format('SELECT public.s112_ama_status_setzen(%L, %L, %L, pg_temp.s112_heute(), NULL)', v_b, v_ama_ein, 'bestaetigt'),
    's112_ama_einreichen', format('SELECT public.s112_ama_einreichen(%L, %L, pg_temp.s112_heute(), NULL, %L::jsonb)', v_b, v_ama_ber,
      jsonb_build_object('meldung', 'erntemeldung', 'parameter', jsonb_build_object('jahrgang', (SELECT j.jahrgang FROM public.weinjahrgaenge j WHERE j.id = v_ama_jg2)),
        'zeilen', '[]'::jsonb, 'spalten', '[{"kopf": "S112TEST", "typ": "text"}]'::jsonb, 'profil', 'EXCEL_AT', 'dateiname', 'S112TEST.csv', 'csv', 'S112TEST')),
    's112_pressung_stornieren', format('SELECT public.s112_pressung_stornieren(%L, %L, %L)', v_b, v_pr, 'S112TEST Pressung storniert'),
    's112_pressung_zeilen_stornieren', format('SELECT public.s112_pressung_zeilen_stornieren(%L, %L, %L::uuid[], %L::uuid[], %L)', v_b, v_pr, '{}', '{}', 'S112TEST Bearbeiten'),
    's112_mostzeile_anlegen', format('SELECT public.s112_mostzeile_anlegen(%L, %L, %L, 1, NULL, %L::jsonb)', v_b, v_pr, v_beh_b, '{"name": "S112TEST"}'),
    's112_pressung_anlegen', format('SELECT public.s112_pressung_anlegen(%L, %L::jsonb, %L::jsonb)', v_b, jsonb_build_object('jahrgang_id', v_pr_jg, 'datum', '2026-09-20'), '[]'),
    's112_storniert_loeschen', format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_b, 'keller_behandlungen', v_kb, 'S112TEST endgültig löschen'),
    'schwund_buchen', format('SELECT public.schwund_buchen(%L, %L, 1, pg_temp.s112_heute(), %L, false, true)', v_b, v_wa, 'S112TEST'),
    'setze_kontobewegung_abgeglichen', format('SELECT public.setze_kontobewegung_abgeglichen(%L, %L, %L, true)', v_b, 'ea_transaktion', v_eatx),
    's112_fuellung_nachtragen', format('SELECT public.s112_fuellung_nachtragen(%L, %L, %L, NULL)', v_b, v_fz_b, v_wa),   -- KAN-101 (Charge nachtragen)
    's112_charge_status_setzen', format('SELECT public.s112_charge_status_setzen(%L, %L, %L, pg_temp.s112_heute())', v_b, v_wa, 'abfuellung'),   -- KAN-41
    's112_fuellung_etikettieren', format('SELECT public.s112_fuellung_etikettieren(%L, %L, pg_temp.s112_heute(), 1, NULL)', v_b, v_fe),   -- KAN-41 Paket 3d
    's112_etikettierung_stornieren', format('SELECT public.s112_etikettierung_stornieren(%L, %L, %L)', v_b, v_et, 'S112TEST Storno Etikett'),   -- KAN-41 Paket 3d
    's112_zugangskorrektur_buchen', format('SELECT public.s112_zugangskorrektur_buchen(%L, %L, pg_temp.s112_heute(), 1, %L, %L)', v_b, v_wa, 'inventur', 'S112TEST Inventur-Plus'),   -- KAN-53
    's112_zugangskorrektur_stornieren', format('SELECT public.s112_zugangskorrektur_stornieren(%L, %L, %L)', v_b, v_zk, 'S112TEST Storno Korrektur'),   -- KAN-53
    's112_verarbeitung_buchen', format('SELECT public.s112_verarbeitung_buchen(%L, %L, pg_temp.s112_heute(), 1, %L, NULL)', v_b, v_wa, 'essig'),   -- KAN-41 Paket 3a
    's112_verarbeitung_stornieren', format('SELECT public.s112_verarbeitung_stornieren(%L, %L, %L)', v_b, v_kv, 'S112TEST Storno Verarbeitung'),   -- KAN-41 Paket 3a
    's112_psm_uebermittlung_protokollieren', format('SELECT public.s112_psm_uebermittlung_protokollieren(%L, %L, %L::jsonb)', v_b, 'csv-datei', jsonb_build_array(jsonb_build_object('behandlung_id', v_psm_beh, 'hash', repeat('0', 64), 'zeilen', 1))),   -- KAN-120
    's112_charge_abstufen', format('SELECT public.s112_charge_abstufen(%L, %L, pg_temp.s112_heute(), %L::jsonb, %L)', v_b, v_wa, '{"qualitaetsstufe": "wein"}', 'S112TEST Abstufung Grund'),   -- KAN-82
    's112_pruefnummernantrag_status_setzen', format('SELECT public.s112_pruefnummernantrag_status_setzen(%L, %L, %L, pg_temp.s112_heute(), NULL, NULL)', v_b, v_dac, 'eingereicht'),   -- KAN-97
    's112_freeze_korrektur', format('SELECT public.s112_freeze_korrektur(%L, %L, %L, %L::jsonb, %L)', v_b, 's112test_freeze', v_frz, '{"betrag": 2}', 'S112TEST Korrektur'),
    'sperre_ea_monat', format('SELECT public.sperre_ea_monat(%L, 2020::smallint, 2::smallint)', v_b),
    'sperre_ea_uva', format('SELECT public.sperre_ea_uva(%L, 2020::smallint, %L)', v_b, '01'),
    'check_und_increment_ki_abfrage', format('SELECT public.check_und_increment_ki_abfrage(%L)', v_b),
    'increment_ki_tokens', format('SELECT public.increment_ki_tokens(%L, 1, 1)', v_b),
    'lesend:berechne_ea_uva', format('SELECT * FROM public.berechne_ea_uva(%L, 2020::smallint, %L)', v_b, 'Q1'),
    'lesend:pruefe_ea_zeitraum_offen', format('SELECT * FROM public.pruefe_ea_zeitraum_offen(%L, pg_temp.s112_heute())', v_b));
  -- KAN-421: eigene Anweisung – jsonb_build_object nimmt höchstens 100 Argumente (54023)
  v_rpc := v_rpc || jsonb_build_object(
    's112_ea_kosten_zuordnen', format('SELECT public.s112_ea_kosten_zuordnen(%L, %L, %L::jsonb)', v_b, v_ea_k,
      jsonb_build_array(jsonb_build_object('kostenstelle_id', v_ks_b, 'betrag', 10))),
    's112_kontakt_personendaten_loeschen', format('SELECT public.s112_kontakt_personendaten_loeschen(%L, %L, %L)', v_b, v_kt_d, 'S112TEST Löschersuchen'));   -- KAN-425
  -- KAN-115: eigener Block (jsonb_build_object nimmt höchstens 100 Argumente)
  -- KAN-326: eigener Block – jsonb_build_object nimmt höchstens 100 Argumente (50 Paare, 54023)
  v_rpc := v_rpc || jsonb_build_object(
    's112_lager_einkauf', format('SELECT public.s112_lager_einkauf(%L, %L, %L, pg_temp.s112_heute(), 2, %L, 10, 20, NULL, %L, NULL)', v_b, 'psm', v_lpsm_b, 'kg', v_eakat),   -- KAN-326
    's112_lager_einkauf_stornieren', format('SELECT public.s112_lager_einkauf_stornieren(%L, %L, %L, %L)', v_b, 'psm', v_lpl_b, 'S112TEST Storno PSM-Lager'),   -- KAN-326
    's112_fuellung_aendern', format('SELECT public.s112_fuellung_aendern(%L, %L, %L::jsonb, %L)', v_b, v_fz_b, '{"notizen": "S112TEST"}', 'S112TEST Grund der Änderung')   -- KAN-378
  );
  v_rpc := v_rpc || jsonb_build_object(
    's112_artikel_buchen', format('SELECT public.s112_artikel_buchen(%L, %L, pg_temp.s112_heute(), %L, 1, NULL)', v_b, v_sa, 'zugang'),   -- KAN-115
    's112_artikel_bewegung_stornieren', format('SELECT public.s112_artikel_bewegung_stornieren(%L, %L, %L)', v_b, v_sab, 'S112TEST Storno Lager'),   -- KAN-115
    's112_artikel_verkauf_buchen', format('SELECT public.s112_artikel_verkauf_buchen(%L, %L)', v_b, v_svp),   -- KAN-115
    's112_artikel_verkauf_stornieren', format('SELECT public.s112_artikel_verkauf_stornieren(%L, %L, %L)', v_b, v_svp, 'S112TEST Storno Verkauf'),
    's112_sekt_stufe_setzen', format('SELECT public.s112_sekt_stufe_setzen(%L, %L, %L, NULL, false)', v_b, v_sekt, 'klassik'),   -- KAN-190
    's112_elabel_umleiten', format('SELECT public.s112_elabel_umleiten(%L, %L, %L, %L)', v_b, v_el1, v_el2, 'S112TEST Nachfolgefüllung'),   -- KAN-219
    's112_produktion_buchen', format('SELECT public.s112_produktion_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('art', 'perlwein', 'name', 'S112TEST Perlwein 2', 'behaelter_id', v_pb2),
      jsonb_build_array(jsonb_build_object('art', 'wein', 'weinausbau_id', v_pw, 'menge', 50))),   -- KAN-118
    's112_produktion_stornieren', format('SELECT public.s112_produktion_stornieren(%L, %L, %L)', v_b, v_prod, 'S112TEST Abo-Probe'),   -- KAN-118
    's112_lohnversektung_versenden', format('SELECT public.s112_lohnversektung_versenden(%L, %L, pg_temp.s112_heute(), %L, NULL)', v_b, v_lvw, v_lvf),   -- KAN-232
    's112_lohnversektung_stornieren', format('SELECT public.s112_lohnversektung_stornieren(%L, %L, %L)', v_b, v_lv0, 'S112TEST Abo-Probe'),   -- KAN-232
    's112_rechnung_erstellen', format('SELECT public.s112_rechnung_erstellen(%L, %L::uuid[], pg_temp.s112_heute(), %L::jsonb, NULL)', v_b, ARRAY[v_rls], '[]'),   -- KAN-103
    's112_rechnung_stornieren', format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_rre, 'S112TEST Abo-Probe'),   -- KAN-103
    's112_verkauf_samt_rechnung_stornieren', format('SELECT public.s112_verkauf_samt_rechnung_stornieren(%L, %L, %L)', v_b, v_rsv, 'S112TEST Abo-Probe'));   -- KAN-356
  PERFORM pg_temp.s112_als(v_bta);
  FOR r IN SELECT e.key AS name, e.value #>> '{}' AS sql FROM jsonb_each(v_rpc) e ORDER BY e.key LOOP
    v_rpc_frei := v_rpc_frei || jsonb_build_object(r.name, pg_temp.t14_rpc(r.sql));
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  -- KAN-40: Beispielzeilen des Journals wiederherstellen (Lese-Vergleich frei/gesperrt)
  INSERT INTO public.kellerbuch_buchungen SELECT * FROM jsonb_populate_recordset(NULL::public.kellerbuch_buchungen, coalesce(v_journal, '[]'::jsonb));

  -- ── 4. B gesperrt: Abo gekündigt ─────────────────────────────────────────────────────────────────────
  UPDATE public.tenants SET stripe_status = 'canceled', stripe_trial_ends_at = NULL WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('b_gesperrt', public.s112_abo_gesperrt(v_b), true);
  FOREACH v_p IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
    v_gesp := v_gesp || jsonb_build_object(v_p, pg_temp.t14_proben(v_zeilen, (v_a ->> v_p)::uuid));
  END LOOP;

  -- Auswertung je Persona und Tabelle
  FOREACH v_p IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
    v_n := 0;       -- Verstöße
    FOR r IN SELECT e.key AS tab FROM jsonb_each(v_zeilen) e ORDER BY e.key LOOP
      v_f := v_frei -> v_p -> r.tab;
      v_g := v_gesp -> v_p -> r.tab;
      -- Lesen bleibt: gleiches Ergebnis wie mit freiem Abo
      IF v_g ->> 's' IS DISTINCT FROM v_f ->> 's' THEN
        v_erg := v_erg || pg_temp.s112_fehler('lesen_bleibt_' || v_p || ':' || r.tab, 'gesperrt=' || (v_g ->> 's') || ' frei=' || (v_f ->> 's'));
        v_n := v_n + 1;
      END IF;
      -- INSERT: nie Erfolg; wo es frei ging, lehnt RLS (oder ein Trigger) ab. E23xxx frei heißt: RLS hat die
      -- Zeile zugelassen, erst ein Constraint (meist der Unique-Index des Klons) lehnte ab – zählt wie k1, sonst
      -- bliebe eine wirkungslose Abo-Policy unbemerkt (gesperrt käme dann ebenfalls E23505).
      IF v_g ->> 'i' LIKE 'k%' OR ((v_f ->> 'i' = 'k1' OR v_f ->> 'i' LIKE 'E23%') AND v_g ->> 'i' NOT IN ('R', 'T')) THEN
        v_erg := v_erg || pg_temp.s112_fehler('gesperrt_ins_' || v_p || ':' || r.tab, 'gesperrt=' || (v_g ->> 'i') || ' frei=' || (v_f ->> 'i'));
        v_n := v_n + 1;
      END IF;
      -- UPDATE: nie eine Zeile; wo es frei ging → k0 (USING filtert) bzw. R
      IF (v_g ->> 'u' LIKE 'k%' AND v_g ->> 'u' <> 'k0') OR (v_f ->> 'u' = 'k1' AND v_g ->> 'u' NOT IN ('k0', 'R')) THEN
        v_erg := v_erg || pg_temp.s112_fehler('gesperrt_upd_' || v_p || ':' || r.tab, 'gesperrt=' || (v_g ->> 'u') || ' frei=' || (v_f ->> 'u'));
        v_n := v_n + 1;
      END IF;
      -- DELETE: nie eine Zeile; wo es frei ging → k0
      IF (v_g ->> 'd' LIKE 'k%' AND v_g ->> 'd' <> 'k0') OR (v_f ->> 'd' = 'k1' AND v_g ->> 'd' <> 'k0') THEN
        v_erg := v_erg || pg_temp.s112_fehler('gesperrt_del_' || v_p || ':' || r.tab, 'gesperrt=' || (v_g ->> 'd') || ' frei=' || (v_f ->> 'd'));
        v_n := v_n + 1;
      END IF;
      -- Positivkontrolle UPDATE: wo die Rollenmatrix die Persona zulässt, muss es mit freiem Abo gehen
      -- (Tabellen mit Eigentümer-Policy: die Beispielzeile gehört b_w, für b_ta also nicht änderbar)
      SELECT s.rollen INTO v_soll_rollen FROM pg_temp.s112_soll() s WHERE s.tabelle = r.tab AND s.aktion = 'UPDATE';
      IF (CASE v_p WHEN 'b_ta' THEN 'TA' = ANY (v_soll_rollen) AND r.tab <> ALL (c_eigentuemer) ELSE v_soll_rollen && ARRAY['W', 'W*'] END)
         AND v_f ->> 'u' IS DISTINCT FROM 'k1' THEN
        v_erg := v_erg || pg_temp.s112_fehler('positiv_upd_' || v_p || ':' || r.tab, 'frei=' || coalesce(v_f ->> 'u', 'NULL') || ' (Rollenmatrix erlaubt UPDATE)');
        v_n := v_n + 1;
      END IF;
    END LOOP;
    IF v_n = 0 THEN
      v_erg := v_erg || pg_temp.s112_ok('gesperrt_tabellen_' || v_p);
    END IF;
    -- Abdeckung: so viele Tabellen belegen die Sperre gegen eine gelungene Positivkontrolle
    SELECT jsonb_build_object(
             'lesen', count(*) FILTER (WHERE e.value ->> 's' = '1'),
             'ins', count(*) FILTER (WHERE e.value ->> 'i' = 'k1' OR e.value ->> 'i' LIKE 'E23%'),
             'upd', count(*) FILTER (WHERE e.value ->> 'u' = 'k1'),
             'del', count(*) FILTER (WHERE e.value ->> 'd' = 'k1'))
      INTO v_f FROM jsonb_each(v_frei -> v_p) e;
    v_abdeckung := v_abdeckung || jsonb_build_object(v_p, v_f);
  END LOOP;
  -- Mindestabdeckung (fällt sie, prüft die Sperre ins Leere): ist ≥ Mindestwert, sonst FEHLER mit dem Ist-Wert
  FOREACH v_p IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
    FOR v_n IN 1 .. 4 LOOP
      v_txt := (ARRAY['lesen', 'ins', 'upd', 'del'])[v_n];
      v_n2 := (CASE v_p WHEN 'b_ta' THEN c_min_b_ta ELSE c_min_b_w END)[v_n];
      v_erg := v_erg || pg_temp.s112_erwarte('abdeckung_' || v_p || '_' || v_txt,
        least((v_abdeckung -> v_p ->> v_txt)::bigint, v_n2), v_n2);
    END LOOP;
  END LOOP;
  -- Keine UPDATE-Probe darf an der Probe selbst scheitern (428C9 IDENTITY ALWAYS, 42703 Spalte fehlt): sonst wäre
  -- die Abo-Sperre für UPDATE dort ungeprüft
  SELECT coalesce(array_agg(x.p || ':' || e.key || '=' || (e.value ->> 'u') ORDER BY x.p, e.key), '{}') INTO v_arr
    FROM (VALUES ('b_ta'), ('b_w')) x (p), jsonb_each(v_frei -> x.p) e
   WHERE e.value ->> 'u' IN ('E428C9', 'E42703', 'E42601');
  v_erg := v_erg || pg_temp.s112_erwarte('upd_probe_brauchbar', v_arr, '{}'::text[]);
  -- bestandsprotokoll: kein UPDATE-Recht für Benutzer – die Probe belegt das (G), frei wie gesperrt
  v_erg := v_erg || pg_temp.s112_erwarte('bestandsprotokoll_upd_frei_b_ta', v_frei -> 'b_ta' -> 'bestandsprotokoll' ->> 'u', 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('bestandsprotokoll_upd_gesperrt_b_w', v_gesp -> 'b_w' -> 'bestandsprotokoll' ->> 'u', 'G');

  -- tenants: Lesen bleibt, bio_status nicht mehr änderbar
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_lesen_gesperrt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_update_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = bio_status WHERE id = %L', v_b)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('sperrmenge_b_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.s112_schreibgesperrte_tenants() g WHERE g = %L', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontakte_insert_gesperrt_b_ta',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST gesperrt')), 'R');
  -- interne Helfer bleiben für Benutzer gesperrt
  v_erg := v_erg || pg_temp.s112_erwarte('abo_gesperrt_nicht_fuer_benutzer',
    pg_temp.s112_versuch(format('SELECT public.s112_abo_gesperrt(%L)', v_b)), 'G');

  -- ── 5. Ausnahmen ─────────────────────────────────────────────────────────────────────────────────────
  -- system_admin in B ohne Plattform-Admin: schreibt trotz Sperre
  PERFORM pg_temp.s112_als(v_bsa);
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_b_sa_sperrmenge',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.s112_schreibgesperrte_tenants()'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_b_sa_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST sa')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_b_sa_rpc',
    pg_temp.t14_rpc(format('SELECT public.get_next_chargennummer(%L)', v_b)), 'ok');
  -- Test-Plattform-Admin (system_admin in B über trg_tenant_plattform_admins)
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_pa_sperrmenge',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.s112_schreibgesperrte_tenants()'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_pa_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST pa')), 'k1');
  -- Plattform-Admin mit einer tenant_admin-Mitgliedschaft (nicht system_admin) ist ebenfalls ausgenommen
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_memberships SET role = 'tenant_admin' WHERE user_id = v_pa AND tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_pa_als_tenant_admin_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST pa ta')), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_memberships SET role = 'system_admin' WHERE user_id = v_pa AND tenant_id = v_b;
  -- Leser bleibt ohnehin verweigert, liest aber weiter
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_b_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST leser')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_b_liest',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE id = %L', v_k1)), '1');
  -- Sperre gilt je Betrieb: tenant_admin in M und B schreibt in M weiter, in B nicht
  PERFORM pg_temp.s112_als(v_mbta);
  v_erg := v_erg || pg_temp.s112_erwarte('je_betrieb_mb_ta_in_b',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST mb')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('je_betrieb_mb_ta_in_m',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', c_m, 'S112TEST mb')), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  -- Musterhof auf 'canceled': feste Ausnahme
  UPDATE public.tenants SET stripe_status = 'canceled' WHERE id = c_m;
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_musterhof_regel', public.s112_abo_gesperrt(c_m), false);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_musterhof_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', c_m, 'S112TEST m')), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenants SET stripe_status = NULL WHERE id = c_m;

  -- Sandbox-ID (aus dem Funktionsrumpf gelesen): Betrieb mit dieser ID, Abo 'incomplete' wie auf der Produktion
  IF v_sandbox IS NOT NULL AND md5(v_sandbox::text) = c_sandbox_md5 THEN
    INSERT INTO public.tenants (id, name, slug, stripe_status)
    VALUES (v_sandbox, 'S112TEST Sandbox-ID', 's112test-' || v_sandbox, 'incomplete');
    INSERT INTO public.tenant_einstellungen (tenant_id) VALUES (v_sandbox);
    v_sb_ta := pg_temp.s112_benutzer('tenant_admin', v_sandbox);
    v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_sandbox_regel', public.s112_abo_gesperrt(v_sandbox), false);
    PERFORM pg_temp.s112_als(v_sb_ta);
    v_erg := v_erg || pg_temp.s112_erwarte('ausnahme_sandbox_insert',
      pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_sandbox, 'S112TEST sb')), 'k1');
    PERFORM pg_temp.s112_als_postgres();
  ELSE
    v_erg := v_erg || pg_temp.s112_fehler('ausnahme_sandbox_regel', 'Sandbox-ID nicht im Rumpf von s112_abo_gesperrt');
  END IF;

  -- ── 6. RPCs im gesperrten Betrieb (als b_ta) ─────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  FOR r IN SELECT e.key AS name, e.value #>> '{}' AS sql FROM jsonb_each(v_rpc) e ORDER BY e.key LOOP
    v_rpc_gesp := v_rpc_gesp || jsonb_build_object(r.name, pg_temp.t14_rpc(r.sql));
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  -- KAN-21: get_next_rechnungsnummer ist für Benutzer nicht mehr ausführbar (nur Service-Role, Datei 47: rpc_gesperrt)
  FOREACH v_txt IN ARRAY array_remove(c_abo_rpcs, 'get_next_rechnungsnummer') LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('rpc_gesperrt_' || v_txt, v_rpc_gesp ->> v_txt, '42501/abo_gesperrt');
    -- Kontrolle mit freiem Abo: Zugriff geht durch (kein 42501), keine Abo-Meldung
    v_erg := v_erg || pg_temp.s112_erwarte('rpc_frei_' || v_txt, v_rpc_frei ->> v_txt, 'ok');
  END LOOP;
  -- KAN-22: die KI-Zähler sind für Benutzer nicht mehr ausführbar (auch mit freiem Abo) – nur /api/ki-abfrage und der
  -- Morgenbericht rufen sie per Service-Role nach ihren eigenen Prüfungen auf
  FOREACH v_txt IN ARRAY ARRAY['check_und_increment_ki_abfrage', 'increment_ki_tokens'] LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('rpc_benutzer_frei_' || v_txt, v_rpc_frei ->> v_txt, '42501');
    v_erg := v_erg || pg_temp.s112_erwarte('rpc_benutzer_gesperrt_' || v_txt, v_rpc_gesp ->> v_txt, '42501');
  END LOOP;
  FOREACH v_txt IN ARRAY ARRAY['berechne_ea_uva', 'pruefe_ea_zeitraum_offen'] LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('rpc_lesend_gesperrt_' || v_txt, v_rpc_gesp ->> ('lesend:' || v_txt), 'ok');
    v_erg := v_erg || pg_temp.s112_erwarte('rpc_lesend_frei_' || v_txt, v_rpc_frei ->> ('lesend:' || v_txt), 'ok');
  END LOOP;

  -- ── 7. Storage im gesperrten Betrieb (als b_ta) ──────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM storage.objects WHERE name LIKE v_b::text || '/s112test/%';
  v_erg := v_erg || pg_temp.s112_erwarte('storage_objekte_existieren', v_n, 2::bigint);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_gesperrt_ea_belege',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, auth.uid())',
      'ea-belege', v_b::text || '/s112test/neu.pdf')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_gesperrt_dokumente',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, auth.uid())',
      'dokumente', v_b::text || '/s112test/neu.pdf')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_lesen_gesperrt_ea_belege',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ea-belege', v_b::text || '/s112test/beleg-b.pdf')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_lesen_gesperrt_dokumente',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'dokumente', v_b::text || '/s112test/dok-b.pdf')), '1');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('storage_delete_gesperrt_ea_belege',
    pg_temp.s112_versuch(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ea-belege', v_b::text || '/s112test/beleg-b.pdf')), 'k0');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM storage.objects WHERE name LIKE v_b::text || '/s112test/%';
  v_erg := v_erg || pg_temp.s112_erwarte('storage_objekte_unveraendert', v_n, 2::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 60);
END
$test$;
