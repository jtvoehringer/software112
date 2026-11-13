-- KAN-455 (13.11.2026): Rollen/Rechte R3 – Lesewege an den Sperr-Policies vorbei (Funktionen, KI-Abfrage, Storage).
--
-- Seit KAN-454 sperren die Tabellen das Lesen je Profil (Policy „lesebereich“). SECURITY-DEFINER-Funktionen und der
-- Storage laufen daran vorbei. Diese Migration schließt das in der Datenbank:
--   1. Helfer s112_pruefe_lesen(tenant, bereich): 42501 mit HINT lesebereich (nur für Aufrufe aus Funktionen)
--   2. Leseprüfung in den lesenden Funktionen und in den schreibenden, die ein Profil über sein Schreibmodul erreicht,
--      obwohl der Bereich für es gesperrt ist (z. B. „Extern“ mit Modul Rieden → Einkauf von Pflanzenschutzmitteln)
--   3. s112_stammdaten_bezuege: Bereich je Tabelle
--   4. KI-Abfrage: Bereich ki (die Abfrage selbst läuft als Rolle ki_abfrage unter den Policies – geprüft auf Staging)
--   5. Storage: Sperr-Policy „lesebereich“ auf storage.objects, Bereich je Bucket
-- Offen bleibt bewusst pruefe_ea_zeitraum_offen (nur „offen/gesperrt“ samt Grund; der Verkauf braucht es).
-- Wirkung heute: keine – niemand hat ein Profil (Vergabe KAN-457). Service-Role und SQL-Editor passieren die Prüfung.
-- Entscheidungen Jörgen 13.11.2026 (Jira KAN-455, Fragen 1 und 2 jeweils A).

