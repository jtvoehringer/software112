-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 187: "Kundennummer" durchgängig zu "Accountnummer" umbenennen
--
-- Kundenwunsch (1.9.2026): einheitliche Terminologie "Accountnummer" statt
-- "Kundennummer" - vollständig inkl. Datenbank (Spalten, Indizes, Funktion),
-- nicht nur die sichtbaren UI-Texte. Reine Umbenennung, keine Wertänderung:
-- bereits vergebene Nummern (z.B. "K-00042") bleiben unverändert, nur die
-- Spalten-/Funktionsnamen und Labels ändern sich.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Spalten in firmen/kontakte ────────────────────────────────────────────────
ALTER TABLE firmen   RENAME COLUMN kundennummer TO accountnummer;
ALTER TABLE kontakte RENAME COLUMN kundennummer TO accountnummer;

-- ── Indizes (Migration 027) ────────────────────────────────────────────────────
ALTER INDEX idx_firmen_kundennummer   RENAME TO idx_firmen_accountnummer;
ALTER INDEX idx_kontakte_kundennummer RENAME TO idx_kontakte_accountnummer;

-- ── Zähler-Spalten in tenant_einstellungen ──────────────────────────────────────
ALTER TABLE tenant_einstellungen RENAME COLUMN kunden_prefix  TO account_prefix;
ALTER TABLE tenant_einstellungen RENAME COLUMN kunden_stellen TO account_stellen;
ALTER TABLE tenant_einstellungen RENAME COLUMN kunden_zaehler TO account_zaehler;

-- ── Atomische Funktion: nächste Accountnummer ───────────────────────────────────
-- Ersetzt get_next_kundennummer (Migration 027, zuletzt gehärtet in 182) 1:1,
-- nur mit neuen Spalten-/Funktionsnamen. Gleiche Berechtigungsprüfung
-- (pruefe_tenant_zugriff) und dieselbe Grant-Vergabe wie das Original.
CREATE OR REPLACE FUNCTION public.get_next_accountnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix   text;
  v_stellen  integer;
  v_zaehler  integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE tenant_einstellungen
  SET    account_zaehler = account_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING account_prefix, account_stellen, account_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_accountnummer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_next_accountnummer(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_next_kundennummer(uuid);

COMMENT ON COLUMN firmen.accountnummer   IS 'Fortlaufende Accountnummer (vormals "Kundennummer"), vergeben über get_next_accountnummer().';
COMMENT ON COLUMN kontakte.accountnummer IS 'Fortlaufende Accountnummer (vormals "Kundennummer"), vergeben über get_next_accountnummer().';
