-- KAN-150 (Folgeticket F), Etappe F1a: Stammdaten mit Bezug nur deaktivieren – Löschsperre in der Datenbank,
-- Bezugszähler, Grundstück aktiv/deaktiviert, Protokoll
--
-- Entscheidung Jörgen 26.09.2026 (3): Stammdaten mit Bewegungen werden nur deaktiviert, ohne Bezug bleibt Löschen
-- erlaubt. Bezug = berichtsrelevanter Verweis (Meldung, Weinbuch, E/A), auch von stornierten Zeilen; CRM-Aktivitäten
-- und Kostenrechnung zählen nicht (dort bleibt SET NULL). Die FKs bleiben, wie sie sind (kein RESTRICT, KAN-145 Soll 5).
--
--  1. s112_stammdaten_bezuege_intern(tabelle, id) → jsonb {Bezeichnung: Anzahl} (nur Werte > 0), Bezugsliste (Soll 1):
--       weingarten      → Maßnahmen, Lese-Einträge, Chargen, Pressungen, Traubenverkäufe (auch über seine Grundstücke)
--       grundstuecke    → Maßnahmen, Lese-Einträge, Pressungen, Traubenverkäufe
--       kontakte        → Verkäufe (Käufer oder Zustellung), Zukäufe (Lieferant oder Zustellung), Exportaufträge,
--                         Traubenverkäufe
--       firmen          → Verkäufe, Zukäufe, Exportaufträge, E/A-Buchungen, Traubenverkäufe
--       pflanzenschutzmittel, duengemittel → Maßnahmen, Lagerbuchungen
--       ea_kategorien   → E/A-Buchungen, Daueraufträge
--       ea_dauerauftraege → E/A-Buchungen, Ausführungen
--       keller_behandlungstypen → Kellerbehandlungen
--  2. Trigger a_stammdaten_loeschsperre (BEFORE DELETE, auch in der Kaskade, z. B. Ried → Grundstück): bei Bezug 42501
--     mit Klartext („… hat noch 12 Maßnahmen – bitte deaktivieren statt löschen“). Durchlass nur für Wartung
--     (s112_wartung_frei: Service-Role mit s112.loeschen_erlaubt, Demo-Reset). Ohne Bezug bleibt Löschen, wie es ist.
--  3. RPC s112_stammdaten_bezuege(p_tenant_id, p_tabelle, p_id) → jsonb für die App (Löschen oder Deaktivieren
--     anbieten); jedes aktive Mitglied des Betriebs.
--  4. grundstuecke: aktiv (Standard true) und deaktiviert_am (Pflicht, wenn inaktiv) – Frage 1: neue Spalten, status
--     bleibt unbenutzt.
--  5. Protokoll: Löschen (z_protokoll_loeschen/_truncate) an den Stammdaten außer kontakte/firmen (Frage 2, keine
--     Volldaten im Protokoll), Ändern von aktiv (Deaktivieren) dort; Umhängen von Käufer/Lieferant/Ried/DAC an
--     verkaufsposten, zukauf_posten, traubenverkauf, weinausbau, fuellungen (Soll 6).
-- Keine Datenänderung. Kein session_replication_role (KAN-124).