-- 1. Helfer ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_pruefe_lesen(p_tenant_id uuid, p_bereich text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.s112_darf_lesen(p_tenant_id, p_bereich) THEN
    RAISE EXCEPTION 'Für diesen Bereich fehlt das Leserecht.' USING ERRCODE = '42501', HINT = 'lesebereich';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pruefe_lesen(uuid, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_pruefe_lesen(uuid, text) IS
  'KAN-455: Leseprüfung je Profil für SECURITY-DEFINER-Funktionen – 42501 mit HINT lesebereich, wenn der Bereich im Betrieb für den Benutzer gesperrt ist';

-- 2. Leseprüfung in bestehenden Funktionen (Quelltext unverändert bis auf die eingefügte Zeile bzw. Bedingung) ───────────
DO $kan412c$
DECLARE
  r     record;
  v_oid oid;
  v_alt text;
  v_neu text;
  c_ptz constant text := '(PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id[^;]*;)';
  c_sql constant text := 'NOT public.s112_betrieb_gesperrt(p_tenant_id))';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('berechne_ea_uva', 'ea'),
    ('journal_konsistenz', 'keller'),
    ('journal_abgleichen', 'keller'),
    ('s112_schwund_minderung', 'keller'),
    ('schwund_buchen', 'keller'),
    ('s112_ama_einreichen', 'lese'),
    ('s112_ama_korrektur_anlegen', 'lese'),
    ('s112_ama_meldung_speichern', 'lese'),
    ('s112_ama_status_setzen', 'lese'),
    ('s112_mostzeile_anlegen', 'lese'),
    ('s112_pressung_anlegen', 'lese'),
    ('s112_pressung_stornieren', 'lese'),
    ('s112_pressung_zeilen_stornieren', 'lese'),
    ('s112_betriebsmittel_einkauf', 'betriebsmittel'),
    ('s112_betriebsmittel_stornieren', 'betriebsmittel'),
    ('s112_lager_einkauf', 'betriebsmittel'),
    ('s112_lager_einkauf_stornieren', 'betriebsmittel'),
    ('s112_psm_uebermittlung_protokollieren', 'betriebsmittel'),
    ('s112_verkauf_samt_rechnung_stornieren', 'verkauf')
  ) AS t(funktion, bereich) LOOP
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.funktion;
    v_alt := pg_get_functiondef(v_oid);
    IF v_alt ~ 's112_pruefe_lesen' THEN RAISE EXCEPTION 'KAN-455: % prüft das Leserecht schon', r.funktion; END IF;
    IF v_alt !~ c_ptz THEN RAISE EXCEPTION 'KAN-455: % ohne Anker pruefe_tenant_zugriff', r.funktion; END IF;
    v_neu := regexp_replace(v_alt, c_ptz, format(E'\\1\n  PERFORM public.s112_pruefe_lesen(p_tenant_id, %L);   -- KAN-455: Lesebereich je Profil', r.bereich));
    IF (length(v_neu) - length(replace(v_neu, 's112_pruefe_lesen', ''))) / length('s112_pruefe_lesen') <> 1 THEN
      RAISE EXCEPTION 'KAN-455: % – Prüfung nicht genau einmal eingefügt', r.funktion;
    END IF;
    EXECUTE v_neu;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('crm_dubletten', 'crm'),
    ('crm_filterwerte', 'crm'),
    ('crm_zaehler', 'crm'),
    ('lade_crmgemeinschaft', 'crm'),
    ('lade_behaelter', 'keller'),
    ('lade_kellergemeinschaft', 'keller')
  ) AS t(funktion, bereich) LOOP
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.funktion;
    v_alt := pg_get_functiondef(v_oid);
    IF v_alt ~ 's112_darf_lesen' THEN RAISE EXCEPTION 'KAN-455: % prüft das Leserecht schon', r.funktion; END IF;
    IF (length(v_alt) - length(replace(v_alt, c_sql, ''))) / length(c_sql) <> 1 THEN
      RAISE EXCEPTION 'KAN-455: % – Anker der Mitgliedsprüfung nicht genau einmal', r.funktion;
    END IF;
    v_neu := replace(v_alt, c_sql, format('NOT public.s112_betrieb_gesperrt(p_tenant_id) /* KAN-455 */ AND public.s112_darf_lesen(p_tenant_id, %L))', r.bereich));
    EXECUTE v_neu;
  END LOOP;

  -- 3. Bezugsliste der Stammdaten: Bereich der abgefragten Tabelle
  v_alt := pg_get_functiondef('public.s112_stammdaten_bezuege(uuid, text, uuid)'::regprocedure);
  v_neu := replace(v_alt, '  -- nur Zeilen des eigenen Betriebs (keine fremden IDs abfragen)',
    $neu$  -- KAN-455: Lesebereich der Tabelle je Profil
  PERFORM public.s112_pruefe_lesen(p_tenant_id, CASE
    WHEN p_tabelle IN ('weingarten', 'grundstuecke') THEN 'rieden'
    WHEN p_tabelle IN ('kontakte', 'firmen') THEN 'crm'
    WHEN p_tabelle IN ('pflanzenschutzmittel', 'duengemittel', 'betriebsmittel') THEN 'betriebsmittel'
    WHEN p_tabelle IN ('ea_kategorien', 'ea_dauerauftraege') THEN 'ea'
    ELSE 'keller' END);
  -- nur Zeilen des eigenen Betriebs (keine fremden IDs abfragen)$neu$);
  IF v_neu = v_alt OR v_alt ~ 's112_pruefe_lesen' THEN RAISE EXCEPTION 'KAN-455: s112_stammdaten_bezuege – Anker fehlt'; END IF;
  EXECUTE v_neu;

  -- 4. KI-Abfrage: Bereich ki. Die Funktion gehört der Rolle ki_abfrage (Mitglied von authenticated) – deshalb die für
  --    authenticated ausführbare Prüfung s112_darf_lesen statt des internen Helfers.
  v_alt := pg_get_functiondef('public.ki_readonly_query(text, uuid)'::regprocedure);
  v_neu := replace(v_alt, '  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);',
    $neu$  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  IF NOT public.s112_darf_lesen(p_tenant_id, 'ki') THEN   -- KAN-455: Lesebereich je Profil
    RAISE EXCEPTION 'Für diesen Bereich fehlt das Leserecht.' USING ERRCODE = '42501', HINT = 'lesebereich';
  END IF;$neu$);
  IF v_neu = v_alt OR v_alt ~ 's112_darf_lesen' THEN RAISE EXCEPTION 'KAN-455: ki_readonly_query – Anker fehlt'; END IF;
  EXECUTE v_neu;
END
$kan412c$;

-- 5. Storage: Dateien eines Betriebs nur mit dem Lesebereich des Buckets ────────────────────────────────────────────
--    Ordner = Betrieb (<tenant_id>/…). mandant-logos bleibt öffentlich. Ohne Profil ist keine Menge gesperrt.
CREATE POLICY lesebereich ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (bucket_id <> 'aktivitaet-dokumente' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('crm') g)))
  AND
  (bucket_id <> 'analysen' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('keller') g)))
  AND
  (bucket_id <> 'dokumente' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('betrieb') g)))
  AND
  (bucket_id <> 'ea-belege' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('ea') g)))
  AND
  (bucket_id <> 'etiketten' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('lager') g)))
  AND
  (bucket_id <> 'export-nachweise' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('verkauf') g)))
  AND
  (bucket_id <> 'fuellung-bilder' OR (storage.foldername(name))[1] IS NULL OR NOT ((storage.foldername(name))[1] IN (SELECT g::text FROM public.s112_lesegesperrte_tenants('lager') g)))
);
