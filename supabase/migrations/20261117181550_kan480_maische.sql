-- KAN-480 (S2): Maische als eigene Stufe zwischen Ernte und Charge (BKI-Sitzung 16.11.2026, Rückverfolgung)
--
-- Vorgabe: n Ernten können gemeinsam gemaischt und erst nach n Tagen in n Chargen verpresst werden (Rotwein).
--
-- Umsetzung ohne neue Tabelle: Eine Maische ist eine Pressung in zwei Schritten.
--   Schritt 1 „Maische ansetzen“: Kopf (pressungen) und Traubenzeilen (pressung_weingaerten) wie bei jeder Pressung –
--     die Ernten sind damit gebunden (kg-Bilanz je Lese, Ernte-Nummer aus KAN-477) –, aber noch ohne Mostzeilen.
--     Dazu: maische_beginn, maische_behaelter_id (Gebinde aus dem Gebindeverzeichnis, gilt als belegt), maische_offen
--     und eine Nummer je Jahrgang (maische_nr, Anzeige „M 2027/1“).
--   Schritt 2 „Abpressen“: Pressdatum (pressungen.datum), Mostausbeute und Mostzeilen in n Gebinde = n Chargen wie
--     bisher (s112_mostzeile_anlegen); maische_offen wird false, die Maische ist abgeschlossen.
--   Direktpressung (Weißwein) bleibt unverändert: alle vier Spalten leer bzw. false.
--   Storno wie die Pressung (s112_pressung_stornieren); eine stornierte Maische belegt das Gebinde nicht mehr.
--
-- Schutz in der Datenbank:
--   - Nummer vergibt die Datenbank, unveränderlich (b_maische_nr).
--   - Beginn und Gebinde stehen nach dem Ansetzen fest; „offen“ lässt sich nur schließen, nie wieder öffnen;
--     ansetzen nur in ein Gebinde ohne Wein und ohne andere offene Maische (z_maische_pruefen, nach der Rechteprüfung).
--   - In ein Gebinde mit offener Maische kommt keine Charge (z_maische_gebinde an weinausbau, nach der Rechteprüfung).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Spalten ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pressungen
  ADD COLUMN maische_nr           integer,
  ADD COLUMN maische_beginn       date,
  ADD COLUMN maische_behaelter_id uuid REFERENCES public.behaelter(id),
  ADD COLUMN maische_offen        boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pressungen.maische_nr IS
  'KAN-480: laufende Nummer der Maische je Jahrgang (Anzeige „M 2027/1“); leer bei Direktpressung. Vergibt der Trigger b_maische_nr.';
COMMENT ON COLUMN public.pressungen.maische_beginn IS
  'KAN-480: Tag, an dem die Maische angesetzt wurde; leer bei Direktpressung.';
COMMENT ON COLUMN public.pressungen.maische_behaelter_id IS
  'KAN-480: Gebinde, in dem die Maische liegt bzw. lag (gilt als belegt, solange maische_offen).';
COMMENT ON COLUMN public.pressungen.maische_offen IS
  'KAN-480: true = Maische angesetzt und noch nicht abgepresst (keine Mostzeilen); beim Abpressen false.';

ALTER TABLE public.pressungen
  ADD CONSTRAINT pressungen_maische_angaben_chk CHECK (
    (maische_beginn IS NULL AND maische_behaelter_id IS NULL AND maische_nr IS NULL AND NOT maische_offen)
    OR (maische_beginn IS NOT NULL AND maische_nr IS NOT NULL AND maische_nr >= 1)),
  ADD CONSTRAINT pressungen_maische_offen_gebinde_chk CHECK (NOT maische_offen OR maische_behaelter_id IS NOT NULL),
  ADD CONSTRAINT pressungen_maische_vor_pressung_chk CHECK (maische_beginn IS NULL OR maische_beginn <= datum);

CREATE UNIQUE INDEX pressungen_jahrgang_maische_nr ON public.pressungen (jahrgang_id, maische_nr) WHERE maische_nr IS NOT NULL;
CREATE INDEX pressungen_maische_behaelter_id ON public.pressungen (maische_behaelter_id);

-- Gebinde des eigenen Betriebs oder eines Partners der Kellergemeinschaft (wie pressung_behaelter.behaelter_id)
CREATE TRIGGER z_fremdverweis_maische_behaelter_id BEFORE INSERT OR UPDATE OF maische_behaelter_id, tenant_id ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('maische_behaelter_id', 'behaelter', 'keller', '', '');

