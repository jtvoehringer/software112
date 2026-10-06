-- KAN-216 (06.10.2026, Epic KAN-189 „Bottlebooks ersetzen“): E-Label-Daten je Füllung – Zutaten-/Zusatzstoffkatalog,
-- Zutatenliste, Nährwerte, Freigabe.
-- Rechtsgrundlage: VO (EU) 2021/2117 (Art. 119 GMO), Zusatzstoff-Kategorien VO (EU) 2019/934 Anhang I,
-- Nährwerte VO (EU) 1169/2011 Anhang XIV/XV.
--  1. elabel_zutaten: globaler Katalog (ohne tenant_id) – Zutaten und Zusatzstoffe mit Kategorie, E-Nummer,
--     Allergen, Bezeichnung DE/EN. Lesen alle angemeldeten Benutzer, pflegen nur Plattform-Admins.
--  2. elabels: je Füllung höchstens ein E-Label (Entwurf → Freigegeben) mit Zutatenliste (geordnete Katalog-IDs),
--     Eingangswerten der Berechnung (Analyse, Alkohol, Restzucker, Säure, Glycerin) und Nährwerten je 100 ml.
--     Öffentliche Kennung „code“ (global eindeutig, für die E-Label-Seite KAN-217). Freigegeben = gesperrt
--     (s112_freeze, Korrektur nur Betriebsleitung über s112_freeze_korrektur).
--  3. keller_behandlungstypen.elabel_zutat_id: Zuordnung Behandlungstyp → Katalogeintrag (Vorschlag der Zutatenliste
--     aus den Kellerbehandlungen der Chargen einer Füllung).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Katalog ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.elabel_zutaten (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kategorie    text NOT NULL CHECK (kategorie IN ('zutat', 'saeureregulator', 'konservierung', 'stabilisator', 'gas',
                                                  'dosage', 'allergen_hilfsstoff')),
  name_de      text NOT NULL CHECK (length(btrim(name_de)) > 0),
  name_en      text NOT NULL CHECK (length(btrim(name_en)) > 0),
  e_nummer     text CHECK (e_nummer IS NULL OR e_nummer ~ '^E ?[0-9]{3,4}[a-z]?$'),
  allergen     text CHECK (allergen IS NULL OR allergen IN ('sulfite', 'ei', 'milch')),
  sortierung   integer NOT NULL DEFAULT 100,
  aktiv        boolean NOT NULL DEFAULT true,
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kategorie, name_de)
);
COMMENT ON TABLE public.elabel_zutaten IS
  'KAN-216: globaler Katalog der Zutaten und Zusatzstoffe für das E-Label (Kategorien VO (EU) 2019/934) – pflegen nur Plattform-Admins';

ALTER TABLE public.elabel_zutaten ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.elabel_zutaten FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.elabel_zutaten FROM anon;
CREATE POLICY elabel_zutaten_lesen ON public.elabel_zutaten FOR SELECT TO authenticated USING (true);
CREATE POLICY elabel_zutaten_pa ON public.elabel_zutaten FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY zwei_faktor_aal ON public.elabel_zutaten AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

INSERT INTO public.elabel_zutaten (kategorie, name_de, name_en, e_nummer, allergen, sortierung) VALUES
  ('zutat',              'Trauben',                                   'Grapes',                                   NULL,    NULL,      10),
  ('zutat',              'Saccharose',                                'Sucrose',                                  NULL,    NULL,      20),
  ('zutat',              'Rektifiziertes Traubenmostkonzentrat',      'Rectified concentrated grape must',        NULL,    NULL,      30),
  ('zutat',              'Traubenmostkonzentrat',                     'Concentrated grape must',                  NULL,    NULL,      40),
  ('saeureregulator',    'Weinsäure',                                 'Tartaric acid',                            'E334',  NULL,      10),
  ('saeureregulator',    'Äpfelsäure',                                'Malic acid',                               'E296',  NULL,      20),
  ('saeureregulator',    'Milchsäure',                                'Lactic acid',                              'E270',  NULL,      30),
  ('saeureregulator',    'Kaliumhydrogentartrat',                     'Potassium hydrogen tartrate',              'E336',  NULL,      40),
  ('saeureregulator',    'Calciumcarbonat',                           'Calcium carbonate',                        'E170',  NULL,      50),
  ('saeureregulator',    'Kaliumhydrogencarbonat',                    'Potassium hydrogen carbonate',             'E501',  NULL,      60),
  ('konservierung',      'Sulfite',                                   'Sulphites',                                'E220',  'sulfite', 10),
  ('konservierung',      'Kaliummetabisulfit',                        'Potassium metabisulphite',                 'E224',  'sulfite', 20),
  ('konservierung',      'Sorbinsäure',                               'Sorbic acid',                              'E200',  NULL,      30),
  ('konservierung',      'Kaliumsorbat',                              'Potassium sorbate',                        'E202',  NULL,      40),
  ('konservierung',      'Ascorbinsäure',                             'Ascorbic acid',                            'E300',  NULL,      50),
  ('konservierung',      'Lysozym (aus Ei)',                          'Lysozyme (from egg)',                      'E1105', 'ei',      60),
  ('stabilisator',       'Metaweinsäure',                             'Metatartaric acid',                        'E353',  NULL,      10),
  ('stabilisator',       'Gummi arabicum',                            'Gum arabic',                               'E414',  NULL,      20),
  ('stabilisator',       'Carboxymethylcellulose',                    'Carboxymethylcellulose',                   'E466',  NULL,      30),
  ('stabilisator',       'Kaliumpolyaspartat',                        'Potassium polyaspartate',                  'E456',  NULL,      40),
  ('stabilisator',       'Citronensäure',                             'Citric acid',                              'E330',  NULL,      50),
  ('stabilisator',       'Mannoproteine aus Hefe',                    'Yeast mannoproteins',                      NULL,    NULL,      60),
  ('gas',                'Argon',                                     'Argon',                                    'E938',  NULL,      10),
  ('gas',                'Stickstoff',                                'Nitrogen',                                 'E941',  NULL,      20),
  ('gas',                'Kohlendioxid',                              'Carbon dioxide',                           'E290',  NULL,      30),
  ('gas',                'Abgefüllt in Schutzatmosphäre',             'Bottled in a protective atmosphere',       NULL,    NULL,      40),
  ('dosage',             'Fülldosage',                                'Tirage liqueur',                           NULL,    NULL,      10),
  ('dosage',             'Versanddosage',                             'Expedition liqueur',                       NULL,    NULL,      20),
  ('allergen_hilfsstoff','Ei (Eiklar)',                               'Egg (egg white)',                          NULL,    'ei',      10),
  ('allergen_hilfsstoff','Eiprotein',                                 'Egg protein',                              NULL,    'ei',      20),
  ('allergen_hilfsstoff','Milch (Casein)',                            'Milk (casein)',                            NULL,    'milch',   30),
  ('allergen_hilfsstoff','Milchprotein',                              'Milk protein',                             NULL,    'milch',   40);

-- 2. E-Label je Füllung ──────────────────────────────────────────────────────────────────────────────────────
-- öffentliche Kennung: 10 Zeichen aus einem Alphabet ohne verwechselbare Zeichen (kein 0/O, 1/I/L)
CREATE OR REPLACE FUNCTION public.s112_elabel_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $function$
  SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::integer, 1), '')
    FROM generate_series(1, 10)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_elabel_code() TO authenticated;

CREATE TABLE public.elabels (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fuellung_id           uuid NOT NULL UNIQUE REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  code                  text NOT NULL UNIQUE DEFAULT public.s112_elabel_code() CHECK (code ~ '^[2-9A-HJKMNP-Z]{10}$'),
  status                text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'freigegeben')),
  zutaten_ids           uuid[] NOT NULL DEFAULT '{}',
  -- Eingangswerte der Berechnung (Stand der Analyse bzw. von Hand)
  analyse_id            uuid REFERENCES public.weinanalysen(id) ON DELETE SET NULL,
  alkohol_vol           numeric(5,2) CHECK (alkohol_vol IS NULL OR alkohol_vol BETWEEN 0 AND 25),
  restzucker_gl         numeric(6,1) CHECK (restzucker_gl IS NULL OR restzucker_gl BETWEEN 0 AND 700),
  gesamtsaeure_gl       numeric(5,1) CHECK (gesamtsaeure_gl IS NULL OR gesamtsaeure_gl BETWEEN 0 AND 30),
  glycerin_gl           numeric(5,1) CHECK (glycerin_gl IS NULL OR glycerin_gl BETWEEN 0 AND 40),
  -- Nährwerte je 100 ml (gerundet nach dem Leitfaden der Kommission)
  energie_kj            integer CHECK (energie_kj IS NULL OR energie_kj BETWEEN 0 AND 2000),
  energie_kcal          integer CHECK (energie_kcal IS NULL OR energie_kcal BETWEEN 0 AND 500),
  fett_g                numeric(5,2) NOT NULL DEFAULT 0 CHECK (fett_g >= 0),
  fett_gesaettigt_g     numeric(5,2) NOT NULL DEFAULT 0 CHECK (fett_gesaettigt_g >= 0),
  kohlenhydrate_g       numeric(5,1) CHECK (kohlenhydrate_g IS NULL OR kohlenhydrate_g >= 0),
  zucker_g              numeric(5,1) CHECK (zucker_g IS NULL OR zucker_g >= 0),
  eiweiss_g             numeric(5,2) NOT NULL DEFAULT 0 CHECK (eiweiss_g >= 0),
  salz_g                numeric(5,2) NOT NULL DEFAULT 0 CHECK (salz_g >= 0),
  manuell               boolean NOT NULL DEFAULT false,
  manuell_grund         text CHECK (NOT manuell OR length(btrim(coalesce(manuell_grund, ''))) >= 10),
  freigegeben_am        timestamptz,
  freigegeben_von       uuid,
  freigegeben_von_name  text,
  erstellt_am           timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elabels_freigabe_vollstaendig CHECK (status = 'entwurf' OR (
    freigegeben_am IS NOT NULL AND cardinality(zutaten_ids) > 0 AND energie_kj IS NOT NULL AND energie_kcal IS NOT NULL
    AND kohlenhydrate_g IS NOT NULL AND zucker_g IS NOT NULL))
);
CREATE INDEX elabels_tenant_idx ON public.elabels (tenant_id);
CREATE INDEX elabels_analyse_idx ON public.elabels (analyse_id) WHERE analyse_id IS NOT NULL;
COMMENT ON TABLE public.elabels IS
  'KAN-216: E-Label je Füllung (Zutatenliste, Nährwerte je 100 ml, Freigabe; code = öffentliche Kennung) – freigegeben gesperrt';

ALTER TABLE public.elabels ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.elabels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.elabels FROM anon;
CREATE POLICY elabels_select ON public.elabels FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY elabels_insert ON public.elabels FOR INSERT TO authenticated
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY elabels_update ON public.elabels FOR UPDATE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY elabels_delete ON public.elabels FOR DELETE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY modul_insert ON public.elabels AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft']));
CREATE POLICY modul_update ON public.elabels AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft']))
  WITH CHECK (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft']));
CREATE POLICY modul_delete ON public.elabels AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft']));
CREATE POLICY mitgliedschaft_aktiv ON public.elabels AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.elabels AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.elabels AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.elabels AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.elabels AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');
CREATE TRIGGER z_fremdverweis_analyse_id BEFORE INSERT OR UPDATE OF analyse_id, tenant_id ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('analyse_id', 'weinanalysen', '', '', '');

-- Zutatenliste nur aus dem aktiven Katalog, ohne Doppelte; Kennung unveränderlich; Freigabe stempeln
CREATE OR REPLACE FUNCTION public.s112_elabel_pruefen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Die Kennung eines E-Labels ist unveränderlich (steht im gedruckten QR-Code).' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(DISTINCT z) FROM unnest(NEW.zutaten_ids) z) <> cardinality(NEW.zutaten_ids)
     OR EXISTS (SELECT 1 FROM unnest(NEW.zutaten_ids) z
                 WHERE NOT EXISTS (SELECT 1 FROM public.elabel_zutaten k WHERE k.id = z AND k.aktiv)) THEN
    RAISE EXCEPTION 'Die Zutatenliste enthält unbekannte, inaktive oder doppelte Einträge.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'freigegeben' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'freigegeben') THEN
    NEW.freigegeben_am := now();
    NEW.freigegeben_von := v_uid;
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
      INTO NEW.freigegeben_von_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    IF NEW.freigegeben_von_name IS NULL AND v_uid IS NOT NULL THEN
      SELECT u.email INTO NEW.freigegeben_von_name FROM auth.users u WHERE u.id = v_uid;
    END IF;
  END IF;
  NEW.aktualisiert_am := now();
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_elabel_pruefen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_elabel_pruefen BEFORE INSERT OR UPDATE ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_elabel_pruefen();

-- KAN-96: freigegeben = gesperrt (auch Löschen); Korrektur nur Betriebsleitung über s112_freeze_korrektur
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.elabels
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('E-Label freigegeben', $$o.status = 'freigegeben'$$, 'aktualisiert_am', 'freigegeben_am');

-- 3. Zuordnung Behandlungstyp → Katalog ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.keller_behandlungstypen
  ADD COLUMN elabel_zutat_id uuid REFERENCES public.elabel_zutaten(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.keller_behandlungstypen.elabel_zutat_id IS
  'KAN-216: Katalogeintrag für die E-Label-Zutatenliste (Vorschlag aus den Kellerbehandlungen der Chargen)';
