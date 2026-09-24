-- Migration 086: fuellung_chargen – n:m Verknüpfung Füllung ↔ Weinausbau-Chargen
-- Unterstützt Verschnitte (mehrere Chargen → 1 Füllung) und Splits (1 Charge → n Füllungen)

CREATE TABLE fuellung_chargen (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fuellung_id   uuid NOT NULL REFERENCES fuellungen(id) ON DELETE CASCADE,
  weinausbau_id uuid NOT NULL REFERENCES weinausbau(id),
  anteil_liter  numeric(10,2),   -- optional: wie viel Liter dieser Charge in die Füllung flossen
  notizen       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fuellung_id, weinausbau_id)
);

ALTER TABLE fuellung_chargen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON fuellung_chargen
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE INDEX ON fuellung_chargen (fuellung_id);
CREATE INDEX ON fuellung_chargen (weinausbau_id);

-- Datenmigration: bestehende weinausbau_id-Verknüpfungen übernehmen
INSERT INTO fuellung_chargen (tenant_id, fuellung_id, weinausbau_id, anteil_liter)
SELECT f.tenant_id, f.id, f.weinausbau_id, f.menge_liter_gefuellt
FROM fuellungen f
WHERE f.weinausbau_id IS NOT NULL
ON CONFLICT (fuellung_id, weinausbau_id) DO NOTHING;

-- Retroaktiver Fix: Füllungen ohne weinausbau_id per Rebsorte+Jahrgang nachverknüpfen
-- (nur wenn eindeutig eine Charge matcht)
INSERT INTO fuellung_chargen (tenant_id, fuellung_id, weinausbau_id, anteil_liter)
SELECT f.tenant_id, f.id, w.id, f.menge_liter_gefuellt
FROM fuellungen f
JOIN weinausbau w ON
  w.tenant_id = f.tenant_id
  AND (f.rebsorte IS NULL OR w.rebsorte ILIKE f.rebsorte)
  AND (f.jahrgang IS NULL OR w.jahrgang::text = f.jahrgang::text)
WHERE f.weinausbau_id IS NULL
  AND f.tenant_id IS NOT NULL
  -- Nur wenn genau eine passende Charge gefunden wird
  AND (
    SELECT COUNT(*) FROM weinausbau ww
    WHERE ww.tenant_id = f.tenant_id
      AND (f.rebsorte IS NULL OR ww.rebsorte ILIKE f.rebsorte)
      AND (f.jahrgang IS NULL OR ww.jahrgang::text = f.jahrgang::text)
  ) = 1
ON CONFLICT (fuellung_id, weinausbau_id) DO NOTHING;
