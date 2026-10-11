-- KAN-325 + KAN-326 (UAT 11.10.2026) – Entwurf; Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 80, Produktion erst nach „OK, einspielen“.
--
--  A. KAN-325: Die Bienenschutz-Bestätigung (KAN-171) wurde nur beim Absenden geprüft, nie gespeichert – beim Bearbeiten
--     war der Haken leer. Jetzt an der Maßnahme: bestätigt am / von / Name. Zeitpunkt, Benutzer und Name setzt die
--     Datenbank (Trigger a0_bienenschutz); eine bestehende Bestätigung bleibt beim Bearbeiten unverändert, NULL hebt sie auf
--     (Mittel nicht mehr bienengefährlich bzw. nicht mehr in der Blüte). Direktes Setzen von „von“/„Name“ wirkt nicht.
--  B. KAN-326: PSM- und Dünger-Einkauf mit E/A-Ausgabe (wie Betriebsmittel, KAN-167/KAN-223): Lagerbuchung und Ausgabe in
--     einer Transaktion über s112_lager_einkauf, Storno samt Ausgabe über s112_lager_einkauf_stornieren. „Einkauf / Zugang“
--     ohne Ausgabe bleibt (Betriebe ohne E&A). Eine Lagerbuchung mit Ausgabe entsteht und storniert nur über die RPCs
--     (Trigger a_lager_einkauf, Kennzeichen s112.lager_einkauf). Ausgabe mit import_quelle 'betriebsmittel'.

-- ── A. KAN-325: Bienenschutz-Bestätigung ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.behandlungen
  ADD COLUMN IF NOT EXISTS bienenschutz_bestaetigt_am       timestamptz,
  ADD COLUMN IF NOT EXISTS bienenschutz_bestaetigt_von      uuid,
  ADD COLUMN IF NOT EXISTS bienenschutz_bestaetigt_von_name text;
COMMENT ON COLUMN public.behandlungen.bienenschutz_bestaetigt_am IS
  'KAN-325: Bienenschutz-Auflagen bestätigt (KAN-171, bienengefährliches Mittel in der Blüte); Zeitpunkt, Benutzer und Name setzt der Trigger a0_bienenschutz';

CREATE OR REPLACE FUNCTION public.s112_bienenschutz_bestaetigung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF NEW.bienenschutz_bestaetigt_am IS NULL THEN
    NEW.bienenschutz_bestaetigt_von := NULL;
    NEW.bienenschutz_bestaetigt_von_name := NULL;
    RETURN NEW;
  END IF;
  -- bestehende Bestätigung bleibt (Zeitpunkt und Person der ersten Bestätigung)
  IF TG_OP = 'UPDATE' AND OLD.bienenschutz_bestaetigt_am IS NOT NULL THEN
    NEW.bienenschutz_bestaetigt_am := OLD.bienenschutz_bestaetigt_am;
    NEW.bienenschutz_bestaetigt_von := OLD.bienenschutz_bestaetigt_von;
    NEW.bienenschutz_bestaetigt_von_name := OLD.bienenschutz_bestaetigt_von_name;
    RETURN NEW;
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
      INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    IF v_name IS NULL THEN
      SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
    END IF;
  END IF;
  NEW.bienenschutz_bestaetigt_am := now();
  NEW.bienenschutz_bestaetigt_von := v_uid;
  NEW.bienenschutz_bestaetigt_von_name := v_name;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_bienenschutz_bestaetigung() FROM PUBLIC, anon, authenticated;

-- „a0_“: BEFORE-Trigger laufen alphabetisch – vor a_freeze_ernte und a_storno_schutz, damit die unveränderte frühere
-- Bestätigung schon zurückgesetzt ist, wenn die Sperren vergleichen (gesperrte Maßnahme: nur Notizen änderbar)
DROP TRIGGER IF EXISTS b_bienenschutz ON public.behandlungen;   -- Entwurfsname auf Staging (11.10.2026)
DROP TRIGGER IF EXISTS a0_bienenschutz ON public.behandlungen;
CREATE TRIGGER a0_bienenschutz BEFORE INSERT OR UPDATE OF bienenschutz_bestaetigt_am, bienenschutz_bestaetigt_von, bienenschutz_bestaetigt_von_name
  ON public.behandlungen FOR EACH ROW EXECUTE FUNCTION public.s112_bienenschutz_bestaetigung();

