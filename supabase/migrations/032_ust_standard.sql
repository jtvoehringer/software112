-- Migration 032: Standard-USt-Satz pro Mandant
-- Österreichische Steuerklassen:
--   13 % → Weinproduzent (stiller Wein, § 10 Abs. 2 Z 7 UStG)
--   20 % → Weinhändler / Spirituosen / allgemeine Güter

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS ust_satz_standard numeric(5,2) DEFAULT 13;
