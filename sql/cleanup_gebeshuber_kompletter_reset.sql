-- ═══════════════════════════════════════════════════════════════════════════════
-- KOMPLETTER RESET: Mandant "Weingut Johannes Gebeshuber" wird vollständig
-- gelöscht (inkl. aller Bewegungs- UND Stammdaten, Mitgliedschaften,
-- Einstellungen). Danach über die UI einen neuen leeren Mandanten anlegen
-- und die zuvor exportierten Rieden/Grundstücke-CSVs importieren.
--
-- ⚠️  NUR AUSFÜHREN, WENN export-gebeshuber-rieden-grundstuecke.sql bereits
--     erfolgreich als CSV heruntergeladen wurde! Dieser Schritt ist NICHT
--     rückgängig zu machen.
--
-- Tenant-ID Gebeshuber: c3d357c5-239e-4eac-85b2-4774476bc435
--
-- Warum ein einzelnes DELETE FROM tenants nicht reicht:
-- Fast jede Tabelle im Schema hat tenant_id mit "ON DELETE CASCADE" auf
-- tenants(id) - das räumt beim Löschen des Mandanten automatisch überall
-- auf (Kellerbuch, Verkäufe, Kalender, CRM, Warenlager, Kosten, Chargen, ...).
-- Fünf Tabellen sind aber eine Ausnahme: sie haben tenant_id nur als lose
-- UUID-Spalte OHNE Fremdschlüssel-Bezug zu tenants (Isolation läuft dort
-- rein über RLS) - die müssen daher VORHER explizit gelöscht werden, sonst
-- blieben sie als verwaiste Zeilen mit toter tenant_id zurück:
--   exportauftraege, sonstige_artikel, zukauf_posten, pruefnummernantraege,
--   weinbaugebiete_custom
--
-- Ausführen im Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid UUID := 'c3d357c5-239e-4eac-85b2-4774476bc435';
BEGIN

  -- Sicherheitscheck: nur fortfahren, wenn der Name noch stimmt (verhindert
  -- versehentliches Löschen des falschen Mandanten, falls sich die ID mal
  -- geändert haben sollte)
  IF NOT EXISTS (
    SELECT 1 FROM tenants WHERE id = v_tid AND name = 'Weingut Johannes Gebeshuber'
  ) THEN
    RAISE EXCEPTION 'Sicherheitscheck fehlgeschlagen: Mandant % heißt nicht mehr "Weingut Johannes Gebeshuber" (oder existiert nicht mehr) - Abbruch, nichts wurde gelöscht.', v_tid;
  END IF;

  RAISE NOTICE '--- Kompletter Reset für Gebeshuber (%) ---', v_tid;

  -- ── 1. Tabellen ohne FK-Bezug zu tenants(id) - müssen VORHER weg ──────────
  DELETE FROM exportauftrag_positionen
    WHERE exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = v_tid);
  DELETE FROM export_dokumente
    WHERE exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = v_tid);
  DELETE FROM exportauftraege      WHERE tenant_id = v_tid;
  DELETE FROM sonstige_artikel     WHERE tenant_id = v_tid;
  DELETE FROM zukauf_posten        WHERE tenant_id = v_tid;
  DELETE FROM pruefnummernantraege WHERE tenant_id = v_tid;
  DELETE FROM weinbaugebiete_custom WHERE tenant_id = v_tid;
  RAISE NOTICE 'Tabellen ohne Tenant-FK bereinigt (Export, Sonstige Produkte, Zukauf, Prüfnummernanträge, eigene Weinbaugebiete)';

  -- ── 2. Der eigentliche Reset: Mandant löschen, Rest kaskadiert automatisch ─
  DELETE FROM tenants WHERE id = v_tid;
  RAISE NOTICE '--- Mandant komplett gelöscht (inkl. aller kaskadierten Daten: Kellerbuch, Chargen, Kalender, Warenlager, Verkäufe, Kosten, Kontakte/Firmen, Mitgliedschaften, Einstellungen, Rieden/Weingärten/Grundstücke) ---';

END $$;

-- ── Kontrolle: Mandant sollte weg sein, keine Zeile mehr ─────────────────────
SELECT COUNT(*) AS sollte_0_sein FROM tenants WHERE id = 'c3d357c5-239e-4eac-85b2-4774476bc435';
