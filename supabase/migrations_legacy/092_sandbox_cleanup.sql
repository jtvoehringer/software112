-- Sandbox Cleanup – Tenant fa22dc07-eca5-43df-af96-f7b9b09f0471

delete from fuellung_chargen
  where fuellung_id in (select id from fuellungen where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');

delete from weinanalysen      where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from dac_antrag        where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from keller_umzuege    where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from keller_behandlungen where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

delete from verkauf_positionen
  where weinausbau_id in (select id from weinausbau where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');

delete from fuellungen        where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

delete from pressung_behaelter
  where pressung_id in (select id from pressungen where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');

delete from pressung_weingaerten
  where pressung_id in (select id from pressungen where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');

delete from behandlung_grundstuecke
  where behandlung_id in (select id from behandlungen where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');

delete from behandlungen         where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from weinausbau_weingaerten where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from weinausbau           where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from pressungen           where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
delete from ernte_parzellen
  where jahrgang_id in (select id from weinjahrgaenge where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');
delete from ama_erntemeldungen   where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── Zukäufe ──────────────────────────────────────────────────────────────────
-- verkauf_positionen.zukauf_id hat ON DELETE SET NULL → zukauf_posten zuerst löschen
delete from verkauf_positionen
  where zukauf_id in (select id from zukauf_posten where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471');

delete from zukauf_posten        where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── PSM-Lagerbewegungen ───────────────────────────────────────────────────────
delete from psm_lager_bewegungen where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── Verkaufsposten (Header) ───────────────────────────────────────────────────
-- verkauf_positionen wurden bereits oben gelöscht
delete from verkaufsposten       where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── Verschneidungen (aus Migration 093) ──────────────────────────────────────
-- verschneidung_quellen via CASCADE
delete from verschneidungen      where tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
