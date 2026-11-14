-- KAN-453 G3b (14.11.2026, Plan freigegeben von Jörgen, Fragen 1–7 A): Storno einer Gutschrift.
--
-- Bisher ließ sich eine Gutschrift (KAN-419) nicht stornieren – ein Tippfehler blieb für immer stehen, und die Rechnung
-- war nicht mehr stornierbar. Neu: s112_gutschrift_stornieren legt wie bei der Rechnung (KAN-379) einen Stornobeleg an
-- (art 'storno', ST-Nummer, storno_von_id → Gutschrift) am Storno-Datum:
--   * die Gutschrift bleibt in ihrem Zeitraum wirksam, der Stornobeleg hebt sie in seinem auf (positive Beträge). Dazu
--     trägt die stornierte Gutschrift ihre Zeilen mit negativer Menge in storno_positionen – alle Leser des Stornobelegs
--     (−1 × Momentaufnahme des Originals) rechnen damit ohne Sonderfall richtig
--   * Restmengen und Restbetrag der Rechnung werden wieder frei (stornierte Gutschriften zählen nicht mehr), „bezahlt“ wird
--     neu berechnet; die Rechnung ist nach dem Storno ihrer letzten Gutschrift wieder stornierbar (7 A)
--   * eine Rücknahme in den Bestand (KAN-452) wird am Storno-Datum zurückgebucht: Flaschen als fuellung_bewegungen art
--     'ruecknahme_storno' (Abgang, Journal in der Buchungsart des Verkaufs), Produkte als 'storno' der Rücknahme-Bewegung.
--     Reicht der Bestand nicht (Ware wieder verkauft bzw. reserviert), wird der Storno abgelehnt (3 A); ebenso bei
--     Flaschen mit Storno-Datum im abgeschlossenen Kellerbuch-Zeitraum
-- Die Sperre „Gutschrift mit Rückzahlung“ (4 A) kommt mit der Rückzahlung selbst (G3c).

-- 1. Auch eine Gutschrift kann storniert sein ───────────────────────────────────────────────────────────────────
ALTER TABLE public.rechnungen
  DROP CONSTRAINT rechnungen_stornobeleg_endgueltig,
  ADD CONSTRAINT rechnungen_stornobeleg_endgueltig CHECK (art IN ('rechnung', 'gutschrift') OR (NOT storniert AND storniert_durch_id IS NULL));

-- 2. Flaschen: Gegenbewegung zur Rücknahme ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellung_bewegungen
  DROP CONSTRAINT fuellung_bewegungen_art_check,
  DROP CONSTRAINT fuellung_bewegungen_verkauf_check,
  DROP CONSTRAINT fuellung_bewegungen_abgang_check,
  DROP CONSTRAINT fuellung_bewegungen_gutschrift_check,
  ADD CONSTRAINT fuellung_bewegungen_art_check CHECK (art IN ('inventur', 'bruch', 'eigenverbrauch', 'schwund', 'korrektur',
    'anfangsbestand', 'verkauf', 'verkauf_storno', 'ruecknahme', 'ruecknahme_storno')),
  ADD CONSTRAINT fuellung_bewegungen_verkauf_check CHECK (
    (art IN ('verkauf', 'verkauf_storno', 'ruecknahme', 'ruecknahme_storno')) = (verkaufsposten_id IS NOT NULL)),
  ADD CONSTRAINT fuellung_bewegungen_abgang_check CHECK (
    art NOT IN ('bruch', 'eigenverbrauch', 'schwund', 'verkauf', 'ruecknahme_storno') OR menge_stk < 0),
  ADD CONSTRAINT fuellung_bewegungen_gutschrift_check CHECK ((art IN ('ruecknahme', 'ruecknahme_storno')) = (gutschrift_id IS NOT NULL));
-- je Rücknahme höchstens eine Gegenbewegung (eine Gutschrift wird nur einmal storniert)
CREATE UNIQUE INDEX fuellung_bewegungen_ruecknahme_storno_einmal ON public.fuellung_bewegungen (gutschrift_id, fuellung_id, verkaufsposten_id)
  WHERE art = 'ruecknahme_storno';

