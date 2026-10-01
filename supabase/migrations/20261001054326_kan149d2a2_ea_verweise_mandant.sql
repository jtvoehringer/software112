-- KAN-149 (Folgeticket D), Etappe D2a2: Mandantenprüfung für die neuen Verweise an ea_transaktionen
--
-- Befund der DB-Tests (11_mandantentrennung_schreiben, 30.09.2026): ea_transaktionen.zahlung_id (D2a) war ein Verweis
-- ohne Mandantenprüfung – ein Mitarbeiter mit E&A-Schreibrecht hätte eine eigene Buchung per API mit der Zahlung eines
-- anderen Betriebs verknüpfen können (sieht dadurch nichts, der Verweis wäre aber falsch). storno_von_id setzt nur die
-- RPC (Schutz-Trigger a_ea_storno_schutz), wird hier aber gleich mitgeprüft.
-- Lösung: Der bestehende Trigger ea_transaktionen_anlage_tenant (bisher nur anlage_id) prüft zusätzlich zahlung_id und
-- storno_von_id gegen den Betrieb der Buchung und feuert auch bei Änderungen dieser Spalten.

CREATE OR REPLACE FUNCTION public.trg_ea_transaktion_anlage_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.anlage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ea_anlagen a WHERE a.id = NEW.anlage_id AND a.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Die Anlage gehört nicht zu diesem Betrieb.'; END IF;
  -- KAN-149 D2a2: Zahlung und Original einer Gegenbuchung aus demselben Betrieb
  IF NEW.zahlung_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM zahlungen z WHERE z.id = NEW.zahlung_id AND z.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Die Zahlung gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501'; END IF;
  IF NEW.storno_von_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ea_transaktionen e WHERE e.id = NEW.storno_von_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Die stornierte Buchung gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS ea_transaktionen_anlage_tenant ON public.ea_transaktionen;
CREATE TRIGGER ea_transaktionen_anlage_tenant BEFORE INSERT OR UPDATE OF anlage_id, tenant_id, zahlung_id, storno_von_id
  ON public.ea_transaktionen FOR EACH ROW EXECUTE FUNCTION public.trg_ea_transaktion_anlage_tenant();
