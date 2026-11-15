-- KAN-462 (15.11.2026, Weinshop S1c): letzter Stand der Weindaten-Übertragung je Zuordnung.
--
-- Entscheidung Jörgen 15.11.2026 (Plan KAN-462, Punkt 6): kein eigenes Protokoll, sondern der letzte Stand an der
-- Zuordnung – wann übertragen, Prüfsumme des übertragenen Inhalts (die Seite zeigt damit „aktuell“ bzw. „geändert seit
-- der Übertragung“) und die Meldung des letzten Fehlversuchs. Rechte und Policies der Tabelle bleiben unverändert
-- (KAN-461: Schreiben nur Betriebsleitung, Paket-Modul modul_shop, Lesebereich lager).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.shop_zuordnungen
  ADD COLUMN weindaten_am         timestamptz,
  ADD COLUMN weindaten_pruefsumme text CONSTRAINT shop_zuordnungen_weindaten_pruefsumme_chk CHECK (weindaten_pruefsumme IS NULL OR weindaten_pruefsumme ~ '^[0-9a-f]{32}$'),
  ADD COLUMN weindaten_fehler     text CONSTRAINT shop_zuordnungen_weindaten_fehler_chk CHECK (weindaten_fehler IS NULL OR char_length(weindaten_fehler) BETWEEN 1 AND 500);

COMMENT ON COLUMN public.shop_zuordnungen.weindaten_am IS 'KAN-462: letzte erfolgreiche Übertragung der Weindaten in den Shop';
COMMENT ON COLUMN public.shop_zuordnungen.weindaten_pruefsumme IS 'KAN-462: Prüfsumme des zuletzt übertragenen Inhalts (ohne den Tag der Übertragung)';
COMMENT ON COLUMN public.shop_zuordnungen.weindaten_fehler IS 'KAN-462: Meldung des letzten Fehlversuchs; leer nach einer erfolgreichen Übertragung';

NOTIFY pgrst, 'reload schema';
