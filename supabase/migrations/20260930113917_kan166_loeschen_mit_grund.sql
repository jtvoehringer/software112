-- KAN-166 Etappe 1: Mitarbeiter löschen Maßnahmen und Lagerbewegungen mit Grund (dokumentiert) – ENTWURF,
-- erst nach „OK, einspielen“, zuerst Staging
--
-- Vorgabe Jörgen, 30.09.2026: Mitarbeiter (winzer) dürfen Buchungen bearbeiten (ohne Dokumentation) und löschen
-- (dokumentiert: Grund, Benutzer, Zeitpunkt). Bisher löschte bei Maßnahmen nur die Betriebsleitung (RLS), und
-- keine der drei Tabellen hatte ein Änderungsprotokoll.
--
--  1. Bestandsprotokoll für behandlungen, psm_lager_bewegungen, duengemittel_lager_bewegungen: z_protokoll_loeschen
--     (ganze Zeile), z_protokoll_aendern (fachliche Spalten) und z_protokoll_truncate – wie bei den Kellerbuch-
--     Tabellen (KAN-35). bestandsprotokoll_schreiben() bleibt unverändert (alle drei haben id und tenant_id).
--  2. s112_buchung_loeschen(p_tenant_id, p_tabelle, p_id, p_grund) – SECURITY DEFINER: Mitglied mit Rolle
--     system_admin/tenant_admin/winzer (pruefe_tenant_zugriff: aktiv, Zwei-Faktor), Schreibmodul rieden
--     (s112_darf_schreiben), Abo-Schreibsperre, Tabelle aus der Liste, Grund ≥ 10 Zeichen; löscht genau die eine Zeile
--     des Betriebs (0 Zeilen → Fehler statt stillem Nichts) und schreibt den Grund über s112.loesch_grund ins
--     Protokoll. Die GST-Zuordnung einer Maßnahme (behandlung_grundstuecke) löscht die bestehende FK-Kaskade mit.
--  Die bestehenden DELETE-Policies bleiben unverändert (direktes Löschen per API wird ab jetzt ebenfalls
--  protokolliert, nur ohne Grund).
-- Kein session_replication_role (KAN-124).

-- 1. Protokoll ─────────────────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.behandlungen;
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.behandlungen;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.behandlungen
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.behandlungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF art, datum, datum_bis, psm_id, duengemittel_id, aufwandmenge,
  aufwandmenge_einheit, menge_gesamt, menge_einheit, konzentration, wasseraufwand_l_ha, ernte_fruehesteins,
  weingarten_id, tenant_id ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('art', 'datum', 'datum_bis', 'psm_id',
  'duengemittel_id', 'aufwandmenge', 'aufwandmenge_einheit', 'menge_gesamt', 'menge_einheit', 'konzentration',
  'wasseraufwand_l_ha', 'ernte_fruehesteins', 'weingarten_id', 'tenant_id');

DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.psm_lager_bewegungen;
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.psm_lager_bewegungen;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.psm_lager_bewegungen
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.psm_lager_bewegungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF psm_id, datum, typ, menge, einheit, tenant_id
  ON public.psm_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('psm_id', 'datum', 'typ', 'menge', 'einheit', 'tenant_id');

DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.duengemittel_lager_bewegungen
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.duengemittel_lager_bewegungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF duengemittel_id, datum, typ, menge, einheit, tenant_id
  ON public.duengemittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('duengemittel_id', 'datum', 'typ', 'menge', 'einheit', 'tenant_id');

-- 2. Löschen mit Grund ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_buchung_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_tabellen constant text[] := ARRAY['behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen'];
  v_n integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  IF NOT public.s112_darf_schreiben(p_tenant_id, 'rieden') THEN
    RAISE EXCEPTION 'Für das Löschen fehlt das Schreibrecht im Modul Rieden.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (c_tabellen)) THEN
    RAISE EXCEPTION 'Löschen ist für „%“ hier nicht vorgesehen.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Löschen angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('s112.loesch_grund', btrim(p_grund), true);
  EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND tenant_id = $2', p_tabelle) USING p_id, p_tenant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('s112.loesch_grund', '', true);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Eintrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_buchung_loeschen(uuid, text, uuid, text) FROM PUBLIC, anon;

-- Selbstprüfung
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen'] LOOP
    IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = ('public.' || t)::regclass
         AND tgname IN ('z_protokoll_loeschen', 'z_protokoll_aendern', 'z_protokoll_truncate')) <> 3 THEN
      RAISE EXCEPTION 'KAN-166: Protokoll-Trigger an % unvollständig', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.s112_buchung_loeschen(uuid, text, uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_buchung_loeschen(uuid, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-166: EXECUTE-Rechte falsch';
  END IF;
END $$;
