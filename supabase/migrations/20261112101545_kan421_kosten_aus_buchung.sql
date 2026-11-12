-- KAN-421 (12.11.2026): Ausgabe beim Buchen in die Kostenrechnung übernehmen.
--
-- Eine Ausgabe der E&A-Rechnung lässt sich beim Erfassen auf Kostenstellen (und Kostenarten) aufteilen; je Zeile entsteht
-- ein Kosteneintrag mit Verweis auf die Buchung. Betrag netto, Summe höchstens der Nettobetrag der Buchung.
--
-- 1. kosteneintraege.ea_transaktion_id (FK mit Kaskade – der Demo-Reset löscht ea_transaktionen vor den Kosteneinträgen),
--    Prüf-Trigger (eigener Betrieb), Index.
-- 2. Schutz-Trigger: Kosteneinträge aus einer Buchung entstehen und ändern sich nur über die Datenbank-Funktionen
--    (s112.kosten_frei) bzw. in der Wartung – Korrektur über die Buchung, nicht in der Kostenrechnung.
-- 3. RPC s112_ea_kosten_zuordnen: einmal je Buchung, nur Ausgaben, nicht storniert, Summe ≤ netto.
-- 4. Storno: Die Gegenbuchung der E&A-Rechnung (s112_ea_gegenbuchung, storno_von_id) spiegelt die Kosteneinträge der
--    Originalbuchung mit negativem Betrag am Datum der Gegenbuchung – wie in der E&A-Rechnung selbst (Storno im offenen
--    Zeitraum statt rückwirkend). So stimmen alle Summen ohne Sonderfall in den Lesern (Kostenrechnung, Ried, KI-Abfrage).

ALTER TABLE public.kosteneintraege
  ADD COLUMN ea_transaktion_id uuid REFERENCES public.ea_transaktionen(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.kosteneintraege.ea_transaktion_id IS
  'E&A-Buchung, aus der dieser Kosteneintrag stammt (KAN-421). Solche Einträge schreibt nur s112_ea_kosten_zuordnen bzw. der Storno-Spiegel.';

CREATE INDEX kosteneintraege_ea_transaktion_idx ON public.kosteneintraege (ea_transaktion_id);

CREATE TRIGGER z_fremdverweis_ea_transaktion_id
  BEFORE INSERT OR UPDATE OF ea_transaktion_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ea_transaktion_id', 'ea_transaktionen', '', '', '');

-- ── 2. Schutz ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_kosten_buchung_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.ea_transaktion_id IS NOT NULL)
     OR (TG_OP <> 'DELETE' AND NEW.ea_transaktion_id IS NOT NULL) THEN
    IF NOT (coalesce(current_setting('s112.kosten_frei', true), '') = 'ja'
            OR coalesce(public.s112_wartung_frei(v_tenant), false)) THEN
      RAISE EXCEPTION 'Dieser Kosteneintrag stammt aus einer Buchung der E&A-Rechnung und lässt sich hier nicht anlegen, ändern oder löschen – bitte die Buchung stornieren und neu erfassen.'
        USING ERRCODE = '42501', HINT = 'kosten_aus_buchung';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_kosten_buchung_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_kosten_buchung_schutz
  BEFORE INSERT OR UPDATE OR DELETE ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_kosten_buchung_schutz();

