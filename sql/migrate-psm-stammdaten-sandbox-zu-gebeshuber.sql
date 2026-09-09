-- Einmalige Migration: PSM-Stammdaten (Pflanzenschutzmittel) von "Sandbox" nach
-- "Weingut Johannes Gebeshuber" kopieren
--
-- Kopiert nur die MANDANTEN-EIGENEN PSM-Datensaetze aus Sandbox (tenant_id =
-- Sandbox), keine globalen Mittel (tenant_id IS NULL) - die sind ueber die RLS-
-- Policy "psm: read global + own" ohnehin schon fuer jeden Mandanten sichtbar,
-- eine Kopie wuerde nur Dubletten erzeugen.
--
-- Reine Stammdaten (Name, Wirkstoff, Wartezeit, Zulassung, Bio/Bienen/Gewaesser-
-- Flags, Preis usw.) werden uebernommen - KEINE Lagerbewegungen
-- (psm_lager_bewegungen) und KEINE Behandlungen (behandlungen), die sind
-- Betriebs-/Zeitraum-spezifisch und ergeben bei Gebeshuber keinen Sinn.
--
-- Einmaliges Service, wie besprochen - kein laufender Sync. PSM-Sortiment kann
-- sich je Betrieb unterscheiden, daher bewusst kein automatischer Abgleich bei
-- kuenftigen Aenderungen in Sandbox.
--
-- Duplikat-Schutz: ein PSM wird nur kopiert, wenn bei Gebeshuber noch kein
-- Mittel mit demselben Namen existiert (Name-Vergleich ohne Gross-/Klein-
-- schreibung). Bereits manuell erfasste Mittel bleiben unangetastet.

insert into pflanzenschutzmittel (
  tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct,
  zulassungsnr, zulassungsgueltig, kategorie, wirkungsbereich,
  wartezeit_tage, max_aufwand_kg_ha, max_anwendungen,
  oeko_zugelassen, bienengefaehrlich, gewaesserschutz,
  sicherheitsdaten_url, notizen, aktiv,
  cu_gehalt_pct, eppo_code, preis_pro_einheit
)
select
  (select id from tenants where name = 'Weingut Johannes Gebeshuber') as tenant_id,
  s.name, s.handelsname, s.wirkstoff, s.wirkstoffgehalt_pct,
  s.zulassungsnr, s.zulassungsgueltig, s.kategorie, s.wirkungsbereich,
  s.wartezeit_tage, s.max_aufwand_kg_ha, s.max_anwendungen,
  s.oeko_zugelassen, s.bienengefaehrlich, s.gewaesserschutz,
  s.sicherheitsdaten_url, s.notizen, s.aktiv,
  s.cu_gehalt_pct, s.eppo_code, s.preis_pro_einheit
from pflanzenschutzmittel s
where s.tenant_id = (select id from tenants where name = 'Sandbox')
  and not exists (
    select 1 from pflanzenschutzmittel g
    where g.tenant_id = (select id from tenants where name = 'Weingut Johannes Gebeshuber')
      and lower(g.name) = lower(s.name)
  );

-- Kontrolle: PSM-Stammdaten jetzt bei Gebeshuber
select name, handelsname, kategorie, wartezeit_tage, oeko_zugelassen, aktiv
from pflanzenschutzmittel
where tenant_id = (select id from tenants where name = 'Weingut Johannes Gebeshuber')
order by name;
