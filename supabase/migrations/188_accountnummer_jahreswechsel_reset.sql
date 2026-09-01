-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 188: Automatischer Jahreswechsel-Reset für die Accountnummer
--
-- Kundenwunsch (1.9.2026): der Accountnummer-Zähler soll bei Jahreswechsel
-- automatisch wieder bei 1 beginnen, statt wie bisher nur manuell über
-- "Zähler setzen" im Mandanten-Admin (Tab Verkauf). Vorbild: Prefix / Stellen
-- / Suffix mit {JJ}- bzw. {JJJJ}-Platzhalter, wie im vorhandenen
-- Rechnungsnummer-Einstellungsdialog skizziert.
--
-- Wichtig: der Reset passiert NUR, wenn im Suffix tatsächlich ein
-- Jahres-Platzhalter konfiguriert ist. Ohne Jahr in der Nummer würde ein
-- automatischer Reset die Eindeutigkeit zerstören - dieselbe Nummer könnte
-- in zwei Jahren an zwei verschiedene Kunden vergeben werden und würde an
-- der bestehenden Unique-Constraint idx_firmen_accountnummer /
-- idx_kontakte_accountnummer abprallen. Ohne Suffix bleibt der Zähler daher
-- wie bisher endlos aufsteigend.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS account_suffix       text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_zaehler_jahr integer NOT NULL DEFAULT extract(year from now())::int;

CREATE OR REPLACE FUNCTION public.get_next_accountnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix   text;
  v_suffix   text;
  v_stellen  integer;
  v_zaehler  integer;
  v_row_jahr integer;
  v_jahr     integer := extract(year from now())::int;
  v_nummer   integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  SELECT account_prefix, account_suffix, account_stellen, account_zaehler, account_zaehler_jahr
  INTO   v_prefix, v_suffix, v_stellen, v_zaehler, v_row_jahr
  FROM   tenant_einstellungen
  WHERE  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Reset nur bei Jahreswechsel UND nur wenn der Suffix einen Jahres-Platzhalter
  -- enthält (sonst bliebe die Nummer nach dem Reset nicht mehr eindeutig).
  IF coalesce(v_suffix, '') LIKE '%{JJ%' AND v_row_jahr IS DISTINCT FROM v_jahr THEN
    v_nummer := 1;
  ELSE
    v_nummer := v_zaehler;
  END IF;

  UPDATE tenant_einstellungen
  SET    account_zaehler      = v_nummer + 1,
         account_zaehler_jahr = v_jahr
  WHERE  tenant_id = p_tenant_id;

  RETURN v_prefix || '-' || lpad(v_nummer::text, v_stellen, '0') ||
         replace(replace(coalesce(v_suffix, ''), '{JJJJ}', v_jahr::text), '{JJ}', lpad((v_jahr % 100)::text, 2, '0'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_accountnummer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_next_accountnummer(uuid) TO authenticated, service_role;

COMMENT ON COLUMN tenant_einstellungen.account_suffix IS
  'Suffix für Accountnummern, z.B. "/{JJ}" für zweistelliges Jahr ({JJJJ} = vierstellig). Leer = kein Suffix. Nur bei gesetztem Jahres-Platzhalter wird der Zähler automatisch zum Jahreswechsel zurückgesetzt.';
COMMENT ON COLUMN tenant_einstellungen.account_zaehler_jahr IS
  'Jahr, für das account_zaehler zuletzt vergeben wurde - steuert den automatischen Jahreswechsel-Reset in get_next_accountnummer().';
