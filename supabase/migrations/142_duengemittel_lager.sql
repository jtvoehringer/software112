-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 142 – Düngemittel Lagerverwaltung
-- Analog Migration 016 (PSM-Lager): Anfangsbestand, Einkauf, Inventurkorrektur
-- je Düngemittel. Verbrauch wird aus behandlungen (duengemittel_id) berechnet
-- (kein separater Eintrag nötig) – siehe Punkt 5 der Punkteliste vom 04.08.2026:
-- Düngemittel sollen dieselbe volle Lagerbewegungs-Erfassung wie PSM erhalten.
-- ─────────────────────────────────────────────────────────────────────────────

create table duengemittel_lager_bewegungen (
  id             uuid        primary key default uuid_generate_v4(),
  tenant_id      uuid        not null references tenants(id) on delete cascade,
  duengemittel_id uuid       not null references duengemittel(id) on delete cascade,
  datum          date        not null,
  typ            text        not null check (typ in ('anfangsbestand', 'einkauf', 'korrektur')),
  menge          numeric(10,3) not null,   -- positiv = Eingang, negativ = Ausgang (Korrektur)
  einheit        text        check (einheit in ('kg','l','g','ml')),
  notizen        text,
  erstellt_am    timestamptz not null default now()
);

comment on table duengemittel_lager_bewegungen is
  'Manuelle Lagerbewegungen: Anfangsbestand, Einkauf, Inventurkorrektur. Verbrauch wird aus behandlungen (duengemittel_id) berechnet. Analog psm_lager_bewegungen.';
comment on column duengemittel_lager_bewegungen.menge is
  'Positiv = Zugang (Einkauf, Anfangsbestand), negativ = Abgang (Korrektur nach unten)';

alter table duengemittel_lager_bewegungen enable row level security;

-- RLS: Nutzer sehen nur Daten ihres Mandanten
create policy "duengemittel_lager_tenant_select" on duengemittel_lager_bewegungen
  for select using (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create policy "duengemittel_lager_tenant_insert" on duengemittel_lager_bewegungen
  for insert with check (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create policy "duengemittel_lager_tenant_update" on duengemittel_lager_bewegungen
  for update using (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create policy "duengemittel_lager_tenant_delete" on duengemittel_lager_bewegungen
  for delete using (
    tenant_id = (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() limit 1
    )
  );

create index idx_duengemittel_lager_tenant       on duengemittel_lager_bewegungen(tenant_id);
create index idx_duengemittel_lager_duengemittel  on duengemittel_lager_bewegungen(duengemittel_id);
create index idx_duengemittel_lager_datum         on duengemittel_lager_bewegungen(datum);