-- ── 2. Nummer der Maische ────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_maische_nummer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.maische_nr := OLD.maische_nr;   -- die Nummer bleibt, was immer der Aufrufer schickt
    RETURN NEW;
  END IF;
  IF NEW.maische_beginn IS NULL THEN
    NEW.maische_nr := NULL;             -- Direktpressung: keine Nummer
    RETURN NEW;
  END IF;
  -- nächste Nummer des Jahrgangs; die Sperre verhindert doppelte Nummern
  PERFORM 1 FROM public.weinjahrgaenge j WHERE j.id = NEW.jahrgang_id FOR NO KEY UPDATE;
  SELECT coalesce(max(p.maische_nr), 0) + 1 INTO NEW.maische_nr FROM public.pressungen p WHERE p.jahrgang_id = NEW.jahrgang_id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_maische_nummer() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_maische_nummer() IS
  'KAN-480: vergibt die laufende Nummer der Maische je Jahrgang und hält sie unveränderlich.';

-- b_…: nach a_lese_zuordnen (prüft Jahrgang und Lese), vor dem Schreiben
CREATE TRIGGER b_maische_nr BEFORE INSERT OR UPDATE OF maische_nr ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_maische_nummer();

-- ── 3. Regeln der Maische (nach der Rechteprüfung: AFTER-Trigger) ───────────────────────────────────────
CREATE FUNCTION public.s112_maische_pruefen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.maische_beginn IS DISTINCT FROM OLD.maische_beginn OR NEW.maische_behaelter_id IS DISTINCT FROM OLD.maische_behaelter_id THEN
      RAISE EXCEPTION 'Beginn und Gebinde einer Maische stehen nach dem Ansetzen fest. Bitte die Maische stornieren und neu ansetzen.'
        USING ERRCODE = '23514', HINT = 'maische_fest';
    END IF;
    IF NEW.maische_offen AND NOT OLD.maische_offen THEN
      RAISE EXCEPTION 'Eine abgepresste Maische lässt sich nicht wieder öffnen.' USING ERRCODE = '23514', HINT = 'maische_fest';
    END IF;
    RETURN NULL;
  END IF;
  -- Ansetzen: das Gebinde muss frei sein – kein Wein und keine andere offene Maische
  IF NEW.maische_offen AND NEW.storniert_am IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.pressungen p
                WHERE p.maische_behaelter_id = NEW.maische_behaelter_id AND p.maische_offen AND p.storniert_am IS NULL AND p.id <> NEW.id) THEN
      RAISE EXCEPTION 'Im gewählten Gebinde liegt bereits eine Maische. Bitte ein anderes Gebinde wählen.'
        USING ERRCODE = '23514', HINT = 'maische_gebinde';
    END IF;
    IF EXISTS (SELECT 1 FROM public.weinausbau w
                WHERE w.behaelter_id = NEW.maische_behaelter_id AND w.aktiv AND w.storniert_am IS NULL AND coalesce(w.menge_liter, 0) > 0) THEN
      RAISE EXCEPTION 'Im gewählten Gebinde liegt Wein. Eine Maische braucht ein leeres Gebinde.'
        USING ERRCODE = '23514', HINT = 'maische_gebinde';
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_maische_pruefen() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_maische_pruefen() IS
  'KAN-480: Maische nur in ein freies Gebinde; Beginn und Gebinde stehen fest; abgepresst bleibt abgepresst.';

CREATE TRIGGER z_maische_pruefen AFTER INSERT OR UPDATE OF maische_beginn, maische_behaelter_id, maische_offen ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_maische_pruefen();

-- Keine Charge in ein Gebinde, in dem eine offene Maische liegt (Pressung, Umzug, Zukauf, Import – alle Wege)
CREATE FUNCTION public.s112_maische_gebinde_belegt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.behaelter_id IS NULL OR NOT NEW.aktiv OR NEW.storniert_am IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.behaelter_id IS NOT DISTINCT FROM OLD.behaelter_id THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.pressungen p
              WHERE p.maische_behaelter_id = NEW.behaelter_id AND p.maische_offen AND p.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Im gewählten Gebinde liegt eine Maische. Bitte ein anderes Gebinde wählen oder die Maische zuerst abpressen.'
      USING ERRCODE = '23514', HINT = 'maische_gebinde';
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_maische_gebinde_belegt() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_maische_gebinde_belegt() IS
  'KAN-480: lehnt eine Charge in einem Gebinde mit offener Maische ab.';

CREATE TRIGGER z_maische_gebinde AFTER INSERT OR UPDATE OF behaelter_id ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_maische_gebinde_belegt();

-- ── 4. Pressung anlegen: Angaben der Maische übernehmen ──────────────────────────────────────────────────────
-- Unverändert bis auf die drei neuen Spalten im INSERT (maische_offen = Maische angesetzt).
CREATE OR REPLACE FUNCTION public.s112_pressung_anlegen(p_tenant_id uuid, p_kopf jsonb, p_trauben jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jahrgang uuid := NULLIF(p_kopf ->> 'jahrgang_id', '')::uuid;
  v_maische  date := NULLIF(p_kopf ->> 'maische_beginn', '')::date;
  v_id       uuid;
  v_z        jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_lesen(p_tenant_id, 'lese');   -- KAN-455: Lesebereich je Profil
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden']) THEN
    RAISE EXCEPTION 'Für das Anlegen der Pressung fehlt das Schreibrecht (Modul Kellerbuch bzw. Rieden).' USING ERRCODE = '42501';
  END IF;
  IF v_jahrgang IS NULL OR NOT EXISTS (SELECT 1 FROM public.weinjahrgaenge j WHERE j.id = v_jahrgang AND j.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Jahrgang nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(coalesce(p_trauben, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Ungültige Traubenzeilen.' USING ERRCODE = '22023';
  END IF;
  -- KAN-480: Maische braucht ein Gebinde
  IF v_maische IS NOT NULL AND NULLIF(p_kopf ->> 'maische_behaelter_id', '') IS NULL THEN
    RAISE EXCEPTION 'Bitte das Gebinde wählen, in dem die Maische liegt.' USING ERRCODE = '22023';
  END IF;
  -- Ried, Grundstück und Zukauf der Traubenzeilen gehören zum Betrieb
  FOR v_z IN SELECT x FROM jsonb_array_elements(coalesce(p_trauben, '[]'::jsonb)) x LOOP
    IF (NULLIF(v_z ->> 'weingarten_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.weingarten w
          WHERE w.id = (v_z ->> 'weingarten_id')::uuid AND w.tenant_id = p_tenant_id))
       OR (NULLIF(v_z ->> 'grundstueck_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.grundstuecke g
          WHERE g.id = (v_z ->> 'grundstueck_id')::uuid AND g.tenant_id = p_tenant_id))
       OR (NULLIF(v_z ->> 'zukauf_posten_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.zukauf_posten z
          WHERE z.id = (v_z ->> 'zukauf_posten_id')::uuid AND z.tenant_id = p_tenant_id)) THEN
      RAISE EXCEPTION 'Eine Traubenzeile verweist auf eine Ried, ein Grundstück oder einen Zukauf eines anderen Betriebs.' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, most_liter_gesamt, weinbezeichnung, kmw_grad, notizen,
                                 maische_beginn, maische_behaelter_id, maische_offen)
  VALUES (p_tenant_id, v_jahrgang, NULLIF(p_kopf ->> 'lese_id', '')::uuid, (p_kopf ->> 'datum')::date,
          NULLIF(p_kopf ->> 'most_liter_gesamt', '')::numeric, NULLIF(p_kopf ->> 'weinbezeichnung', ''),
          NULLIF(p_kopf ->> 'kmw_grad', '')::numeric, NULLIF(p_kopf ->> 'notizen', ''),
          v_maische, CASE WHEN v_maische IS NULL THEN NULL ELSE NULLIF(p_kopf ->> 'maische_behaelter_id', '')::uuid END,
          v_maische IS NOT NULL)
  RETURNING id INTO v_id;

  INSERT INTO public.pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, zukauf_posten_id, trauben_kg, rebsorte,
                                           notizen, ernte_datum, kmw, oechsle, mostgewicht_einheit)
  SELECT v_id, NULLIF(z ->> 'weingarten_id', '')::uuid, NULLIF(z ->> 'grundstueck_id', '')::uuid,
         NULLIF(z ->> 'zukauf_posten_id', '')::uuid, (z ->> 'trauben_kg')::numeric, NULLIF(z ->> 'rebsorte', ''),
         NULLIF(z ->> 'notizen', ''), NULLIF(z ->> 'ernte_datum', '')::date, NULLIF(z ->> 'kmw', '')::numeric,
         NULLIF(z ->> 'oechsle', '')::numeric, NULLIF(z ->> 'mostgewicht_einheit', '')
    FROM jsonb_array_elements(coalesce(p_trauben, '[]'::jsonb)) z;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.s112_pressung_anlegen(uuid, jsonb, jsonb) FROM PUBLIC, anon;

-- Mostzeile: nicht in eine noch offene Maische (erst abpressen = maische_offen false)
-- (s112_mostzeile_anlegen bleibt unverändert; die Regel steht als Trigger an der Mostzeile, nach der Rechteprüfung)
CREATE FUNCTION public.s112_maische_mostzeile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pressungen p WHERE p.id = NEW.pressung_id AND p.maische_offen AND p.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Die Maische ist noch nicht abgepresst. Bitte zuerst das Pressdatum und die Mostausbeute erfassen (Abpressen).'
      USING ERRCODE = '23514', HINT = 'maische_offen';
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_maische_mostzeile() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_maische_mostzeile() IS
  'KAN-480: keine Mostzeile (Charge) aus einer noch offenen Maische.';

CREATE TRIGGER z_maische_offen AFTER INSERT ON public.pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_maische_mostzeile();
