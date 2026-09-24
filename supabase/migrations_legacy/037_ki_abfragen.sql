-- Migration 037: KI-Modul „Frag dein Weingut"
-- Abfrage-Zähler + Paket-Verwaltung pro Mandant

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS ki_abfragen_aktiv       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ki_abfragen_paket       varchar(10) DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS ki_abfragen_zaehler     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ki_abfragen_reset_datum date DEFAULT current_date;

-- Atomarer Zähler + monatlicher Reset + Limit-Prüfung
CREATE OR REPLACE FUNCTION check_und_increment_ki_abfrage(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  limit_map jsonb := '{"basic":100,"standard":200,"unlimited":9999999}'::jsonb;
  rec record;
BEGIN
  SELECT ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler, ki_abfragen_reset_datum
  INTO rec FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erlaubt', false, 'fehler', 'Mandant nicht gefunden');
  END IF;

  -- Monatlicher Reset
  IF rec.ki_abfragen_reset_datum < date_trunc('month', current_date) THEN
    UPDATE tenant_einstellungen
    SET ki_abfragen_zaehler = 0, ki_abfragen_reset_datum = current_date
    WHERE tenant_id = p_tenant_id;
    rec.ki_abfragen_zaehler := 0;
  END IF;

  -- Limit-Prüfung
  IF rec.ki_abfragen_zaehler >= (limit_map->>rec.ki_abfragen_paket)::int THEN
    RETURN jsonb_build_object(
      'erlaubt', false,
      'verbraucht', rec.ki_abfragen_zaehler,
      'limit', (limit_map->>rec.ki_abfragen_paket)::int,
      'paket', rec.ki_abfragen_paket
    );
  END IF;

  -- Zähler erhöhen
  UPDATE tenant_einstellungen
  SET ki_abfragen_zaehler = ki_abfragen_zaehler + 1
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'erlaubt', true,
    'verbraucht', rec.ki_abfragen_zaehler + 1,
    'paket', rec.ki_abfragen_paket
  );
END;
$$;

-- Für den Piloten: Gebeshuber-Mandant direkt aktivieren
UPDATE tenant_einstellungen
SET ki_abfragen_aktiv = true, ki_abfragen_paket = 'unlimited'
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

NOTIFY pgrst, 'reload schema';
