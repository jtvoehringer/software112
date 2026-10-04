-- KAN-178 (04.10.2026): Mandantentrennung – 92 Fremdverweise (FK ohne Mandantenprüfung, DB-Test 11 B2) absichern.
-- Entscheidung Jörgen (04.10.2026): EIN Prüf-Trigger für alle Spalten statt Verbund-FKs (spalte, tenant_id) – ein
-- Verbund-FK ersetzt die einspaltige FK und bricht die PostgREST-Einbettungen der App (Spalten-Hinweise wie
-- kontakte!kontakt_id gelten nur für einspaltige FKs; beide FKs nebeneinander machen jede Einbettung mehrdeutig).
-- FKs und API-Beziehungen bleiben unverändert. Eine Migration statt fünf Etappen (gleiches, generiertes Muster).
--   s112_fremdverweis_pruefen(spalte, ziel, modus, eltern_spalte, eltern): BEFORE INSERT/UPDATE, SECURITY DEFINER
--   (liest Ziel und Eltern ohne RLS). Der Verweis muss zum eigenen Betrieb gehören:
--     ''        Ziel.tenant_id = eigener Betrieb
--     'global'  zusätzlich globale Zeilen (tenant_id NULL): PSM, Düngemittel, E&A-Kategorien
--     'keller'  zusätzlich gemeinsame Behälter eines Partners der Kellergemeinschaft (aktive keller_freigaben,
--               wie weinausbau_gebinde_pruefen; Ausnahme aus KAN-68)
--   Eigener Betrieb = NEW.tenant_id bzw. bei Kindtabellen ohne tenant_id die tenant_id der Elternzeile.
--   Geprüft wird beim Anlegen und wenn sich Verweis, tenant_id bzw. Elternverweis ändern; NULL ist frei.
-- Stand 04.10.2026: 0 bestehende Fremdverweise in Produktion und Staging (Prüfabfrage je Spalte).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE OR REPLACE FUNCTION public.s112_fremdverweis_pruefen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_spalte        text := TG_ARGV[0];
  v_ziel          text := TG_ARGV[1];
  v_modus         text := coalesce(TG_ARGV[2], '');
  v_eltern_spalte text := nullif(coalesce(TG_ARGV[3], ''), '');
  v_eltern        text := nullif(coalesce(TG_ARGV[4], ''), '');
  v_neu           jsonb := to_jsonb(NEW);
  v_alt           jsonb;
  v_id            uuid := (v_neu ->> v_spalte)::uuid;
  v_eigen         uuid;
  v_fremd         uuid;
  v_gefunden      boolean;
BEGIN
  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    IF (v_neu ->> v_spalte) IS NOT DISTINCT FROM (v_alt ->> v_spalte)
       AND (v_neu ->> coalesce(v_eltern_spalte, 'tenant_id')) IS NOT DISTINCT FROM (v_alt ->> coalesce(v_eltern_spalte, 'tenant_id')) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_eltern IS NULL THEN
    v_eigen := (v_neu ->> 'tenant_id')::uuid;
  ELSE
    EXECUTE format('SELECT p.tenant_id FROM public.%I p WHERE p.id = $1', v_eltern)
      INTO v_eigen USING (v_neu ->> v_eltern_spalte)::uuid;
  END IF;
  IF v_eigen IS NULL THEN
    RETURN NEW;   -- Elternzeile fehlt: meldet die FK selbst
  END IF;

  EXECUTE format('SELECT true, z.tenant_id FROM public.%I z WHERE z.id = $1', v_ziel) INTO v_gefunden, v_fremd USING v_id;
  IF v_gefunden IS NULL OR v_fremd = v_eigen THEN
    RETURN NEW;   -- fehlendes Ziel meldet die FK selbst
  END IF;
  IF v_modus = 'global' AND v_fremd IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_modus = 'keller' AND EXISTS (
       SELECT 1 FROM public.behaelter b
         JOIN public.keller_freigaben f ON f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = v_eigen AND f.aktiv
        WHERE b.id = v_id AND b.gemeinsam) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Verweis auf einen Datensatz eines anderen Betriebs (%.% → %).', TG_TABLE_NAME, v_spalte, v_ziel
    USING ERRCODE = '42501', HINT = 'fremdverweis';
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fremdverweis_pruefen() FROM PUBLIC, anon, authenticated;

