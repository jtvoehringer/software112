-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 100: FIBU-Modul (doppelte Buchhaltung)
-- Kontenrahmen: Österreichischer Einheitskontenrahmen (EKR)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Kontenplan ─────────────────────────────────────────────────────────────
-- Systemkonten (tenant_id=NULL) liefern den EKR-Standardkontenplan.
-- Mandanten können eigene Konten ergänzen oder Standardkonten umbenennen.

CREATE TYPE fibu_kontotyp AS ENUM (
  'aktivkonto',       -- Bilanz: Aktiva (z. B. Bank, Kasse, Forderungen)
  'passivkonto',      -- Bilanz: Passiva (z. B. Eigenkapital, Verbindlichkeiten)
  'aufwandskonto',    -- G&V: Aufwendungen (Klasse 5–7)
  'ertragskonto',     -- G&V: Erträge (Klasse 4)
  'gemischt'          -- Bestandskonten mit Aktiv/Passiv-Charakter
);

CREATE TABLE fibu_kontenplan (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid            REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = EKR-Systemkonto (alle Mandanten)
  konto_nr        smallint        NOT NULL,   -- EKR: 1000–9999
  konto_name      text            NOT NULL,
  typ             fibu_kontotyp   NOT NULL,
  ust_satz        numeric(5,2)    DEFAULT NULL
    CHECK (ust_satz IS NULL OR ust_satz IN (0, 10, 13, 20)),
  aktiv           boolean         NOT NULL DEFAULT true,
  UNIQUE (tenant_id, konto_nr)
);

COMMENT ON TABLE fibu_kontenplan IS 'Kontenplan: EKR-Systemkonten (tenant_id=NULL) + mandantspezifische Ergänzungen';

CREATE INDEX idx_fibu_kp_tenant ON fibu_kontenplan(tenant_id);
CREATE INDEX idx_fibu_kp_nr     ON fibu_kontenplan(konto_nr);

