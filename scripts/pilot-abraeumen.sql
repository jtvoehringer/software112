-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- pilot-abraeumen.sql – Pilotabschluss Gebeshuber: Bewegungsdaten abräumen, Stammdaten behalten (KAN-185)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ZWECK
--   Für „Weingut Johannes Gebeshuber“ (097f67ed-…) und „Spaetrot Gebeshuber GmbH“ (0569d025-…) alle Bewegungsdaten
--   der Pilotphase löschen; Stammdaten bleiben. Echtbetrieb ab 01.01.2027 – der Eröffnungsbestand zum 01.01.2027
--   (Wein in Gebinden, Flaschenlager, Kontensalden …) wird DANACH in der App erfasst.
--
-- ENTSCHEIDUNGEN JÖRGEN (02.10.2026)
--   • Behalten: CRM samt Aktivitäten, Aktivitäts-Dokumenten und Pipeline; Protokolle (bestandsprotokoll,
--     system_ereignisse), Wetterdaten, Morgenberichte; Anlagen (ea_anlagen, AfA-Stammdaten); abgegebene Meldungen.
--   • Abräumen (Nachtrag 02.10.2026): auch die Daueraufträge (ea_dauerauftraege samt ea_dauerauftrag_log) – sie werden
--     für 2027 neu angelegt; sonst buchten fällige Termine nach dem Abräumen weiter in den Dezember 2026.
--   • Abräumen: auch die Weinjahrgänge (samt Lesen und Lesedaten) – AUSSER ein Jahrgang hat eine abgegebene
--     AMA-Erntemeldung (Status nicht entwurf/bereit). Abgegebene Meldungen werden nie gelöscht (KAN-37, Sperre gilt
--     auch für Service-Role und SQL-Editor); mit ihnen bleiben ihr Jahrgang, dessen Lesen und Lesedaten stehen
--     (s112_lese_meldesperre sperrt sie ohnehin). Offene Meldungen (entwurf/bereit) werden gelöscht.
--   • Nummernkreise auf „Start 2027“ zurücksetzen (siehe unten); Kunden-/Account- und BMD-Personenkonten-Zähler
--     bleiben unverändert (sie hängen an den Stammdaten).
--
-- NUMMERNKREISE (abgeleitet aus den get_next_*-Funktionen)
--   rechnung_zaehler      = 1, rechnung_zaehler_jahr = 2027  get_next_rechnungsnummer vergibt den GESPEICHERTEN Wert
--                         und speichert +1; mit Jahres-Platzhalter im Suffix ({JJ}/{JJJJ}) setzt sie bei Jahreswechsel
--                         ohnehin auf 1. Entscheidung Jörgen 02.10.2026: die Rechnungsnummer trägt künftig das Jahr –
--   rechnung_suffix       enthält er keinen Platzhalter, wird „/{JJ}“ an den vorhandenen Suffix-Text angehängt
--                         (z. B. „“ → „/{JJ}“ ⇒ RE-0001/27). So wiederholt sich keine Pilot-Rechnungsnummer (§ 11 UStG);
--                         geprüft im Nachher-Teil, alter/neuer Suffix im Bericht und im system_ereignisse-Eintrag.
--   charge_zaehler        = 1     get_next_chargennummer vergibt den gespeicherten Wert (Spalten-Default 1), Jahr kommt
--                                 aus now() → CH-2027-001.
--   weinausbau_zaehler    = 1     KAN-192: Chargennummer der Chargen (Trigger a_chargennummer) → WA-2027-001.
--   liefernummer_zaehler  = 0     get_next_liefernummer erhöht zuerst und vergibt den neuen Wert (Default 0) → LN-2027-0001.
--   export_zaehler        BLEIBT  get_next_exportnummer kennt kein Jahr (Präfix + Zähler, kein Suffix/Platzhalter) –
--                                 ein Zurücksetzen wiederholte EX-Nummern; daher unverändert (Entscheidung Jörgen
--                                 02.10.2026). Bekommt die Exportnummer je einen Jahres-Platzhalter, hier analog zur
--                                 Rechnungsnummer zurücksetzen.
--   transaktionszaehler   Zeilen der beiden Betriebe gelöscht – get_next_transaktionsnr legt je (Betrieb, Typ, Jahr)
--                                 eine neue Zeile mit 1 an → KU-/EB-/VK-/KE-/TX-2027-0001.
--   journal_ab            = NULL  Bewegungsjournal (KAN-40) aus – seine Zeilen werden mit abgeräumt (der Schutz-Trigger
--                                 a_journal_schutz lässt sie mit s112.loeschen_erlaubt durch); Eröffnung nach dem Erfassen des
--                                 Eröffnungsbestands mit journal_eroeffnen(<Betrieb>, '2027-01-01').
--   kellerbuch_abschluesse        KAN-192: Kellerbuch-Abschlüsse des Pilotbetriebs abgeräumt (unwiderruflich, Wartung mit
--                                 s112.loeschen_erlaubt) – sonst sperrten sie den Eröffnungsbestand 2027 nicht, aber
--                                 widersprächen dem leeren Kellerbuch.
--   NICHT angefasst: export_zaehler, account_zaehler, bmd_debitor_zaehler, bmd_kreditor_zaehler, ki_abfragen_zaehler, Kundennummer.
--
-- ABLAUF (alles in EINER Transaktion – jeder Fehler und jede fehlgeschlagene Prüfung rollt ALLES zurück)
--   0. Vorprüfungen: Rolle (nie authenticated/anon), Betriebsnamen passen zu den IDs, jede Tabelle in public ist in
--      _pilot_tabellen eingeordnet (neue Tabellen seit KAN-185 → Abbruch, bitte einordnen), keine Buchungen fremder
--      Betriebe in den Gebinden (Kellergemeinschaft). Sperren: SHARE-Lock auf alle Mandantentabellen (andere Betriebe
--      warten die paar Sekunden mit dem Schreiben, die Prüfung „andere unverändert“ bleibt so eindeutig).
--   1. Vorher-Kennzahlen je Tabelle und Betrieb (+ „andere“ = alle übrigen Betriebe) in pg_temp.pilot_kennzahlen.
--   2. Löschen je Betrieb mit Wartungs-Kennzeichen set_config('s112.loeschen_erlaubt', <tenant>, true)
--      (transaktionslokal; öffnet s112_loeschsperre, s112_jahrgang_loeschsperre, s112_ea_periodensperre,
--      s112_ea_abschluss_schutz – Monatsabschluss, UVA, verbuchte Belege – über s112_wartung_frei; s112_storno_schutz,
--      s112_ea_storno_schutz und s112_verkauf_storno_schutz lassen Wartungsrollen ohnehin durch). NIE
--      session_replication_role/DISABLE TRIGGER: FK-Prüfungen, Kaskaden und das Bestandsprotokoll laufen mit –
--      jede gelöschte Zeile steht danach im bestandsprotokoll. Reihenfolge wie s112_mandant_loeschen (NO ACTION/
--      RESTRICT zuerst), Kinder ohne tenant_id ausdrücklich vor den Eltern (KAN-124).
--   3. Nummernkreise zurücksetzen.
--   4. Nachher-Kennzahlen und Prüfungen (RAISE EXCEPTION bei Abweichung): abzuräumende Tabellen = erwartet (0 bzw.
--      Zeilen abgegebener Meldungen), Stammdaten unverändert, andere Betriebe unverändert, Protokolle nur gewachsen,
--      FK-Waisen = 0 (Logik aus scripts/fk-waisen.sql), Füllstand aller Gebinde der Betriebe = 0
--      (v_behaelter_fuellstand), Nummernkreise wie oben.
--   5. Eintrag in system_ereignisse (art 'db', quelle 'pilot-abraeumen'); bei v_probelauf = true stattdessen
--      RAISE EXCEPTION 'PROBELAUF (zurückgerollt): …' mit Kurzbericht.
--   6. Nach COMMIT: Ausgabe der Vorher/Nachher-Tabelle (SELECT am Dateiende).
--
-- AUSFÜHRUNG (Supabase SQL-Editor, Produktion, als postgres – die ganze Datei auf einmal)
--   a) Ende November: Probelauf mit v_probelauf := true. Ergebnis ist eine Fehlermeldung „PROBELAUF (zurückgerollt)“
--      mit Kurzbericht – nichts geändert. Bei „PRÜFUNG FEHLGESCHLAGEN“ bzw. „nicht eingeordnet“: Ursache klären.
--   b) Mitte Dezember: vorher Export (scripts/pilot-abraeumen-export.sql) und Backup-Stand prüfen (siehe RÜCKWEG),
--      Benutzer informieren, v_probelauf := false setzen, ausführen. Ergebnis: Tabelle mit allen Kennzahlen.
--   c) Danach: scripts/fk-waisen.sql (0 Zeilen erwartet), Supabase Security Advisor unverändert, App-Stichprobe
--      (Kellerbuch leer, Gebinde leer, Stammdaten da), Eröffnungsbestand 01.01.2027 erfassen.
--   Fehler „lock timeout“: eine andere Sitzung hält gerade eine Tabelle – einfach erneut ausführen.
--
-- RÜCKWEG
--   Vor dem echten Lauf: (1) Supabase Dashboard → Database → Backups: letztes tägliches Backup bzw. PITR-Zeitpunkt
--   notieren (bei PITR: Uhrzeit unmittelbar vor dem Lauf festhalten); (2) CSV-Export der betroffenen Daten mit
--   scripts/pilot-abraeumen-export.sql. Ein Restore setzt die GANZE Datenbank zurück (auch andere Betriebe) – daher
--   gezielte Wiederherstellung einzelner Zeilen aus dem Export bzw. aus bestandsprotokoll (alt = komplette Zeile
--   jeder gelöschten Buchung). Storage-Dateien (Belege) werden NICHT gelöscht und bleiben verfügbar.
--
-- STAGING-TEST: Variante mit dem Demo-Betrieb Musterhof (c_betriebe/c_namen ersetzen) nur mit v_probelauf := true –
--   für Musterhof ist der echte Lauf gesperrt.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '15s';

