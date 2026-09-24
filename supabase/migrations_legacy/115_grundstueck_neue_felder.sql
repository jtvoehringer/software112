-- Migration 115 – Grundstück: neue Felder für AMA, Boden, Rechtsverhältnis, Unterlagsrebe, KG-Bezeichnung
ALTER TABLE grundstuecke
  ADD COLUMN IF NOT EXISTS ama_feldnummer     TEXT,          -- AMA-Feldstücknummer (max. 3-stellig numerisch)
  ADD COLUMN IF NOT EXISTS kg_bezeichnung     TEXT,          -- Katastralgemeinde Bezeichnung (z.B. "Gumpoldskirchen")
  ADD COLUMN IF NOT EXISTS boden              TEXT,          -- Bodenbeschaffenheit (Freitext)
  ADD COLUMN IF NOT EXISTS rechtsverhaeltnis  TEXT CHECK (rechtsverhaeltnis IN ('eigentum', 'pacht')),
  ADD COLUMN IF NOT EXISTS unterlagsrebe      TEXT;          -- Unterlagsrebe (Freitext)

-- Index für Rechtsverhältnis-Auswertungen
CREATE INDEX IF NOT EXISTS idx_grundstuecke_rechtsv ON grundstuecke(tenant_id, rechtsverhaeltnis);
