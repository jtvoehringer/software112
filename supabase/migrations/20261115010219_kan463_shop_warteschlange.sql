-- KAN-463 (15.11.2026, Weinshop S1d): Bestand an den Shop übertragen – Warteschlange, Mengenrechnung, Stand.
--
-- Entscheidungen Jörgen 15.11.2026 (Plan KAN-463): jetzt bauen, der Schalter „Bestand übertragen“ bleibt je Betrieb aus
-- (Hinweis in der App: erst mit Stufe 2 bzw. zeitnahem Nachbuchen einschalten); bis zu 10 Minuten Abstand sind in Ordnung.
--   * Speichervorgänge rufen den Shop nie auf: Trigger reihen die Füllung in shop_warteschlange ein, ein Vercel-Cron
--     (Service-Role) arbeitet ab. Je Betrieb, Füllung und Art höchstens ein Eintrag; die Menge wird beim Abarbeiten
--     gerechnet (s112_shop_bestand) – es zählt immer der letzte Stand.
--   * Eingereiht wird nur, wenn die Füllung einem Shop-Produkt zugeordnet ist, modul_shop an ist und – für die Art
--     „bestand“ – der Schalter shop_bestand_uebertragen. Art „weindaten“ (KAN-462) braucht nur das Modul.
--   * Menge = Flaschenbestand − in Aufträgen reservierte Flaschen (KAN-418) − Bestandsreserve des Betriebs, nie < 0;
--     inaktive oder stornierte Füllungen melden 0.
--   * Ausschalten (Schalter bzw. Modul) leert die Warteschlange des Betriebs; im Shop ändert sich nichts.
-- Die Warteschlange ist über die Datenschnittstelle nur lesbar (Lesebereich lager); es schreiben Trigger und Cron.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Letzter Stand der Bestandsübertragung je Zuordnung ───────────────────────────────────────────────────────────
ALTER TABLE public.shop_zuordnungen
  ADD COLUMN bestand_menge  integer CONSTRAINT shop_zuordnungen_bestand_menge_chk CHECK (bestand_menge IS NULL OR bestand_menge >= 0),
  ADD COLUMN bestand_am     timestamptz,
  ADD COLUMN bestand_fehler text CONSTRAINT shop_zuordnungen_bestand_fehler_chk CHECK (bestand_fehler IS NULL OR char_length(bestand_fehler) BETWEEN 1 AND 500);
COMMENT ON COLUMN public.shop_zuordnungen.bestand_menge IS 'KAN-463: zuletzt an den Shop gemeldete Menge (Flaschen)';
COMMENT ON COLUMN public.shop_zuordnungen.bestand_am IS 'KAN-463: letzte erfolgreiche Bestandsübertragung';
COMMENT ON COLUMN public.shop_zuordnungen.bestand_fehler IS 'KAN-463: Meldung des letzten Fehlversuchs; leer nach einer erfolgreichen Übertragung';

-- ── 2. Warteschlange ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.shop_warteschlange (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fuellung_id          uuid NOT NULL REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  art                  text NOT NULL CONSTRAINT shop_warteschlange_art_chk CHECK (art IN ('bestand', 'weindaten')),
  eingereiht_am        timestamptz NOT NULL DEFAULT now(),
  versuche             integer NOT NULL DEFAULT 0 CONSTRAINT shop_warteschlange_versuche_chk CHECK (versuche >= 0),
  naechster_versuch_am timestamptz NOT NULL DEFAULT now(),
  letzter_fehler       text CONSTRAINT shop_warteschlange_letzter_fehler_chk CHECK (letzter_fehler IS NULL OR char_length(letzter_fehler) BETWEEN 1 AND 500),
  CONSTRAINT shop_warteschlange_eintrag_key UNIQUE (tenant_id, fuellung_id, art)
);
CREATE INDEX shop_warteschlange_faellig_idx ON public.shop_warteschlange (naechster_versuch_am);
CREATE INDEX shop_warteschlange_fuellung_idx ON public.shop_warteschlange (fuellung_id);
COMMENT ON TABLE public.shop_warteschlange IS
  'KAN-463: Füllungen, deren Bestand bzw. Weindaten an den Shop zu übertragen sind (je Betrieb/Füllung/Art ein Eintrag). Es schreiben nur Trigger und der Cron (Service-Role); über die Datenschnittstelle nur lesbar.';

ALTER TABLE public.shop_warteschlange ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_warteschlange FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_warteschlange TO authenticated;

CREATE POLICY shop_warteschlange_select ON public.shop_warteschlange FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.shop_warteschlange AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.shop_warteschlange AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY lesebereich ON public.shop_warteschlange AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('lager'))))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('lager'))));
COMMENT ON POLICY lesebereich ON public.shop_warteschlange IS 'KAN-463: Lesebereich lager – gesperrt für Profile ohne diesen Bereich (alle Befehle, KAN-459)';
CREATE POLICY abo_schreibsperre_ins ON public.shop_warteschlange AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.shop_warteschlange AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.shop_warteschlange AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));

