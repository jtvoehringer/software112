-- Migration 116: grundstuecke.status CHECK-Constraint um 'gruenbrache' erweitern
ALTER TABLE grundstuecke
  DROP CONSTRAINT IF EXISTS grundstuecke_status_check;

ALTER TABLE grundstuecke
  ADD CONSTRAINT grundstuecke_status_check
  CHECK (status IN ('aktiv', 'brache', 'gruenbrache', 'gerodet'));

COMMENT ON COLUMN grundstuecke.status IS 'aktiv = ausgepflanzt; brache = liegt brach; gruenbrache = Grünbrache; gerodet = dauerhaft entfernt';
