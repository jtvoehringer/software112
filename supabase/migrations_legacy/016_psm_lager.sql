-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 – PSM Lagerverwaltung
-- Anfangsbestand, Einkauf, Inventurkorrektur je Pflanzenschutzmittel
-- Verbrauch wird aus behandlungen berechnet (kein separater Eintrag nötig)
-- ─────────────────────────────────────────────────────────────────────────────

create table psm_lager_bewegungen (
  id          uuid        primary key default uuid_generate_v4(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  psm_id      uuid        not null references pflanzenschutzmittel(id) on delete cascade,
  datum       date        not null,
  typ         text        not null check (typ in ('anfangsbestand', 'einkauf', 'korrektur')),
  menge       numeric(10,3) not null,   -- positiv = Eingang, negativ = Ausgang (Korrektur)
  einheit     text        check (einheit in ('kg','l','g','ml')),
  notizen     text,
  erstellt_am timestamptz not null default now()
);

comment on table psm_lager_bewegungen is
  'Manuelle Lagerbewegungen: Anfangsbestand, Einkauf, Inventurkorrektur. Verbrauch wird aus behandlungen berechnet.';
comment on column psm_lager_bewegungen.menge is
  'Positiv = Zugang (Einkauf, Anfangsbestand), negativ = Abgang (Korrektur nach unten)';

alter table psm_lager_bewegungen enable row level security;

-- RLS: Nutzer sehen nur Daten ihres Mandanten
create policy "psm_lager_tenant_select" on psm_lager_bewegungen
  for select using (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create policy "psm_lager_tenant_insert" on psm_lager_bewegungen
  for insert with check (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create policy "psm_lager_tenant_update" on psm_lager_bewegungen
  for update using (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create policy "psm_lager_tenant_delete" on psm_lager_bewegungen
  for delete using (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create index idx_psm_lager_tenant on psm_lager_bewegungen(tenant_id);
create index idx_psm_lager_psm    on psm_lager_bewegungen(psm_id);
create index idx_psm_lager_datum  on psm_lager_bewegungen(datum);
