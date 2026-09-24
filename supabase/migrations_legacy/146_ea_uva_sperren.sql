-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 146: UVA-Meldung als "übermittelt" markieren (Zeitstempel + Sperre)
--
-- Bisher gab es zwar die Spalten ea_uva.gesperrt/gesperrt_am und
-- ea_transaktionen.is_locked, aber keine Möglichkeit, sie über die UI zu
-- setzen — eine berechnete UVA blieb technisch für immer "Entwurf". Diese
-- Funktion markiert eine UVA-Periode als beim Finanzamt übermittelt: setzt
-- gesperrt=true + gesperrt_am=jetzt auf ea_uva und sperrt (is_locked=true)
-- alle ea_transaktionen-Buchungen im entsprechenden Zeitraum, damit sie
-- weder manuell noch automatisch (Zahlungseingang-Sync, Punkt 7) mehr
-- verändert werden können. Reine Anwendungs-Markierung — keine echte
-- elektronische Übermittlung an FinanzOnline.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sperre_ea_uva(
  p_tenant_id uuid,
  p_jahr      smallint,
  p_zeitraum  text   -- 'Q1'/'Q2'/'Q3'/'Q4' oder '01'–'12'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_von date;
  v_bis date;
BEGIN
  -- Zeitraum → Datumsgrenzen (identisch zu berechne_ea_uva)
  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
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
  'Markiert eine UVA-Periode als übermittelt (gesperrt+Zeitstempel) und sperrt alle E&A-Buchungen im Zeitraum gegen weitere Änderungen. Wird ausschließlich serverseitig mit vorheriger Admin-Rollenprüfung aufgerufen (SECURITY DEFINER, keine eigene Rollenprüfung).';
