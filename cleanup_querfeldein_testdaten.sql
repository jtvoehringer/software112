-- Charge "Querfeldein weiß" 2025 hart löschen (Sandbox-Testdaten)
-- Ausführen in: Supabase → SQL Editor → New query → Run

DO $$
DECLARE
  v_id UUID;
  v_verschn_ids UUID[];
BEGIN
  -- Charge-ID ermitteln
  SELECT id INTO v_id
  FROM weinausbau
  WHERE name = 'Querfeldein weiß' AND jahrgang = 2025
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Charge nicht gefunden';
  END IF;

  RAISE NOTICE 'Lösche Charge %', v_id;

  -- Verschneidungs-IDs merken (für verschneidung_quellen)
  SELECT ARRAY_AGG(id) INTO v_verschn_ids
  FROM verschneidungen WHERE ziel_weinausbau_id = v_id;

  -- verschneidung_quellen löschen
  IF v_verschn_ids IS NOT NULL THEN
    DELETE FROM verschneidung_quellen WHERE verschneidung_id = ANY(v_verschn_ids);
  END IF;

  -- Verschneidungen löschen
  DELETE FROM verschneidungen WHERE ziel_weinausbau_id = v_id;

  -- Abfüllungen löschen (incl. fuellung_chargen)
  DELETE FROM fuellung_chargen WHERE weinausbau_id = v_id;
  DELETE FROM fuellungen       WHERE weinausbau_id = v_id;

  -- Umzüge löschen
  DELETE FROM keller_umzuege
  WHERE von_weinausbau_id = v_id OR nach_weinausbau_id = v_id;

  -- Analysen, Weingarten-Verknüpfungen
  DELETE FROM weinanalysen           WHERE weinausbau_id = v_id;
  DELETE FROM weinausbau_weingaerten WHERE weinausbau_id = v_id;

  -- Charge selbst löschen
  DELETE FROM weinausbau WHERE id = v_id;

  RAISE NOTICE 'Fertig – Querfeldein weiß 2025 entfernt.';
END $$;
