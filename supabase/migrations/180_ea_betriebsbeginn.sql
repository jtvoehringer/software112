-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 180: Betriebsbeginn (Systemstart) für die E&A-Rechnung
--
-- Wunsch 27.8.2026 (analog kps-smart-buchhaltung, Migration 044 dort): Wer
-- unterjährig startet, soll Monate VOR dem Betriebsbeginn nicht als "offen"
-- sehen bzw. künstlich als Nullmonate abschließen müssen. Das Datum nimmt
-- diese Monate überall aus dem Spiel:
--   * sperre_ea_uva() verlangt den Monatsabschluss nur noch für Monate, die
--     (ganz oder teilweise) nach dem Betriebsbeginn liegen
--   * Monatsabschluss-Seite, UVA-Seite und Dashboard (Fristen-Ampel, Glocke)
--     blenden frühere Perioden aus (App-Seite, gleiche Auslieferung)
-- NULL = keine Einschränkung, Verhalten wie bisher. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS ea_betriebsbeginn date;

COMMENT ON COLUMN tenant_einstellungen.ea_betriebsbeginn IS
  'Betriebsbeginn / Systemstart der E&A-Rechnung (z.B. 2026-09-01 bei Rumpfjahr Sep–Dez). Monate, die vollständig davor enden, verlangen keinen Monatsabschluss und erscheinen nicht als offen in Monatsabschluss, UVA und Dashboard. NULL = keine Einschränkung.';

-- sperre_ea_uva: Körper aus Migration 165, ergänzt um den Betriebsbeginn beim
-- Monatsabschluss-Check (Monate, deren Monatsende vor dem Beginn liegt, gelten
-- als nicht erforderlich).
CREATE OR REPLACE FUNCTION sperre_ea_uva(
  p_tenant_id uuid,
  p_jahr      smallint,
  p_zeitraum  text   -- 'Q1'/'Q2'/'Q3'/'Q4' oder '01'–'12'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_von      date;
  v_bis      date;
  v_monate   smallint[];
  v_monat    smallint;
  v_fehlende smallint[] := '{}';
  v_beginn   date;
BEGIN
  SELECT ea_betriebsbeginn INTO v_beginn
  FROM tenant_einstellungen WHERE tenant_id = p_tenant_id;

  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
    v_monate := ARRAY[
      EXTRACT(MONTH FROM v_von)::smallint,
      EXTRACT(MONTH FROM v_von + INTERVAL '1 month')::smallint,
      EXTRACT(MONTH FROM v_von + INTERVAL '2 months')::smallint
    ];
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
    v_monate := ARRAY[p_zeitraum::smallint];
  END IF;

  FOREACH v_monat IN ARRAY v_monate LOOP
    -- Migration 180: Monate, die vollständig vor dem Betriebsbeginn enden, brauchen keinen Abschluss
    IF v_beginn IS NOT NULL
       AND (make_date(p_jahr, v_monat, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date < v_beginn THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ea_monatsabschluss
      WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND monat = v_monat
    ) THEN
      v_fehlende := array_append(v_fehlende, v_monat);
    END IF;
  END LOOP;

  IF array_length(v_fehlende, 1) > 0 THEN
    RAISE EXCEPTION
      'Monatsabschluss fehlt für Monat(e) % / % – die UVA kann erst übermittelt werden, wenn alle Monate dieser Periode abgeschlossen sind.',
      array_to_string(v_fehlende, ', '), p_jahr;
  END IF;

  UPDATE ea_transaktionen
  SET is_locked = true
  WHERE tenant_id = p_tenant_id
    AND datum BETWEEN v_von AND v_bis;

  UPDATE ea_uva
  SET gesperrt = true, gesperrt_am = now()
  WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND zeitraum = p_zeitraum;
END;
$$;

COMMENT ON FUNCTION sperre_ea_uva IS
  'Markiert eine UVA-Periode als übermittelt (gesperrt+Zeitstempel) und sperrt alle E&A-Buchungen im Zeitraum. Setzt voraus, dass alle Monate der Periode per Monatsabschluss geschlossen sind – Monate vor tenant_einstellungen.ea_betriebsbeginn (Migration 180) ausgenommen. Nur serverseitig mit Admin-Rollenprüfung aufrufen (SECURITY DEFINER).';
