-- ── E2E-Fremdbetrieb (NUR Staging, sjpeghrlhsowmquacjhb) ─────────────────────────
--
-- Betrieb B für die Mandantentrennungs-Tests (e2e/mandantentrennung.spec.ts, STAGING_FREMDE in e2e/umgebung.ts).
-- Die E2E-Benutzer sind NICHT Mitglied – jeder Datensatz hier muss für sie unsichtbar bleiben.
-- Jeder Name beginnt mit „E2E-Fremd“, damit Suche, Listen und Exporte darauf geprüft werden können.
-- Idempotent (ON CONFLICT DO NOTHING); im SQL-Editor bzw. per Service-Role auf Staging ausführen, nie auf Produktion.
-- Keine Bewegungen (Umzüge, Pressungen …): nur Stammdaten und Kopfzeilen, damit keine Bestands-Trigger nötig sind.

DO $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL
     AND current_setting('request.jwt.claims', true) <> ''
     AND current_setting('request.jwt.claims', true)::jsonb ->> 'role' NOT IN ('service_role') THEN
    RAISE EXCEPTION 'nur Service-Role bzw. SQL-Editor';
  END IF;
END $$;

INSERT INTO public.tenants (id, name, slug, active)
VALUES ('44444444-4444-4444-8444-444444444444', 'E2E Fremdbetrieb (nur Staging)', 'e2e-fremdbetrieb', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.kontakte (id, tenant_id, vorname, nachname)
VALUES ('44444444-4444-4444-8444-000000000001', '44444444-4444-4444-8444-444444444444', 'Erika', 'E2E-Fremdkontakt')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.firmen (id, tenant_id, name)
VALUES ('44444444-4444-4444-8444-000000000002', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdfirma')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.behaelter (id, tenant_id, name, typ, volumen_liter)
VALUES ('44444444-4444-4444-8444-000000000003', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdtank', 'tank', 1000)
ON CONFLICT (id) DO NOTHING;

-- seit E2E-Ausbau 3 (11.10.2026)
INSERT INTO public.lagen (id, tenant_id, name)
VALUES ('44444444-4444-4444-8444-000000000004', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdlage')
ON CONFLICT (id) DO NOTHING;

-- Koordinaten, damit der Geo-Export (/api/export/rieden-geo?id=…) die Ried überhaupt berücksichtigen würde
INSERT INTO public.weingarten (id, tenant_id, name, lage_id, zentrum_lat, zentrum_lon)
VALUES ('44444444-4444-4444-8444-000000000005', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdried', '44444444-4444-4444-8444-000000000004', 48.3, 16.3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.grundstuecke (id, tenant_id, weingarten_id, gst_nr, notizen)
VALUES ('44444444-4444-4444-8444-000000000006', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-000000000005', '9999/99', 'E2E-Fremdgrundstück')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.weinausbau (id, tenant_id, name, behaelter_id, menge_liter)
VALUES ('44444444-4444-4444-8444-000000000007', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdcharge', '44444444-4444-4444-8444-000000000003', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fuellungen (id, tenant_id, name, anzahl_flaschen, bestand_flaschen)
VALUES ('44444444-4444-4444-8444-000000000008', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdfüllung', 12, 12)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.verkaufsposten (id, tenant_id, kontakt_id, notizen)
VALUES ('44444444-4444-4444-8444-000000000009', '44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-000000000001', 'E2E-Fremdverkauf')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exportauftraege (id, tenant_id, referenz, notizen)
VALUES ('44444444-4444-4444-8444-00000000000a', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdexport', 'E2E-Fremdexport')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.kellerplaene (id, tenant_id, name)
VALUES ('44444444-4444-4444-8444-00000000000b', '44444444-4444-4444-8444-444444444444', 'E2E-Fremdkellerplan')
ON CONFLICT (id) DO NOTHING;
