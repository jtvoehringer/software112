-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 164: Daueraufträge-Automatik fertigstellen (Phase 3 des KPS-GAP-Portings)
--
-- ea_dauerauftraege (Migration 099) hatte bisher nur Anlage-Formular + Liste,
-- aber keine Automatik: process_ea_dauerauftraege() existierte zwar bereits,
-- wurde aber nie aufgerufen (kein Cron, siehe Kommentar am Ende von 099).
-- Diese Migration macht die Funktion produktionstauglich und bindet sie über
-- einen Vercel Cron an (siehe api/cron/ea-dauerauftraege/route.ts) - analog
-- zum bestehenden Cron-Muster für /api/m365/subscribe (vercel.json).
--
-- Verbesserungen gegenüber der ursprünglichen Funktion:
--  1. Pro Dauerauftrag eigener Fehler-Fang (BEGIN/EXCEPTION) - ein fehlerhafter
--     Dauerauftrag (z.B. gelöschte Kategorie) blockiert nicht mehr ALLE
--     anderen fälligen Daueraufträge desselben Laufs.
--  2. Zeitraum-Prüfung vor dem Insert (pruefe_ea_zeitraum_offen, Migration 162)
--     - ein bereits abgeschlossener Monat/übermittelter UVA-Zeitraum wird
--     übersprungen statt eine gesperrte Buchung zu erzeugen oder hart zu
--     scheitern.
--  3. konto_id wird an die erzeugte Buchung durchgereicht (Migration 163).
--  4. Jeder Lauf pro Dauerauftrag wird protokolliert (ea_dauerauftrag_log) -
--     Basis für eine spätere "letzte Ausführungen"-Ansicht.
-- ─────────────────────────────────────────────────────────────────────────────

-- Diese Migration ist bewusst idempotent (IF NOT EXISTS / DROP ... IF EXISTS)
-- - falls ein früherer Lauf teilweise durchgekommen ist (z.B. weil die
-- Funktions-Änderung am Ende zunächst an einem bestehenden Rückgabetyp
-- scheiterte), kann sie gefahrlos erneut komplett ausgeführt werden.

-- ── 1) Konto-Zuordnung für Daueraufträge ──────────────────────────────────────
ALTER TABLE ea_dauerauftraege
  ADD COLUMN IF NOT EXISTS konto_id uuid REFERENCES konten(id) ON DELETE SET NULL;

COMMENT ON COLUMN ea_dauerauftraege.konto_id IS 'Optional: Konto, das automatisch erzeugte Buchungen dieses Dauerauftrags erhalten';

-- ── 2) Log-Tabelle ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ea_dauerauftrag_log (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dauerauftrag_id uuid          NOT NULL REFERENCES ea_dauerauftraege(id) ON DELETE CASCADE,
  status          text          NOT NULL CHECK (status IN ('erstellt', 'uebersprungen', 'fehler')),
  ea_transaktion_id uuid        REFERENCES ea_transaktionen(id) ON DELETE SET NULL,
  fehler_details  text,
  erstellt_am     timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE ea_dauerauftrag_log IS 'Protokoll jedes Verarbeitungsversuchs eines Dauerauftrags (Cron-Lauf)';

CREATE INDEX IF NOT EXISTS idx_ea_da_log_tenant       ON ea_dauerauftrag_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ea_da_log_dauerauftrag ON ea_dauerauftrag_log(dauerauftrag_id, erstellt_am DESC);

ALTER TABLE ea_dauerauftrag_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ea_da_log_select" ON ea_dauerauftrag_log;
CREATE POLICY "ea_da_log_select" ON ea_dauerauftrag_log
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

-- Kein INSERT/UPDATE/DELETE-Policy nötig - nur process_ea_dauerauftraege()
-- (SECURITY DEFINER) schreibt hier, das umgeht RLS ohnehin.

-- ── 3) process_ea_dauerauftraege() ersetzen ───────────────────────────────────
-- Der Rückgabetyp ändert sich (void -> TABLE(...)); CREATE OR REPLACE erlaubt
-- das bei Postgres nicht, daher zuerst DROP.
DROP FUNCTION IF EXISTS process_ea_dauerauftraege();

