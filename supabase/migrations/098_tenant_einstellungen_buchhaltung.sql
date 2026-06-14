-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 098: tenant_einstellungen – E&A, FIBU, SumUp Modul-Felder
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Modul-Toggles ─────────────────────────────────────────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS modul_ea      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS modul_fibu    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS modul_sumup   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant_einstellungen.modul_ea    IS 'Einnahmen-Ausgaben-Rechner aktiv';
COMMENT ON COLUMN tenant_einstellungen.modul_fibu  IS 'FIBU (doppelte Buchhaltung) aktiv – schließt modul_ea aus';
COMMENT ON COLUMN tenant_einstellungen.modul_sumup IS 'SumUp Kartenterminal-Integration aktiv';

-- ── E&A Konfiguration ─────────────────────────────────────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS ea_buchung_modus     text    NOT NULL DEFAULT 'brutto'
    CHECK (ea_buchung_modus IN ('netto', 'brutto')),
  ADD COLUMN IF NOT EXISTS ea_kleinunternehmer  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ea_uva_zeitraum      text    NOT NULL DEFAULT 'quartalsweise'
    CHECK (ea_uva_zeitraum IN ('monatlich', 'quartalsweise')),
  ADD COLUMN IF NOT EXISTS ea_ust_export_satz   numeric(5,2) DEFAULT NULL;
    -- NULL = kein Export-USt-Satz; gesetzt = dieser Satz gilt für Exportbuchungen

COMMENT ON COLUMN tenant_einstellungen.ea_buchung_modus    IS 'Eingabemodus: netto (Nettobeträge eingeben) oder brutto (Rechnungsbetrag, Netto wird rückgerechnet)';
COMMENT ON COLUMN tenant_einstellungen.ea_kleinunternehmer IS 'Kleinunternehmer gem. § 6 Abs. 1 Z 27 UStG – keine UVA-Pflicht';
COMMENT ON COLUMN tenant_einstellungen.ea_uva_zeitraum     IS 'UVA-Voranmeldungszeitraum';
COMMENT ON COLUMN tenant_einstellungen.ea_ust_export_satz  IS 'Sonder-USt-Satz für Weinexport-Buchungen (variabel je Zielland), NULL = nicht gesetzt';

-- ── FIBU Konfiguration ────────────────────────────────────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS fibu_kontenrahmen    text    NOT NULL DEFAULT 'EKR'
    CHECK (fibu_kontenrahmen IN ('EKR', 'SKR04')),
  ADD COLUMN IF NOT EXISTS fibu_geschaeftsjahr_start  smallint NOT NULL DEFAULT 1
    CHECK (fibu_geschaeftsjahr_start BETWEEN 1 AND 12);
    -- 1 = Jänner (Regelfall), 4 = April (abweichendes WJ möglich)

COMMENT ON COLUMN tenant_einstellungen.fibu_kontenrahmen         IS 'Kontenrahmen: EKR (österr. Einheitskontenrahmen) oder SKR04';
COMMENT ON COLUMN tenant_einstellungen.fibu_geschaeftsjahr_start IS 'Startmonat des Geschäftsjahres (1=Jänner)';

-- ── SumUp Konfiguration ───────────────────────────────────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS sumup_api_key        text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sumup_merchant_code  text    DEFAULT NULL;
    -- Werden verschlüsselt gespeichert (Supabase Vault empfohlen für Produktion)

COMMENT ON COLUMN tenant_einstellungen.sumup_api_key       IS 'SumUp API Key (persönlicher Access Token des Merchants)';
COMMENT ON COLUMN tenant_einstellungen.sumup_merchant_code IS 'SumUp Merchant Code (aus SumUp Dashboard)';

-- ── Constraint: E&A und FIBU schließen sich gegenseitig aus ──────────────────
ALTER TABLE tenant_einstellungen
  ADD CONSTRAINT chk_ea_fibu_exklusiv
    CHECK (NOT (modul_ea = true AND modul_fibu = true));

-- ── Constraint: SumUp nur wenn E&A oder FIBU aktiv ───────────────────────────
ALTER TABLE tenant_einstellungen
  ADD CONSTRAINT chk_sumup_bedingt_buchhaltung
    CHECK (NOT (modul_sumup = true AND modul_ea = false AND modul_fibu = false));
