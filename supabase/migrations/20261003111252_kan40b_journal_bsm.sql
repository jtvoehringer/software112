-- KAN-40 Etappe E2 (Entwurf 03.10.2026): Status Most/Sturm im Bewegungsjournal und Rückbefüllung (Musterhof/Sandbox)
--
-- Die BSM liest ab E2 aus kellerbuch_buchungen (src/lib/behoerden/bsm.ts, berechneBsmAusJournal). Dafür fehlt dem
-- Journal ein Merkmal: der Status der Charge zum Buchungszeitpunkt (Ernte/Gärung = Most/Sturm, BSM-Nachtrag 4).
--
--  1. kellerbuch_buchungen += charge_status (Momentaufnahme weinausbau.status; Flaschen: NULL).
--  2. s112_journal_merkmale/_schreiben/_gegenbuchen führen charge_status mit. rekonstruiert ist zusätzlich gesetzt, solange
--     das transaktionslokale Kennzeichen s112.journal_rekonstruktion = 'an' ist (nur journal_rueckbefuellen).
--  3. s112_journal_umstufung: Umstufungspaar AB_ABW/ZU_ABW auch, wenn die Charge von Most/Sturm (Status Ernte/Gärung) in
--     einen anderen Status wechselt oder zurück – die BSM bucht ein solches Paar als neutrale Umstufung UMST_MOST.
--     Der Trigger y_journal auf weinausbau reagiert dafür zusätzlich auf status.
--  3b. Flaschen-Anfangsbestand mit negativer Menge bucht SCHWUND statt EROEFF (BSM-Nachtrag 7).
--  4. journal_rueckbefuellen(p_tenant_id, p_ab): rekonstruiert das Journal eines Testbetriebs rückwirkend aus den
--     Bewegungstabellen (Entscheidung Jörgen 02.10.2026: nur Musterhof und Sandbox; Gebeshuber/Spaetrot beginnen am
--     01.01.2027 mit journal_eroeffnen). Nur Service-Role bzw. SQL-Editor (kein EXECUTE für API-Rollen), nur für die
--     beiden Testbetriebe, nur bei leerem Journal. Spielt jede Bewegung in Datumsreihenfolge über s112_journal_vorgang ein
--     (Storno als Gegenbuchung am Storno-Tag), bucht danach Restabweichungen per journal_abgleichen (Mindestalter 0) und
--     liefert die Zahl der Zeilen und der verbleibenden Abweichungen. Merkmale = heutige Stammdaten (rekonstruiert = true).
--     Musterhof: Journal vorerst aus (Jörgen 03.10.2026) – dort nur zurückgerollt testen.
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

-- 1. Spalte ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.kellerbuch_buchungen ADD COLUMN charge_status text;
COMMENT ON COLUMN public.kellerbuch_buchungen.charge_status IS
  'KAN-40 E2: Status der Charge zum Buchungszeitpunkt (Ernte/Gärung = Most/Sturm in der BSM); Flaschen: NULL';

