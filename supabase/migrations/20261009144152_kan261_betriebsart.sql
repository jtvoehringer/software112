-- KAN-261 (09.10.2026): Betriebsart Weinproduzent / Weinhändler je Betrieb
--
-- Bisher erkannte die App die Betriebsart nur am Standard-USt.-Satz (13 % Produzent, 20 % Händler). Die Weinbau-
-- Betriebsnummer war für jeden Betrieb Pflicht – Weinhändler gelten nicht als landwirtschaftlicher Betrieb und haben
-- meist keine; Spaetrot (Händler) musste deshalb „0“ eintragen. Ab jetzt: Pflicht nur für Weinproduzenten, für
-- Weinhändler optional (falls vorhanden, z. B. LFBIS-Nummer für Weindatenbank oder Prüfnummernantrag).
--
-- Vorbelegung aus dem Standard-USt.-Satz (20 % → Weinhändler). Lesen wie die übrigen betrieb_*-Spalten
-- (authenticated/anon), geschrieben wird nur über die Service-Role (Mandantenverwaltung) – kein UPDATE-Recht,
-- der Trigger a_schutz_plattformfelder bleibt.

BEGIN;

ALTER TABLE public.tenant_einstellungen
  ADD COLUMN betriebsart text NOT NULL DEFAULT 'weinproduzent';

ALTER TABLE public.tenant_einstellungen
  ADD CONSTRAINT tenant_einstellungen_betriebsart_check CHECK (betriebsart IN ('weinproduzent', 'weinhaendler'));

COMMENT ON COLUMN public.tenant_einstellungen.betriebsart IS
  'KAN-261: weinproduzent | weinhaendler – Weinbau-Betriebsnummer nur für Weinproduzenten Pflicht';

UPDATE public.tenant_einstellungen SET betriebsart = 'weinhaendler' WHERE ust_satz_standard = 20;

GRANT SELECT (betriebsart) ON public.tenant_einstellungen TO authenticated, anon;

COMMIT;