-- 3.–7. Kleine Eingriffe in bestehende Funktionen – als Textersatz in der gültigen Definition (der Anker muss genau
-- einmal vorkommen, sonst bricht die Migration ab; Rechte, Sicherheit und search_path bleiben, wie sie sind):
--   3  Journal: 'ruecknahme_storno' bucht wie die Rücknahme in der Buchungsart des Verkaufs (negative Stückzahl = Abgang)
--   4  s112_gutschrift_summe: stornierte Gutschriften zählen nicht mehr (Restbetrag, „bezahlt“-Abgleich)
--   5  s112_gutschrift_anlegen: … und geben ihre Restmengen wieder frei
--   6  s112_stornobeleg_anlegen: Rechnung nach dem Storno ihrer letzten Gutschrift wieder stornierbar; eigene Meldung
--   7  berechne_ea_uva (Doppik): Stornobeleg zu einer Gutschrift, Steuerfall freier Zeilen über die berichtigte Rechnung
DO $eingriffe$
DECLARE
  c_e CONSTANT text[][] := ARRAY[
    ARRAY['3', 'public.s112_journal_zeilen_flaschenbuchung(jsonb, integer)',
      $alt$  IF v_art = 'ruecknahme' THEN$alt$,
      $neu$  IF v_art IN ('ruecknahme', 'ruecknahme_storno') THEN   -- KAN-453: Storno der Rücknahme = Abgang in derselben Buchungsart$neu$],
    ARRAY['4', 'public.s112_gutschrift_summe(uuid, uuid)',
      $alt$AND g.art = 'gutschrift' AND g.aktiv$alt$,
      $neu$AND g.art = 'gutschrift' AND g.aktiv AND NOT g.storniert$neu$],
    ARRAY['5', 'public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)',
      $alt$WHERE g.tenant_id = p_tenant_id AND g.gutschrift_zu_id = v_r.id AND g.art = 'gutschrift' AND g.aktiv$alt$,
      $neu$WHERE g.tenant_id = p_tenant_id AND g.gutschrift_zu_id = v_r.id AND g.art = 'gutschrift' AND g.aktiv AND NOT g.storniert$neu$],
    ARRAY['6a', 'public.s112_stornobeleg_anlegen(uuid, uuid, text, date)',
      $alt$AND g.art = 'gutschrift' AND g.aktiv) THEN$alt$,
      $neu$AND g.art = 'gutschrift' AND g.aktiv AND NOT g.storniert) THEN$neu$],
    ARRAY['6b', 'public.s112_stornobeleg_anlegen(uuid, uuid, text, date)',
      $alt$RAISE EXCEPTION '% ist eine Gutschrift und lässt sich nicht stornieren.'$alt$,
      $neu$RAISE EXCEPTION '% ist eine Gutschrift – sie wird über „Gutschrift stornieren“ storniert.'$neu$],
    ARRAY['7', 'public.berechne_ea_uva(uuid, smallint, text)',
      $alt$    SELECT s.id, -1, x.pos,
           (SELECT v.steuerfall FROM verkaufsposten v WHERE v.id = (x.pos ->> 'lieferschein_id')::uuid AND v.tenant_id = o.tenant_id)
    FROM rechnungen s$alt$,
      $neu$    -- KAN-453: Stornobeleg zu einer Gutschrift – deren Zeilen stehen mit negativer Menge in der Momentaufnahme (−1 × − = +);
    -- Steuerfall freier Zeilen wie bei der Gutschrift über die berichtigte Rechnung
    SELECT s.id, -1, x.pos,
           coalesce((SELECT v.steuerfall FROM verkaufsposten v WHERE v.id = (x.pos ->> 'lieferschein_id')::uuid AND v.tenant_id = o.tenant_id),
                    (SELECT max(v.steuerfall) FROM verkaufsposten v WHERE v.rechnung_id = o.gutschrift_zu_id AND v.tenant_id = o.tenant_id))
    FROM rechnungen s$neu$]
  ];
  v_def text;
  v_n   integer;
  i     integer;
