-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 097: Zahlungen + SumUp (shared Payment-Infrastruktur)
-- Betrifft: E&A-Modul, FIBU-Modul, Direktverkauf mit Kartenterminal
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Zahlungen auf Verkaufsposten ──────────────────────────────────────────
-- Ersetzt das bisherige Boolean bezahlt/bezahlt_am durch echte Zahlungseinträge.
-- Teilzahlungen (bar + Karte + Bank in beliebiger Kombination) sind möglich.
-- Der bezahlt-Status auf verkaufsposten wird per Trigger aktuell gehalten.

CREATE TYPE zahlungsart AS ENUM ('bar', 'karte', 'bank', 'gutschrift', 'sonstig');

CREATE TABLE zahlungen (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  verkaufsposten_id uuid          NOT NULL REFERENCES verkaufsposten(id) ON DELETE CASCADE,
  betrag            numeric(10,2) NOT NULL CHECK (betrag > 0),
  art               zahlungsart   NOT NULL DEFAULT 'bar',
  datum             date          NOT NULL DEFAULT CURRENT_DATE,
  notizen           text,
  -- SumUp-Verknüpfung (optional – nur wenn per Terminal bezahlt)
  sumup_transaction_id text       UNIQUE,
  erstellt_am       timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE zahlungen IS 'Zahlungseingänge auf Verkaufsposten – unterstützt Teilzahlungen und mehrere Zahlungsarten';

CREATE INDEX idx_zahlungen_tenant        ON zahlungen(tenant_id);
CREATE INDEX idx_zahlungen_verkaufsposten ON zahlungen(verkaufsposten_id);
CREATE INDEX idx_zahlungen_datum         ON zahlungen(datum DESC);

-- ── Trigger: bezahlt-Status auf verkaufsposten automatisch aktualisieren ─────
CREATE OR REPLACE FUNCTION sync_verkaufsposten_bezahlt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id       uuid;
  v_gesamt   numeric(10,2);
  v_gezahlt  numeric(10,2);
BEGIN
  -- Welcher Verkaufsposten ist betroffen?
  v_id := COALESCE(NEW.verkaufsposten_id, OLD.verkaufsposten_id);

  -- Rechnungsbetrag (Brutto inkl. USt)
  SELECT COALESCE(SUM(
    ROUND(vp.menge * vp.vk_preis_brutto * (1 - COALESCE(vp.rabatt_pct,0)/100) * (1 - COALESCE(vp.sonderrabatt_pct,0)/100), 2)
  ), 0)
  INTO v_gesamt
  FROM verkauf_positionen vp
  WHERE vp.verkaufsposten_id = v_id;

  -- Bereits gezahlter Betrag
  SELECT COALESCE(SUM(betrag), 0)
  INTO v_gezahlt
  FROM zahlungen
  WHERE verkaufsposten_id = v_id;

  -- Status aktualisieren
  UPDATE verkaufsposten
  SET
    bezahlt    = (v_gezahlt >= v_gesamt AND v_gesamt > 0),
    bezahlt_am = CASE
                   WHEN v_gezahlt >= v_gesamt AND v_gesamt > 0 THEN now()
                   ELSE NULL
                 END
  WHERE id = v_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_zahlungen_sync_bezahlt
AFTER INSERT OR UPDATE OR DELETE ON zahlungen
FOR EACH ROW EXECUTE FUNCTION sync_verkaufsposten_bezahlt();

-- ── RLS: zahlungen ────────────────────────────────────────────────────────────
ALTER TABLE zahlungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zahlungen_select" ON zahlungen
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "zahlungen_insert" ON zahlungen
  FOR INSERT WITH CHECK (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "zahlungen_update" ON zahlungen
  FOR UPDATE USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "zahlungen_delete" ON zahlungen
  FOR DELETE USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );


-- ── 2. SumUp – Terminals ──────────────────────────────────────────────────────
-- Registrierte Kartenlesegeräte pro Tenant (ein Weingut kann mehrere haben)

CREATE TABLE sumup_terminals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bezeichnung   text        NOT NULL,               -- z. B. "Hofverkauf Kasse 1"
  serial_number text,                               -- Seriennummer des Lesegeräts
  aktiv         boolean     NOT NULL DEFAULT true,
  erstellt_am   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sumup_terminals_tenant ON sumup_terminals(tenant_id);

ALTER TABLE sumup_terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sumup_terminals_select" ON sumup_terminals
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "sumup_terminals_write" ON sumup_terminals
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
  );


-- ── 3. SumUp – Checkouts (initiierte Zahlungsanfragen) ───────────────────────
-- Wenn der Winzer am Kassabon-Button klickt, wird ein SumUp Checkout erstellt.
-- Status-Lifecycle: PENDING → PAID | FAILED

CREATE TYPE sumup_checkout_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

