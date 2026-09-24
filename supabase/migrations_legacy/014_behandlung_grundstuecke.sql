-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014 – Behandlungen auf Grundstück-Ebene
-- Junction-Tabelle: behandlung ↔ grundstuecke (m:n)
-- Brache/Gerodet werden im UI ausgesperrt, aber die DB erzwingt keine Regel
-- (Status kann sich ändern; historische Daten bleiben korrekt)
-- ─────────────────────────────────────────────────────────────────────────────

create table behandlung_grundstuecke (
  behandlung_id   uuid  not null references behandlungen(id)  on delete cascade,
  grundstueck_id  uuid  not null references grundstuecke(id)  on delete cascade,
  primary key (behandlung_id, grundstueck_id)
);

comment on table behandlung_grundstuecke is
  'Welche Grundstücke wurden bei einer Behandlung behandelt (nur aktive, kein Brache/Gerodet)';

create index idx_beh_gst_behandlung  on behandlung_grundstuecke(behandlung_id);
create index idx_beh_gst_grundstueck on behandlung_grundstuecke(grundstueck_id);

-- weingarten_id auf behandlungen auf NULL-fähig lassen (war schon nullable)
-- Wir befüllen sie weiterhin als Kurzreferenz (erste Weingarten-ID),
-- aber die Wahrheit liegt in behandlung_grundstuecke

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table behandlung_grundstuecke enable row level security;

-- Lesezugriff: über behandlung → tenant prüfen
create policy "beh_gst: members can select"
  on behandlung_grundstuecke for select
  using (
    behandlung_id in (
      select id from behandlungen
      where tenant_id in (select get_user_tenant_ids())
    )
  );

create policy "beh_gst: winzer+ can insert"
  on behandlung_grundstuecke for insert
  with check (
    behandlung_id in (
      select id from behandlungen
      where user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

create policy "beh_gst: winzer+ can delete"
  on behandlung_grundstuecke for delete
  using (
    behandlung_id in (
      select id from behandlungen
      where user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );
