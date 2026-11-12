-- KAN-425 Teil 1 (12.11.2026): Personendaten eines Kontakts löschen (DSGVO Art. 17).
--
-- Der Betrieb löscht auf Verlangen die Personendaten eines Kontakts. Ohne Belege geht der Kontakt samt Aktivitäten ganz;
-- mit Belegen (Verkauf, Rechnung, Zukauf, Export, Traubenverkauf – Aufbewahrung 7 Jahre, § 132 BAO) bleibt die Zeile als
-- „Gelöschter Kontakt“ mit ihrer Kundennummer stehen, alle Personendaten sind geleert. Die Belege behalten ihre
-- Momentaufnahme des Partners (partner_daten, KAN-150 F1c).
--
-- 1. kontakte.anonymisiert_am/_von/_grund.
-- 2. Schutz-Trigger: ein anonymisierter Kontakt ist unveränderlich; die Kennzeichen setzt nur die RPC.
-- 3. RPC s112_kontakt_personendaten_loeschen: eine Transaktion, Grund Pflicht, Eintrag im Änderungsprotokoll ohne Altwerte
--    (kontakte und aktivitaeten werden sonst nicht protokolliert – es entsteht keine Kopie der gelöschten Daten).
--    Liefert die Pfade der Dokumente im Speicher, die die App danach entfernt.

ALTER TABLE public.kontakte
  ADD COLUMN anonymisiert_am    timestamptz,
  ADD COLUMN anonymisiert_von   uuid,
  ADD COLUMN anonymisiert_grund text CHECK (anonymisiert_grund IS NULL OR length(anonymisiert_grund) <= 500);

COMMENT ON COLUMN public.kontakte.anonymisiert_am IS
  'Personendaten gelöscht (DSGVO, KAN-425): Zeitpunkt. Die Zeile bleibt wegen der Belege, ist danach unveränderlich; nur s112_kontakt_personendaten_loeschen setzt das Kennzeichen.';

-- ── 2. Schutz ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_kontakt_anonymisiert_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('s112.kontakt_frei', true), '') = 'ja' OR coalesce(public.s112_wartung_frei(NEW.tenant_id), false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.anonymisiert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Personendaten dieses Kontakts wurden gelöscht (DSGVO) – der Kontakt lässt sich nicht mehr ändern.'
      USING ERRCODE = '42501', HINT = 'anonymisiert';
  END IF;
  IF NEW.anonymisiert_am IS NOT NULL OR NEW.anonymisiert_von IS NOT NULL OR NEW.anonymisiert_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Das Kennzeichen „Personendaten gelöscht“ setzt nur die Funktion „Personendaten löschen“.'
      USING ERRCODE = '42501', HINT = 'anonymisiert';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_kontakt_anonymisiert_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_anonymisiert_schutz
  BEFORE INSERT OR UPDATE ON public.kontakte
  FOR EACH ROW EXECUTE FUNCTION public.s112_kontakt_anonymisiert_schutz();

-- ── 3. Personendaten löschen ────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_kontakt_personendaten_loeschen(p_tenant_id uuid, p_kontakt_id uuid, p_grund text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_k       public.kontakte%ROWTYPE;
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_belege  boolean;
  v_dateien text[];
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'crm');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Löschen angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  IF length(v_grund) > 500 THEN
    RAISE EXCEPTION 'Der Grund darf höchstens 500 Zeichen lang sein.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_k FROM public.kontakte WHERE id = p_kontakt_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kontakt nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_k.anonymisiert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Personendaten dieses Kontakts wurden bereits gelöscht.' USING ERRCODE = '23514';
  END IF;

  v_belege := public.s112_stammdaten_bezuege_intern('kontakte', p_kontakt_id) <> '{}'::jsonb
              OR EXISTS (SELECT 1 FROM public.rechnungen r WHERE r.kontakt_id = p_kontakt_id OR r.zh_kontakt_id = p_kontakt_id);

  -- Belege zeigen den Partner aus ihrer Momentaufnahme. Fehlt sie (Altzeilen), ginge mit den Stammdaten der Name auf
  -- dem Beleg verloren – dann nicht löschen, sondern klären.
  IF v_belege AND (
       EXISTS (SELECT 1 FROM public.verkaufsposten x WHERE (x.kontakt_id = p_kontakt_id OR x.zh_kontakt_id = p_kontakt_id) AND x.partner_daten IS NULL)
    OR EXISTS (SELECT 1 FROM public.rechnungen x WHERE (x.kontakt_id = p_kontakt_id OR x.zh_kontakt_id = p_kontakt_id) AND x.partner_daten IS NULL)
    OR EXISTS (SELECT 1 FROM public.zukauf_posten x WHERE (x.lieferant_kontakt_id = p_kontakt_id OR x.zh_kontakt_id = p_kontakt_id) AND x.partner_daten IS NULL)
    OR EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.kontakt_id = p_kontakt_id AND x.partner_daten IS NULL)
    OR EXISTS (SELECT 1 FROM public.traubenverkauf x WHERE x.kontakt_id = p_kontakt_id AND x.partner_daten IS NULL)) THEN
    RAISE EXCEPTION 'Zu diesem Kontakt gibt es ältere Belege ohne gespeicherte Partnerdaten – die Personendaten lassen sich erst löschen, wenn das geklärt ist. Bitte an den Support wenden.'
      USING ERRCODE = '23514', HINT = 'momentaufnahme_fehlt';
  END IF;

  SELECT coalesce(array_agg(d.storage_pfad), '{}') INTO v_dateien
    FROM public.aktivitaet_dokumente d JOIN public.aktivitaeten a ON a.id = d.aktivitaet_id
   WHERE a.kontakt_id = p_kontakt_id AND a.tenant_id = p_tenant_id AND d.storage_pfad IS NOT NULL;

  DELETE FROM public.aktivitaeten WHERE kontakt_id = p_kontakt_id AND tenant_id = p_tenant_id;   -- Dokument-Zeilen per Kaskade
  DELETE FROM public.pipeline_eintraege WHERE kontakt_id = p_kontakt_id AND tenant_id = p_tenant_id;
  DELETE FROM public.lieferadressen WHERE kontakt_id = p_kontakt_id AND tenant_id = p_tenant_id;
  DELETE FROM public.kontakt_firmen WHERE kontakt_id = p_kontakt_id;
  DELETE FROM public.kontakt_praeferenzen WHERE kontakt_id = p_kontakt_id;
  DELETE FROM public.datenschutz_consents WHERE kontakt_id = p_kontakt_id AND tenant_id = p_tenant_id;
  DELETE FROM public.verkauf_ki_begriffe WHERE kontakt_id = p_kontakt_id AND tenant_id = p_tenant_id;

  IF v_belege THEN
    PERFORM set_config('s112.kontakt_frei', 'ja', true);
    UPDATE public.kontakte SET
      vorname = NULL, nachname = 'Gelöschter Kontakt', titel = NULL, titel_nachgestellt = NULL, position = NULL,
      firma_id = NULL, email = NULL, email_weitere = '{}', telefon = NULL, telefon_vorwahl = NULL, mobil = NULL, mobil_vorwahl = NULL,
      strasse = NULL, plz = NULL, ort = NULL, land = NULL, geburtsdatum = NULL, notizen = NULL, betrieb_nr = NULL,
      weingut_ansprechpartner = NULL, quelle = NULL,
      newsletter = false, newsletter_bestaetigt = false, newsletter_opt_in_am = NULL, newsletter_token_hash = NULL,
      stammkunde = false, is_lead = false, rabattgruppe_id = NULL, aktiv = false,
      anonymisiert_am = now(), anonymisiert_von = (SELECT auth.uid()), anonymisiert_grund = v_grund, aktualisiert_am = now()
    WHERE id = p_kontakt_id AND tenant_id = p_tenant_id;
    PERFORM set_config('s112.kontakt_frei', '', true);
  ELSE
    DELETE FROM public.kontakte WHERE id = p_kontakt_id AND tenant_id = p_tenant_id;
  END IF;

  -- Nachweis ohne Altwerte: wer, wann, warum, welche Kundennummer
  INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, aktion, datensatz_id, benutzer_id, db_rolle, kennung, grund)
  VALUES (p_tenant_id, 'kontakte', CASE WHEN v_belege THEN 'UPDATE' ELSE 'DELETE' END, p_kontakt_id, (SELECT auth.uid()),
          coalesce(NULLIF(current_setting('role', true), 'none'), session_user::text),
          jsonb_build_object('vorgang', 'personendaten_geloescht', 'kundennummer', v_k.accountnummer),
          v_grund);

  RETURN jsonb_build_object('art', CASE WHEN v_belege THEN 'anonymisiert' ELSE 'geloescht' END, 'dateien', to_jsonb(v_dateien));
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_kontakt_personendaten_loeschen(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_kontakt_personendaten_loeschen(uuid, uuid, text) TO authenticated, service_role;
