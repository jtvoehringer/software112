-- Migration 043: Weinexport-Modul
-- Exportaufträge, Positionen, Dokumente-Checkliste

-- ── Exportaufträge ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exportauftraege (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  created_at    timestamptz DEFAULT now(),

  -- Exportkunde (Importeur/Distributor)
  kontakt_id    uuid REFERENCES kontakte(id) ON DELETE SET NULL,
  firma_id      uuid REFERENCES firmen(id)   ON DELETE SET NULL,

  -- Referenz & Datum
  referenz      varchar(50),          -- eigene Exportnummer
  datum         date DEFAULT CURRENT_DATE,
  lieferdatum   date,

  -- Logistik
  incoterms     varchar(10),          -- EXW, FOB, CIF, DAP, DDP …
  transport_art varchar(20),          -- LKW, Bahn, Schiff, Flugzeug
  destination_land  varchar(100),
  destination_stadt varchar(100),

  -- Zoll & Herkunft
  eori_kunde    varchar(30),          -- EORI-Nummer des Importeurs
  taric_code    varchar(20) DEFAULT '2204',
  ursprungsland varchar(3)  DEFAULT 'AT',

  -- Finanzen
  waehrung      varchar(3)  DEFAULT 'EUR',
  versicherungswert numeric(10,2),

  -- Status
  status        varchar(20) DEFAULT 'entwurf',  -- entwurf/bestaetigt/versendet/abgeschlossen
  notizen       text,
  aktiv         boolean     DEFAULT true
);

-- ── Positionen (Weine im Auftrag) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exportauftrag_positionen (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  exportauftrag_id  uuid NOT NULL REFERENCES exportauftraege(id) ON DELETE CASCADE,
  fullung_id        uuid REFERENCES fuellungen(id) ON DELETE SET NULL,
  beschreibung      text,             -- manuell wenn kein Füllungs-Link
  menge             numeric(10,2),
  einheit           varchar(10) DEFAULT 'Fl',   -- Fl / Kiste / HL
  preis_eur         numeric(10,4),
  taric_code        varchar(20) DEFAULT '2204.21',
  sort_order        integer DEFAULT 0
);

-- ── Dokumente-Checkliste ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_dokumente (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  exportauftrag_id  uuid NOT NULL REFERENCES exportauftraege(id) ON DELETE CASCADE,
  dokument_art      varchar(30) NOT NULL,
  -- v1v2 / eur1 / cmr / certificate_of_origin / phytosanitaer / lieferschein / rechnung
  status            varchar(20) DEFAULT 'ausstehend',
  -- ausstehend / beantragt / ausgestellt / nicht_erforderlich
  ausgestellt_am    date,
  notizen           text,
  UNIQUE(exportauftrag_id, dokument_art)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE exportauftraege       ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportauftrag_positionen ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_dokumente      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_exportauftraege" ON exportauftraege
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tenant_exportauftrag_positionen" ON exportauftrag_positionen
  USING (exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id IN
    (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())));
CREATE POLICY "tenant_export_dokumente" ON export_dokumente
  USING (exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id IN
    (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())));

-- ── modul_weinexport Toggle in tenant_einstellungen ──────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS modul_weinexport boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS weinexport_paket varchar(10) DEFAULT 'basic';
  -- basic = EU-Dokumente (V1/V2, EUR.1) | pro = + Drittländer

-- ── Exportnummern-Sequenz ─────────────────────────────────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS export_prefix  varchar(10) DEFAULT 'EX',
  ADD COLUMN IF NOT EXISTS export_zaehler integer      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS export_stellen integer      DEFAULT 4;

CREATE OR REPLACE FUNCTION get_next_exportnummer(p_tenant_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_prefix text; v_zaehler int; v_stellen int;
BEGIN
  UPDATE tenant_einstellungen
    SET export_zaehler = export_zaehler + 1
    WHERE tenant_id = p_tenant_id
    RETURNING export_prefix, export_zaehler, export_stellen
    INTO v_prefix, v_zaehler, v_stellen;
  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END $$;
