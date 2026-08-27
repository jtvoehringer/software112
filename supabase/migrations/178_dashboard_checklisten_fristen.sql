-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 178: Dashboard-Relaunch – Lese-Checkliste und Fristen
--
-- Grundlage für die beiden neuen Dashboard-Sichten "Weingarten & Ernte"
-- (Lesevorbereitungs-Checkliste je Saison) und "Meldungen & Fristen"
-- (betriebseigene Fristen mit Ampel). Die übrigen Fristen (UVA, Erntemeldung,
-- Prüfnummernantrag, Wartefristen Pflanzenschutz) werden NICHT hier gespeichert,
-- sondern zur Laufzeit aus den bestehenden Tabellen abgeleitet (ea_uva,
-- ama_erntemeldungen, dac_antrag, behandlungen.ernte_fruehesteins).
--
-- Bewusst idempotent (IF NOT EXISTS / DROP ... IF EXISTS) – siehe Lehre aus
-- Migration 164.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Checklisten (z.B. Lesevorbereitung 2026) ────────────────────────────────
CREATE TABLE IF NOT EXISTS checklisten (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  typ           text        NOT NULL DEFAULT 'lese' CHECK (typ IN ('lese', 'sonstiges')),
  name          text        NOT NULL,
  jahr          smallint    NOT NULL,
  erstellt_von  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, typ, jahr)
);
COMMENT ON TABLE checklisten IS 'Checklisten je Betrieb und Saison (Dashboard "Weingarten & Ernte"): typ lese = Lesevorbereitung. Punkte in checklisten_punkte.';

CREATE TABLE IF NOT EXISTS checklisten_punkte (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checkliste_id  uuid        NOT NULL REFERENCES checklisten(id) ON DELETE CASCADE,
  text           text        NOT NULL,
  zustaendig     text,                       -- z.B. 'Betrieb', 'Keller' (Freitext)
  faellig_am     date,                       -- optional: konkretes Datum
  faellig_hinweis text,                      -- alternativ: 'wöchentlich', 'Nov.' …
  sortierung     integer     NOT NULL DEFAULT 0,
  erledigt       boolean     NOT NULL DEFAULT false,
  erledigt_am    timestamptz,
  erledigt_von   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklisten_tenant        ON checklisten(tenant_id, typ, jahr);
CREATE INDEX IF NOT EXISTS idx_checklisten_punkte_liste  ON checklisten_punkte(checkliste_id, sortierung);
CREATE INDEX IF NOT EXISTS idx_checklisten_punkte_tenant ON checklisten_punkte(tenant_id);

-- ── Fristen (betriebseigene Meldungen/Termine mit Ampel) ────────────────────
CREATE TABLE IF NOT EXISTS fristen (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bezeichnung    text        NOT NULL,
  beschreibung   text,
  kategorie      text        NOT NULL DEFAULT 'meldung'
    CHECK (kategorie IN ('meldung', 'steuer', 'weinrecht', 'betrieb')),
  faellig_am     date        NOT NULL,
  wiederholung   text        NOT NULL DEFAULT 'einmalig'
    CHECK (wiederholung IN ('einmalig', 'jaehrlich')),
  href           text,                       -- optionaler interner Link (z.B. /reports/keller)
  status         text        NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'erledigt')),
  erledigt_am    timestamptz,
  erledigt_von   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  notizen        text,
  erstellt_am    timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE fristen IS 'Betriebseigene Fristen für das Dashboard "Meldungen & Fristen" (Ampel: überfällig / fällig < 30 Tage / offen / erledigt). Systemfristen (UVA, Erntemeldung, Prüfnummer, Wartefristen) werden zur Laufzeit aus den Fachtabellen abgeleitet. Inhalte sind Betriebs-Stammdaten, keine Rechtsberatung.';
CREATE INDEX IF NOT EXISTS idx_fristen_tenant_faellig ON fristen(tenant_id, status, faellig_am);

-- ── RLS (analog E&A-Tabellen: alle Tenant-Mitglieder lesen/schreiben,
--    Rollen-Feingranularität in actions.ts) ───────────────────────────────────
ALTER TABLE checklisten        ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklisten_punkte ENABLE ROW LEVEL SECURITY;
ALTER TABLE fristen            ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklisten', 'checklisten_punkte', 'fristen'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_select" ON %1$s FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_insert" ON %1$s FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_update" ON %1$s FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_delete" ON %1$s FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()))', t);
  END LOOP;
END $$;