-- KAN-178: Verweis nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.shop_warteschlange
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');

-- ── 3. Menge für den Shop ───────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_shop_bestand(p_fuellung_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT GREATEST(0,
           CASE WHEN f.aktiv AND f.storniert_am IS NULL THEN COALESCE(f.bestand_flaschen, 0) ELSE 0 END
           - public.s112_fuellung_reserviert(f.id)
           - COALESCE((SELECT e.shop_bestandsreserve FROM tenant_einstellungen e WHERE e.tenant_id = f.tenant_id), 0))::integer
    FROM fuellungen f
   WHERE f.id = p_fuellung_id
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_bestand(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_shop_bestand(uuid) IS
  'KAN-463: Menge für den Shop = Flaschenbestand − reservierte Flaschen − Bestandsreserve des Betriebs, nie < 0 (inaktiv/storniert: 0) – intern (Cron)';

-- ── 4. Einreihen ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_shop_einreihen(p_tenant_id uuid, p_fuellung_id uuid, p_art text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR p_fuellung_id IS NULL THEN
    RETURN;
  END IF;
  -- nur zugeordnete Füllungen (UNIQUE-Index tenant_id, fuellung_id) – für alle anderen Betriebe und Füllungen ein Indexzugriff
  IF NOT EXISTS (SELECT 1 FROM shop_zuordnungen z WHERE z.tenant_id = p_tenant_id AND z.fuellung_id = p_fuellung_id) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_einstellungen e
                  WHERE e.tenant_id = p_tenant_id AND e.modul_shop AND (p_art <> 'bestand' OR e.shop_bestand_uebertragen)) THEN
    RETURN;
  END IF;
  INSERT INTO shop_warteschlange (tenant_id, fuellung_id, art)
  VALUES (p_tenant_id, p_fuellung_id, p_art)
  ON CONFLICT (tenant_id, fuellung_id, art)
  DO UPDATE SET eingereiht_am = now(), versuche = 0, naechster_versuch_am = now(), letzter_fehler = NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_einreihen(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_shop_einreihen(uuid, uuid, text) IS
  'KAN-463: reiht eine zugeordnete Füllung zur Übertragung ein (bestand: nur mit Schalter; weindaten: nur mit Modul) – intern (Trigger)';

-- Füllung: Bestand, aktiv, Storno → bestand; Angaben der Weindaten → weindaten
CREATE FUNCTION public.s112_shop_fuellung_geaendert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.bestand_flaschen IS DISTINCT FROM OLD.bestand_flaschen OR NEW.aktiv IS DISTINCT FROM OLD.aktiv
     OR NEW.storniert_am IS DISTINCT FROM OLD.storniert_am THEN
    PERFORM public.s112_shop_einreihen(NEW.tenant_id, NEW.id, 'bestand');
  END IF;
  IF NEW.jahrgang IS DISTINCT FROM OLD.jahrgang OR NEW.rebsorte IS DISTINCT FROM OLD.rebsorte OR NEW.qualitaet IS DISTINCT FROM OLD.qualitaet
     OR NEW.zusatzbezeichnung IS DISTINCT FROM OLD.zusatzbezeichnung OR NEW.anbaugebiet IS DISTINCT FROM OLD.anbaugebiet
     OR NEW.erzeugnis IS DISTINCT FROM OLD.erzeugnis OR NEW.sekt_stufe IS DISTINCT FROM OLD.sekt_stufe THEN
    PERFORM public.s112_shop_einreihen(NEW.tenant_id, NEW.id, 'weindaten');
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_fuellung_geaendert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_shop_einreihen AFTER UPDATE OF bestand_flaschen, aktiv, storniert_am, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, anbaugebiet, erzeugnis, sekt_stufe
  ON public.fuellungen FOR EACH ROW EXECUTE FUNCTION public.s112_shop_fuellung_geaendert();

-- Auftragsposition: Reservierung der Füllung ändert sich
CREATE FUNCTION public.s112_shop_auftrag_position_geaendert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.fuellung_id IS NOT NULL THEN
    PERFORM public.s112_shop_einreihen(OLD.tenant_id, OLD.fuellung_id, 'bestand');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.fuellung_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.fuellung_id IS DISTINCT FROM OLD.fuellung_id) THEN
    PERFORM public.s112_shop_einreihen(NEW.tenant_id, NEW.fuellung_id, 'bestand');
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_auftrag_position_geaendert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_shop_einreihen AFTER INSERT OR DELETE OR UPDATE OF fuellung_id, menge, geliefert
  ON public.auftrag_positionen FOR EACH ROW EXECUTE FUNCTION public.s112_shop_auftrag_position_geaendert();

-- Auftrag: Status bzw. Storno geben Reservierungen frei oder binden sie wieder
CREATE FUNCTION public.s112_shop_auftrag_geaendert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.s112_shop_einreihen(p.tenant_id, p.fuellung_id, 'bestand')
     FROM auftrag_positionen p
    WHERE p.auftrag_id = NEW.id AND p.fuellung_id IS NOT NULL;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_auftrag_geaendert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_shop_einreihen AFTER UPDATE OF status, storniert_am, art
  ON public.auftraege FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status OR NEW.storniert_am IS DISTINCT FROM OLD.storniert_am OR NEW.art IS DISTINCT FROM OLD.art)
  EXECUTE FUNCTION public.s112_shop_auftrag_geaendert();

-- E-Label: Freigabe, Rücknahme, Werte → weindaten
CREATE FUNCTION public.s112_shop_elabel_geaendert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.s112_shop_einreihen(OLD.tenant_id, OLD.fuellung_id, 'weindaten');
  ELSE
    PERFORM public.s112_shop_einreihen(NEW.tenant_id, NEW.fuellung_id, 'weindaten');
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_elabel_geaendert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_shop_einreihen AFTER INSERT OR UPDATE OR DELETE
  ON public.elabels FOR EACH ROW EXECUTE FUNCTION public.s112_shop_elabel_geaendert();

-- Zuordnung: neu bzw. umgehängt → Bestand der neuen Füllung melden; Einträge der alten Füllung entfallen
CREATE FUNCTION public.s112_shop_zuordnung_geaendert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND (TG_OP = 'DELETE' OR NEW.fuellung_id IS DISTINCT FROM OLD.fuellung_id) THEN
    DELETE FROM shop_warteschlange w WHERE w.tenant_id = OLD.tenant_id AND w.fuellung_id = OLD.fuellung_id;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.fuellung_id IS DISTINCT FROM OLD.fuellung_id) THEN
    PERFORM public.s112_shop_einreihen(NEW.tenant_id, NEW.fuellung_id, 'bestand');
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_zuordnung_geaendert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_shop_einreihen AFTER INSERT OR DELETE OR UPDATE OF fuellung_id
  ON public.shop_zuordnungen FOR EACH ROW EXECUTE FUNCTION public.s112_shop_zuordnung_geaendert();

