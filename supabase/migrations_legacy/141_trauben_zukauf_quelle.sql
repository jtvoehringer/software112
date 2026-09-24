-- Migration 141: Zugekaufte Trauben als Quelle fuer Pressung und Traubenverkauf
--
-- Bisher konnten Pressungen (pressung_weingaerten) und Traubenverkaeufe
-- (traubenverkauf) ausschliesslich aus eigener Ernte gespeist werden
-- (weingarten_id war NOT NULL). Zugekaufte Trauben (zukauf_posten mit
-- art='trauben') sollen jetzt ebenfalls als Quelle waehlbar sein - sowohl
-- als Vorschlag/Ausgangsmenge bei der Pressung als auch als verkaufbare
-- Menge im Traubenverkauf.
--
-- Jede Zeile hat GENAU EINE Quelle: entweder eigene Ernte (weingarten_id)
-- ODER ein Zukauf-Posten (zukauf_posten_id) - nie beides, nie keines.

ALTER TABLE pressung_weingaerten
  ALTER COLUMN weingarten_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS zukauf_posten_id UUID REFERENCES zukauf_posten(id) ON DELETE SET NULL;

ALTER TABLE pressung_weingaerten
  DROP CONSTRAINT IF EXISTS chk_pressung_wg_quelle;
ALTER TABLE pressung_weingaerten
  ADD CONSTRAINT chk_pressung_wg_quelle
    CHECK ((weingarten_id IS NOT NULL) <> (zukauf_posten_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_pressung_weingaerten_zukauf ON pressung_weingaerten(zukauf_posten_id);

ALTER TABLE traubenverkauf
  ALTER COLUMN weingarten_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS zukauf_posten_id UUID REFERENCES zukauf_posten(id) ON DELETE SET NULL;

ALTER TABLE traubenverkauf
  DROP CONSTRAINT IF EXISTS chk_traubenverkauf_quelle;
ALTER TABLE traubenverkauf
  ADD CONSTRAINT chk_traubenverkauf_quelle
    CHECK ((weingarten_id IS NOT NULL) <> (zukauf_posten_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_traubenverkauf_zukauf ON traubenverkauf(zukauf_posten_id);
