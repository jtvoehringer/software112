-- Migration 030: Betriebsdaten + Rechnungseinstellungen in tenant_einstellungen
-- Ergänzt die bestehende Tabelle um Felder für Briefkopf und Rechnungsdruck

ALTER TABLE tenant_einstellungen
  -- ── Betriebsdaten (Briefkopf) ─────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS betrieb_name     text,
  ADD COLUMN IF NOT EXISTS betrieb_strasse  text,
  ADD COLUMN IF NOT EXISTS betrieb_plz      text,
  ADD COLUMN IF NOT EXISTS betrieb_ort      text,
  ADD COLUMN IF NOT EXISTS betrieb_telefon  text,
  ADD COLUMN IF NOT EXISTS betrieb_email    text,
  ADD COLUMN IF NOT EXISTS betrieb_website  text,
  ADD COLUMN IF NOT EXISTS betrieb_uid      text,   -- UID-Nummer (z.B. ATU12345678)

  -- ── Bankverbindung für Rechnung ───────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS rechnung_iban           text,
  ADD COLUMN IF NOT EXISTS rechnung_bic            text,
  ADD COLUMN IF NOT EXISTS rechnung_zahlungsziel   int  DEFAULT 14,
  ADD COLUMN IF NOT EXISTS rechnung_fusstext       text;

-- ── Standard-USt-Satz pro Verkaufsposition ────────────────────────────────────
-- Österreichischer Weinhandel: 13% (Flaschenwein), 20% (Sekt/Schaumwein/Spirituosen)
ALTER TABLE verkauf_positionen
  ADD COLUMN IF NOT EXISTS ust_satz numeric(5,2) DEFAULT 13;
