-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 099: E&A-Modul (Einnahmen-Ausgaben-Rechner)
-- Österreichisches Recht: § 4 Abs. 3 EStG, USt-Sätze 0/10/13/20 %
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Kategorien ─────────────────────────────────────────────────────────────
-- Systemkategorien (tenant_id = NULL) gelten für alle Mandanten.
-- Mandantspezifische Kategorien haben tenant_id gesetzt.

CREATE TABLE ea_kategorien (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid          REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = Systemkategorie, sichtbar für alle Mandanten
  typ           text          NOT NULL CHECK (typ IN ('einnahme', 'ausgabe', 'beides')),
  name          text          NOT NULL,
  konto_nr      smallint,             -- AT Einheitskontenrahmen (z. B. 4000, 7200)
  ust_satz_std  numeric(5,2)  NOT NULL DEFAULT 20 CHECK (ust_satz_std IN (0, 10, 13, 20)),
  aktiv         boolean       NOT NULL DEFAULT true,
  sortierung    smallint      NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)             -- pro Mandant eindeutig (NULL-tenant = System)
);

COMMENT ON TABLE ea_kategorien IS 'Buchungskategorien für E&A; tenant_id=NULL = Systemkategorien (alle Mandanten)';

CREATE INDEX idx_ea_kat_tenant ON ea_kategorien(tenant_id);
CREATE INDEX idx_ea_kat_typ    ON ea_kategorien(typ);

ALTER TABLE ea_kategorien ENABLE ROW LEVEL SECURITY;

