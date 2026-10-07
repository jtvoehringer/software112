-- Entwurf: wiener_datum_statt_current_date
--
-- „Heute“ in der Datenbank ist das Wiener Datum – (now() AT TIME ZONE 'Europe/Vienna')::date –, nicht
-- current_date: die Sitzungs-Zeitzone von PostgREST, Cron und SQL-Editor ist UTC, zwischen 00:00 und 01:00
-- (Winterzeit) bzw. 02:00 (Sommerzeit) Wiener Zeit liegt current_date einen Tag zurück. Die Kellerbuch-RPCs
-- (Journal, Abschluss, Abstufen, Charge-Status, Verarbeitung, Zugangskorrektur, Etikettieren) rechnen bereits
-- wienerisch; diese Funktionen und Spalten-Defaults noch nicht:
--
--   s112_pruefnummernantrag_status_setzen  Datum vorbelegt mit current_date, „Datum in der Zukunft“ gegen current_date
--                                          → nach Mitternacht (Wien) wird „heute“ als Zukunft abgelehnt
--   s112_ama_status_setzen                 dasselbe für die AMA-Erntemeldung; eingereicht_am (timestamptz)::date in UTC
--   s112_pn_chargen_pflegen                Ende/Wiederaufnahme der Prüfnummer-Gültigkeit am UTC-Tag statt am Wiener Tag
--   get_next_liefernummer                  Jahr der Liefernummer (01.01. 00:00–01:00 Wien → altes Jahr)
--   get_next_transaktionsnr                Jahr der E/A-Transaktionsnummer (ebenso)
--   check_und_increment_ki_abfrage         Monatswechsel des KI-Zählers
--   process_ea_dauerauftraege              Fälligkeit der Daueraufträge
--   sumup_tx_zu_zahlung                    Zahlungsdatum aus bezahlt_am (timestamptz)::date in UTC bzw. current_date
--   12 Spalten-Defaults (datum u. a.)      DEFAULT CURRENT_DATE
--
-- Bewusst NICHT: demo_musterhof_* (Demo-Daten relativ zum Lauf um 05:00 Wien), s112_smoke_test.
--
-- Die Funktionen werden aus ihrer aktuellen Definition umgeschrieben (pg_get_functiondef → Ersetzung →
-- CREATE OR REPLACE): Staging und Produktion haben bei s112_pn_chargen_pflegen unterschiedliche Stände, eine
-- abgeschriebene Fassung würde einen davon zurückdrehen. CREATE OR REPLACE behält Eigentümer, Rechte (REVOKE
-- … FROM PUBLIC, anon) und SET search_path. Jede Funktion muss sich ändern, danach darf keine current_date
-- mehr enthalten – sonst bricht die Migration ab.
--
-- Rollback (nur falls nötig, ebenfalls in einer Transaktion):
--   dieselbe Schleife mit regexp_replace(v_def, '\(now\(\) AT TIME ZONE ''Europe/Vienna''\)::date', 'current_date', 'g')
--   bzw. für die beiden Casts '\((NEW\.bezahlt_am|v_m\.eingereicht_am) AT TIME ZONE ''Europe/Vienna''\)::date' → '\1::date',
--   und ALTER TABLE … ALTER COLUMN … SET DEFAULT CURRENT_DATE für die 12 Spalten
--   (in Staging erprobt: Definitionen danach bis auf Groß-/Kleinschreibung von current_date identisch).

DO $mig$
DECLARE
  c_funktionen constant regprocedure[] := ARRAY[
    'public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text)',
    'public.s112_ama_status_setzen(uuid, uuid, text, date, text)',
    'public.s112_pn_chargen_pflegen()',
    'public.get_next_liefernummer(uuid)',
    'public.get_next_transaktionsnr(uuid, text)',
    'public.check_und_increment_ki_abfrage(uuid)',
    'public.process_ea_dauerauftraege()',
    'public.sumup_tx_zu_zahlung()'
  ]::regprocedure[];
  c_wien constant text := '(now() AT TIME ZONE ''Europe/Vienna'')::date';
  v_fn  regprocedure;
  v_def text;
  v_neu text;
BEGIN
  FOREACH v_fn IN ARRAY c_funktionen LOOP
    v_def := pg_get_functiondef(v_fn);
    v_neu := regexp_replace(v_def, '\mcurrent_date\M', c_wien, 'gi');
    -- timestamptz → Datum ebenfalls in Wiener Zeit
    v_neu := replace(v_neu, 'NEW.bezahlt_am::date', '(NEW.bezahlt_am AT TIME ZONE ''Europe/Vienna'')::date');
    v_neu := replace(v_neu, 'v_m.eingereicht_am::date', '(v_m.eingereicht_am AT TIME ZONE ''Europe/Vienna'')::date');
    IF v_neu = v_def THEN
      RAISE EXCEPTION 'wiener_datum: % unverändert – Definition passt nicht zum Entwurf', v_fn;
    END IF;
    EXECUTE v_neu;
  END LOOP;

  -- Selbstprüfung: keine dieser Funktionen rechnet mehr mit current_date oder einem UTC-Cast
  IF EXISTS (SELECT 1 FROM unnest(c_funktionen) f
              WHERE pg_get_functiondef(f) ~* '\mcurrent_date\M|NEW\.bezahlt_am::date|v_m\.eingereicht_am::date') THEN
    RAISE EXCEPTION 'wiener_datum: Selbstprüfung – current_date bzw. UTC-Cast noch vorhanden';
  END IF;
END $mig$;

ALTER TABLE public.aktivitaeten           ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.bestellungen           ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.exportauftraege        ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.fuellungen             ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.keller_behandlungen    ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.konto_umbuchungen      ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.kosteneintraege        ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.release_notes          ALTER COLUMN veroeffentlicht_am     SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.saetze_massnahmen      ALTER COLUMN gueltig_ab             SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.tenant_einstellungen   ALTER COLUMN ki_abfragen_reset_datum SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.verkaufsposten         ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);
ALTER TABLE public.zahlungen              ALTER COLUMN datum                  SET DEFAULT ((now() AT TIME ZONE 'Europe/Vienna')::date);

-- Selbstprüfung: keine Funktion (außer Demo/Smoke-Test) und kein Spalten-Default in public nutzt current_date
DO $pruef$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
                AND p.proname NOT LIKE 'demo\_%' AND p.proname <> 's112_smoke_test'
                AND pg_get_functiondef(p.oid) ~* '\mcurrent_date\M') THEN
    RAISE EXCEPTION 'wiener_datum: noch eine Funktion mit current_date';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid
              WHERE c.relnamespace = 'public'::regnamespace AND pg_get_expr(d.adbin, d.adrelid) ~* '\mcurrent_date\M') THEN
    RAISE EXCEPTION 'wiener_datum: noch ein Spalten-Default mit current_date';
  END IF;
END $pruef$;