-- 1. Bezugszähler (intern) ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_stammdaten_bezuege_intern(p_tabelle text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  CASE p_tabelle
    WHEN 'weingarten' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM (
            SELECT b.id FROM public.behandlungen b WHERE b.weingarten_id = p_id
            UNION SELECT bg.behandlung_id FROM public.behandlung_grundstuecke bg
                    JOIN public.grundstuecke g ON g.id = bg.grundstueck_id WHERE g.weingarten_id = p_id) x),
        'Lese-Einträge', (SELECT count(*) FROM public.ernte_parzellen e
            WHERE e.weingarten_id = p_id OR e.grundstueck_id IN (SELECT g.id FROM public.grundstuecke g WHERE g.weingarten_id = p_id)),
        'Chargen', (SELECT count(*) FROM (
            SELECT w.id FROM public.weinausbau w WHERE w.weingarten_id = p_id
            UNION SELECT ww.weinausbau_id FROM public.weinausbau_weingaerten ww WHERE ww.weingarten_id = p_id) x),
        'Pressungen', (SELECT count(DISTINCT pw.pressung_id) FROM public.pressung_weingaerten pw
            WHERE pw.weingarten_id = p_id OR pw.grundstueck_id IN (SELECT g.id FROM public.grundstuecke g WHERE g.weingarten_id = p_id)),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t
            WHERE t.weingarten_id = p_id OR t.grundstueck_id IN (SELECT g.id FROM public.grundstuecke g WHERE g.weingarten_id = p_id)));
    WHEN 'grundstuecke' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(DISTINCT bg.behandlung_id) FROM public.behandlung_grundstuecke bg WHERE bg.grundstueck_id = p_id),
        'Lese-Einträge', (SELECT count(*) FROM public.ernte_parzellen e WHERE e.grundstueck_id = p_id),
        'Pressungen', (SELECT count(DISTINCT pw.pressung_id) FROM public.pressung_weingaerten pw WHERE pw.grundstueck_id = p_id),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t WHERE t.grundstueck_id = p_id));
    WHEN 'kontakte' THEN
      v := jsonb_build_object(
        'Verkäufe', (SELECT count(*) FROM public.verkaufsposten vp WHERE vp.kontakt_id = p_id OR vp.zh_kontakt_id = p_id),
        'Zukäufe', (SELECT count(*) FROM public.zukauf_posten z WHERE z.lieferant_kontakt_id = p_id OR z.zh_kontakt_id = p_id),
        'Exportaufträge', (SELECT count(*) FROM public.exportauftraege x WHERE x.kontakt_id = p_id),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t WHERE t.kontakt_id = p_id));
    WHEN 'firmen' THEN
      v := jsonb_build_object(
        'Verkäufe', (SELECT count(*) FROM public.verkaufsposten vp WHERE vp.firma_id = p_id),
        'Zukäufe', (SELECT count(*) FROM public.zukauf_posten z WHERE z.lieferant_firma_id = p_id),
        'Exportaufträge', (SELECT count(*) FROM public.exportauftraege x WHERE x.firma_id = p_id),
        'E/A-Buchungen', (SELECT count(*) FROM public.ea_transaktionen e WHERE e.firma_id = p_id),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t WHERE t.firma_id = p_id));
    WHEN 'pflanzenschutzmittel' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM public.behandlungen b WHERE b.psm_id = p_id),
        'Lagerbuchungen', (SELECT count(*) FROM public.psm_lager_bewegungen l WHERE l.psm_id = p_id));
    WHEN 'duengemittel' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM public.behandlungen b WHERE b.duengemittel_id = p_id),
        'Lagerbuchungen', (SELECT count(*) FROM public.duengemittel_lager_bewegungen l WHERE l.duengemittel_id = p_id));
    WHEN 'ea_kategorien' THEN
      v := jsonb_build_object(
        'E/A-Buchungen', (SELECT count(*) FROM public.ea_transaktionen e WHERE e.kategorie_id = p_id),
        'Daueraufträge', (SELECT count(*) FROM public.ea_dauerauftraege d WHERE d.kategorie_id = p_id));
    WHEN 'ea_dauerauftraege' THEN
      v := jsonb_build_object(
        'E/A-Buchungen', (SELECT count(*) FROM public.ea_transaktionen e WHERE e.dauerauftrag_id = p_id),
        'Ausführungen', (SELECT count(*) FROM public.ea_dauerauftrag_log l WHERE l.dauerauftrag_id = p_id));
    WHEN 'keller_behandlungstypen' THEN
      v := jsonb_build_object(
        'Kellerbehandlungen', (SELECT count(*) FROM public.keller_behandlungen k WHERE k.typ_id = p_id));
    ELSE
      RAISE EXCEPTION 'Für „%“ gibt es keine Bezugsliste.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END CASE;
  RETURN COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(v) e WHERE (e.value)::bigint > 0), '{}'::jsonb);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_stammdaten_bezuege_intern(text, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Löschsperre ────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_stammdaten_loeschsperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt   jsonb := to_jsonb(OLD);
  v_bez   jsonb;
  v_name  text;
  v_liste text;
BEGIN
  IF public.s112_wartung_frei((v_alt ->> 'tenant_id')::uuid) THEN
    RETURN OLD;
  END IF;
  v_bez := public.s112_stammdaten_bezuege_intern(TG_TABLE_NAME, OLD.id);
  IF v_bez = '{}'::jsonb THEN
    RETURN OLD;
  END IF;
  v_name := COALESCE(
    NULLIF(btrim(v_alt ->> 'name'), ''),
    NULLIF(btrim(concat_ws(' ', v_alt ->> 'vorname', v_alt ->> 'nachname')), ''),
    CASE WHEN v_alt ? 'gst_nr' THEN 'Grundstück ' || COALESCE(v_alt ->> 'gst_nr', '') END,
    NULLIF(btrim(v_alt ->> 'beschreibung'), ''),
    TG_TABLE_NAME);
  SELECT string_agg(e.value || ' ' || e.key, ', ' ORDER BY e.key) INTO v_liste FROM jsonb_each_text(v_bez) e;
  RAISE EXCEPTION '„%“ hat noch % – bitte deaktivieren statt löschen.', v_name, v_liste USING ERRCODE = '42501';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_stammdaten_loeschsperre() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['weingarten', 'grundstuecke', 'kontakte', 'firmen', 'pflanzenschutzmittel', 'duengemittel',
                           'ea_kategorien', 'ea_dauerauftraege', 'keller_behandlungstypen'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_stammdaten_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_stammdaten_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_stammdaten_loeschsperre()', t);
  END LOOP;
END $$;

-- 3. RPC für die App ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_stammdaten_bezuege(p_tenant_id uuid, p_tabelle text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_da boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (ARRAY['weingarten', 'grundstuecke', 'kontakte', 'firmen', 'pflanzenschutzmittel',
       'duengemittel', 'ea_kategorien', 'ea_dauerauftraege', 'keller_behandlungstypen'])) THEN
    RAISE EXCEPTION 'Für „%“ gibt es keine Bezugsliste.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END IF;
  -- nur Zeilen des eigenen Betriebs (keine fremden IDs abfragen)
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND tenant_id = $2)', p_tabelle) INTO v_da USING p_id, p_tenant_id;
  IF NOT v_da THEN
    RAISE EXCEPTION 'Datensatz nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.s112_stammdaten_bezuege_intern(p_tabelle, p_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_stammdaten_bezuege(uuid, text, uuid) FROM PUBLIC, anon;

-- 4. Grundstück aktiv/deaktiviert ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.grundstuecke
  ADD COLUMN IF NOT EXISTS aktiv boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deaktiviert_am date;
ALTER TABLE public.grundstuecke DROP CONSTRAINT IF EXISTS grundstuecke_deaktiviert_check;
ALTER TABLE public.grundstuecke ADD CONSTRAINT grundstuecke_deaktiviert_check
  CHECK ((aktiv AND deaktiviert_am IS NULL) OR (NOT aktiv AND deaktiviert_am IS NOT NULL));
COMMENT ON COLUMN public.grundstuecke.aktiv IS 'KAN-150: false = deaktiviert (nicht mehr bewirtschaftet), bleibt für frühere Zeiträume in Meldungen';
COMMENT ON COLUMN public.grundstuecke.deaktiviert_am IS 'KAN-150: Stichtag der Deaktivierung – Meldungen für Zeiträume davor zählen das Grundstück noch';

-- 5. Protokoll ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['weingarten', 'grundstuecke', 'pflanzenschutzmittel', 'duengemittel', 'ea_kategorien',
                           'ea_dauerauftraege', 'keller_behandlungstypen'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['weingarten', 'pflanzenschutzmittel', 'duengemittel', 'ea_kategorien', 'ea_dauerauftraege'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF aktiv, tenant_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben(%L, %L)', t, 'aktiv', 'tenant_id');
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.grundstuecke;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF aktiv, deaktiviert_am, weingarten_id, tenant_id ON public.grundstuecke
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('aktiv', 'deaktiviert_am', 'weingarten_id', 'tenant_id');

-- Umhängen (Soll 6): bestehende Spalten bleiben, Verweise kommen dazu
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.verkaufsposten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF aktiv, storniert, storniert_am, datum, tenant_id, storniert_von, storno_grund,
    kontakt_id, firma_id, zh_kontakt_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('aktiv', 'storniert', 'storniert_am', 'datum', 'tenant_id',
    'storniert_von', 'storno_grund', 'kontakt_id', 'firma_id', 'zh_kontakt_id');
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.zukauf_posten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge, einheit, art, aktiv, ziel_weinausbau_id, datum, tenant_id, kmw, oechsle,
    mostgewicht_einheit, storniert_am, storno_grund, lieferant_kontakt_id, lieferant_firma_id, zh_kontakt_id ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge', 'einheit', 'art', 'aktiv', 'ziel_weinausbau_id', 'datum',
    'tenant_id', 'kmw', 'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund', 'lieferant_kontakt_id', 'lieferant_firma_id',
    'zh_kontakt_id');
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.traubenverkauf;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_kg, datum, jahrgang_id, weingarten_id, grundstueck_id, zukauf_posten_id,
    verkaufsposten_id, tenant_id, kmw_grad, oechsle, mostgewicht_einheit, lese_id, storniert_am, storno_grund, kontakt_id, firma_id
    ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_kg', 'datum', 'jahrgang_id', 'weingarten_id', 'grundstueck_id',
    'zukauf_posten_id', 'verkaufsposten_id', 'tenant_id', 'kmw_grad', 'oechsle', 'mostgewicht_einheit', 'lese_id', 'storniert_am',
    'storno_grund', 'kontakt_id', 'firma_id');
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.weinausbau;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge_liter, anfangsbestand_liter, behaelter_id, aktiv, status, qualitaetsstufe,
    herkunft_code, weinart, rebsorte, jahrgang, ist_eroeffnungsbestand, tenant_id, kmw, oechsle, mostgewicht_einheit, storniert_am,
    storno_grund, weingarten_id ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge_liter', 'anfangsbestand_liter', 'behaelter_id', 'aktiv',
    'status', 'qualitaetsstufe', 'herkunft_code', 'weinart', 'rebsorte', 'jahrgang', 'ist_eroeffnungsbestand', 'tenant_id', 'kmw',
    'oechsle', 'mostgewicht_einheit', 'storniert_am', 'storno_grund', 'weingarten_id');
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.fuellungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF bestand_flaschen, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, aktiv,
    weinausbau_id, datum, qualitaet, jahrgang, rebsorte, herkunft_code, pruefnummer, anbaugebiet, tenant_id, storniert_am, storno_grund,
    dac_antrag_id ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('bestand_flaschen', 'anzahl_flaschen', 'menge_liter_gefuellt',
    'flaschengroesse_ml', 'aktiv', 'weinausbau_id', 'datum', 'qualitaet', 'jahrgang', 'rebsorte', 'herkunft_code', 'pruefnummer',
    'anbaugebiet', 'tenant_id', 'storniert_am', 'storno_grund', 'dac_antrag_id');