CREATE FUNCTION process_ea_dauerauftraege()
RETURNS TABLE (verarbeitet int, erstellt int, uebersprungen int, fehler int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r ea_dauerauftraege%ROWTYPE;
  v_neue_id      uuid;
  v_pruef        RECORD;
  v_verarbeitet  int := 0;
  v_erstellt     int := 0;
  v_uebersprungen int := 0;
  v_fehler       int := 0;
BEGIN
  FOR r IN
    SELECT * FROM ea_dauerauftraege
    WHERE aktiv = true AND naechste_faelligkeit <= CURRENT_DATE
  LOOP
    v_verarbeitet := v_verarbeitet + 1;

    BEGIN
      -- Zeitraum offen? (weder Monatsabschluss noch übermittelte UVA)
      SELECT * INTO v_pruef FROM pruefe_ea_zeitraum_offen(r.tenant_id, r.naechste_faelligkeit);

      IF NOT v_pruef.offen THEN
        INSERT INTO ea_dauerauftrag_log (tenant_id, dauerauftrag_id, status, fehler_details)
        VALUES (r.tenant_id, r.id, 'uebersprungen', v_pruef.grund);
        v_uebersprungen := v_uebersprungen + 1;

        -- Fälligkeit trotzdem weiterrücken, sonst bleibt der Dauerauftrag für
        -- immer auf demselben (geschlossenen) Datum hängen.
        UPDATE ea_dauerauftraege SET naechste_faelligkeit =
          CASE r.intervall
            WHEN 'monatlich'        THEN r.naechste_faelligkeit + INTERVAL '1 month'
            WHEN 'vierteljaehrlich' THEN r.naechste_faelligkeit + INTERVAL '3 months'
            WHEN 'halbjaehrlich'    THEN r.naechste_faelligkeit + INTERVAL '6 months'
            WHEN 'jaehrlich'        THEN r.naechste_faelligkeit + INTERVAL '1 year'
          END
        WHERE id = r.id;

        CONTINUE;
      END IF;

      INSERT INTO ea_transaktionen (
        tenant_id, typ, datum, beschreibung, kategorie_id,
        betrag_netto, ust_satz, dauerauftrag_id, konto_id, import_quelle
      ) VALUES (
        r.tenant_id, r.typ, r.naechste_faelligkeit, r.beschreibung,
        r.kategorie_id, r.betrag_netto, r.ust_satz, r.id, r.konto_id, 'manuell'
      )
      RETURNING id INTO v_neue_id;

      UPDATE ea_dauerauftraege SET naechste_faelligkeit =
        CASE r.intervall
          WHEN 'monatlich'        THEN r.naechste_faelligkeit + INTERVAL '1 month'
          WHEN 'vierteljaehrlich' THEN r.naechste_faelligkeit + INTERVAL '3 months'
          WHEN 'halbjaehrlich'    THEN r.naechste_faelligkeit + INTERVAL '6 months'
          WHEN 'jaehrlich'        THEN r.naechste_faelligkeit + INTERVAL '1 year'
        END
      WHERE id = r.id;

      INSERT INTO ea_dauerauftrag_log (tenant_id, dauerauftrag_id, status, ea_transaktion_id)
      VALUES (r.tenant_id, r.id, 'erstellt', v_neue_id);
      v_erstellt := v_erstellt + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Ein fehlerhafter Dauerauftrag darf die anderen nicht blockieren.
      -- naechste_faelligkeit bleibt bewusst unverändert -> Retry am nächsten Lauf.
      INSERT INTO ea_dauerauftrag_log (tenant_id, dauerauftrag_id, status, fehler_details)
      VALUES (r.tenant_id, r.id, 'fehler', SQLERRM);
      v_fehler := v_fehler + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_verarbeitet, v_erstellt, v_uebersprungen, v_fehler;
END;
$$;

COMMENT ON FUNCTION process_ea_dauerauftraege IS
  'Erzeugt für alle fälligen, aktiven Daueraufträge (aller Mandanten) die entsprechende ea_transaktionen-Buchung, rückt naechste_faelligkeit weiter und protokolliert jeden Versuch in ea_dauerauftrag_log. Ein einzelner Fehler blockiert nicht die übrigen Daueraufträge. Wird täglich per Vercel Cron aufgerufen (api/cron/ea-dauerauftraege).';
