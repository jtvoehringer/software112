-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 166: Belege-OCR für die E&A-Rechnung (Phase 5 des KPS-GAP-Portings)
--
-- Deckt den "Beleg-Posteingang"-Workflow ab: Foto/PDF eines Kassenbons/einer
-- Eingangsrechnung hochladen -> Claude (Vision, native PDF-Unterstützung)
-- liest Datum/Betrag/USt-Satz/Kategorie-Vorschlag aus -> Status "erkannt" ->
-- User prüft/korrigiert die Werte im Buchen-Formular -> beim Speichern
-- entsteht eine ganz normale ea_transaktionen-Zeile (Migration 099) und der
-- Beleg wechselt auf Status "verbucht". Schlägt die KI-Erkennung fehl
-- (unlesbares Foto, Anthropic-API nicht erreichbar, kein ANTHROPIC_API_KEY),
-- bleibt der Beleg trotzdem mit Status "fehler" hochgeladen und kann manuell
-- gebucht werden - der Upload selbst darf nie an einer KI-Störung scheitern.
--
-- Bewusst idempotent (IF NOT EXISTS / DROP ... IF EXISTS) - siehe Lehre aus
-- Migration 164 (RETURNS-TYPE-Fehler bei nicht-idempotenter CREATE FUNCTION).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ea_belege (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ea_transaktion_id  uuid          REFERENCES ea_transaktionen(id) ON DELETE SET NULL,
  dateiname          text          NOT NULL,
  dateityp           text          NOT NULL,          -- MIME-Type
  groesse_bytes      integer,
  storage_pfad       text          NOT NULL,           -- Supabase Storage path (Bucket ea-belege)
  status             text          NOT NULL DEFAULT 'erkannt'
    CHECK (status IN ('erkannt', 'verbucht', 'fehler')),
  erkannte_daten     jsonb,        -- {typ, datum, beschreibung, betrag_netto, betrag_brutto, ust_satz, kategorie_id, konfidenz, hinweis}
  fehler_details     text,
  hochgeladen_von    uuid          REFERENCES auth.users(id),
  hochgeladen_am     timestamptz   NOT NULL DEFAULT now(),
  verbucht_am        timestamptz
);

COMMENT ON TABLE ea_belege IS 'Hochgeladene Belege (Foto/PDF) für die E&A-Rechnung mit KI-gestützter Datenerkennung (Anthropic Vision). status: erkannt (wartet auf Buchung) -> verbucht (ea_transaktion_id gesetzt) bzw. fehler (Erkennung fehlgeschlagen, manuelle Eingabe nötig).';
COMMENT ON COLUMN ea_belege.erkannte_daten IS 'Von Claude vorgeschlagene Buchungsdaten als JSON - dient nur als Vorbefüllung im Formular, die tatsächliche Buchung entsteht erst durch die vom Nutzer bestätigten Formularwerte.';

CREATE INDEX IF NOT EXISTS idx_ea_belege_tenant      ON ea_belege(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ea_belege_status      ON ea_belege(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ea_belege_transaktion ON ea_belege(ea_transaktion_id);

ALTER TABLE ea_belege ENABLE ROW LEVEL SECURITY;

-- RLS analog zu den übrigen E&A-Tabellen: alle Tenant-Mitglieder dürfen lesen/
-- schreiben (Rollen-Feingranularität wird wie bei ea_transaktionen/zahlungen
-- auf Anwendungsebene in actions.ts bzw. der Upload-API-Route geprüft).
DROP POLICY IF EXISTS "ea_belege_select" ON ea_belege;
CREATE POLICY "ea_belege_select" ON ea_belege
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ea_belege_insert" ON ea_belege;
CREATE POLICY "ea_belege_insert" ON ea_belege
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ea_belege_update" ON ea_belege;
CREATE POLICY "ea_belege_update" ON ea_belege
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ea_belege_delete" ON ea_belege;
CREATE POLICY "ea_belege_delete" ON ea_belege
  FOR DELETE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

-- ── Supabase Storage Bucket (privat, max. 15 MB, Foto/PDF) ────────────────────
-- Gleiches Muster wie 'aktivitaet-dokumente' (Migration 104): Policies binden
-- nur an bucket_id, die tatsächliche Mandanten-Trennung erfolgt über die
-- ea_belege-Zeile (storage_pfad ist zusätzlich mit dem Tenant-Präfix versehen)
-- und die serverseitigen Checks in der Upload-Route.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ea-belege',
  'ea-belege',
  false,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Auth: Beleg hochladen" ON storage.objects;
CREATE POLICY "Auth: Beleg hochladen" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ea-belege');

DROP POLICY IF EXISTS "Auth: Beleg lesen" ON storage.objects;
CREATE POLICY "Auth: Beleg lesen" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ea-belege');

DROP POLICY IF EXISTS "Auth: Beleg löschen" ON storage.objects;
CREATE POLICY "Auth: Beleg löschen" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ea-belege');
