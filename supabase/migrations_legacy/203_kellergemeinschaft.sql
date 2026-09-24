-- Kellergemeinschaft: Gebinde können von mehreren Betrieben genutzt werden
-- (Anforderung 16.9.2026, Anlass Weingut Gebeshuber). Grundsätze:
--   * Ein Gebinde gehört genau einem Betrieb (behaelter.tenant_id) - der
--     Eigentümer pflegt Stammdaten, Kellerplan usw.
--   * Der system_admin legt unter Administration > Kellergemeinschaft fest,
--     welcher Partner-Betrieb (nutzer) die Gebinde welches Eigentümers sehen
--     und befüllen darf (keller_freigaben). Der Eigentümer kann einzelne
--     Gebinde ausnehmen (behaelter.gemeinsam = false).
--   * Der Inhalt (weinausbau) bleibt mandantengetrennt: Jeder Betrieb sieht nur
--     seine eigenen Chargen; von fremden Chargen ist nur „belegt durch Betrieb X“
--     samt Litern sichtbar (RPC lade_behaelter), keine Details.
--   * Sperre: Liegt in einem Gebinde Wein eines anderen Betriebs, kann kein
--     zweiter Betrieb dort einlagern/umziehen (Trigger auf weinausbau - gilt für
--     Umzug, Eröffnungsbestand, Pressung, Verschnitt, Bot-Tool gleichermaßen).

-- ── behaelter: Freigabe-Schalter, Stapler, Notizen ────────────────────────────
ALTER TABLE behaelter
  ADD COLUMN IF NOT EXISTS gemeinsam boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stapler   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notizen   text;
COMMENT ON COLUMN behaelter.gemeinsam IS 'Für Partnerbetriebe (keller_freigaben) freigegeben - nur relevant, wenn eine Freigabe besteht.';
COMMENT ON COLUMN behaelter.stapler   IS 'Mit Stapler versetzbar (DKB-Feld „Stapler“).';

-- ── keller_freigaben: Eigentümer → Nutzer ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS keller_freigaben (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eigentuemer_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nutzer_tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aktiv                 boolean NOT NULL DEFAULT true,
  notizen               text,
  erstellt_von          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (eigentuemer_tenant_id, nutzer_tenant_id),
  CHECK (eigentuemer_tenant_id <> nutzer_tenant_id)
);
COMMENT ON TABLE keller_freigaben IS 'Kellergemeinschaft: Partnerbetrieb (nutzer) darf die freigegebenen Gebinde des Eigentümers sehen und befüllen. Pflege nur durch system_admin (Service-Role).';

ALTER TABLE keller_freigaben ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS keller_freigaben_select ON keller_freigaben;
CREATE POLICY keller_freigaben_select ON keller_freigaben FOR SELECT
  USING (eigentuemer_tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
      OR nutzer_tenant_id      IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
-- kein Schreib-Policy: nur Service-Role (Administration)

-- ── Hilfsfunktion: darf Betrieb p_tenant das Gebinde nutzen? ──────────────────
CREATE OR REPLACE FUNCTION behaelter_nutzbar(p_behaelter_id uuid, p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM behaelter b
    WHERE b.id = p_behaelter_id
      AND (b.tenant_id = p_tenant_id
           OR (b.gemeinsam AND EXISTS (
                 SELECT 1 FROM keller_freigaben f
                 WHERE f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = p_tenant_id AND f.aktiv)))
  )
$$;

-- ── behaelter: Lesen auch für Partnerbetriebe (Joins behaelter:behaelter_id) ──
DROP POLICY IF EXISTS behaelter_select ON behaelter;
CREATE POLICY behaelter_select ON behaelter FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
    OR (gemeinsam AND tenant_id IN (
          SELECT f.eigentuemer_tenant_id FROM keller_freigaben f
          WHERE f.aktiv AND f.nutzer_tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())))
  );
-- Schreiben (insert/update/delete) bleibt beim Eigentümer (bestehende Policies).

