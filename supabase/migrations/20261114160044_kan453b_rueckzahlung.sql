-- KAN-453 G3c (14.11.2026, Plan freigegeben von Jörgen, Fragen 1–7 A): Rückzahlung am Guthaben erfassen.
--
-- Seit KAN-419 kann eine Rechnung ein Guthaben haben (Zahlungen + Gutschriften über dem Rechnungsbetrag) – auszahlen ließ
-- es sich nicht, und bei E&A-Betrieben (Versteuerung nach Zahlung) blieb die Umsatzsteuer der Gutschrift stehen.
-- Neu (Entscheidungen 4A aus KAN-419, 5A/6A): eine Rückzahlung ist eine negative Zahlung in `zahlungen`.
--   * anlegbar nur über s112_rueckzahlung_erfassen (höchstens das Guthaben der Rechnung, auch in Teilen); direkt bleibt
--     nur ein positiver Betrag erlaubt (Trigger a_rueckzahlung_schutz)
--   * alle Summen über Zahlungen rechnen damit von selbst richtig: „bezahlt“-Abgleich, offene Posten (Guthaben sinkt),
--     Kontosaldo, Kassabuch (Ausgang)
--   * E&A: die abgeleitete Einnahme einer Rückzahlung ist negativ (Minderung der Bemessungsgrundlage am Tag der
--     Rückzahlung) – dafür darf eine Verkaufs-Einnahme mit Zahlungsbezug negativ sein; sonst bleibt betrag_netto ≥ 0
--   * Storno wie bei jeder Zahlung (s112_zahlung_stornieren bucht die Einnahme gegen)
--   * eine Gutschrift, zu deren Rechnung es eine Rückzahlung gibt, lässt sich nicht stornieren (4 A)

-- 1. Zahlungen: negativer Betrag = Rückzahlung, nur über die RPC ────────────────────────────────────────────────
ALTER TABLE public.zahlungen
  DROP CONSTRAINT zahlungen_betrag_check,
  ADD CONSTRAINT zahlungen_betrag_check CHECK (betrag <> 0);

CREATE FUNCTION public.s112_rueckzahlung_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.betrag < 0 AND (TG_OP = 'INSERT' OR NEW.betrag IS DISTINCT FROM OLD.betrag)
     AND coalesce(current_setting('s112.rueckzahlung', true), '') <> 'an' THEN
    RAISE EXCEPTION 'Eine Rückzahlung lässt sich nur über „Rückzahlung erfassen“ buchen – eine Zahlung hat einen positiven Betrag.'
      USING ERRCODE = '42501', HINT = 'rueckzahlung';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_rueckzahlung_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_rueckzahlung_schutz BEFORE INSERT OR UPDATE OF betrag ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_rueckzahlung_schutz();

-- 2. E&A: die Einnahme einer Rückzahlung ist negativ ────────────────────────────────────────────────────────────
ALTER TABLE public.ea_transaktionen
  DROP CONSTRAINT ea_transaktionen_betrag_netto_check,
  ADD CONSTRAINT ea_transaktionen_betrag_netto_check CHECK (
    betrag_netto >= 0 OR storno_von_id IS NOT NULL
    OR (typ = 'einnahme' AND import_quelle = 'verkauf' AND zahlung_id IS NOT NULL));