-- ── 3. Zuordnen ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_ea_kosten_zuordnen(p_tenant_id uuid, p_ea_transaktion_id uuid, p_zeilen jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b      record;
  v_z      jsonb;
  v_betrag numeric;
  v_summe  numeric := 0;
  v_ks     uuid;
  v_ka     uuid;
  v_n      integer := 0;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_controlling');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');

  IF p_zeilen IS NULL OR jsonb_typeof(p_zeilen) <> 'array' OR jsonb_array_length(p_zeilen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Kostenstelle mit Betrag angeben.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_zeilen) > 20 THEN
    RAISE EXCEPTION 'Höchstens 20 Kostenstellen je Buchung.' USING ERRCODE = '23514';
  END IF;

  SELECT id, typ, datum, beschreibung, betrag_netto, storniert_am, storno_von_id INTO v_b
    FROM public.ea_transaktionen
   WHERE id = p_ea_transaktion_id AND tenant_id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buchung nicht gefunden.' USING ERRCODE = '23503';
  END IF;
  IF v_b.typ <> 'ausgabe' THEN
    RAISE EXCEPTION 'Nur Ausgaben lassen sich in die Kostenrechnung übernehmen.' USING ERRCODE = '23514';
  END IF;
  IF v_b.storniert_am IS NOT NULL OR v_b.storno_von_id IS NOT NULL THEN
    RAISE EXCEPTION 'Die Buchung ist storniert.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kosteneintraege k WHERE k.ea_transaktion_id = p_ea_transaktion_id) THEN
    RAISE EXCEPTION 'Diese Buchung ist bereits in der Kostenrechnung.' USING ERRCODE = '23505';
  END IF;

  FOR v_z IN SELECT * FROM jsonb_array_elements(p_zeilen) LOOP
    v_ks := NULLIF(v_z ->> 'kostenstelle_id', '')::uuid;
    v_ka := NULLIF(v_z ->> 'kostenart_id', '')::uuid;
    v_betrag := round(NULLIF(v_z ->> 'betrag', '')::numeric, 2);
    IF v_ks IS NULL THEN
      RAISE EXCEPTION 'Bitte je Zeile eine Kostenstelle wählen.' USING ERRCODE = '23514';
    END IF;
    IF v_betrag IS NULL OR v_betrag <= 0 THEN
      RAISE EXCEPTION 'Bitte je Kostenstelle einen Betrag über 0 angeben.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kostenstellen s WHERE s.id = v_ks AND s.tenant_id = p_tenant_id AND s.aktiv) THEN
      RAISE EXCEPTION 'Kostenstelle nicht gefunden oder nicht aktiv.' USING ERRCODE = '23503';
    END IF;
    IF v_ka IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.kostenarten a WHERE a.id = v_ka AND a.tenant_id = p_tenant_id AND a.aktiv) THEN
      RAISE EXCEPTION 'Kostenart nicht gefunden oder nicht aktiv.' USING ERRCODE = '23503';
    END IF;
    v_summe := v_summe + v_betrag;
  END LOOP;

  IF v_summe > round(v_b.betrag_netto, 2) THEN
    RAISE EXCEPTION 'Die Aufteilung (% €) ist höher als der Nettobetrag der Buchung (% €).',
      to_char(v_summe, 'FM999G999G990D00'), to_char(round(v_b.betrag_netto, 2), 'FM999G999G990D00')
      USING ERRCODE = '23514', HINT = 'kosten_summe';
  END IF;

  PERFORM set_config('s112.kosten_frei', 'ja', true);
  FOR v_z IN SELECT * FROM jsonb_array_elements(p_zeilen) LOOP
    INSERT INTO public.kosteneintraege (tenant_id, kostenstelle_id, kostenart_id, datum, betrag, beschreibung, periode,
                                        transaktions_nr, ea_transaktion_id)
    VALUES (p_tenant_id, (v_z ->> 'kostenstelle_id')::uuid, NULLIF(v_z ->> 'kostenart_id', '')::uuid, v_b.datum,
            round((v_z ->> 'betrag')::numeric, 2), v_b.beschreibung, to_char(v_b.datum, 'YYYY-MM'),
            public.get_next_transaktionsnr(p_tenant_id, 'kosteneintrag'), p_ea_transaktion_id);
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('s112.kosten_frei', '', true);
  RETURN v_n;
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_ea_kosten_zuordnen(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_ea_kosten_zuordnen(uuid, uuid, jsonb) TO authenticated, service_role;

-- ── 4. Storno spiegeln ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_kosten_storno_spiegeln()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.kosteneintraege k WHERE k.ea_transaktion_id = NEW.storno_von_id) THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('s112.kosten_frei', 'ja', true);
  INSERT INTO public.kosteneintraege (tenant_id, kostenstelle_id, kostenart_id, datum, betrag, beschreibung, periode, ea_transaktion_id)
  SELECT k.tenant_id, k.kostenstelle_id, k.kostenart_id, NEW.datum, -k.betrag,
         left('Storno: ' || coalesce(k.beschreibung, ''), 500), to_char(NEW.datum, 'YYYY-MM'), NEW.id
    FROM public.kosteneintraege k
   WHERE k.ea_transaktion_id = NEW.storno_von_id AND k.tenant_id = NEW.tenant_id
   ORDER BY k.erstellt_am, k.id;
  PERFORM set_config('s112.kosten_frei', '', true);
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_kosten_storno_spiegeln() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER z_kosten_storno_spiegeln
  AFTER INSERT ON public.ea_transaktionen
  FOR EACH ROW WHEN (NEW.storno_von_id IS NOT NULL)
  EXECUTE FUNCTION public.s112_kosten_storno_spiegeln();
