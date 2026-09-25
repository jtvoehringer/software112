-- ════════════════════════════════════════════════════════════════════════════════════════════
-- KAN-5 · Nur-Lesen-Modus: E&A-Daueraufträge gesperrter Betriebe nicht buchen
-- Entscheidung Jörgen (25.09.2026): „EA-Daueraufträge für gesperrte Betriebe weiterbuchen? NEIN“
-- Von Jörgen freigegeben und am 25.09.2026 per apply_migration eingespielt (Name: kan5_dauerauftraege_abo_sperre).
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- WIRKUNG
--   process_ea_dauerauftraege() (täglicher Vercel-Cron /api/cron/taeglich bzw.
--   /api/cron/ea-dauerauftraege, Service-Role) überspringt Daueraufträge von Betrieben, deren Abo
--   gesperrt ist – Regel s112_abo_gesperrt() aus kan5_abo_schreibsperre (Stripe-Status gesperrt
--   oder Testphase abgelaufen; Sandbox und Demo fest ausgenommen).
--   · Es wird NICHTS geschrieben: keine ea_transaktionen, kein Log-Eintrag, naechste_faelligkeit
--     bleibt stehen (ein täglicher Log-Eintrag je Auftrag würde das Protokoll nur füllen).
--   · Nach dem Entsperren holt der Lauf die liegengebliebenen Fälligkeiten nach – wie bisher eine
--     Fälligkeit je Lauf und Dauerauftrag (bestehendes Verhalten, z. B. auch nach einem
--     Cron-Ausfall). Ein Monatsauftrag, der drei Monate gesperrt war, ist so nach drei Läufen
--     aufgeholt; eine geschlossene Periode (Monatsabschluss/UVA) wird wie bisher mit
--     „uebersprungen“ protokolliert und weitergerückt.
--   · Die Rückgabe (verarbeitet/erstellt/uebersprungen/fehler) bleibt unverändert; gesperrte
--     Aufträge zählen nicht als „verarbeitet“.
--
-- Einzige Änderung gegenüber pg_get_functiondef vom 25.09.2026 (Stand Migration 164/182): die
-- mit „KAN-5“ markierte Zeile in der Schleifenabfrage. Rumpf sonst unverändert (Zeilenenden LF
-- statt CRLF). CREATE OR REPLACE behält Owner und Rechte; die REVOKEs unten bestätigen die
-- Konvention für Cron-Funktionen (kein PUBLIC/anon/authenticated).
-- ════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.process_ea_dauerauftraege()
 RETURNS TABLE(verarbeitet integer, erstellt integer, uebersprungen integer, fehler integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r ea_dauerauftraege%ROWTYPE;
  v_neue_id      uuid;
  v_pruef        RECORD;
  v_verarbeitet  int := 0;
  v_erstellt     int := 0;
  v_uebersprungen int := 0;
  v_fehler       int := 0;
BEGIN
  FOR r IN
    SELECT * FROM ea_dauerauftraege
    WHERE aktiv = true AND naechste_faelligkeit <= CURRENT_DATE
      AND NOT public.s112_abo_gesperrt(tenant_id)   -- KAN-5 Nur-Lesen-Modus: gesperrte Betriebe nicht buchen
  LOOP
    v_verarbeitet := v_verarbeitet + 1;

    BEGIN
      -- Zeitraum offen? (weder Monatsabschluss noch übermittelte UVA)
      SELECT * INTO v_pruef FROM pruefe_ea_zeitraum_offen(r.tenant_id, r.naechste_faelligkeit);

      IF NOT v_pruef.offen THEN
        INSERT INTO ea_dauerauftrag_log (tenant_id, dauerauftrag_id, status, fehler_details)
        VALUES (r.tenant_id, r.id, 'uebersprungen', v_pruef.grund);
        v_uebersprungen := v_uebersprungen + 1;

        -- Fälligkeit trotzdem weiterrücken, sonst bleibt der Dauerauftrag für
        -- immer auf demselben (geschlossenen) Datum hängen.
        UPDATE ea_dauerauftraege SET naechste_faelligkeit =
          CASE r.intervall
            WHEN 'monatlich'        THEN r.naechste_faelligkeit + INTERVAL '1 month'
            WHEN 'vierteljaehrlich' THEN r.naechste_faelligkeit + INTERVAL '3 months'
            WHEN 'halbjaehrlich'    THEN r.naechste_faelligkeit + INTERVAL '6 months'
            WHEN 'jaehrlich'        THEN r.naechste_faelligkeit + INTERVAL '1 year'
          END
        WHERE id = r.id;

        CONTINUE;
      END IF;

      INSERT INTO ea_transaktionen (
        tenant_id, typ, datum, beschreibung, kategorie_id,
        betrag_netto, ust_satz, dauerauftrag_id, konto_id, import_quelle
      ) VALUES (
        r.tenant_id, r.typ, r.naechste_faelligkeit, r.beschreibung,
        r.kategorie_id, r.betrag_netto, r.ust_satz, r.id, r.konto_id, 'manuell'
      )
      RETURNING id INTO v_neue_id;

      UPDATE ea_dauerauftraege SET naechste_faelligkeit =
        CASE r.intervall
          WHEN 'monatlich'        THEN r.naechste_faelligkeit + INTERVAL '1 month'
          WHEN 'vierteljaehrlich' THEN r.naechste_faelligkeit + INTERVAL '3 months'
          WHEN 'halbjaehrlich'    THEN r.naechste_faelligkeit + INTERVAL '6 months'
          WHEN 'jaehrlich'        THEN r.naechste_faelligkeit + INTERVAL '1 year'
        END
      WHERE id = r.id;

      INSERT INTO ea_dauerauftrag_log (tenant_id, dauerauftrag_id, status, ea_transaktion_id)
      VALUES (r.tenant_id, r.id, 'erstellt', v_neue_id);
      v_erstellt := v_erstellt + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Ein fehlerhafter Dauerauftrag darf die anderen nicht blockieren.
      -- naechste_faelligkeit bleibt bewusst unverändert -> Retry am nächsten Lauf.
      INSERT INTO ea_dauerauftrag_log (tenant_id, dauerauftrag_id, status, fehler_details)
      VALUES (r.tenant_id, r.id, 'fehler', SQLERRM);
      v_fehler := v_fehler + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_verarbeitet, v_erstellt, v_uebersprungen, v_fehler;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.process_ea_dauerauftraege() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.process_ea_dauerauftraege() IS
  'Täglicher Cron (Service-Role): bucht fällige E&A-Daueraufträge aller Betriebe. Seit KAN-5 (25.09.2026) ohne Betriebe mit gesperrtem Abo (s112_abo_gesperrt); deren Fälligkeiten bleiben stehen und werden nach dem Entsperren nachgeholt.';

DO $pruefung$
BEGIN
  IF position('s112_abo_gesperrt' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.process_ea_dauerauftraege()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-5: Abo-Sperre in process_ea_dauerauftraege fehlt';
  END IF;
  IF has_function_privilege('anon', 'public.process_ea_dauerauftraege()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.process_ea_dauerauftraege()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.process_ea_dauerauftraege()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-5: Rechte von process_ea_dauerauftraege nicht wie erwartet';
  END IF;
END
$pruefung$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ANHANG – Test (rollt am Ende per RAISE EXCEPTION alles zurück; Ergebnis in der Fehlermeldung)
-- Zwei Fake-Betriebe mit je einem fälligen Dauerauftrag: A gesperrt ('unpaid'), B offen.
-- ════════════════════════════════════════════════════════════════════════════════════════════
/*
DO $test$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_da_a uuid; v_da_b uuid;
  v_n int; v_d date; v_erg text[] := ARRAY[]::text[];
  v_heute date := CURRENT_DATE;
BEGIN
  INSERT INTO public.tenants (id, name, slug, stripe_status) VALUES
    (v_a, 'KAN-5 DA gesperrt', 'kan5-da-a-' || left(v_a::text, 8), 'unpaid'),
    (v_b, 'KAN-5 DA offen',    'kan5-da-b-' || left(v_b::text, 8), 'active');
  INSERT INTO public.ea_dauerauftraege (tenant_id, typ, beschreibung, betrag_netto, ust_satz, intervall, naechste_faelligkeit)
       VALUES (v_a, 'ausgabe', 'KAN5-DA-A', 100, 20, 'monatlich', v_heute - 40) RETURNING id INTO v_da_a;
  INSERT INTO public.ea_dauerauftraege (tenant_id, typ, beschreibung, betrag_netto, ust_satz, intervall, naechste_faelligkeit)
       VALUES (v_b, 'ausgabe', 'KAN5-DA-B', 100, 20, 'monatlich', v_heute - 40) RETURNING id INTO v_da_b;

  PERFORM * FROM public.process_ea_dauerauftraege();   -- Lauf 1 (A gesperrt)

  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE dauerauftrag_id = v_da_a;
  v_erg := v_erg || format('%s T1 gesperrter Betrieb: %s Buchung(en), erwartet 0', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
  SELECT count(*) INTO v_n FROM public.ea_dauerauftrag_log WHERE dauerauftrag_id = v_da_a;
  v_erg := v_erg || format('%s T2 gesperrter Betrieb: %s Log-Eintrag/-Einträge, erwartet 0', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
  SELECT naechste_faelligkeit INTO v_d FROM public.ea_dauerauftraege WHERE id = v_da_a;
  v_erg := v_erg || format('%s T3 gesperrter Betrieb: Fälligkeit %s, erwartet unverändert %s', CASE WHEN v_d = v_heute - 40 THEN 'OK    ' ELSE 'FEHLER' END, v_d, v_heute - 40);
  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE dauerauftrag_id = v_da_b;
  v_erg := v_erg || format('%s T4 offener Betrieb: %s Buchung(en), erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
  SELECT naechste_faelligkeit INTO v_d FROM public.ea_dauerauftraege WHERE id = v_da_b;
  v_erg := v_erg || format('%s T5 offener Betrieb: Fälligkeit %s, erwartet %s', CASE WHEN v_d = (v_heute - 40 + INTERVAL '1 month')::date THEN 'OK    ' ELSE 'FEHLER' END, v_d, (v_heute - 40 + INTERVAL '1 month')::date);

  UPDATE public.tenants SET stripe_status = 'active' WHERE id = v_a;   -- entsperrt
  PERFORM * FROM public.process_ea_dauerauftraege();   -- Lauf 2
  PERFORM * FROM public.process_ea_dauerauftraege();   -- Lauf 3

  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE dauerauftrag_id = v_da_a;
  v_erg := v_erg || format('%s T6 nach dem Entsperren nachgeholt: %s Buchung(en) nach zwei Läufen, erwartet 2 (Fälligkeiten −40 und −10 Tage)', CASE WHEN v_n = 2 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE dauerauftrag_id = v_da_b;
  v_erg := v_erg || format('%s T7 offener Betrieb: %s Buchung(en) nach drei Läufen, erwartet 2 (die dritte Fälligkeit liegt in der Zukunft)', CASE WHEN v_n = 2 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
  SELECT count(*) INTO v_n FROM public.ea_dauerauftrag_log WHERE dauerauftrag_id IN (v_da_a, v_da_b) AND status = 'fehler';
  v_erg := v_erg || format('%s T8 keine Fehler-Log-Einträge: %s', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

  RAISE EXCEPTION 'KAN5-DA-Testergebnis (alles zurückgerollt):%', E'\n' || array_to_string(v_erg, E'\n');
END
$test$;
*/
