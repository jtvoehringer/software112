-- Migration 158: Firmen - Kunde/Lieferant-Kennzeichnung
-- Firmen koennen Kunde, Lieferant oder beides sein (Feedback 12.8.2026).

alter table firmen add column if not exists ist_kunde     boolean not null default true;
alter table firmen add column if not exists ist_lieferant boolean not null default false;

comment on column firmen.ist_kunde     is 'Firma tritt als Kunde auf (waehlbar in Weinhandel/Verkauf)';
comment on column firmen.ist_lieferant is 'Firma tritt als Lieferant auf (waehlbar in Zukauf/Einkauf)';

-- ── Vorbelegung bestehender Firmen anhand bisheriger Historie ──────────────────
-- (auf Wunsch automatisch statt manuell nachzupflegen)

-- Lieferant = true, wenn schon mindestens ein Zukauf-Posten dieser Firma zugeordnet ist.
update firmen f set ist_lieferant = true
where exists (
  select 1 from zukauf_posten z where z.lieferant_firma_id = f.id
);

-- Kunde = false NUR bei Firmen mit ausschliesslich Zukauf-Historie (reine Lieferanten,
-- die noch nie in einem Verkauf oder Traubenverkauf vorkamen). Alle anderen Firmen
-- bleiben beim Default "Kunde" = true - das deckt sowohl Firmen mit Verkaufs-Historie
-- als auch Firmen ganz ohne jede Historie (z.B. reine Leads) ab.
update firmen f set ist_kunde = false
where exists (
  select 1 from zukauf_posten z where z.lieferant_firma_id = f.id
)
and not exists (
  select 1 from verkaufsposten vp where vp.firma_id = f.id
)
and not exists (
  select 1 from traubenverkauf tv where tv.firma_id = f.id
);
