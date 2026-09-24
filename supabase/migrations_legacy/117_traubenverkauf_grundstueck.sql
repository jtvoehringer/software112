-- Migration 117: traubenverkauf.grundstueck_id – Verkauf auf GST-Ebene
ALTER TABLE traubenverkauf
  ADD COLUMN IF NOT EXISTS grundstueck_id UUID REFERENCES grundstuecke(id) ON DELETE SET NULL;

COMMENT ON COLUMN traubenverkauf.grundstueck_id IS 'Optional: Grundstück (GST) von dem die Trauben verkauft wurden';

CREATE INDEX IF NOT EXISTS idx_traubenverkauf_grundstueck ON traubenverkauf(grundstueck_id);
