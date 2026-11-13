-- KAN-456 (13.11.2026): Rollen/Rechte R4 – Mittelauswahl für das Profil „Extern“, Morgenbericht für kein Profil.
--
-- „Extern“ erfasst Maßnahmen (Bereich massnahmen), liest aber den Bereich betriebsmittel nicht (Lager, Einkauf, Preise).
-- Ohne Mittel lässt sich keine Maßnahme erfassen – deshalb drei Funktionen, die Pflanzenschutz-, Dünge- und
-- Betriebsmittel mit allen Spalten AUSSER dem Preis liefern (Betriebsmittel auch ohne E&A-Kategorie). Die App nutzt sie
-- nur für Mitglieder ohne Leserecht auf betriebsmittel; alle anderen lesen weiter die Tabellen.
--   Zugriff: Mitglied des Betriebs (pruefe_tenant_zugriff) mit Lesebereich massnahmen (s112_pruefe_lesen).
-- Der Morgenbericht fasst Befunde aller Bereiche zusammen (Keller, Rieden, Verkauf) – die Tabelle wechselt vom Bereich
-- ki nach verwaltung (keines der Profile); die Seite ist seit PR 1 schon gesperrt.
-- Wirkung heute: keine – niemand hat ein Profil. Entscheidungen Jörgen 13.11.2026 (Jira KAN-456).

-- 1. Mittel ohne Preis ────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_psm_ohne_preis(p_tenant_id uuid)
RETURNS TABLE(id uuid, tenant_id uuid, name text, handelsname text, wirkstoff text, wirkstoffgehalt_pct numeric(6,3), zulassungsnr text, zulassungsgueltig date, kategorie text, wirkungsbereich text[], wartezeit_tage integer, max_aufwand_kg_ha numeric(8,3), max_anwendungen integer, oeko_zugelassen boolean, bienengefaehrlich boolean, gewaesserschutz boolean, sicherheitsdaten_url text, notizen text, aktiv boolean, created_at timestamp with time zone, updated_at timestamp with time zone, cu_gehalt_pct numeric(6,3), eppo_code text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  PERFORM public.s112_pruefe_lesen(p_tenant_id, 'massnahmen');
  RETURN QUERY
    SELECT m.id, m.tenant_id, m.name, m.handelsname, m.wirkstoff, m.wirkstoffgehalt_pct, m.zulassungsnr, m.zulassungsgueltig, m.kategorie, m.wirkungsbereich, m.wartezeit_tage, m.max_aufwand_kg_ha, m.max_anwendungen, m.oeko_zugelassen, m.bienengefaehrlich, m.gewaesserschutz, m.sicherheitsdaten_url, m.notizen, m.aktiv, m.created_at, m.updated_at, m.cu_gehalt_pct, m.eppo_code
      FROM public.pflanzenschutzmittel m
     WHERE m.tenant_id = p_tenant_id OR m.tenant_id IS NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_psm_ohne_preis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_psm_ohne_preis(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.s112_psm_ohne_preis(uuid) IS
  'KAN-456: Pflanzenschutzmittel des Betriebs und des Katalogs ohne preis_pro_einheit – Auswahl im Maßnahmen-Formular für Mitarbeiter, die den Bereich Betriebsmittel nicht lesen (Profil „Extern“)';

CREATE FUNCTION public.s112_duengemittel_ohne_preis(p_tenant_id uuid)
RETURNS TABLE(id uuid, tenant_id uuid, name text, handelsname text, typ text, naehrstoff_n_pct numeric(6,3), naehrstoff_p_pct numeric(6,3), naehrstoff_k_pct numeric(6,3), wartezeit_tage integer, oeko_zugelassen boolean, einarbeitung_erforderlich boolean, einheit text, notizen text, aktiv boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  PERFORM public.s112_pruefe_lesen(p_tenant_id, 'massnahmen');
  RETURN QUERY
    SELECT m.id, m.tenant_id, m.name, m.handelsname, m.typ, m.naehrstoff_n_pct, m.naehrstoff_p_pct, m.naehrstoff_k_pct, m.wartezeit_tage, m.oeko_zugelassen, m.einarbeitung_erforderlich, m.einheit, m.notizen, m.aktiv, m.created_at, m.updated_at
      FROM public.duengemittel m
     WHERE m.tenant_id = p_tenant_id OR m.tenant_id IS NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_duengemittel_ohne_preis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_duengemittel_ohne_preis(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.s112_duengemittel_ohne_preis(uuid) IS
  'KAN-456: Düngemittel des Betriebs und des Katalogs ohne preis_pro_einheit – Auswahl im Maßnahmen-Formular für Mitarbeiter, die den Bereich Betriebsmittel nicht lesen (Profil „Extern“)';

CREATE FUNCTION public.s112_betriebsmittel_ohne_preis(p_tenant_id uuid)
RETURNS TABLE(id uuid, tenant_id uuid, gruppe text, name text, einheit text, notizen text, aktiv boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  PERFORM public.s112_pruefe_lesen(p_tenant_id, 'massnahmen');
  RETURN QUERY
    SELECT m.id, m.tenant_id, m.gruppe, m.name, m.einheit, m.notizen, m.aktiv, m.created_at, m.updated_at
      FROM public.betriebsmittel m
     WHERE m.tenant_id = p_tenant_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_betriebsmittel_ohne_preis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_betriebsmittel_ohne_preis(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.s112_betriebsmittel_ohne_preis(uuid) IS
  'KAN-456: Betriebsmittel des Betriebs ohne preis_pro_einheit, ea_kategorie_id – Auswahl im Maßnahmen-Formular für Mitarbeiter, die den Bereich Betriebsmittel nicht lesen (Profil „Extern“)';

-- 2. Morgenbericht: Bereich verwaltung ────────────────────────────────────────────────────────────────────────────
DROP POLICY lesebereich ON public.morgenberichte;
CREATE POLICY lesebereich ON public.morgenberichte AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('verwaltung'))));
COMMENT ON POLICY lesebereich ON public.morgenberichte IS 'KAN-454/KAN-456: Lesebereich verwaltung – gesperrt für Profile ohne diesen Bereich';