ALTER TABLE fibu_kontenplan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fibu_kp_select" ON fibu_kontenplan
  FOR SELECT USING (
    tenant_id IS NULL
    OR tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fibu_kp_write" ON fibu_kontenplan
  FOR ALL USING (
    tenant_id IS NOT NULL
    AND user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );

-- ── EKR-Systemkonten (Auszug, Weinbetrieb-relevante Konten) ──────────────────
INSERT INTO fibu_kontenplan (tenant_id, konto_nr, konto_name, typ, ust_satz) VALUES
  -- Klasse 0: Anlagevermögen
  (NULL, 1400, 'Maschinen & Anlagen',           'aktivkonto',  NULL),
  (NULL, 1500, 'Fuhrpark',                       'aktivkonto',  NULL),
  (NULL, 1600, 'Betriebs- & Geschäftsausstattung', 'aktivkonto', NULL),
  -- Klasse 1: Umlaufvermögen
  (NULL, 2000, 'Kasse',                          'aktivkonto',  NULL),
  (NULL, 2100, 'Bank',                           'aktivkonto',  NULL),
  (NULL, 2800, 'Forderungen aus Lieferungen',    'aktivkonto',  NULL),
  (NULL, 1500, 'Vorräte Fertigerzeugnisse (Wein)','aktivkonto', NULL),
  -- Klasse 3: Verbindlichkeiten & Eigenkapital
  (NULL, 3000, 'Eigenkapital',                   'passivkonto', NULL),
  (NULL, 3300, 'Verbindlichkeiten Lieferanten',  'passivkonto', NULL),
  (NULL, 3500, 'USt-Zahllast / Vorsteuer',       'passivkonto', NULL),
  -- Klasse 4: Erträge
  (NULL, 4000, 'Umsatzerlöse Weinverkauf Inland','ertragskonto', 20),
  (NULL, 4010, 'Umsatzerlöse Weinverkauf Export','ertragskonto',  0),
  (NULL, 4100, 'Umsatzerlöse Traubenverkauf',    'ertragskonto', 13),
  (NULL, 4800, 'Sonstige betriebliche Erträge',  'ertragskonto', 20),
  -- Klasse 5: Materialaufwand
  (NULL, 5000, 'Wareneinsatz Zukauf Trauben/Most','aufwandskonto', 13),
  (NULL, 5100, 'Verpackungsmaterial',            'aufwandskonto', 20),
  (NULL, 5200, 'Kellerei-Hilfsstoffe',           'aufwandskonto', 20),
  (NULL, 5300, 'Pflanzenschutzmittel',            'aufwandskonto', 20),
  (NULL, 5400, 'Dünger & Bodenverbesserung',     'aufwandskonto', 20),
  -- Klasse 6: Personalaufwand
  (NULL, 6000, 'Löhne & Gehälter',              'aufwandskonto', NULL),
  (NULL, 6200, 'Sozialversicherung',             'aufwandskonto', NULL),
  -- Klasse 7: Sonstiger Betriebsaufwand
  (NULL, 7000, 'Miete & Pacht',                 'aufwandskonto', NULL),
  (NULL, 7200, 'Energie',                        'aufwandskonto', 20),
  (NULL, 7400, 'Reparatur & Instandhaltung',     'aufwandskonto', 20),
  (NULL, 7500, 'Versicherungen',                 'aufwandskonto', NULL),
  (NULL, 7600, 'Kfz-Aufwand',                   'aufwandskonto', 20),
  (NULL, 7700, 'Reise & Bewirtung',              'aufwandskonto', 20),
  (NULL, 7800, 'Büro & Verwaltung',              'aufwandskonto', 20),
  (NULL, 7900, 'Marketing & Messen',             'aufwandskonto', 20),
  (NULL, 7990, 'Sonstiger Betriebsaufwand',      'aufwandskonto', 20),
  -- Klasse 8: Finanzaufwand / -ertrag
  (NULL, 8300, 'Zinsaufwand',                   'aufwandskonto', NULL),
  (NULL, 8400, 'Zinsertrag',                    'ertragskonto',  NULL);


-- ── 2. Buchungsperioden ───────────────────────────────────────────────────────
CREATE TABLE fibu_perioden (
  id          uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jahr        smallint  NOT NULL,
  monat       smallint  NOT NULL CHECK (monat BETWEEN 1 AND 12),
  gesperrt    boolean   NOT NULL DEFAULT false,
  gesperrt_am timestamptz,
  UNIQUE (tenant_id, jahr, monat)
);

COMMENT ON TABLE fibu_perioden IS 'Buchungsperioden – nach Monatsabschluss gesperrt';

CREATE INDEX idx_fibu_per_tenant ON fibu_perioden(tenant_id);

ALTER TABLE fibu_perioden ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fibu_per_select" ON fibu_perioden
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "fibu_per_write" ON fibu_perioden
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );


-- ── 3. Buchungssätze (Journal) ────────────────────────────────────────────────
CREATE TABLE fibu_buchungssaetze (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  periode_id      uuid          NOT NULL REFERENCES fibu_perioden(id),
  belegnummer     text          NOT NULL,   -- z. B. "2026-000042"
  belegdatum      date          NOT NULL,
  buchungsdatum   date          NOT NULL DEFAULT CURRENT_DATE,
  beschreibung    text          NOT NULL,
  gesperrt        boolean       NOT NULL DEFAULT false,  -- true = Periode gesperrt
  -- Verknüpfungen (optional)
  verkaufsposten_id uuid        REFERENCES verkaufsposten(id) ON DELETE SET NULL,
  erstellt_am     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, belegnummer)
);

COMMENT ON TABLE fibu_buchungssaetze IS 'Buchungsjournal: je Geschäftsfall ein Satz mit 2+ Buchungszeilen (Soll/Haben)';

CREATE INDEX idx_fibu_bs_tenant ON fibu_buchungssaetze(tenant_id);
CREATE INDEX idx_fibu_bs_datum  ON fibu_buchungssaetze(buchungsdatum DESC);
CREATE INDEX idx_fibu_bs_vkpost ON fibu_buchungssaetze(verkaufsposten_id);

ALTER TABLE fibu_buchungssaetze ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fibu_bs_select" ON fibu_buchungssaetze
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "fibu_bs_insert" ON fibu_buchungssaetze
  FOR INSERT WITH CHECK (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "fibu_bs_update" ON fibu_buchungssaetze
  FOR UPDATE USING (
    NOT gesperrt
    AND user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "fibu_bs_delete" ON fibu_buchungssaetze
  FOR DELETE USING (
    NOT gesperrt
    AND user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );


-- ── 4. Buchungszeilen (Soll/Haben) ────────────────────────────────────────────
CREATE TABLE fibu_buchungszeilen (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  buchungssatz_id uuid          NOT NULL REFERENCES fibu_buchungssaetze(id) ON DELETE CASCADE,
  konto_id        uuid          NOT NULL REFERENCES fibu_kontenplan(id),
  seite           text          NOT NULL CHECK (seite IN ('soll', 'haben')),
  betrag          numeric(12,2) NOT NULL CHECK (betrag > 0),
  -- USt-Details (nur bei USt-relevanten Konten)
  ust_satz        numeric(5,2)  DEFAULT NULL CHECK (ust_satz IS NULL OR ust_satz IN (0, 10, 13, 20)),
  ust_betrag      numeric(12,2) DEFAULT NULL,
  notizen         text
);

COMMENT ON TABLE fibu_buchungszeilen IS 'Soll/Haben-Zeilen je Buchungssatz; Summe Soll = Summe Haben (Constraint per Trigger)';

CREATE INDEX idx_fibu_bz_satz  ON fibu_buchungszeilen(buchungssatz_id);
CREATE INDEX idx_fibu_bz_konto ON fibu_buchungszeilen(konto_id);

ALTER TABLE fibu_buchungszeilen ENABLE ROW LEVEL SECURITY;

-- Liest über buchungssatz → tenant_id
CREATE POLICY "fibu_bz_select" ON fibu_buchungszeilen
  FOR SELECT USING (
    buchungssatz_id IN (
      SELECT id FROM fibu_buchungssaetze WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "fibu_bz_write" ON fibu_buchungszeilen
  FOR ALL USING (
    buchungssatz_id IN (
      SELECT id FROM fibu_buchungssaetze WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
      ) AND NOT gesperrt
    )
  );

-- ── Trigger: Soll = Haben Konsistenz-Check ────────────────────────────────────
CREATE OR REPLACE FUNCTION check_fibu_buchungssatz_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_soll  numeric(12,2);
  v_haben numeric(12,2);
BEGIN
  SELECT
    COALESCE(SUM(betrag) FILTER (WHERE seite = 'soll'),  0),
    COALESCE(SUM(betrag) FILTER (WHERE seite = 'haben'), 0)
  INTO v_soll, v_haben
  FROM fibu_buchungszeilen
  WHERE buchungssatz_id = NEW.buchungssatz_id;

  -- Nur prüfen wenn Satz bereits beide Seiten hat (mindestens 2 Zeilen)
  IF (SELECT COUNT(*) FROM fibu_buchungszeilen WHERE buchungssatz_id = NEW.buchungssatz_id) >= 2 THEN
    IF ABS(v_soll - v_haben) > 0.01 THEN
      RAISE EXCEPTION 'Buchungssatz nicht ausgeglichen: Soll=% Haben=% (Differenz=%)',
        v_soll, v_haben, v_soll - v_haben;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fibu_balance_check
AFTER INSERT OR UPDATE ON fibu_buchungszeilen
FOR EACH ROW EXECUTE FUNCTION check_fibu_buchungssatz_balance();


-- ── 5. Hilfsfunktion: nächste Belegnummer ────────────────────────────────────
CREATE OR REPLACE FUNCTION get_next_belegnummer(p_tenant_id uuid, p_jahr smallint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nr integer;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(belegnummer, '^[0-9]+-', ''), '')::integer
  ), 0) + 1
  INTO v_nr
  FROM fibu_buchungssaetze
  WHERE tenant_id = p_tenant_id
    AND belegnummer LIKE p_jahr || '-%';

  RETURN p_jahr::text || '-' || LPAD(v_nr::text, 6, '0');
END;
$$;