-- Einstellungen: Einschalten reiht alle zugeordneten Füllungen ein, Ausschalten leert die Warteschlange des Betriebs;
-- eine geänderte Reserve meldet alle neu
CREATE FUNCTION public.s112_shop_einstellungen_geaendert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT NEW.modul_shop THEN
    DELETE FROM shop_warteschlange w WHERE w.tenant_id = NEW.tenant_id;
  ELSIF NOT NEW.shop_bestand_uebertragen THEN
    DELETE FROM shop_warteschlange w WHERE w.tenant_id = NEW.tenant_id AND w.art = 'bestand';
  ELSE
    PERFORM public.s112_shop_einreihen(z.tenant_id, z.fuellung_id, 'bestand')
       FROM shop_zuordnungen z WHERE z.tenant_id = NEW.tenant_id;
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_einstellungen_geaendert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_shop_einreihen AFTER UPDATE OF modul_shop, shop_bestand_uebertragen, shop_bestandsreserve
  ON public.tenant_einstellungen FOR EACH ROW
  WHEN (NEW.modul_shop IS DISTINCT FROM OLD.modul_shop OR NEW.shop_bestand_uebertragen IS DISTINCT FROM OLD.shop_bestand_uebertragen
        OR NEW.shop_bestandsreserve IS DISTINCT FROM OLD.shop_bestandsreserve)
  EXECUTE FUNCTION public.s112_shop_einstellungen_geaendert();

-- ── 5. Täglicher Abgleich (Cron, Service-Role): alle zugeordneten Füllungen der Betriebe mit Schalter einreihen ───────
CREATE FUNCTION public.s112_shop_abgleich_einreihen()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO shop_warteschlange (tenant_id, fuellung_id, art)
  SELECT z.tenant_id, z.fuellung_id, 'bestand'
    FROM shop_zuordnungen z
    JOIN tenant_einstellungen e ON e.tenant_id = z.tenant_id AND e.modul_shop AND e.shop_bestand_uebertragen
  ON CONFLICT (tenant_id, fuellung_id, art) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_shop_abgleich_einreihen() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_shop_abgleich_einreihen() IS
  'KAN-463: täglicher Abgleich – reiht alle zugeordneten Füllungen der Betriebe mit eingeschalteter Bestandsübertragung ein – intern (Cron)';

NOTIFY pgrst, 'reload schema';
