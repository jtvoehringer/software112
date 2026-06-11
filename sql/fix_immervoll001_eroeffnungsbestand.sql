-- Fix: Eröffnungsbestand für Immervoll 001 (Zierfandler Gumpoldskirchen)
-- Problem: Die Charge 9d05f403 hat kein ist_eroeffnungsbestand=true Entry.
--          Dadurch startet das Bewegungsbuch bei 0 L → alle Abgänge ergeben
--          einen negativen Saldo (-16.874,50 L).
-- Lösung: Ghost-Datensatz mit is_eroeffnungsbestand=true, menge_liter=0,
--          status=abgeschlossen (unsichtbar in Kellerbuch-Übersicht),
--          anfangsbestand_liter = menge_liter (4.500) + |protokoll-Saldo| (16.874,5)
--                               = 21.374,50 L
-- Ergebnis: Bewegungsbuch zeigt Anfangssaldo +21.374,50 L → Endsaldo +4.500,00 L ✓

DO $$
DECLARE
  v_tenant_id   UUID;
  v_behaelter   UUID;
  v_jahrgang    INT;
  v_rebsorte    TEXT;
BEGIN
  SELECT tenant_id, behaelter_id, jahrgang, rebsorte
  INTO   v_tenant_id, v_behaelter, v_jahrgang, v_rebsorte
  FROM   weinausbau
  WHERE  id = '9d05f403-5953-4ac8-b4aa-c23c41df42d0';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Charge 9d05f403 nicht gefunden';
  END IF;

  -- Prüfen ob bereits ein EB-Eintrag existiert
  IF EXISTS (
    SELECT 1 FROM weinausbau
    WHERE behaelter_id = v_behaelter
      AND ist_eroeffnungsbestand = true
  ) THEN
    RAISE NOTICE 'EB-Eintrag bereits vorhanden – kein Insert nötig.';
    RETURN;
  END IF;

  INSERT INTO weinausbau (
    tenant_id,
    name,
    behaelter_id,
    menge_liter,
    anfangsbestand_liter,
    ist_eroeffnungsbestand,
    aktiv,
    status,
    jahrgang,
    rebsorte,
    created_at
  ) VALUES (
    v_tenant_id,
    'Eröffnungsbestand Zierfandler GK',
    v_behaelter,
    0,            -- menge=0: zählt nicht in Kapazitätsberechnung
    21374.50,     -- = menge_liter (4500) + |Protokoll-Saldo| (16874.5)
    true,
    false,        -- aktiv=false + status=abgeschlossen → unsichtbar in Kellerbuch
    'abgeschlossen',
    v_jahrgang,
    v_rebsorte,
    make_timestamptz(COALESCE(v_jahrgang, 2024), 9, 1, 0, 0, 0, 'Europe/Vienna')
  );

  RAISE NOTICE 'Eröffnungsbestand 21.374,50 L eingefügt.';
END $$;