-- 2. Merkmale, Schreiben, Gegenbuchen ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_journal_merkmale(p_bestand text, p_zeile jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_bestand = 'offen' THEN jsonb_build_object(
           'charge_name', p_zeile ->> 'name', 'behaelter_id', p_zeile ->> 'behaelter_id',
           'erzeugnis', p_zeile ->> 'erzeugnis', 'qualitaetsstufe', p_zeile ->> 'qualitaetsstufe',
           'zusatzbezeichnung', p_zeile ->> 'zusatzbezeichnung', 'weinart', p_zeile ->> 'weinart',
           'herkunft_code', p_zeile ->> 'herkunft_code', 'land_iso', p_zeile ->> 'land_iso',
           'rebsorte', p_zeile ->> 'rebsorte', 'jahrgang', p_zeile ->> 'jahrgang', 'charge_status', p_zeile ->> 'status')
         ELSE jsonb_build_object(
           'fuellung_name', p_zeile ->> 'name', 'flaschengroesse_ml', p_zeile ->> 'flaschengroesse_ml',
           'erzeugnis', p_zeile ->> 'erzeugnis', 'qualitaetsstufe', p_zeile ->> 'qualitaet',
           'zusatzbezeichnung', p_zeile ->> 'zusatzbezeichnung', 'weinart', p_zeile ->> 'weinart',
           'herkunft_code', p_zeile ->> 'herkunft_code', 'land_iso', p_zeile ->> 'land_iso',
           'rebsorte', p_zeile ->> 'rebsorte', 'jahrgang', p_zeile ->> 'jahrgang') END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_merkmale(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_journal_schreiben(p_tenant_id uuid, p_beleg integer, p_datum date, p_z jsonb,
  p_quelle_tabelle text, p_quelle_id uuid, p_gruppe uuid, p_rekonstruiert boolean, p_hinweis text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bestand text := coalesce(p_z ->> 'bestand', 'offen');
  v_m       jsonb := p_z -> 'merkmale';
  v_zeile   jsonb;
  v_pos     integer;
  v_id      uuid;
BEGIN
  IF v_m IS NULL OR jsonb_typeof(v_m) <> 'object' THEN
    IF v_bestand = 'offen' THEN
      SELECT to_jsonb(w) INTO v_zeile FROM public.weinausbau w WHERE w.id = (p_z ->> 'weinausbau_id')::uuid AND w.tenant_id = p_tenant_id;
    ELSE
      SELECT to_jsonb(f) INTO v_zeile FROM public.fuellungen f WHERE f.id = (p_z ->> 'fuellung_id')::uuid AND f.tenant_id = p_tenant_id;
    END IF;
    v_m := public.s112_journal_merkmale(v_bestand, coalesce(v_zeile, '{}'::jsonb));
  END IF;
  SELECT coalesce(max(k.pos), 0) + 1 INTO v_pos FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id AND k.beleg_nr = p_beleg;

  PERFORM set_config('s112.journal_schreiben', 'an', true);
  INSERT INTO public.kellerbuch_buchungen (tenant_id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id,
    behaelter_id, zukauf_posten_id, gegen_weinausbau_id, menge_liter, menge_stk, menge_kg, partner_name, partner_land,
    quelle_tabelle, quelle_id, gruppe_id, rekonstruiert, charge_name, fuellung_name, flaschengroesse_ml, erzeugnis,
    qualitaetsstufe, zusatzbezeichnung, weinart, herkunft_code, land_iso, rebsorte, jahrgang, charge_status, hinweis)
  VALUES (p_tenant_id, p_beleg, v_pos, p_datum, p_z ->> 'code', v_bestand, (p_z ->> 'weinausbau_id')::uuid, (p_z ->> 'fuellung_id')::uuid,
    (v_m ->> 'behaelter_id')::uuid, (p_z ->> 'zukauf_posten_id')::uuid, (p_z ->> 'gegen_weinausbau_id')::uuid,
    round(coalesce((p_z ->> 'liter')::numeric, 0), 3), coalesce((p_z ->> 'stk')::integer, 0), round((p_z ->> 'kg')::numeric, 2),
    NULLIF(p_z ->> 'partner_name', ''), NULLIF(p_z ->> 'partner_land', ''),
    p_quelle_tabelle, p_quelle_id, p_gruppe,
    coalesce(p_rekonstruiert, false) OR coalesce(current_setting('s112.journal_rekonstruktion', true), '') = 'an',
    v_m ->> 'charge_name', v_m ->> 'fuellung_name', (v_m ->> 'flaschengroesse_ml')::integer, v_m ->> 'erzeugnis',
    v_m ->> 'qualitaetsstufe', v_m ->> 'zusatzbezeichnung', v_m ->> 'weinart', v_m ->> 'herkunft_code', v_m ->> 'land_iso',
    v_m ->> 'rebsorte', (v_m ->> 'jahrgang')::integer, v_m ->> 'charge_status',
    NULLIF(concat_ws(' · ', NULLIF(p_z ->> 'hinweis', ''), NULLIF(p_hinweis, '')), ''))
  RETURNING id INTO v_id;
  PERFORM set_config('s112.journal_schreiben', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_schreiben(uuid, integer, date, jsonb, text, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_journal_gegenbuchen(p_tenant_id uuid, p_beleg integer, p_datum date,
  p_quelle_tabelle text, p_quelle_id uuid, p_hinweis text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  v_n   integer := 0;
  v_pos integer;
  v_rek boolean := coalesce(current_setting('s112.journal_rekonstruktion', true), '') = 'an';
BEGIN
  SELECT coalesce(max(k.pos), 0) INTO v_pos FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id AND k.beleg_nr = p_beleg;
  PERFORM set_config('s112.journal_schreiben', 'an', true);
  FOR r IN
    SELECT k.* FROM public.kellerbuch_buchungen k
     WHERE k.tenant_id = p_tenant_id AND k.quelle_tabelle = p_quelle_tabelle AND k.quelle_id = p_quelle_id
       AND k.storno_von_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id)
     ORDER BY k.beleg_nr, k.pos
  LOOP
    v_pos := v_pos + 1;
    INSERT INTO public.kellerbuch_buchungen (tenant_id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id,
      behaelter_id, zukauf_posten_id, gegen_weinausbau_id, menge_liter, menge_stk, menge_kg, partner_name, partner_land,
      quelle_tabelle, quelle_id, gruppe_id, storno_von_id, rekonstruiert, charge_name, fuellung_name, flaschengroesse_ml, erzeugnis,
      qualitaetsstufe, zusatzbezeichnung, weinart, herkunft_code, land_iso, rebsorte, jahrgang, charge_status, hinweis)
    VALUES (r.tenant_id, p_beleg, v_pos, p_datum, r.buchungsart_code, r.bestand, r.weinausbau_id, r.fuellung_id,
      r.behaelter_id, r.zukauf_posten_id, r.gegen_weinausbau_id, -r.menge_liter, -r.menge_stk, -r.menge_kg, r.partner_name, r.partner_land,
      r.quelle_tabelle, r.quelle_id, r.gruppe_id, r.id, v_rek, r.charge_name, r.fuellung_name, r.flaschengroesse_ml, r.erzeugnis,
      r.qualitaetsstufe, r.zusatzbezeichnung, r.weinart, r.herkunft_code, r.land_iso, r.rebsorte, r.jahrgang, r.charge_status,
      concat_ws(' · ', p_hinweis, format('zu Beleg %s/%s vom %s', r.beleg_nr, r.pos, to_char(r.datum, 'DD.MM.YYYY'))));
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('s112.journal_schreiben', '', true);
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_gegenbuchen(uuid, integer, date, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- 3. Umstufung inkl. Most/Sturm ↔ Wein ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_journal_umstufung(p_tenant_id uuid, p_bestand text, p_id uuid, p_alt jsonb, p_neu jsonb,
  p_ohne_quelle text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab     date := public.s112_journal_ab(p_tenant_id);
  v_l      numeric;
  v_stk    integer;
  v_beleg  integer;
  v_tag    date;
  v_tab    text := CASE WHEN p_bestand = 'offen' THEN 'weinausbau_merkmale' ELSE 'fuellungen_merkmale' END;
  v_bez    text;
  v_most_a boolean := coalesce(p_alt ->> 'charge_status', '') IN ('ernte', 'gaerung');
  v_most_n boolean := coalesce(p_neu ->> 'charge_status', '') IN ('ernte', 'gaerung');
BEGIN
  IF v_ab IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  IF (p_alt ->> 'erzeugnis', p_alt ->> 'qualitaetsstufe', p_alt ->> 'zusatzbezeichnung', v_most_a)
     IS NOT DISTINCT FROM (p_neu ->> 'erzeugnis', p_neu ->> 'qualitaetsstufe', p_neu ->> 'zusatzbezeichnung', v_most_n) THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  SELECT coalesce(sum(k.menge_liter), 0), coalesce(sum(k.menge_stk), 0) INTO v_l, v_stk
    FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.bestand = p_bestand
     AND (CASE WHEN p_bestand = 'offen' THEN k.weinausbau_id ELSE k.fuellung_id END) = p_id
     AND NOT (p_ohne_quelle IS NOT NULL AND k.quelle_tabelle = p_ohne_quelle AND k.quelle_id = p_id AND k.storno_von_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id));
  IF (p_bestand = 'offen' AND abs(v_l) < 0.0005) OR (p_bestand = 'flasche' AND v_stk = 0) THEN
    RETURN;
  END IF;
  v_tag := greatest((now() AT TIME ZONE 'Europe/Vienna')::date, v_ab);
  v_beleg := public.s112_journal_beleg(p_tenant_id, NULL);
  v_bez := concat_ws(' · ',
    CASE WHEN (p_alt ->> 'erzeugnis', p_alt ->> 'qualitaetsstufe', p_alt ->> 'zusatzbezeichnung')
              IS DISTINCT FROM (p_neu ->> 'erzeugnis', p_neu ->> 'qualitaetsstufe', p_neu ->> 'zusatzbezeichnung')
         THEN format('Umstufung: %s → %s',
           concat_ws(' / ', coalesce(p_alt ->> 'qualitaetsstufe', '–'), p_alt ->> 'zusatzbezeichnung', p_alt ->> 'erzeugnis'),
           concat_ws(' / ', coalesce(p_neu ->> 'qualitaetsstufe', '–'), p_neu ->> 'zusatzbezeichnung', p_neu ->> 'erzeugnis')) END,
    CASE WHEN v_most_a AND NOT v_most_n THEN format('Most/Sturm wird Wein (Status %s → %s)', p_alt ->> 'charge_status', coalesce(p_neu ->> 'charge_status', '–'))
         WHEN v_most_n AND NOT v_most_a THEN format('Wein zurück zu Most/Sturm (Status %s → %s)', coalesce(p_alt ->> 'charge_status', '–'), p_neu ->> 'charge_status') END);
  PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
    jsonb_build_object('code', 'AB_ABW', 'bestand', p_bestand,
      CASE WHEN p_bestand = 'offen' THEN 'weinausbau_id' ELSE 'fuellung_id' END, p_id, 'liter', -v_l, 'stk', -v_stk, 'merkmale', p_alt),
    v_tab, p_id, p_id, false, v_bez);
  PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
    jsonb_build_object('code', 'ZU_ABW', 'bestand', p_bestand,
      CASE WHEN p_bestand = 'offen' THEN 'weinausbau_id' ELSE 'fuellung_id' END, p_id, 'liter', v_l, 'stk', v_stk, 'merkmale', p_neu),
    v_tab, p_id, p_id, false, v_bez);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_umstufung(uuid, text, uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

DROP TRIGGER y_journal ON public.weinausbau;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF ist_eroeffnungsbestand, anfangsbestand_liter, storniert_am,
  qualitaetsstufe, zusatzbezeichnung, erzeugnis, status ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_charge();

-- 3b. Flaschen-„Anfangsbestand (Altbestand, ±)“ mit negativer Menge = Abgang (BSM-Nachtrag 7, Jörgen 02.10.2026) ──────
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_flaschenbuchung(fb jsonb, p_ml integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stk  integer := coalesce((fb ->> 'menge_stk')::integer, 0);
  v_art  text := fb ->> 'art';
  v_code text;
BEGIN
  IF v_stk = 0 OR v_art IN ('verkauf', 'verkauf_storno') THEN
    RETURN '[]'::jsonb;
  END IF;
  v_code := CASE
    WHEN v_art IN ('bruch', 'eigenverbrauch', 'schwund') THEN 'SCHWUND'
    WHEN v_art = 'anfangsbestand' AND v_stk < 0 THEN 'SCHWUND'
    WHEN v_art = 'anfangsbestand' THEN 'EROEFF'
    WHEN v_stk > 0 THEN 'INV_PLUS'
    ELSE 'INV_MIN' END;
  RETURN jsonb_build_array(jsonb_build_object('code', v_code, 'bestand', 'flasche', 'fuellung_id', fb ->> 'fuellung_id', 'stk', v_stk,
    'liter', round(v_stk * coalesce(NULLIF(p_ml, 0), 750) / 1000.0, 3),
    'hinweis', concat_ws(': ', initcap(v_art), NULLIF(fb ->> 'grund', ''))
      || CASE WHEN v_art = 'anfangsbestand' AND v_stk < 0 THEN ' · Altbestand-Korrektur (−): Abgang' ELSE '' END));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_flaschenbuchung(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- 4. Rückbefüllung (nur Testbetriebe) ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.journal_rueckbefuellen(p_tenant_id uuid, p_ab date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab      date;
  v_heute   date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  e         record;
  v_stand   jsonb;
  v_storno  jsonb;
  v_vp      jsonb;
  v_n       integer := 0;
  v_korr    integer;
  v_abw     integer;
  v_zeilen  integer;
BEGIN
  -- Entscheidung Jörgen 02.10.2026: rückwirkend nur Musterhof (Demo) und Sandbox
  IF p_tenant_id IS NULL OR p_tenant_id NOT IN ('33333333-3333-4333-8333-333333333333'::uuid, 'fa22dc07-eca5-43df-af96-f7b9b09f0471'::uuid) THEN
    RAISE EXCEPTION 'Rückbefüllung nur für Musterhof und Sandbox – andere Betriebe beginnen mit journal_eroeffnen.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.tenant_einstellungen t WHERE t.tenant_id = p_tenant_id AND t.journal_ab IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Das Bewegungsjournal dieses Betriebs ist bereits eröffnet bzw. nicht leer.' USING ERRCODE = '55000';
  END IF;

  -- Ereignisse: Buchung am Buchungstag, Storno am Storno-Tag; Reihenfolge Datum, Art, Anlage
  CREATE TEMP TABLE IF NOT EXISTS s112_rb_ereignis (datum date, rang int, art text, id uuid, gruppe uuid, storno boolean, angelegt timestamptz) ON COMMIT DROP;
  TRUNCATE s112_rb_ereignis;
  INSERT INTO s112_rb_ereignis
    SELECT (w.created_at AT TIME ZONE 'Europe/Vienna')::date, 1, 'weinausbau', w.id, w.id, false, w.created_at
      FROM public.weinausbau w WHERE w.tenant_id = p_tenant_id AND coalesce(w.ist_eroeffnungsbestand, false)
    UNION ALL SELECT coalesce(p.datum, (p.erstellt_am AT TIME ZONE 'Europe/Vienna')::date), 2, 'pressung_behaelter', pb.id, pb.pressung_id, false, p.erstellt_am
      FROM public.pressung_behaelter pb JOIN public.pressungen p ON p.id = pb.pressung_id WHERE p.tenant_id = p_tenant_id
    UNION ALL SELECT coalesce(z.datum, (z.erstellt_am AT TIME ZONE 'Europe/Vienna')::date), 3, 'zukauf_posten', z.id, z.id, false, z.erstellt_am
      FROM public.zukauf_posten z WHERE z.tenant_id = p_tenant_id AND (z.aktiv OR z.storniert_am IS NOT NULL)
    UNION ALL SELECT coalesce(u.datum, (u.erstellt_am AT TIME ZONE 'Europe/Vienna')::date), 4, 'keller_umzuege', u.id, coalesce(u.umzug_batch_id, u.id), false, u.erstellt_am
      FROM public.keller_umzuege u WHERE u.tenant_id = p_tenant_id
    UNION ALL SELECT coalesce(v.datum, (v.created_at AT TIME ZONE 'Europe/Vienna')::date), 5, 'verschneidung_quellen', q.id, q.verschneidung_id, false, v.created_at
      FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id WHERE v.tenant_id = p_tenant_id
    UNION ALL SELECT coalesce(f.datum, (f.erstellt_am AT TIME ZONE 'Europe/Vienna')::date), 6, 'fuellungen', f.id, f.id, false, f.erstellt_am
      FROM public.fuellungen f WHERE f.tenant_id = p_tenant_id
    UNION ALL SELECT coalesce(b.datum, (b.erstellt_am AT TIME ZONE 'Europe/Vienna')::date), 7, 'fuellung_bewegungen', b.id, b.id, false, b.erstellt_am
      FROM public.fuellung_bewegungen b WHERE b.tenant_id = p_tenant_id
    UNION ALL SELECT coalesce(vp.datum, (vp.erstellt_am AT TIME ZONE 'Europe/Vienna')::date), 8, 'verkauf_positionen', p.id, p.verkaufsposten_id, false, vp.erstellt_am
      FROM public.verkauf_positionen p JOIN public.verkaufsposten vp ON vp.id = p.verkaufsposten_id AND vp.tenant_id = p.tenant_id
     WHERE p.tenant_id = p_tenant_id;
  -- Stornos (Gegenbuchung am Storno-Tag)
  INSERT INTO s112_rb_ereignis
    SELECT greatest(x.datum, st.tag), 9, x.art, x.id, x.gruppe, true, x.angelegt
      FROM s112_rb_ereignis x
      JOIN LATERAL (
        SELECT CASE x.art
          WHEN 'weinausbau' THEN (SELECT (w.storniert_am AT TIME ZONE 'Europe/Vienna')::date FROM public.weinausbau w WHERE w.id = x.id)
          WHEN 'pressung_behaelter' THEN (SELECT (coalesce(pb.storniert_am, p.storniert_am) AT TIME ZONE 'Europe/Vienna')::date
                                            FROM public.pressung_behaelter pb JOIN public.pressungen p ON p.id = pb.pressung_id WHERE pb.id = x.id)
          WHEN 'zukauf_posten' THEN (SELECT coalesce((z.storniert_am AT TIME ZONE 'Europe/Vienna')::date, x.datum)
                                       FROM public.zukauf_posten z WHERE z.id = x.id AND (z.storniert_am IS NOT NULL OR NOT z.aktiv))
          WHEN 'keller_umzuege' THEN (SELECT (u.storniert_am AT TIME ZONE 'Europe/Vienna')::date FROM public.keller_umzuege u WHERE u.id = x.id)
          WHEN 'verschneidung_quellen' THEN (SELECT (v.storniert_am AT TIME ZONE 'Europe/Vienna')::date
                                               FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id WHERE q.id = x.id)
          WHEN 'fuellungen' THEN (SELECT (f.storniert_am AT TIME ZONE 'Europe/Vienna')::date FROM public.fuellungen f WHERE f.id = x.id)
          WHEN 'verkauf_positionen' THEN (SELECT (coalesce(vp.storniert_am, now()) AT TIME ZONE 'Europe/Vienna')::date
                                            FROM public.verkauf_positionen p JOIN public.verkaufsposten vp ON vp.id = p.verkaufsposten_id
                                           WHERE p.id = x.id AND vp.storniert)
        END AS tag) st ON st.tag IS NOT NULL
     WHERE NOT x.storno;

  SELECT coalesce(p_ab, min(x.datum), v_heute) INTO v_ab FROM s112_rb_ereignis x;
  IF v_ab > v_heute THEN
    RAISE EXCEPTION 'Journalbeginn % liegt in der Zukunft.', to_char(v_ab, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  UPDATE public.tenant_einstellungen SET journal_ab = v_ab WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betrieb nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('s112.journal_rekonstruktion', 'an', true);

  FOR e IN SELECT * FROM s112_rb_ereignis ORDER BY datum, CASE WHEN storno THEN 1 ELSE 0 END, rang, angelegt, id LOOP
    -- Stand der Quelle als wirksame Buchung (wie die Trigger), Storno-Stand = derselbe Stand, nicht wirksam
    IF e.art = 'weinausbau' THEN
      SELECT jsonb_build_object('wirksam', true, 'datum', e.datum,
               'zeilen', CASE WHEN coalesce(w.anfangsbestand_liter, w.menge_liter, 0) > 0
                              THEN jsonb_build_array(jsonb_build_object('code', 'EROEFF', 'bestand', 'offen', 'weinausbau_id', w.id,
                                     'liter', coalesce(w.anfangsbestand_liter, w.menge_liter, 0), 'hinweis', 'Eröffnungsbestand (Altsystem)'))
                              ELSE '[]'::jsonb END)
        INTO v_stand FROM public.weinausbau w WHERE w.id = e.id;
    ELSIF e.art = 'pressung_behaelter' THEN
      SELECT public.s112_journal_pressung_stand(to_jsonb(pb) || jsonb_build_object('storniert_am', NULL), p.datum, false)
        INTO v_stand FROM public.pressung_behaelter pb JOIN public.pressungen p ON p.id = pb.pressung_id WHERE pb.id = e.id;
    ELSIF e.art = 'zukauf_posten' THEN
      SELECT jsonb_build_object('wirksam', true, 'datum', e.datum,
               'zeilen', public.s112_journal_zeilen_zukauf(to_jsonb(z),
                 public.s112_journal_partner(z.partner_daten, 'lieferant_firma', 'lieferant_kontakt', z.lieferant_firma_id, z.lieferant_kontakt_id)))
        INTO v_stand FROM public.zukauf_posten z WHERE z.id = e.id;
    ELSIF e.art = 'keller_umzuege' THEN
      SELECT jsonb_build_object('wirksam', true, 'datum', e.datum, 'zeilen', public.s112_journal_zeilen_umzug(to_jsonb(u)))
        INTO v_stand FROM public.keller_umzuege u WHERE u.id = e.id;
    ELSIF e.art = 'verschneidung_quellen' THEN
      SELECT jsonb_build_object('wirksam', true, 'datum', e.datum, 'zeilen', public.s112_journal_zeilen_verschnitt(to_jsonb(q), v.ziel_weinausbau_id))
        INTO v_stand FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id WHERE q.id = e.id;
    ELSIF e.art = 'fuellungen' THEN
      SELECT jsonb_build_object('wirksam', true, 'datum', e.datum, 'zeilen', public.s112_journal_zeilen_fuellung(to_jsonb(f)))
        INTO v_stand FROM public.fuellungen f WHERE f.id = e.id;
    ELSIF e.art = 'fuellung_bewegungen' THEN
      SELECT jsonb_build_object('wirksam', true, 'datum', e.datum,
               'zeilen', public.s112_journal_zeilen_flaschenbuchung(to_jsonb(b), f.flaschengroesse_ml))
        INTO v_stand FROM public.fuellung_bewegungen b LEFT JOIN public.fuellungen f ON f.id = b.fuellung_id AND f.tenant_id = b.tenant_id
       WHERE b.id = e.id;
    ELSE   -- verkauf_positionen
      SELECT to_jsonb(vp) || jsonb_build_object('storniert', false) INTO v_vp
        FROM public.verkauf_positionen p JOIN public.verkaufsposten vp ON vp.id = p.verkaufsposten_id WHERE p.id = e.id;
      SELECT public.s112_journal_verkauf_stand(to_jsonb(p), v_vp) INTO v_stand FROM public.verkauf_positionen p WHERE p.id = e.id;
    END IF;
    v_stand := jsonb_set(coalesce(v_stand, '{"zeilen": []}'::jsonb), '{datum}', to_jsonb(e.datum));
    v_stand := jsonb_set(v_stand, '{wirksam}', 'true'::jsonb);

    IF e.storno THEN
      v_storno := jsonb_set(v_stand, '{wirksam}', 'false'::jsonb);
      PERFORM public.s112_journal_vorgang(p_tenant_id, e.art, e.id, e.gruppe, v_stand, v_storno, e.datum);
    ELSE
      PERFORM public.s112_journal_vorgang(p_tenant_id, e.art, e.id, e.gruppe, NULL, v_stand, NULL);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- Restabweichungen (direkte Mengenänderungen ohne Bewegung, Schwund ohne Bestandsminderung …) als Korrektur
  v_korr := public.journal_abgleichen(p_tenant_id, interval '0');
  PERFORM set_config('s112.journal_rekonstruktion', '', true);
  SELECT count(*) INTO v_abw FROM public.s112_journal_abweichungen(p_tenant_id);
  SELECT count(*) INTO v_zeilen FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id;
  RETURN jsonb_build_object('journal_ab', v_ab, 'ereignisse', v_n, 'zeilen', v_zeilen, 'korrekturen', v_korr, 'abweichungen', v_abw);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.journal_rueckbefuellen(uuid, date) FROM PUBLIC, anon, authenticated;