-- 3. Rückzahlung erfassen ───────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_rueckzahlung_erfassen(p_tenant_id uuid, p_rechnung_id uuid, p_betrag numeric, p_datum date,
                                                  p_art text DEFAULT 'bank', p_konto_id uuid DEFAULT NULL, p_notizen text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r        public.rechnungen%ROWTYPE;
  v_heute    date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_betrag   numeric(12,2) := round(coalesce(p_betrag, 0), 2);
  v_art      text := coalesce(nullif(btrim(coalesce(p_art, '')), ''), 'bank');
  v_notiz    text := nullif(btrim(coalesce(p_notizen, '')), '');
  v_gesamt   numeric(12,2);
  v_gezahlt  numeric(12,2);
  v_guthaben numeric(12,2);
  v_sperre   text;
  v_ls       uuid;
  v_id       uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft', 'ea');
  IF v_betrag <= 0 THEN
    RAISE EXCEPTION 'Bitte den Betrag der Rückzahlung angeben (größer als 0).' USING ERRCODE = '23514', HINT = 'rueckzahlung_betrag';
  END IF;
  IF v_art NOT IN ('bar', 'karte', 'bank', 'sonstig') THEN
    RAISE EXCEPTION 'Unbekannte Zahlungsart der Rückzahlung.' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(v_notiz, '')) > 300 THEN
    RAISE EXCEPTION 'Die Notiz darf höchstens 300 Zeichen lang sein.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = p_rechnung_id AND r.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rechnung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.art <> 'rechnung' OR v_r.storniert OR NOT v_r.aktiv THEN
    RAISE EXCEPTION 'Zu % lässt sich keine Rückzahlung erfassen (nur zu einer gültigen Rechnung).', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte das Datum der Rückzahlung angeben.' USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF p_datum < v_r.datum THEN
    RAISE EXCEPTION 'Das Datum der Rückzahlung (%) liegt vor dem Rechnungsdatum der Rechnung % (%).',
      to_char(p_datum, 'DD.MM.YYYY'), v_r.rechnungsnummer, to_char(v_r.datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF p_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum der Rückzahlung (%) liegt in der Zukunft.', to_char(p_datum, 'DD.MM.YYYY') USING ERRCODE = '23514', HINT = 'storno_datum';
  END IF;
  IF NOT public.s112_wartung_frei(p_tenant_id) THEN
    v_sperre := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
    IF v_sperre IS NOT NULL THEN
      RAISE EXCEPTION 'Rückzahlung mit Datum % nicht möglich: % Bitte ein Datum im offenen Zeitraum wählen.',
        to_char(p_datum, 'DD.MM.YYYY'), v_sperre USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
  END IF;

  -- Guthaben = Zahlungen (samt bisheriger Rückzahlungen) + Gutschriften − Rechnungsbetrag
  SELECT coalesce(sum(round(p.menge * coalesce(p.preis_brutto, 0)
           * (1 - coalesce(p.rabatt_pct, 0) / 100) * (1 - coalesce(p.sonderrabatt_pct, 0) / 100), 2)), 0)
    INTO v_gesamt
    FROM public.verkauf_positionen p JOIN public.verkaufsposten v ON v.id = p.verkaufsposten_id
   WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id;
  SELECT coalesce(sum(z.betrag), 0) INTO v_gezahlt
    FROM public.zahlungen z WHERE z.rechnung_id = v_r.id AND z.tenant_id = p_tenant_id AND z.storniert_am IS NULL;
  v_guthaben := greatest(v_gezahlt + public.s112_gutschrift_summe(p_tenant_id, v_r.id) - v_gesamt, 0);
  IF v_betrag > v_guthaben THEN
    RAISE EXCEPTION 'Die Rückzahlung (% €) übersteigt das Guthaben der Rechnung % (% €).',
      replace(to_char(v_betrag, 'FM999999990.00'), '.', ','), v_r.rechnungsnummer, replace(to_char(v_guthaben, 'FM999999990.00'), '.', ',')
      USING ERRCODE = '23514', HINT = 'rueckzahlung_betrag';
  END IF;

  -- Zahlungen hängen an einem Lieferschein – der erste der Rechnung (wie beim Zahlungseingang einer Sammelrechnung)
  SELECT v.id INTO v_ls FROM public.verkaufsposten v
   WHERE v.rechnung_id = v_r.id AND v.tenant_id = p_tenant_id ORDER BY v.datum, v.lieferscheinnummer, v.id LIMIT 1;
  IF v_ls IS NULL THEN
    RAISE EXCEPTION 'Die Rechnung % hat keinen Lieferschein – Rückzahlung nicht möglich.', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('s112.rueckzahlung', 'an', true);
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, rechnung_id, betrag, art, datum, notizen, konto_id)
  VALUES (p_tenant_id, v_ls, v_r.id, -v_betrag, v_art::public.zahlungsart, p_datum, coalesce(v_notiz, 'Rückzahlung'), p_konto_id)
  RETURNING id INTO v_id;
  PERFORM set_config('s112.rueckzahlung', '', true);
  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_rueckzahlung_erfassen(uuid, uuid, numeric, date, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_rueckzahlung_erfassen(uuid, uuid, numeric, date, text, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_rueckzahlung_erfassen(uuid, uuid, numeric, date, text, uuid, text) IS
  'KAN-453: Rückzahlung am Guthaben einer Rechnung (negative Zahlung, höchstens das Guthaben); die E&A-Einnahme gleicht die App danach ab';

-- 4. Gutschrift mit Rückzahlung: Storno gesperrt (4 A) – Eingriff in die gültige Definition, Anker genau einmal ──────
DO $eingriff$
DECLARE
  c_alt CONSTANT text := $alt$  v_nummer := public.s112_stornonummer_ziehen(p_tenant_id, v_datum);$alt$;
  c_neu CONSTANT text := $neu$  -- KAN-453 G3c: das Guthaben dieser Gutschrift ist schon ausbezahlt – zuerst die Rückzahlung stornieren
  IF EXISTS (SELECT 1 FROM public.zahlungen z
              WHERE z.rechnung_id = v_rid AND z.tenant_id = p_tenant_id AND z.storniert_am IS NULL AND z.betrag < 0) THEN
    RAISE EXCEPTION 'Zur Rechnung % gibt es eine Rückzahlung – bitte zuerst die Rückzahlung stornieren, dann die Gutschrift %.',
      v_r.rechnungsnummer, v_g.rechnungsnummer USING ERRCODE = '22023', HINT = 'rueckzahlung';
  END IF;

  v_nummer := public.s112_stornonummer_ziehen(p_tenant_id, v_datum);$neu$;
  v_def text := pg_get_functiondef('public.s112_gutschrift_stornieren(uuid, uuid, text, date)'::regprocedure);
  v_n   integer := (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt);
BEGIN
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'KAN-453: Anker fehlt bzw. ist nicht eindeutig (s112_gutschrift_stornieren, % Treffer)', v_n;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$eingriff$;

-- 5. Selbstprüfung ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.zahlungen WHERE betrag <= 0) THEN
    RAISE EXCEPTION 'KAN-453: Zahlung mit Betrag ≤ 0 vor der Migration';
  END IF;
  IF has_function_privilege('anon', 'public.s112_rueckzahlung_erfassen(uuid, uuid, numeric, date, text, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_rueckzahlung_schutz()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-453: Rechte der Rückzahlungs-Funktionen stimmen nicht';
  END IF;
END
$$;