CREATE TABLE sumup_checkouts (
  id                  uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid                  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  verkaufsposten_id   uuid                  REFERENCES verkaufsposten(id) ON DELETE SET NULL,
  sumup_checkout_id   text                  UNIQUE,   -- ID von SumUp API
  betrag              numeric(10,2)         NOT NULL,
  waehrung            char(3)               NOT NULL DEFAULT 'EUR',
  beschreibung        text,
  status              sumup_checkout_status NOT NULL DEFAULT 'PENDING',
  erstellt_am         timestamptz           NOT NULL DEFAULT now(),
  aktualisiert_am     timestamptz           NOT NULL DEFAULT now()
);

CREATE INDEX idx_sumup_checkouts_tenant     ON sumup_checkouts(tenant_id);
CREATE INDEX idx_sumup_checkouts_status     ON sumup_checkouts(status);
CREATE INDEX idx_sumup_checkouts_vkposten   ON sumup_checkouts(verkaufsposten_id);

ALTER TABLE sumup_checkouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sumup_checkouts_select" ON sumup_checkouts
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "sumup_checkouts_insert" ON sumup_checkouts
  FOR INSERT WITH CHECK (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );

CREATE POLICY "sumup_checkouts_update" ON sumup_checkouts
  FOR UPDATE USING (
    user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
  );


-- ── 4. SumUp – Transaktionen (Webhook-Eingang) ───────────────────────────────
-- Jedes erfolgreiche SumUp-Event landet hier (Webhook POST /api/sumup/webhook).
-- Nach dem Eintrag bucht ein Trigger automatisch in zahlungen.

CREATE TABLE sumup_transaktionen (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checkout_id          uuid        REFERENCES sumup_checkouts(id) ON DELETE SET NULL,
  sumup_transaction_id text        NOT NULL UNIQUE,  -- SumUp interne TX-ID
  sumup_checkout_ref   text,                         -- checkout_reference von SumUp
  betrag               numeric(10,2) NOT NULL,
  waehrung             char(3)     NOT NULL DEFAULT 'EUR',
  status               text        NOT NULL,          -- SUCCESSFUL, FAILED, etc.
  zahlungsart          text,                          -- CARD, etc. (SumUp-Rohwert)
  kartennetz           text,                          -- VISA, MASTERCARD, etc.
  kartentyp            text,                          -- CREDIT, DEBIT
  letzten_4_ziffern    char(4),
  bezahlt_am           timestamptz,
  raw_payload          jsonb,                         -- kompletter Webhook-Body
  verarbeitet          boolean     NOT NULL DEFAULT false,
  erstellt_am          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sumup_tx_tenant      ON sumup_transaktionen(tenant_id);
CREATE INDEX idx_sumup_tx_status      ON sumup_transaktionen(status);
CREATE INDEX idx_sumup_tx_verarbeitet ON sumup_transaktionen(verarbeitet) WHERE NOT verarbeitet;

ALTER TABLE sumup_transaktionen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sumup_tx_select" ON sumup_transaktionen
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  ));

-- Insert nur via service_role (Webhook-Handler), kein direktes Nutzer-Insert
CREATE POLICY "sumup_tx_service_insert" ON sumup_transaktionen
  FOR INSERT WITH CHECK (auth.role() = 'service_role');


-- ── 5. Trigger: SumUp TX → zahlungen auto-buchen ─────────────────────────────
CREATE OR REPLACE FUNCTION sumup_tx_zu_zahlung()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_verkaufsposten_id uuid;
BEGIN
  -- Nur erfolgreiche, noch nicht verarbeitete Transaktionen
  IF NEW.status != 'SUCCESSFUL' OR NEW.verarbeitet THEN
    RETURN NEW;
  END IF;

  -- Verkaufsposten über den Checkout ermitteln
  SELECT verkaufsposten_id INTO v_verkaufsposten_id
  FROM sumup_checkouts
  WHERE id = NEW.checkout_id;

  IF v_verkaufsposten_id IS NULL THEN
    RETURN NEW;  -- Kein Verkaufsposten verknüpft → nur erfassen, nicht buchen
  END IF;

  -- Zahlung anlegen
  INSERT INTO zahlungen (
    tenant_id, verkaufsposten_id, betrag, art, datum, sumup_transaction_id, notizen
  ) VALUES (
    NEW.tenant_id,
    v_verkaufsposten_id,
    NEW.betrag,
    'karte',
    COALESCE(NEW.bezahlt_am::date, CURRENT_DATE),
    NEW.sumup_transaction_id,
    'SumUp Terminal' || COALESCE(' · ' || NEW.kartennetz, '') || COALESCE(' ···· ' || NEW.letzten_4_ziffern, '')
  );

  -- Als verarbeitet markieren
  NEW.verarbeitet := true;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sumup_tx_zu_zahlung
BEFORE INSERT ON sumup_transaktionen
FOR EACH ROW EXECUTE FUNCTION sumup_tx_zu_zahlung();