-- Systemkategorien (tenant_id=NULL) für alle lesbar
CREATE POLICY "ea_kat_select" ON ea_kategorien
  FOR SELECT USING (
    tenant_id IS NULL
    OR tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "ea_kat_write" ON ea_kategorien
  FOR ALL USING (
    tenant_id IS NOT NULL
    AND user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

-- ── Systemkategorien (österreichischer EKR, Weinbetrieb) ─────────────────────
INSERT INTO ea_kategorien (tenant_id, typ, name, konto_nr, ust_satz_std, sortierung) VALUES
  -- Einnahmen
  (NULL, 'einnahme', 'Weinverkauf Inland',        4000, 20,  10),
  (NULL, 'einnahme', 'Weinverkauf Export',         4010,  0,  20),
  (NULL, 'einnahme', 'Traubenverkauf',             4100, 13,  30),
  (NULL, 'einnahme', 'Sonstige Betriebseinnahmen', 4800, 20,  40),
  -- Ausgaben – Material & Produktion
  (NULL, 'ausgabe',  'Zukauf Trauben / Most',      5000, 13,  50),
  (NULL, 'ausgabe',  'Flaschen & Verpackung',      5100, 20,  60),
  (NULL, 'ausgabe',  'Hilfsstoffe (Kellerei)',      5200, 20,  70),
  (NULL, 'ausgabe',  'Pflanzenschutzmittel',        5300, 20,  80),
  (NULL, 'ausgabe',  'Dünger & Bodenverbesserung', 5400, 20,  90),
  -- Ausgaben – Betrieb
  (NULL, 'ausgabe',  'Energie (Strom, Gas)',        7200, 20, 100),
  (NULL, 'ausgabe',  'Reparatur & Instandhaltung', 7400, 20, 110),
  (NULL, 'ausgabe',  'Versicherungen',              7500,  0, 120),
  (NULL, 'ausgabe',  'Büro & Verwaltung',           7800, 20, 130),
  (NULL, 'ausgabe',  'Marketing & Messen',          7900, 20, 140),
  (NULL, 'ausgabe',  'Fahrzeug & Transport',        7600, 20, 150),
  (NULL, 'ausgabe',  'Personalkosten',              6000,  0, 160),
  (NULL, 'ausgabe',  'Miete & Pacht',               7000,  0, 170),
  (NULL, 'ausgabe',  'Sonstige Betriebsausgaben',   7990, 20, 180);


-- ── 2. Buchungen (Kerntabelle) ────────────────────────────────────────────────
CREATE TABLE ea_transaktionen (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  typ             text          NOT NULL CHECK (typ IN ('einnahme', 'ausgabe')),
  datum           date          NOT NULL,
  beschreibung    text          NOT NULL,
  kategorie_id    uuid          REFERENCES ea_kategorien(id) ON DELETE SET NULL,
  -- Beträge
  betrag_netto    numeric(12,2) NOT NULL CHECK (betrag_netto >= 0),
  ust_satz        numeric(5,2)  NOT NULL DEFAULT 20 CHECK (ust_satz IN (0, 10, 13, 20)),
  ust_betrag      numeric(12,2) GENERATED ALWAYS AS (ROUND(betrag_netto * ust_satz / 100, 2)) STORED,
  betrag_brutto   numeric(12,2) GENERATED ALWAYS AS (betrag_netto + ROUND(betrag_netto * ust_satz / 100, 2)) STORED,
  -- Metadaten
  is_locked       boolean       NOT NULL DEFAULT false,  -- true nach UVA-Übermittlung
  dauerauftrag_id uuid,                                  -- FK wird unten gesetzt
  import_quelle   text          DEFAULT 'manuell'        -- manuell/camt053/csv
    CHECK (import_quelle IN ('manuell', 'camt053', 'csv')),
  bank_ref        text,         -- Deduplizierung bei Bank-Import (AcctSvcrRef)
  notizen         text,
  erstellt_am     timestamptz   NOT NULL DEFAULT now(),
  aktualisiert_am timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_ref)  -- verhindert doppelten Bank-Import
);

COMMENT ON TABLE ea_transaktionen IS 'E&A-Buchungen: Einnahmen und Ausgaben mit USt-Ausweis';
COMMENT ON COLUMN ea_transaktionen.is_locked IS 'Gesperrt nach UVA-Übermittlung – keine Änderungen mehr möglich';

CREATE INDEX idx_ea_tx_tenant  ON ea_transaktionen(tenant_id);
CREATE INDEX idx_ea_tx_datum   ON ea_transaktionen(datum DESC);
CREATE INDEX idx_ea_tx_typ     ON ea_transaktionen(typ);
CREATE INDEX idx_ea_tx_locked  ON ea_transaktionen(is_locked);

ALTER TABLE ea_transaktionen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ea_tx_select" ON ea_transaktionen
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "ea_tx_insert" ON ea_transaktionen
  FOR INSERT WITH CHECK (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "ea_tx_update" ON ea_transaktionen
  FOR UPDATE USING (
    NOT is_locked
    AND user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "ea_tx_delete" ON ea_transaktionen
  FOR DELETE USING (
    NOT is_locked
    AND user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );


-- ── 3. Daueraufträge ──────────────────────────────────────────────────────────
CREATE TABLE ea_dauerauftraege (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  typ             text          NOT NULL CHECK (typ IN ('einnahme', 'ausgabe')),
  beschreibung    text          NOT NULL,
  kategorie_id    uuid          REFERENCES ea_kategorien(id) ON DELETE SET NULL,
  betrag_netto    numeric(12,2) NOT NULL CHECK (betrag_netto > 0),
  ust_satz        numeric(5,2)  NOT NULL DEFAULT 20 CHECK (ust_satz IN (0, 10, 13, 20)),
  -- Wiederholungsregel
  intervall       text          NOT NULL DEFAULT 'monatlich'
    CHECK (intervall IN ('monatlich', 'vierteljaehrlich', 'halbjaehrlich', 'jaehrlich')),
  tag_im_monat    smallint      NOT NULL DEFAULT 1 CHECK (tag_im_monat BETWEEN 1 AND 28),
  naechste_faelligkeit date     NOT NULL,
  aktiv           boolean       NOT NULL DEFAULT true,
  notizen         text,
  erstellt_am     timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE ea_dauerauftraege IS 'Wiederkehrende E&A-Buchungen; pg_cron wandelt fällige Aufträge täglich in ea_transaktionen um';

-- FK-Rückverbindung
ALTER TABLE ea_transaktionen
  ADD CONSTRAINT ea_tx_dauerauftrag_fk
  FOREIGN KEY (dauerauftrag_id) REFERENCES ea_dauerauftraege(id) ON DELETE SET NULL;

CREATE INDEX idx_ea_da_tenant   ON ea_dauerauftraege(tenant_id);
CREATE INDEX idx_ea_da_faellig  ON ea_dauerauftraege(naechste_faelligkeit) WHERE aktiv;

ALTER TABLE ea_dauerauftraege ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ea_da_select" ON ea_dauerauftraege
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "ea_da_write" ON ea_dauerauftraege
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

-- ── Cron-Funktion: fällige Daueraufträge → ea_transaktionen ──────────────────
CREATE OR REPLACE FUNCTION process_ea_dauerauftraege()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r ea_dauerauftraege%ROWTYPE;
BEGIN
  FOR r IN
    SELECT * FROM ea_dauerauftraege
    WHERE aktiv = true AND naechste_faelligkeit <= CURRENT_DATE
  LOOP
    INSERT INTO ea_transaktionen (
      tenant_id, typ, datum, beschreibung, kategorie_id,
      betrag_netto, ust_satz, dauerauftrag_id, import_quelle
    ) VALUES (
      r.tenant_id, r.typ, r.naechste_faelligkeit, r.beschreibung,
      r.kategorie_id, r.betrag_netto, r.ust_satz, r.id, 'manuell'
    );

    -- Nächste Fälligkeit berechnen
    UPDATE ea_dauerauftraege SET naechste_faelligkeit =
      CASE r.intervall
        WHEN 'monatlich'        THEN r.naechste_faelligkeit + INTERVAL '1 month'
        WHEN 'vierteljaehrlich' THEN r.naechste_faelligkeit + INTERVAL '3 months'
        WHEN 'halbjaehrlich'    THEN r.naechste_faelligkeit + INTERVAL '6 months'
        WHEN 'jaehrlich'        THEN r.naechste_faelligkeit + INTERVAL '1 year'
      END
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- pg_cron Dauerauftrag-Job (manuell einrichten nach Extension-Aktivierung):
-- 1. Supabase Dashboard -> Database -> Extensions -> pg_cron aktivieren
-- 2. Danach im SQL-Editor ausfuehren:
--    SELECT cron.schedule('ea_dauerauftraege_daily', '0 6 * * *', 'SELECT process_ea_dauerauftraege()');


-- ── 4. UVA-Meldungen ──────────────────────────────────────────────────────────
CREATE TABLE ea_uva (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jahr            smallint      NOT NULL,
  zeitraum        text          NOT NULL,  -- 'Q1','Q2','Q3','Q4' oder '01'–'12'
  -- Bemessungsgrundlagen (netto)
  bmgl_ust_0      numeric(12,2) NOT NULL DEFAULT 0,
  bmgl_ust_10     numeric(12,2) NOT NULL DEFAULT 0,
  bmgl_ust_13     numeric(12,2) NOT NULL DEFAULT 0,
  bmgl_ust_20     numeric(12,2) NOT NULL DEFAULT 0,
  -- Umsatzsteuer
  ust_10          numeric(12,2) NOT NULL DEFAULT 0,
  ust_13          numeric(12,2) NOT NULL DEFAULT 0,
  ust_20          numeric(12,2) NOT NULL DEFAULT 0,
  ust_gesamt      numeric(12,2) GENERATED ALWAYS AS (ust_10 + ust_13 + ust_20) STORED,
  -- Vorsteuer
  vst_10          numeric(12,2) NOT NULL DEFAULT 0,
  vst_13          numeric(12,2) NOT NULL DEFAULT 0,
  vst_20          numeric(12,2) NOT NULL DEFAULT 0,
  vst_gesamt      numeric(12,2) GENERATED ALWAYS AS (vst_10 + vst_13 + vst_20) STORED,
  -- Zahllast / Gutschrift
  zahllast        numeric(12,2) GENERATED ALWAYS AS (
    (ust_10 + ust_13 + ust_20) - (vst_10 + vst_13 + vst_20)
  ) STORED,
  -- Status
  gesperrt        boolean       NOT NULL DEFAULT false,
  gesperrt_am     timestamptz,
  notizen         text,
  erstellt_am     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, jahr, zeitraum)
);

COMMENT ON TABLE ea_uva IS 'UVA-Meldungen (Quartals- oder Monatsmeldung); nach Übermittlung gesperrt';

CREATE INDEX idx_ea_uva_tenant ON ea_uva(tenant_id);

ALTER TABLE ea_uva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ea_uva_select" ON ea_uva
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "ea_uva_write" ON ea_uva
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

-- ── Funktion: UVA berechnen ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION berechne_ea_uva(
  p_tenant_id uuid,
  p_jahr      smallint,
  p_zeitraum  text   -- 'Q1'/'Q2'/'Q3'/'Q4' oder '01'–'12'
)
RETURNS TABLE (
  bmgl_0 numeric, bmgl_10 numeric, bmgl_13 numeric, bmgl_20 numeric,
  ust_10 numeric, ust_13 numeric, ust_20 numeric,
  vst_10 numeric, vst_13 numeric, vst_20 numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_von date;
  v_bis date;
BEGIN
  -- Zeitraum → Datumsgrenzen
  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
  END IF;

  RETURN QUERY
  SELECT
    -- Bemessungsgrundlagen
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=0  THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=10 THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=13 THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=20 THEN t.betrag_netto ELSE 0 END),
    -- USt (auf Einnahmen)
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=10 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=13 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=20 THEN t.ust_betrag ELSE 0 END),
    -- VSt (auf Ausgaben)
    SUM(CASE WHEN t.typ='ausgabe' AND t.ust_satz=10 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='ausgabe' AND t.ust_satz=13 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='ausgabe' AND t.ust_satz=20 THEN t.ust_betrag ELSE 0 END)
  FROM ea_transaktionen t
  WHERE t.tenant_id = p_tenant_id
    AND t.datum BETWEEN v_von AND v_bis;
END;
$$;