-- ── B. KAN-326: PSM- und Dünger-Einkauf mit E/A-Ausgabe ──────────────────────────────────────────────────────────
ALTER TABLE public.psm_lager_bewegungen
  ADD COLUMN IF NOT EXISTS betrag_netto       numeric(12,2) CHECK (betrag_netto IS NULL OR betrag_netto >= 0),
  ADD COLUMN IF NOT EXISTS ust_satz           numeric(4,1)  CHECK (ust_satz IS NULL OR ust_satz IN (0, 10, 13, 20)),
  ADD COLUMN IF NOT EXISTS lieferant_firma_id uuid REFERENCES public.firmen(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ea_transaktion_id  uuid UNIQUE REFERENCES public.ea_transaktionen(id) ON DELETE SET NULL;
ALTER TABLE public.duengemittel_lager_bewegungen
  ADD COLUMN IF NOT EXISTS betrag_netto       numeric(12,2) CHECK (betrag_netto IS NULL OR betrag_netto >= 0),
  ADD COLUMN IF NOT EXISTS ust_satz           numeric(4,1)  CHECK (ust_satz IS NULL OR ust_satz IN (0, 10, 13, 20)),
  ADD COLUMN IF NOT EXISTS lieferant_firma_id uuid REFERENCES public.firmen(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ea_transaktion_id  uuid UNIQUE REFERENCES public.ea_transaktionen(id) ON DELETE SET NULL;
-- Index je Fremdschlüssel (DB-Test 78); ea_transaktion_id ist durch UNIQUE indiziert
CREATE INDEX IF NOT EXISTS psm_lager_bewegungen_lieferant_idx ON public.psm_lager_bewegungen (lieferant_firma_id) WHERE lieferant_firma_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS duengemittel_lager_bewegungen_lieferant_idx ON public.duengemittel_lager_bewegungen (lieferant_firma_id) WHERE lieferant_firma_id IS NOT NULL;
ALTER TABLE public.psm_lager_bewegungen DROP CONSTRAINT IF EXISTS psm_lager_einkauf_ea_chk;
ALTER TABLE public.psm_lager_bewegungen ADD CONSTRAINT psm_lager_einkauf_ea_chk
  CHECK (ea_transaktion_id IS NULL OR (typ = 'einkauf' AND menge > 0 AND betrag_netto IS NOT NULL AND ust_satz IS NOT NULL));
ALTER TABLE public.duengemittel_lager_bewegungen DROP CONSTRAINT IF EXISTS duengemittel_lager_einkauf_ea_chk;
ALTER TABLE public.duengemittel_lager_bewegungen ADD CONSTRAINT duengemittel_lager_einkauf_ea_chk
  CHECK (ea_transaktion_id IS NULL OR (typ = 'einkauf' AND menge > 0 AND betrag_netto IS NOT NULL AND ust_satz IS NOT NULL));

-- Fremdverweise (KAN-178): Lieferant und Ausgabe nur aus dem eigenen Betrieb
DROP TRIGGER IF EXISTS z_fremdverweis_lieferant_firma_id ON public.psm_lager_bewegungen;
CREATE TRIGGER z_fremdverweis_lieferant_firma_id BEFORE INSERT OR UPDATE OF lieferant_firma_id, tenant_id ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferant_firma_id', 'firmen', '', '', '');
DROP TRIGGER IF EXISTS z_fremdverweis_ea_transaktion_id ON public.psm_lager_bewegungen;
CREATE TRIGGER z_fremdverweis_ea_transaktion_id BEFORE INSERT OR UPDATE OF ea_transaktion_id, tenant_id ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ea_transaktion_id', 'ea_transaktionen', '', '', '');
DROP TRIGGER IF EXISTS z_fremdverweis_lieferant_firma_id ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER z_fremdverweis_lieferant_firma_id BEFORE INSERT OR UPDATE OF lieferant_firma_id, tenant_id ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferant_firma_id', 'firmen', '', '', '');
DROP TRIGGER IF EXISTS z_fremdverweis_ea_transaktion_id ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER z_fremdverweis_ea_transaktion_id BEFORE INSERT OR UPDATE OF ea_transaktion_id, tenant_id ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ea_transaktion_id', 'ea_transaktionen', '', '', '');

-- Einkauf mit Ausgabe entsteht und storniert nur über die RPCs (sonst bliebe die Ausgabe ohne Lagerbuchung bzw. umgekehrt)
CREATE OR REPLACE FUNCTION public.s112_lager_einkauf_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('s112.lager_einkauf', true) IS NOT DISTINCT FROM '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.ea_transaktion_id IS NOT NULL OR NEW.betrag_netto IS NOT NULL OR NEW.ust_satz IS NOT NULL OR NEW.lieferant_firma_id IS NOT NULL THEN
      RAISE EXCEPTION 'Einkauf mit Ausgabe nur über „Einkauf (mit E/A-Ausgabe)“ (s112_lager_einkauf).'
        USING ERRCODE = '42501', HINT = 'lager_einkauf';
    END IF;
  ELSIF OLD.ea_transaktion_id IS NOT NULL AND OLD.storniert_am IS NULL AND NEW.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Ein Einkauf mit Ausgabe wird zusammen mit der Ausgabe storniert (s112_lager_einkauf_stornieren).'
      USING ERRCODE = '42501', HINT = 'lager_einkauf';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lager_einkauf_schutz() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_lager_einkauf ON public.psm_lager_bewegungen;
CREATE TRIGGER a_lager_einkauf BEFORE INSERT OR UPDATE ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_lager_einkauf_schutz();
DROP TRIGGER IF EXISTS a_lager_einkauf ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER a_lager_einkauf BEFORE INSERT OR UPDATE ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_lager_einkauf_schutz();

-- Einkauf: p_art 'psm' | 'duenger'
CREATE OR REPLACE FUNCTION public.s112_lager_einkauf(p_tenant_id uuid, p_art text, p_mittel_id uuid, p_datum date, p_menge numeric,
  p_einheit text, p_betrag_netto numeric, p_ust_satz numeric, p_lieferant_firma_id uuid, p_ea_kategorie_id uuid, p_notizen text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name  text;
  v_aktiv boolean;
  v_kat   record;
  v_grund text;
  v_ea    uuid;
  v_id    uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF NOT EXISTS (SELECT 1 FROM public.tenant_einstellungen te WHERE te.tenant_id = p_tenant_id AND te.modul_ea) THEN
    RAISE EXCEPTION 'Einkäufe mit Ausgabe gibt es nur mit aktivem Modul E&A bzw. Belege – bitte „Einkauf / Zugang“ verwenden.'
      USING ERRCODE = '42501';
  END IF;

  IF p_art = 'psm' THEN
    SELECT COALESCE(NULLIF(btrim(m.handelsname), ''), m.name), m.aktiv INTO v_name, v_aktiv FROM public.pflanzenschutzmittel m
     WHERE m.id = p_mittel_id AND (m.tenant_id = p_tenant_id OR m.tenant_id IS NULL);
  ELSIF p_art = 'duenger' THEN
    SELECT COALESCE(NULLIF(btrim(m.handelsname), ''), m.name), m.aktiv INTO v_name, v_aktiv FROM public.duengemittel m
     WHERE m.id = p_mittel_id AND (m.tenant_id = p_tenant_id OR m.tenant_id IS NULL);
  ELSE
    RAISE EXCEPTION 'Unbekannte Lagerart „%“.', coalesce(p_art, '–') USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Mittel nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_aktiv IS FALSE THEN
    RAISE EXCEPTION 'Das Mittel „%“ ist deaktiviert.', v_name USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL OR p_menge IS NULL OR p_menge <= 0 OR p_betrag_netto IS NULL OR p_betrag_netto < 0 THEN
    RAISE EXCEPTION 'Bitte Datum, Menge (> 0) und Netto-Betrag angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_einheit IS NULL OR p_einheit NOT IN ('kg', 'l', 'g', 'ml') THEN
    RAISE EXCEPTION 'Unbekannte Einheit „%“.', coalesce(p_einheit, '–') USING ERRCODE = '22023';
  END IF;
  IF p_ust_satz IS NULL OR p_ust_satz NOT IN (0, 10, 13, 20) THEN
    RAISE EXCEPTION 'Bitte einen USt-Satz (0, 10, 13 oder 20 %%) wählen.' USING ERRCODE = '22023';
  END IF;
  IF p_lieferant_firma_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = p_lieferant_firma_id AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Lieferant nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT k.id, k.typ, k.abzugsfaehig_pct INTO v_kat FROM public.ea_kategorien k
   WHERE k.id = p_ea_kategorie_id AND (k.tenant_id IS NULL OR k.tenant_id = p_tenant_id) AND k.aktiv;
  IF NOT FOUND OR v_kat.typ <> 'ausgabe' THEN
    RAISE EXCEPTION 'Bitte eine Ausgaben-Kategorie der E&A-Rechnung wählen.' USING ERRCODE = '22023';
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION '%', v_grund USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ea_transaktionen (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, firma_id,
                                       abzugsfaehig_pct, import_quelle, notizen)
  VALUES (p_tenant_id, 'ausgabe', p_datum,
          format('Einkauf %s (%s %s)', v_name, trim(to_char(p_menge, 'FM999999990.###')), p_einheit),
          p_ea_kategorie_id, round(p_betrag_netto, 2), p_ust_satz, p_lieferant_firma_id,
          coalesce(v_kat.abzugsfaehig_pct, 100), 'betriebsmittel', NULLIF(btrim(p_notizen), ''))
  RETURNING id INTO v_ea;

  PERFORM set_config('s112.lager_einkauf', '1', true);
  IF p_art = 'psm' THEN
    INSERT INTO public.psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit, betrag_netto, ust_satz,
                                             lieferant_firma_id, ea_transaktion_id, notizen)
    VALUES (p_tenant_id, p_mittel_id, p_datum, 'einkauf', p_menge, p_einheit, round(p_betrag_netto, 2), p_ust_satz,
            p_lieferant_firma_id, v_ea, NULLIF(btrim(p_notizen), ''))
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.duengemittel_lager_bewegungen (tenant_id, duengemittel_id, datum, typ, menge, einheit, betrag_netto, ust_satz,
                                                      lieferant_firma_id, ea_transaktion_id, notizen)
    VALUES (p_tenant_id, p_mittel_id, p_datum, 'einkauf', p_menge, p_einheit, round(p_betrag_netto, 2), p_ust_satz,
            p_lieferant_firma_id, v_ea, NULLIF(btrim(p_notizen), ''))
    RETURNING id INTO v_id;
  END IF;
  PERFORM set_config('s112.lager_einkauf', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lager_einkauf(uuid, text, uuid, date, numeric, text, numeric, numeric, uuid, uuid, text) FROM PUBLIC, anon;

-- Storno einer PSM-/Dünger-Lagerbuchung: Einkauf mit Ausgabe zuerst die Ausgabe (Gegenbuchung), dann die Lagerbuchung
CREATE OR REPLACE FUNCTION public.s112_lager_einkauf_stornieren(p_tenant_id uuid, p_art text, p_id uuid, p_grund text, p_datum date DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ea      uuid;
  v_storno  timestamptz;
  v_gefunden boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden');
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  IF p_art = 'psm' THEN
    SELECT l.ea_transaktion_id, l.storniert_am, true INTO v_ea, v_storno, v_gefunden FROM public.psm_lager_bewegungen l
     WHERE l.id = p_id AND l.tenant_id = p_tenant_id FOR UPDATE;
  ELSIF p_art = 'duenger' THEN
    SELECT l.ea_transaktion_id, l.storniert_am, true INTO v_ea, v_storno, v_gefunden FROM public.duengemittel_lager_bewegungen l
     WHERE l.id = p_id AND l.tenant_id = p_tenant_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unbekannte Lagerart „%“.', coalesce(p_art, '–') USING ERRCODE = '22023';
  END IF;
  IF v_gefunden IS NOT TRUE THEN
    RAISE EXCEPTION 'Buchung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_storno IS NOT NULL THEN
    RAISE EXCEPTION 'Die Buchung ist bereits storniert.' USING ERRCODE = '42501';
  END IF;
  IF v_ea IS NOT NULL AND EXISTS (SELECT 1 FROM public.ea_transaktionen e
       WHERE e.id = v_ea AND e.tenant_id = p_tenant_id AND e.storniert_am IS NULL) THEN
    PERFORM public.s112_ea_stornieren(p_tenant_id, v_ea, btrim(p_grund), p_datum);   -- prüft Schreibmodul ea und Zeitraum
  END IF;
  PERFORM set_config('s112.lager_einkauf', '1', true);
  IF p_art = 'psm' THEN
    UPDATE public.psm_lager_bewegungen SET storniert_am = now(), storno_grund = btrim(p_grund) WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.duengemittel_lager_bewegungen SET storniert_am = now(), storno_grund = btrim(p_grund) WHERE id = p_id AND tenant_id = p_tenant_id;
  END IF;
  PERFORM set_config('s112.lager_einkauf', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lager_einkauf_stornieren(uuid, text, uuid, text, date) FROM PUBLIC, anon;
