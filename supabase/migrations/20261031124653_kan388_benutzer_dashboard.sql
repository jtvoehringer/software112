-- KAN-388 (31.10.2026, Epic KAN-386 „Persönliches Dashboard“): eigene Anordnung der Übersicht je Benutzer.
-- Entscheidungen Jörgen 31.10.2026: je Benutzer über alle Betriebe (kein tenant_id), eigene Tabelle statt Spalte an
-- profiles (profiles lesen alle Mitglieder gemeinsamer Betriebe), Standard = keine Zeile.
--
-- layout: [{ "id": "<widget-id>", "groesse"?: "klein"|"mittel"|"breit" }, …] in Anzeigereihenfolge – nur eingeblendete
-- Widgets; die App prüft ids und Größen gegen das Register (src/lib/dashboard/widgets.ts), die DB nur Form und Umfang.
-- Lesen, anlegen, ändern, löschen nur die eigene Zeile; kein Betriebsbezug, daher ohne mitgliedschaft_aktiv,
-- Abo-Schreibsperre und Fremdverweis-Trigger (wie release_notes_gesehen).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE TABLE public.benutzer_dashboard (
  user_id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  layout          jsonb NOT NULL,
  aktualisiert_am timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT benutzer_dashboard_layout_form CHECK (
    jsonb_typeof(layout) = 'array' AND jsonb_array_length(layout) <= 50 AND pg_column_size(layout) < 8192)
);

COMMENT ON TABLE public.benutzer_dashboard IS 'KAN-388: eigene Anordnung der Übersicht je Benutzer (über alle Betriebe); keine Zeile = Standard';

ALTER TABLE public.benutzer_dashboard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benutzer_dashboard FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.benutzer_dashboard FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benutzer_dashboard TO authenticated;

CREATE POLICY benutzer_dashboard_eigen ON public.benutzer_dashboard FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY zwei_faktor_aal ON public.benutzer_dashboard AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
