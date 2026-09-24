-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 122: Trigger sync_verkaufsposten_bezahlt – falscher Spaltenname
-- vk_preis_brutto → preis_brutto (Spalte existiert so nicht in verkauf_positionen)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_verkaufsposten_bezahlt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id       uuid;
  v_gesamt   numeric(10,2);
  v_gezahlt  numeric(10,2);
BEGIN
  v_id := COALESCE(NEW.verkaufsposten_id, OLD.verkaufsposten_id);

  SELECT COALESCE(SUM(
    ROUND(
      vp.menge
      * COALESCE(vp.preis_brutto, 0)
      * (1 - COALESCE(vp.rabatt_pct,       0) / 100)
      * (1 - COALESCE(vp.sonderrabatt_pct, 0) / 100),
    2)
  ), 0)
  INTO v_gesamt
  FROM verkauf_positionen vp
  WHERE vp.verkaufsposten_id = v_id;

  SELECT COALESCE(SUM(betrag), 0)
  INTO v_gezahlt
  FROM zahlungen
  WHERE verkaufsposten_id = v_id;

  UPDATE verkaufsposten
  SET
    bezahlt    = (v_gezahlt >= v_gesamt AND v_gesamt > 0),
    bezahlt_am = CASE
                   WHEN v_gezahlt >= v_gesamt AND v_gesamt > 0 THEN now()
                   ELSE NULL
                 END
  WHERE id = v_id;

  RETURN NEW;
END;
$$;
