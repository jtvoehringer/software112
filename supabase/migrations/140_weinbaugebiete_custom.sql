-- Migration 140: Weinbaugebiete-Selbstverwaltung
-- Mandanten koennen fehlende Weinbaugebiete selbst als zusaetzliche
-- Herkunft-Code(BKI)-Optionen anlegen, statt auf eine fix hinterlegte Liste
-- (src/lib/herkunft.ts: HERKUNFT_ORDER, aktuell nur WLNÖ + Thermenregion DAC)
-- beschraenkt zu sein.
--
-- Design-Entscheidung (mit Nutzer abgestimmt, 2026-08-04):
--   - Eigene Gebiete stehen AUSSERHALB der Abstufungs-Rangfolge. Die
--     Business-Logik in src/lib/herkunft.ts (istNiedrigerAls, minHerkunft,
--     maxHerkunft, findePassendeHerkunftsstufe) ignoriert unbekannte Codes
--     bereits automatisch (idx === -1 -> übersprungen/false) - es ist daher
--     KEINE Code-Änderung an dieser Logik nötig.
--   - Kein Sortenspiegel fuer eigene Gebiete (keine automatische Rechtspruefung,
--     liegt in der Verantwortung des Winzers).
--   - Gespeichert wird direkt der vom Winzer eingegebene Name (nicht z.B. eine
--     UUID), damit alle bestehenden Anzeige-Stellen im Code (durchgängig nach
--     dem Muster `HERKUNFT_LABEL[code] ?? code`) den Namen automatisch korrekt
--     anzeigen, ohne dass diese Stellen angepasst werden müssen.
--
-- Die CHECK-Constraints aus Migration 132 (fix auf die 6 bekannten Werte:
-- wein, wlnoe, thermenregion_gebietswein, thermenregion_ortswein,
-- thermenregion_riedenwein, sonstiges) werden daher aufgehoben. Gueltigkeit
-- wird ab jetzt applikationsseitig sichergestellt: das Dropdown zeigt nur die
-- fixen Stufen + die eigenen aktiven weinbaugebiete_custom-Eintraege des
-- jeweiligen Mandanten.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN (
        'grundstuecke'::regclass, 'ernte_parzellen'::regclass,
        'weinausbau'::regclass, 'fuellungen'::regclass
      )
      AND pg_get_constraintdef(oid) ILIKE '%herkunft_code%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- Neue Tabelle: mandanten-eigene Weinbaugebiete (analog Migration 054 sonstige_artikel)
CREATE TABLE IF NOT EXISTS weinbaugebiete_custom (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid          NOT NULL,
  name          text          NOT NULL,
  aktiv         boolean       NOT NULL DEFAULT true,
  erstellt_am   timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS weinbaugebiete_custom_tenant_idx ON weinbaugebiete_custom (tenant_id);

ALTER TABLE weinbaugebiete_custom ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weinbaugebiete_custom_select" ON weinbaugebiete_custom FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "weinbaugebiete_custom_insert" ON weinbaugebiete_custom FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "weinbaugebiete_custom_update" ON weinbaugebiete_custom FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));

COMMENT ON TABLE weinbaugebiete_custom IS
  'Vom Mandanten selbst angelegte, zusaetzliche Weinbaugebiete/Herkunft-Codes (BKI). Der Name wird direkt als Wert in den *_herkunft_code-Spalten gespeichert (kein separater Code) und liegt bewusst ausserhalb der Abstufungs-Rangfolge aus src/lib/herkunft.ts (kein Sortenspiegel, keine Auf-/Abstufungspruefung).';
