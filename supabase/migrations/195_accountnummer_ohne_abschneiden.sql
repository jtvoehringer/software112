-- Rückmeldung 3.9.2026 (Dynamics-Import Gebeshuber, "Indexfehler" bei den
-- Kontakten): lpad() schneidet einen Zähler, der länger als account_stellen
-- ist, rechts ab - Zähler 10000 wurde bei 4 Stellen zu "1000" und kollidierte
-- mit der bestehenden AN-1000 (unique index idx_kontakte_accountnummer).
-- Ab 10.000 Datensätzen pro Mandant scheiterte damit jede Neuanlage.
-- Jetzt: aufgefüllt wird nur, wenn der Zähler kürzer ist; längere Zähler
-- werden unverändert ausgegeben (AN-10001, AN-12914, ...).
CREATE OR REPLACE FUNCTION public.get_next_accountnummer(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF length(v_zaehler::text) >= COALESCE(v_stellen, 0) THEN
    RETURN v_prefix || '-' || v_zaehler::text;
  END IF;
  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END;
$function$;
