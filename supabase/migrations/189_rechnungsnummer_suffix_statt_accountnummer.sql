-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 189: Suffix/Jahreswechsel-Reset gehört zur Rechnungsnummer,
-- nicht zur Accountnummer (Korrektur zu Migration 188)
--
-- Rückmeldung 1.9.2026: "leider ist das an der falschen Stelle umgesetzt
-- worden - der Suffix hat nichts mit Accountnummer zu tun, sondern mit der
-- Rechnung!!!" - Migration 188 hatte Suffix + automatischen Jahreswechsel-
-- Reset fälschlich an get_next_accountnummer() gehängt. Diese Migration:
--   1. macht get_next_accountnummer() wieder zur einfachen, endlos
--      aufsteigenden Zählung (wie vor Migration 188) und entfernt die dafür
--      nur versehentlich angelegten Spalten,
--   2. bringt Suffix + Jahreswechsel-Reset stattdessen an
--      get_next_rechnungsnummer(), inkl. derselben Sicherheitslogik wie
--      Migration 188 (Reset nur bei gesetztem Jahres-Platzhalter, sonst
--      bliebe die Nummer nach dem Reset nicht mehr eindeutig).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Accountnummer zurück auf den einfachen Stand vor Migration 188 ─────────

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

ALTER TABLE tenant_einstellungen
  DROP COLUMN IF EXISTS account_suffix,
  DROP COLUMN IF EXISTS account_zaehler_jahr;

-- ── 2. Rechnungsnummer bekommt Suffix + Jahreswechsel-Reset ───────────────────

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS rechnung_suffix       text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rechnung_zaehler_jahr integer NOT NULL DEFAULT extract(year from now())::int;

CREATE OR REPLACE FUNCTION public.get_next_rechnungsnummer(p_tenant_id uuid)
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

  SELECT rechnung_prefix, rechnung_suffix, rechnung_stellen, rechnung_zaehler, rechnung_zaehler_jahr
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
  SET    rechnung_zaehler      = v_nummer + 1,
         rechnung_zaehler_jahr = v_jahr
  WHERE  tenant_id = p_tenant_id;

  RETURN v_prefix || '-' || lpad(v_nummer::text, v_stellen, '0') ||
         replace(replace(coalesce(v_suffix, ''), '{JJJJ}', v_jahr::text), '{JJ}', lpad((v_jahr % 100)::text, 2, '0'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_rechnungsnummer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_next_rechnungsnummer(uuid) TO authenticated, service_role;

COMMENT ON COLUMN tenant_einstellungen.rechnung_suffix IS
  'Suffix für Rechnungsnummern, z.B. "/{JJ}" für zweistelliges Jahr ({JJJJ} = vierstellig). Leer = kein Suffix. Nur bei gesetztem Jahres-Platzhalter wird der Zähler automatisch zum Jahreswechsel zurückgesetzt.';
COMMENT ON COLUMN tenant_einstellungen.rechnung_zaehler_jahr IS
  'Jahr, für das rechnung_zaehler zuletzt vergeben wurde - steuert den automatischen Jahreswechsel-Reset in get_next_rechnungsnummer().';
