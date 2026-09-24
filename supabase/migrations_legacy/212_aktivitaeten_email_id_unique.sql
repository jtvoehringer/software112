-- Migration 212 (18.9.2026): Upsert der E-Mail-Aktivitäten reparieren
-- Fehler beim Spiegelungslauf: "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification". Der bisherige Index
-- idx_aktivitaeten_email_id war PARTIELL (WHERE email_id IS NOT NULL) - für
-- ON CONFLICT (tenant_id, email_id) muss Postgres das Prädikat mitbekommen,
-- was PostgREST/supabase-js (onConflict) nicht ausdrücken kann. Derselbe
-- Fehler traf still den Upsert beim Öffnen einer E-Mail (nachrichten/message).
-- Ein voller Unique-Index tut es genauso: NULL-Werte gelten als verschieden,
-- Aktivitäten ohne email_id bleiben unbegrenzt möglich.
DROP INDEX IF EXISTS idx_aktivitaeten_email_id;
CREATE UNIQUE INDEX IF NOT EXISTS aktivitaeten_tenant_email_id_uq ON aktivitaeten (tenant_id, email_id);
