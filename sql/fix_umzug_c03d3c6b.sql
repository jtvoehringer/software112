-- Fix: Umzug c03d3c6b-2769-46ba-9647-c898fda06382
-- Alter Eintrag hat nur EINEN keller_umzuege-Record angelegt (001 → 01, 7500 L),
-- obwohl drei Ziele gebucht wurden (01: 1800L, 02: 4200L, 002: 1500L).
-- Die weinausbau-Mengen (menge_liter) sind KORREKT – nur das Protokoll ist falsch.
-- Dieser Script löscht den schlechten Record und legt 4 korrekte Zeilen an.

DO $$
DECLARE
  v_tenant_id     UUID;
  v_von_behaelter UUID;
  v_von_wa        UUID;
  v_datum         DATE;
  v_notizen       TEXT;
  v_umzug_typ     TEXT;
  v_behaelter_01  UUID;
  v_behaelter_02  UUID;
  v_behaelter_002 UUID;
  v_wa_01         UUID;
  v_wa_02         UUID;
  v_wa_002        UUID;
  v_batch_id      UUID := gen_random_uuid();
BEGIN
  -- Bestehenden Datensatz laden
  SELECT tenant_id, von_behaelter_id, von_weinausbau_id,
         datum, notizen, umzug_typ
  INTO   v_tenant_id, v_von_behaelter, v_von_wa,
         v_datum, v_notizen, v_umzug_typ
  FROM   keller_umzuege
  WHERE  id = 'c03d3c6b-2769-46ba-9647-c898fda06382';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Datensatz c03d3c6b nicht gefunden – bereits gelöscht?';
  END IF;

  -- Behälter-IDs direkt per UUID (aus SELECT id, name FROM behaelter ermittelt)
  v_behaelter_01  := '98f3f924-c732-47d7-a170-5935fe3bdba8'; -- Aufsteller A01
  v_behaelter_02  := 'e6997229-2886-455a-ae3e-d4b8f1f395b9'; -- Aufsteller A02
  v_behaelter_002 := '6ec47982-0fce-45f4-9d29-6125abb92443'; -- Immervoll 002

  -- Aktive Charge je Ziel-Behälter ermitteln
  SELECT id INTO v_wa_01
    FROM weinausbau
    WHERE behaelter_id = v_behaelter_01
      AND aktiv = true AND status != 'abgeschlossen'
    ORDER BY created_at DESC LIMIT 1;

  SELECT id INTO v_wa_02
    FROM weinausbau
    WHERE behaelter_id = v_behaelter_02
      AND aktiv = true AND status != 'abgeschlossen'
    ORDER BY created_at DESC LIMIT 1;

  SELECT id INTO v_wa_002
    FROM weinausbau
    WHERE behaelter_id = v_behaelter_002
      AND aktiv = true AND status != 'abgeschlossen'
    ORDER BY created_at DESC LIMIT 1;

  -- Schlechten Eintrag löschen
  DELETE FROM keller_umzuege
  WHERE  id = 'c03d3c6b-2769-46ba-9647-c898fda06382';

  -- Quelle-Zeile (001, 8000 L brutto, Schwund 500 L)
  INSERT INTO keller_umzuege (
    tenant_id, datum,
    von_behaelter_id, von_weinausbau_id,
    brutto_liter, menge_liter, schwund_liter,
    umzug_typ, notizen,
    umzug_batch_id, zeilen_typ
  ) VALUES (
    v_tenant_id, v_datum,
    v_von_behaelter, v_von_wa,
    8000, 8000, 500,
    COALESCE(v_umzug_typ, 'normal'), v_notizen,
    v_batch_id, 'quelle'
  );

  -- Ziel-Zeile 01 (1800 L netto)
  INSERT INTO keller_umzuege (
    tenant_id, datum,
    nach_behaelter_id, nach_weinausbau_id,
    menge_liter, schwund_liter, brutto_liter,
    umzug_typ, notizen,
    umzug_batch_id, zeilen_typ
  ) VALUES (
    v_tenant_id, v_datum,
    v_behaelter_01, v_wa_01,
    1800, 0, NULL,
    COALESCE(v_umzug_typ, 'normal'), NULL,
    v_batch_id, 'ziel'
  );

  -- Ziel-Zeile 02 (4200 L netto)
  INSERT INTO keller_umzuege (
    tenant_id, datum,
    nach_behaelter_id, nach_weinausbau_id,
    menge_liter, schwund_liter, brutto_liter,
    umzug_typ, notizen,
    umzug_batch_id, zeilen_typ
  ) VALUES (
    v_tenant_id, v_datum,
    v_behaelter_02, v_wa_02,
    4200, 0, NULL,
    COALESCE(v_umzug_typ, 'normal'), NULL,
    v_batch_id, 'ziel'
  );

  -- Ziel-Zeile 002 (1500 L netto)
  INSERT INTO keller_umzuege (
    tenant_id, datum,
    nach_behaelter_id, nach_weinausbau_id,
    menge_liter, schwund_liter, brutto_liter,
    umzug_typ, notizen,
    umzug_batch_id, zeilen_typ
  ) VALUES (
    v_tenant_id, v_datum,
    v_behaelter_002, v_wa_002,
    1500, 0, NULL,
    COALESCE(v_umzug_typ, 'normal'), NULL,
    v_batch_id, 'ziel'
  );

  RAISE NOTICE 'Fertig – neuer Batch-ID: %', v_batch_id;
END $$;