-- Einordnung ALLER Tabellen in public (neue Tabelle → Abbruch, bis sie hier steht).
--   art: abräumen | nummernkreis | behalten | bleibt-ungelistet (in keiner Liste von Jörgen – bleibt) |
--        protokoll (bleibt, darf wachsen) | global (ohne Betriebsbezug, nur Anzeige)
--   eltern/fk: Kinder ohne tenant_id werden über die Elternzeile einem Betrieb zugeordnet
CREATE TEMP TABLE pilot_tabellen (tabelle text PRIMARY KEY, art text NOT NULL, eltern text, fk text,
                                  tspalte text NOT NULL DEFAULT 'tenant_id') ON COMMIT DROP;
INSERT INTO pilot_tabellen (tabelle, art, eltern, fk, tspalte) VALUES
  -- Keller / Weinbuch
  ('weinausbau', 'abräumen', NULL, NULL, 'tenant_id'),
  ('kellerbuch_buchungen', 'abräumen', NULL, NULL, 'tenant_id'),   -- KAN-40: Bewegungsjournal (unveränderlich, Wartung mit Kennzeichen)
  ('kellerbuch_abschluesse', 'abräumen', NULL, NULL, 'tenant_id'),   -- KAN-192: Periodensperre (unwiderruflich, Wartung mit Kennzeichen)
  ('weinausbau_weingaerten', 'abräumen', NULL, NULL, 'tenant_id'),
  ('keller_umzuege', 'abräumen', NULL, NULL, 'tenant_id'),
  ('verschneidungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('verschneidung_quellen', 'abräumen', 'verschneidungen', 'verschneidung_id', 'tenant_id'),
  ('keller_behandlungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('weinanalysen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('pressungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('pressung_behaelter', 'abräumen', 'pressungen', 'pressung_id', 'tenant_id'),
  ('pressung_weingaerten', 'abräumen', 'pressungen', 'pressung_id', 'tenant_id'),
  ('ernte_parzellen', 'abräumen', 'weinjahrgaenge', 'jahrgang_id', 'tenant_id'),
  ('lesen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('weinjahrgaenge', 'abräumen', NULL, NULL, 'tenant_id'),
  ('traubenverkauf', 'abräumen', NULL, NULL, 'tenant_id'),
  ('zukauf_posten', 'abräumen', NULL, NULL, 'tenant_id'),
  ('fuellungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('fuellung_chargen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('fuellung_bewegungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('dac_antrag', 'abräumen', NULL, NULL, 'tenant_id'),
  ('pruefnummernantraege', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ama_erntemeldungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ama_meldepositionen', 'abräumen', 'ama_erntemeldungen', 'meldung_id', 'tenant_id'),
  -- Verkauf / Warenwirtschaft
  ('verkaufsposten', 'abräumen', NULL, NULL, 'tenant_id'),
  ('verkauf_positionen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('zahlungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('bestellungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('bestellung_positionen', 'abräumen', 'bestellungen', 'bestellung_id', 'tenant_id'),
  ('sumup_checkouts', 'abräumen', NULL, NULL, 'tenant_id'),
  ('sumup_transaktionen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('transportbescheinigungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('exportauftraege', 'abräumen', NULL, NULL, 'tenant_id'),
  ('exportauftrag_positionen', 'abräumen', 'exportauftraege', 'exportauftrag_id', 'tenant_id'),
  ('export_dokumente', 'abräumen', 'exportauftraege', 'exportauftrag_id', 'tenant_id'),
  -- E/A-Rechnung, Kosten
  ('ea_transaktionen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ea_belege', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ea_monatsabschluss', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ea_uva', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ea_dauerauftrag_log', 'abräumen', NULL, NULL, 'tenant_id'),
  ('ea_dauerauftraege', 'abräumen', NULL, NULL, 'tenant_id'),
  ('konto_umbuchungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('kosteneintraege', 'abräumen', NULL, NULL, 'tenant_id'),
  ('kosteneintrag_behaelter', 'abräumen', 'kosteneintraege', 'kosteneintrag_id', 'tenant_id'),
  ('kosteneintrag_weingaerten', 'abräumen', 'kosteneintraege', 'kosteneintrag_id', 'tenant_id'),
  -- Weingarten-Maßnahmen, Betriebsmittel-Bewegungen
  ('behandlungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('behandlung_grundstuecke', 'abräumen', 'behandlungen', 'behandlung_id', 'tenant_id'),
  ('psm_lager_bewegungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('duengemittel_lager_bewegungen', 'abräumen', NULL, NULL, 'tenant_id'),
  ('betriebsmittel_lager_bewegungen', 'abräumen', NULL, NULL, 'tenant_id'),
  -- Nummernkreis
  ('transaktionszaehler', 'nummernkreis', NULL, NULL, 'tenant_id'),
  -- Behalten (Liste Jörgen 02.10.2026)
  ('kontakte', 'behalten', NULL, NULL, 'tenant_id'),
  ('firmen', 'behalten', NULL, NULL, 'tenant_id'),
  ('rabattgruppen', 'behalten', NULL, NULL, 'tenant_id'),
  ('aktivitaeten', 'behalten', NULL, NULL, 'tenant_id'),
  ('aktivitaet_dokumente', 'behalten', NULL, NULL, 'tenant_id'),
  ('pipeline_eintraege', 'behalten', NULL, NULL, 'tenant_id'),
  ('weingarten', 'behalten', NULL, NULL, 'tenant_id'),
  ('grundstuecke', 'behalten', NULL, NULL, 'tenant_id'),
  ('lagen', 'behalten', NULL, NULL, 'tenant_id'),
  ('weinbaugebiete_custom', 'behalten', NULL, NULL, 'tenant_id'),
  ('behaelter', 'behalten', NULL, NULL, 'tenant_id'),
  ('kellerplaene', 'behalten', NULL, NULL, 'tenant_id'),
  ('kellerplan_positionen', 'behalten', NULL, NULL, 'tenant_id'),
  ('keller_behandlungstypen', 'behalten', NULL, NULL, 'tenant_id'),
  ('pflanzenschutzmittel', 'behalten', NULL, NULL, 'tenant_id'),
  ('duengemittel', 'behalten', NULL, NULL, 'tenant_id'),
  ('betriebsmittel', 'behalten', NULL, NULL, 'tenant_id'),
  ('ea_kategorien', 'behalten', NULL, NULL, 'tenant_id'),
  ('ea_anlagen', 'behalten', NULL, NULL, 'tenant_id'),
  ('konten', 'behalten', NULL, NULL, 'tenant_id'),
  ('kostenstellen', 'behalten', NULL, NULL, 'tenant_id'),
  ('kostenarten', 'behalten', NULL, NULL, 'tenant_id'),
  ('buchhaltung_kontenmapping', 'behalten', NULL, NULL, 'tenant_id'),
  ('sonstige_artikel', 'behalten', NULL, NULL, 'tenant_id'),
  ('sumup_terminals', 'behalten', NULL, NULL, 'tenant_id'),
  ('checklisten', 'behalten', NULL, NULL, 'tenant_id'),
  ('checklisten_punkte', 'behalten', NULL, NULL, 'tenant_id'),
  ('fristen', 'behalten', NULL, NULL, 'tenant_id'),
  ('tenant_einstellungen', 'behalten', NULL, NULL, 'tenant_id'),
  ('tenant_memberships', 'behalten', NULL, NULL, 'tenant_id'),
  ('module_flags', 'behalten', NULL, NULL, 'tenant_id'),
  ('user_email_connections', 'behalten', NULL, NULL, 'tenant_id'),
  ('meldung_abgaben', 'behalten', NULL, NULL, 'tenant_id'),
  ('wetter_stunden', 'behalten', NULL, NULL, 'tenant_id'),
  ('morgenberichte', 'behalten', NULL, NULL, 'tenant_id'),
  -- In keiner Liste – bleibt (im Bericht KAN-185 genannt)
  ('kontakt_firmen', 'bleibt-ungelistet', 'kontakte', 'kontakt_id', 'tenant_id'),
  ('kontakt_praeferenzen', 'bleibt-ungelistet', 'kontakte', 'kontakt_id', 'tenant_id'),
  ('pipeline_verlauf', 'bleibt-ungelistet', 'pipeline_eintraege', 'pipeline_id', 'tenant_id'),
  ('weingarten_rebsorten', 'bleibt-ungelistet', 'weingarten', 'weingarten_id', 'tenant_id'),
  ('crm_dubletten_ignoriert', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('datenschutz_consents', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('email_lead_ignoriert', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('saetze_massnahmen', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('buchhaltung_export_protokoll', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('benachrichtigungen', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('assistent_unterhaltungen', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('assistent_nachrichten', 'bleibt-ungelistet', 'assistent_unterhaltungen', 'unterhaltung_id', 'tenant_id'),
  ('assistent_aktionen', 'bleibt-ungelistet', 'assistent_unterhaltungen', 'unterhaltung_id', 'tenant_id'),
  ('assistent_korrekturen', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('zeiterfassung', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('stripe_zahlungen_log', 'bleibt-ungelistet', NULL, NULL, 'tenant_id'),
  ('keller_freigaben', 'bleibt-ungelistet', NULL, NULL, 'eigentuemer_tenant_id'),
  -- Protokolle (bleiben, wachsen durch das Löschen)
  ('bestandsprotokoll', 'protokoll', NULL, NULL, 'tenant_id'),
  ('system_ereignisse', 'protokoll', NULL, NULL, 'tenant_id'),
  -- Ohne Betriebsbezug
  ('tenants', 'global', NULL, NULL, 'tenant_id'),
  ('profiles', 'global', NULL, NULL, 'tenant_id'),
  ('plattform_admins', 'global', NULL, NULL, 'tenant_id'),
  ('rebsorten', 'global', NULL, NULL, 'tenant_id'),
  ('release_notes', 'global', NULL, NULL, 'tenant_id'),
  ('release_notes_gesehen', 'global', NULL, NULL, 'tenant_id'),
  ('svs_parameter', 'global', NULL, NULL, 'tenant_id'),
  ('kat_buchungsart', 'global', NULL, NULL, 'tenant_id'),
  ('kat_erzeugnis', 'global', NULL, NULL, 'tenant_id'),
  ('kat_farbe', 'global', NULL, NULL, 'tenant_id'),
  ('kat_land', 'global', NULL, NULL, 'tenant_id'),
  ('kat_qualitaetsstufe', 'global', NULL, NULL, 'tenant_id'),
  ('katalog_mapping', 'global', NULL, NULL, 'tenant_id');

-- Kennzahlen: je Tabelle eine Zeile je Betrieb und eine Zeile „andere“ (alle übrigen Betriebe bzw. ohne Betrieb)
CREATE TEMP TABLE pilot_kennzahlen (tabelle text, art text, betrieb text, tenant_id uuid, reihe int,
                                    vorher bigint, erwartet bigint, nachher bigint, ok boolean);

-- Zählt alle eingeordneten Tabellen je Betrieb (p_phase 'vorher' legt die Zeilen an, 'nachher' ergänzt sie)
CREATE FUNCTION pg_temp.pilot_zaehlen(p_phase text, p_betriebe uuid[], p_namen text[]) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  r       record;
  v_sql   text;
  v_werte bigint[];
  v_andere bigint;
  i       int;
BEGIN
  FOR r IN SELECT * FROM pg_temp.pilot_tabellen ORDER BY tabelle LOOP
    IF r.art = 'global' THEN
      EXECUTE format('SELECT count(*) FROM public.%I', r.tabelle) INTO v_andere;
      v_werte := NULL;
    ELSE
      v_sql := CASE WHEN r.eltern IS NULL
        THEN format('SELECT x.%I AS t, count(*) AS n FROM public.%I x GROUP BY 1', r.tspalte, r.tabelle)
        ELSE format('SELECT p.tenant_id AS t, count(*) AS n FROM public.%I x LEFT JOIN public.%I p ON p.id = x.%I GROUP BY 1',
                    r.tabelle, r.eltern, r.fk) END;
      EXECUTE format('WITH z AS (%s) SELECT (SELECT array_agg(COALESCE((SELECT sum(z.n) FROM z WHERE z.t = u.b), 0)::bigint ORDER BY u.o)
                                                FROM unnest($1) WITH ORDINALITY AS u(b, o)),
                                            (SELECT COALESCE(sum(z.n), 0)::bigint FROM z WHERE z.t IS NULL OR z.t <> ALL ($1))', v_sql)
        INTO v_werte, v_andere USING p_betriebe;
    END IF;
    IF p_phase = 'vorher' THEN
      FOR i IN 1 .. COALESCE(array_length(v_werte, 1), 0) LOOP
        INSERT INTO pg_temp.pilot_kennzahlen (tabelle, art, betrieb, tenant_id, reihe, vorher)
        VALUES (r.tabelle, r.art, p_namen[i], p_betriebe[i], i, v_werte[i]);
      END LOOP;
      INSERT INTO pg_temp.pilot_kennzahlen (tabelle, art, betrieb, tenant_id, reihe, vorher)
      VALUES (r.tabelle, r.art, CASE WHEN r.art = 'global' THEN 'gesamt' ELSE 'andere' END, NULL, 99, v_andere);
    ELSE
      FOR i IN 1 .. COALESCE(array_length(v_werte, 1), 0) LOOP
        UPDATE pg_temp.pilot_kennzahlen SET nachher = v_werte[i] WHERE tabelle = r.tabelle AND tenant_id = p_betriebe[i];
      END LOOP;
      UPDATE pg_temp.pilot_kennzahlen SET nachher = v_andere WHERE tabelle = r.tabelle AND tenant_id IS NULL AND reihe = 99;
    END IF;
  END LOOP;
END;
$f$;

DO $pilot$
DECLARE
  -- ┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
  -- │ SCHALTER: true = Probelauf (alles wird am Ende zurückgerollt), false = echter Lauf (Mitte Dezember)   │
  v_probelauf constant boolean := true;
  -- │ Betriebe (IDs und Namen müssen zusammenpassen, sonst Abbruch)                                         │
  c_betriebe constant uuid[] := ARRAY['097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d']::uuid[];
  c_namen    constant text[] := ARRAY['Weingut Johannes Gebeshuber', 'Spaetrot Gebeshuber GmbH'];
  -- └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
  c_demo     constant uuid := '33333333-3333-4333-8333-333333333333';
  c_jahr     constant int  := 2027;   -- Start des Echtbetriebs (Nummernkreise)
  v_rolle    text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_t        uuid;
  v_i        int;
  v_n        bigint;
  v_name     text;
  v_txt      text;
  v_fehler   text[] := '{}';
  v_jg       uuid[];          -- geschützte Jahrgänge (mit abgegebener AMA-Erntemeldung) des aktuellen Betriebs
  v_jg_alle  jsonb := '{}';   -- für den Bericht: Betrieb → Jahrgänge, die stehen bleiben
  v_belege   bigint := 0;
  v_details  jsonb;
  v_suffix_alt jsonb;         -- Rechnungs-Suffix vorher je Betrieb (Bericht)
  r          record;
BEGIN
  -- ── 0. Vorprüfungen ──────────────────────────────────────────────────────────────────────────────────────
  IF v_rolle IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'pilot-abraeumen nur im SQL-Editor bzw. als Service-Role/postgres ausführen (Rolle „%“).', v_rolle;
  END IF;
  IF c_demo = ANY (c_betriebe) AND NOT v_probelauf THEN
    RAISE EXCEPTION 'Der Demo-Betrieb Musterhof ist nur im Probelauf erlaubt (er hat einen eigenen nächtlichen Reset).';
  END IF;
  IF array_length(c_betriebe, 1) IS DISTINCT FROM array_length(c_namen, 1) THEN
    RAISE EXCEPTION 'c_betriebe und c_namen sind unterschiedlich lang.';
  END IF;
  FOR v_i IN 1 .. array_length(c_betriebe, 1) LOOP
    SELECT t.name INTO v_name FROM public.tenants t WHERE t.id = c_betriebe[v_i];
    IF v_name IS DISTINCT FROM c_namen[v_i] THEN
      RAISE EXCEPTION 'Betrieb % heißt „%“, erwartet „%“ – IDs bzw. Namen prüfen. Nichts geändert.', c_betriebe[v_i], v_name, c_namen[v_i];
    END IF;
  END LOOP;

  -- jede Tabelle in public muss eingeordnet sein (neue Tabellen seit KAN-185!) – und jede eingeordnete muss es geben
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_txt
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_temp.pilot_tabellen p WHERE p.tabelle = c.relname);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Tabellen nicht eingeordnet: % – bitte in pilot_tabellen als abräumen/behalten/… eintragen (und ggf. löschen). Nichts geändert.', v_txt;
  END IF;
  SELECT string_agg(p.tabelle, ', ') INTO v_txt FROM pg_temp.pilot_tabellen p WHERE to_regclass('public.' || quote_ident(p.tabelle)) IS NULL;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Eingeordnete Tabellen fehlen in der Datenbank: % – Liste anpassen. Nichts geändert.', v_txt;
  END IF;

  -- Sperren: andere Betriebe schreiben während der paar Sekunden nicht in Mandantentabellen (Protokolle ausgenommen)
  FOR r IN SELECT tabelle FROM pg_temp.pilot_tabellen WHERE art NOT IN ('global', 'protokoll') ORDER BY tabelle LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', r.tabelle);
  END LOOP;

  -- Kellergemeinschaft: Buchungen anderer Betriebe in Gebinden der Betriebe blockieren (wie s112_mandant_loeschen)
  SELECT (SELECT count(*) FROM public.weinausbau w JOIN public.behaelter b ON b.id = w.behaelter_id
           WHERE b.tenant_id = ANY (c_betriebe) AND w.tenant_id <> ALL (c_betriebe))
       + (SELECT count(*) FROM public.keller_umzuege u JOIN public.behaelter b ON b.id IN (u.von_behaelter_id, u.nach_behaelter_id)
           WHERE b.tenant_id = ANY (c_betriebe) AND u.tenant_id <> ALL (c_betriebe))
       + (SELECT count(*) FROM public.keller_behandlungen k JOIN public.behaelter b ON b.id = k.behaelter_id
           WHERE b.tenant_id = ANY (c_betriebe) AND k.tenant_id <> ALL (c_betriebe))
       + (SELECT count(*) FROM public.pressung_behaelter pb JOIN public.behaelter b ON b.id = pb.behaelter_id
           JOIN public.pressungen p ON p.id = pb.pressung_id
           WHERE b.tenant_id = ANY (c_betriebe) AND p.tenant_id <> ALL (c_betriebe))
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'In Gebinden der Betriebe liegen % Buchungen anderer Betriebe (Kellergemeinschaft) – erst dort bereinigen. Nichts geändert.', v_n;
  END IF;

  -- ── 1. Vorher-Kennzahlen ─────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.pilot_zaehlen('vorher', c_betriebe, c_namen);

  -- Erwartung nachher: abräumen/nummernkreis = 0, behalten = vorher; abgegebene AMA-Meldungen samt Positionen,
  -- ihre Jahrgänge, deren Lesen und Lesedaten bleiben stehen (KAN-37)
  UPDATE pg_temp.pilot_kennzahlen k SET erwartet = CASE WHEN k.art IN ('abräumen', 'nummernkreis') THEN 0 ELSE k.vorher END
   WHERE k.tenant_id IS NOT NULL;
  FOR v_i IN 1 .. array_length(c_betriebe, 1) LOOP
    v_t := c_betriebe[v_i];
    SELECT COALESCE(array_agg(DISTINCT m.jahrgang_id), '{}') INTO v_jg
      FROM public.ama_erntemeldungen m WHERE m.tenant_id = v_t AND m.status NOT IN ('entwurf', 'bereit');
    UPDATE pg_temp.pilot_kennzahlen SET erwartet = (SELECT count(*) FROM public.ama_erntemeldungen m
                                                      WHERE m.tenant_id = v_t AND m.status NOT IN ('entwurf', 'bereit'))
     WHERE tabelle = 'ama_erntemeldungen' AND tenant_id = v_t;
    UPDATE pg_temp.pilot_kennzahlen SET erwartet = (SELECT count(*) FROM public.ama_meldepositionen p JOIN public.ama_erntemeldungen m ON m.id = p.meldung_id
                                                      WHERE m.tenant_id = v_t AND m.status NOT IN ('entwurf', 'bereit'))
     WHERE tabelle = 'ama_meldepositionen' AND tenant_id = v_t;
    UPDATE pg_temp.pilot_kennzahlen SET erwartet = cardinality(v_jg) WHERE tabelle = 'weinjahrgaenge' AND tenant_id = v_t;
    UPDATE pg_temp.pilot_kennzahlen SET erwartet = (SELECT count(*) FROM public.lesen l WHERE l.jahrgang_id = ANY (v_jg))
     WHERE tabelle = 'lesen' AND tenant_id = v_t;
    UPDATE pg_temp.pilot_kennzahlen SET erwartet = (SELECT count(*) FROM public.ernte_parzellen e WHERE e.jahrgang_id = ANY (v_jg))
     WHERE tabelle = 'ernte_parzellen' AND tenant_id = v_t;
    IF cardinality(v_jg) > 0 THEN
      v_jg_alle := v_jg_alle || jsonb_build_object(c_namen[v_i],
        (SELECT jsonb_agg(j.jahrgang ORDER BY j.jahrgang) FROM public.weinjahrgaenge j WHERE j.id = ANY (v_jg)));
    END IF;
  END LOOP;

  -- Belegdateien im Storage (werden NICHT gelöscht – nur zur Info)
  SELECT count(*) INTO v_belege FROM storage.objects o
   WHERE o.name IN (SELECT b.storage_pfad FROM public.ea_belege b WHERE b.tenant_id = ANY (c_betriebe) AND b.storage_pfad IS NOT NULL);

  -- Nummernkreise vorher
  INSERT INTO pg_temp.pilot_kennzahlen (tabelle, art, betrieb, tenant_id, reihe, vorher, erwartet)
  SELECT 'tenant_einstellungen.' || z.feld, 'nummernkreis-wert', c_namen[u.o], e.tenant_id, u.o::int, z.wert, z.soll
    FROM unnest(c_betriebe) WITH ORDINALITY AS u(b, o)
    JOIN public.tenant_einstellungen e ON e.tenant_id = u.b
    CROSS JOIN LATERAL (VALUES ('rechnung_zaehler', e.rechnung_zaehler::bigint, 1::bigint),
                               ('rechnung_zaehler_jahr', e.rechnung_zaehler_jahr::bigint, c_jahr::bigint),
                               ('charge_zaehler', e.charge_zaehler::bigint, 1::bigint),
                               ('weinausbau_zaehler', e.weinausbau_zaehler::bigint, 1::bigint),   -- KAN-192
                               ('liefernummer_zaehler', e.liefernummer_zaehler::bigint, 0::bigint),
                               ('export_zaehler', e.export_zaehler::bigint, e.export_zaehler::bigint)) AS z(feld, wert, soll);   -- bleibt (ohne Jahr)
  SELECT jsonb_object_agg(e.tenant_id::text, COALESCE(e.rechnung_suffix, '')) INTO v_suffix_alt
    FROM public.tenant_einstellungen e WHERE e.tenant_id = ANY (c_betriebe);

  -- ── 2. Löschen je Betrieb ────────────────────────────────────────────────────────────────────────────────
  FOR v_i IN 1 .. array_length(c_betriebe, 1) LOOP
    v_t := c_betriebe[v_i];
    -- Wartungs-Kennzeichen nur für diesen Betrieb (transaktionslokal); Kinder ohne tenant_id gelten damit als frei
    PERFORM set_config('s112.loeschen_erlaubt', v_t::text, true);
    SELECT COALESCE(array_agg(DISTINCT m.jahrgang_id), '{}') INTO v_jg
      FROM public.ama_erntemeldungen m WHERE m.tenant_id = v_t AND m.status NOT IN ('entwurf', 'bereit');

    -- 0) Bewegungsjournal (KAN-40): unveränderlich, Löschen nur mit s112.loeschen_erlaubt = Betrieb; eine Anweisung –
    --    Gegenbuchungen verweisen per storno_von_id auf Originale desselben Betriebs (Prüfung am Ende der Anweisung)
    DELETE FROM public.kellerbuch_buchungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185/KAN-40, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.kellerbuch_abschluesse WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185/KAN-192, Kennzeichen s112.loeschen_erlaubt

    -- a) Kasse/E-A: SumUp, Dauerauftrags-Log, Belege, Betriebsmittel-Bewegungen (verweisen auf ea_transaktionen)
    DELETE FROM public.sumup_transaktionen WHERE tenant_id = v_t;
    DELETE FROM public.sumup_checkouts WHERE tenant_id = v_t;
    DELETE FROM public.ea_dauerauftrag_log WHERE tenant_id = v_t;
    DELETE FROM public.ea_belege WHERE tenant_id = v_t;
    DELETE FROM public.betriebsmittel_lager_bewegungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    -- E/A-Buchungen: Gegenbuchungen vor den Originalen (storno_von_id ist RESTRICT) – schichtweise, bis nichts mehr übrig
    LOOP
      DELETE FROM public.ea_transaktionen x WHERE x.tenant_id = v_t   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
         AND NOT EXISTS (SELECT 1 FROM public.ea_transaktionen g WHERE g.storno_von_id = x.id);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      EXIT WHEN v_n = 0;
    END LOOP;
    -- Daueraufträge nach den E/A-Buchungen (Stammdaten-Löschsperre öffnet das Kennzeichen über s112_wartung_frei)
    DELETE FROM public.ea_dauerauftraege WHERE tenant_id = v_t;
    DELETE FROM public.konto_umbuchungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.ea_monatsabschluss WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.ea_uva WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.kosteneintrag_behaelter WHERE kosteneintrag_id IN (SELECT id FROM public.kosteneintraege WHERE tenant_id = v_t);
    DELETE FROM public.kosteneintrag_weingaerten WHERE kosteneintrag_id IN (SELECT id FROM public.kosteneintraege WHERE tenant_id = v_t);
    DELETE FROM public.kosteneintraege WHERE tenant_id = v_t;

    -- b) Verkauf, Export, Bestellungen (Kinder vor Eltern; Traubenverkäufe vor den Verkaufsposten)
    DELETE FROM public.transportbescheinigungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.export_dokumente WHERE exportauftrag_id IN (SELECT id FROM public.exportauftraege WHERE tenant_id = v_t);   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.exportauftrag_positionen WHERE exportauftrag_id IN (SELECT id FROM public.exportauftraege WHERE tenant_id = v_t);   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.exportauftraege WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.zahlungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.verkauf_positionen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.bestellung_positionen WHERE bestellung_id IN (SELECT id FROM public.bestellungen WHERE tenant_id = v_t);
    DELETE FROM public.bestellungen WHERE tenant_id = v_t;
    DELETE FROM public.traubenverkauf WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.verkaufsposten WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt

    -- c) Füllungen, Prüfnummern, DAC
    DELETE FROM public.fuellung_bewegungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.fuellung_chargen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.fuellungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.pruefnummernantraege WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.dac_antrag WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt

    -- d) Keller: alles, was auf Chargen (weinausbau) zeigt, vor den Chargen; Pressungen vor Zukauf (chk_pressung_wg_quelle)
    DELETE FROM public.weinanalysen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.verschneidung_quellen WHERE verschneidung_id IN (SELECT id FROM public.verschneidungen WHERE tenant_id = v_t);   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.verschneidungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.keller_behandlungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.keller_umzuege WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.pressung_behaelter WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = v_t);   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.pressung_weingaerten WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = v_t);   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.pressungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.zukauf_posten WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.weinausbau_weingaerten WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.weinausbau WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt

    -- e) Weingarten-Maßnahmen und Lagerbewegungen der Mittel
    DELETE FROM public.behandlung_grundstuecke WHERE behandlung_id IN (SELECT id FROM public.behandlungen WHERE tenant_id = v_t);   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.behandlungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.psm_lager_bewegungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt
    DELETE FROM public.duengemittel_lager_bewegungen WHERE tenant_id = v_t;   -- storno-ausnahme: Pilotabschluss KAN-185, Kennzeichen s112.loeschen_erlaubt

    -- f) AMA-Erntemeldungen: nur offene (entwurf/bereit); abgegebene bleiben samt Positionen (KAN-37)
    DELETE FROM public.ama_meldepositionen WHERE meldung_id IN (SELECT id FROM public.ama_erntemeldungen   -- storno-ausnahme: Pilotabschluss KAN-185, nur offene Meldungen (entwurf/bereit)
                                                                 WHERE tenant_id = v_t AND status IN ('entwurf', 'bereit'));
    DELETE FROM public.ama_erntemeldungen WHERE tenant_id = v_t AND status IN ('entwurf', 'bereit');   -- storno-ausnahme: Pilotabschluss KAN-185, nur offene Meldungen (entwurf/bereit)

    -- g) Lesedaten und Jahrgänge (Lesen über die Kaskade des Jahrgangs) – außer Jahrgängen mit abgegebener Meldung
    DELETE FROM public.ernte_parzellen   -- storno-ausnahme: Pilotabschluss KAN-185, Jahrgänge ohne abgegebene AMA-Meldung
     WHERE jahrgang_id IN (SELECT id FROM public.weinjahrgaenge WHERE tenant_id = v_t AND id <> ALL (v_jg));
    DELETE FROM public.weinjahrgaenge WHERE tenant_id = v_t AND id <> ALL (v_jg);   -- storno-ausnahme: Pilotabschluss KAN-185, Jahrgänge ohne abgegebene AMA-Meldung

    -- h) Nummernkreise auf Start 2027
    DELETE FROM public.transaktionszaehler WHERE tenant_id = v_t;
    UPDATE public.tenant_einstellungen
       SET rechnung_zaehler = 1, rechnung_zaehler_jahr = c_jahr, charge_zaehler = 1, liefernummer_zaehler = 0,
           weinausbau_zaehler = 1,   -- KAN-192: Chargennummer WA-2027-001
           journal_ab = NULL,   -- KAN-40: Journal nach dem Eröffnungsbestand 2027 neu eröffnen (journal_eroeffnen)
           -- Rechnungsnummer mit Jahr: fehlt ein Platzhalter ({JJ}/{JJJJ}), „/{JJ}“ an den Suffix-Text anhängen
           rechnung_suffix = CASE WHEN COALESCE(rechnung_suffix, '') LIKE '%{JJ%' THEN rechnung_suffix
                                  ELSE COALESCE(rechnung_suffix, '') || '/{JJ}' END
     WHERE tenant_id = v_t;
  END LOOP;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  -- ── 4. Nachher-Kennzahlen und Prüfungen ──────────────────────────────────────────────────────────────────
  PERFORM pg_temp.pilot_zaehlen('nachher', c_betriebe, c_namen);
  UPDATE pg_temp.pilot_kennzahlen k SET nachher = z.wert
    FROM (SELECT e.tenant_id, x.feld, x.wert FROM public.tenant_einstellungen e
            CROSS JOIN LATERAL (VALUES ('rechnung_zaehler', e.rechnung_zaehler::bigint), ('rechnung_zaehler_jahr', e.rechnung_zaehler_jahr::bigint),
                                       ('charge_zaehler', e.charge_zaehler::bigint), ('liefernummer_zaehler', e.liefernummer_zaehler::bigint),
                                       ('weinausbau_zaehler', e.weinausbau_zaehler::bigint),
                                       ('export_zaehler', e.export_zaehler::bigint)) AS x(feld, wert)
           WHERE e.tenant_id = ANY (c_betriebe)) z
   WHERE k.art = 'nummernkreis-wert' AND k.tenant_id = z.tenant_id AND k.tabelle = 'tenant_einstellungen.' || z.feld;

  UPDATE pg_temp.pilot_kennzahlen SET ok = CASE
      WHEN art = 'global' THEN true                                          -- nur Anzeige
      WHEN art = 'protokoll' AND tenant_id IS NULL THEN true                 -- andere Betriebe/Cron schreiben weiter (nicht gesperrt)
      WHEN art = 'protokoll' THEN nachher >= vorher                          -- Protokolle wachsen nur
      WHEN tenant_id IS NULL THEN nachher = vorher                           -- andere Betriebe unverändert
      ELSE nachher = erwartet END;
  SELECT array_agg(format('%s [%s] %s: vorher %s, erwartet %s, nachher %s', tabelle, art, betrieb, vorher, COALESCE(erwartet::text, '='), nachher)
                   ORDER BY tabelle, reihe)
    INTO v_fehler FROM pg_temp.pilot_kennzahlen WHERE ok IS NOT TRUE;
  v_fehler := COALESCE(v_fehler, '{}');

  -- Rechnungs-Suffix muss jetzt einen Jahres-Platzhalter tragen (eindeutige Nummer je Jahr)
  SELECT string_agg(format('Rechnungs-Suffix ohne Jahres-Platzhalter: %s („%s“)', c_namen[u.o], COALESCE(e.rechnung_suffix, '')), '; ') INTO v_txt
    FROM unnest(c_betriebe) WITH ORDINALITY AS u(b, o) JOIN public.tenant_einstellungen e ON e.tenant_id = u.b
   WHERE COALESCE(e.rechnung_suffix, '') NOT LIKE '%{JJ%';
  IF v_txt IS NOT NULL THEN
    v_fehler := v_fehler || v_txt;
  END IF;

  -- FK-Waisen (Logik aus scripts/fk-waisen.sql): jeder Fremdschlüssel in public, Zählweise MATCH SIMPLE
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tabelle, c.confrelid::regclass AS ziel,
           array_agg(a.attname ORDER BY k.ord) AS spalten, array_agg(z.attname ORDER BY k.ord) AS zielspalten
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(spalte, zielspalte, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.spalte
      JOIN pg_attribute z ON z.attrelid = c.confrelid AND z.attnum = k.zielspalte
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
     GROUP BY c.oid, c.conname, c.conrelid, c.confrelid
  LOOP
    EXECUTE format('SELECT count(*) FROM %s t WHERE %s AND NOT EXISTS (SELECT 1 FROM %s z WHERE %s)', r.tabelle,
      (SELECT string_agg(format('t.%I IS NOT NULL', s), ' AND ') FROM unnest(r.spalten) AS s),
      r.ziel,
      (SELECT string_agg(format('z.%I = t.%I', zs, s), ' AND ') FROM unnest(r.spalten, r.zielspalten) AS x(s, zs))) INTO v_n;
    IF v_n > 0 THEN
      v_fehler := v_fehler || format('FK-Waisen: %s (%s) – %s Zeilen', r.conname, r.tabelle, v_n);
    END IF;
  END LOOP;

  -- Füllstand aller Gebinde der Betriebe = 0 (auch Buchungen anderer Betriebe in diesen Gebinden)
  SELECT count(*) INTO v_n FROM public.v_behaelter_fuellstand f JOIN public.behaelter b ON b.id = f.behaelter_id
   WHERE (b.tenant_id = ANY (c_betriebe) OR f.tenant_id = ANY (c_betriebe)) AND f.liter_aktuell <> 0;
  IF v_n > 0 THEN
    v_fehler := v_fehler || format('Füllstand: %s Gebinde der Betriebe sind nicht leer (v_behaelter_fuellstand)', v_n);
  END IF;

  IF cardinality(v_fehler) > 0 THEN
    RAISE EXCEPTION E'PRÜFUNG FEHLGESCHLAGEN – alles zurückgerollt, nichts geändert:\n%', array_to_string(v_fehler, E'\n');
  END IF;

  -- ── 5. Bericht, Ereignis, Probelauf ──────────────────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
           'betriebe', to_jsonb(c_betriebe),
           'geloescht', (SELECT jsonb_object_agg(betrieb, t) FROM (
                           SELECT betrieb, jsonb_object_agg(tabelle, vorher - nachher ORDER BY tabelle) AS t
                             FROM pg_temp.pilot_kennzahlen WHERE art IN ('abräumen', 'nummernkreis') AND tenant_id IS NOT NULL AND vorher <> nachher
                            GROUP BY betrieb) s),
           'bleiben_jahrgaenge_mit_abgegebener_meldung', v_jg_alle,
           'nummernkreise', (SELECT jsonb_object_agg(betrieb || ' ' || tabelle, jsonb_build_array(vorher, nachher))
                               FROM pg_temp.pilot_kennzahlen WHERE art = 'nummernkreis-wert'),
           'rechnung_suffix', jsonb_build_object('vorher', v_suffix_alt, 'nachher',
              (SELECT jsonb_object_agg(e.tenant_id::text, e.rechnung_suffix) FROM public.tenant_einstellungen e WHERE e.tenant_id = ANY (c_betriebe))),
           'belegdateien_im_storage_unveraendert', v_belege)
    INTO v_details;

  SELECT string_agg(format('%s – %s: %s → %s', betrieb, tabelle, vorher, nachher), E'\n' ORDER BY reihe, tabelle) INTO v_txt
    FROM pg_temp.pilot_kennzahlen
   WHERE tenant_id IS NOT NULL AND art IN ('abräumen', 'nummernkreis', 'nummernkreis-wert') AND (vorher <> 0 OR nachher <> 0);

  IF v_probelauf THEN
    RAISE EXCEPTION E'PROBELAUF (zurückgerollt): alle Prüfungen grün, nichts geändert.\nStehen bleibende Jahrgänge (abgegebene AMA-Meldung): %\nBelegdateien im Storage (bleiben): %\nRechnungs-Suffix: % → %\n%',
      v_jg_alle, v_belege, v_suffix_alt, v_details -> 'rechnung_suffix' -> 'nachher', COALESCE(v_txt, '(keine Bewegungsdaten)');
  END IF;

  INSERT INTO public.system_ereignisse (art, quelle, meldung, tenant_id, user_id, details)
  VALUES ('db', 'pilot-abraeumen', 'KAN-185 Pilotabschluss, Echtbetrieb ab 01.01.2027 – Bewegungsdaten abgeräumt, Nummernkreise zurückgesetzt',
          NULL, NULL, v_details);
  RAISE NOTICE 'Pilotabschluss KAN-185 durchgeführt: %', v_details;
END
$pilot$;

COMMIT;

-- 6. Ausgabe (nur nach erfolgreichem echtem Lauf; beim Probelauf endet die Ausführung oben mit der Meldung)
SELECT tabelle, art, betrieb, vorher, erwartet, nachher, ok
  FROM pg_temp.pilot_kennzahlen
 ORDER BY CASE art WHEN 'abräumen' THEN 1 WHEN 'nummernkreis' THEN 2 WHEN 'nummernkreis-wert' THEN 3 WHEN 'behalten' THEN 4
                   WHEN 'bleibt-ungelistet' THEN 5 WHEN 'protokoll' THEN 6 ELSE 7 END, tabelle, reihe;