-- ── Trigger je Spalte (z_…: nach den übrigen BEFORE-Triggern, die NEW noch ergänzen) ─────────────────────
CREATE TRIGGER z_fremdverweis_aktivitaet_id BEFORE INSERT OR UPDATE OF aktivitaet_id, tenant_id ON public.aktivitaet_dokumente
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('aktivitaet_id', 'aktivitaeten', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.aktivitaeten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.aktivitaeten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, behandlung_id ON public.behandlung_grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('grundstueck_id', 'grundstuecke', '', 'behandlung_id', 'behandlungen');
CREATE TRIGGER z_fremdverweis_duengemittel_id BEFORE INSERT OR UPDATE OF duengemittel_id, tenant_id ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('duengemittel_id', 'duengemittel', 'global', '', '');
CREATE TRIGGER z_fremdverweis_psm_id BEFORE INSERT OR UPDATE OF psm_id, tenant_id ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('psm_id', 'pflanzenschutzmittel', 'global', '', '');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, bestellung_id ON public.bestellung_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', 'bestellung_id', 'bestellungen');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.bestellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.bestellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_checkliste_id BEFORE INSERT OR UPDATE OF checkliste_id, tenant_id ON public.checklisten_punkte
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('checkliste_id', 'checklisten', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_duengemittel_id BEFORE INSERT OR UPDATE OF duengemittel_id, tenant_id ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('duengemittel_id', 'duengemittel', 'global', '', '');
CREATE TRIGGER z_fremdverweis_ea_transaktion_id BEFORE INSERT OR UPDATE OF ea_transaktion_id, tenant_id ON public.ea_belege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ea_transaktion_id', 'ea_transaktionen', '', '', '');
CREATE TRIGGER z_fremdverweis_kategorie_id BEFORE INSERT OR UPDATE OF kategorie_id, tenant_id ON public.ea_dauerauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kategorie_id', 'ea_kategorien', 'global', '', '');
CREATE TRIGGER z_fremdverweis_konto_id BEFORE INSERT OR UPDATE OF konto_id, tenant_id ON public.ea_dauerauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('konto_id', 'konten', '', '', '');
CREATE TRIGGER z_fremdverweis_bmd_export_id BEFORE INSERT OR UPDATE OF bmd_export_id, tenant_id ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('bmd_export_id', 'buchhaltung_export_protokoll', '', '', '');
CREATE TRIGGER z_fremdverweis_dauerauftrag_id BEFORE INSERT OR UPDATE OF dauerauftrag_id, tenant_id ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('dauerauftrag_id', 'ea_dauerauftraege', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_kategorie_id BEFORE INSERT OR UPDATE OF kategorie_id, tenant_id ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kategorie_id', 'ea_kategorien', 'global', '', '');
CREATE TRIGGER z_fremdverweis_konto_id BEFORE INSERT OR UPDATE OF konto_id, tenant_id ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('konto_id', 'konten', '', '', '');
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');
CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, jahrgang_id ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('grundstueck_id', 'grundstuecke', '', 'jahrgang_id', 'weinjahrgaenge');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, jahrgang_id ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', 'jahrgang_id', 'weinjahrgaenge');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_fullung_id BEFORE INSERT OR UPDATE OF fullung_id, exportauftrag_id ON public.exportauftrag_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fullung_id', 'fuellungen', '', 'exportauftrag_id', 'exportauftraege');
CREATE TRIGGER z_fremdverweis_rabattgruppe_id BEFORE INSERT OR UPDATE OF rabattgruppe_id, tenant_id ON public.firmen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('rabattgruppe_id', 'rabattgruppen', '', '', '');
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.fuellung_chargen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.fuellung_chargen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_dac_antrag_id BEFORE INSERT OR UPDATE OF dac_antrag_id, tenant_id ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('dac_antrag_id', 'dac_antrag', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id BEFORE INSERT OR UPDATE OF behaelter_id, tenant_id ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id', 'behaelter', 'keller', '', '');
CREATE TRIGGER z_fremdverweis_typ_id BEFORE INSERT OR UPDATE OF typ_id, tenant_id ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('typ_id', 'keller_behandlungstypen', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_nach_behaelter_id BEFORE INSERT OR UPDATE OF nach_behaelter_id, tenant_id ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('nach_behaelter_id', 'behaelter', 'keller', '', '');
CREATE TRIGGER z_fremdverweis_nach_weinausbau_id BEFORE INSERT OR UPDATE OF nach_weinausbau_id, tenant_id ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('nach_weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_von_behaelter_id BEFORE INSERT OR UPDATE OF von_behaelter_id, tenant_id ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('von_behaelter_id', 'behaelter', 'keller', '', '');
CREATE TRIGGER z_fremdverweis_von_weinausbau_id BEFORE INSERT OR UPDATE OF von_weinausbau_id, tenant_id ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('von_weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id BEFORE INSERT OR UPDATE OF behaelter_id, tenant_id ON public.kellerplan_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id', 'behaelter', 'keller', '', '');
CREATE TRIGGER z_fremdverweis_kellerplan_id BEFORE INSERT OR UPDATE OF kellerplan_id, tenant_id ON public.kellerplan_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kellerplan_id', 'kellerplaene', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, kontakt_id ON public.kontakt_firmen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', 'kontakt_id', 'kontakte');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.kontakte
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_rabattgruppe_id BEFORE INSERT OR UPDATE OF rabattgruppe_id, tenant_id ON public.kontakte
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('rabattgruppe_id', 'rabattgruppen', '', '', '');
CREATE TRIGGER z_fremdverweis_nach_konto_id BEFORE INSERT OR UPDATE OF nach_konto_id, tenant_id ON public.konto_umbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('nach_konto_id', 'konten', '', '', '');
CREATE TRIGGER z_fremdverweis_von_konto_id BEFORE INSERT OR UPDATE OF von_konto_id, tenant_id ON public.konto_umbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('von_konto_id', 'konten', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id BEFORE INSERT OR UPDATE OF behaelter_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id', 'behaelter', 'keller', '', '');
CREATE TRIGGER z_fremdverweis_behandlung_id BEFORE INSERT OR UPDATE OF behandlung_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behandlung_id', 'behandlungen', '', '', '');
CREATE TRIGGER z_fremdverweis_kostenart_id BEFORE INSERT OR UPDATE OF kostenart_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kostenart_id', 'kostenarten', '', '', '');
CREATE TRIGGER z_fremdverweis_kostenstelle_id BEFORE INSERT OR UPDATE OF kostenstelle_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kostenstelle_id', 'kostenstellen', '', '', '');
CREATE TRIGGER z_fremdverweis_ried_id BEFORE INSERT OR UPDATE OF ried_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ried_id', 'lagen', '', '', '');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.kosteneintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id BEFORE INSERT OR UPDATE OF behaelter_id, kosteneintrag_id ON public.kosteneintrag_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id', 'behaelter', 'keller', 'kosteneintrag_id', 'kosteneintraege');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, kosteneintrag_id ON public.kosteneintrag_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', 'kosteneintrag_id', 'kosteneintraege');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.pipeline_eintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.pipeline_eintraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id BEFORE INSERT OR UPDATE OF behaelter_id, pressung_id ON public.pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id', 'behaelter', 'keller', 'pressung_id', 'pressungen');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, pressung_id ON public.pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', 'pressung_id', 'pressungen');
CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, pressung_id ON public.pressung_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('grundstueck_id', 'grundstuecke', '', 'pressung_id', 'pressungen');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, pressung_id ON public.pressung_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', 'pressung_id', 'pressungen');
CREATE TRIGGER z_fremdverweis_zukauf_posten_id BEFORE INSERT OR UPDATE OF zukauf_posten_id, pressung_id ON public.pressung_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zukauf_posten_id', 'zukauf_posten', '', 'pressung_id', 'pressungen');
CREATE TRIGGER z_fremdverweis_dac_antrag_id BEFORE INSERT OR UPDATE OF dac_antrag_id, tenant_id ON public.pruefnummernantraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('dac_antrag_id', 'dac_antrag', '', '', '');
CREATE TRIGGER z_fremdverweis_psm_id BEFORE INSERT OR UPDATE OF psm_id, tenant_id ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('psm_id', 'pflanzenschutzmittel', 'global', '', '');
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.sumup_checkouts
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.transportbescheinigungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('grundstueck_id', 'grundstuecke', '', '', '');
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');
CREATE TRIGGER z_fremdverweis_zukauf_posten_id BEFORE INSERT OR UPDATE OF zukauf_posten_id, tenant_id ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zukauf_posten_id', 'zukauf_posten', '', '', '');
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');
CREATE TRIGGER z_fremdverweis_traubenverkauf_id BEFORE INSERT OR UPDATE OF traubenverkauf_id, tenant_id ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('traubenverkauf_id', 'traubenverkauf', '', '', '');
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_bmd_export_id BEFORE INSERT OR UPDATE OF bmd_export_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('bmd_export_id', 'buchhaltung_export_protokoll', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_zh_kontakt_id BEFORE INSERT OR UPDATE OF zh_kontakt_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zh_kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_quell_weinausbau_id BEFORE INSERT OR UPDATE OF quell_weinausbau_id, verschneidung_id ON public.verschneidung_quellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('quell_weinausbau_id', 'weinausbau', '', 'verschneidung_id', 'verschneidungen');
CREATE TRIGGER z_fremdverweis_ziel_weinausbau_id BEFORE INSERT OR UPDATE OF ziel_weinausbau_id, tenant_id ON public.verschneidungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ziel_weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.weinanalysen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.weinausbau_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.weinausbau_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');
CREATE TRIGGER z_fremdverweis_lage_id BEFORE INSERT OR UPDATE OF lage_id, tenant_id ON public.weingarten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lage_id', 'lagen', '', '', '');
CREATE TRIGGER z_fremdverweis_konto_id BEFORE INSERT OR UPDATE OF konto_id, tenant_id ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('konto_id', 'konten', '', '', '');
CREATE TRIGGER z_fremdverweis_lieferant_firma_id BEFORE INSERT OR UPDATE OF lieferant_firma_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferant_firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_lieferant_kontakt_id BEFORE INSERT OR UPDATE OF lieferant_kontakt_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferant_kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_zh_kontakt_id BEFORE INSERT OR UPDATE OF zh_kontakt_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('zh_kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_ziel_weinausbau_id BEFORE INSERT OR UPDATE OF ziel_weinausbau_id, tenant_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('ziel_weinausbau_id', 'weinausbau', '', '', '');
