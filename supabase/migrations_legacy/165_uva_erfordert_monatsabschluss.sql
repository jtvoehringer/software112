-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 165: UVA-Übermittlung setzt Monatsabschluss voraus
--
-- Fachliche Vorgabe: Bevor eine UVA-Periode (Quartal oder Monat) als
-- übermittelt markiert werden kann, müssen ALLE Monate dieser Periode
-- bereits per Monatsabschluss (Migration 162) geschlossen sein. Bisher
-- konnte sperre_ea_uva() unabhängig vom Monatsabschluss aufgerufen werden.
-- ─────────────────────────────────────────────────────────────────────────────

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
BEGIN
  -- Zeitraum → Datumsgrenzen + betroffene Monate (identisch zu berechne_ea_uva)
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

  -- Voraussetzung: alle Monate dieser Periode müssen bereits abgeschlossen sein
  FOREACH v_monat IN ARRAY v_monate LOOP
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
  'Markiert eine UVA-Periode als übermittelt (gesperrt+Zeitstempel) und sperrt alle E&A-Buchungen im Zeitraum gegen weitere Änderungen. Setzt voraus, dass alle Monate dieser Periode bereits per Monatsabschluss (ea_monatsabschluss) geschlossen sind - sonst RAISE EXCEPTION. Wird ausschließlich serverseitig mit vorheriger Admin-Rollenprüfung aufgerufen (SECURITY DEFINER, keine eigene Rollenprüfung).';