BEGIN
  FOR i IN 1 .. array_length(c_e, 1) LOOP
    v_def := pg_get_functiondef(c_e[i][2]::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, c_e[i][3], ''))) / length(c_e[i][3]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'KAN-453: Anker fehlt bzw. ist nicht eindeutig (Eingriff %, %, % Treffer)', c_e[i][1], c_e[i][2], v_n;
    END IF;
    EXECUTE replace(v_def, c_e[i][3], c_e[i][4]);
  END LOOP;
END
$eingriffe$;

-- 8. Gutschrift stornieren ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_gutschrift_stornieren(p_tenant_id uuid, p_gutschrift_id uuid, p_grund text, p_datum date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g       public.rechnungen%ROWTYPE;
  v_r       public.rechnungen%ROWTYPE;
  v_heute   date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_datum   date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_rid     uuid;
  v_sperre  text;
  v_kb      date;
  v_nummer  text;
  v_id      uuid;
  v_b       record;
  v_alt     integer;
  v_res     integer;
  v_name    text;
  v_best    numeric;
  v_gesamt  numeric(12,2);
  v_gezahlt numeric(12,2);
  v_bezahlt boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  IF length(v_grund) > 300 THEN
    RAISE EXCEPTION 'Der Grund darf höchstens 300 Zeichen lang sein.' USING ERRCODE = '23514';
  END IF;

  -- Sperrreihenfolge wie s112_gutschrift_anlegen: zuerst die Rechnung, dann die Gutschrift
  SELECT g.gutschrift_zu_id INTO v_rid FROM public.rechnungen g
   WHERE g.id = p_gutschrift_id AND g.tenant_id = p_tenant_id AND g.art = 'gutschrift';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gutschrift nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = v_rid AND r.tenant_id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_g FROM public.rechnungen g WHERE g.id = p_gutschrift_id AND g.tenant_id = p_tenant_id FOR UPDATE;
  IF v_g.storniert THEN
    RAISE EXCEPTION 'Die Gutschrift % ist bereits storniert.', v_g.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF NOT v_g.aktiv THEN
    RAISE EXCEPTION 'Die Gutschrift % ist nicht aktiv.', v_g.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF v_datum < v_g.datum THEN
    RAISE EXCEPTION 'Das Storno-Datum (%) liegt vor dem Datum der Gutschrift % (%).',
      to_char(v_datum, 'DD.MM.YYYY'), v_g.rechnungsnummer, to_char(v_g.datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF v_datum > greatest(v_heute, v_g.datum) THEN
    RAISE EXCEPTION 'Das Storno-Datum (%) liegt in der Zukunft.', to_char(v_datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF NOT public.s112_wartung_frei(p_tenant_id) THEN
    v_sperre := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, v_datum);
    IF v_sperre IS NOT NULL THEN
      RAISE EXCEPTION 'Storno mit Datum % nicht möglich: % Bitte ein Storno-Datum im offenen Zeitraum wählen.',
        to_char(v_datum, 'DD.MM.YYYY'), v_sperre USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
    -- zurückgenommene Flaschen gehen am Storno-Datum wieder ab – im abgeschlossenen Kellerbuch-Zeitraum nicht möglich
    IF EXISTS (SELECT 1 FROM public.fuellung_bewegungen b WHERE b.tenant_id = p_tenant_id AND b.gutschrift_id = v_g.id AND b.art = 'ruecknahme') THEN
      v_kb := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
      IF v_kb IS NOT NULL AND v_datum <= v_kb THEN
        RAISE EXCEPTION 'Storno mit Datum % nicht möglich: Das Kellerbuch ist bis % abgeschlossen, und die Gutschrift hat Flaschen in den Bestand zurückgenommen. Bitte ein späteres Storno-Datum wählen.',
          to_char(v_datum, 'DD.MM.YYYY'), to_char(v_kb, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'periodensperre';
      END IF;
    END IF;
  END IF;

  v_nummer := public.s112_stornonummer_ziehen(p_tenant_id, v_datum);
  IF v_nummer IS NULL THEN
    RAISE EXCEPTION 'Für den Betrieb fehlen die Einstellungen – Stornonummer nicht möglich.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.rechnungen (tenant_id, art, storno_von_id, rechnungsnummer, datum, leistung_von, leistung_bis,
                                 kontakt_id, firma_id, zh_kontakt_id, partner_daten, skonto_aktiv, notizen, spiegel)
  VALUES (p_tenant_id, 'storno', v_g.id, v_nummer, v_datum, v_g.leistung_von, v_g.leistung_bis,
          v_g.kontakt_id, v_g.firma_id, v_g.zh_kontakt_id, v_g.partner_daten, false, v_grund, false)
  RETURNING id INTO v_id;

  -- Gutschrift: storniert, Verweis, Momentaufnahme für den Stornobeleg (ihre Zeilen mit negativer Menge)
  PERFORM set_config('s112.rechnung_storno', v_g.id::text, true);
  UPDATE public.rechnungen
     SET storniert = true, storniert_am = now(), storniert_von = auth.uid(),
         storniert_von_name = public.s112_storno_benutzername(auth.uid()), storno_grund = v_grund, storniert_durch_id = v_id,
         storno_positionen = (
           SELECT coalesce(jsonb_agg(x.pos || jsonb_build_object('menge', -((x.pos ->> 'menge')::numeric)) ORDER BY x.nr), '[]'::jsonb)
             FROM jsonb_array_elements(v_g.gutschrift_positionen) WITH ORDINALITY AS x(pos, nr))
   WHERE id = v_g.id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.rechnung_storno', '', true);

  -- Rücknahme zurückbuchen (KAN-452): Flaschen – nur, was noch frei im Bestand ist
  FOR v_b IN
    SELECT b.fuellung_id, b.verkaufsposten_id, sum(b.menge_stk)::integer AS stk
      FROM public.fuellung_bewegungen b
     WHERE b.tenant_id = p_tenant_id AND b.gutschrift_id = v_g.id AND b.art = 'ruecknahme'
     GROUP BY b.fuellung_id, b.verkaufsposten_id
     ORDER BY b.fuellung_id, b.verkaufsposten_id
  LOOP
    SELECT coalesce(f.bestand_flaschen, 0), f.name INTO v_alt, v_name FROM public.fuellungen f
     WHERE f.id = v_b.fuellung_id AND f.tenant_id = p_tenant_id FOR UPDATE;
    v_res := public.s112_fuellung_reserviert(v_b.fuellung_id);
    IF v_alt - v_b.stk < greatest(v_res, 0) THEN
      RAISE EXCEPTION '„%“: Die zurückgenommene Ware ist nicht mehr im Bestand (Bestand %, davon % für Aufträge reserviert, zurückzubuchen %). Die Gutschrift % lässt sich deshalb nicht stornieren.',
        coalesce(v_name, 'Füllung'), v_alt, v_res, v_b.stk, v_g.rechnungsnummer USING ERRCODE = '22023', HINT = 'ruecknahme_bestand';
    END IF;
    INSERT INTO public.fuellung_bewegungen
      (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_von, verkaufsposten_id, gutschrift_id)
    VALUES
      (p_tenant_id, v_b.fuellung_id, v_datum, 'ruecknahme_storno', -v_b.stk, v_alt, v_alt - v_b.stk,
       'Storno der Rücknahme zu Gutschrift ' || v_g.rechnungsnummer || ' (' || v_nummer || ')', auth.uid(), v_b.verkaufsposten_id, v_g.id);
    PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
    UPDATE public.fuellungen SET bestand_flaschen = v_alt - v_b.stk WHERE id = v_b.fuellung_id AND tenant_id = p_tenant_id;
    PERFORM set_config('s112.freeze_frei', '', true);
  END LOOP;

  -- … und Produkte mit Lagerbestand: Storno der Rücknahme-Bewegung
  FOR v_b IN
    SELECT b.id, b.artikel_id, b.menge, b.verkauf_position_id, b.verkaufsposten_id, a.name
      FROM public.sonstige_artikel_bewegungen b JOIN public.sonstige_artikel a ON a.id = b.artikel_id
     WHERE b.tenant_id = p_tenant_id AND b.gutschrift_id = v_g.id AND b.art = 'ruecknahme'
       AND NOT EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen s WHERE s.storno_von_id = b.id)
     ORDER BY b.artikel_id, b.id
  LOOP
    PERFORM 1 FROM public.sonstige_artikel a WHERE a.id = v_b.artikel_id AND a.tenant_id = p_tenant_id FOR UPDATE;
    v_best := public.s112_artikel_bestand(v_b.artikel_id);
    IF v_b.menge > v_best + 0.0005 THEN
      RAISE EXCEPTION '„%“: Die zurückgenommene Ware ist nicht mehr auf Lager (Lagerstand %, zurückzubuchen %). Die Gutschrift % lässt sich deshalb nicht stornieren.',
        v_b.name, replace(trim_scale(round(v_best, 3))::text, '.', ','), replace(trim_scale(round(v_b.menge, 3))::text, '.', ','),
        v_g.rechnungsnummer USING ERRCODE = '22023', HINT = 'ruecknahme_bestand';
    END IF;
    INSERT INTO public.sonstige_artikel_bewegungen
      (tenant_id, artikel_id, datum, art, menge, verkauf_position_id, verkaufsposten_id, storno_von_id, notizen, erstellt_von, erstellt_von_name)
    VALUES
      (p_tenant_id, v_b.artikel_id, v_datum, 'storno', -v_b.menge, v_b.verkauf_position_id, v_b.verkaufsposten_id, v_b.id,
       'Storno der Rücknahme zu Gutschrift ' || v_g.rechnungsnummer || ' (' || v_nummer || ')', auth.uid(), public.s112_storno_benutzername(auth.uid()));
  END LOOP;

  -- Ausgleich der Rechnung neu: ohne diese Gutschrift kann wieder ein Betrag offen sein
  IF v_r.id IS NOT NULL AND NOT v_r.storniert THEN
    SELECT coalesce(sum(round(p.menge * coalesce(p.preis_brutto, 0)
             * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100), 2)), 0)
      INTO v_gesamt
      FROM public.verkauf_positionen p JOIN public.verkaufsposten v ON v.id = p.verkaufsposten_id
     WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id;
    SELECT coalesce(sum(z.betrag), 0) INTO v_gezahlt
      FROM public.zahlungen z WHERE z.rechnung_id = v_r.id AND z.tenant_id = p_tenant_id AND z.storniert_am IS NULL;
    v_bezahlt := v_gezahlt + public.s112_gutschrift_summe(p_tenant_id, v_r.id) >= v_gesamt AND v_gesamt > 0;
    IF v_bezahlt IS DISTINCT FROM v_r.bezahlt THEN
      UPDATE public.rechnungen SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
       WHERE id = v_r.id AND tenant_id = p_tenant_id;
      UPDATE public.verkaufsposten SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
       WHERE rechnung_id = v_r.id AND tenant_id = p_tenant_id;
    END IF;
  END IF;
  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_gutschrift_stornieren(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_gutschrift_stornieren(uuid, uuid, text, date) TO authenticated;
COMMENT ON FUNCTION public.s112_gutschrift_stornieren(uuid, uuid, text, date) IS
  'KAN-453: Gutschrift über einen Stornobeleg am Storno-Datum aufheben; eine Rücknahme in den Bestand (KAN-452) wird zurückgebucht';

-- 9. Selbstprüfung ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rechnungen WHERE art = 'gutschrift' AND storniert) THEN
    RAISE EXCEPTION 'KAN-453: stornierte Gutschrift vor der Migration';
  END IF;
  IF has_function_privilege('anon', 'public.s112_gutschrift_stornieren(uuid, uuid, text, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-453: s112_gutschrift_stornieren ist für anon ausführbar';
  END IF;
END
$$;