-- ── RPC lade_behaelter: eigene + freigegebene Gebinde mit Belegung ────────────
-- Liefert je Gebinde die eigenen Liter, die fremden Liter und den Namen des
-- fremden Betriebs - aber nie dessen Chargen. Aufruf mit dem aktiven Betrieb;
-- der Aufrufer muss dort aktives Mitglied sein (oder Service-Role).
DROP FUNCTION IF EXISTS lade_behaelter(uuid);
CREATE OR REPLACE FUNCTION lade_behaelter(p_tenant_id uuid)
RETURNS TABLE (
  id uuid, tenant_id uuid, name text, typ text, volumen_liter numeric, standort text, aktiv boolean,
  gemeinsam boolean, stapler boolean, notizen text, import_quelle text,
  eigentuemer_name text, fremd boolean, eigen_liter numeric, fremd_liter numeric, fremd_betrieb text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.tenant_id, b.name, b.typ, b.volumen_liter, b.standort, b.aktiv,
         b.gemeinsam, b.stapler, b.notizen, b.import_quelle,
         t.name AS eigentuemer_name,
         (b.tenant_id <> p_tenant_id) AS fremd,
         COALESCE((SELECT SUM(w.menge_liter) FROM weinausbau w
                   WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id = p_tenant_id), 0) AS eigen_liter,
         COALESCE((SELECT SUM(w.menge_liter) FROM weinausbau w
                   WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id <> p_tenant_id AND COALESCE(w.menge_liter, 0) > 0), 0) AS fremd_liter,
         (SELECT t2.name FROM weinausbau w JOIN tenants t2 ON t2.id = w.tenant_id
          WHERE w.behaelter_id = b.id AND w.aktiv AND w.tenant_id <> p_tenant_id AND COALESCE(w.menge_liter, 0) > 0
          ORDER BY w.updated_at DESC LIMIT 1) AS fremd_betrieb
  FROM behaelter b
  JOIN tenants t ON t.id = b.tenant_id
  WHERE (
          session_user = 'postgres'   -- SQL-Editor / Migrationen
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
          OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv)
        )
    AND (
          b.tenant_id = p_tenant_id
          OR (b.gemeinsam AND EXISTS (
                SELECT 1 FROM keller_freigaben f
                WHERE f.eigentuemer_tenant_id = b.tenant_id AND f.nutzer_tenant_id = p_tenant_id AND f.aktiv))
        )
  ORDER BY b.name
$$;
GRANT EXECUTE ON FUNCTION lade_behaelter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION behaelter_nutzbar(uuid, uuid) TO authenticated, service_role;

-- ── Sperre: kein Einlagern in ein fremd belegtes / nicht freigegebenes Gebinde ─
CREATE OR REPLACE FUNCTION weinausbau_gebinde_pruefen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner     uuid;
  v_gemeinsam boolean;
  v_name      text;
  v_fremd     text;
BEGIN
  -- Nur relevant, wenn die Charge tatsächlich (wieder) Inhalt in ein Gebinde bringt
  IF NEW.behaelter_id IS NULL OR NOT NEW.aktiv OR COALESCE(NEW.menge_liter, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- Charge liegt schon mit Menge in diesem Gebinde: Mengenänderung/Schwund erlaubt
  IF TG_OP = 'UPDATE' AND NEW.behaelter_id IS NOT DISTINCT FROM OLD.behaelter_id
     AND OLD.aktiv AND COALESCE(OLD.menge_liter, 0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT b.tenant_id, b.gemeinsam, b.name INTO v_owner, v_gemeinsam, v_name
  FROM behaelter b WHERE b.id = NEW.behaelter_id;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  IF v_owner <> NEW.tenant_id AND NOT (v_gemeinsam AND EXISTS (
       SELECT 1 FROM keller_freigaben f
       WHERE f.eigentuemer_tenant_id = v_owner AND f.nutzer_tenant_id = NEW.tenant_id AND f.aktiv)) THEN
    RAISE EXCEPTION 'Gebinde „%“ gehört einem anderen Betrieb und ist für diesen Betrieb nicht freigegeben', v_name
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.name INTO v_fremd
  FROM weinausbau w JOIN tenants t ON t.id = w.tenant_id
  WHERE w.behaelter_id = NEW.behaelter_id AND w.aktiv AND COALESCE(w.menge_liter, 0) > 0
    AND w.tenant_id <> NEW.tenant_id AND w.id <> NEW.id
  LIMIT 1;
  IF v_fremd IS NOT NULL THEN
    RAISE EXCEPTION 'Gebinde „%“ ist durch % belegt – Einlagern/Umziehen dorthin ist nicht möglich', v_name, v_fremd
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS weinausbau_gebinde_pruefen_trg ON weinausbau;
CREATE TRIGGER weinausbau_gebinde_pruefen_trg
  BEFORE INSERT OR UPDATE OF behaelter_id, menge_liter, aktiv, tenant_id ON weinausbau
  FOR EACH ROW EXECUTE FUNCTION weinausbau_gebinde_pruefen();

-- ── RPC lade_kellergemeinschaft: Partnerbetriebe des aktiven Betriebs ────────
-- (Tenant-Namen der Gegenseite sind über RLS nicht lesbar, daher SECURITY DEFINER)
CREATE OR REPLACE FUNCTION lade_kellergemeinschaft(p_tenant_id uuid)
RETURNS TABLE (rolle text, partner_tenant_id uuid, partner_name text, notizen text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN 'eigentuemer' ELSE 'nutzer' END AS rolle,
         CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN f.nutzer_tenant_id ELSE f.eigentuemer_tenant_id END AS partner_tenant_id,
         t.name AS partner_name, f.notizen
  FROM keller_freigaben f
  JOIN tenants t ON t.id = CASE WHEN f.eigentuemer_tenant_id = p_tenant_id THEN f.nutzer_tenant_id ELSE f.eigentuemer_tenant_id END
  WHERE f.aktiv
    AND (f.eigentuemer_tenant_id = p_tenant_id OR f.nutzer_tenant_id = p_tenant_id)
    AND (session_user = 'postgres'
         OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
         OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv))
  ORDER BY 1, 3
$$;
GRANT EXECUTE ON FUNCTION lade_kellergemeinschaft(uuid) TO authenticated, service_role;
