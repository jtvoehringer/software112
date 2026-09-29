-- KAN-129 Nachtrag (29.09.2026): lesen.tenant_id bekommt den direkten Fremdschlüssel auf tenants
--
-- Konvention (DB-Test 01, tid_ohne_fk – Baseline BK3): jede tenant_id hängt per FK an tenants. lesen hatte nur den
-- zusammengesetzten FK (jahrgang_id, tenant_id) → weinjahrgaenge. Mit ON DELETE CASCADE kann eine Betriebslöschung
-- die Lesen vor dem Jahrgang erreichen – der Lösch-Trigger lässt deshalb auch „Betrieb nicht mehr da“ durch
-- (sonst griffe dort „die einzige Lese kann nicht gelöscht werden“). Keine Datenänderung. Staging zuerst.

CREATE OR REPLACE FUNCTION public.lesen_vor_loeschen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_anzahl int;
  v_max    int;
BEGIN
  -- Kaskade (Jahrgang bzw. Betrieb wird gelöscht): Jahrgang oder Betrieb ist dann nicht mehr sichtbar → erlaubt
  IF NOT EXISTS (SELECT 1 FROM weinjahrgaenge WHERE id = OLD.jahrgang_id)
     OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  SELECT count(*), max(lfd_nr) INTO v_anzahl, v_max FROM lesen WHERE jahrgang_id = OLD.jahrgang_id;
  IF v_anzahl <= 1 THEN
    RAISE EXCEPTION 'Die einzige Lese eines Jahrgangs kann nicht gelöscht werden.' USING ERRCODE = '42501';
  END IF;
  IF OLD.lfd_nr < v_max THEN
    RAISE EXCEPTION 'Nur die Lese mit der höchsten Nummer (%) kann gelöscht werden.', v_max USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $f$;
REVOKE EXECUTE ON FUNCTION public.lesen_vor_loeschen() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.lesen
  ADD CONSTRAINT lesen_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE;

-- Selbstprüfung
DO $pruefung$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesen_tenant_id_fkey' AND conrelid = 'public.lesen'::regclass
                  AND confrelid = 'public.tenants'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'KAN-129 Nachtrag: lesen_tenant_id_fkey fehlt';
  END IF;
  IF has_function_privilege('authenticated', 'public.lesen_vor_loeschen()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lesen_vor_loeschen()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-129 Nachtrag: lesen_vor_loeschen() für API-Rollen ausführbar';
  END IF;
END $pruefung$;
