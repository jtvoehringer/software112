-- KAN-167 Nachtrag (01.10.2026): Verweise der Betriebsmittel nur innerhalb des eigenen Betriebs.
-- Bisher prüfte nur die RPC s112_betriebsmittel_einkauf den Mandanten; ein direkter INSERT/UPDATE per API konnte die
-- ID eines fremden Betriebs eintragen (DB-Test 11, B2). Lösung wie lesen/pressungen: Verbund-FK (spalte, tenant_id) →
-- (id, tenant_id); für die E/A-Kategorie (global = tenant_id NULL oder eigener Betrieb) ein Trigger.

-- 1. Zielschlüssel (id, tenant_id)
ALTER TABLE public.betriebsmittel ADD CONSTRAINT betriebsmittel_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.firmen         ADD CONSTRAINT firmen_id_tenant_key         UNIQUE (id, tenant_id);

-- 2. Verbund-FKs (ersetzen die einspaltigen; Löschverhalten unverändert)
ALTER TABLE public.behandlungen DROP CONSTRAINT behandlungen_betriebsmittel_id_fkey;
ALTER TABLE public.behandlungen ADD CONSTRAINT behandlungen_betriebsmittel_fkey
  FOREIGN KEY (betriebsmittel_id, tenant_id) REFERENCES public.betriebsmittel (id, tenant_id);

ALTER TABLE public.betriebsmittel_lager_bewegungen DROP CONSTRAINT betriebsmittel_lager_bewegungen_betriebsmittel_id_fkey;
ALTER TABLE public.betriebsmittel_lager_bewegungen ADD CONSTRAINT betriebsmittel_lager_bewegungen_betriebsmittel_fkey
  FOREIGN KEY (betriebsmittel_id, tenant_id) REFERENCES public.betriebsmittel (id, tenant_id) ON DELETE CASCADE;

ALTER TABLE public.betriebsmittel_lager_bewegungen DROP CONSTRAINT betriebsmittel_lager_bewegungen_lieferant_firma_id_fkey;
ALTER TABLE public.betriebsmittel_lager_bewegungen ADD CONSTRAINT betriebsmittel_lager_bewegungen_lieferant_fkey
  FOREIGN KEY (lieferant_firma_id, tenant_id) REFERENCES public.firmen (id, tenant_id) ON DELETE SET NULL (lieferant_firma_id);

-- 3. E/A-Kategorie: global oder eigener Betrieb, nur Ausgaben
CREATE OR REPLACE FUNCTION public.s112_betriebsmittel_kategorie_pruefen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ea_kategorie_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ea_kategorien k
                  WHERE k.id = NEW.ea_kategorie_id AND k.typ = 'ausgabe'
                    AND (k.tenant_id IS NULL OR k.tenant_id = NEW.tenant_id)) THEN
    RAISE EXCEPTION 'E/A-Kategorie gehört nicht zu diesem Betrieb oder ist keine Ausgaben-Kategorie.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_betriebsmittel_kategorie_pruefen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_kategorie_pruefen BEFORE INSERT OR UPDATE OF ea_kategorie_id, tenant_id ON public.betriebsmittel
  FOR EACH ROW EXECUTE FUNCTION public.s112_betriebsmittel_kategorie_pruefen();
